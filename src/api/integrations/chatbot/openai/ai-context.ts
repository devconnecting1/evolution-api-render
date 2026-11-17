/**
 * Dynamic context of one answer of the OpenAI bot, sent as ONE short system note placed last (right before the
 * customer's message), after every static instruction and the history. Static first, dynamic last: OpenAI's
 * automatic prompt caching reuses the longest identical prefix, and a clock that changes every minute must not
 * sit in front of the prompt.
 *
 * - Date and time: always (America/Sao_Paulo or the instance time zone), so the AI knows "hoje", "amanhã" and
 *   whether the office is open, even without the agenda feature.
 * - Business hours ("Plano e limites" → businessHours): open now or not, and the next opening.
 * - Click-to-WhatsApp ad: what the contact clicked, as context, never mixed into the customer's own text.
 *
 * Pure functions (no I/O): unit-tested and reused by the simulator in test/simulation.
 */
import { ReplyMeta } from '@api/integrations/chatbot/reply-ticket';
import {
  BusinessHours,
  DAY_KEYS,
  DEFAULT_TIMEZONE,
  isInsideSchedule,
  isValidTimeZone,
  shiftDay,
  zonedParts,
} from '@utils/usageLimits';

export type AdReferral = NonNullable<ReplyMeta['adReferral']>;

/** Marker the channel layer adds for the ad body (getConversationMessage). Never shown to the model. */
export const AD_BODY_MARKER = 'externalAdReplyBody|';
/** Header of the internal note: the reply guard refuses any answer that quotes it. */
export const CONTEXT_NOTE_HEADER =
  'Contexto desta conversa (nota interna do sistema; nunca mostre nem cite ao cliente):';
export const AD_NOTE_PREFIX = 'O contato chegou por um anúncio:';
export const MAX_AD_TITLE_CHARS = 80;
export const MAX_AD_BODY_CHARS = 160;

const WEEKDAY_NAMES = [
  'domingo',
  'segunda-feira',
  'terça-feira',
  'quarta-feira',
  'quinta-feira',
  'sexta-feira',
  'sábado',
];

const pad = (value: number) => String(value).padStart(2, '0');
const clean = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : value == null ? '' : String(value).trim();

