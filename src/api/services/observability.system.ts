/**
 * Local "Sistema" provider of the observability overview: always available, needs no external API key.
 *
 * Reads only aggregated numbers about this process, its container (cgroup), the database and the WhatsApp
 * instances. Never returns personal data (no phone numbers, contact names, messages or instance names).
 */
import fs from 'node:fs';
import os from 'node:os';

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

const DB_TIMEOUT_MS = 5_000;
const CACHE_TIMEOUT_MS = 2_000;
const CPU_SAMPLE_MS = 250;
/** cgroup v1 reports "unlimited" as a huge number (close to 2^63). */
const UNLIMITED_BYTES = 2 ** 60;

type CpuSample = { usage: NodeJS.CpuUsage; at: number };

export type RedisState = { state: 'ready' | 'connecting' | 'down' | 'absent'; latencyMs?: number | null };

export type PrismaLike = {
  $queryRawUnsafe: (query: string) => Promise<any>;
  instance: { groupBy: (args: any) => Promise<any[]> };
  message: { count: (args: any) => Promise<number> };
  integrationSession: { groupBy: (args: any) => Promise<any[]> };
};

export type SystemDeps = {
  prisma?: PrismaLike | null;
  /** In-memory instances of the WAMonitoringService (live connection state). */
  waInstances?: () => Record<string, any> | null | undefined;
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

/** Container memory limit/usage from cgroup v2 or v1; null when not running under a limited cgroup. */
export function readCgroupMemory(readFile: (path: string) => string | null): {
  limit: number | null;
  current: number | null;
} {
  const parse = (value: string | null): number | null => {
    if (!value || value === 'max') return null;
    const n = Number(value);
    return Number.isFinite(n) && n > 0 && n < UNLIMITED_BYTES ? n : null;
  };

  const v2Limit = readFile('/sys/fs/cgroup/memory.max');
  if (v2Limit !== null) {
    return { limit: parse(v2Limit), current: parse(readFile('/sys/fs/cgroup/memory.current')) };
  }

  return {
    limit: parse(readFile('/sys/fs/cgroup/memory/memory.limit_in_bytes')),
    current: parse(readFile('/sys/fs/cgroup/memory/memory.usage_in_bytes')),
  };
}

/** CPU cores available to the container from cgroup v2 (`cpu.max`) or v1 (CFS quota); null when unlimited. */
export function readCgroupCpuLimit(readFile: (path: string) => string | null): number | null {
  const v2 = readFile('/sys/fs/cgroup/cpu.max');
  if (v2) {
    const [quota, period] = v2.split(/\s+/);
    if (quota === 'max') return null;
    const cores = Number(quota) / Number(period || 100000);
    return Number.isFinite(cores) && cores > 0 ? cores : null;
  }

  const quota = Number(readFile('/sys/fs/cgroup/cpu/cpu.cfs_quota_us'));
  const period = Number(readFile('/sys/fs/cgroup/cpu/cpu.cfs_period_us'));
  if (!Number.isFinite(quota) || quota <= 0 || !Number.isFinite(period) || period <= 0) return null;
  return quota / period;
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
      { detail: instances.detail, status: instanceStatus },
    );

    const metrics: Metric[] = [
      memoryMetric,
      cpuMetric,
      instancesMetric,
      buildMetric('messages_24h', 'Mensagens (24h)', database.messages24h, null, 'count', {
        detail: 'Mensagens salvas no banco nas últimas 24 horas',
      }),
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
    const since = Math.floor(now() / 1000) - 24 * 60 * 60;

    const [size, instances, messages] = await Promise.allSettled([
      withTimeout(prisma.$queryRawUnsafe(sizeQuery), DB_TIMEOUT_MS, 'timeout'),
      withTimeout(
        prisma.instance.groupBy({ by: ['connectionStatus'], _count: { _all: true } }),
        DB_TIMEOUT_MS,
        'timeout',
      ),
      withTimeout(prisma.message.count({ where: { messageTimestamp: { gte: since } } }), DB_TIMEOUT_MS, 'timeout'),
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
          "SUM(status = 'paused' AND JSON_EXTRACT(parameters, '$.manualPause') = true) AS manual " +
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
}
