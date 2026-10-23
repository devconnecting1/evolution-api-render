import { Logger } from '@config/logger.config';
import axios, { AxiosInstance } from 'axios';

const logger = new Logger('ObservabilityService');

const CACHE_TTL_MS = 60_000;
const NEON_API_URL = 'https://console.neon.tech/api/v2';
const RENDER_API_URL = 'https://api.render.com/v1';
const VERCEL_API_URL = 'https://api.vercel.com';
const GITHUB_API_URL = 'https://api.github.com';

type ProviderStatus = 'ok' | 'partial' | 'missing' | 'error';
type MetricStatus = 'ok' | 'warning' | 'critical' | 'unknown';
type MetricUnit = 'bytes' | 'hours' | 'cu_hours' | 'count' | 'minutes' | 'number';

type Metric = {
  id: string;
  label: string;
  used: number | null;
  limit: number | null;
  unit: MetricUnit;
  percent: number | null;
  status: MetricStatus;
  detail?: string;
};

type Resource = {
  id: string;
  name: string;
  type?: string;
  status?: string;
  plan?: string;
  region?: string;
  url?: string;
  detail?: string;
};

type ProviderView = {
  id: string;
  name: string;
  description: string;
  configured: boolean;
  plan: string | null;
  status: ProviderStatus;
  updatedAt: string;
  metrics: Metric[];
  resources: Resource[];
  notes: string[];
  links: { label: string; url: string }[];
  error?: string;
};

type Overview = {
  generatedAt: string;
  cached: boolean;
  cacheTtlSeconds: number;
  providers: ProviderView[];
};

type CachedOverview = {
  at: number;
  data: Overview;
};

type RenderSeriesValue = {
  timestamp?: string;
  value?: number;
};

type RenderSeries = {
  unit?: string;
  values?: RenderSeriesValue[];
};

export class ObservabilityService {
  private cache: CachedOverview | null = null;
  private inFlight: Promise<Overview> | null = null;

