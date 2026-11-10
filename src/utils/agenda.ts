/**
 * "Agenda": pure helpers (no I/O) shared by the agenda service, the REST routes, the MCP tools, the AI tools and
 * the tests. Instants are stored in UTC; every calendar decision (availability, blocked days, quiet hours,
 * "qui, 07/11 às 14:00") is made in the time zone of the agenda (default America/Sao_Paulo), DST included.
 *
 * Policy for automatic messages to the end client (owner decision): only the booking confirmation (date, time, type,
 * address or link), the reminders, the confirm/cancel/reschedule acknowledgments and the optional "o que levar"
 * text of the appointment type. Never prices, never promises, and never anyone who did not book.
 */
import {
  DAY_KEYS,
  DAY_LABELS,
  DayKey,
  DEFAULT_TIMEZONE,
  isValidTimeZone,
  shiftDay,
  TimeRange,
  WeekSchedule,
  zonedParts,
} from './usageLimits';

export type AgendaMode = 'presencial' | 'online' | 'telefone';
export type AppointmentStatus = 'pendente' | 'agendado' | 'confirmado' | 'cancelado' | 'realizado' | 'faltou';
/** Where the appointments live. Only 'internal' today; the Google Calendar adapter plugs in later. */
export type AgendaProviderName = 'internal';
export type AppointmentSource = 'ia' | 'manual' | 'mcp';

export type AppointmentType = {
  name: string;
  minutes: number;
  mode: AgendaMode;
  /** Address (presencial) or meeting link (online). */
  location: string | null;
  /** "O que levar" / instructions, sent in the confirmation and the reminders. */
  instructions: string | null;
};

/** Whole days from `start` to `end` (inclusive, YYYY-MM-DD); with `from`/`to` only that part of each day. */
export type AgendaBlock = { start: string; end: string; from: string | null; to: string | null; reason: string | null };

export type AgendaSettings = {
  enabled: boolean;
  timezone: string;
  slotMinutes: number;
  bufferMinutes: number;
  minNoticeHours: number;
  maxDaysAhead: number;
  availability: WeekSchedule;
  blocks: AgendaBlock[];
  appointmentTypes: AppointmentType[];
  reminders: { enabled: boolean; hoursBefore: number[] };
  confirmation: { enabled: boolean };
  provider: AgendaProviderName;
  /** Enforced in the tool handlers (server side), not only in the prompt. A tool that is off is not offered. */
  aiPermissions: AiPermissions;
  notifyNumbers: string[];
  icsToken: string | null;
  updatedAt: string | null;
};

export type AiPermissions = {
  allowBook: boolean;
  allowReschedule: boolean;
  allowCancel: boolean;
  /** Always true: a contact only sees and changes appointments linked to its own number. */
  onlyOwnAppointments: true;
  /** Bookings of the AI are created as "pendente" and the team approves them. */
  requireTeamApproval: boolean;
  /** false: the AI only sees free/busy. true: it may also see the type of the other appointments (never names). */
  showOtherEventDetails: boolean;
};

export type Interval = { start: Date; end: Date; id?: string };

export const AGENDA_MODES: AgendaMode[] = ['presencial', 'online', 'telefone'];
export const AGENDA_PROVIDERS: AgendaProviderName[] = ['internal'];
export const APPOINTMENT_STATUSES: AppointmentStatus[] = [
  'pendente',
  'agendado',
  'confirmado',
  'cancelado',
  'realizado',
  'faltou',
];
/** Future appointments that hold a slot for the contact (also the AI per-contact cap and meus_agendamentos). */
export const HOLDING_STATUSES: AppointmentStatus[] = ['pendente', 'agendado', 'confirmado'];
/** Appointments that still get reminders and can be confirmed, rescheduled or cancelled by the client. */
export const ACTIVE_STATUSES: AppointmentStatus[] = ['agendado', 'confirmado'];
export const SLOT_MINUTES = [10, 15, 20, 30, 40, 45, 60, 90, 120];
export const MAX_TYPES = 10;
export const MAX_BLOCKS = 60;
export const MAX_NOTIFY_NUMBERS = 5;
export const MAX_REMINDERS = 3;
/** Reminders at most 3 days before (also bounds the ticker query). */
export const MAX_REMINDER_HOURS = 72;
/** Quiet hours for reminders (local time): never between 21:00 and 08:00. */
export const QUIET_START = 21 * 60;
export const QUIET_END = 8 * 60;
/** Appointments starting before 10:00 get the reminder that would fall in the quiet hours the evening before, 20:00. */
export const EARLY_APPOINTMENT_END = 10 * 60;
export const EVENING_REMINDER = 20 * 60;
/** A reminder found later than this before the start is not sent any more (useless). */
export const REMINDER_MIN_LEAD_MINUTES = 30;
/** How long a reminder waits for the "1" / "2" answer. */
export const REPLY_WINDOW_HOURS = 24;
/** Future appointments one contact may hold through the AI (abuse guard). */
export const AI_MAX_ACTIVE_PER_CONTACT = 2;
/** consultar_horarios returns at most this many slots. */
export const AI_MAX_SLOTS = 6;

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TEXT = 500;

