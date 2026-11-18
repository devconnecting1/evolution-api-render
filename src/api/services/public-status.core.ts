/**
 * Status público do WhatsAI (sem chave): estado atual, 90 dias de disponibilidade e incidentes.
 *
 * Princípios (plano grátis do Neon, ~100 CU-h/mês):
 * - O banco nunca fica acordado por causa desta página. A saúde do banco vem primeiro das consultas que a própria
 *   aplicação acabou de fazer (sinal em memória), depois do estado do endpoint na API de controle do Neon (que não
 *   liga o compute) e, só se nada disso existir, de um SELECT 1 no máximo a cada 30 minutos.
 * - Histórico e incidentes ficam no Redis (chave com TTL, formato compacto). Sem Redis, vão para o GlobalSetting
 *   no máximo a cada 30 minutos e só quando o banco já está acordado.
 * - O registro roda em memória a cada 5 minutos enquanto o processo está de pé; /status/ping e o monitor externo
 *   (ops/status-monitor) não tocam banco nem gravam no Redis.
 * - Tudo o que aparece vem de um sinal real. O que ninguém observou aparece como "Sem dados" e conta contra a
 *   cobertura, nunca como disponível.
 * - Nada de nomes de instância, números, mensagens, chaves ou textos de commit.
 */
import type { KeyHealth } from '@utils/openai-health';

import {
  BUCKET_MS,
  bucketStart,
  DAY_MS,
  dayKey,
  emptyStore,
  HISTORY_BUCKET_DAYS,
  HISTORY_BUCKETS,
  HISTORY_DAYS,
  mergeStores,
  normalizeStore,
  pruneStore,
  recordSample,
  StatusStore,
  StoredIncident,
  summarizeDay,
} from './status/history';
import {
  ago,
  aiErrorLabel,
  bytesLabel,
  checkSite,
  decimal,
  defaultComponent,
  describeIncident,
  FetchLike,
  fetchNeon,
  fetchRender,
  fetchUpstream,
  fetchVercel,
  humanDuration,
  IncidentType,
  NeonSignal,
  PublicState,
  renderDeployFailed,
  RenderSignal,
  restartCause,
  Severity,
  SEVERITY_OF,
  shortDateTime,
  shortTime,
  SiteCheck,
  STATE_RANK,
  UPSTREAM_SOURCES,
  UpstreamSource,
  UpstreamStatus,
  VercelSignal,
  worst,
} from './status/signals';

export type { PublicState } from './status/signals';

export const TICK_MS = 5 * 60_000;
/** Provedores (Render, Neon, Vercel, terceiros, HEAD do site): no máximo uma leitura a cada 5 min... */
export const PROVIDER_TTL_MS = 5 * 60_000;
/** ...e só enquanto alguém olha o status ou o monitor externo faz o ping. */
export const TRAFFIC_WINDOW_MS = 10 * 60_000;
/** SELECT 1 no banco: no máximo a cada 30 min, e só quando não há sinal melhor. */
export const DB_PROBE_INTERVAL_MS = 30 * 60_000;
/** Uma consulta bem-sucedida da aplicação há menos que isto conta como banco saudável. */
export const DB_RECENT_MS = 30 * 60_000;
const DB_PROBE_TIMEOUT_MS = 5_000;
const RESPONSE_CACHE_MS = 30_000;
const PROVIDER_WAIT_MS = 6_000;
/** Uma queda do WhatsApp só vira incidente depois disto (reconexões rápidas são normais). */
const WHATSAPP_DEBOUNCE_MS = 3 * 60_000;
const AI_WINDOW_MS = 24 * 3_600_000;
const AI_TRANSIENT_MS = 30 * 60_000;
const TRANSIENT_AI = new Set(['rate_limited', 'network', 'server_error']);

export type ComponentGroupId = 'atendimento' | 'plataforma' | 'terceiros';

export type PublicComponent = {
  id: string;
  name: string;
  description: string;
  state: PublicState;
  detail: string;
  checkedAt: string | null;
  link?: string;
  uptime90: number | null;
  coverage90: number;
  incidents?: { name: string; url: string | null }[];
};

export type PublicGroup = { id: ComponentGroupId; name: string; components: PublicComponent[] };
export type PublicBucket = { start: string; coverage: number; components: Record<string, PublicState> };
export type PublicDay = {
  date: string;
  coverage: number;
  components: Record<string, { state: PublicState; uptime: number | null; coverage: number }>;
};
export type PublicIncident = {
  id: string;
  component: string;
  name: string;
  type: IncidentType;
  severity: Severity;
  state: Severity;
  title: string;
  detail: string;
  start: string;
  end: string | null;
  durationSeconds: number;
};

export type PublicStatus = {
  checkedAt: string;
  state: PublicState;
  title: string;
  summary: string;
  version: string | null;
  uptimeSeconds: number;
  groups: PublicGroup[];
  history: PublicBucket[];
  days: PublicDay[];
  incidents: PublicIncident[];
  /** last3d: mesmo valor de last7d, mantido para páginas antigas em cache (a janela agora é de 7 dias). */
  coverage: { last7d: number; last3d: number; last90d: number; since: string | null };
  nextCheckSeconds: number;
  historyDays: number;
  bucketHours: number;
  notes: string[];
};

export type PublicPing = {
  status: 'ok';
  version: string | null;
  uptimeSeconds: number;
  checkedAt: string;
  state: PublicState;
  components: Record<string, PublicState>;
};

