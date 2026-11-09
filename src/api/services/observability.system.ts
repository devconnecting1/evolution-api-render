/**
 * Local "Sistema" provider of the observability overview: always available, needs no external API key.
 *
 * Reads only aggregated numbers about this process, its container (cgroup), the database and the WhatsApp
 * instances. Never returns personal data (no phone numbers, contact names, messages or instance names).
 */
import fs from 'node:fs';
import os from 'node:os';

import { getMessageStoreFailures, MessageStoreFailures } from '@utils/messageStoreFailures';

import {
  buildMetric,
  finite,
  formatBytes,
  formatNumber,
  Metric,
  ProviderView,
  Resource,
  withTimeout,
  worstStatus,
} from './observability.shared';
import type { UsageSnapshotItem } from './usage.service';

const DB_TIMEOUT_MS = 5_000;
const CACHE_TIMEOUT_MS = 2_000;
const CPU_SAMPLE_MS = 250;
/** cgroup v1 reports "unlimited" as a huge number (close to 2^63). */
const UNLIMITED_BYTES = 2 ** 60;

type CpuSample = { usage: NodeJS.CpuUsage; at: number };

export type RedisState = { state: 'ready' | 'connecting' | 'down' | 'absent'; latencyMs?: number | null };

export type PrismaLike = {
  $queryRawUnsafe: (query: string) => Promise<any>;
  instance: { groupBy: (args: any) => Promise<any[]>; findMany?: (args: any) => Promise<any[]> };
  message: { count: (args: any) => Promise<number>; groupBy?: (args: any) => Promise<any[]> };
  integrationSession: { groupBy: (args: any) => Promise<any[]> };
};

export type SystemDeps = {
  prisma?: PrismaLike | null;
  /** In-memory instances of the WAMonitoringService (live connection state). */
  waInstances?: () => Record<string, any> | null | undefined;
  /** "Plano e limites": month usage per instance (UsageService.snapshot). Without it there is no usage card. */
  usage?: () => Promise<UsageSnapshotItem[]>;
  /** "Leads (triagem)": one note line per instance in the usage card (LeadsService.snapshot). Optional. */
  leads?: () => Promise<{ name: string; newToday: number; qualified7d: number; awaiting: number }[]>;
  databaseProvider?: string;
  cache?: {
    redisEnabled: boolean;
    localEnabled: boolean;
    redisState?: () => Promise<RedisState>;
  };
  env?: NodeJS.ProcessEnv;
  readFile?: (path: string) => string | null;
  memoryUsage?: () => NodeJS.MemoryUsage;
  cpuUsage?: (previous?: NodeJS.CpuUsage) => NodeJS.CpuUsage;
  uptimeSeconds?: () => number;
  totalMemory?: () => number;
  cpuCount?: () => number;
  loadAverage?: () => number[];
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  packageVersion?: () => string | null;
  nodeVersion?: string;
  /** Incoming messages not stored because of a database error since the process started (#2714). */
  messageStoreFailures?: () => MessageStoreFailures;
};

const defaultReadFile = (path: string): string | null => {
  try {
    return fs.readFileSync(path, 'utf8').trim();
  } catch {
    return null;
  }
};

const defaultPackageVersion = (): string | null => {
  try {
    return JSON.parse(fs.readFileSync('./package.json', 'utf8'))?.version ?? null;
  } catch {
    return null;
  }
};

type ReadFile = (path: string) => string | null;

/**
 * Paths of this process in each cgroup hierarchy, from /proc/self/cgroup ("0::/path" for v2,
 * "4:memory:/path" or "1:cpu,cpuacct:/path" for v1). Without a cgroup namespace the limits live in that
 * nested directory, not at the root of /sys/fs/cgroup.
 */
function procCgroupPaths(readFile: ReadFile): { v2: string | null; v1: Record<string, string> } {
  const v1: Record<string, string> = {};
  let v2: string | null = null;
  for (const line of (readFile('/proc/self/cgroup') ?? '').split('\n')) {
    const match = line.trim().match(/^(\d+):([^:]*):(\/.*)$/);
    if (!match) continue;
    if (match[1] === '0' && match[2] === '') v2 = match[3];
    else for (const controller of match[2].split(',')) v1[controller] = match[3];
  }
  return { v2, v1 };
}

/** The process cgroup directory and its ancestors up to `base` (leaf first). */
function cgroupDirs(base: string, path: string | null | undefined): string[] {
  const parts = (path ?? '/').split('/').filter((part) => part && part !== '..');
  const dirs: string[] = [];
  for (let i = parts.length; i > 0; i--) dirs.push(`${base}/${parts.slice(0, i).join('/')}`);
  dirs.push(base);
  return dirs;
}