  public async getOverview(force = false): Promise<Overview> {
    if (!force && this.cache && Date.now() - this.cache.at < CACHE_TTL_MS) {
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
    const providers = await Promise.all([
      this.loadProvider('neon', 'Neon', 'Postgres gerenciado', () => this.getNeon()),
      this.loadProvider('render', 'Render', 'Hospedagem da API', () => this.getRender()),
      this.loadProvider('vercel', 'Vercel', 'Hospedagem do painel', () => this.getVercel()),
      this.loadProvider('github', 'GitHub', 'CI/CD e Actions', () => this.getGithub()),
    ]);

    const data: Overview = {
      generatedAt: new Date().toISOString(),
      cached: false,
      cacheTtlSeconds: CACHE_TTL_MS / 1000,
      providers,
    };

    this.cache = { at: Date.now(), data };

    return data;
  }

  private async loadProvider(
    id: string,
    name: string,
    description: string,
    loader: () => Promise<ProviderView>,
  ): Promise<ProviderView> {
    try {
      return await loader();
    } catch (error) {
      logger.error(`${name}: ${this.describeError(error)}`);
      return this.errorView(id, name, description, error);
    }
  }

  private async getNeon(): Promise<ProviderView> {
    const apiKey = this.env('NEON_API_KEY');
    const projectId = this.env('NEON_PROJECT_ID');
    const configured = Boolean(apiKey && projectId);

    if (!configured) {
      return this.missingView(
        'neon',
        'Neon',
        'Postgres gerenciado',
        ['NEON_API_KEY', 'NEON_PROJECT_ID'],
        'Configure a chave da API e o ID do projeto para acompanhar storage, compute e egress.',
      );
    }

    const client = this.client(NEON_API_URL, { Authorization: `Bearer ${apiKey}` });
    const projectResponse = await client.get(`/projects/${projectId}`);
    const project = projectResponse.data?.project ?? projectResponse.data;

    if (!project?.id) {
      throw new Error('Projeto Neon não encontrado na resposta da API.');
    }

    const orgId = project.org_id || this.env('NEON_ORG_ID');
    const notes: string[] = [];
    let partial = false;
    let plan: string | null = null;
    let branches: any[] = [];

    const [branchesResult, orgResult] = await Promise.allSettled([
      client.get(`/projects/${projectId}/branches`),
      orgId ? client.get(`/organizations/${orgId}`) : Promise.resolve(null),
    ]);

    const branchesLoaded = branchesResult.status === 'fulfilled';
    if (branchesLoaded) {
      branches = branchesResult.value?.data?.branches ?? [];
    } else {
      partial = true;
      notes.push('Não foi possível ler as branches; o armazenamento pode estar incompleto.');
    }

    if (orgResult.status === 'fulfilled' && orgResult.value) {
      plan = orgResult.value.data?.plan ?? null;
    } else if (orgId) {
      partial = true;
      notes.push('Não foi possível confirmar o plano da organização.');
    }

    const storageUsed = branchesLoaded
      ? branches.reduce((total, branch) => total + Number(branch.logical_size ?? 0), 0)
      : null;
    const isFree = String(plan ?? '').toLowerCase() === 'free';
    const storageLimit = isFree
      ? 1024 * 1024 * 1024
      : Number(project.branch_logical_size_limit_bytes) ||
        Number(project.branch_logical_size_limit) * 1024 * 1024 ||
        null;
    const computeSeconds = Number(project.compute_time_seconds ?? project.cpu_used_sec ?? 0);
    const activeSeconds = Number(project.active_time_seconds ?? project.active_time ?? 0);
    const egressBytes = Number(project.data_transfer_bytes ?? 0);
    const freeComputeLimit = isFree ? 100 : null;
    const freeEgressLimit = isFree ? 5 * 1024 * 1024 * 1024 : null;
    const freeBranchesLimit = isFree ? 10 : null;
    const periodEnd = project.consumption_period_end || project.quota_reset_at;

    notes.push('Os números refletem o período de consumo atual e podem ter atraso.');
    if (periodEnd) {
      notes.push(`O período atual termina em ${new Date(periodEnd).toLocaleString('pt-BR')}.`);
    }
    if (isFree) {
      notes.push('Limites do Neon Free: 100 CU-horas, 1 GB de storage e 5 GB de egress por projeto.');
    }

    return {
      id: 'neon',
      name: 'Neon',
      description: 'Postgres gerenciado',
      configured: true,
      plan,
      status: partial ? 'partial' : 'ok',
      updatedAt: new Date().toISOString(),
      metrics: [
        this.metric(
          'storage',
          'Armazenamento',
          storageUsed,
          storageLimit,
          'bytes',
          'Soma do logical_size das branches',
        ),
        this.metric(
          'compute',
          'Compute',
          computeSeconds / 3600,
          freeComputeLimit,
          'cu_hours',
          'Compute time acumulado no período',
        ),
        this.metric('egress', 'Egress', egressBytes, freeEgressLimit, 'bytes', 'Transferência pública de saída'),
        this.metric('active_time', 'Tempo ativo', activeSeconds / 3600, null, 'hours', 'Wall-clock dos endpoints'),
        this.metric(
          'branches',
          'Branches',
          branchesLoaded ? branches.length : null,
          freeBranchesLimit,
          'count',
          'Branches ativas',
        ),
      ],
      resources: [
        {
          id: project.id,
          name: project.name,
          type: 'Postgres',
          status: activeSeconds > 0 ? 'active' : 'idle',
          plan,
          region: project.region_id,
          detail:
            activeSeconds > 0
              ? `Tempo ativo no período: ${this.formatNumber(activeSeconds / 3600)} h`
              : 'Sem atividade registrada no período.',
        },
      ],
      notes,
      links: [
        { label: 'Abrir Neon', url: `https://console.neon.tech/app/projects/${projectId}` },
        { label: 'Ver branches', url: `https://console.neon.tech/app/projects/${projectId}/branches` },
      ],
    };
  }

  private async getRender(): Promise<ProviderView> {
    const apiKey = this.env('RENDER_API_KEY');
    const configured = Boolean(apiKey);

    if (!configured) {
      return this.missingView(
        'render',
        'Render',
        'Hospedagem da API',
        ['RENDER_API_KEY'],
        'A API do Render permite listar serviços, deploys e métricas. O medidor de billing continua no dashboard.',
      );
    }

    const client = this.client(RENDER_API_URL, { Authorization: `Bearer ${apiKey}` });
    let ownerId = this.env('RENDER_OWNER_ID');
    let ownerName = ownerId;

    if (!ownerId) {
      const ownersResponse = await client.get('/owners', { params: { limit: 20 } });
      const owners = (ownersResponse.data ?? []).map((item) => item?.owner ?? item);
      const owner = owners[0];

      if (!owner?.id) {
        throw new Error('Nenhum workspace do Render foi encontrado para esta chave.');
      }

      ownerId = owner.id;
      ownerName = owner.name;
    }

    const serviceFilter = new Set(
      (this.env('RENDER_SERVICE_IDS') ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    );

    const servicesResponse = await client.get('/services', { params: { ownerId, limit: 100 } });
    const services = (servicesResponse.data ?? [])
      .map((item) => item?.service ?? item)
      .filter((service) => service?.id && (serviceFilter.size === 0 || serviceFilter.has(service.id)));

    if (services.length === 0) {
      return {
        ...this.missingView(
          'render',
          'Render',
          'Hospedagem da API',
          ['RENDER_API_KEY'],
          'Nenhum serviço foi encontrado para este workspace.',
        ),
        configured: true,
        status: 'partial',
      };
    }

    const notes: string[] = [];
    const resources: Resource[] = [];
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0));
    let instanceHours = 0;
    let estimated = false;
    let allFree = true;
    let metricsFailed = false;

    for (const service of services) {
      const details = service.serviceDetails ?? {};
      const plan = details.plan ?? null;
      const isFree = String(plan ?? '').toLowerCase() === 'free';
      allFree = allFree && isFree;

      let latestDeploy = null;
      try {
        const deployResponse = await client.get(`/services/${service.id}/deploys`, { params: { limit: 1 } });
        latestDeploy = deployResponse.data?.[0]?.deploy ?? deployResponse.data?.[0] ?? null;
      } catch {
        notes.push(`Não foi possível ler o último deploy de ${service.name}.`);
      }

      const [cpu, memory, bandwidth, hours] = await Promise.allSettled([
        this.renderLatestMetric(client, 'cpu', service.id, now),
        this.renderLatestMetric(client, 'memory', service.id, now),
        this.renderLatestMetric(client, 'bandwidth', service.id, now),
        this.renderInstanceHours(client, service.id, monthStart, now),
      ]);

      if (cpu.status === 'rejected' || memory.status === 'rejected' || bandwidth.status === 'rejected') {
        metricsFailed = true;
      }

      if (hours.status === 'fulfilled' && hours.value !== null) {
        instanceHours += hours.value;
        estimated = true;
      }

      const parts: string[] = [];
      if (cpu.status === 'fulfilled' && cpu.value) {
        parts.push(`CPU ${this.formatNumber(cpu.value.value)}${cpu.value.unit ? ` ${cpu.value.unit}` : ''}`);
      }
      if (memory.status === 'fulfilled' && memory.value) {
        parts.push(
          `Memória ${this.formatNumber(memory.value.value)}${memory.value.unit ? ` ${memory.value.unit}` : ''}`,
        );
      }
      if (bandwidth.status === 'fulfilled' && bandwidth.value) {
        parts.push(
          `Rede ${this.formatNumber(bandwidth.value.value)}${bandwidth.value.unit ? ` ${bandwidth.value.unit}` : ''}`,
        );
      }
      if (latestDeploy?.status) {
        parts.push(`Deploy ${String(latestDeploy.status).toLowerCase()}`);
      }

      resources.push({
        id: service.id,
        name: service.name,
        type: service.type,
        status: service.suspended === 'suspended' ? 'suspenso' : latestDeploy?.status || 'sem deploy',
        plan,
        region: details.region,
        url: details.url,
        detail: parts.join(' • '),
      });
    }

    if (metricsFailed) {
      notes.push('Algumas métricas do Render não puderam ser lidas agora.');
    }
    if (estimated) {
      notes.push(
        'As horas de instância são uma estimativa a partir do instance-count; o medidor oficial fica no dashboard.',
      );
    }
    notes.push('A API pública do Render não expõe o consumo mensal de billing (bandwidth e build minutes).');

    return {
      id: 'render',
      name: 'Render',
      description: 'Hospedagem da API',
      configured: true,
      plan: allFree ? 'Free' : 'Pago',
      status: metricsFailed ? 'partial' : 'ok',
      updatedAt: new Date().toISOString(),
      metrics: [
        this.metric('services', 'Serviços', services.length, null, 'count', 'Serviços monitorados'),
        this.metric(
          'instance_hours',
          'Horas de instância',
          estimated ? instanceHours : null,
          allFree ? 750 : null,
          'hours',
          'Estimativa do mês corrente',
        ),
      ],
      resources,
      notes,
      links: [
        { label: 'Abrir Render', url: 'https://dashboard.render.com/' },
        ...(ownerName ? [{ label: 'Workspace', url: 'https://dashboard.render.com/' }] : []),
      ],
    };
  }