export type StatusPersistence = {
  read: () => Promise<unknown>;
  /** Pode recusar (devolve false) quando o meio não aceita a gravação agora. */
  write: (store: StatusStore, now: number) => Promise<boolean>;
};

type InstanceLike = { connectionStatus?: { state?: string }; integration?: string; wuid?: string | null };

export type PublicStatusDeps = {
  now?: () => number;
  version: string | null;
  commit: string | null;
  /** Início do processo (ms). */
  bootAt: number;
  instances: () => Record<string, InstanceLike> | null | undefined;
  openai: () => KeyHealth[];
  /** Última consulta bem-sucedida da aplicação ao banco principal (registro de acordadas), sem tocar no banco. */
  dbLastQueryAt: () => number | null;
  /** SELECT 1 (lança em erro). null = sem banco. */
  dbProbe: (() => Promise<void>) | null;
  /** Erros do banco ao salvar mensagens recebidas (em memória). */
  dbFailures?: () => { lastAt: string | null; lastCode: string | null };
  redis: () => 'ready' | 'connecting' | 'down' | 'off';
  fetcher: FetchLike;
  siteUrl: string | null;
  render?: { apiKey: string; serviceId: string; keyValueId?: string | null } | null;
  neon?: { apiKey: string; projectId: string } | null;
  vercel?: { token: string; projectId: string; teamId?: string | null } | null;
  upstream?: UpstreamSource[];
  persistence: StatusPersistence;
  /** Intervalo mínimo entre gravações do histórico. */
  persistEveryMs?: number;
};

type ComponentDef = { id: string; name: string; description: string; group: ComponentGroupId };

const OWN_COMPONENTS: ComponentDef[] = [
  {
    id: 'whatsapp-web',
    name: 'WhatsApp Web',
    description: 'Conexão por QR code (Baileys e Evolution)',
    group: 'atendimento',
  },
  {
    id: 'whatsapp-cloud',
    name: 'API oficial da Meta',
    description: 'Cloud API para números oficiais',
    group: 'atendimento',
  },
  { id: 'ai', name: 'Respostas da IA', description: 'Chaves OpenAI usadas pelos bots', group: 'atendimento' },
  { id: 'api', name: 'API WhatsAI', description: 'Recepção, envio e automações (Render)', group: 'plataforma' },
  {
    id: 'database',
    name: 'Banco de dados',
    description: 'Conversas, leads, agenda e configurações (Neon)',
    group: 'plataforma',
  },
  { id: 'cache', name: 'Cache', description: 'Redis no Render Key Value', group: 'plataforma' },
  { id: 'site', name: 'Site e painel', description: 'Landing, documentação e painel (Vercel)', group: 'plataforma' },
];
const GROUP_NAMES: Record<ComponentGroupId, string> = {
  atendimento: 'Atendimento',
  plataforma: 'Plataforma',
  terceiros: 'Serviços de terceiros',
};

const STATE_WORD: Record<PublicState, string> = {
  operational: 'Operacional',
  degraded: 'Instabilidade',
  outage: 'Indisponibilidade',
  maintenance: 'Manutenção',
  no_data: 'Sem dados',
};

type Evaluated = {
  at: number;
  components: (PublicComponent & { group: ComponentGroupId })[];
  states: Record<string, PublicState>;
  /** Condições de incidente ativas agora (chave = tipo:componente). */
  conditions: Map<string, { type: IncidentType; component: string; data: Record<string, number | string | null> }>;
};

export class PublicStatusService {
  private store: StatusStore = emptyStore();
  private loaded: Promise<void> | null = null;
  private dirty = false;
  /** A leitura inicial falhou: antes de gravar, lê de novo e junta (nunca apaga o histórico guardado). */
  private loadFailed = false;
  private lastPersistAt = 0;
  private lastSampleAt: number | null = null;
  private lastTrafficAt = 0;
  private timer: NodeJS.Timeout | null = null;
  private response: { at: number; data: PublicStatus } | null = null;
  private building: Promise<PublicStatus> | null = null;

  // Sinais externos (lidos no máximo a cada PROVIDER_TTL_MS, só com tráfego)
  private providersAt = 0;
  private providersRun: Promise<void> | null = null;
  private site: SiteCheck | null = null;
  private siteFailures = 0;
  private render: RenderSignal | null = null;
  private neon: NeonSignal | null = null;
  private vercel: VercelSignal | null = null;
  private upstream: UpstreamStatus[] = [];

  // Banco
  private dbProbe: { at: number; ok: boolean; ms: number | null } | null = null;
  private dbProbeRun: Promise<void> | null = null;

  // WhatsApp: desde quando cada canal está com números fora
  private whatsappDownSince: Record<string, number | null> = { 'whatsapp-web': null, 'whatsapp-cloud': null };
  private bootClassified = false;

  constructor(private readonly deps: PublicStatusDeps) {}

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  // ---------------------------------------------------------------------------------------- lifecycle

  /** Carrega o histórico, registra o reinício e liga o registro a cada 5 min (idempotente). */
  public start(): Promise<void> {
    if (!this.timer) {
      this.timer = setInterval(() => void this.tick().catch(() => undefined), TICK_MS);
      this.timer.unref?.();
    }
    return this.ensureLoaded();
  }

  public stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private ensureLoaded(): Promise<void> {
    if (!this.loaded) {
      this.loaded = (async () => {
        try {
          this.store = normalizeStore(await this.deps.persistence.read());
        } catch {
          this.store = emptyStore();
          this.loadFailed = true;
        }
        this.recordBoot();
      })();
    }
    return this.loaded;
  }

