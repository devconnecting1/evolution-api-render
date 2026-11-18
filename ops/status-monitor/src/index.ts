/**
 * Monitor externo do status do WhatsAI (Cloudflare Worker, plano gratuito).
 *
 * A cada 5 minutos (Cron Trigger):
 *   - GET  {API_URL}/status/ping   (sem banco, sem Redis: não acorda o Neon)
 *   - HEAD {SITE_URL}
 *   - a cada 15 min: páginas de status de Render, Neon, Vercel e OpenAI; e, se houver tokens de leitura, o deploy
 *     do Render, o endpoint/cota do Neon e o deploy de produção da Vercel.
 * Tudo vai para UMA chave do Workers KV por execução (288 gravações/dia; o limite grátis é 1.000/dia).
 *
 * GET /history devolve o histórico em JSON com CORS para a página /status.
 */
import {
  checkSite,
  describeIncident,
  fetchNeon,
  fetchRender,
  fetchUpstream,
  fetchVercel,
  FetchLike,
  IncidentType,
  renderDeployFailed,
  SEVERITY_OF,
  UPSTREAM_SOURCES,
} from '../../../src/api/services/status/signals';

export interface KVLike {
  get(key: string, type: 'json'): Promise<any>;
  put(key: string, value: string): Promise<void>;
}

export interface Env {
  STATUS_KV: KVLike;
  API_URL: string;
  SITE_URL: string;
  /** Opcionais (segredos do Worker, somente leitura). */
  RENDER_API_KEY?: string;
  RENDER_SERVICE_ID?: string;
  NEON_API_KEY?: string;
  NEON_PROJECT_ID?: string;
  VERCEL_TOKEN?: string;
  VERCEL_PROJECT_ID?: string;
  VERCEL_TEAM_ID?: string;
}

export const HISTORY_KEY = 'history:v1';
const SAMPLE_WINDOW_MS = 7 * 24 * 3_600_000;
const DAYS = 90;
const PROVIDER_EVERY_MS = 15 * 60_000;
const PING_TIMEOUT_MS = 20_000;
/** Falhas seguidas (5 min cada) antes de abrir um incidente. */
const FAILURES_TO_OPEN = 2;

/** [t (s), api (1 no ar, 0 fora), ms do ping ou -1, site (1/0)] */
export type Sample = [number, 0 | 1, number, 0 | 1];
export type MonitorIncident = {
  id: string;
  c: string;
  t: IncidentType;
  s: string;
  a: number;
  b: number | null;
  d?: Record<string, number | string | null>;
};
export type History = {
  v: 1;
  updatedAt: number;
  samples: Sample[];
  /** dia UTC → [api no ar, api total, site no ar, site total] */
  days: Record<string, [number, number, number, number]>;
  incidents: MonitorIncident[];
  failures: { api: number; site: number };
  providersAt: number;
  providers: Record<string, unknown>;
  upstream: {
    id: string;
    name: string;
    page: string;
    state: string;
    incidents: { name: string; url: string | null }[];
  }[];
  api: {
    version: string | null;
    uptimeSeconds: number | null;
    state: string | null;
    components: Record<string, string>;
  };
};

export function emptyHistory(): History {
  return {
    v: 1,
    updatedAt: 0,
    samples: [],
    days: {},
    incidents: [],
    failures: { api: 0, site: 0 },
    providersAt: 0,
    providers: {},
    upstream: [],
    api: { version: null, uptimeSeconds: null, state: null, components: {} },
  };
}

function normalize(raw: any): History {
  const base = emptyHistory();
  if (!raw || raw.v !== 1) return base;
  return { ...base, ...raw, failures: { ...base.failures, ...(raw.failures ?? {}) } };
}

