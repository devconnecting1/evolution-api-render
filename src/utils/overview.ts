/**
 * "Visão Geral com o resultado do escritório": period arithmetic of the overview route.
 *
 * The API counts the days in the time zone of the instance (the same one of "Plano e limites" and of the agenda),
 * never in UTC: a lead created at 22:00 in São Paulo belongs to that day, not to the next one. Only pure helpers
 * live here; the queries are in src/api/services/overview.service.ts.
 */
import { DEFAULT_TIMEZONE, isValidTimeZone, lastDays, shiftDay, zonedParts } from './usageLimits';

/** The period selector of the panel. Anything else is refused (400). */
export const OVERVIEW_PERIODS = [7, 30] as const;
export type OverviewPeriod = (typeof OVERVIEW_PERIODS)[number];

/** The route accepts ?days=7 or ?days=30; absent means 7. */
export function parseOverviewDays(value: unknown): OverviewPeriod | null {
  if (value === undefined || value === null || value === '') return 7;
  const days = Number(value);
  return (OVERVIEW_PERIODS as readonly number[]).includes(days) ? (days as OverviewPeriod) : null;
}

/** The label shown under the comparison ("vs. 7 dias anteriores", "vs. 30 dias anteriores"). */
export function previousPeriodLabel(days: OverviewPeriod): string {
  return days === 7 ? 'vs. 7 dias anteriores' : 'vs. 30 dias anteriores';
}

/**
 * The UTC instant of 00:00 of a local day ("YYYY-MM-DD") in the given time zone. Two iterations are enough for every
 * IANA zone (the second one also settles the DST transition days); an invalid zone falls back to America/Sao_Paulo,
 * as everywhere else in the project.
 */
export function zonedDayStart(day: string, timeZone: string = DEFAULT_TIMEZONE): Date {
  const zone = isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIMEZONE;
  const [year, month, date] = day.split('-').map(Number);
  const desired = Date.UTC(year, month - 1, date, 0, 0, 0, 0);
  let guess = desired;
  for (let i = 0; i < 3; i++) {
    const parts = zonedParts(new Date(guess), zone);
    const [py, pm, pd] = parts.day.split('-').map(Number);
    const actual = Date.UTC(py, pm - 1, pd, Math.floor(parts.minutes / 60), parts.minutes % 60, 0, 0);
    const delta = desired - actual;
    if (delta === 0) break;
    guess += delta;
  }
  return new Date(guess);
}

/** "HH:MM" of an instant in the office time zone (the agenda of the day uses it). */
export function zonedTime(date: Date, timeZone: string = DEFAULT_TIMEZONE): string {
  const zone = isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIMEZONE;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const hour = parts.find((part) => part.type === 'hour')?.value ?? '00';
  const minute = parts.find((part) => part.type === 'minute')?.value ?? '00';
  return `${hour}:${minute}`;
}

/** The local day ("YYYY-MM-DD") of an instant. */
export function zonedDay(date: Date, timeZone: string = DEFAULT_TIMEZONE): string {
  return zonedParts(date, timeZone).day;
}

export type OverviewRange = {
  /** First day of the current period, inclusive. */
  from: string;
  /** Last day of the current period (today), inclusive. */
  to: string;
  /** First day of the previous period, inclusive. */
  previousFrom: string;
  /** Last day of the previous period, inclusive. */
  previousTo: string;
};

/** Current period (last `days` days ending today) and the previous one (the `days` days before it). */
export function overviewRange(today: string, days: OverviewPeriod): OverviewRange {
  return {
    from: shiftDay(today, days - 1),
    to: today,
    previousFrom: shiftDay(today, 2 * days - 1),
    previousTo: shiftDay(today, days),
  };
}

/** The days of the period, oldest first (zero-filled by the service). */
export function overviewDays(range: Pick<OverviewRange, 'from' | 'to'>): string[] {
  const count = Math.round((Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) / 86_400_000);
  return lastDays(range.to, count + 1);
}

/** Delta and percentage against the previous period; both null when there is nothing to compare with. */
export function overviewVariation(
  current: number,
  previous: number | null,
): { delta: number; percent: number | null } | null {
  if (previous === null) return null;
  const delta = current - previous;
  if (previous === 0) return { delta, percent: delta === 0 ? 0 : null };
  return { delta, percent: Math.round((delta / previous) * 1000) / 10 };
}
