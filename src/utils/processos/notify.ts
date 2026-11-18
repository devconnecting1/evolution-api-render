/**
 * Texts of the "Processos" notifications and the quiet hours.
 *
 * Owner policy (law office): the TEAM gets the full detail; the CLIENT (off by default, only a contact the team
 * linked to the process, never for processes under segredo de justiça) gets ONLY a neutral sentence: never the
 * movement or publication text, deadlines, decisions, values or chances.
 */
import { isValidTimeZone, zonedParts } from '@utils/usageLimits';

import { cnjCheckDigits, formatCnj, tribunalLabel } from './cnj';

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

/** Fictitious process of the preview: valid CNJ number of the TJRJ (8.19), never a real case. */
export function sampleProcess(): { apelido: string; numeroCnj: string; tribunalAlias: string } {
  const [sequencial, ano, j, tr, origem] = ['0001234', '2026', '8', '19', '0001'];
  const digits = sequencial + cnjCheckDigits(sequencial, ano, j, tr, origem) + ano + j + tr + origem;
  return { apelido: 'Exemplo: Maria x Banco Exemplo', numeroCnj: formatCnj(digits), tribunalAlias: 'tjrj' };
}

export type NoticePreview = {
  client: { text: string; rules: string[] };
  team: { movement: string; publication: string; numbers: string[]; numbersFrom: 'processos' | 'leads' | 'nenhum' };
  quiet: { now: boolean; sendsAt: string | null; label: string };
};

/**
 * What the team and the client would receive, with the instance settings (or the unsaved values of the panel) and a
 * fictitious process. Nothing is sent: the panel shows it so the office sees the exact texts before switching on.
 */
export function buildNoticePreview(input: {
  template: string | null | undefined;
  clientName?: string | null;
  quietHours: QuietHours;
  numbers: string[];
  numbersFrom: 'processos' | 'leads' | 'nenhum';
  now?: Date;
}): NoticePreview {
  const now = input.now ?? new Date();
  const process = sampleProcess();
  const day = (offset: number) => new Date(now.getTime() - offset * 24 * 3600_000);
  const movement = teamMovementText(process, [
    { occurredAt: day(0), name: 'Juntada de Petição', complement: 'Petição de manifestação da parte autora' },
    { occurredAt: day(1), name: 'Conclusos para decisão', complement: null },
  ]);
  const publication = teamPublicationText({
    siglaTribunal: 'TJRJ',
    processNumber: process.numeroCnj,
    tipo: 'Intimação',
    texto: 'Fica a parte autora intimada para se manifestar sobre a contestação no prazo legal. (texto de exemplo)',
    link: null,
  });
  const quietNow = isQuietNow(input.quietHours, now);
  const sendsAt = quietNow ? quietEndsAt(input.quietHours, now) : null;
  const hhmm = (date: Date) =>
    new Intl.DateTimeFormat('pt-BR', {
      timeZone: input.quietHours.timezone,
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  return {
    client: {
      text: clientMessageText(input.template, input.clientName === undefined ? 'Maria Silva' : input.clientName),
      rules: [
        'Só para processo com "Avisar cliente" ligado e um contato vinculado pela equipe.',
        'No máximo 1 aviso a cada 20 horas por processo.',
        'Nunca em segredo de justiça. Nunca vai o conteúdo, prazo ou decisão.',
        'A primeira importação de um processo não avisa ninguém.',
      ],
    },
    team: { movement, publication, numbers: input.numbers, numbersFrom: input.numbersFrom },
    quiet: {
      now: quietNow,
      sendsAt: sendsAt ? sendsAt.toISOString() : null,
      label: quietNow
        ? `Agora é horário de silêncio: um aviso agora sairia às ${hhmm(sendsAt as Date)}.`
        : input.quietHours.enabled
          ? `Fora do horário de silêncio (${input.quietHours.start}–${input.quietHours.end}): um aviso agora sairia na hora.`
          : 'Horário de silêncio desligado: os avisos saem na hora.',
    },
  };
}