async function ping(fetcher: FetchLike, url: string, now: () => number) {
  const started = now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
  try {
    const response = await fetcher(`${url.replace(/\/$/, '')}/status/ping`, {
      headers: { Accept: 'application/json', 'User-Agent': 'whatsai-status-monitor' },
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, ms: -1, data: null as any };
    const data = await response.json().catch(() => null);
    return { ok: data?.status === 'ok', ms: Math.max(0, now() - started), data };
  } catch {
    return { ok: false, ms: -1, data: null as any };
  } finally {
    clearTimeout(timer);
  }
}

function setCondition(
  history: History,
  key: { c: string; t: IncidentType },
  active: boolean,
  at: number,
  start: number,
  data: Record<string, number | string | null> = {},
) {
  const open = history.incidents.find((item) => item.c === key.c && item.t === key.t && item.b === null);
  if (active && !open) {
    history.incidents.unshift({
      id: `${key.c}-${key.t}-${start}`,
      c: key.c,
      t: key.t,
      s: SEVERITY_OF[key.t],
      a: start,
      b: null,
      d: data,
    });
  } else if (active && open) {
    open.d = { ...open.d, ...data };
  } else if (!active && open) {
    open.b = at;
  }
}

/** Uma execução do Cron Trigger: mede, atualiza o histórico em memória e grava UMA vez no KV. */
export async function runMonitor(env: Env, fetcher: FetchLike, now: () => number = Date.now): Promise<History> {
  const history = normalize(await env.STATUS_KV.get(HISTORY_KEY, 'json').catch(() => null));
  const at = now();
  const [api, site] = await Promise.all([
    ping(fetcher, env.API_URL, now),
    checkSite(fetcher, env.SITE_URL, now, 8_000),
  ]);

  history.samples.push([Math.round(at / 1000), api.ok ? 1 : 0, api.ms, site.ok ? 1 : 0]);
  history.samples = history.samples.filter((sample) => sample[0] * 1000 >= at - SAMPLE_WINDOW_MS);
  const day = new Date(at).toISOString().slice(0, 10);
  const cell = history.days[day] ?? [0, 0, 0, 0];
  history.days[day] = [cell[0] + (api.ok ? 1 : 0), cell[1] + 1, cell[2] + (site.ok ? 1 : 0), cell[3] + 1];
  const oldest = new Date(at - (DAYS - 1) * 24 * 3_600_000).toISOString().slice(0, 10);
  for (const key of Object.keys(history.days)) if (key < oldest) delete history.days[key];

  history.failures.api = api.ok ? 0 : history.failures.api + 1;
  history.failures.site = site.ok ? 0 : history.failures.site + 1;
  const firstFailure = (count: number) => at - (count - 1) * 5 * 60_000;
  setCondition(
    history,
    { c: 'api', t: 'api_unreachable' },
    history.failures.api >= FAILURES_TO_OPEN,
    at,
    firstFailure(history.failures.api),
  );
  setCondition(
    history,
    { c: 'site', t: 'site_down' },
    history.failures.site >= FAILURES_TO_OPEN,
    at,
    firstFailure(history.failures.site),
    {
      reason: site.error ?? null,
    },
  );
  if (api.ok && api.data) {
    history.api = {
      version: typeof api.data.version === 'string' ? api.data.version.slice(0, 20) : null,
      uptimeSeconds: Number.isFinite(api.data.uptimeSeconds) ? api.data.uptimeSeconds : null,
      state: typeof api.data.state === 'string' ? api.data.state : null,
      components: Object.fromEntries(
        Object.entries(api.data.components ?? {})
          .filter(([id, state]) => /^[a-z0-9-]{1,40}$/.test(id) && typeof state === 'string')
          .slice(0, 20),
      ) as Record<string, string>,
    };
  }

  if (at - history.providersAt >= PROVIDER_EVERY_MS) {
    history.providersAt = at;
    const upstream = await Promise.all(UPSTREAM_SOURCES.map((source) => fetchUpstream(fetcher, source, now)));
    history.upstream = upstream.map((item) => ({
      id: item.id,
      name: item.name,
      page: item.page,
      state: item.state,
      incidents: item.incidents.map((incident) => ({ name: incident.name, url: incident.url })),
    }));
    for (const item of upstream) {
      setCondition(
        history,
        { c: item.id, t: 'upstream_incident' },
        !item.error && item.state !== 'operational' && item.incidents.length > 0,
        at,
        at,
        {
          provider: item.name,
          name: item.incidents[0]?.name ?? null,
        },
      );
    }

    if (env.RENDER_API_KEY && env.RENDER_SERVICE_ID) {
      const render = await fetchRender(fetcher, { apiKey: env.RENDER_API_KEY, serviceId: env.RENDER_SERVICE_ID }, now);
      history.providers.render = render.error
        ? { error: render.error }
        : { deployState: render.deployState, deployFinishedAt: render.deployFinishedAt, suspended: render.suspended };
      if (!render.error) {
        setCondition(
          history,
          { c: 'api', t: 'deploy_failed' },
          renderDeployFailed(render),
          at,
          render.deployFinishedAt ?? at,
          {
            stage: render.deployState === 'build_failed' ? 'build' : 'deploy',
          },
        );
      }
    }
    if (env.NEON_API_KEY && env.NEON_PROJECT_ID) {
      const neon = await fetchNeon(fetcher, { apiKey: env.NEON_API_KEY, projectId: env.NEON_PROJECT_ID }, now);
      history.providers.neon = neon.error
        ? { error: neon.error }
        : {
            endpointState: neon.endpointState,
            computeCuHours: neon.computeCuHours,
            computeLimit: neon.computeLimit,
            projectedCuHours: neon.projectedCuHours,
            daysToLimit: neon.daysToLimit,
            suspendedForQuota: neon.suspendedForQuota,
          };
      if (!neon.error) {
        setCondition(history, { c: 'database', t: 'db_suspended_quota' }, neon.suspendedForQuota, at, at, {
          used: neon.computeCuHours,
          limit: neon.computeLimit,
          periodEnd: neon.periodEnd,
        });
        const risk = !neon.suspendedForQuota && neon.daysToLimit !== null;
        setCondition(history, { c: 'database', t: 'db_quota_risk' }, risk, at, at, {
          used: neon.computeCuHours === null ? null : Math.round(neon.computeCuHours * 10) / 10,
          limit: neon.computeLimit,
          projected: neon.projectedCuHours === null ? null : Math.round(neon.projectedCuHours),
          days: neon.daysToLimit === null ? null : Math.max(1, Math.round(neon.daysToLimit)),
        });
      }
    }
    if (env.VERCEL_TOKEN && env.VERCEL_PROJECT_ID) {
      const vercel = await fetchVercel(
        fetcher,
        { token: env.VERCEL_TOKEN, projectId: env.VERCEL_PROJECT_ID, teamId: env.VERCEL_TEAM_ID ?? null },
        now,
      );
      history.providers.vercel = vercel.error
        ? { error: vercel.error }
        : { state: vercel.state, createdAt: vercel.createdAt };
    }
  }

  history.incidents = history.incidents
    .filter((item) => (item.b ?? at) >= at - DAYS * 24 * 3_600_000)
    .sort((a, b) => b.a - a.a)
    .slice(0, 120);
  history.updatedAt = at;
  await env.STATUS_KV.put(HISTORY_KEY, JSON.stringify(history));
  return history;
}

/** Resposta pública de /history: mesmos dados, com título e detalhe gerados para cada incidente. */
export function publicHistory(history: History, now: number) {
  return {
    updatedAt: history.updatedAt ? new Date(history.updatedAt).toISOString() : null,
    intervalSeconds: 300,
    api: history.api,
    samples: history.samples,
    days: history.days,
    upstream: history.upstream,
    providers: history.providers,
    incidents: history.incidents.map((item) => ({
      id: item.id,
      component: item.c,
      type: item.t,
      severity: item.s,
      ...describeIncident({ type: item.t, start: item.a, end: item.b, data: item.d }, now),
      start: new Date(item.a).toISOString(),
      end: item.b === null ? null : new Date(item.b).toISOString(),
      durationSeconds: Math.max(0, Math.round(((item.b ?? now) - item.a) / 1000)),
    })),
  };
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
};

export async function handleRequest(request: { method: string; url: string }, env: Env, now: number = Date.now()) {
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'GET' || url.pathname !== '/history') {
    return new Response(JSON.stringify({ error: 'not_found' }), { status: 404, headers: CORS });
  }
  const history = normalize(await env.STATUS_KV.get(HISTORY_KEY, 'json').catch(() => null));
  return new Response(JSON.stringify(publicHistory(history, now)), {
    status: 200,
    headers: { ...CORS, 'Cache-Control': 'public, max-age=60' },
  });
}

export default {
  async scheduled(_event: unknown, env: Env, ctx: { waitUntil(promise: Promise<unknown>): void }) {
    ctx.waitUntil(runMonitor(env, fetch as unknown as FetchLike));
  },
  async fetch(request: Request, env: Env) {
    return handleRequest(request, env);
  },
};