const WEEKDAYS_PT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

// ------------------------------------------------------------------------------------------- defaults

export function defaultAvailability(): WeekSchedule {
  const day = (): TimeRange[] => [
    ['09:00', '12:00'],
    ['14:00', '18:00'],
  ];
  return { sun: [], mon: day(), tue: day(), wed: day(), thu: day(), fri: day(), sat: [] };
}

export function defaultAppointmentTypes(): AppointmentType[] {
  return [{ name: 'Atendimento inicial', minutes: 30, mode: 'presencial', location: null, instructions: null }];
}

/** No row in AgendaSettings: the agenda is off. */
export function defaultAgendaSettings(): AgendaSettings {
  return {
    enabled: false,
    timezone: DEFAULT_TIMEZONE,
    slotMinutes: 30,
    bufferMinutes: 0,
    minNoticeHours: 2,
    maxDaysAhead: 30,
    availability: defaultAvailability(),
    blocks: [],
    appointmentTypes: defaultAppointmentTypes(),
    reminders: { enabled: true, hoursBefore: [24, 2] },
    confirmation: { enabled: true },
    provider: 'internal',
    aiPermissions: {
      allowBook: true,
      allowReschedule: true,
      allowCancel: true,
      onlyOwnAppointments: true,
      requireTeamApproval: false,
      showOtherEventDetails: false,
    },
    notifyNumbers: [],
    icsToken: null,
    updatedAt: null,
  };
}

// ------------------------------------------------------------------------------------------ normalize

const intIn = (value: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
};

const textOrNull = (value: unknown, max = MAX_TEXT): string | null =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;

const toMinutes = (time: string): number => {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
};

export const minutesToTime = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** Availability ranges: same JSON as the business hours of "Plano e limites", but a range never crosses midnight. */
export function normalizeAvailability(value: unknown): WeekSchedule {
  if (!value || typeof value !== 'object') return defaultAvailability();
  const source = value as Record<string, unknown>;
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
          range[0] !== '24:00' &&
          toMinutes(String(range[0])) < toMinutes(String(range[1])),
      )
      .slice(0, 6)
      .map(([start, end]) => [String(start), String(end)] as TimeRange)
      .sort((a, b) => toMinutes(a[0]) - toMinutes(b[0]));
  }
  return week;
}

export function normalizeBlocks(value: unknown): AgendaBlock[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((block) => block && typeof block === 'object' && DATE_REGEX.test(String((block as any).start)))
    .map((block: any) => {
      const start = String(block.start);
      const end = DATE_REGEX.test(String(block.end)) && String(block.end) >= start ? String(block.end) : start;
      const from = TIME_REGEX.test(String(block.from)) && block.from !== '24:00' ? String(block.from) : null;
      const to = TIME_REGEX.test(String(block.to)) ? String(block.to) : null;
      const partial = from && to && toMinutes(from) < toMinutes(to);
      return {
        start,
        end,
        from: partial ? from : null,
        to: partial ? to : null,
        reason: textOrNull(block.reason, 120),
      };
    })
    .slice(0, MAX_BLOCKS)
    .sort((a, b) => a.start.localeCompare(b.start));
}