/**
 * Walks the cgroup chain: the effective limit is the smallest one set on the process cgroup or any ancestor,
 * and the usage is the one of the closest directory that reports it. `found` tells whether the hierarchy exists.
 */
function cgroupChain(
  readFile: ReadFile,
  dirs: string[],
  limitFile: string,
  usageFile: string | null,
  parseLimit: (raw: string, dir: string) => number | null,
) {
  let found = false;
  let limit: number | null = null;
  let current: number | null = null;
  for (const dir of dirs) {
    const raw = readFile(`${dir}/${limitFile}`);
    if (raw !== null) {
      found = true;
      const value = parseLimit(raw, dir);
      if (value !== null && (limit === null || value < limit)) limit = value;
    }
    if (current === null && usageFile) current = parseBytes(readFile(`${dir}/${usageFile}`));
  }
  return { found, limit, current };
}

function parseBytes(value: string | null): number | null {
  if (!value || value === 'max') return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 && n < UNLIMITED_BYTES ? n : null;
}

/** Container memory limit/usage from cgroup v2 or v1; null when not running under a limited cgroup. */
export function readCgroupMemory(readFile: ReadFile): {
  limit: number | null;
  current: number | null;
} {
  const paths = procCgroupPaths(readFile);

  const v2 = cgroupChain(readFile, cgroupDirs('/sys/fs/cgroup', paths.v2), 'memory.max', 'memory.current', (raw) =>
    parseBytes(raw),
  );
  if (v2.found) return { limit: v2.limit, current: v2.current };

  const v1 = cgroupChain(
    readFile,
    cgroupDirs('/sys/fs/cgroup/memory', paths.v1.memory),
    'memory.limit_in_bytes',
    'memory.usage_in_bytes',
    (raw) => parseBytes(raw),
  );
  return { limit: v1.limit, current: v1.current };
}

/** CPU cores available to the container from cgroup v2 (`cpu.max`) or v1 (CFS quota); null when unlimited. */
export function readCgroupCpuLimit(readFile: ReadFile): number | null {
  const paths = procCgroupPaths(readFile);

  const v2 = cgroupChain(readFile, cgroupDirs('/sys/fs/cgroup', paths.v2), 'cpu.max', null, (raw) => {
    const [quota, period] = raw.split(/\s+/);
    if (!quota || quota === 'max') return null;
    const cores = Number(quota) / Number(period || 100000);
    return Number.isFinite(cores) && cores > 0 ? cores : null;
  });
  if (v2.found) return v2.limit;

  const v1Quota = (raw: string, dir: string) => {
    const quota = Number(raw);
    const period = Number(readFile(`${dir}/cpu.cfs_period_us`));
    if (!Number.isFinite(quota) || quota <= 0 || !Number.isFinite(period) || period <= 0) return null;
    return quota / period;
  };
  for (const base of ['/sys/fs/cgroup/cpu', '/sys/fs/cgroup/cpu,cpuacct']) {
    const v1 = cgroupChain(readFile, cgroupDirs(base, paths.v1.cpu), 'cpu.cfs_quota_us', null, v1Quota);
    if (v1.found) return v1.limit;
  }
  return null;
}

/**
 * Smallest Prisma cuid (v1: "c" + 8 base36 chars of epoch ms + random) created at `ms`. Every id generated by
 * `@default(cuid())` after `ms` sorts after it, so `id >= floor` is a range scan on the primary key index:
 * the 24h message count never scans the whole Message table (messageTimestamp has no index).
 */
export function cuidFloor(ms: number): string {
  return `c${Math.max(0, Math.floor(ms)).toString(36).padStart(8, '0')}`;
}

const toNumber = (value: unknown): number => {
  if (typeof value === 'bigint') return Number(value);
  return finite(value) ?? 0;
};

const firstRow = (rows: any): any => (Array.isArray(rows) ? rows[0] : rows) ?? {};

const countBy = (rows: any[] | null | undefined, field: string): Record<string, number> => {
  const result: Record<string, number> = {};
  for (const row of rows ?? []) {
    const key = String(row?.[field] ?? 'unknown');
    const count = toNumber(row?._count?._all ?? row?._count ?? 0);
    result[key] = (result[key] ?? 0) + count;
  }
  return result;
};

export class SystemProbe {
  private lastCpu: CpuSample | null = null;

  constructor(private readonly deps: SystemDeps = {}) {}

