/**
 * Status público: leitura e classificação dos sinais (provedores, terceiros, site), sem dependências.
 *
 * Este módulo é puro (sem imports de aplicação nem aliases) para ser usado tanto pela API quanto pelo monitor
 * externo em ops/status-monitor (Cloudflare Worker). Nada aqui lê o banco: Render, Neon e Vercel são APIs de
 * controle (a do Neon não liga o compute) e as páginas de status de terceiros são JSON públicos.
 *
 * Privacidade: as funções devolvem só agregados e textos gerados aqui. Nunca repassam chaves, nomes de instância,
 * números, mensagens de commit ou corpo de resposta dos provedores.
 */

export type PublicState = 'operational' | 'degraded' | 'outage' | 'maintenance' | 'no_data';

/** Tipos fixos de incidente (o título e o detalhe são gerados a partir dos dados reais). */
export const INCIDENT_TYPES = [
  'deploy_failed',
  'restart_oom',
  'restart_deploy',
  'restart_unknown',
  'db_suspended_quota',
  'db_quota_risk',
  'whatsapp_disconnected',
  'ai_errors',
  'site_down',
  'upstream_incident',
  'api_unreachable',
] as const;
export type IncidentType = (typeof INCIDENT_TYPES)[number];
export type Severity = 'maintenance' | 'degraded' | 'outage';

export const STATE_RANK: Record<PublicState, number> = {
  no_data: 0,
  operational: 1,
  maintenance: 2,
  degraded: 3,
  outage: 4,
};

export function worst(states: PublicState[]): PublicState {
  let result: PublicState = 'no_data';
  for (const state of states) if (STATE_RANK[state] > STATE_RANK[result]) result = state;
  return result;
}

// ------------------------------------------------------------------------------------------------ formatting

const TZ = 'America/Sao_Paulo';