export function normalizeTypes(value: unknown): AppointmentType[] {
  if (!Array.isArray(value)) return defaultAppointmentTypes();
  const seen = new Set<string>();
  const types = value
    .filter((type) => type && typeof type === 'object' && textOrNull((type as any).name, 80))
    .map((type: any) => ({
      name: textOrNull(type.name, 80) as string,
      minutes: intIn(type.minutes, 5, 480, 30),
      mode: AGENDA_MODES.includes(type.mode) ? (type.mode as AgendaMode) : 'presencial',
      location: textOrNull(type.location, 300),
      instructions: textOrNull(type.instructions, MAX_TEXT),
    }))
    .filter((type) => {
      const key = foldText(type.name);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_TYPES);
  return types.length ? types : defaultAppointmentTypes();
}

/** Only digits, 10 to 15 (country code + area code + number). */
export function normalizeNotifyNumbers(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const numbers = value
    .map((item) => String(item ?? '').replace(/\D/g, ''))
    .filter((digits) => /^\d{10,15}$/.test(digits));
  return [...new Set(numbers)].slice(0, MAX_NOTIFY_NUMBERS);
}

function normalizeHoursBefore(value: unknown): number[] {
  if (!Array.isArray(value)) return [24, 2];
  const hours = value
    .map(Number)
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= MAX_REMINDER_HOURS)
    .sort((a, b) => b - a);
  return [...new Set(hours)].slice(0, MAX_REMINDERS);
}

const flag = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback);

/** A stored row (or any object) as a complete, safe AgendaSettings. */
export function normalizeAgendaSettings(row: any): AgendaSettings {
  const base = defaultAgendaSettings();
  if (!row || typeof row !== 'object') return base;
  const reminders = row.reminders && typeof row.reminders === 'object' ? row.reminders : {};
  const confirmation = row.confirmation && typeof row.confirmation === 'object' ? row.confirmation : {};
  const ai = row.aiPermissions && typeof row.aiPermissions === 'object' ? row.aiPermissions : {};
  return {
    enabled: row.enabled === true,
    timezone: isValidTimeZone(row.timezone) ? String(row.timezone) : DEFAULT_TIMEZONE,
    slotMinutes: intIn(row.slotMinutes, 5, 240, base.slotMinutes),
    bufferMinutes: intIn(row.bufferMinutes, 0, 240, base.bufferMinutes),
    minNoticeHours: intIn(row.minNoticeHours, 0, 720, base.minNoticeHours),
    maxDaysAhead: intIn(row.maxDaysAhead, 1, 365, base.maxDaysAhead),
    availability:
      row.availability === undefined || row.availability === null
        ? base.availability
        : normalizeAvailability(row.availability),
    blocks: normalizeBlocks(row.blocks),
    appointmentTypes: row.appointmentTypes ? normalizeTypes(row.appointmentTypes) : base.appointmentTypes,
    reminders: {
      enabled: flag(reminders.enabled, true),
      hoursBefore: reminders.hoursBefore === undefined ? [24, 2] : normalizeHoursBefore(reminders.hoursBefore),
    },
    confirmation: { enabled: flag(confirmation.enabled, true) },
    provider: AGENDA_PROVIDERS.includes(row.provider) ? row.provider : 'internal',
    aiPermissions: {
      allowBook: flag(ai.allowBook, flag(ai.canBook, true)),
      allowReschedule: flag(ai.allowReschedule, flag(ai.canReschedule, true)),
      allowCancel: flag(ai.allowCancel, flag(ai.canCancel, true)),
      onlyOwnAppointments: true,
      requireTeamApproval: flag(ai.requireTeamApproval, false),
      showOtherEventDetails: flag(ai.showOtherEventDetails, false),
    },
    notifyNumbers: normalizeNotifyNumbers(row.notifyNumbers),
    icsToken: typeof row.icsToken === 'string' && row.icsToken ? row.icsToken : null,
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
  };
}

/**
 * Raw request checks (Brazilian Portuguese, for the operator): problems normalize would silently drop.
 */