  private async getVercel(): Promise<ProviderView> {
    const token = this.env('VERCEL_TOKEN');
    const teamId = this.env('VERCEL_TEAM_ID');
    const projectId = this.env('VERCEL_PROJECT_ID');
    const configured = Boolean(token && teamId && projectId);

    if (!configured) {
      return this.missingView(
        'vercel',
        'Vercel',
        'Hospedagem do painel',
        ['VERCEL_TOKEN', 'VERCEL_TEAM_ID', 'VERCEL_PROJECT_ID'],
        'No plano Hobby a Vercel não expõe o consumo via API; o painel mostra plano, deploys e builds recentes.',
      );
    }

    const client = this.client(VERCEL_API_URL, { Authorization: `Bearer ${token}` });
    const [teamResponse, projectResponse, deploymentsResponse] = await Promise.all([
      client.get(`/v2/teams/${teamId}`),
      client.get(`/v9/projects/${projectId}`, { params: { teamId } }),
      client.get('/v6/deployments', { params: { projectId, teamId, limit: 100 } }),
    ]);

    const team = teamResponse.data;
    const project = projectResponse.data;
    const deployments = deploymentsResponse.data?.deployments ?? [];
    const latest = deployments[0];
    const plan = team?.billing?.plan ?? null;
    const since = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const recent = deployments.filter((deployment) => Number(deployment.created) >= since);
    const buildMilliseconds = recent.reduce((total, deployment) => {
      if (!deployment.ready || !deployment.buildingAt) return total;
      return total + Math.max(0, Number(deployment.ready) - Number(deployment.buildingAt));
    }, 0);
    const lastBuildMilliseconds =
      latest?.ready && latest?.buildingAt ? Math.max(0, Number(latest.ready) - Number(latest.buildingAt)) : null;
    const domains = (project?.alias ?? []).map((alias) => alias.domain).filter(Boolean);

    return {
      id: 'vercel',
      name: 'Vercel',
      description: 'Hospedagem do painel',
      configured: true,
      plan,
      status: 'ok',
      updatedAt: new Date().toISOString(),
      metrics: [
        this.metric('deployments', 'Deploys (30 dias)', recent.length, null, 'count', 'Deploys retornados pela API'),
        this.metric(
          'build_minutes',
          'Builds (30 dias)',
          buildMilliseconds / 60000,
          null,
          'minutes',
          'Soma dos builds recentes; não é o medidor oficial',
        ),
        this.metric(
          'last_build',
          'Último build',
          lastBuildMilliseconds === null ? null : lastBuildMilliseconds / 60000,
          null,
          'minutes',
          latest?.url ? `Deploy: ${latest.readyState || latest.state}` : undefined,
        ),
      ],
      resources: [
        {
          id: project?.id ?? projectId,
          name: project?.name ?? 'Projeto Vercel',
          type: 'Projeto',
          status: latest?.readyState || latest?.state || 'sem deploy',
          plan,
          region: undefined,
          url: latest?.url ? `https://${latest.url}` : undefined,
          detail: domains.length ? `Domínios: ${domains.join(', ')}` : undefined,
        },
      ],
      notes: [
        'A API de uso da Vercel exige plano Pro/Enterprise; no Hobby, o consumo oficial fica no dashboard.',
        'Os builds abaixo são calculados a partir do histórico de deploys retornado pela API.',
      ],
      links: [
        {
          label: 'Abrir projeto',
          url: `https://vercel.com/${team?.slug ?? teamId}/${project?.name ?? ''}`,
        },
        {
          label: 'Ver usage',
          url: `https://vercel.com/${team?.slug ?? teamId}/${project?.name ?? ''}/usage`,
        },
      ],
    };
  }