  /**
   * "Reinício da API": o processo começou em bootAt. A lacuna vai do último sinal gravado (seen) até o início. A
   * causa vem dos eventos do Render quando há chave (falta de memória, deploy); sem ela, um commit diferente do
   * processo anterior indica deploy.
   */
  private recordBoot() {
    const bootAt = this.deps.bootAt;
    const previous = this.store.boot;
    if (previous && previous.at === bootAt) return;
    const gapStart = this.store.seen && this.store.seen < bootAt ? this.store.seen : bootAt;
    const gapMinutes = Math.max(0, Math.round((bootAt - gapStart) / 60_000));
    const deployed = Boolean(previous && previous.commit && this.deps.commit && previous.commit !== this.deps.commit);
    const type: IncidentType = deployed ? 'restart_deploy' : 'restart_unknown';
    this.store.incidents.unshift({
      id: `boot-${bootAt}`,
      c: 'api',
      t: type,
      s: SEVERITY_OF[type],
      a: gapStart,
      b: bootAt,
      d: { gapMinutes, version: this.deps.version },
    });
    this.store.boot = { at: bootAt, commit: this.deps.commit, version: this.deps.version };
    this.dirty = true;
  }

  /** Refina o tipo do reinício quando os eventos do Render chegam (OOM, deploy, falha, espera do Free). */
  private classifyBoot() {
    if (this.bootClassified || !this.render || this.render.error) return;
    this.bootClassified = true;
    const incident = this.store.incidents.find((item) => item.id === `boot-${this.deps.bootAt}`);
    if (!incident) return;
    const cause = restartCause(this.render.events, this.deps.bootAt);
    if (cause) {
      incident.t = cause.type;
      incident.s = SEVERITY_OF[cause.type];
      if (cause.detail) incident.d = { ...incident.d, reason: cause.detail };
    } else if (incident.t === 'restart_unknown' && Number(incident.d?.gapMinutes ?? 0) >= 15) {
      // Sem falha nem deploy no Render: o Free pausou o serviço por falta de tráfego
      incident.d = { ...incident.d, sleep: 'yes' };
    }
    this.dirty = true;
  }

  // ------------------------------------------------------------------------------------------ public

  /** GET /status/ping: só memória (sem banco, sem Redis). Também conta como tráfego para os provedores. */
  public ping(): PublicPing {
    const now = this.now();
    this.lastTrafficAt = now;
    void this.refreshProviders(now).catch(() => undefined);
    const evaluated = this.evaluate(now);
    return {
      status: 'ok',
      version: this.deps.version,
      uptimeSeconds: Math.max(0, Math.round((now - this.deps.bootAt) / 1000)),
      checkedAt: new Date(now).toISOString(),
      state: this.overall(evaluated),
      components: evaluated.states,
    };
  }

  /** GET /status: estado + histórico. A resposta é reaproveitada por 30 s (várias abas, picos). */
  public async getStatus(): Promise<PublicStatus> {
    const now = this.now();
    this.lastTrafficAt = now;
    if (this.response && now - this.response.at < RESPONSE_CACHE_MS) return this.response.data;
    if (this.building) return this.building;
    this.building = this.build(now).finally(() => {
      this.building = null;
    });
    return this.building;
  }

  /** Uma passada do registro (a cada 5 min; exposta para os testes). */
  public async tick(): Promise<void> {
    await this.ensureLoaded();
    const now = this.now();
    if (now - this.lastTrafficAt < TRAFFIC_WINDOW_MS) await this.refreshProviders(now).catch(() => undefined);
    this.record(this.evaluate(now));
    await this.persist(now);
  }

  private async build(now: number): Promise<PublicStatus> {
    await this.ensureLoaded();
    await withTimeout(this.refreshProviders(now), PROVIDER_WAIT_MS).catch(() => undefined);
    await this.maybeProbeDatabase(now);
    const evaluated = this.evaluate(this.now());
    this.record(evaluated);
    await this.persist(evaluated.at);
    const data = this.render_(evaluated);
    this.response = { at: evaluated.at, data };
    return data;
  }

  // --------------------------------------------------------------------------------------- providers

  private async refreshProviders(now: number): Promise<void> {
    if (this.providersRun) return this.providersRun;
    if (now - this.providersAt < PROVIDER_TTL_MS) return;
    this.providersAt = now;
    const fetcher = this.deps.fetcher;
    const clock = () => this.now();
    this.providersRun = (async () => {
      const tasks: Promise<unknown>[] = [];
      if (this.deps.siteUrl) {
        tasks.push(
          checkSite(fetcher, this.deps.siteUrl, clock).then((result) => {
            this.siteFailures = result.ok ? 0 : this.siteFailures + 1;
            this.site = result;
          }),
        );
      }
      if (this.deps.render) tasks.push(fetchRender(fetcher, this.deps.render, clock).then((r) => (this.render = r)));
      if (this.deps.neon) tasks.push(fetchNeon(fetcher, this.deps.neon, clock).then((r) => (this.neon = r)));
      if (this.deps.vercel) tasks.push(fetchVercel(fetcher, this.deps.vercel, clock).then((r) => (this.vercel = r)));
      const sources = this.deps.upstream ?? UPSTREAM_SOURCES;
      tasks.push(
        Promise.all(sources.map((source) => fetchUpstream(fetcher, source, clock))).then(
          (list) => (this.upstream = list),
        ),
      );
      await Promise.allSettled(tasks);
      this.classifyBoot();
    })().finally(() => {
      this.providersRun = null;
    });
    return this.providersRun;
  }

  // ---------------------------------------------------------------------------------------- database