/** "16/11 02:28" no horário de Brasília (a página mostra o horário do navegador nos campos ISO). */
export function shortDateTime(ms: number): string {
  if (!Number.isFinite(ms)) return '—';
  return new Date(ms)
    .toLocaleString('pt-BR', {
      timeZone: TZ,
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
    .replace(', ', ' ');
}

export function shortTime(ms: number): string {
  if (!Number.isFinite(ms)) return '—';
  return new Date(ms).toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
}

/** "12 min", "2 h 5 min", "3 dias". */
export function humanDuration(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 1) return 'menos de 1 min';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h${minutes % 60 ? ` ${minutes % 60} min` : ''}`;
  return `${Math.round(hours / 24)} dias`;
}

/** "há 12 min" / "agora". */
export function ago(ms: number, now: number): string {
  const diff = now - ms;
  if (!Number.isFinite(diff) || diff < 45_000) return 'agora';
  return `há ${humanDuration(diff)}`;
}

export function decimal(value: number, digits = 1): string {
  return value.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function bytesLabel(bytes: number): string {
  if (!Number.isFinite(bytes)) return '—';
  if (bytes >= 1e9) return `${decimal(bytes / 1e9, 2)} GB`;
  if (bytes >= 1e6) return `${decimal(bytes / 1e6, 0)} MB`;
  if (bytes >= 1e3) return `${decimal(bytes / 1e3, 0)} kB`;
  return `${Math.round(bytes)} B`;
}

const num = (value: unknown): number | null => {
  const n = typeof value === 'string' && value.trim() === '' ? NaN : Number(value);
  return Number.isFinite(n) ? n : null;
};
const time = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const ms = Date.parse(String(value ?? ''));
  return Number.isFinite(ms) ? ms : null;
};
const obj = (value: unknown): Record<string, any> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : null;

/** Erro curto e seguro (nunca a URL, o cabeçalho ou o corpo da resposta). */
export function safeError(error: unknown): string {
  const status = num((error as any)?.status ?? (error as any)?.response?.status);
  if (status === 401 || status === 403) return 'credencial inválida ou sem permissão';
  if (status === 404) return 'recurso não encontrado';
  if (status === 429) return 'limite de consultas atingido';
  if (status) return `HTTP ${status}`;
  const name = String((error as any)?.name ?? '');
  const code = String((error as any)?.code ?? '');
  if (name === 'AbortError' || name === 'TimeoutError' || /ETIMEDOUT|ECONNABORTED/.test(code)) return 'tempo esgotado';
  if (name === 'SyntaxError' || /JSON/i.test(String((error as any)?.message ?? ''))) return 'resposta inválida';
  return 'sem resposta';
}

// ------------------------------------------------------------------------------------------------ HTTP

export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; signal?: AbortSignal; redirect?: 'follow' | 'manual' },
) => Promise<{ ok: boolean; status: number; json: () => Promise<any>; text?: () => Promise<string> }>;

export class HttpError extends Error {
  constructor(public readonly status: number) {
    super(`HTTP ${status}`);
  }
}

/** GET JSON com tempo máximo; erros HTTP e JSON inválido viram exceções (tratadas por quem chama). */
export async function getJson(
  fetcher: FetchLike,
  url: string,
  options: { timeoutMs?: number; headers?: Record<string, string> } = {},
): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 4_000);
  try {
    const response = await fetcher(url, {
      headers: { Accept: 'application/json', ...(options.headers ?? {}) },
      signal: controller.signal,
    });
    if (!response.ok) throw new HttpError(response.status);
    const data = await response.json();
    if (data === null || typeof data !== 'object') throw new SyntaxError('JSON inválido');
    return data;
  } finally {
    clearTimeout(timer);
  }
}

// ------------------------------------------------------------------------------------------- site (HEAD)

export type SiteCheck = { at: number; ok: boolean; status: number | null; ms: number | null; error?: string };

/** HEAD no site (Vercel) com tempo curto; 2xx/3xx = no ar. */
export async function checkSite(fetcher: FetchLike, url: string, now: () => number, timeoutMs = 4_000) {
  const started = now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(url, { method: 'HEAD', signal: controller.signal, redirect: 'manual' });
    const ms = Math.max(0, now() - started);
    const ok = response.status >= 200 && response.status < 400;
    return { at: now(), ok, status: response.status, ms, ...(ok ? {} : { error: `HTTP ${response.status}` }) };
  } catch (error) {
    return { at: now(), ok: false, status: null, ms: null, error: safeError(error) } as SiteCheck;
  } finally {
    clearTimeout(timer);
  }
}

// ------------------------------------------------------------------------------------------- upstream

export type UpstreamIncident = { name: string; impact: string; url: string | null; startedAt: string | null };
export type UpstreamStatus = {
  id: string;
  name: string;
  page: string;
  state: PublicState;
  /** Texto do próprio provedor (ex.: "All Systems Operational"), já reduzido a um rótulo em português. */
  label: string;
  incidents: UpstreamIncident[];
  checkedAt: number;
  error?: string;
};

export type UpstreamSource = {
  id: string;
  name: string;
  page: string;
  url: string;
  format: 'statuspage' | 'statusio';
};

/**
 * Páginas de status dos terceiros. Render, Vercel e OpenAI publicam o formato Statuspage (/api/v2/summary.json);
 * o Neon usa status.io (API pública por id da página). A Meta (metastatus.com) não oferece JSON público.
 */
export const UPSTREAM_SOURCES: UpstreamSource[] = [
  {
    id: 'upstream-render',
    name: 'Render',
    page: 'https://status.render.com',
    url: 'https://status.render.com/api/v2/summary.json',
    format: 'statuspage',
  },
  {
    id: 'upstream-neon',
    name: 'Neon',
    page: 'https://neonstatus.com',
    url: 'https://api.status.io/1.0/status/6878fc85709daa75be6c7e3c',
    format: 'statusio',
  },
  {
    id: 'upstream-vercel',
    name: 'Vercel',
    page: 'https://www.vercel-status.com',
    url: 'https://www.vercel-status.com/api/v2/summary.json',
    format: 'statuspage',
  },
  {
    id: 'upstream-openai',
    name: 'OpenAI',
    page: 'https://status.openai.com',
    url: 'https://status.openai.com/api/v2/summary.json',
    format: 'statuspage',
  },
];

const INDICATOR_STATE: Record<string, PublicState> = {
  none: 'operational',
  minor: 'degraded',
  major: 'outage',
  critical: 'outage',
  maintenance: 'maintenance',
};
const STATE_LABEL: Record<PublicState, string> = {
  operational: 'Operacional',
  degraded: 'Instabilidade',
  outage: 'Indisponibilidade',
  maintenance: 'Manutenção',
  no_data: 'Sem leitura',
};

const safeUrl = (value: unknown): string | null => {
  const text = String(value ?? '');
  return /^https:\/\/[^\s"'<>]+$/.test(text) ? text : null;
};
const safeText = (value: unknown, max = 140): string =>
  String(value ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

/** Atlassian Statuspage summary.json → estado + incidentes ativos (títulos públicos do provedor). */
export function parseStatuspage(source: UpstreamSource, data: unknown, now: number): UpstreamStatus {
  const root = obj(data);
  const indicator = String(obj(root?.status)?.indicator ?? '');
  if (!root || !(indicator in INDICATOR_STATE)) throw new SyntaxError('JSON inválido');
  const incidents: UpstreamIncident[] = (Array.isArray(root.incidents) ? root.incidents : [])
    .filter((item: any) => item && item.status !== 'resolved' && item.status !== 'postmortem')
    .slice(0, 3)
    .map((item: any) => ({
      name: safeText(item.name),
      impact: String(item.impact ?? 'none'),
      url: safeUrl(item.shortlink) ?? safeUrl(item.url) ?? source.page,
      startedAt: item.started_at ?? item.created_at ?? null,
    }));
  const maintenance = (Array.isArray(root.scheduled_maintenances) ? root.scheduled_maintenances : []).some(
    (item: any) => item?.status === 'in_progress',
  );
  let state = INDICATOR_STATE[indicator];
  if (state === 'operational' && maintenance) state = 'maintenance';
  return {
    id: source.id,
    name: source.name,
    page: source.page,
    state,
    label: STATE_LABEL[state],
    incidents,
    checkedAt: now,
  };
}

/** status.io (Neon): status_code 100 ok, 200 manutenção, 300 degradado, 400 parcial, 500+ fora. */
export function parseStatusIo(source: UpstreamSource, data: unknown, now: number): UpstreamStatus {
  const result = obj(obj(data)?.result);
  const code = num(obj(result?.status_overall)?.status_code);
  if (!result || code === null) throw new SyntaxError('JSON inválido');
  const state: PublicState =
    code < 200
      ? 'operational'
      : code < 300
        ? 'maintenance'
        : code < 400
          ? 'degraded'
          : code < 500
            ? 'degraded'
            : 'outage';
  const incidents: UpstreamIncident[] = (Array.isArray(result.incidents) ? result.incidents : [])
    .slice(0, 3)
    .map((item: any) => ({
      name: safeText(item?.name ?? item?.messages?.[0]?.details ?? 'Incidente'),
      impact: code >= 500 ? 'major' : 'minor',
      url: source.page,
      startedAt: item?.datetime_open ?? null,
    }));
  return {
    id: source.id,
    name: source.name,
    page: source.page,
    state,
    label: STATE_LABEL[state],
    incidents,
    checkedAt: now,
  };
}

export async function fetchUpstream(
  fetcher: FetchLike,
  source: UpstreamSource,
  now: () => number,
  timeoutMs = 4_000,
): Promise<UpstreamStatus> {
  try {
    const data = await getJson(fetcher, source.url, { timeoutMs });
    return source.format === 'statusio' ? parseStatusIo(source, data, now()) : parseStatuspage(source, data, now());
  } catch (error) {
    return {
      id: source.id,
      name: source.name,
      page: source.page,
      state: 'no_data',
      label: STATE_LABEL.no_data,
      incidents: [],
      checkedAt: now(),
      error: safeError(error),
    };
  }
}

// ------------------------------------------------------------------------------------------- Render

const RENDER_API = 'https://api.render.com/v1';
const RENDER_FAILED = new Set(['build_failed', 'update_failed', 'pre_deploy_failed']);

export type RenderSignal = {
  at: number;
  deployState: string | null;
  deployFinishedAt: number | null;
  suspended: boolean;
  /** Último reinício/falha do serviço conhecido pelos eventos do Render. */
  events: RenderEvent[];
  keyValue: { available: boolean; memoryUsed: number | null; memoryLimit: number | null } | null;
  error?: string;
};

export type RenderEvent = {
  at: number;
  kind: 'oom' | 'failed' | 'restarted' | 'deploy' | 'deploy_failed' | 'available' | 'suspended' | 'resumed';
  detail?: string;
};

/** Eventos do Render (GET /services/{id}/events) → lista enxuta e segura. */
export function parseRenderEvents(data: unknown): RenderEvent[] {
  const list = Array.isArray(data) ? data : [];
  const events: RenderEvent[] = [];
  for (const item of list) {
    const event = obj(item?.event) ?? obj(item);
    const at = time(event?.timestamp);
    const type = String(event?.type ?? '');
    if (at === null || !type) continue;
    const details = obj(event?.details) ?? {};
    const reason = obj(details.reason) ?? {};
    if (type === 'server_failed') {
      if (reason.oomKilled) events.push({ at, kind: 'oom' });
      else if (reason.timedOutSeconds || reason.unhealthy)
        events.push({ at, kind: 'failed', detail: 'verificação de saúde falhou' });
      else if (reason.nonZeroExit !== undefined)
        events.push({ at, kind: 'failed', detail: `saiu com código ${num(reason.nonZeroExit) ?? '?'}` });
      else events.push({ at, kind: 'failed' });
    } else if (type === 'server_hardware_failure')
      events.push({ at, kind: 'failed', detail: 'falha de hardware do Render' });
    else if (type === 'server_restarted') events.push({ at, kind: 'restarted' });
    else if (type === 'server_available') events.push({ at, kind: 'available' });
    else if (type === 'service_suspended') events.push({ at, kind: 'suspended' });
    else if (type === 'service_resumed') events.push({ at, kind: 'resumed' });
    else if (type === 'deploy_ended') {
      const status = String(details.deployStatus ?? details.status ?? '').toLowerCase();
      events.push({ at, kind: status === 'succeeded' || status === '2' ? 'deploy' : 'deploy_failed' });
    } else if (type === 'build_ended') {
      const status = String(details.buildStatus ?? details.status ?? '').toLowerCase();
      if (status === 'failed' || status === '3') events.push({ at, kind: 'deploy_failed', detail: 'build' });
    }
  }
  return events.sort((a, b) => b.at - a.at);
}

const latestValue = (series: unknown): number | null => {
  const values = (Array.isArray(series) ? series : [])
    .flatMap((item: any) => (Array.isArray(item?.values) ? item.values : []))
    .filter((item: any) => typeof item?.value === 'number')
    .sort((a: any, b: any) => (time(a.timestamp) ?? 0) - (time(b.timestamp) ?? 0));
  return values.length ? values[values.length - 1].value : null;
};

/** Lê deploy, eventos e Key Value do Render (somente leitura). Sem chave, não é chamado. */
export async function fetchRender(
  fetcher: FetchLike,
  config: { apiKey: string; serviceId: string; keyValueId?: string | null },
  now: () => number,
  timeoutMs = 5_000,
): Promise<RenderSignal> {
  const headers = { Authorization: `Bearer ${config.apiKey}` };
  const service = encodeURIComponent(config.serviceId);
  const get = (path: string) => getJson(fetcher, `${RENDER_API}${path}`, { headers, timeoutMs });
  const at = now();
  const since = new Date(at - 3 * 24 * 3_600_000).toISOString();
  const recent = new Date(at - 30 * 60_000).toISOString();
  const kv = config.keyValueId ? encodeURIComponent(config.keyValueId) : null;
  const [serviceRes, deploysRes, eventsRes, kvRes, memRes, memLimitRes] = await Promise.allSettled([
    get(`/services/${service}`),
    get(`/services/${service}/deploys?limit=1`),
    get(`/services/${service}/events?limit=50&startTime=${encodeURIComponent(since)}`),
    kv ? get(`/key-value/${kv}`) : Promise.resolve(null),
    kv
      ? get(`/metrics/memory?resource=${kv}&startTime=${encodeURIComponent(recent)}&resolutionSeconds=300`)
      : Promise.resolve(null),
    kv
      ? get(`/metrics/memory-limit?resource=${kv}&startTime=${encodeURIComponent(recent)}&resolutionSeconds=300`)
      : Promise.resolve(null),
  ]);
  if (serviceRes.status === 'rejected' && deploysRes.status === 'rejected') {
    return {
      at,
      deployState: null,
      deployFinishedAt: null,
      suspended: false,
      events: [],
      keyValue: null,
      error: safeError(serviceRes.reason),
    };
  }
  const serviceData =
    serviceRes.status === 'fulfilled' ? (obj(serviceRes.value?.service) ?? obj(serviceRes.value)) : null;
  const deployList = deploysRes.status === 'fulfilled' && Array.isArray(deploysRes.value) ? deploysRes.value : [];
  const deploy = obj(deployList[0]?.deploy) ?? obj(deployList[0]);
  const kvData = kvRes.status === 'fulfilled' && kvRes.value ? (obj(kvRes.value?.keyValue) ?? obj(kvRes.value)) : null;
  return {
    at,
    deployState: deploy?.status ? String(deploy.status).toLowerCase() : null,
    deployFinishedAt: time(deploy?.finishedAt ?? deploy?.updatedAt),
    suspended: serviceData?.suspended === 'suspended',
    events: eventsRes.status === 'fulfilled' ? parseRenderEvents(eventsRes.value) : [],
    keyValue: kv
      ? {
          available: kvData ? String(kvData.status ?? '') === 'available' : false,
          memoryUsed: memRes.status === 'fulfilled' ? latestValue(memRes.value) : null,
          memoryLimit: memLimitRes.status === 'fulfilled' ? latestValue(memLimitRes.value) : null,
        }
      : null,
  };
}

export function renderDeployFailed(signal: RenderSignal | null): boolean {
  return Boolean(signal?.deployState && RENDER_FAILED.has(signal.deployState));
}

/** Causa provável do reinício que começou em `bootAt`, pelos eventos do Render (janela de 15 min antes). */
export function restartCause(
  events: RenderEvent[],
  bootAt: number,
): { type: 'restart_oom' | 'restart_deploy' | 'restart_unknown'; at: number | null; detail?: string } | null {
  const window = events.filter((event) => event.at <= bootAt + 2 * 60_000 && event.at >= bootAt - 15 * 60_000);
  const oom = window.find((event) => event.kind === 'oom');
  if (oom) return { type: 'restart_oom', at: oom.at };
  const deploy = window.find((event) => event.kind === 'deploy');
  if (deploy) return { type: 'restart_deploy', at: deploy.at };
  const failed = window.find((event) => event.kind === 'failed');
  if (failed) return { type: 'restart_unknown', at: failed.at, detail: failed.detail };
  return null;
}

// --------------------------------------------------------------------------------------------- Neon

const NEON_API = 'https://console.neon.tech/api/v2';
/** Neon Free: 100 CU-h por mês por projeto, 0,5 GB... o limite de storage vem do projeto quando informado. */
export const NEON_FREE_CU_HOURS = 100;
const NEON_FREE_EGRESS = 5e9;

export type NeonSignal = {
  at: number;
  endpointState: 'active' | 'idle' | 'init' | 'suspended' | 'unknown';
  disabled: boolean;
  stateSince: number | null;
  lastActiveAt: number | null;
  isFree: boolean;
  computeCuHours: number | null;
  computeLimit: number | null;
  projectedCuHours: number | null;
  /** Dias até acabar a cota no ritmo atual (só quando a projeção passa do limite). */
  daysToLimit: number | null;
  periodEnd: number | null;
  storageBytes: number | null;
  storageLimit: number | null;
  egressBytes: number | null;
  egressLimit: number | null;
  suspendedForQuota: boolean;
  error?: string;
};

/** Projeto + endpoints do Neon → sinal do banco. A API de controle não liga o compute. */
export function parseNeon(projectData: unknown, endpointsData: unknown, now: number): NeonSignal {
  const project = obj(obj(projectData)?.project) ?? obj(projectData);
  if (!project?.id) throw new SyntaxError('JSON inválido');
  const endpoints: any[] = Array.isArray(obj(endpointsData)?.endpoints) ? obj(endpointsData)!.endpoints : [];
  const endpoint = endpoints.find((item) => item?.type === 'read_write') ?? endpoints[0] ?? null;
  const rawState = String(endpoint?.current_state ?? '').toLowerCase();
  const endpointState: NeonSignal['endpointState'] = ['active', 'idle', 'init', 'suspended'].includes(rawState)
    ? (rawState as NeonSignal['endpointState'])
    : 'unknown';
  const subscription = String(obj(project.owner)?.subscription_type ?? '');
  const isFree = /^free/i.test(subscription);
  const computeSeconds = num(project.compute_time_seconds);
  const computeCuHours = computeSeconds === null ? null : computeSeconds / 3600;
  const computeLimit = isFree ? NEON_FREE_CU_HOURS : null;
  const start = time(project.consumption_period_start);
  const end = time(project.consumption_period_end);
  let projectedCuHours: number | null = null;
  let daysToLimit: number | null = null;
  if (computeCuHours !== null && start !== null && end !== null && end > start) {
    const elapsed = Math.min(now, end) - start;
    if (elapsed >= 6 * 3_600_000) {
      const rate = computeCuHours / elapsed; // CU-h por ms
      const periodMs = end - start < 27 * 24 * 3_600_000 ? 744 * 3_600_000 : end - start;
      projectedCuHours = rate * periodMs;
      if (computeLimit && projectedCuHours > computeLimit && rate > 0) {
        daysToLimit = Math.max(0, (computeLimit - computeCuHours) / rate / (24 * 3_600_000));
      }
    }
  }
  const suspendedForQuota =
    Boolean(endpoint?.disabled) ||
    (computeLimit !== null && computeCuHours !== null && computeCuHours >= computeLimit && endpointState !== 'active');
  return {
    at: now,
    endpointState,
    disabled: Boolean(endpoint?.disabled),
    stateSince: time(endpoint?.suspended_at ?? endpoint?.updated_at),
    lastActiveAt: time(endpoint?.last_active ?? project.compute_last_active_at),
    isFree,
    computeCuHours,
    computeLimit,
    projectedCuHours,
    daysToLimit,
    periodEnd: end,
    storageBytes: num(project.synthetic_storage_size) || null,
    storageLimit: num(project.branch_logical_size_limit_bytes),
    egressBytes: num(project.data_transfer_bytes),
    egressLimit: isFree ? NEON_FREE_EGRESS : null,
    suspendedForQuota,
  };
}

export async function fetchNeon(
  fetcher: FetchLike,
  config: { apiKey: string; projectId: string },
  now: () => number,
  timeoutMs = 5_000,
): Promise<NeonSignal> {
  const headers = { Authorization: `Bearer ${config.apiKey}` };
  const id = encodeURIComponent(config.projectId);
  try {
    const [project, endpoints] = await Promise.all([
      getJson(fetcher, `${NEON_API}/projects/${id}`, { headers, timeoutMs }),
      getJson(fetcher, `${NEON_API}/projects/${id}/endpoints`, { headers, timeoutMs }),
    ]);
    return parseNeon(project, endpoints, now());
  } catch (error) {
    return {
      at: now(),
      endpointState: 'unknown',
      disabled: false,
      stateSince: null,
      lastActiveAt: null,
      isFree: false,
      computeCuHours: null,
      computeLimit: null,
      projectedCuHours: null,
      daysToLimit: null,
      periodEnd: null,
      storageBytes: null,
      storageLimit: null,
      egressBytes: null,
      egressLimit: null,
      suspendedForQuota: false,
      error: safeError(error),
    };
  }
}

// ------------------------------------------------------------------------------------------- Vercel

export type VercelSignal = {
  at: number;
  state: 'ready' | 'error' | 'building' | 'canceled' | 'unknown';
  createdAt: number | null;
  error?: string;
};

export function parseVercel(data: unknown, now: number): VercelSignal {
  const list = Array.isArray(obj(data)?.deployments) ? obj(data)!.deployments : null;
  if (!list) throw new SyntaxError('JSON inválido');
  const latest = list
    .filter((item: any) => item && (item.target === 'production' || item.target === undefined))
    .sort((a: any, b: any) => (num(b.created ?? b.createdAt) ?? 0) - (num(a.created ?? a.createdAt) ?? 0))[0];
  const raw = String(latest?.readyState ?? latest?.state ?? '').toUpperCase();
  const state: VercelSignal['state'] =
    raw === 'READY'
      ? 'ready'
      : raw === 'ERROR'
        ? 'error'
        : raw === 'CANCELED'
          ? 'canceled'
          : ['BUILDING', 'QUEUED', 'INITIALIZING'].includes(raw)
            ? 'building'
            : 'unknown';
  return { at: now, state, createdAt: num(latest?.created ?? latest?.createdAt) };
}

export async function fetchVercel(
  fetcher: FetchLike,
  config: { token: string; projectId: string; teamId?: string | null },
  now: () => number,
  timeoutMs = 5_000,
): Promise<VercelSignal> {
  const params = new URLSearchParams({ projectId: config.projectId, target: 'production', limit: '3' });
  if (config.teamId) params.set('teamId', config.teamId);
  try {
    const data = await getJson(fetcher, `https://api.vercel.com/v6/deployments?${params}`, {
      headers: { Authorization: `Bearer ${config.token}` },
      timeoutMs,
    });
    return parseVercel(data, now());
  } catch (error) {
    return { at: now(), state: 'unknown', createdAt: null, error: safeError(error) };
  }
}