  private async getGithub(): Promise<ProviderView> {
    const token = this.env('GITHUB_TOKEN');
    const owner = this.env('GITHUB_OWNER') ?? 'devconnecting1';
    const repo = this.env('GITHUB_REPO') ?? 'evolution-api-render';
    const configured = Boolean(token);

    if (!configured) {
      return this.missingView(
        'github',
        'GitHub',
        'CI/CD e Actions',
        ['GITHUB_TOKEN'],
        'Opcional. Use um token com permissão de billing para ver os minutos de Actions.',
      );
    }

    const client = this.client(GITHUB_API_URL, {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    });

    try {
      const billingResponse = await client.get(`/users/${owner}/settings/billing/actions`);
      const billing = billingResponse.data ?? {};
      const used = Number(billing.total_minutes_used ?? 0);
      const limit = Number(billing.included_minutes ?? 2000);

      return {
        id: 'github',
        name: 'GitHub',
        description: 'CI/CD e Actions',
        configured: true,
        plan: 'Free',
        status: 'ok',
        updatedAt: new Date().toISOString(),
        metrics: [this.metric('actions_minutes', 'Minutos de Actions', used, limit, 'minutes', 'Uso do mês corrente')],
        resources: [
          {
            id: `${owner}/${repo}`,
            name: `${owner}/${repo}`,
            type: 'Repositório',
            status: 'privado',
            detail: billing.total_paid_minutes_used
              ? `${billing.total_paid_minutes_used} minutos pagos`
              : 'Sem minutos pagos no período',
          },
        ],
        notes: ['O repositório privado inclui 2.000 minutos de Actions por mês.'],
        links: [
          { label: 'Ver Actions', url: `https://github.com/${owner}/${repo}/actions` },
          { label: 'Billing', url: 'https://github.com/settings/billing/actions' },
        ],
      };
    } catch {
      return {
        id: 'github',
        name: 'GitHub',
        description: 'CI/CD e Actions',
        configured: true,
        plan: 'Free',
        status: 'partial',
        updatedAt: new Date().toISOString(),
        metrics: [],
        resources: [
          {
            id: `${owner}/${repo}`,
            name: `${owner}/${repo}`,
            type: 'Repositório',
            status: 'privado',
          },
        ],
        notes: [
          'O token atual não tem permissão para ler o billing de Actions.',
          'Adicione o escopo manage_billing:read para ver os minutos consumidos.',
        ],
        links: [{ label: 'Ver Actions', url: `https://github.com/${owner}/${repo}/actions` }],
      };
    }
  }

