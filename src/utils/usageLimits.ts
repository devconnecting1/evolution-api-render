/**
 * "Plano e limites": pure helpers (no I/O) shared by the usage service, the REST routes, the MCP tools and the
 * tests. Periods are calendar days/months in the instance time zone (business hours timezone, default
 * America/Sao_Paulo), so "today" and "this month" match what the customer sees on the clock.
 */

export type OverLimitAction = 'continue' | 'pause' | 'message';
export type HoursMode = 'always' | 'inside' | 'outside';
export type DayKey = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat';
export type TimeRange = [string, string];
export type WeekSchedule = Record<DayKey, TimeRange[]>;

export type BusinessHours = {
  enabled: boolean;
  /** always: the AI answers at any time; inside: only inside the schedule; outside: only outside it. */
  mode: HoursMode;
  timezone: string;
  week: WeekSchedule;
};

export type UsageLimits = {
  planName: string | null;
  /** null = no limit. */
  monthlyResponses: number | null;
  dailyResponses: number | null;
  perContactDailyResponses: number | null;
  overLimitAction: OverLimitAction;
  overLimitMessage: string | null;
  alertPercent: number;
  businessHours: BusinessHours;
  outsideHoursMessage: string | null;
  updatedAt: string | null;
};

/** Index = Date#getDay() (0 = Sunday). */
export const DAY_KEYS: DayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
export const DAY_LABELS: Record<DayKey, string> = {
  sun: 'domingo',
  mon: 'segunda',
  tue: 'terça',
  wed: 'quarta',
  thu: 'quinta',
  fri: 'sexta',
  sat: 'sábado',
};

export const DEFAULT_TIMEZONE = 'America/Sao_Paulo';
export const DEFAULT_ALERT_PERCENT = 80;
export const OVER_LIMIT_ACTIONS: OverLimitAction[] = ['continue', 'pause', 'message'];
export const HOURS_MODES: HoursMode[] = ['always', 'inside', 'outside'];
export const PLAN_NAMES = ['Essencial', 'Profissional', 'Premium', 'Personalizado'] as const;
/** Monthly AI answers included in each plan (readmes/README-COMERCIAL.md). */
export const PLAN_PRESETS: Record<string, number> = { Essencial: 2000, Profissional: 5000, Premium: 10000 };
/** Overage is billed in blocks of 1,000 answers (R$ 49 each). */
export const OVERAGE_BLOCK = 1000;
export const OVERAGE_BLOCK_PRICE_BRL = 49;
export const MAX_RANGES_PER_DAY = 4;
export const MAX_MESSAGE_CHARS = 1000;

/** Counter rows (UsageCounter.type). */
export const COUNTER_MONTH = 'month';
export const COUNTER_DAY = 'day';
export const COUNTER_CONTACT = 'contact';

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/;

export function defaultWeek(): WeekSchedule {
  const weekday: TimeRange[] = [['09:00', '18:00']];
  return {
    sun: [],
    mon: weekday.map((range) => [...range] as TimeRange),
    tue: weekday.map((range) => [...range] as TimeRange),
    wed: weekday.map((range) => [...range] as TimeRange),
    thu: weekday.map((range) => [...range] as TimeRange),
    fri: weekday.map((range) => [...range] as TimeRange),
    sat: [],
  };
}

export function defaultBusinessHours(): BusinessHours {
  return { enabled: false, mode: 'always', timezone: DEFAULT_TIMEZONE, week: defaultWeek() };
}

/** No row in InstanceLimits: nothing is limited (the behaviour before this feature). */
export function defaultLimits(): UsageLimits {
  return {
    planName: null,
    monthlyResponses: null,
    dailyResponses: null,
    perContactDailyResponses: null,
    overLimitAction: 'continue',
    overLimitMessage: null,
    alertPercent: DEFAULT_ALERT_PERCENT,
    businessHours: defaultBusinessHours(),
    outsideHoursMessage: null,
    updatedAt: null,
  };
}