// --------------------------------------------------------------------------------- incident copy

export type IncidentFacts = {
  type: IncidentType;
  start: number;
  end: number | null;
  /** Números reais usados nos textos (contagens, minutos, CU-h...). */
  data?: Record<string, number | string | null>;
};

const COMPONENT_OF: Record<IncidentType, string> = {
  deploy_failed: 'api',
  restart_oom: 'api',
  restart_deploy: 'api',
  restart_unknown: 'api',
  db_suspended_quota: 'database',
  db_quota_risk: 'database',
  whatsapp_disconnected: 'whatsapp-web',
  ai_errors: 'ai',
  site_down: 'site',
  upstream_incident: 'upstream',
  api_unreachable: 'api',
};

export const SEVERITY_OF: Record<IncidentType, Severity> = {
  deploy_failed: 'degraded',
  restart_oom: 'outage',
  restart_deploy: 'maintenance',
  restart_unknown: 'maintenance',
  db_suspended_quota: 'outage',
  db_quota_risk: 'degraded',
  whatsapp_disconnected: 'degraded',
  ai_errors: 'degraded',
  site_down: 'outage',
  upstream_incident: 'degraded',
  api_unreachable: 'outage',
};

export function defaultComponent(type: IncidentType): string {
  return COMPONENT_OF[type];
}

