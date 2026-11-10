/**
 * Types and helpers shared by the observability providers (`observability.service.ts`) and the local
 * "Sistema" probe (`observability.system.ts`). The Manager renders every provider generically from this shape.
 */
export type ProviderStatus = 'ok' | 'partial' | 'missing' | 'error';
export type MetricStatus = 'ok' | 'warning' | 'critical' | 'unknown';
export type MetricUnit = 'bytes' | 'hours' | 'cu_hours' | 'count' | 'minutes' | 'number';

export type Metric = {
  id: string;
  label: string;
  used: number | null;
  limit: number | null;
  unit: MetricUnit;
  percent: number | null;
  status: MetricStatus;
  detail?: string;
  /** The limit is a target, not a quota (e.g. connected instances): never listed as an alert. */
  higherIsBetter?: boolean;
  /** Percent from which the metric is listed in the alerts (default ALERT_PERCENT), e.g. the plan alertPercent. */
  alertAt?: number;
};

export type Resource = {
  id: string;
  name: string;
  type?: string;
  status?: string;
  plan?: string;
  region?: string;
  url?: string;
  detail?: string;
};

export type ProviderLink = { label: string; url: string };

export type ProviderView = {
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
  links: ProviderLink[];
  /** Alerts the provider raises itself (not from a metric percent), e.g. an OpenAI key without credit. */
  extraAlerts?: Alert[];
  /** Only for `status: 'missing'`: the environment variables that are not set (all of them are needed). */
  missingEnv?: string[];
  error?: string;
};

/** From this percent of a limit a metric is listed in the overview `alerts` and in the card notes. */
export const ALERT_PERCENT = 80;

export type Alert = {
  provider: string;
  metric: string;
  label: string;
  percent: number;
  status: MetricStatus;
  message: string;
};

export type MetricOptions = {
  detail?: string;
  /** Percent of the limit from which the metric is `warning` (default 80, the alert threshold of the page). */
  warnAt?: number;
  /** Percent of the limit from which the metric is `critical` (default 95). */
  criticalAt?: number;
  /** Forces the status (e.g. when "more is better", like connected instances). */
  status?: MetricStatus;
  /** See `Metric.higherIsBetter`. */
  higherIsBetter?: boolean;
  /** See `Metric.alertAt`. */
  alertAt?: number;
};

export const round = (value: number, digits: number): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

export const finite = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
};

export function buildMetric(
  id: string,
  label: string,
  used: number | null,
  limit: number | null,
  unit: MetricUnit,
  options: MetricOptions | string = {},
): Metric {
  const opts: MetricOptions = typeof options === 'string' ? { detail: options } : options;
  const safeUsed = finite(used);
  const rawLimit = finite(limit);
  const safeLimit = rawLimit !== null && rawLimit > 0 ? rawLimit : null;
  const percent = safeUsed !== null && safeLimit !== null ? (safeUsed / safeLimit) * 100 : null;

  let status: MetricStatus = 'unknown';
  if (safeUsed !== null) {
    status = 'ok';
    if (percent !== null && percent >= (opts.criticalAt ?? 95)) status = 'critical';
    else if (percent !== null && percent >= (opts.warnAt ?? ALERT_PERCENT)) status = 'warning';
  }
  if (opts.status) status = opts.status;

  return {
    id,
    label,
    used: safeUsed === null ? null : round(safeUsed, 4),
    limit: safeLimit,
    unit,
    percent: percent === null ? null : round(percent, 2),
    status,
    ...(opts.detail ? { detail: opts.detail } : {}),
    ...(opts.higherIsBetter ? { higherIsBetter: true } : {}),
    ...(opts.alertAt !== undefined ? { alertAt: opts.alertAt } : {}),
  };
}

export const formatNumber = (value: number, digits = 2): string =>
  new Intl.NumberFormat('pt-BR', { maximumFractionDigits: digits }).format(value);

export const formatBytes = (value: number | null): string => {
  if (value === null || !Number.isFinite(value)) return '—';
  if (value === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(Math.abs(value)) / Math.log(1024)), units.length - 1);
  return `${formatNumber(value / 1024 ** i, i === 0 ? 0 : 1)} ${units[i]}`;
};

/** Worst metric status, ignoring `unknown`. */
export const worstStatus = (metrics: Metric[]): MetricStatus => {
  const order: MetricStatus[] = ['ok', 'warning', 'critical'];
  return metrics.reduce<MetricStatus>((worst, metric) => {
    if (metric.status === 'unknown') return worst;
    return order.indexOf(metric.status) > order.indexOf(worst) ? metric.status : worst;
  }, 'ok');
};

/** Never lets a provider hang the overview: rejects after `ms` with a short message. */
export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