export function isValidTimeZone(timeZone: unknown): boolean {
  if (typeof timeZone !== 'string' || !timeZone || timeZone.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

const positiveOrNull = (value: unknown): number | null => {
  const n = typeof value === 'number' ? value : value === null || value === undefined ? NaN : Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const textOrNull = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, MAX_MESSAGE_CHARS) : null;

function normalizeWeek(value: unknown): WeekSchedule {
  const source = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const week = {} as WeekSchedule;
  for (const day of DAY_KEYS) {
    const ranges = Array.isArray(source[day]) ? (source[day] as unknown[]) : [];
    week[day] = ranges
      .filter(
        (range): range is [string, string] =>
          Array.isArray(range) &&
          range.length === 2 &&
          TIME_REGEX.test(String(range[0])) &&
          TIME_REGEX.test(String(range[1])) &&
          range[0] !== '24:00',
      )
      .slice(0, MAX_RANGES_PER_DAY)
      .map(([start, end]) => [String(start), String(end)] as TimeRange);
  }
  return week;
}

export function normalizeBusinessHours(value: unknown): BusinessHours {
  if (!value || typeof value !== 'object') return defaultBusinessHours();
  const raw = value as Record<string, unknown>;
  return {
    enabled: raw.enabled === true,
    mode: HOURS_MODES.includes(raw.mode as HoursMode) ? (raw.mode as HoursMode) : 'always',
    timezone: isValidTimeZone(raw.timezone) ? String(raw.timezone) : DEFAULT_TIMEZONE,
    week: raw.week === undefined ? defaultWeek() : normalizeWeek(raw.week),
  };
}

/** A stored row (or anything else) as a complete, safe UsageLimits object. */
export function normalizeLimits(row: any): UsageLimits {
  if (!row || typeof row !== 'object') return defaultLimits();
  const alert = Number(row.alertPercent);
  return {
    planName: typeof row.planName === 'string' && row.planName.trim() ? row.planName.trim().slice(0, 30) : null,
    monthlyResponses: positiveOrNull(row.monthlyResponses),
    dailyResponses: positiveOrNull(row.dailyResponses),
    perContactDailyResponses: positiveOrNull(row.perContactDailyResponses),
    overLimitAction: OVER_LIMIT_ACTIONS.includes(row.overLimitAction) ? row.overLimitAction : 'continue',
    overLimitMessage: textOrNull(row.overLimitMessage),
    alertPercent: Number.isInteger(alert) && alert >= 1 && alert <= 100 ? alert : DEFAULT_ALERT_PERCENT,
    businessHours: normalizeBusinessHours(row.businessHours),
    outsideHoursMessage: textOrNull(row.outsideHoursMessage),
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
  };
}

/** Whether these limits change anything compared with having no row at all. */
export function hasAnyLimit(limits: UsageLimits): boolean {
  return (
    limits.monthlyResponses !== null ||
    limits.dailyResponses !== null ||
    limits.perContactDailyResponses !== null ||
    (limits.businessHours.enabled && limits.businessHours.mode !== 'always')
  );
}

/** Semantic checks the JSON schema cannot express. Messages in Brazilian Portuguese, for the operator. */
export function validateLimits(limits: UsageLimits): string[] {
  const errors: string[] = [];
  const hours = limits.businessHours;

  for (const day of DAY_KEYS) {
    for (const [start, end] of hours.week[day]) {
      if (start === end) errors.push(`Faixa sem duração na ${DAY_LABELS[day]}: ${start}–${end}.`);
    }
  }

  if (hours.enabled && hours.mode !== 'always' && DAY_KEYS.every((day) => !hours.week[day].length)) {
    errors.push('Defina pelo menos um horário de atendimento ou escolha "IA responde sempre".');
  }

  if (limits.overLimitAction === 'message' && !limits.overLimitMessage) {
    errors.push('Informe a mensagem para o cliente quando a ação for "enviar uma mensagem".');
  }

  if (
    limits.dailyResponses !== null &&
    limits.perContactDailyResponses !== null &&
    limits.perContactDailyResponses > limits.dailyResponses
  ) {
    errors.push('O limite por contato por dia não pode ser maior que o limite diário.');
  }

  return errors;
}

/** Raw request checks done before normalizing (normalize would silently drop these). */
export function validateLimitsInput(input: any): string[] {
  const errors: string[] = [];
  const hours = input?.businessHours;
  if (hours && typeof hours === 'object') {
    if (hours.timezone !== undefined && !isValidTimeZone(hours.timezone)) {
      errors.push(
        `Fuso horário inválido: "${String(hours.timezone).slice(0, 64)}". Use um nome IANA, por exemplo America/Sao_Paulo.`,
      );
    }
    const week = hours.week && typeof hours.week === 'object' ? hours.week : {};
    for (const day of DAY_KEYS) {
      for (const range of Array.isArray(week[day]) ? week[day] : []) {
        if (Array.isArray(range) && range[0] === '24:00') {
          errors.push(`Horário inválido na ${DAY_LABELS[day]}: 24:00 só pode ser o fim de uma faixa.`);
        }
      }
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------------------------- time

export type ZonedParts = {
  /** 0 = Sunday. */
  weekday: number;
  /** Minutes since midnight, 0..1439. */
  minutes: number;
  /** YYYY-MM-DD */
  day: string;
  /** YYYY-MM */
  month: string;
};

const formatters = new Map<string, Intl.DateTimeFormat>();
const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
      hourCycle: 'h23',
    });
    // Only valid zones get here (normalizeBusinessHours); a handful at most
    if (formatters.size < 50) formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** Calendar date, weekday and minute of `date` in `timeZone`. */
export function zonedParts(date: Date, timeZone: string = DEFAULT_TIMEZONE): ZonedParts {
  const zone = isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIMEZONE;
  const parts: Record<string, string> = {};
  for (const part of formatterFor(zone).formatToParts(date)) parts[part.type] = part.value;
  const hour = Number(parts.hour) % 24;
  return {
    weekday: WEEKDAYS[parts.weekday] ?? date.getUTCDay(),
    minutes: hour * 60 + Number(parts.minute),
    day: `${parts.year}-${parts.month}-${parts.day}`,
    month: `${parts.year}-${parts.month}`,
  };
}

const toMinutes = (time: string): number => {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
};

/**
 * Whether the moment falls inside the weekly schedule. A range whose end is before its start crosses midnight
 * (["22:00", "06:00"] on Monday = Monday 22:00 to Tuesday 06:00). "24:00" closes a range at midnight.
 */
export function isInsideSchedule(week: WeekSchedule, parts: Pick<ZonedParts, 'weekday' | 'minutes'>): boolean {
  const now = parts.minutes;
  for (const [start, end] of week[DAY_KEYS[parts.weekday]] ?? []) {
    const s = toMinutes(start);
    const e = toMinutes(end);
    if (s < e && now >= s && now < e) return true;
    if (s > e && now >= s) return true;
  }
  for (const [start, end] of week[DAY_KEYS[(parts.weekday + 6) % 7]] ?? []) {
    const s = toMinutes(start);
    const e = toMinutes(end);
    if (s > e && now < e) return true;
  }
  return false;
}

/** Whether the AI may answer now according to the business hours (mode always / disabled: yes). */
export function aiAllowedByHours(hours: BusinessHours, date: Date): boolean {
  if (!hours.enabled || hours.mode === 'always') return true;
  const inside = isInsideSchedule(hours.week, zonedParts(date, hours.timezone));
  return hours.mode === 'inside' ? inside : !inside;
}

/** YYYY-MM-DD `days` before (negative: after) the given YYYY-MM-DD. */
export function shiftDay(day: string, days: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - days)).toISOString().slice(0, 10);
}

/** The last `count` days ending at `today` (inclusive), oldest first. */
export function lastDays(today: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => shiftDay(today, count - 1 - index));
}