  /**
   * O SELECT 1 só roda quando nenhum sinal melhor existe: sem consulta recente da aplicação, sem leitura do
   * endpoint no Neon (que diria "em espera") e com a última sondagem há 30 min ou mais.
   */
  private async maybeProbeDatabase(now: number): Promise<void> {
    if (!this.deps.dbProbe) return;
    const last = this.deps.dbLastQueryAt();
    if (last !== null && now - last < DB_RECENT_MS) return;
    if (this.neon && !this.neon.error && this.neon.endpointState !== 'unknown') return;
    const failedAt = Date.parse(this.deps.dbFailures?.()?.lastAt ?? '');
    if (Number.isFinite(failedAt) && now - failedAt < 10 * 60_000) return;
    if (this.dbProbe && now - this.dbProbe.at < DB_PROBE_INTERVAL_MS) return;
    if (this.dbProbeRun) return this.dbProbeRun;
    const probe = this.deps.dbProbe;
    this.dbProbeRun = (async () => {
      const started = this.now();
      try {
        await withTimeout(probe(), DB_PROBE_TIMEOUT_MS);
        this.dbProbe = { at: started, ok: true, ms: Math.max(0, this.now() - started) };
      } catch {
        this.dbProbe = { at: started, ok: false, ms: null };
      }
    })().finally(() => {
      this.dbProbeRun = null;
    });
    return this.dbProbeRun;
  }

  // -------------------------------------------------------------------------------------- evaluation