  private async renderLatestMetric(
    client: AxiosInstance,
    metric: 'cpu' | 'memory' | 'bandwidth',
    resourceId: string,
    now: Date,
  ): Promise<{ value: number; unit: string } | null> {
    const start = new Date(now.getTime() - 30 * 60 * 1000);
    const data = await client.get(`/metrics/${metric}`, {
      params: {
        resource: resourceId,
        startTime: start.toISOString(),
        endTime: now.toISOString(),
        resolutionSeconds: 300,
      },
    });

    const series: RenderSeries[] = Array.isArray(data.data) ? data.data : [];
    const values = series.flatMap((item) => item?.values ?? []);
    const last = values[values.length - 1];

    if (!last || typeof last.value !== 'number') {
      return null;
    }

    return { value: last.value, unit: series[0]?.unit ?? '' };
  }

  private async renderInstanceHours(
    client: AxiosInstance,
    resourceId: string,
    monthStart: Date,
    now: Date,
  ): Promise<number | null> {
    const data = await client.get('/metrics/instance-count', {
      params: {
        resource: resourceId,
        startTime: monthStart.toISOString(),
        endTime: now.toISOString(),
        resolutionSeconds: 3600,
      },
    });

    const series: RenderSeries[] = Array.isArray(data.data) ? data.data : [];
    const values = series.flatMap((item) => item?.values ?? []);

    if (values.length === 0) {
      return null;
    }

    return values.reduce((total, item) => total + (typeof item.value === 'number' ? item.value : 0), 0);
  }