// ---------------------------------------------------------------------------------------------- gate

export type UsageCounts = { month: number; day: number; contact: number };

export type GateReason = 'ok' | 'hours' | 'contact_daily' | 'daily' | 'monthly';

export type GateDecision = {
  /** The AI may answer this message (burst). */
  allow: boolean;
  reason: GateReason;
  /** Answering beyond the monthly franchise (overLimitAction "continue"): billed as excedente. */
  overage: boolean;
  /** Message to send once per contact per day instead of the answer. */
  notice: 'hours' | 'limit' | null;
};

export const ALLOW: GateDecision = { allow: true, reason: 'ok', overage: false, notice: null };

/**
 * What to do with the next AI answer. Order: business hours, per-contact daily cap, daily cap, monthly
 * franchise. The daily caps never let the AI answer (they exist to stop loops and abuse); the monthly one
 * follows overLimitAction. With "message", the overLimitMessage is the notice of every cap.
 */
export function evaluateGate(limits: UsageLimits, counts: UsageCounts, hoursOk: boolean): GateDecision {
  const limitNotice = limits.overLimitAction === 'message' && limits.overLimitMessage ? 'limit' : null;

  if (!hoursOk) {
    const notice = limits.businessHours.mode === 'inside' && limits.outsideHoursMessage ? 'hours' : null;
    return { allow: false, reason: 'hours', overage: false, notice };
  }

  if (limits.perContactDailyResponses !== null && counts.contact >= limits.perContactDailyResponses) {
    return { allow: false, reason: 'contact_daily', overage: false, notice: limitNotice };
  }

  if (limits.dailyResponses !== null && counts.day >= limits.dailyResponses) {
    return { allow: false, reason: 'daily', overage: false, notice: limitNotice };
  }

  if (limits.monthlyResponses !== null && counts.month >= limits.monthlyResponses) {
    if (limits.overLimitAction === 'continue') return { allow: true, reason: 'monthly', overage: true, notice: null };
    return { allow: false, reason: 'monthly', overage: false, notice: limitNotice };
  }

  return ALLOW;
}

// ---------------------------------------------------------------------------------------------- summary

export const percentOf = (used: number, limit: number | null): number | null =>
  limit && limit > 0 ? Math.round((used / limit) * 1000) / 10 : null;

/** Answers above the monthly franchise, the 1,000-answer blocks they start and their estimated price. */
export function overage(responses: number, limit: number | null) {
  const excedente = limit ? Math.max(0, responses - limit) : 0;
  const blocks1000 = Math.ceil(excedente / OVERAGE_BLOCK);
  return { excedente, blocks1000, estimatedBRL: blocks1000 * OVERAGE_BLOCK_PRICE_BRL };
}

/** Phone part of a JID with only the country/area code and the last 4 digits visible: 5521•••••9723. */
export function maskContact(remoteJid: string): string {
  const user = String(remoteJid || '').split('@')[0];
  const digits = user.replace(/\D/g, '');
  if (digits.length < 8) return '•••';
  return `${digits.slice(0, 4)}${'•'.repeat(Math.max(3, digits.length - 8))}${digits.slice(-4)}`;
}