  public async collect(): Promise<ProviderView> {
    const d = this.deps;
    const env = d.env ?? process.env;
    const readFile = d.readFile ?? defaultReadFile;
    const now = d.now ?? Date.now;
    const notes: string[] = [];
    let partial = false;

    const [cpu, database, sessions, cacheState] = await Promise.all([
      this.sampleCpu(readFile),
      this.collectDatabase(),
      this.collectSessions(),
      this.collectCache(),
    ]);

    // Memory: process RSS against the container limit (cgroup), or the machine memory outside a container
    const memory = (d.memoryUsage ?? process.memoryUsage)();
    const cgroup = readCgroupMemory(readFile);
    const totalMemory = (d.totalMemory ?? os.totalmem)();
    const memoryLimit = cgroup.limit ?? totalMemory;
    const memoryDetail = [
      `Heap ${formatBytes(memory.heapUsed)} de ${formatBytes(memory.heapTotal)}`,
      cgroup.current !== null ? `container ${formatBytes(cgroup.current)}` : null,
      cgroup.limit !== null ? 'limite do container' : 'limite = memória da máquina',
    ]
      .filter(Boolean)
      .join(' · ');
    const memoryMetric = buildMetric('memory', 'Memória (RSS)', memory.rss, memoryLimit, 'bytes', {
      detail: memoryDetail,
      warnAt: 80,
      criticalAt: 90,
    });

    const cpuMetric = buildMetric('cpu', 'CPU (% do limite)', cpu.percent, 100, 'number', {
      detail: `${formatNumber(cpu.cores, 2)} vCPU disponível${cpu.fromCgroup ? ' (container)' : ''} · load ${cpu.load}`,
      warnAt: 80,
      criticalAt: 95,
    });

    const instances = this.collectInstances(database.instanceRows);
    const instanceStatus =
      instances.total === null ? 'unknown' : instances.total > 0 && instances.open < instances.total ? 'warning' : 'ok';
    const instancesMetric = buildMetric(
      'instances',
      'Instâncias conectadas',
      instances.total === null ? null : instances.open,
      instances.total,
      'count',
      { detail: instances.detail, status: instanceStatus, higherIsBetter: true },
    );

    // Database errors while storing incoming messages (#2714): warning while the last one is less than 24 h old
    let failures: MessageStoreFailures = { count: 0, lastAt: null, lastCode: null };
    try {
      failures = (d.messageStoreFailures ?? getMessageStoreFailures)();
    } catch {
      // optional
    }
    const lastFailureAt = failures.lastAt ? Date.parse(failures.lastAt) : NaN;
    const recentFailure = Number.isFinite(lastFailureAt) && now() - lastFailureAt < 24 * 60 * 60 * 1000;
    const storeFailuresMetric = buildMetric(
      'message_store_failures',
      'Falhas ao salvar mensagens',
      failures.count,
      null,
      'count',
      {
        detail: failures.count
          ? `Última em ${formatShortDate(failures.lastAt)} (${failures.lastCode}) · desde o início do processo`
          : 'Erros do banco ao salvar mensagens recebidas, desde o início do processo',
        status: recentFailure ? 'warning' : 'ok',
      },
    );

    const metrics: Metric[] = [
      memoryMetric,
      cpuMetric,
      instancesMetric,
      buildMetric('messages_24h', 'Mensagens (24h)', database.messages24h, null, 'count', {
        detail: 'Mensagens enviadas e recebidas nas últimas 24 horas (salvas no banco)',
      }),
      storeFailuresMetric,
      buildMetric('chatbot_sessions', 'Sessões de chatbot ativas', sessions.active, null, 'count', {
        detail: sessions.detail,
      }),
      buildMetric('human_paused', 'Pausadas por humano', sessions.humanPaused, null, 'count', {
        detail:
          sessions.manualPaused !== null
            ? `Conversas assumidas por um atendente · ${sessions.manualPaused} pausa(s) manual(is)`
            : 'Conversas assumidas por um atendente',
      }),
      buildMetric('database_size', 'Tamanho do banco', database.sizeBytes, null, 'bytes', {
        detail: database.provider === 'mysql' ? 'Tabelas + índices (MySQL)' : 'pg_database_size do banco atual',
      }),
      buildMetric('uptime', 'Uptime do processo', (d.uptimeSeconds ?? process.uptime)() / 60, null, 'minutes', {
        detail: `Desde ${new Date(now() - (d.uptimeSeconds ?? process.uptime)() * 1000).toLocaleString('pt-BR', {
          timeZone: env.TZ || 'America/Sao_Paulo',
        })}`,
      }),
    ];

    // Notes and card status
    if (memoryMetric.status === 'critical') notes.push('Memória acima de 90% do limite: risco de reinício por OOM.');
    else if (memoryMetric.status === 'warning') notes.push('Memória acima de 80% do limite do container.');
    if (cpuMetric.status === 'warning' || cpuMetric.status === 'critical') notes.push('CPU próxima do limite.');
    if (instanceStatus === 'warning') {
      notes.push(`${instances.total - instances.open} instância(s) não conectada(s) ao WhatsApp.`);
    }
    if (database.errors.length) notes.push(`Não foi possível ler do banco: ${database.errors.join(', ')}.`);
    if (recentFailure) {
      notes.push(
        'Mensagens recebidas não foram salvas por erro do banco nas últimas 24 h: confira o log (P1001 = banco inacessível).',
      );
    }
    if (sessions.error) notes.push('Não foi possível ler as sessões de chatbot.');
    if (cacheState.problem) notes.push(cacheState.problem);

    partial =
      worstStatus(metrics) !== 'ok' ||
      database.errors.length > 0 ||
      Boolean(sessions.error) ||
      Boolean(cacheState.problem);

    notes.push('Dados locais do servidor da API, sem chaves externas. Nenhum dado pessoal é exibido.');

    const version = (d.packageVersion ?? defaultPackageVersion)();
    const commit = env.RENDER_GIT_COMMIT ? String(env.RENDER_GIT_COMMIT).slice(0, 7) : null;
    const resources: Resource[] = [
      {
        id: 'api',
        name: 'API WhatsAI',
        type: version ? `Evolution API v${version}` : 'Evolution API',
        status: 'online',
        region: env.RENDER_SERVICE_NAME || undefined,
        detail: [commit ? `commit ${commit}` : null, env.RENDER_GIT_BRANCH, `Node ${d.nodeVersion ?? process.version}`]
          .filter(Boolean)
          .join(' · '),
      },
      {
        id: 'database',
        name: 'Banco de dados',
        type: database.provider === 'mysql' ? 'MySQL' : 'PostgreSQL',
        status: database.connected ? 'conectado' : 'sem resposta',
        detail: database.latencyMs !== null ? `Consulta em ${database.latencyMs} ms` : undefined,
      },
      cacheState.resource,
    ];

    const links =
      env.RENDER_SERVICE_ID && /^srv-[a-z0-9]+$/.test(env.RENDER_SERVICE_ID)
        ? [{ label: 'Serviço no Render', url: `https://dashboard.render.com/web/${env.RENDER_SERVICE_ID}` }]
        : [];

    return {
      id: 'system',
      name: 'Sistema',
      description: 'Servidor da API, banco e instâncias',
      configured: true,
      plan: version ? `v${version}` : null,
      status: partial ? 'partial' : 'ok',
      updatedAt: new Date(now()).toISOString(),
      metrics,
      resources,
      notes,
      links,
    };
  }