  private evaluate(now: number): Evaluated {
    const conditions: Evaluated['conditions'] = new Map();
    const add = (type: IncidentType, component: string, data: Record<string, number | string | null>) =>
      conditions.set(`${type}:${component}`, { type, component, data });
    const at = (ms: number | null | undefined) => (ms ? new Date(ms).toISOString() : null);
    const nowIso = new Date(now).toISOString();
    const list: (PublicComponent & { group: ComponentGroupId })[] = [];
    const push = (def: ComponentDef, state: PublicState, detail: string, checkedAt: string | null, extra = {}) =>
      list.push({ ...def, state, detail, checkedAt, uptime90: null, coverage90: 0, ...extra });

    // WhatsApp (estado ao vivo das instâncias carregadas neste servidor)
    let instances: InstanceLike[];
    try {
      instances = Object.values(this.deps.instances() ?? {}).filter(Boolean);
    } catch {
      instances = [];
    }
    for (const def of OWN_COMPONENTS.slice(0, 2)) {
      const cloud = def.id === 'whatsapp-cloud';
      const mine = instances.filter(
        (item) => (String(item.integration ?? '').toUpperCase() === 'WHATSAPP-BUSINESS') === cloud,
      );
      const open = mine.filter((item) => item.connectionStatus?.state === 'open').length;
      const connecting = mine.filter((item) => item.connectionStatus?.state === 'connecting').length;
      // Um número que nunca leu o QR code ainda está em configuração, não fora do ar
      const closed = mine.filter(
        (item) => !['open', 'connecting'].includes(String(item.connectionStatus?.state)) && item.wuid,
      ).length;
      const total = open + connecting + closed;
      if (!total) {
        this.whatsappDownSince[def.id] = null;
        push(def, 'no_data', 'Nenhum número conectado por este canal', nowIso);
        continue;
      }
      const down = connecting + closed;
      const state: PublicState = down === 0 ? 'operational' : open === 0 ? 'outage' : 'degraded';
      if (down === 0) this.whatsappDownSince[def.id] = null;
      else this.whatsappDownSince[def.id] ??= now;
      const since = this.whatsappDownSince[def.id];
      if (since !== null && now - since >= WHATSAPP_DEBOUNCE_MS) add('whatsapp_disconnected', def.id, { down, total });
      const parts = [`${open} de ${total} conectado${total === 1 ? '' : 's'}`];
      if (connecting) parts.push(`${connecting} reconectando`);
      if (closed) parts.push(`${closed} desconectado${closed === 1 ? '' : 's'}`);
      if (since !== null) parts.push(`desde ${shortTime(since)}`);
      push(def, state, parts.join(' · '), nowIso);
    }

    // Respostas da IA: o acontecimento mais recente de cada chave nas últimas 24 h
    {
      const def = OWN_COMPONENTS[2];
      let keys: KeyHealth[];
      try {
        keys = this.deps.openai() ?? [];
      } catch {
        keys = [];
      }
      let ok = 0;
      let failing = 0;
      let lastOk = 0;
      let lastError: { at: number; kind: string } | null = null;
      let firstFailing = Infinity;
      for (const key of keys) {
        const events: { at: number; ok: boolean; kind?: string }[] = [];
        if (key.lastOkAt) events.push({ at: key.lastOkAt, ok: true });
        if (key.lastError) events.push({ at: key.lastError.at, ok: false, kind: key.lastError.kind });
        if (key.lastTest) {
          const testAt = Date.parse(key.lastTest.checkedAt);
          if (Number.isFinite(testAt))
            events.push({ at: testAt, ok: key.lastTest.verdict === 'ok', kind: key.lastTest.verdict });
        }
        const latest = events.sort((a, b) => b.at - a.at)[0];
        if (!latest || now - latest.at > AI_WINDOW_MS) continue;
        if (latest.ok) {
          ok++;
          lastOk = Math.max(lastOk, latest.at);
        } else if (TRANSIENT_AI.has(String(latest.kind)) && now - latest.at > AI_TRANSIENT_MS) {
          ok++;
        } else {
          failing++;
          firstFailing = Math.min(firstFailing, latest.at);
          if (!lastError || latest.at > lastError.at) lastError = { at: latest.at, kind: String(latest.kind) };
        }
      }
      const total = ok + failing;
      if (!total) {
        push(def, 'no_data', 'Nenhuma resposta da IA nas últimas 24 h', nowIso);
      } else {
        const state: PublicState = failing === 0 ? 'operational' : ok === 0 ? 'outage' : 'degraded';
        const parts = [`${ok} de ${total} chave${total === 1 ? '' : 's'} funcionando`];
        if (lastOk) parts.push(`última resposta ${ago(lastOk, now)}`);
        if (lastError) parts.push(`último erro: ${aiErrorLabel(lastError.kind)} ${ago(lastError.at, now)}`);
        if (failing) add('ai_errors', 'ai', { failing, total, kind: lastError?.kind ?? null });
        push(def, state, parts.join(' · '), nowIso);
        if (failing && Number.isFinite(firstFailing)) this.noteStart(`ai_errors:ai`, firstFailing);
      }
    }

    // API (este processo respondeu) + último deploy no Render
    {
      const def = OWN_COMPONENTS[3];
      const parts = [
        this.deps.version ? `v${this.deps.version}` : null,
        `no ar há ${humanDuration(now - this.deps.bootAt)}`,
      ];
      let state: PublicState = 'operational';
      const render = this.render && !this.render.error ? this.render : null;
      if (render?.deployState) {
        const when = render.deployFinishedAt ? shortDateTime(render.deployFinishedAt) : '';
        if (renderDeployFailed(render)) {
          state = 'degraded';
          add('deploy_failed', 'api', { stage: render.deployState === 'build_failed' ? 'build' : 'deploy' });
          parts.push(`deploy de ${when} falhou (${render.deployState}); versão anterior no ar`);
        } else if (render.deployState === 'live') parts.push(`deploy ${when} ativo`.replace('  ', ' '));
        else parts.push(`deploy ${render.deployState}`);
      }
      push(def, state, parts.filter(Boolean).join(' · '), nowIso);
    }

    // Banco
    list.push({ ...OWN_COMPONENTS[4], ...this.databaseComponent(now, add), uptime90: null, coverage90: 0 });

    // Cache
    {
      const def = OWN_COMPONENTS[5];
      let redis: ReturnType<PublicStatusDeps['redis']>;
      try {
        redis = this.deps.redis();
      } catch {
        redis = 'down';
      }
      const kv = this.render?.keyValue ?? null;
      if (redis === 'off') push(def, 'no_data', 'Redis desligado neste servidor (cache local em memória)', nowIso);
      else {
        let state: PublicState = redis === 'ready' ? 'operational' : 'degraded';
        const parts = [redis === 'ready' ? 'Conectado' : redis === 'connecting' ? 'Reconectando' : 'Sem resposta'];
        if (kv?.memoryUsed != null && kv.memoryLimit) {
          const pct = (kv.memoryUsed / kv.memoryLimit) * 100;
          parts.push(`memória ${bytesLabel(kv.memoryUsed)} de ${bytesLabel(kv.memoryLimit)} (${Math.round(pct)}%)`);
          if (pct >= 90 && state === 'operational') state = 'degraded';
        }
        push(def, state, parts.join(' · '), nowIso);
      }
    }

    // Site e painel: HEAD real + último deploy de produção na Vercel
    {
      const def = OWN_COMPONENTS[6];
      const site = this.site;
      if (!site && !this.vercel) push(def, 'no_data', 'Ainda sem verificação do site', null);
      else {
        let state: PublicState = 'no_data';
        const parts: string[] = [];
        if (site) {
          if (site.ok) {
            state = 'operational';
            parts.push(`Respondeu em ${site.ms ?? '?'} ms ${ago(site.at, now)}`);
          } else {
            state = this.siteFailures >= 2 ? 'outage' : 'degraded';
            parts.push(`Falhou ${ago(site.at, now)} (${site.error ?? 'sem resposta'})`);
            if (this.siteFailures >= 2) add('site_down', 'site', { reason: site.error ?? null });
          }
        }
        const vercel = this.vercel && !this.vercel.error ? this.vercel : null;
        if (vercel && vercel.state !== 'unknown') {
          const when = vercel.createdAt ? shortDateTime(vercel.createdAt) : '';
          const word = { ready: 'ativo', error: 'falhou', building: 'em build', canceled: 'cancelado' }[vercel.state];
          parts.push(`deploy de produção ${when} ${word}`.replace('  ', ' '));
          if (vercel.state === 'error' && state === 'operational') state = 'degraded';
        }
        push(def, state, parts.join(' · '), at(site?.at ?? this.vercel?.at));
      }
    }

    // Serviços de terceiros (páginas de status públicas)
    for (const item of this.upstream) {
      const def: ComponentDef = {
        id: item.id,
        name: item.name,
        description: `Página de status de ${item.name}`,
        group: 'terceiros',
      };
      const incidents = item.incidents.map((incident) => ({ name: incident.name, url: incident.url }));
      const detail = item.error
        ? `Página de status sem resposta (${item.error})`
        : incidents.length
          ? incidents.map((incident) => incident.name).join(' · ')
          : item.label;
      if (!item.error && item.state !== 'operational' && item.incidents[0]) {
        add('upstream_incident', item.id, { provider: item.name, name: item.incidents[0].name });
      }
      push(def, item.state, detail, at(item.checkedAt), { link: item.page, incidents });
    }

    const states: Record<string, PublicState> = {};
    for (const component of list) states[component.id] = component.state;
    return { at: now, components: list, states, conditions };
  }

