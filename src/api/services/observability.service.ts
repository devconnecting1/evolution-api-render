import { prismaRepository, waMonitor } from '@api/server.module';
import { redisClient } from '@cache/rediscache.client';
import { CacheConf, configService, Database } from '@config/env.config';
import { Logger } from '@config/logger.config';
import axios from 'axios';

import {
  Alert,
  ALERT_PERCENT,
  buildMetric,
  finite,
  formatBytes,
  formatNumber,
  Metric,
  ProviderLink,
  ProviderView,
  Resource,
  withTimeout,
  worstStatus,
} from './observability.shared';
import { RedisState, SystemDeps, SystemProbe } from './observability.system';

export type { Alert, Metric, ProviderView, Resource } from './observability.shared';

const logger = new Logger('ObservabilityService');

const CACHE_TTL_MS = 60_000;
/** A forced refresh within this window reuses the overview just built (double clicks, several tabs). */
const FORCE_MIN_INTERVAL_MS = 5_000;
const HTTP_TIMEOUT_MS = 8_000;
const PROVIDER_TIMEOUT_MS = 10_000;
const NEON_API_URL = 'https://console.neon.tech/api/v2';
const RENDER_API_URL = 'https://api.render.com/v1';
const VERCEL_API_URL = 'https://api.vercel.com';
const GITHUB_API_URL = 'https://api.github.com';