export function validateAgendaInput(input: any): string[] {
  const errors: string[] = [];
  if (!input || typeof input !== 'object') return ['Corpo inválido.'];

  if (input.provider !== undefined && !AGENDA_PROVIDERS.includes(input.provider)) {
    errors.push(
      `Provedor de agenda indisponível: "${String(input.provider).slice(0, 30)}". Hoje só existe "internal" (agenda do WhatsAI).`,
    );
  }
  if (input.aiPermissions?.onlyOwnAppointments === false) {
    errors.push('"onlyOwnAppointments" não pode ser desligado: o cliente só vê e altera os próprios agendamentos.');
  }

  if (input.timezone !== undefined && !isValidTimeZone(input.timezone)) {
    errors.push(
      `Fuso horário inválido: "${String(input.timezone).slice(0, 64)}". Use um nome IANA, por exemplo America/Sao_Paulo.`,
    );
  }

  const week = input.availability;
  if (week && typeof week === 'object') {
    for (const day of DAY_KEYS) {
      for (const range of Array.isArray(week[day]) ? week[day] : []) {
        const [start, end] = Array.isArray(range) ? range.map(String) : ['', ''];
        if (!TIME_REGEX.test(start) || !TIME_REGEX.test(end) || start === '24:00') {
          errors.push(`Horário inválido na ${DAY_LABELS[day]}: use HH:MM (24:00 só como fim).`);
        } else if (toMinutes(start) >= toMinutes(end)) {
          errors.push(`Na ${DAY_LABELS[day]}, o fim (${end}) precisa ser depois do início (${start}).`);
        }
      }
    }
  }

  if (Array.isArray(input.blocks)) {
    for (const block of input.blocks) {
      if (!block || !DATE_REGEX.test(String(block.start))) {
        errors.push('Cada bloqueio precisa de uma data de início (AAAA-MM-DD).');
        continue;
      }
      if (block.end && (!DATE_REGEX.test(String(block.end)) || String(block.end) < String(block.start))) {
        errors.push(`Bloqueio de ${block.start}: a data final precisa ser igual ou depois da inicial.`);
      }
      if (
        (block.from || block.to) &&
        !(
          TIME_REGEX.test(String(block.from)) &&
          TIME_REGEX.test(String(block.to)) &&
          toMinutes(String(block.from)) < toMinutes(String(block.to))
        )
      ) {
        errors.push(`Bloqueio de ${block.start}: informe início e fim (HH:MM) ou deixe o dia inteiro.`);
      }
    }
  }

  if (Array.isArray(input.appointmentTypes)) {
    if (!input.appointmentTypes.length) errors.push('Cadastre pelo menos um tipo de atendimento.');
    const names = new Set<string>();
    for (const type of input.appointmentTypes) {
      const name = textOrNull(type?.name, 80);
      if (!name) {
        errors.push('Cada tipo de atendimento precisa de um nome.');
        continue;
      }
      if (names.has(foldText(name))) errors.push(`Tipo de atendimento repetido: "${name}".`);
      names.add(foldText(name));
      if (!Number.isInteger(Number(type.minutes)) || Number(type.minutes) < 5 || Number(type.minutes) > 480) {
        errors.push(`"${name}": a duração deve ser de 5 a 480 minutos.`);
      }
      if (type.mode !== undefined && !AGENDA_MODES.includes(type.mode)) {
        errors.push(`"${name}": o modo deve ser presencial, online ou telefone.`);
      }
    }
  }

  if (Array.isArray(input.notifyNumbers)) {
    for (const number of input.notifyNumbers) {
      if (!/^\d{10,15}$/.test(String(number ?? '').replace(/\D/g, ''))) {
        errors.push(`Número da equipe inválido: "${String(number).slice(0, 30)}". Use DDI + DDD + número.`);
      }
    }
  }

  const hours = input.reminders?.hoursBefore;
  if (Array.isArray(hours)) {
    for (const value of hours) {
      if (!Number.isInteger(Number(value)) || Number(value) < 1 || Number(value) > MAX_REMINDER_HOURS) {
        errors.push(`Lembrete inválido: ${String(value).slice(0, 10)}. Use de 1 a ${MAX_REMINDER_HOURS} horas antes.`);
      }
    }
  }

  return errors;
}

/** Semantic checks of complete settings. */
export function validateAgendaSettings(settings: AgendaSettings): string[] {
  const errors: string[] = [];
  if (settings.enabled && DAY_KEYS.every((day) => !settings.availability[day].length)) {
    errors.push('Para ligar a agenda, defina pelo menos um horário de atendimento na semana.');
  }
  return errors;
}

// ------------------------------------------------------------------------------------------- text

/** Lowercase, no accents, no punctuation: for comparing names and short replies. */
export function foldText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function findType(settings: AgendaSettings, name?: string | null): AppointmentType | null {
  if (!name) return settings.appointmentTypes[0] ?? null;
  const wanted = foldText(name);
  return (
    settings.appointmentTypes.find((type) => foldText(type.name) === wanted) ??
    settings.appointmentTypes.find((type) => foldText(type.name).includes(wanted) && wanted.length >= 4) ??
    null
  );
}

// ------------------------------------------------------------------------------------------- time