  private databaseComponent(
    now: number,
    add: (type: IncidentType, component: string, data: Record<string, number | string | null>) => void,
  ): { state: PublicState; detail: string; checkedAt: string | null } {
    const parts: string[] = [];
    let state: PublicState = 'no_data';
    let checkedAt: number | null = null;

    const failures = this.deps.dbFailures?.();
    const failureAt = failures?.lastAt ? Date.parse(failures.lastAt) : NaN;
    const recentFailure = Number.isFinite(failureAt) && now - failureAt < 10 * 60_000;
    const last = this.deps.dbLastQueryAt();
    const neon = this.neon && !this.neon.error ? this.neon : null;

    if (last !== null && now - last < DB_RECENT_MS && (!recentFailure || last > failureAt)) {
      state = 'operational';
      checkedAt = last;
      parts.push(`Última consulta da aplicação ${ago(last, now)}`);
    } else if (recentFailure) {
      state = 'outage';
      checkedAt = failureAt;
      parts.push(`Erro ao gravar ${ago(failureAt, now)}${failures?.lastCode ? ` (${failures.lastCode})` : ''}`);
    } else if (neon && neon.endpointState !== 'unknown') {
      checkedAt = neon.at;
      if (neon.endpointState === 'active') {
        state = 'operational';
        parts.push('Compute ligado');
      } else if (!neon.suspendedForQuota) {
        state = 'operational';
        parts.push(
          `Em espera${neon.lastActiveAt ? ` desde ${shortTime(neon.lastActiveAt)}` : ''} (liga na primeira consulta)`,
        );
      }
    } else if (this.dbProbe) {
      checkedAt = this.dbProbe.at;
      state = this.dbProbe.ok ? 'operational' : 'outage';
      parts.push(
        this.dbProbe.ok
          ? `Consulta em ${this.dbProbe.ms} ms ${ago(this.dbProbe.at, now)}`
          : `Sem resposta ${ago(this.dbProbe.at, now)}`,
      );
    }

    if (neon?.computeCuHours != null) {
      const limit = neon.computeLimit;
      parts.push(
        `compute ${decimal(neon.computeCuHours)}${limit ? ` de ${limit}` : ''} CU-h${
          neon.projectedCuHours != null ? `, projeção ${Math.round(neon.projectedCuHours)}` : ''
        }`,
      );
      if (neon.suspendedForQuota) {
        state = 'outage';
        add('db_suspended_quota', 'database', { used: round1(neon.computeCuHours), limit, periodEnd: neon.periodEnd });
      } else if (
        limit &&
        neon.daysToLimit !== null &&
        neon.projectedCuHours !== null &&
        neon.projectedCuHours > limit
      ) {
        if (STATE_RANK[state] < STATE_RANK.degraded) state = 'degraded';
        add('db_quota_risk', 'database', {
          used: round1(neon.computeCuHours),
          limit,
          projected: Math.round(neon.projectedCuHours),
          days: Math.max(1, Math.round(neon.daysToLimit)),
        });
        parts.push(`pode ser suspenso em ~${Math.max(1, Math.round(neon.daysToLimit))} dias`);
      }
      if (neon.storageBytes && neon.storageLimit) {
        parts.push(`armazenamento ${bytesLabel(neon.storageBytes)} de ${bytesLabel(neon.storageLimit)}`);
      }
      if (neon.egressBytes != null && neon.egressLimit) {
        parts.push(`egress ${bytesLabel(neon.egressBytes)} de ${bytesLabel(neon.egressLimit)}`);
      }
    }
    if (!parts.length) parts.push('Sem consulta recente; a página não acorda o banco só para verificar');
    return {
      state,
      detail: capitalize(parts.join(' · ')),
      checkedAt: checkedAt ? new Date(checkedAt).toISOString() : null,
    };
  }

  private readonly pendingStarts = new Map<string, number>();
  private noteStart(key: string, at: number) {
    this.pendingStarts.set(key, at);
  }

  private overall(evaluated: Evaluated): PublicState {
    const own = evaluated.components.filter((item) => item.group !== 'terceiros').map((item) => item.state);
    return worst(own);
  }

  // ------------------------------------------------------------------------------------------ record

  private record(evaluated: Evaluated) {
    const now = evaluated.at;
    recordSample(this.store, evaluated.states, this.lastSampleAt, now);
    this.lastSampleAt = now;
    this.store.seen = now;

    // Abre, atualiza e fecha incidentes pelas condições ativas
    const open = this.store.incidents.filter((item) => item.b === null);
    for (const [key, condition] of evaluated.conditions) {
      const existing = open.find((item) => `${item.t}:${item.c}` === key);
      if (existing) {
        existing.d = { ...existing.d, ...condition.data };
        continue;
      }
      const start =
        condition.type === 'whatsapp_disconnected'
          ? (this.whatsappDownSince[condition.component] ?? now)
          : (this.pendingStarts.get(key) ?? now);
      this.store.incidents.unshift({
        id: `${condition.component}-${condition.type}-${start}`.slice(0, 60),
        c: condition.component || defaultComponent(condition.type),
        t: condition.type,
        s: SEVERITY_OF[condition.type],
        a: Math.min(start, now),
        b: null,
        d: condition.data,
      });
    }
    for (const item of open) {
      if (!evaluated.conditions.has(`${item.t}:${item.c}`)) item.b = now;
    }
    pruneStore(this.store, now);
    this.dirty = true;
  }