const AI_ERROR_TEXT: Record<string, string> = {
  no_credit: 'sem crédito na conta OpenAI',
  invalid_key: 'chave inválida ou revogada',
  rate_limited: 'limite de uso por minuto',
  model_unavailable: 'modelo indisponível',
  permission: 'chave sem permissão',
  server_error: 'erro do servidor da OpenAI',
  network: 'tempo esgotado ou rede',
  unknown: 'erro desconhecido',
};

export function aiErrorLabel(kind: string | null | undefined): string {
  return AI_ERROR_TEXT[String(kind ?? 'unknown')] ?? AI_ERROR_TEXT.unknown;
}

/** Título e detalhe em português, gerados só a partir dos fatos (números e horários reais). */
export function describeIncident(facts: IncidentFacts, now: number): { title: string; detail: string } {
  const d = facts.data ?? {};
  const duration = humanDuration((facts.end ?? now) - facts.start);
  const since = shortDateTime(facts.start);
  const until = facts.end ? shortTime(facts.end) : null;
  switch (facts.type) {
    case 'deploy_failed':
      return {
        title: d.stage === 'build' ? 'Deploy falhou no build' : 'Deploy falhou ao subir',
        detail: `A versão anterior continuou no ar. Falha registrada em ${since}.`,
      };
    case 'restart_oom':
      return {
        title: 'API reiniciou por falta de memória',
        detail: `O Render encerrou o processo por memória em ${since}${until ? `; voltou às ${until}` : ''}.`,
      };
    case 'restart_deploy':
      return {
        title: 'API reiniciou após deploy',
        detail: `Nova versão${d.version ? ` ${d.version}` : ''} no ar às ${shortTime(facts.end ?? facts.start)}.${
          d.gapMinutes ? ` Sem sinal por ${humanDuration(Number(d.gapMinutes) * 60_000)} na troca.` : ''
        }`,
      };
    case 'restart_unknown': {
      const gap = Number(d.gapMinutes ?? 0);
      if (d.sleep === 'yes') {
        return {
          title: 'Serviço em espera (plano gratuito)',
          detail: `Sem tráfego, o Render pausou a API por ${humanDuration(gap * 60_000)}; ela voltou às ${shortTime(
            facts.end ?? facts.start,
          )} na primeira requisição.`,
        };
      }
      return {
        title: 'Reinício da API',
        detail: gap
          ? `Sem sinal da API de ${shortTime(facts.start)} a ${shortTime(facts.end ?? now)} (${humanDuration(gap * 60_000)}): espera do plano gratuito ou queda.${d.reason ? ` Render: ${d.reason}.` : ''}`
          : `Processo iniciado às ${shortTime(facts.end ?? facts.start)}.${d.reason ? ` Render: ${d.reason}.` : ''}`,
      };
    }
    case 'db_suspended_quota':
      return {
        title: 'Banco suspenso: cota do mês esgotada',
        detail: `Compute em ${decimal(Number(d.used ?? 0))} de ${d.limit ?? NEON_FREE_CU_HOURS} CU-h.${
          d.periodEnd ? ` O Neon libera de novo em ${shortDateTime(Number(d.periodEnd))}.` : ''
        }`,
      };
    case 'db_quota_risk':
      return {
        title: `Banco pode ser suspenso em ~${Math.max(1, Math.round(Number(d.days ?? 0)))} dias`,
        detail: `Compute em ${decimal(Number(d.used ?? 0))} de ${d.limit ?? NEON_FREE_CU_HOURS} CU-h; no ritmo atual o mês fecharia em ~${Math.round(
          Number(d.projected ?? 0),
        )} CU-h.`,
      };
    case 'whatsapp_disconnected': {
      const total = Number(d.total ?? 0);
      const down = Number(d.down ?? 0);
      if (facts.end) {
        return {
          title: 'Conexão do WhatsApp caiu',
          detail: `${down} de ${total} número${total === 1 ? '' : 's'} sem conexão às ${shortTime(facts.start)}; voltou a conectar em ${duration}.`,
        };
      }
      return {
        title: 'Conexão do WhatsApp caiu',
        detail: `${down} de ${total} número${total === 1 ? '' : 's'} sem conexão desde ${shortTime(facts.start)} (${duration}).`,
      };
    }
    case 'ai_errors':
      return {
        title: 'Respostas da IA com erro',
        detail: `${d.failing ?? 0} de ${d.total ?? 0} chave${Number(d.total) === 1 ? '' : 's'} com falha recente (${aiErrorLabel(
          String(d.kind ?? ''),
        )}) desde ${shortTime(facts.start)}.`,
      };
    case 'site_down':
      return {
        title: 'Site e painel fora do ar',
        detail: `A verificação do site falhou (${d.reason ?? 'sem resposta'}) desde ${shortTime(facts.start)}${
          until ? ` até ${until}` : ''
        }.`,
      };
    case 'upstream_incident':
      return {
        title: `${d.provider ?? 'Terceiro'}: ${d.name ?? 'incidente em andamento'}`,
        detail: `Informado pela página de status de ${d.provider ?? 'terceiro'} às ${shortTime(facts.start)}.`,
      };
    case 'api_unreachable':
      return {
        title: 'API sem resposta',
        detail: `O monitor externo não recebeu resposta de ${shortTime(facts.start)}${until ? ` a ${until}` : ' até agora'} (${duration}).`,
      };
    default:
      return { title: 'Incidente', detail: since };
  }
}