  private metric(
    id: string,
    label: string,
    used: number | null,
    limit: number | null,
    unit: MetricUnit,
    detail?: string,
  ): Metric {
    const safeUsed = typeof used === 'number' && Number.isFinite(used) ? used : null;
    const safeLimit = typeof limit === 'number' && Number.isFinite(limit) && limit > 0 ? limit : null;
    const percent = safeUsed !== null && safeLimit !== null ? (safeUsed / safeLimit) * 100 : null;

    let status: MetricStatus = 'unknown';
    if (safeUsed !== null) {
      status = 'ok';
      if (percent !== null && percent >= 95) status = 'critical';
      else if (percent !== null && percent >= 75) status = 'warning';
    }

    return {
      id,
      label,
      used: safeUsed,
      limit: safeLimit,
      unit,
      percent: percent === null ? null : this.round(percent, 2),
      status,
      detail,
    };
  }

  private client(baseURL: string, headers: Record<string, string>): AxiosInstance {
    return axios.create({
      baseURL,
      headers,
      timeout: 15000,
    });
  }

  private missingView(id: string, name: string, description: string, envNames: string[], note: string): ProviderView {
    return {
      id,
      name,
      description,
      configured: false,
      plan: null,
      status: 'missing',
      updatedAt: new Date().toISOString(),
      metrics: [],
      resources: [],
      notes: [note, `Variáveis necessárias: ${envNames.join(', ')}.`],
      links: [],
    };
  }

  private errorView(id: string, name: string, description: string, error: unknown): ProviderView {
    return {
      id,
      name,
      description,
      configured: true,
      plan: null,
      status: 'error',
      updatedAt: new Date().toISOString(),
      metrics: [],
      resources: [],
      notes: [],
      links: [],
      error: this.describeError(error),
    };
  }

  private describeError(error: unknown): string {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const code = (error.response?.data as any)?.error?.code;

      if (status === 401 || status === 403) return 'Credencial inválida ou sem permissão.';
      if (status === 429) return 'Limite de consultas do provedor atingido.';
      if (status) return `Falha na API do provedor (HTTP ${status}${code ? `: ${code}` : ''}).`;
      return 'O provedor não respondeu dentro do tempo esperado.';
    }

    return error instanceof Error ? error.message : 'Falha ao consultar o provedor.';
  }

  private env(name: string): string | undefined {
    const value = process.env[name]?.trim();
    return value || undefined;
  }

  private formatNumber(value: number): string {
    return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(value);
  }

  private round(value: number, digits: number): number {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
  }
}

export const observabilityService = new ObservabilityService();