  private async persist(now: number) {
    if (!this.dirty) return;
    const every = this.deps.persistEveryMs ?? 10 * 60_000;
    const changedIncident = this.store.incidents.some(
      (item) => item.a > this.lastPersistAt || (item.b ?? 0) > this.lastPersistAt,
    );
    if (this.lastPersistAt && now - this.lastPersistAt < every && !changedIncident) return;
    try {
      if (this.loadFailed) {
        this.store = mergeStores(normalizeStore(await this.deps.persistence.read()), this.store);
        this.loadFailed = false;
      }
      if (await this.deps.persistence.write(this.store, now)) {
        this.lastPersistAt = now;
        this.dirty = false;
      }
    } catch {
      // o histórico continua em memória; a próxima passada tenta de novo
    }
  }

  // ------------------------------------------------------------------------------------------ output

  private render_(evaluated: Evaluated): PublicStatus {
    const now = evaluated.at;
    const days = this.publicDays(now, evaluated);
    const uptimeOf = (id: string) => {
      let covered = 0;
      let out = 0;
      for (const day of this.store.days) {
        const cell = day.c[id];
        if (!cell) continue;
        covered += cell[0] + cell[1] + cell[2] + cell[3];
        out += cell[2];
      }
      const period = Math.max(1, Math.min(HISTORY_DAYS * DAY_MS, now - this.oldestData(now)) / 1000);
      return {
        uptime90: covered ? Math.round(((covered - out) / covered) * 10000) / 100 : null,
        coverage90: Math.min(100, Math.round((covered / period) * 1000) / 10),
      };
    };

    const groups: PublicGroup[] = (['atendimento', 'plataforma', 'terceiros'] as ComponentGroupId[])
      .map((id) => ({
        id,
        name: GROUP_NAMES[id],
        components: evaluated.components
          .filter((component) => component.group === id)
          .map((component) => {
            const { group, ...rest } = component;
            void group;
            return { ...rest, ...uptimeOf(component.id) };
          }),
      }))
      .filter((group) => group.components.length);

    const state = this.overall(evaluated);
    const { title, summary } = this.headline(evaluated, state);
    const history = this.publicHistory(now);
    const coverage7d = history.reduce((total, bucket) => total + bucket.coverage, 0) / Math.max(1, history.length);
    const oldest = this.oldestData(now);
    const period90 = Math.max(1, Math.min(HISTORY_DAYS * DAY_MS, now - oldest));
    const covered90 = this.store.days.reduce((total, day) => total + dayCoverageSeconds(day, 'api'), 0) * 1000;

    return {
      checkedAt: new Date(now).toISOString(),
      state,
      title,
      summary,
      version: this.deps.version,
      uptimeSeconds: Math.max(0, Math.round((now - this.deps.bootAt) / 1000)),
      groups,
      history,
      days,
      incidents: this.publicIncidents(now, evaluated),
      coverage: {
        last7d: Math.round(coverage7d * 10) / 10,
        last3d: Math.round(coverage7d * 10) / 10,
        last90d: Math.min(100, Math.round((covered90 / period90) * 1000) / 10),
        since: this.store.days.length ? `${this.store.days[0].d}T00:00:00.000Z` : null,
      },
      nextCheckSeconds: TICK_MS / 1000,
      historyDays: HISTORY_BUCKET_DAYS,
      bucketHours: 3,
      notes: [
        'A API registra o estado a cada 5 minutos enquanto está no ar; períodos sem registro aparecem como “Sem dados” e reduzem a cobertura.',
        'O banco não é acordado por esta página: a saúde vem das consultas da própria aplicação, do estado do endpoint no Neon ou de uma sondagem a cada 30 minutos no máximo.',
        'Serviços de terceiros vêm das páginas de status públicas de cada provedor. A Meta não publica um JSON de status e fica de fora.',
        'Nenhum nome de cliente, número, mensagem ou chave é publicado nesta página.',
      ],
    };
  }

  private oldestData(now: number): number {
    const first = this.store.days[0]?.d;
    return first ? Date.parse(`${first}T00:00:00.000Z`) : now;
  }

  private headline(evaluated: Evaluated, state: PublicState): { title: string; summary: string } {
    const own = evaluated.components.filter((item) => item.group !== 'terceiros');
    const bad = own.filter((item) => STATE_RANK[item.state] >= STATE_RANK.maintenance);
    const third = evaluated.components.filter(
      (item) => item.group === 'terceiros' && STATE_RANK[item.state] >= STATE_RANK.maintenance,
    );
    const thirdText = third.length
      ? ` Terceiros: ${third.map((item) => `${item.name} com ${STATE_WORD[item.state].toLowerCase()}`).join(', ')}.`
      : '';
    const checked = own.filter((item) => item.state !== 'no_data').length;
    if (state === 'no_data') {
      return { title: 'Sem dados suficientes', summary: `Nenhum componente com leitura agora.${thirdText}` };
    }
    if (!bad.length) {
      return {
        title: 'Todos os sistemas operacionais',
        summary: `${checked} de ${own.length} componentes verificados agora estão funcionando.${thirdText}`,
      };
    }
    const top = [...bad].sort((a, b) => STATE_RANK[b.state] - STATE_RANK[a.state])[0];
    const title =
      bad.length === 1
        ? `${STATE_WORD[top.state]} em ${top.name}`
        : `${STATE_WORD[top.state]} em ${top.name} e mais ${bad.length - 1} componente${bad.length > 2 ? 's' : ''}`;
    return { title, summary: `${top.name}: ${top.detail}.${thirdText}` };
  }

