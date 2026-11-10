/**
 * Texts of the "Processos" notifications and the quiet hours.
 *
 * Owner policy (law office): the TEAM gets the full detail; the CLIENT (off by default, only a contact the team
 * linked to the process, never for processes under segredo de justiça) gets ONLY a neutral sentence: never the
 * movement or publication text, deadlines, decisions, values or chances.
 */
import { isValidTimeZone, zonedParts } from '@utils/usageLimits';

import { tribunalLabel } from './cnj';

export const DEFAULT_CLIENT_TEMPLATE =
  'Olá, {nome}. Houve uma atualização no seu processo. O escritório vai analisar e entrar em contato.';

export type QuietHours = { enabled: boolean; start: string; end: string; timezone: string };
export const DEFAULT_QUIET_HOURS: QuietHours = {
  enabled: true,
  start: '20:00',
  end: '08:00',
  timezone: 'America/Sao_Paulo',
};

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const toMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

export function normalizeQuietHours(value: any): QuietHours {
  const q = value && typeof value === 'object' ? value : {};
  return {
    enabled: q.enabled === undefined ? DEFAULT_QUIET_HOURS.enabled : q.enabled === true,
    start: TIME.test(q.start) ? q.start : DEFAULT_QUIET_HOURS.start,
    end: TIME.test(q.end) ? q.end : DEFAULT_QUIET_HOURS.end,
    timezone: isValidTimeZone(q.timezone) ? q.timezone : DEFAULT_QUIET_HOURS.timezone,
  };
}

/** True while notifications must wait (a range whose end is before its start crosses midnight). */
export function isQuietNow(quiet: QuietHours, now: Date = new Date()): boolean {
  if (!quiet?.enabled || quiet.start === quiet.end) return false;
  const minutes = zonedParts(now, quiet.timezone).minutes;
  const s = toMinutes(quiet.start);
  const e = toMinutes(quiet.end);
  return s < e ? minutes >= s && minutes < e : minutes >= s || minutes < e;
}

/** Next moment the quiet hours end (minute precision; at most 24 h ahead). */
export function quietEndsAt(quiet: QuietHours, now: Date = new Date()): Date {
  const start = Math.floor(now.getTime() / 60_000) * 60_000;
  for (let k = 1; k <= 24 * 60; k++) {
    const candidate = new Date(start + k * 60_000);
    if (!isQuietNow(quiet, candidate)) return candidate;
  }
  return new Date(start + 24 * 3600_000);
}

const dateBR = (date: Date | string | null | undefined, timeZone = 'America/Sao_Paulo'): string => {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('pt-BR', { timeZone, day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
};
export { dateBR };

const short = (text: string | null | undefined, max: number): string => {
  const clean = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return clean.length > max ? clean.slice(0, max - 1).trimEnd() + '…' : clean;
};

type ProcessLike = { apelido?: string | null; numeroCnj: string; tribunalAlias: string };
type MovementLike = { occurredAt: Date; name: string; complement?: string | null };

/** Team: "Nova movimentação — <apelido|número> (<TRIBUNAL>)\n<data> · <nome>\n<complemento curto>". */
export function teamMovementText(process: ProcessLike, movements: MovementLike[], max = 5): string {
  const title = `Nova movimentação — ${process.apelido?.trim() || process.numeroCnj} (${tribunalLabel(process.tribunalAlias)})`;
  const sorted = [...movements].sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
  const lines = sorted.slice(0, max).map((m) => {
    const head = `${dateBR(m.occurredAt)} · ${short(m.name, 200)}`;
    const complement = short(m.complement, 160);
    return complement ? `${head}\n${complement}` : head;
  });
  if (process.apelido?.trim()) lines.push(`Processo ${process.numeroCnj}`);
  if (sorted.length > max) lines.push(`+${sorted.length - max} outra(s) no painel.`);
  return [title, ...lines].join('\n');
}

type PublicationLike = {
  siglaTribunal?: string | null;
  processNumber?: string | null;
  tipo?: string | null;
  texto?: string | null;
  link?: string | null;
};

/** Team: "Nova intimação/publicação no DJEN — <tribunal> · <processo>\n<primeiras linhas>\n<link>". */
export function teamPublicationText(publication: PublicationLike): string {
  const title = `Nova intimação/publicação no DJEN — ${publication.siglaTribunal || 'tribunal'} · ${publication.processNumber || 'sem número'}`;
  const lines = [title];
  if (publication.tipo) lines.push(publication.tipo);
  const firstLines = String(publication.texto ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(' ');
  if (firstLines) lines.push(short(firstLines, 300));
  if (publication.link) lines.push(publication.link);
  return lines.join('\n');
}

/** The only placeholder of the client template: anything else could leak the movement (owner policy). */
export function validateClientTemplate(template: unknown): string | null {
  if (template == null || template === '') return null;
  const text = String(template);
  if (text.length > 500) return 'A mensagem para o cliente pode ter até 500 caracteres.';
  const placeholders = text.match(/\{[^}]*\}/g) ?? [];
  if (placeholders.some((p) => p !== '{nome}')) {
    return 'A mensagem para o cliente só aceita o campo {nome} (nunca o conteúdo da movimentação).';
  }
  return null;
}

/** Client: neutral sentence only. Without a name, ", {nome}" disappears ("Olá. Houve..."). */
export function clientMessageText(template: string | null | undefined, name: string | null | undefined): string {
  const base = template && !validateClientTemplate(template) ? template : DEFAULT_CLIENT_TEMPLATE;
  const first = String(name ?? '')
    .trim()
    .split(/\s+/)[0];
  return first ? base.replace(/\{nome\}/g, first) : base.replace(/,?\s*\{nome\}/g, '');
}

/** "5521999990000" / "+55 (21) 99999-0000" -> "5521999990000"; null when it cannot be a phone. */
export function normalizeNotifyNumber(value: unknown): string | null {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15 ? digits : null;
}