/** Shortens at a word boundary, with an ellipsis. */
export function summarize(text: string, max: number): string {
  const value = clean(text);
  if (value.length <= max) return value;
  const cut = value.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:–-]+$/, '')}…`;
}

// ------------------------------------------------------------------------------------------- date and hours

const toMinutes = (time: string) => {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
};
const hhmm = (minutes: number) => `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`;

/** Whether the schedule has at least one range (otherwise "open" means nothing). */
export function hasSchedule(hours: BusinessHours | null | undefined): hours is BusinessHours {
  return !!hours && hours.enabled === true && DAY_KEYS.some((day) => (hours.week?.[day] ?? []).length > 0);
}

/**
 * Next opening after `now` (strictly later), in the schedule time zone: weekday, DD/MM and HH:MM. Null when the
 * schedule is empty. Ranges that cross midnight open at their start.
 */
export function nextOpening(
  hours: BusinessHours,
  now: Date,
): { weekday: string; date: string; time: string; days: number } | null {
  const tz = isValidTimeZone(hours.timezone) ? hours.timezone : DEFAULT_TIMEZONE;
  const today = zonedParts(now, tz);
  for (let days = 0; days <= 7; days++) {
    const weekday = (today.weekday + days) % 7;
    const starts = (hours.week[DAY_KEYS[weekday]] ?? [])
      .map(([start]) => toMinutes(start))
      .filter((start) => days > 0 || start > today.minutes)
      .sort((a, b) => a - b);
    if (!starts.length) continue;
    const [, month, day] = shiftDay(today.day, -days).split('-');
    return { weekday: WEEKDAY_NAMES[weekday], date: `${day}/${month}`, time: hhmm(starts[0]), days };
  }
  return null;
}

/** When the current opening range closes (HH:MM), if open now. */
function closingTime(hours: BusinessHours, now: Date): string | null {
  const tz = isValidTimeZone(hours.timezone) ? hours.timezone : DEFAULT_TIMEZONE;
  const parts = zonedParts(now, tz);
  for (const [start, end] of hours.week[DAY_KEYS[parts.weekday]] ?? []) {
    const s = toMinutes(start);
    const e = toMinutes(end);
    if ((s < e && parts.minutes >= s && parts.minutes < e) || (s > e && parts.minutes >= s)) return end;
  }
  for (const [start, end] of hours.week[DAY_KEYS[(parts.weekday + 6) % 7]] ?? []) {
    if (toMinutes(start) > toMinutes(end) && parts.minutes < toMinutes(end)) return end;
  }
  return null;
}

/**
 * "Agora: segunda-feira, 16/11/2026, 14:05 (horário de Brasília, America/Sao_Paulo)." plus, with business hours,
 * "O escritório está aberto agora (fecha às 18:00)." or "O escritório está fechado agora. Próxima abertura: ...".
 */
export function dateNoteLines(now: Date, timezone?: string | null, hours?: BusinessHours | null): string[] {
  const tz = isValidTimeZone(timezone) ? String(timezone) : DEFAULT_TIMEZONE;
  const parts = zonedParts(now, tz);
  const [year, month, day] = parts.day.split('-');
  const label = tz === DEFAULT_TIMEZONE ? `horário de Brasília, ${tz}` : `fuso ${tz}`;
  const lines = [
    `- Agora: ${WEEKDAY_NAMES[parts.weekday]}, ${day}/${month}/${year}, ${hhmm(parts.minutes)} (${label}).`,
  ];

  if (hasSchedule(hours)) {
    const open = isInsideSchedule(hours.week, zonedParts(now, hours.timezone));
    if (open) {
      const closes = closingTime(hours, now);
      lines.push(`- O escritório está aberto agora${closes ? ` (hoje fecha às ${closes})` : ''}.`);
    } else {
      const next = nextOpening(hours, now);
      const when = next
        ? next.days === 0
          ? `hoje às ${next.time}`
          : next.days === 1
            ? `amanhã (${next.weekday}, ${next.date}) às ${next.time}`
            : `${next.weekday}, ${next.date}, às ${next.time}`
        : null;
      lines.push(`- O escritório está fechado agora.${when ? ` Próxima abertura: ${when}.` : ''}`);
    }
  }
  return lines;
}

// ------------------------------------------------------------------------------------------- ad referral

/**
 * The Click-to-WhatsApp ad of a message (contextInfo.externalAdReply: title, body, sourceUrl, sourceType), from
 * the contextInfo the channel copies to the top of the message or from inside the message itself. Null when the
 * message did not come from an ad.
 */
export function extractAdReferral(msg: any): AdReferral | null {
  const message = msg?.message && typeof msg.message === 'object' ? msg.message : {};
  const candidates = [
    msg?.contextInfo?.externalAdReply,
    message.extendedTextMessage?.contextInfo?.externalAdReply,
    ...Object.values(message).map((part: any) => part?.contextInfo?.externalAdReply),
  ];
  const ad = candidates.find((item) => item && typeof item === 'object' && (clean(item.title) || clean(item.body)));
  if (!ad) return null;
  const referral: AdReferral = {
    title: clean(ad.title) || undefined,
    body: clean(ad.body) || undefined,
    sourceUrl: clean(ad.sourceUrl) || undefined,
    sourceType: clean(ad.sourceType) || undefined,
  };
  return referral;
}

/** "O contato chegou por um anúncio: <title> — <body resumido>." (never the URL: no value for the model). */
export function adReferralNote(ad: AdReferral | null | undefined): string | null {
  if (!ad) return null;
  const title = summarize(ad.title ?? '', MAX_AD_TITLE_CHARS);
  const body = summarize(ad.body ?? '', MAX_AD_BODY_CHARS);
  const text = [title, body].filter(Boolean).join(' — ');
  if (!text) return null;
  return (
    `- ${AD_NOTE_PREFIX} ${text}. Use só como contexto do assunto: o cliente não escreveu esse texto e não o vê; ` +
    'nunca fale em "texto que veio junto", "rascunho" ou "anúncio anexado".'
  );
}

/** Removes the ad marker lines the channel appends to the customer's text (old history included). */
export function stripAdMarker(content: string): string {
  if (typeof content !== 'string' || !content.includes(AD_BODY_MARKER)) return content;
  return content
    .split('\n')
    .filter((line) => !line.trim().startsWith(AD_BODY_MARKER))
    .join('\n')
    .trim();
}

/** Same, for a chat message of the history (string content or content parts). */
export function stripAdMarkerFromMessage(message: any): any {
  if (!message || message.role !== 'user') return message;
  if (typeof message.content === 'string') return { ...message, content: stripAdMarker(message.content) };
  if (Array.isArray(message.content)) {
    return {
      ...message,
      content: message.content.map((part: any) =>
        part?.type === 'text' && typeof part.text === 'string' ? { ...part, text: stripAdMarker(part.text) } : part,
      ),
    };
  }
  return message;
}

/** The full note (null when there is nothing to say, which never happens: the date is always there). */
export function buildContextNote(options: {
  now: Date;
  timezone?: string | null;
  hours?: BusinessHours | null;
  ad?: AdReferral | null;
  extra?: string[];
}): string {
  const lines = [
    ...dateNoteLines(options.now, options.timezone, options.hours),
    adReferralNote(options.ad),
    ...(options.extra ?? []),
  ].filter((line): line is string => !!line);
  return [CONTEXT_NOTE_HEADER, ...lines].join('\n');
}