  private publicHistory(now: number): PublicBucket[] {
    const current = bucketStart(now);
    const byStart = new Map(this.store.buckets.map((item) => [item.t, item]));
    const result: PublicBucket[] = [];
    for (let i = HISTORY_BUCKETS - 1; i >= 0; i--) {
      const start = current - i * BUCKET_MS;
      const stored = byStart.get(start);
      const span = Math.max(1, Math.min(BUCKET_MS, now - start) / 1000);
      const components: Record<string, PublicState> = {};
      for (const [id, value] of Object.entries(stored?.c ?? {})) components[id] = value;
      result.push({
        start: new Date(start).toISOString(),
        coverage: Math.min(100, Math.round(((stored?.m ?? 0) / span) * 1000) / 10),
        components,
      });
    }
    return result;
  }

  private publicDays(now: number, evaluated: Evaluated): PublicDay[] {
    const byKey = new Map(this.store.days.map((day) => [day.d, day]));
    const today = Math.floor(now / DAY_MS) * DAY_MS;
    const result: PublicDay[] = [];
    for (let i = HISTORY_DAYS - 1; i >= 0; i--) {
      const start = today - i * DAY_MS;
      const key = dayKey(start);
      const stored = byKey.get(key);
      const period = Math.max(1, Math.min(DAY_MS, now - start) / 1000);
      const components: PublicDay['components'] = {};
      for (const id of Object.keys(evaluated.states)) {
        const summary = summarizeDay(stored?.c[id], period);
        if (summary.state !== 'no_data') components[id] = summary;
      }
      result.push({
        date: key,
        coverage: Math.min(100, Math.round(((stored ? dayCoverageSeconds(stored, 'api') : 0) / period) * 1000) / 10),
        components,
      });
    }
    return result;
  }

  private publicIncidents(now: number, evaluated: Evaluated): PublicIncident[] {
    const names = new Map(evaluated.components.map((component) => [component.id, component.name]));
    return this.store.incidents.slice(0, 40).map((item: StoredIncident) => {
      const text = describeIncident({ type: item.t, start: item.a, end: item.b, data: item.d }, now);
      return {
        id: item.id,
        component: item.c,
        name: names.get(item.c) ?? OWN_COMPONENTS.find((def) => def.id === item.c)?.name ?? item.c,
        type: item.t,
        severity: item.s,
        state: item.s,
        title: text.title,
        detail: text.detail,
        start: new Date(item.a).toISOString(),
        end: item.b === null ? null : new Date(item.b).toISOString(),
        durationSeconds: Math.max(0, Math.round(((item.b ?? now) - item.a) / 1000)),
      };
    });
  }
}

function dayCoverageSeconds(day: { c: Record<string, number[]> }, id: string): number {
  const cell = day.c[id];
  return cell ? cell[0] + cell[1] + cell[2] + cell[3] : 0;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function capitalize(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), ms);
      timer.unref?.();
    }),
  ]).finally(() => clearTimeout(timer));
}

// ------------------------------------------------------------------------------------- persistence

export type RedisLike = {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string, options: { EX: number }) => Promise<unknown>;
};

export const STATUS_REDIS_KEY = 'whatsai:status:v2';
const REDIS_TTL_SECONDS = 100 * 24 * 3600;
export const GLOBAL_SETTING_MIN_MS = 30 * 60_000;
/** O banco é considerado acordado quando a aplicação consultou há menos que isto (o Neon dorme após 5 min). */
export const DB_AWAKE_MS = 4 * 60_000;

/**
 * Redis primeiro (uma chave com TTL de 100 dias). Sem Redis configurado, o GlobalSetting recebe no máximo uma
 * gravação a cada 30 min e só quando o banco já está acordado; senão a gravação espera a próxima passada.
 *
 * Com Redis configurado mas fora do ar, a leitura falha (em vez de cair no GlobalSetting) para que um histórico
 * vazio nunca sobrescreva o que está no Redis: o núcleo tenta ler de novo e junta antes de gravar.
 */
export function createPersistence(options: {
  redisEnabled: () => boolean;
  redis: () => RedisLike | null;
  globalSetting: { read: () => Promise<unknown>; write: (value: StatusStore) => Promise<void> } | null;
  dbLastQueryAt: () => number | null;
  /** Espera do Redis ficar pronto na leitura inicial. */
  waitMs?: number;
  sleep?: (ms: number) => Promise<void>;
}): StatusPersistence {
  let lastGlobalWrite = 0;
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms).unref?.()));
  return {
    read: async () => {
      if (options.redisEnabled()) {
        let redis = options.redis();
        for (let waited = 0; !redis && waited < (options.waitMs ?? 15_000); waited += 500) {
          await sleep(500);
          redis = options.redis();
        }
        if (!redis) throw new Error('Redis indisponível');
        const raw = await redis.get(STATUS_REDIS_KEY);
        return raw ? JSON.parse(raw) : null;
      }
      return options.globalSetting ? options.globalSetting.read() : null;
    },
    write: async (store, now) => {
      if (options.redisEnabled()) {
        const redis = options.redis();
        if (!redis) return false;
        await redis.set(STATUS_REDIS_KEY, JSON.stringify(store), { EX: REDIS_TTL_SECONDS });
        return true;
      }
      if (!options.globalSetting) return false;
      if (lastGlobalWrite && now - lastGlobalWrite < GLOBAL_SETTING_MIN_MS) return false;
      const last = options.dbLastQueryAt();
      if (last === null || now - last > DB_AWAKE_MS) return false;
      await options.globalSetting.write(store);
      lastGlobalWrite = now;
      return true;
    },
  };
}