/** UTC instant of a local wall-clock time; null when it does not exist in that zone (DST gap). */
export function localToUtc(day: string, minutes: number, timeZone: string): Date | null {
  if (!DATE_REGEX.test(day)) return null;
  const [y, m, d] = day.split('-').map(Number);
  const wall = Date.UTC(y, m - 1, d, 0, minutes);
  const offsetAt = (instant: number) => {
    const parts = zonedParts(new Date(instant), timeZone);
    const [py, pm, pd] = parts.day.split('-').map(Number);
    return Date.UTC(py, pm - 1, pd, 0, parts.minutes) - Math.floor(instant / 60_000) * 60_000;
  };
  let instant = wall - offsetAt(wall);
  instant = wall - offsetAt(instant);
  const back = zonedParts(new Date(instant), timeZone);
  const expected = zonedParts(new Date(wall), 'UTC');
  if (back.day !== expected.day || back.minutes !== expected.minutes) return null;
  return new Date(instant);
}

export function weekdayOf(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** "qui, 07/11 às 14:00" in the agenda time zone. */
export function formatSlot(date: Date, timeZone: string): string {
  const parts = zonedParts(date, timeZone);
  const [, mm, dd] = parts.day.split('-');
  return `${WEEKDAYS_PT[parts.weekday]}, ${dd}/${mm} às ${minutesToTime(parts.minutes)}`;
}

/** "2026-11-07T14:00:00-03:00": local wall time with the offset of that instant. */
export function toLocalIso(date: Date, timeZone: string): string {
  const parts = zonedParts(date, timeZone);
  const [y, m, d] = parts.day.split('-').map(Number);
  const offset = Math.round(
    (Date.UTC(y, m - 1, d, 0, parts.minutes) - Math.floor(date.getTime() / 60_000) * 60_000) / 60_000,
  );
  const sign = offset < 0 ? '-' : '+';
  const abs = Math.abs(offset);
  return `${parts.day}T${minutesToTime(parts.minutes)}:00${sign}${minutesToTime(abs)}`;
}

/**
 * Start instant from what a person or the model wrote: an ISO with offset/Z, or a local "YYYY-MM-DDTHH:MM"
 * (interpreted in the agenda time zone). null when invalid.
 */
export function parseStart(value: unknown, timeZone: string): Date | null {
  const text = String(value ?? '').trim();
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d{1,3})?)?(Z|[+-]\d{2}:?\d{2})?$/.exec(text);
  if (!match) return null;
  const [, day, hh, mi, zone] = match;
  if (Number(hh) > 23 || Number(mi) > 59) return null;
  if (!zone) return localToUtc(day, Number(hh) * 60 + Number(mi), timeZone);
  const ms = Date.parse(text.replace(' ', 'T'));
  return Number.isFinite(ms) ? new Date(ms) : null;
}

export const overlaps = (a: Interval, b: Interval, bufferMinutes = 0): boolean => {
  const buffer = bufferMinutes * 60_000;
  return a.start.getTime() < b.end.getTime() + buffer && b.start.getTime() < a.end.getTime() + buffer;
};

function blockedRange(settings: AgendaSettings, day: string): 'all' | [number, number][] {
  const ranges: [number, number][] = [];
  for (const block of settings.blocks) {
    if (day < block.start || day > block.end) continue;
    if (!block.from || !block.to) return 'all';
    ranges.push([toMinutes(block.from), toMinutes(block.to)]);
  }
  return ranges;
}

export type SlotOptions = {
  now: Date;
  /** First local day (YYYY-MM-DD); default today. Never before today. */
  fromDay?: string;
  /** Days to look at from fromDay (default 7). */
  days?: number;
  /** Duration of the appointment (default: slot length). */
  durationMinutes?: number;
  /** Appointments that occupy the agenda (cancelled ones excluded by the caller). */
  busy: Interval[];
  /** Stop after this many slots (default: no limit). */
  limit?: number;
  /** Busy interval ignored (the appointment being rescheduled). */
  ignoreId?: string;
};

/**
 * Free start times: every `slotMinutes` inside the weekly availability of each local day, without blocked days or
 * hours, at least `minNoticeHours` from now, at most `maxDaysAhead` days ahead, and not overlapping any busy
 * interval (with `bufferMinutes` of margin on both sides). Local times that do not exist (DST gap) are skipped.
 */