  /** CPU % of the available cores since the last overview (or over a short window on the first call). */
  private async sampleCpu(readFile: (path: string) => string | null) {
    const d = this.deps;
    const now = d.now ?? Date.now;
    const cpuUsage = d.cpuUsage ?? process.cpuUsage;
    const cgroupCores = readCgroupCpuLimit(readFile);
    const machineCores = (d.cpuCount ?? (() => os.availableParallelism?.() ?? os.cpus().length))();
    const cores = cgroupCores ?? (machineCores > 0 ? machineCores : 1);

    let start = this.lastCpu;
    const age = start ? now() - start.at : Infinity;
    if (!start || age < 1000 || age > 10 * 60_000) {
      start = { usage: cpuUsage(), at: now() };
      await (d.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))))(CPU_SAMPLE_MS);
    }

    const end: CpuSample = { usage: cpuUsage(), at: now() };
    const elapsedMicros = Math.max(1, (end.at - start.at) * 1000);
    const usedMicros = end.usage.user - start.usage.user + (end.usage.system - start.usage.system);
    this.lastCpu = end;

    const load = (d.loadAverage ?? os.loadavg)()
      .slice(0, 3)
      .map((value) => formatNumber(value, 2))
      .join(' / ');

    return {
      percent: Math.max(0, (usedMicros / elapsedMicros / cores) * 100),
      cores,
      fromCgroup: cgroupCores !== null,
      load,
    };
  }

  private async collectDatabase() {
    const prisma = this.deps.prisma;
    const provider = this.deps.databaseProvider === 'mysql' ? 'mysql' : 'postgresql';
    const now = this.deps.now ?? Date.now;
    const errors: string[] = [];
    const result = {
      provider,
      connected: false,
      latencyMs: null as number | null,
      sizeBytes: null as number | null,
      messages24h: null as number | null,
      instanceRows: null as any[] | null,
      errors,
    };

    if (!prisma) {
      errors.push('banco indisponível');
      return result;
    }

    const startedAt = now();
    const sizeQuery =
      provider === 'mysql'
        ? 'SELECT SUM(data_length + index_length) AS size FROM information_schema.TABLES WHERE table_schema = DATABASE()'
        : 'SELECT pg_database_size(current_database())::bigint AS size';
    const sinceMs = now() - 24 * 60 * 60 * 1000;
    const since = Math.floor(sinceMs / 1000);

    const [size, instances, messages] = await Promise.allSettled([
      withTimeout(prisma.$queryRawUnsafe(sizeQuery), DB_TIMEOUT_MS, 'timeout'),
      withTimeout(
        prisma.instance.groupBy({ by: ['connectionStatus'], _count: { _all: true } }),
        DB_TIMEOUT_MS,
        'timeout',
      ),
      // `id >= cuidFloor` bounds the scan to the rows stored in the last 24h (primary key index); the
      // timestamp filter then drops history imports of old messages
      withTimeout(
        prisma.message.count({ where: { id: { gte: cuidFloor(sinceMs) }, messageTimestamp: { gte: since } } }),
        DB_TIMEOUT_MS,
        'timeout',
      ),
    ]);

    if (size.status === 'fulfilled') {
      result.connected = true;
      result.latencyMs = Math.max(0, now() - startedAt);
      result.sizeBytes = toNumber(firstRow(size.value).size);
    } else errors.push('tamanho');

    if (instances.status === 'fulfilled') {
      result.connected = true;
      result.instanceRows = instances.value;
    } else errors.push('instâncias');

    if (messages.status === 'fulfilled') {
      result.connected = true;
      result.messages24h = toNumber(messages.value);
    } else errors.push('mensagens');

    return result;
  }

  private collectInstances(rows: any[] | null) {
    const stored = rows ? countBy(rows, 'connectionStatus') : null;
    const live: Record<string, number> = {};
    let liveTotal = 0;

    try {
      for (const instance of Object.values(this.deps.waInstances?.() ?? {})) {
        const state = String(instance?.connectionStatus?.state ?? 'close');
        live[state] = (live[state] ?? 0) + 1;
        liveTotal++;
      }
    } catch {
      // the monitor is optional: fall back to the database
    }

    // The monitor holds the live state of the loaded instances; the database also knows the ones not loaded
    const storedTotal = stored ? Object.values(stored).reduce((total, value) => total + value, 0) : null;
    const total = storedTotal === null ? (liveTotal ? liveTotal : null) : Math.max(storedTotal, liveTotal);
    const source = liveTotal ? live : stored;
    const open = source?.open ?? 0;
    const states = source ?? {};
    const detail =
      total === null
        ? 'Sem dados de instâncias'
        : `Abertas ${states.open ?? 0} · conectando ${states.connecting ?? 0} · fechadas ${states.close ?? 0}${
            liveTotal ? ' (estado ao vivo)' : ' (estado salvo)'
          }`;

    return { total, open, detail };
  }

  private async collectSessions() {
    const prisma = this.deps.prisma;
    const empty = { active: null, humanPaused: null, manualPaused: null, detail: undefined, error: false };
    if (!prisma) return { ...empty, error: true };

    const provider = this.deps.databaseProvider === 'mysql' ? 'mysql' : 'postgresql';
    const pauseQuery =
      provider === 'mysql'
        ? "SELECT SUM(JSON_EXTRACT(parameters, '$.humanLastMessageAt') IS NOT NULL) AS human, " +
          // JSON_UNQUOTE gives 'true' for the JSON boolean (comparing JSON true with the SQL TRUE literal,
          // an integer, is not reliable across MySQL versions); same semantics as ->> 'true' on Postgres
          "SUM(status = 'paused' AND JSON_UNQUOTE(JSON_EXTRACT(parameters, '$.manualPause')) = 'true') AS manual " +
          "FROM IntegrationSession WHERE status IN ('paused', 'opened')"
        : 'SELECT COUNT(*) FILTER (WHERE "parameters"->>\'humanLastMessageAt\' IS NOT NULL)::int AS human, ' +
          "COUNT(*) FILTER (WHERE \"status\" = 'paused' AND \"parameters\"->>'manualPause' = 'true')::int AS manual " +
          'FROM "IntegrationSession" WHERE "status" IN (\'paused\', \'opened\')';

    const [byStatus, pauses] = await Promise.allSettled([
      withTimeout(
        prisma.integrationSession.groupBy({ by: ['status'], _count: { _all: true } }),
        DB_TIMEOUT_MS,
        'timeout',
      ),
      withTimeout(prisma.$queryRawUnsafe(pauseQuery), DB_TIMEOUT_MS, 'timeout'),
    ]);

    if (byStatus.status === 'rejected') return { ...empty, error: true };

    const counts = countBy(byStatus.value, 'status');
    const opened = counts.opened ?? 0;
    const paused = counts.paused ?? 0;
    const closed = counts.closed ?? 0;
    const row = pauses.status === 'fulfilled' ? firstRow(pauses.value) : null;

    return {
      active: opened + paused,
      humanPaused: row ? toNumber(row.human) : null,
      manualPaused: row ? toNumber(row.manual) : null,
      detail: `Abertas ${opened} · pausadas ${paused} · encerradas ${closed}`,
      error: pauses.status === 'rejected',
    };
  }

  private async collectCache(): Promise<{ resource: Resource; problem?: string }> {
    const cache = this.deps.cache;

    if (cache?.redisEnabled) {
      let state: RedisState = { state: 'absent' };
      try {
        state = cache.redisState
          ? await withTimeout(cache.redisState(), CACHE_TIMEOUT_MS, 'timeout')
          : { state: 'absent' };
      } catch {
        state = { state: 'down' };
      }

      const labels: Record<RedisState['state'], string> = {
        ready: 'conectado',
        connecting: 'reconectando',
        down: 'sem resposta',
        absent: 'não iniciado',
      };

      return {
        resource: {
          id: 'cache',
          name: 'Cache',
          type: 'Redis',
          status: labels[state.state],
          detail:
            typeof state.latencyMs === 'number' ? `Ping em ${state.latencyMs} ms` : 'Cache de instâncias e sessões',
        },
        problem: state.state === 'ready' ? undefined : 'O cache Redis está habilitado mas não respondeu.',
      };
    }

    return {
      resource: {
        id: 'cache',
        name: 'Cache',
        type: cache?.localEnabled ? 'Local (memória)' : 'Desligado',
        status: cache?.localEnabled ? 'ativo' : 'desligado',
      },
    };
  }

  /**
   * Time (ms) of the last message received (fromMe false) by each instance in the last 7 days, computed on
   * request from the database; null when it cannot be read. Only timestamps per instance id.
   */
  private async collectLastReceived(): Promise<Map<string, number> | null> {
    const d = this.deps;
    const groupBy = d.prisma?.message?.groupBy;
    if (!groupBy) return null;

    const now = d.now ?? Date.now;
    const sinceMs = now() - LAST_RECEIVED_WINDOW_MS;
    const fromMePath = d.databaseProvider === 'mysql' ? '$.fromMe' : ['fromMe'];

    try {
      const rows = await withTimeout(
        groupBy({
          by: ['instanceId'],
          where: { id: { gte: cuidFloor(sinceMs) }, key: { path: fromMePath, equals: false } },
          _max: { messageTimestamp: true },
        }),
        DB_TIMEOUT_MS,
        'timeout',
      );
      const result = new Map<string, number>();
      for (const row of rows ?? []) {
        const seconds = finite(row?._max?.messageTimestamp);
        if (row?.instanceId && seconds) result.set(String(row.instanceId), seconds * 1000);
      }
      return result;
    } catch {
      return null;
    }
  }

  /**
   * "WhatsApp" card: the connection of each instance (live state of this server, or the stored one), the
   * disconnected ones first. Shows only the instance name, the channel and the state: never the phone number,
   * the profile name or the token (the page already requires the global API key, which lists the instances).
   */
  public async collectWhatsapp(): Promise<ProviderView> {
    const d = this.deps;
    const now = d.now ?? Date.now;
    const findMany = d.prisma?.instance?.findMany;
    const view: ProviderView = {
      id: 'whatsapp',
      name: 'WhatsApp',
      description: 'Conexão de cada instância (número)',
      configured: true,
      plan: null,
      status: 'ok',
      updatedAt: new Date(now()).toISOString(),
      metrics: [],
      resources: [],
      notes: [],
      links: [],
    };

    let stored: any[] | null = null;
    if (findMany) {
      try {
        stored = await withTimeout(
          findMany({
            select: {
              id: true,
              name: true,
              connectionStatus: true,
              integration: true,
              disconnectionReasonCode: true,
              disconnectionAt: true,
            },
            orderBy: { name: 'asc' },
            take: WHATSAPP_MAX_INSTANCES,
          }),
          DB_TIMEOUT_MS,
          'timeout',
        );
      } catch {
        stored = null;
      }
    }

    const lastReceived = await this.collectLastReceived();

    let live: Record<string, any> = {};
    try {
      live = d.waInstances?.() ?? {};
    } catch {
      live = {};
    }
    const liveNames = Object.keys(live);

    const byName = new Map<string, any>();
    for (const row of stored ?? []) if (row?.name) byName.set(row.name, { ...row });
    for (const name of liveNames) if (!byName.has(name)) byName.set(name, { name });

    if (stored === null && liveNames.length === 0) {
      return {
        ...view,
        status: 'partial',
        notes: ['Não foi possível ler as instâncias agora.'],
      };
    }

    const order: Record<string, number> = { close: 0, connecting: 1, open: 2 };
    const items = [...byName.values()].map((row) => {
      const instance = live[row.name];
      const state = String(instance?.connectionStatus?.state ?? row.connectionStatus ?? 'close');
      const reason = finite(instance?.connectionStatus?.statusReason) ?? finite(row.disconnectionReasonCode);
      return { row, state: state in order ? state : 'close', reason, loaded: Boolean(instance) };
    });
    items.sort((a, b) => order[a.state] - order[b.state] || String(a.row.name).localeCompare(String(b.row.name)));

    const open = items.filter((item) => item.state === 'open').length;
    const notOpen = items.length - open;

    view.metrics.push(
      buildMetric('connected', 'Instâncias conectadas', open, items.length || null, 'count', {
        detail: items.length
          ? `${notOpen} sem conexão · ${liveNames.length} carregada(s) neste servidor`
          : 'Nenhuma instância criada',
        status: notOpen ? 'warning' : 'ok',
        higherIsBetter: true,
      }),
    );

    view.resources = items.slice(0, WHATSAPP_MAX_RESOURCES).map(({ row, state, reason, loaded }) => ({
      id: String(row.id ?? row.name),
      name: String(row.name),
      type: channelLabel(row.integration ?? live[row.name]?.integration),
      status: state === 'open' ? 'conectada' : state === 'connecting' ? 'conectando' : 'desconectada',
      ...(row.id ? { url: `/manager/instance/${encodeURIComponent(row.id)}/dashboard` } : {}),
      detail: [
        state === 'close' && row.disconnectionAt ? `desde ${formatShortDate(row.disconnectionAt)}` : null,
        state === 'close' && reason !== null ? disconnectReason(reason) : null,
        state === 'connecting' ? 'aguardando QR code ou reconexão' : null,
        liveNames.length && !loaded ? 'não carregada neste servidor (estado salvo)' : null,
        state === 'open' && lastReceived ? lastReceivedLabel(lastReceived.get(String(row.id)), now()) : null,
      ]
        .filter(Boolean)
        .join(' · '),
    }));

    if (notOpen) {
      view.status = 'partial';
      view.notes.push(
        `${notOpen} instância(s) sem conexão: abra a instância no painel e leia o QR code de novo se a sessão foi encerrada.`,
      );
    }
    // #2647: an instance can stay "open" while WhatsApp stops delivering its messages; restarting it fixes it
    if (lastReceived) {
      const quiet = items.filter(({ row, state }) => {
        if (state !== 'open' || !row.id) return false;
        const at = lastReceived.get(String(row.id));
        return !at || now() - at > QUIET_INSTANCE_MS;
      }).length;
      if (quiet) {
        view.notes.push(
          `${quiet} instância(s) conectada(s) sem mensagem recebida há mais de 24 h. Se clientes estão escrevendo, reinicie a instância (pode estar conectada mas sem receber eventos).`,
        );
      }
    }
    if (items.length > WHATSAPP_MAX_RESOURCES) {
      view.notes.push(`Mostrando ${WHATSAPP_MAX_RESOURCES} de ${items.length} instâncias (as sem conexão primeiro).`);
    }
    if (stored === null) {
      view.status = 'partial';
      view.notes.push('Banco indisponível: mostrando só as instâncias carregadas neste servidor.');
    }

    return view;
  }

  public hasUsage(): boolean {
    return typeof this.deps.usage === 'function';
  }

  /**
   * "Plano e uso" card: AI answers of the month per instance against its franchise. A metric reaches the overview
   * alerts at the alertPercent of the instance and turns critical at 100% (then the excedente is in the notes).
   */
  public async collectUsage(): Promise<ProviderView> {
    const now = this.deps.now ?? Date.now;
    const items = await withTimeout(this.deps.usage?.() ?? Promise.resolve([]), DB_TIMEOUT_MS, 'timeout');
    const view: ProviderView = {
      id: 'usage',
      name: 'Plano e uso',
      description: 'Respostas da IA no mês, por instância',
      configured: true,
      plan: null,
      status: 'ok',
      updatedAt: new Date(now()).toISOString(),
      metrics: [],
      resources: [],
      notes: [],
      links: [],
    };

    view.metrics = items.slice(0, USAGE_MAX_METRICS).map((item) =>
      buildMetric(`usage:${item.name}`, `Respostas da IA · ${item.name}`, item.responses, item.limit, 'count', {
        warnAt: item.alertPercent,
        criticalAt: 100,
        alertAt: item.limit ? item.alertPercent : undefined,
        detail: item.limit
          ? `${item.planName ? `Plano ${item.planName} · ` : ''}${formatNumber(item.responses, 0)} de ${formatNumber(
              item.limit,
              0,
            )} em ${item.period}${item.excedente ? ` · excedente ${formatNumber(item.excedente, 0)}` : ''}`
          : `Sem limite configurado · ${formatNumber(item.responses, 0)} em ${item.period}`,
      }),
    );

    for (const item of items) {
      if (item.limit && item.excedente > 0) {
        view.notes.push(
          `${item.name}: franquia esgotada, ${formatNumber(item.excedente, 0)} respostas de excedente ` +
            `(${item.blocks1000} bloco(s) de 1.000).`,
        );
      }
    }
    if (!items.length) view.notes.push('Nenhuma resposta da IA neste mês e nenhum plano configurado.');
    if (this.deps.leads) {
      try {
        const leads = await withTimeout(this.deps.leads(), DB_TIMEOUT_MS, 'timeout');
        for (const item of (leads ?? []).slice(0, USAGE_MAX_METRICS)) {
          view.notes.push(
            `Leads · ${item.name}: ${formatNumber(item.newToday, 0)} novos nas últimas 24 h, ` +
              `${formatNumber(item.qualified7d, 0)} qualificados em 7 dias, ${formatNumber(item.awaiting, 0)} aguardando equipe.`,
          );
        }
      } catch {
        // optional line: the card stays as it is
      }
    }
    if (items.length > USAGE_MAX_METRICS)
      view.notes.push(`Mostrando ${USAGE_MAX_METRICS} de ${items.length} instâncias.`);
    if (worstStatus(view.metrics) === 'critical') view.status = 'partial';

    return view;
  }
}