const GB = 1024 * 1024 * 1024;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Neon Free (https://neon.com/docs/introduction/plans): per project; compute and egress reset each period.
 * Neon bills in decimal GB (10^9 bytes); the storage cap comes from the project (branch_logical_size_limit_bytes)
 * when the API reports it. Running out of CU-hours or egress suspends the compute until the next period.
 */
const NEON_FREE = { computeCuHours: 100, storageBytes: GB, egressBytes: 5 * 1e9, branches: 10 };
/** Neon's billing month is a fixed 744 h (31 x 24). */
const NEON_MONTH_HOURS = 744;
/** Render: 750 Free instance hours per workspace per calendar month (https://render.com/docs/free). */
const RENDER_FREE_INSTANCE_HOURS = 750;
/** Vercel Hobby (https://vercel.com/docs/limits): deployments per day; build time per deployment (all plans). */
const VERCEL_HOBBY_DEPLOYS_PER_DAY = 100;
const VERCEL_BUILD_MINUTES_PER_DEPLOY = 45;
/** GitHub Free: Actions minutes per month for private repositories (public repositories are free). */
const GITHUB_FREE_ACTIONS_MINUTES = 2000;

const RENDER_FAILED_DEPLOY = new Set(['build_failed', 'update_failed', 'pre_deploy_failed', 'canceled']);

type Overview = {
  generatedAt: string;
  cached: boolean;
  cacheTtlSeconds: number;
  /** Every metric at or above 80% of its limit, worst first (also written as a note on its card). */
  alerts: Alert[];
  providers: ProviderView[];
};

type HttpResponse = { data: any; status?: number };
export type HttpClient = { get: (path: string, config?: { params?: Record<string, any> }) => Promise<HttpResponse> };
export type HttpFactory = (baseURL: string, headers: Record<string, string>) => HttpClient;

export type ObservabilityOptions = {
  http?: HttpFactory;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  /** null disables the local provider (tests of the external providers). */
  system?: SystemProbe | null;
  providerTimeoutMs?: number;
};

type RenderSeries = {
  unit?: string;
  labels?: { field?: string; value?: string }[];
  values?: { timestamp?: string; value?: number }[];
};

type SetupHelp = { description: string; note: string; links: ProviderLink[]; env: string[] };

/** What each provider needs and where the key is created (shown on the "Não configurado" cards). */
const SETUP: Record<string, SetupHelp> = {
  neon: {
    description: 'Postgres gerenciado',
    env: ['NEON_API_KEY', 'NEON_PROJECT_ID'],
    note: 'Crie uma API key no Neon (Account settings > API keys, ou uma chave da organização com escopo do projeto) e salve no Environment do serviço no Render.',
    links: [
      { label: 'Criar API key', url: 'https://console.neon.tech/app/settings/api-keys' },
      { label: 'Como criar', url: 'https://neon.com/docs/manage/api-keys' },
    ],
  },
  render: {
    description: 'Hospedagem da API',
    env: ['RENDER_API_KEY', 'RENDER_SERVICE_IDS', 'RENDER_OWNER_ID'],
    note: 'Crie uma API key no Render (Account Settings > API Keys) e salve no Environment do serviço. Ela lê serviços, deploys e métricas.',
    links: [
      { label: 'Criar API key', url: 'https://dashboard.render.com/u/settings#api-keys' },
      { label: 'Como criar', url: 'https://render.com/docs/api#1-create-an-api-key' },
    ],
  },
  vercel: {
    description: 'Hospedagem do painel',
    env: ['VERCEL_TOKEN', 'VERCEL_TEAM_ID', 'VERCEL_PROJECT_ID'],
    note: 'Crie um token na Vercel (Account Settings > Tokens) com escopo apenas do team do painel e salve no Environment do serviço no Render.',
    links: [
      { label: 'Criar token', url: 'https://vercel.com/account/settings/tokens' },
      { label: 'Como criar', url: 'https://vercel.com/docs/accounts/access-tokens' },
    ],
  },
  github: {
    description: 'CI/CD e Actions',
    env: ['GITHUB_TOKEN', 'GITHUB_OWNER', 'GITHUB_REPO'],
    note: 'Opcional. Crie um fine-grained token só deste repositório com Actions: read (e a permissão de conta Plan: read para ver os minutos) e salve no Environment do serviço no Render.',
    links: [
      { label: 'Criar token', url: 'https://github.com/settings/personal-access-tokens/new' },
      {
        label: 'Como criar',
        url: 'https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#creating-a-fine-grained-personal-access-token',
      },
    ],
  },
};

const defaultHttp: HttpFactory = (baseURL, headers) => axios.create({ baseURL, headers, timeout: HTTP_TIMEOUT_MS });

const unwrapList = (data: any, key: string): any[] =>
  (Array.isArray(data) ? data : Array.isArray(data?.[`${key}s`]) ? data[`${key}s`] : [])
    .map((item: any) => item?.[key] ?? item)
    .filter(Boolean);

const capitalize = (value: string | null | undefined): string | null =>
  value ? value.charAt(0).toUpperCase() + value.slice(1) : null;

const httpStatus = (error: unknown): number | undefined =>
  axios.isAxiosError(error) ? error.response?.status : (error as any)?.response?.status;

const formatDate = (value: unknown): string | null => {
  const time = typeof value === 'number' ? value : Date.parse(String(value ?? ''));
  if (!Number.isFinite(time)) return null;
  return new Date(time).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

/** Last numeric value of a Render metric series list (e.g. the current memory of the instance). */
export function renderLatest(series: RenderSeries[] | null | undefined): number | null {
  const values = (Array.isArray(series) ? series : [])
    .flatMap((item) => item?.values ?? [])
    .filter((item) => typeof item?.value === 'number')
    .sort((a, b) => Date.parse(a.timestamp ?? '') - Date.parse(b.timestamp ?? ''));
  return values.length ? (values[values.length - 1].value as number) : null;
}

/** Distinct hourly buckets with data (any instance): an estimate of the hours the service was running. */
export function renderActiveHours(series: RenderSeries[] | null | undefined): number | null {
  const buckets = new Set<string>();
  for (const item of Array.isArray(series) ? series : []) {
    for (const value of item?.values ?? []) {
      if (typeof value?.value === 'number' && value.timestamp) buckets.add(value.timestamp.slice(0, 13));
    }
  }
  return buckets.size ? buckets.size : null;
}

/** Sum of a Render bandwidth series (unit "mb") in bytes. */
export function renderBandwidthBytes(series: RenderSeries[] | null | undefined): number | null {
  const list = Array.isArray(series) ? series : [];
  const values = list.flatMap((item) => item?.values ?? []).filter((item) => typeof item?.value === 'number');
  if (!values.length) return null;
  const unit = String(list[0]?.unit ?? 'mb').toLowerCase();
  const factor = unit === 'gb' ? GB : unit === 'kb' ? 1024 : unit === 'b' || unit === 'bytes' ? 1 : 1024 * 1024;
  return values.reduce((total, item) => total + (item.value as number) * factor, 0);
}

export class ObservabilityService {
  private cache: { at: number; data: Overview } | null = null;
  private inFlight: Promise<Overview> | null = null;
  private systemProbe: SystemProbe | null | undefined;

  constructor(private readonly options: ObservabilityOptions = {}) {
    this.systemProbe = options.system;
  }

  public async getOverview(force = false): Promise<Overview> {
    const age = this.cache ? this.now() - this.cache.at : Infinity;
    if (this.cache && age < (force ? FORCE_MIN_INTERVAL_MS : CACHE_TTL_MS)) {
      return { ...this.cache.data, cached: true };
    }

    if (this.inFlight) {
      return this.inFlight;
    }

    this.inFlight = this.buildOverview().finally(() => {
      this.inFlight = null;
    });

    return this.inFlight;
  }

  private async buildOverview(): Promise<Overview> {
    const system = this.getSystemProbe();
    const providers = await Promise.all([
      ...(system
        ? [
            this.loadProvider('system', 'Sistema', 'Servidor da API, banco e instâncias', () => system.collect()),
            this.loadProvider('whatsapp', 'WhatsApp', 'Conexão de cada instância (número)', () =>
              system.collectWhatsapp(),
            ),
          ]
        : []),
      this.loadProvider('neon', 'Neon', SETUP.neon.description, () => this.getNeon()),
      this.loadProvider('render', 'Render', SETUP.render.description, () => this.getRender()),
      this.loadProvider('vercel', 'Vercel', SETUP.vercel.description, () => this.getVercel()),
      this.loadProvider('github', 'GitHub', SETUP.github.description, () => this.getGithub()),
    ]);

    const alerts = this.collectAlerts(providers);

    const data: Overview = {
      generatedAt: new Date(this.now()).toISOString(),
      cached: false,
      cacheTtlSeconds: CACHE_TTL_MS / 1000,
      alerts,
      providers,
    };

    this.cache = { at: this.now(), data };

    return data;
  }

  private async loadProvider(
    id: string,
    name: string,
    description: string,
    loader: () => Promise<ProviderView>,
  ): Promise<ProviderView> {
    try {
      return await withTimeout(
        loader(),
        this.options.providerTimeoutMs ?? PROVIDER_TIMEOUT_MS,
        'O provedor não respondeu dentro do tempo esperado.',
      );
    } catch (error) {
      const message = this.describeError(error);
      logger.error(`${name}: ${message}`);
      return this.errorView(id, name, description, message, httpStatus(error));
    }
  }

  private getSystemProbe(): SystemProbe | null {
    if (this.systemProbe !== undefined) return this.systemProbe;

    // Built on the first request: the application modules are fully initialized by then
    const cacheConf = configService.get<CacheConf>('CACHE');
    const deps: SystemDeps = {
      prisma: prismaRepository as unknown as SystemDeps['prisma'],
      waInstances: () => waMonitor?.waInstances,
      databaseProvider: configService.get<Database>('DATABASE')?.PROVIDER,
      cache: {
        redisEnabled: Boolean(cacheConf?.REDIS?.ENABLED && cacheConf?.REDIS?.URI),
        localEnabled: Boolean(cacheConf?.LOCAL?.ENABLED),
        redisState: async (): Promise<RedisState> => {
          const client = redisClient.peek();
          if (!client) return { state: 'absent' };
          if (!client.isReady) return { state: client.isOpen ? 'connecting' : 'down' };
          const startedAt = Date.now();
          await client.ping();
          return { state: 'ready', latencyMs: Date.now() - startedAt };
        },
      },
    };

    this.systemProbe = new SystemProbe(deps);
    return this.systemProbe;
  }

  // ---------------------------------------------------------------------------------------------- Neon

  private async getNeon(): Promise<ProviderView> {
    const missing = this.missingEnv(['NEON_API_KEY', 'NEON_PROJECT_ID']);
    if (missing.length) return this.missingView('neon', 'Neon', missing);

    const apiKey = this.env('NEON_API_KEY');
    const projectId = encodeURIComponent(this.env('NEON_PROJECT_ID'));
    const client = this.http(NEON_API_URL, { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' });

    const [projectResult, branchesResult, endpointsResult] = await Promise.allSettled([
      client.get(`/projects/${projectId}`),
      client.get(`/projects/${projectId}/branches`),
      client.get(`/projects/${projectId}/endpoints`),
    ]);

    if (projectResult.status === 'rejected') throw projectResult.reason;

    const project = projectResult.value.data?.project ?? projectResult.value.data;
    if (!project?.id) {
      throw new Error('Projeto Neon não encontrado na resposta da API.');
    }

    const notes: string[] = [];
    let partial = false;

    // The plan comes with the project (owner.subscription_type, e.g. "free_v3"); the organization endpoint is
    // only a fallback, and a project-scoped key cannot read it
    let subscription: string | null = project.owner?.subscription_type ?? null;
    const orgId = project.org_id || this.env('NEON_ORG_ID');
    if (!subscription && orgId) {
      try {
        const org = (await client.get(`/organizations/${encodeURIComponent(orgId)}`)).data;
        subscription = org?.plan ?? org?.organization?.plan ?? null;
      } catch {
        notes.push('Não foi possível confirmar o plano da organização.');
      }
    }
    const isFree = /^free/i.test(subscription ?? '');
    const plan = isFree ? 'Free' : capitalize(subscription?.replace(/_v\d+$/i, '') ?? null);

    const branches: any[] = branchesResult.status === 'fulfilled' ? (branchesResult.value.data?.branches ?? []) : [];
    if (branchesResult.status === 'rejected') {
      partial = true;
      notes.push('Não foi possível ler as branches; o armazenamento pode estar incompleto.');
    }

    // Neon documents the Free storage cap as the logical_size summed across the branches of the project
    // (https://neon.com/docs/introduction/usage-calculations#branch-storage); the primary branch is in the detail
    const primary = branches.find((branch) => branch.default || branch.primary) ?? branches[0];
    const storageSum = branches.reduce((total, branch) => total + (finite(branch.logical_size) ?? 0), 0);
    const storageUsed = branchesResult.status === 'fulfilled' && branches.length ? storageSum : null;
    const reportedLimit =
      finite(project.branch_logical_size_limit_bytes) ??
      (finite(project.branch_logical_size_limit) ? finite(project.branch_logical_size_limit) * 1024 * 1024 : null);
    const storageLimit = reportedLimit ?? (isFree ? NEON_FREE.storageBytes : null);

    // compute_time_seconds is in CU-seconds (active time x compute size), so / 3600 = CU-hours
    const computeSeconds = finite(project.compute_time_seconds) ?? 0;
    const computeLimit = isFree ? NEON_FREE.computeCuHours : null;
    const projection = this.neonProjection(
      computeSeconds / 3600,
      computeLimit,
      project.consumption_period_start,
      project.consumption_period_end,
    );
    const activeSeconds = finite(project.active_time_seconds) ?? 0;
    const egressBytes = finite(project.data_transfer_bytes) ?? 0;
    const branchesLimit = finite(project.owner?.branches_limit) ?? (isFree ? NEON_FREE.branches : null);

    const endpoints: any[] =
      endpointsResult.status === 'fulfilled' ? (endpointsResult.value.data?.endpoints ?? []) : [];
    const primaryEndpoint = endpoints.find((endpoint) => endpoint.branch_id === primary?.id) ?? endpoints[0];
    const computeState = primaryEndpoint?.current_state ?? (activeSeconds > 0 ? 'active' : 'idle');

    const metrics = [
      buildMetric('storage', 'Armazenamento', storageUsed, storageLimit, 'bytes', {
        detail: primary
          ? `${branches.length} branch(es) somadas · ${primary.name} ${formatBytes(finite(primary.logical_size) ?? 0)}`
          : undefined,
      }),
      buildMetric('compute', 'Compute', computeSeconds / 3600, computeLimit, 'cu_hours', {
        detail: 'CU-horas no período (tempo ativo x tamanho do compute)',
      }),
      ...(projection
        ? [
            buildMetric(
              'compute_projection',
              'Compute projetado (mês)',
              projection.projected,
              computeLimit,
              'cu_hours',
              {
                detail: projection.detail,
              },
            ),
          ]
        : []),
      buildMetric('egress', 'Egress', egressBytes, isFree ? NEON_FREE.egressBytes : null, 'bytes', {
        detail: 'Transferência pública de saída no período',
      }),
      buildMetric('active_time', 'Tempo ativo', activeSeconds / 3600, null, 'hours', {
        detail: 'Tempo com o compute ligado no período',
      }),
      buildMetric(
        'branches',
        'Branches',
        branchesResult.status === 'fulfilled' ? branches.length : null,
        branchesLimit,
        'count',
        {
          detail: 'Branches do projeto',
        },
      ),
    ];

    if (projection?.exhaustion) notes.push(projection.exhaustion);
    const periodEnd = formatDate(project.consumption_period_end);
    notes.push('Compute e egress reiniciam a cada período de consumo; os números podem ter alguns minutos de atraso.');
    if (periodEnd) notes.push(`O período atual termina em ${periodEnd}.`);
    if (isFree) {
      notes.push(
        'Limites do Neon Free: 100 CU-horas/mês, 1 GB de storage e 5 GB de egress/mês por projeto. Se o compute ou o egress acabar, o banco fica suspenso até o próximo período.',
      );
    }

    const lastActive = formatDate(project.compute_last_active_at);

    return {
      id: 'neon',
      name: 'Neon',
      description: SETUP.neon.description,
      configured: true,
      plan,
      status: partial || worstStatus(metrics) !== 'ok' ? 'partial' : 'ok',
      updatedAt: this.isoNow(),
      metrics,
      resources: [
        {
          id: project.id,
          name: project.name,
          type: `Postgres ${project.pg_version ?? ''}`.trim(),
          status: computeState,
          plan: plan ?? undefined,
          region: project.region_id,
          detail: [
            primaryEndpoint
              ? `Compute ${primaryEndpoint.autoscaling_limit_min_cu ?? '?'}-${primaryEndpoint.autoscaling_limit_max_cu ?? '?'} CU`
              : null,
            lastActive ? `última atividade ${lastActive}` : null,
          ]
            .filter(Boolean)
            .join(' · '),
        },
      ],
      notes,
      links: [
        { label: 'Abrir Neon', url: `https://console.neon.tech/app/projects/${projectId}` },
        { label: 'Ver branches', url: `https://console.neon.tech/app/projects/${projectId}/branches` },
      ],
    };
  }

  /**
   * Linear projection of the Neon CU-hours from the pace of the current consumption period. A first period
   * shorter than a month (project created mid-month) is projected to a full Neon month (744 h) instead, so the
   * real monthly pace is not hidden. Null when the period is unknown or too young (< 6 h) to extrapolate.
   */
  private neonProjection(usedCuHours: number, limit: number | null, startRaw: unknown, endRaw: unknown) {
    const start = Date.parse(String(startRaw ?? ''));
    const end = Date.parse(String(endRaw ?? ''));
    const now = Math.min(this.now(), end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
    const elapsedHours = (now - start) / HOUR_MS;
    if (elapsedHours < 6) return null;

    const rate = usedCuHours / elapsedHours;
    const periodHours = (end - start) / HOUR_MS;
    const fullMonth = periodHours < 27 * 24;
    const projected = rate * (fullMonth ? NEON_MONTH_HOURS : periodHours);
    const detail = `Ritmo de ${formatNumber(rate * 24, 1)} CU-h/dia · ${
      fullMonth ? 'estimativa para um mês completo' : 'estimativa até o fim do período'
    }`;

    let exhaustion: string | null = null;
    if (limit && rate > 0 && projected >= (limit * ALERT_PERCENT) / 100) {
      const hoursToLimit = limit / rate;
      const advice =
        'Para economizar, evite conexões constantes ao banco (o compute só dorme após 5 min sem atividade) ou mude para o plano Launch.';
      if (projected < limit) {
        exhaustion = `No ritmo atual o compute fica perto do limite: ~${formatNumber(projected, 0)} de ${limit} CU-h no mês. ${advice}`;
      } else if (fullMonth) {
        exhaustion = `No ritmo atual um mês completo usaria ~${formatNumber(projected, 0)} CU-h: as ${limit} CU-h acabariam por volta do dia ${Math.ceil(hoursToLimit / 24)} e o banco ficaria suspenso (a API para) até o próximo período. ${advice}`;
      } else {
        exhaustion = `No ritmo atual as ${limit} CU-h acabam por volta de ${formatDate(start + hoursToLimit * HOUR_MS)}; depois disso o banco fica suspenso (a API para) até ${formatDate(end)}. ${advice}`;
      }
    }

    return { projected, detail, exhaustion };
  }

  // -------------------------------------------------------------------------------------------- Render

  private async getRender(): Promise<ProviderView> {
    const missing = this.missingEnv(['RENDER_API_KEY']);
    if (missing.length) return this.missingView('render', 'Render', missing);

    const client = this.http(RENDER_API_URL, {
      Authorization: `Bearer ${this.env('RENDER_API_KEY')}`,
      Accept: 'application/json',
    });
    const ids = (this.env('RENDER_SERVICE_IDS') ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    const notes: string[] = [];
    let partial = false;
    let services: any[] = [];
    let keyValues: any[] = [];

    if (ids.length) {
      // Key Value instances (red-...) are not returned by /services: each id is read from its own endpoint
      const results = await Promise.allSettled(
        ids.map((id) =>
          client.get(
            id.startsWith('red-') ? `/key-value/${encodeURIComponent(id)}` : `/services/${encodeURIComponent(id)}`,
          ),
        ),
      );
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          if ([401, 403].includes(httpStatus(result.reason))) throw result.reason;
          partial = true;
          notes.push(`Não foi possível ler ${ids[index]} (verifique RENDER_SERVICE_IDS).`);
          return;
        }
        const data = result.value.data?.service ?? result.value.data?.keyValue ?? result.value.data;
        if (ids[index].startsWith('red-')) keyValues.push(data);
        else services.push(data);
      });
    } else {
      let ownerId = this.env('RENDER_OWNER_ID');
      if (!ownerId) {
        const owners = unwrapList((await client.get('/owners', { params: { limit: 20 } })).data, 'owner');
        ownerId = owners[0]?.id;
        if (!ownerId) throw new Error('Nenhum workspace do Render foi encontrado para esta chave.');
      }
      const [servicesResult, keyValueResult] = await Promise.allSettled([
        client.get('/services', { params: { ownerId, limit: 100 } }),
        client.get('/key-value', { params: { ownerId, limit: 100 } }),
      ]);
      if (servicesResult.status === 'rejected') throw servicesResult.reason;
      services = unwrapList(servicesResult.value.data, 'service');
      keyValues = keyValueResult.status === 'fulfilled' ? unwrapList(keyValueResult.value.data, 'keyValue') : [];
    }

    services = services.filter((service) => service?.id);
    keyValues = keyValues.filter((keyValue) => keyValue?.id);

    if (services.length === 0 && keyValues.length === 0) {
      return {
        ...this.baseView('render', 'Render', SETUP.render.description),
        status: 'partial',
        notes: [...notes, 'Nenhum serviço foi encontrado para esta chave.'],
        links: [{ label: 'Abrir Render', url: 'https://dashboard.render.com/' }],
      };
    }

    const now = this.now();
    const monthStart = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), 1);
    // The metrics API only answers for the last 30 days
    const historyStart = Math.max(monthStart, now - 30 * DAY_MS + 5 * 60 * 1000);
    const recentStart = now - 30 * 60 * 1000;
    const metric = async (name: string, resource: string, start: number, resolutionSeconds?: number) => {
      const response = await client.get(`/metrics/${name}`, {
        params: {
          resource,
          startTime: new Date(start).toISOString(),
          endTime: new Date(now).toISOString(),
          ...(resolutionSeconds ? { resolutionSeconds } : {}),
        },
      });
      return (Array.isArray(response.data) ? response.data : []) as RenderSeries[];
    };

    const metrics: Metric[] = [];
    const resources: Resource[] = [];
    const links: ProviderLink[] = [];
    let metricsFailed = false;
    let freeWebHours: number | null = null;
    let bandwidthBytes: number | null = null;
    let hasFreeWeb = false;

    const serviceData = await Promise.all(
      services.map(async (service) => {
        const [deploys, cpu, cpuLimit, memory, memoryLimit, hours, bandwidth] = await Promise.allSettled([
          client.get(`/services/${service.id}/deploys`, { params: { limit: 1 } }),
          metric('cpu', service.id, recentStart, 300),
          metric('cpu-limit', service.id, recentStart, 300),
          metric('memory', service.id, recentStart, 300),
          metric('memory-limit', service.id, recentStart, 300),
          metric('cpu', service.id, historyStart, 3600),
          metric('bandwidth', service.id, historyStart),
        ]);
        return { service, deploys, cpu, cpuLimit, memory, memoryLimit, hours, bandwidth };
      }),
    );

    for (const { service, deploys, cpu, cpuLimit, memory, memoryLimit, hours, bandwidth } of serviceData) {
      const details = service.serviceDetails ?? {};
      const plan = details.plan ?? null;
      const isFree = String(plan ?? '').toLowerCase() === 'free';
      const value = (result: PromiseSettledResult<RenderSeries[]>) =>
        result.status === 'fulfilled' ? renderLatest(result.value) : null;

      if ([cpu, cpuLimit, memory, memoryLimit].some((result) => result.status === 'rejected')) metricsFailed = true;

      const memoryUsed = value(memory);
      const memoryMax = value(memoryLimit);
      const cpuUsed = value(cpu);
      const cpuMax = value(cpuLimit);
      const label = services.length > 1 ? ` (${service.name})` : '';

      metrics.push(
        buildMetric(`memory_${service.id}`, `Memória${label}`, memoryUsed, memoryMax, 'bytes', {
          detail: `${service.name} · uso atual do container`,
          warnAt: 80,
          criticalAt: 90,
        }),
        buildMetric(
          `cpu_${service.id}`,
          `CPU (% do limite)${label}`,
          cpuUsed !== null && cpuMax ? (cpuUsed / cpuMax) * 100 : null,
          100,
          'number',
          {
            detail:
              cpuUsed !== null
                ? `${formatNumber(cpuUsed, 3)} de ${cpuMax !== null ? formatNumber(cpuMax, 2) : '?'} vCPU`
                : 'Sem dados recentes',
            warnAt: 80,
            criticalAt: 95,
          },
        ),
      );

      if (service.type === 'web_service' && isFree) {
        hasFreeWeb = true;
        const serviceHours = hours.status === 'fulfilled' ? renderActiveHours(hours.value) : null;
        if (serviceHours !== null) freeWebHours = (freeWebHours ?? 0) + serviceHours;
      }
      if (bandwidth.status === 'fulfilled') {
        const bytes = renderBandwidthBytes(bandwidth.value);
        if (bytes !== null) bandwidthBytes = (bandwidthBytes ?? 0) + bytes;
      }

      const deploy = deploys.status === 'fulfilled' ? (unwrapList(deploys.value.data, 'deploy')[0] ?? null) : null;
      if (deploys.status === 'rejected') notes.push(`Não foi possível ler o último deploy de ${service.name}.`);
      const deployStatus = deploy?.status ? String(deploy.status).toLowerCase() : null;
      if (deployStatus && RENDER_FAILED_DEPLOY.has(deployStatus)) {
        partial = true;
        notes.push(`O último deploy de ${service.name} terminou como ${deployStatus}.`);
      }
      const suspended = service.suspended === 'suspended';
      if (suspended) {
        partial = true;
        notes.push(`${service.name} está suspenso.`);
      }

      resources.push({
        id: service.id,
        name: service.name,
        type: service.type === 'web_service' ? 'Web service' : service.type,
        status: suspended ? 'suspenso' : deployStatus || 'sem deploy',
        plan: capitalize(plan) ?? undefined,
        region: details.region,
        url: details.url,
        detail: [
          deploy ? `Deploy ${formatDate(deploy.finishedAt ?? deploy.createdAt) ?? ''}`.trim() : null,
          deploy?.commit?.id ? `commit ${String(deploy.commit.id).slice(0, 7)}` : null,
        ]
          .filter(Boolean)
          .join(' · '),
      });
      if (service.dashboardUrl) links.push({ label: `Abrir ${service.name}`, url: service.dashboardUrl });
    }

    const keyValueData = await Promise.all(
      keyValues.map(async (keyValue) => {
        const [memory, memoryLimit] = await Promise.allSettled([
          metric('memory', keyValue.id, recentStart, 300),
          metric('memory-limit', keyValue.id, recentStart, 300),
        ]);
        return { keyValue, memory, memoryLimit };
      }),
    );

    for (const { keyValue, memory, memoryLimit } of keyValueData) {
      if (memory.status === 'rejected' || memoryLimit.status === 'rejected') metricsFailed = true;
      metrics.push(
        buildMetric(
          `memory_${keyValue.id}`,
          `Key Value (${keyValue.name})`,
          memory.status === 'fulfilled' ? renderLatest(memory.value) : null,
          memoryLimit.status === 'fulfilled' ? renderLatest(memoryLimit.value) : null,
          'bytes',
          {
            detail: `Memória usada · política ${keyValue.options?.maxmemoryPolicy ?? '—'}`,
            warnAt: 80,
            criticalAt: 90,
          },
        ),
      );
      if (keyValue.status && keyValue.status !== 'available') partial = true;
      resources.push({
        id: keyValue.id,
        name: keyValue.name,
        type: `Key Value ${keyValue.version ?? ''}`.trim(),
        status: keyValue.status ?? undefined,
        plan: capitalize(keyValue.plan) ?? undefined,
        region: keyValue.region,
      });
    }

    if (hasFreeWeb) {
      metrics.push(
        buildMetric('instance_hours', 'Horas de instância (mês)', freeWebHours, RENDER_FREE_INSTANCE_HOURS, 'hours', {
          detail: 'Estimativa: horas com o serviço Free ligado no mês',
        }),
      );
    }
    metrics.push(
      buildMetric('bandwidth', 'Banda de saída (mês)', bandwidthBytes, null, 'bytes', {
        detail: 'Soma da métrica de bandwidth do mês',
      }),
    );

    if (metricsFailed) {
      partial = true;
      notes.push('Algumas métricas do Render não puderam ser lidas agora.');
    }
    if (hasFreeWeb) {
      notes.push(
        'Free: 750 horas de instância por workspace/mês e o serviço dorme após 15 min sem tráfego. As horas são estimadas pela série de CPU.',
      );
    }
    if (historyStart > monthStart) notes.push('A API de métricas cobre só os últimos 30 dias.');
    notes.push('O consumo oficial de billing (banda e build minutes) fica no dashboard do Render.');

    const allFree = [
      ...services.map((service) => service.serviceDetails?.plan),
      ...keyValues.map((kv) => kv.plan),
    ].every((plan) => String(plan ?? '').toLowerCase() === 'free');

    return {
      id: 'render',
      name: 'Render',
      description: SETUP.render.description,
      configured: true,
      plan: allFree ? 'Free' : 'Pago',
      status: partial || worstStatus(metrics) !== 'ok' ? 'partial' : 'ok',
      updatedAt: this.isoNow(),
      metrics,
      resources,
      notes,
      links: links.length ? links : [{ label: 'Abrir Render', url: 'https://dashboard.render.com/' }],
    };
  }

  // -------------------------------------------------------------------------------------------- Vercel

  private async getVercel(): Promise<ProviderView> {
    const missing = this.missingEnv(['VERCEL_TOKEN', 'VERCEL_TEAM_ID', 'VERCEL_PROJECT_ID']);
    if (missing.length) return this.missingView('vercel', 'Vercel', missing);

    const teamId = this.env('VERCEL_TEAM_ID');
    const projectId = this.env('VERCEL_PROJECT_ID');
    const client = this.http(VERCEL_API_URL, { Authorization: `Bearer ${this.env('VERCEL_TOKEN')}` });
    const now = this.now();

    const [teamResult, projectResult, deploymentsResult] = await Promise.allSettled([
      client.get(`/v2/teams/${encodeURIComponent(teamId)}`),
      client.get(`/v9/projects/${encodeURIComponent(projectId)}`, { params: { teamId } }),
      client.get('/v6/deployments', { params: { projectId, teamId, limit: 100, since: now - 30 * DAY_MS } }),
    ]);

    if (deploymentsResult.status === 'rejected') throw deploymentsResult.reason;

    const notes: string[] = [];
    let partial = false;
    const team = teamResult.status === 'fulfilled' ? teamResult.value.data : null;
    const project = projectResult.status === 'fulfilled' ? projectResult.value.data : null;
    if (!team || !project) {
      partial = true;
      notes.push('Não foi possível ler todos os dados do team/projeto com este token.');
    }

    const deployments: any[] = [...(deploymentsResult.value.data?.deployments ?? [])].sort(
      (a, b) => Number(b.created ?? b.createdAt) - Number(a.created ?? a.createdAt),
    );
    const createdAt = (deployment: any) => Number(deployment.created ?? deployment.createdAt);
    const state = (deployment: any) => String(deployment.readyState ?? deployment.state ?? '').toUpperCase();
    const buildMinutes = (deployment: any) =>
      deployment.ready && deployment.buildingAt
        ? Math.max(0, Number(deployment.ready) - Number(deployment.buildingAt)) / 60000
        : null;

    const recent = deployments.filter((deployment) => createdAt(deployment) >= now - 30 * DAY_MS);
    const lastDay = deployments.filter((deployment) => createdAt(deployment) >= now - DAY_MS);
    const failed = recent.filter((deployment) => state(deployment) === 'ERROR');
    const totalBuild = recent.reduce((total, deployment) => total + (buildMinutes(deployment) ?? 0), 0);
    const latest = deployments[0];
    const production = deployments.find((deployment) => deployment.target === 'production') ?? latest;
    const lastBuild = latest ? buildMinutes(latest) : null;

    const rawPlan = team?.billing?.plan ?? null;
    const plan = capitalize(rawPlan);
    const isHobby = String(rawPlan ?? '').toLowerCase() === 'hobby';
    const domains: string[] = (
      project?.targets?.production?.alias ??
      (project?.alias ?? []).map((alias: any) => (typeof alias === 'string' ? alias : alias?.domain))
    ).filter(Boolean);

    if (production && state(production) === 'ERROR') {
      partial = true;
      notes.push('O último deploy de produção falhou.');
    }

    const metrics = [
      buildMetric(
        'deployments_24h',
        'Deploys (24h)',
        lastDay.length,
        isHobby ? VERCEL_HOBBY_DEPLOYS_PER_DAY : null,
        'count',
        {
          detail: isHobby ? 'Hobby permite 100 deploys por dia' : 'Deploys criados nas últimas 24 horas',
        },
      ),
      buildMetric('deployments', 'Deploys (30 dias)', recent.length, null, 'count', {
        detail: failed.length ? `${failed.length} com erro` : 'Nenhum com erro',
        status: failed.length ? 'warning' : 'ok',
      }),
      buildMetric('build_minutes', 'Builds (30 dias)', totalBuild, null, 'minutes', {
        detail: 'Soma do tempo de build dos deploys; não é o medidor oficial',
      }),
      buildMetric('last_build', 'Último build', lastBuild, VERCEL_BUILD_MINUTES_PER_DEPLOY, 'minutes', {
        detail: latest ? `Limite de 45 min por deploy · ${state(latest).toLowerCase()}` : 'Sem deploys recentes',
      }),
    ];

    notes.push('A API de uso (billing) da Vercel não está disponível no Hobby; o consumo oficial fica no dashboard.');
    if (deploymentsResult.value.data?.pagination?.next && recent.length >= 100) {
      notes.push('Mais de 100 deploys no período: os totais consideram só os 100 mais recentes.');
    }

    const slug = team?.slug ?? teamId;
    const projectName = project?.name ?? production?.name ?? '';
    const productionUrl = domains[0]
      ? `https://${domains[0]}`
      : production?.url
        ? `https://${production.url}`
        : undefined;

    return {
      id: 'vercel',
      name: 'Vercel',
      description: SETUP.vercel.description,
      configured: true,
      plan,
      status: partial ? 'partial' : 'ok',
      updatedAt: this.isoNow(),
      metrics,
      resources: [
        {
          id: project?.id ?? projectId,
          name: projectName || 'Projeto Vercel',
          type: 'Projeto',
          status: production ? state(production).toLowerCase() : 'sem deploy',
          plan: plan ?? undefined,
          url: productionUrl,
          detail: [
            production ? `Produção ${formatDate(createdAt(production)) ?? ''}`.trim() : null,
            production?.meta?.githubCommitSha ? `commit ${String(production.meta.githubCommitSha).slice(0, 7)}` : null,
            domains.length ? `Domínios: ${domains.join(', ')}` : null,
          ]
            .filter(Boolean)
            .join(' · '),
        },
      ],
      notes,
      links: [
        { label: 'Abrir projeto', url: `https://vercel.com/${slug}/${projectName}` },
        { label: 'Ver usage', url: `https://vercel.com/${slug}/~/usage` },
      ],
    };
  }

  // -------------------------------------------------------------------------------------------- GitHub

  private async getGithub(): Promise<ProviderView> {
    const missing = this.missingEnv(['GITHUB_TOKEN']);
    if (missing.length) return this.missingView('github', 'GitHub', missing);

    const owner = this.env('GITHUB_OWNER') ?? 'devconnecting1';
    const repo = this.env('GITHUB_REPO') ?? 'evolution-api-render';
    const fullName = `${owner}/${repo}`;
    const client = this.http(GITHUB_API_URL, {
      Authorization: `Bearer ${this.env('GITHUB_TOKEN')}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    });
    const now = new Date(this.now());

    const [repoResult, runsResult] = await Promise.allSettled([
      client.get(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`),
      client.get(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/runs`, {
        params: { per_page: 100, created: `>=${new Date(now.getTime() - 30 * DAY_MS).toISOString().slice(0, 10)}` },
      }),
    ]);

    // An invalid token, a token without access to the repository (403/404), a wrong GITHUB_OWNER/GITHUB_REPO
    // or GitHub unreachable fails both reads: show an error instead of a half-empty card
    if (repoResult.status === 'rejected' && runsResult.status === 'rejected') {
      throw repoResult.reason;
    }

    const notes: string[] = [];
    let partial = false;
    const repository = repoResult.status === 'fulfilled' ? repoResult.value.data : null;
    const isPrivate = repository ? Boolean(repository.private) : true;
    const ownerIsOrg = repository?.owner?.type === 'Organization';

    // The product-specific /settings/billing/actions endpoints were closed down in 2025; the usage report of
    // the enhanced billing platform replaces them (Actions minutes = sum of `quantity` of the minute SKUs)
    let minutes: number | null = null;
    let cost: number | null = null;
    try {
      const response = await client.get(
        `/${ownerIsOrg ? 'organizations' : 'users'}/${encodeURIComponent(owner)}/settings/billing/usage`,
        { params: { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 } },
      );
      const items: any[] = response.data?.usageItems ?? [];
      const actions = items.filter(
        (item) =>
          String(item?.product ?? '').toLowerCase() === 'actions' &&
          String(item?.unitType ?? '')
            .toLowerCase()
            .startsWith('minute'),
      );
      minutes = actions.reduce((total, item) => total + (finite(item.quantity ?? item.netQuantity) ?? 0), 0);
      cost = actions.reduce((total, item) => total + (finite(item.netAmount) ?? 0), 0);
    } catch (error) {
      partial = true;
      const status = httpStatus(error);
      if (status === 401 || status === 403) {
        // GET /users/{u}/settings/billing/usage needs the user permission "Plan" (read); the organization report
        // needs the organization permission "Administration" (read) and an organization admin
        notes.push(
          ownerIsOrg
            ? 'O token não pode ler o billing da organização: use um token de um admin com a permissão de organização "Administration" (read).'
            : 'O token não pode ler o billing: adicione a permissão de conta "Plan" (read) ao fine-grained token.',
        );
      } else if (status === 404 || status === 410) {
        notes.push('O relatório de uso de billing não está disponível para esta conta (HTTP ' + status + ').');
      } else {
        notes.push('Não foi possível ler os minutos de Actions agora.');
      }
    }

    const runs: any[] = runsResult.status === 'fulfilled' ? (runsResult.value.data?.workflow_runs ?? []) : [];
    if (runsResult.status === 'rejected') {
      partial = true;
      notes.push(
        [401, 403, 404].includes(httpStatus(runsResult.reason))
          ? 'O token não pode listar as execuções do Actions (permissão Actions: read).'
          : 'Não foi possível listar as execuções do Actions agora.',
      );
    }
    const completed = runs.filter((run) => run.status === 'completed');
    const failures = completed.filter((run) => ['failure', 'timed_out', 'startup_failure'].includes(run.conclusion));
    const latest = runs[0];
    const defaultBranch = repository?.default_branch ?? 'main';
    const latestOnDefault = completed.find((run) => run.head_branch === defaultBranch);
    if (latestOnDefault && latestOnDefault.conclusion === 'failure') {
      partial = true;
      notes.push(`A última execução em ${defaultBranch} (${latestOnDefault.name}) falhou.`);
    }

    const metrics: Metric[] = [];
    if (minutes !== null) {
      metrics.push(
        buildMetric(
          'actions_minutes',
          'Minutos de Actions (mês)',
          minutes,
          isPrivate ? GITHUB_FREE_ACTIONS_MINUTES : null,
          // "count" shows "156 de 2.000" (the "minutes" unit would render 2h 36min of 33h 20min)
          'count',
          {
            detail: `${cost ? `Custo líquido US$ ${formatNumber(cost, 2)}` : 'Sem custo no mês'} · todos os repositórios da conta`,
          },
        ),
      );
    }
    if (runsResult.status === 'fulfilled') {
      metrics.push(
        buildMetric('runs', 'Execuções (30 dias)', runsResult.value.data?.total_count ?? runs.length, null, 'count', {
          detail: failures.length
            ? `${failures.length} falha(s) entre as últimas ${completed.length}`
            : 'Sem falhas recentes',
          status: failures.length ? 'warning' : 'ok',
        }),
      );
    }

    if (isPrivate) notes.push('GitHub Free inclui 2.000 minutos de Actions por mês em repositórios privados.');
    else notes.push('Actions em repositórios públicos não consome minutos.');

    return {
      id: 'github',
      name: 'GitHub',
      description: SETUP.github.description,
      configured: true,
      plan: null,
      status: partial ? 'partial' : 'ok',
      updatedAt: this.isoNow(),
      metrics,
      resources: [
        {
          id: fullName,
          name: fullName,
          type: 'Repositório',
          status: repository ? (isPrivate ? 'privado' : 'público') : undefined,
          url: `https://github.com/${fullName}`,
          detail: latest
            ? `Última execução: ${latest.name} · ${latest.conclusion ?? latest.status} · ${formatDate(latest.created_at) ?? ''}`.trim()
            : undefined,
        },
      ],
      notes,
      links: [
        { label: 'Ver Actions', url: `https://github.com/${fullName}/actions` },
        {
          label: 'Billing',
          url: ownerIsOrg
            ? `https://github.com/organizations/${owner}/settings/billing`
            : 'https://github.com/settings/billing',
        },
      ],
    };
  }

  // ------------------------------------------------------------------------------------------- helpers

  /**
   * Every provider answers JSON objects or arrays. Anything else (an HTML error page of a proxy, an empty
   * body, plain text) is an error instead of being read as "zero deploys / public repository".
   */
  private http(baseURL: string, headers: Record<string, string>): HttpClient {
    const client = (this.options.http ?? defaultHttp)(baseURL, headers);
    return {
      get: async (path, config) => {
        const response = await client.get(path, config);
        if (response?.data === null || typeof response?.data !== 'object') {
          throw new Error('Resposta inválida do provedor (não é JSON).');
        }
        return response;
      },
    };
  }

  /** Metrics at or above ALERT_PERCENT of a quota: listed in the overview and summarized on their card. */
  private collectAlerts(providers: ProviderView[]): Alert[] {
    const alerts: Alert[] = [];
    for (const provider of providers) {
      const own = provider.metrics
        .filter((metric) => !metric.higherIsBetter && metric.percent !== null && metric.percent >= ALERT_PERCENT)
        .map((metric) => ({
          provider: provider.id,
          metric: metric.id,
          label: metric.label,
          percent: metric.percent as number,
          status: metric.status,
          message: `${provider.name}: ${metric.label} em ${formatNumber(metric.percent as number, 0)}% do limite.`,
        }));
      if (own.length) {
        provider.notes.unshift(
          `Atenção: ${own.map((alert) => `${alert.label} em ${formatNumber(alert.percent, 0)}%`).join(', ')} do limite.`,
        );
      }
      alerts.push(...own);
    }
    return alerts.sort((a, b) => b.percent - a.percent);
  }

  private baseView(id: string, name: string, description: string): ProviderView {
    return {
      id,
      name,
      description,
      configured: true,
      plan: null,
      status: 'ok',
      updatedAt: this.isoNow(),
      metrics: [],
      resources: [],
      notes: [],
      links: [],
    };
  }

  private missingView(id: string, name: string, envNames: string[]): ProviderView {
    const help = SETUP[id];
    return {
      ...this.baseView(id, name, help.description),
      configured: false,
      status: 'missing',
      missingEnv: envNames,
      notes: [help.note, `Variáveis necessárias: ${envNames.join(', ')}.`],
      links: help.links,
    };
  }

  /** Error card with what to do next: check the keys (401/403/404) or retry later, plus where to create a key. */
  private errorView(id: string, name: string, description: string, message: string, status?: number): ProviderView {
    const help = SETUP[id];
    const notes: string[] = [];
    if (help && [401, 403, 404].includes(status as number)) {
      notes.push(
        `Confira ${help.env.join(', ')} no Environment do serviço no Render. Se a chave foi apagada ou expirou, crie outra.`,
      );
    } else if (help) {
      notes.push('O provedor pode estar instável: os outros cards continuam valendo. Use Atualizar em alguns minutos.');
    }
    return {
      ...this.baseView(id, name, description),
      status: 'error',
      error: message,
      notes,
      links: help ? help.links : [],
    };
  }

  /** Short, safe message: never includes headers, URLs or response bodies (tokens stay out of the UI/logs). */
  private describeError(error: unknown): string {
    const status = httpStatus(error);
    if (status === 401 || status === 403) return 'Credencial inválida ou sem permissão.';
    if (status === 404) return 'Recurso não encontrado: confira os IDs configurados.';
    if (status === 429) return 'Limite de consultas do provedor atingido.';
    if (status) return `Falha na API do provedor (HTTP ${status}).`;
    if (axios.isAxiosError(error)) return 'Sem resposta do provedor (rede indisponível ou tempo esgotado).';

    const message = error instanceof Error ? error.message : '';
    return message && message.length <= 160 && !/bearer|token|key=/i.test(message)
      ? message
      : 'Falha ao consultar o provedor.';
  }

  private missingEnv(names: string[]): string[] {
    return names.filter((name) => !this.env(name));
  }

  private env(name: string): string | undefined {
    const value = (this.options.env ?? process.env)[name]?.trim();
    return value || undefined;
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  private isoNow(): string {
    return new Date(this.now()).toISOString();
  }
}

export const observabilityService = new ObservabilityService();