export function generateSlots(settings: AgendaSettings, options: SlotOptions): Interval[] {
  const tz = settings.timezone;
  const now = options.now;
  const today = zonedParts(now, tz).day;
  const fromDay =
    options.fromDay && DATE_REGEX.test(options.fromDay) && options.fromDay > today ? options.fromDay : today;
  const days = Math.max(1, Math.min(options.days ?? 7, 366));
  const duration = options.durationMinutes ?? settings.slotMinutes;
  const step = settings.slotMinutes;
  const earliest = now.getTime() + settings.minNoticeHours * 3_600_000;
  const latest = now.getTime() + settings.maxDaysAhead * 86_400_000;
  const busy = options.busy.filter((item) => !options.ignoreId || item.id !== options.ignoreId);
  const result: Interval[] = [];

  for (let index = 0; index < days; index++) {
    const day = shiftDay(fromDay, -index);
    const dayStart = localToUtc(day, 0, tz);
    if (dayStart && dayStart.getTime() > latest) break;

    const blocked = blockedRange(settings, day);
    if (blocked === 'all') continue;

    for (const [from, to] of settings.availability[DAY_KEYS[weekdayOf(day)] as DayKey] ?? []) {
      const end = toMinutes(to);
      for (let minute = toMinutes(from); minute + duration <= end; minute += step) {
        if (blocked.some(([bs, be]) => minute < be && bs < minute + duration)) continue;
        const start = localToUtc(day, minute, tz);
        if (!start) continue;
        const at = start.getTime();
        if (at < earliest || at > latest) continue;
        const slot = { start, end: new Date(at + duration * 60_000) };
        if (busy.some((item) => overlaps(slot, item, settings.bufferMinutes))) continue;
        result.push(slot);
        if (options.limit && result.length >= options.limit) return result;
      }
    }
  }

  return result;
}

/** Whether `start` is exactly one of the free slots (what the AI may book). */
export function isBookableSlot(
  settings: AgendaSettings,
  start: Date,
  durationMinutes: number,
  busy: Interval[],
  now: Date,
  ignoreId?: string,
): boolean {
  const day = zonedParts(start, settings.timezone).day;
  return generateSlots(settings, { now, fromDay: day, days: 1, durationMinutes, busy, ignoreId }).some(
    (slot) => slot.start.getTime() === start.getTime(),
  );
}

// -------------------------------------------------------------------------------------- reminders

export const isQuiet = (minutes: number): boolean => minutes >= QUIET_START || minutes < QUIET_END;

export type PlannedReminder = { key: string; sendAt: Date };

/**
 * When each reminder goes out. A reminder that would fall in the quiet hours (21:00–08:00 local) goes the evening
 * before at 20:00 when the appointment starts before 10:00, otherwise at 08:00 (or, if that is too late, the
 * evening before). Reminders that would go out before the appointment was booked are dropped (the booking
 * confirmation covers them); two reminders less than an hour apart go out once (the later one).
 */
export function planReminders(
  startsAt: Date,
  hoursBefore: number[],
  timeZone: string,
  createdAt?: Date,
): PlannedReminder[] {
  const start = startsAt.getTime();
  const startLocal = zonedParts(startsAt, timeZone);
  const eveningBefore = localToUtc(shiftDay(startLocal.day, 1), EVENING_REMINDER, timeZone);
  const planned: PlannedReminder[] = [];

  for (const hours of hoursBefore) {
    let sendAt: Date | null = new Date(start - hours * 3_600_000);
    const local = zonedParts(sendAt, timeZone);
    if (isQuiet(local.minutes)) {
      if (startLocal.minutes < EARLY_APPOINTMENT_END) {
        sendAt = eveningBefore;
      } else {
        const morningDay = local.minutes >= QUIET_START ? shiftDay(local.day, -1) : local.day;
        const morning = localToUtc(morningDay, QUIET_END, timeZone);
        sendAt = morning && morning.getTime() < start ? morning : eveningBefore;
      }
    }
    if (!sendAt || sendAt.getTime() >= start) continue;
    if (createdAt && sendAt.getTime() < createdAt.getTime()) continue;
    planned.push({ key: String(hours), sendAt });
  }

  planned.sort((a, b) => a.sendAt.getTime() - b.sendAt.getTime());
  return planned.filter((item, index) => {
    const next = planned[index + 1];
    return !next || next.sendAt.getTime() - item.sendAt.getTime() >= 3_600_000;
  });
}

export type ReminderDecision =
  /** Send `key` now; mark `skip` as skipped (missed while the server slept). */
  | { action: 'send'; key: string; skip: string[] }
  /** Nothing to send now; check again at `at`. */
  | { action: 'wait'; at: Date | null }
  /** Due reminders that are too late now: mark them skipped. */
  | { action: 'skip'; skip: string[] };