export const USAGE_MAX_METRICS = 50;

const WHATSAPP_MAX_INSTANCES = 500;
/** Window of the "last message received" lookup (bounded by the cuid primary key, like the 24h count). */
const LAST_RECEIVED_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const QUIET_INSTANCE_MS = 24 * 60 * 60 * 1000;

function lastReceivedLabel(at: number | undefined, now: number): string {
  if (!at) return 'nenhuma mensagem recebida em 7 dias';
  const minutes = Math.max(0, Math.floor((now - at) / 60_000));
  if (minutes < 60) return `última mensagem recebida há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `última mensagem recebida há ${hours} h`;
  return `última mensagem recebida há ${Math.floor(hours / 24)} dias`;
}
const WHATSAPP_MAX_RESOURCES = 50;

function channelLabel(integration: unknown): string {
  const value = String(integration ?? '').toUpperCase();
  if (value === 'WHATSAPP-BUSINESS') return 'Cloud API (Meta)';
  if (value === 'EVOLUTION') return 'Evolution';
  return 'WhatsApp Web';
}

/** Baileys DisconnectReason codes in words an operator understands. */
function disconnectReason(code: number): string {
  const reasons: Record<number, string> = {
    401: 'sessão encerrada no celular: leia o QR code de novo',
    403: 'número bloqueado ou banido pelo WhatsApp',
    408: 'conexão perdida (tempo esgotado)',
    411: 'aparelho incompatível com multi-dispositivo',
    428: 'conexão encerrada pelo WhatsApp',
    440: 'aberta em outro lugar (sessão substituída)',
    500: 'sessão inválida: leia o QR code de novo',
    503: 'WhatsApp indisponível no momento',
    515: 'reinício necessário',
  };
  return reasons[code] ?? `código ${code}`;
}

function formatShortDate(value: unknown): string {
  const time = value instanceof Date ? value.getTime() : Date.parse(String(value ?? ''));
  if (!Number.isFinite(time)) return '—';
  return new Date(time).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