/** What the ticker does with one appointment now. `sent` = keys of remindersSent. */
export function decideReminder(
  appointment: { startsAt: Date; createdAt?: Date },
  hoursBefore: number[],
  timeZone: string,
  sent: Record<string, unknown>,
  now: Date,
): ReminderDecision {
  const pending = planReminders(appointment.startsAt, hoursBefore, timeZone, appointment.createdAt).filter(
    (item) => !sent || !(item.key in sent),
  );
  if (!pending.length) return { action: 'wait', at: null };

  const due = pending.filter((item) => item.sendAt.getTime() <= now.getTime());
  const future = pending.filter((item) => item.sendAt.getTime() > now.getTime());
  if (!due.length) return { action: 'wait', at: future[0].sendAt };

  const tooLate = appointment.startsAt.getTime() - now.getTime() < REMINDER_MIN_LEAD_MINUTES * 60_000;
  if (tooLate) return { action: 'skip', skip: due.map((item) => item.key) };

  const local = zonedParts(now, timeZone);
  if (isQuiet(local.minutes)) {
    // Late (the server slept): wait for the morning, unless a planned reminder comes first
    const morningDay = local.minutes >= QUIET_START ? shiftDay(local.day, -1) : local.day;
    const morning = localToUtc(morningDay, QUIET_END, timeZone);
    return { action: 'wait', at: morning };
  }

  const latest = due[due.length - 1];
  return { action: 'send', key: latest.key, skip: due.slice(0, -1).map((item) => item.key) };
}

// ----------------------------------------------------------------------------------------- replies

export type ReminderReply = 'confirm' | 'change' | null;

const CONFIRM_WORDS = new Set([
  '1',
  'um',
  'sim',
  'ok',
  'confirmo',
  'confirmar',
  'confirmado',
  'confirmada',
  'sim confirmo',
  'confirmo sim',
  'pode confirmar',
  'confirmadissimo',
]);
const CHANGE_WORDS = new Set([
  '2',
  'dois',
  'remarcar',
  'cancelar',
  'quero remarcar',
  'quero cancelar',
  'preciso remarcar',
  'preciso cancelar',
  'remarcar ou cancelar',
]);

/** "1" / "confirmo" / "2" … typed right after a reminder. Anything else: null (normal AI). */
export function parseReminderReply(text: unknown): ReminderReply {
  const folded = foldText(text);
  if (!folded || folded.length > 30) return null;
  if (CONFIRM_WORDS.has(folded)) return 'confirm';
  if (CHANGE_WORDS.has(folded)) return 'change';
  return null;
}

// ----------------------------------------------------------------------------------------- messages

export type MessageAppointment = { startsAt: Date; typeName: string; contactName?: string | null; status?: string };

function placeLines(type: AppointmentType | null): string[] {
  const lines: string[] = [];
  if (type?.mode === 'presencial' && type.location) lines.push(`Local: ${type.location}`);
  if (type?.mode === 'online')
    lines.push(type.location ? `Link: ${type.location}` : 'O link da reunião será enviado pela equipe.');
  if (type?.mode === 'telefone') lines.push('A equipe vai ligar para este número no horário marcado.');
  if (type?.instructions) lines.push(`O que levar: ${type.instructions}`);
  return lines;
}

const firstName = (name?: string | null): string => {
  const first = String(name ?? '')
    .trim()
    .split(/\s+/)[0];
  return first && first.length <= 30 ? first : '';
};

/** Sent when the team (panel or MCP) books for the client. The AI writes its own confirmation. */
export function bookingConfirmationText(
  appointment: MessageAppointment,
  type: AppointmentType | null,
  timeZone: string,
) {
  const name = firstName(appointment.contactName);
  return [
    `${name ? `Olá, ${name}! ` : ''}Seu agendamento está marcado: ${appointment.typeName}, ${formatSlot(appointment.startsAt, timeZone)}.`,
    ...placeLines(type),
  ].join('\n');
}

export function reminderText(
  appointment: MessageAppointment,
  type: AppointmentType | null,
  timeZone: string,
  askConfirmation: boolean,
): string {
  const name = firstName(appointment.contactName);
  const ask =
    askConfirmation && appointment.status !== 'confirmado'
      ? 'Responda 1 para confirmar ou 2 para remarcar/cancelar.'
      : 'Se precisar remarcar ou cancelar, responda 2.';
  return [
    `${name ? `Olá, ${name}! ` : 'Olá! '}Lembrete do seu ${appointment.typeName}: ${formatSlot(appointment.startsAt, timeZone)}.`,
    ...placeLines(type),
    '',
    ask,
  ].join('\n');
}

export const confirmedAckText = (appointment: MessageAppointment, timeZone: string) =>
  `Obrigado! Seu ${appointment.typeName} de ${formatSlot(appointment.startsAt, timeZone)} está confirmado.`;

export const changeRequestAckText = (appointment: MessageAppointment, timeZone: string) =>
  `Certo! A equipe vai falar com você para remarcar ou cancelar o ${appointment.typeName} de ${formatSlot(appointment.startsAt, timeZone)}.`;

export const cancelledAckText = (appointment: MessageAppointment, timeZone: string) =>
  `Seu ${appointment.typeName} de ${formatSlot(appointment.startsAt, timeZone)} foi cancelado. Se quiser marcar outro horário, é só responder esta mensagem.`;

export function rescheduledAckText(appointment: MessageAppointment, type: AppointmentType | null, timeZone: string) {
  return [
    `Seu ${appointment.typeName} foi remarcado para ${formatSlot(appointment.startsAt, timeZone)}.`,
    ...placeLines(type),
  ].join('\n');
}

export type TeamEvent = 'novo' | 'pendente' | 'cancelado' | 'remarcado' | 'pedido';

const TEAM_TITLES: Record<TeamEvent, string> = {
  novo: 'Novo agendamento',
  pendente: 'Pedido de agendamento, aguarda aprovação no painel',
  cancelado: 'Agendamento cancelado',
  remarcado: 'Agendamento remarcado',
  pedido: 'Cliente pediu para remarcar/cancelar',
};
const SOURCE_LABELS: Record<string, string> = {
  ia: 'pela IA',
  manual: 'pelo painel',
  mcp: 'pelo MCP',
  cliente: 'pelo cliente',
};

/** Internal message to the team numbers. */
export function teamNotificationText(
  event: TeamEvent,
  appointment: MessageAppointment & { remoteJid: string },
  timeZone: string,
  by: string,
): string {
  const phone = String(appointment.remoteJid).split('@')[0].replace(/\D/g, '');
  const who = [appointment.contactName, phone ? `+${phone}` : null].filter(Boolean).join(' · ');
  return `${TEAM_TITLES[event]} (${SOURCE_LABELS[by] ?? by}): ${who || 'contato'} — ${appointment.typeName}, ${formatSlot(appointment.startsAt, timeZone)}.`;
}

// ------------------------------------------------------------------------------------------- iCalendar

export type IcsEvent = {
  uid: string;
  start: Date;
  end: Date;
  summary: string;
  description?: string | null;
  location?: string | null;
  status: 'CONFIRMED' | 'TENTATIVE' | 'CANCELLED';
  updatedAt?: Date | null;
};

export const icsEscape = (value: string): string =>
  value
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/([,;])/g, '\\$1');

export const icsDate = (date: Date): string =>
  date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');

/** Lines longer than 75 octets are folded (RFC 5545 3.1), without splitting a UTF-8 character. */
export function icsFold(line: string): string {
  const out: string[] = [];
  let current = '';
  let bytes = 0;
  for (const char of line) {
    const size = Buffer.byteLength(char, 'utf8');
    if (bytes + size > (out.length ? 74 : 75)) {
      out.push(current);
      current = '';
      bytes = 0;
    }
    current += char;
    bytes += size;
  }
  out.push(current);
  return out.join('\r\n ');
}

/** A read-only iCalendar feed (Google/Apple Calendar subscription). */
export function buildIcs(options: { name: string; timeZone: string; events: IcsEvent[]; now: Date }): string {
  const stamp = icsDate(options.now);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//WhatsAI//Agenda//PT-BR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsEscape(options.name)}`,
    `X-WR-TIMEZONE:${options.timeZone}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT15M',
    'X-PUBLISHED-TTL:PT15M',
  ];
  for (const event of options.events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${event.uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${icsDate(event.start)}`,
      `DTEND:${icsDate(event.end)}`,
      `SUMMARY:${icsEscape(event.summary)}`,
    );
    if (event.description) lines.push(`DESCRIPTION:${icsEscape(event.description)}`);
    if (event.location) lines.push(`LOCATION:${icsEscape(event.location)}`);
    lines.push(`STATUS:${event.status}`);
    if (event.updatedAt) lines.push(`LAST-MODIFIED:${icsDate(event.updatedAt)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(icsFold).join('\r\n') + '\r\n';
}

/** First name + last initial: what the ICS shows (the feed may sit in a shared calendar). */
export function shortName(name?: string | null): string {
  const parts = String(name ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return '';
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0];
}

export const MODE_LABELS: Record<AgendaMode, string> = {
  presencial: 'presencial',
  online: 'online',
  telefone: 'por telefone',
};
