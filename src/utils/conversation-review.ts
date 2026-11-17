import { ResolvedSender } from './message-sender';

/**
 * Conversations as text for a review of the AI (export ZIP, MCP). Only what a review needs and nothing that
 * identifies the contact: the number becomes "****1234", names are not written, and e-mails, CPF/CNPJ and long runs
 * of digits inside the texts are redacted. Times are in Brasília.
 */
export const REVIEW_TIME_ZONE = 'America/Sao_Paulo';
export const MAX_REVIEW_DAYS = 31;

export class ReviewPeriodError extends Error {}

export type ReviewPeriod = { from: string; to: string; fromSeconds: number; toSeconds: number; days: number };

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function dayStart(value: string, field: string): number {
  if (typeof value !== 'string' || !DAY.test(value)) {
    throw new ReviewPeriodError(`${field} inválida: use AAAA-MM-DD.`);
  }
  const ms = Date.parse(`${value}T00:00:00-03:00`);
  // Round trip: refuses 2026-02-31 and similar
  const back = new Date(ms - 3 * 3600 * 1000).toISOString().slice(0, 10);
  if (!Number.isFinite(ms) || back !== value) throw new ReviewPeriodError(`${field} inválida: ${value} não existe.`);
  return ms;
}

/** `from`/`to` as days of Brasília (both included), at most 31 days. */
export function parseReviewPeriod(from: unknown, to: unknown): ReviewPeriod {
  if (!from || !to) throw new ReviewPeriodError('Informe o período: from e to (AAAA-MM-DD).');
  const start = dayStart(String(from), 'from');
  const end = dayStart(String(to), 'to');
  if (start > end) throw new ReviewPeriodError('from é depois de to.');
  const days = Math.round((end - start) / 86_400_000) + 1;
  if (days > MAX_REVIEW_DAYS) {
    throw new ReviewPeriodError(`O período vai até ${MAX_REVIEW_DAYS} dias (pedido: ${days}). Exporte em partes.`);
  }
  return {
    from: String(from),
    to: String(to),
    fromSeconds: Math.floor(start / 1000),
    toSeconds: Math.floor(end / 1000) + 86_399,
    days,
  };
}

// ------------------------------------------------------------------------------------------- identity

/** Contact of a message for the review: the phone JID when the key also has it (LID merge); no groups. */
export function conversationJid(key: any): string | null {
  const jid = typeof key?.remoteJid === 'string' ? key.remoteJid : '';
  if (!jid || jid.endsWith('@g.us') || jid.endsWith('@broadcast') || jid.endsWith('@newsletter')) return null;
  const alt = typeof key?.remoteJidAlt === 'string' ? key.remoteJidAlt : '';
  if (jid.endsWith('@lid') && alt.endsWith('@s.whatsapp.net')) return alt;
  return jid;
}

/** "5521987654321@s.whatsapp.net" -> "****4321". */
export function maskedRef(jid: string): string {
  const digits = String(jid ?? '')
    .split('@')[0]
    .replace(/\D/g, '');
  return `****${digits.slice(-4) || '0000'}`;
}

// ------------------------------------------------------------------------------------------- redaction

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const CPF = /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g;
const CNPJ = /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g;
/** A run with at least 8 digits, allowing the separators of phones and documents. */
const DIGIT_RUN = /\+?\(?\d[\d\s().\/-]{6,}\d/g;
const DATE = /^\d{1,2}\/\d{1,2}(\/\d{2,4})?$/;

/** E-mails, CPF, CNPJ and long runs of digits (phones, documents, process numbers) out of a text. Dates stay. */
export function redactText(text: string | null | undefined): string {
  if (!text) return '';
  return String(text)
    .replace(EMAIL, '[e-mail]')
    .replace(CNPJ, '[CNPJ]')
    .replace(CPF, '[CPF]')
    .replace(DIGIT_RUN, (run) => {
      const digits = run.replace(/\D/g, '').length;
      if (digits < 8 || DATE.test(run.trim())) return run;
      return '[número]';
    });
}

// ------------------------------------------------------------------------------------------- content

const unwrap = (message: any): any => {
  let m = message;
  for (let i = 0; i < 4 && m; i++) {
    const inner =
      m.ephemeralMessage?.message ??
      m.viewOnceMessage?.message ??
      m.viewOnceMessageV2?.message ??
      m.editedMessage?.message;
    if (!inner) break;
    m = inner;
  }
  return m;
};

const seconds = (value: unknown): string => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? ` ${Math.round(n)} s` : '';
};

const withCaption = (marker: string, caption: unknown) =>
  typeof caption === 'string' && caption.trim() ? `${marker} ${caption.trim()}` : marker;

/** Messages that are not content (keys, receipts, edits applied elsewhere): skipped in the review. */
const SKIPPED = new Set(['protocolMessage', 'senderKeyDistributionMessage', 'messageContextInfo', 'pollUpdateMessage']);

/**
 * What a message says, as one line of text (before redaction): the text, or a marker for media
 * ("[áudio 40 s · transcrição: ...]", "[documento: nome.pdf]"). Null when the message is not content.
 */
export function messageContent(raw: any, messageType?: string | null): string | null {
  const message = unwrap(typeof raw === 'string' ? safeJson(raw) : raw);
  const type = String(messageType ?? '');
  if (SKIPPED.has(type)) return null;
  if (!message || typeof message !== 'object') return type ? `[${type}]` : null;

  if (typeof message.conversation === 'string' && message.conversation) return message.conversation;
  if (message.extendedTextMessage?.text) return message.extendedTextMessage.text;
  if (message.imageMessage) return withCaption('[imagem]', message.imageMessage.caption);
  if (message.videoMessage)
    return withCaption(`[vídeo${seconds(message.videoMessage.seconds)}]`, message.videoMessage.caption);
  if (message.ptvMessage) return `[vídeo${seconds(message.ptvMessage.seconds)}]`;
  if (message.audioMessage) {
    const stt =
      typeof message.speechToText === 'string' ? message.speechToText.replace(/^\[audio\]\s*/i, '').trim() : '';
    const head = `áudio${seconds(message.audioMessage.seconds)}`;
    return stt ? `[${head} · transcrição: ${stt}]` : `[${head}]`;
  }
  const doc = message.documentMessage ?? message.documentWithCaptionMessage?.message?.documentMessage;
  if (doc) return withCaption(`[documento: ${doc.fileName || doc.title || 'sem nome'}]`, doc.caption);
  if (message.stickerMessage) return '[figurinha]';
  if (message.locationMessage || message.liveLocationMessage) return '[localização]';
  if (message.contactMessage || message.contactsArrayMessage) return '[contato compartilhado]';
  if (message.reactionMessage) {
    const emoji = String(message.reactionMessage.text ?? '').trim();
    return emoji ? `[reação: ${emoji}]` : null;
  }
  if (message.pollCreationMessage || message.pollCreationMessageV3) {
    return `[enquete: ${(message.pollCreationMessage ?? message.pollCreationMessageV3).name ?? ''}]`;
  }
  if (message.buttonsResponseMessage?.selectedDisplayText) return message.buttonsResponseMessage.selectedDisplayText;
  if (message.listResponseMessage?.title) return message.listResponseMessage.title;
  if (Object.keys(message).every((k) => SKIPPED.has(k) || k === 'messageContextInfo')) return null;
  return type ? `[${type}]` : '[mensagem]';
}

// ------------------------------------------------------------------------------------------- output

export const SPEAKER: Record<ResolvedSender, string> = {
  contact: 'Cliente',
  ai: 'IA',
  panel: 'Equipe (painel)',
  device: 'Equipe (celular)',
  api: 'API',
  unknown: 'Número (não identificado)',
};

export type ReviewEntry = {
  messageId: string | null;
  /** Unix seconds. */
  at: number;
  sender: ResolvedSender;
  type: string;
  /** Already redacted. */
  text: string;
};

export type ReviewConversation = {
  ref: string;
  entries: ReviewEntry[];
};

const dayFmt = new Intl.DateTimeFormat('pt-BR', {
  timeZone: REVIEW_TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});
const timeFmt = new Intl.DateTimeFormat('pt-BR', {
  timeZone: REVIEW_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export const reviewDay = (at: number) => dayFmt.format(new Date(at * 1000));
export const reviewTime = (at: number) => timeFmt.format(new Date(at * 1000));
/** "2026-11-12" in Brasília, for file names. */
export const reviewIsoDay = (at: number) => reviewDay(at).split('/').reverse().join('-');

export function senderCounts(entries: ReviewEntry[]): Record<ResolvedSender, number> {
  const counts: Record<ResolvedSender, number> = { contact: 0, ai: 0, panel: 0, device: 0, api: 0, unknown: 0 };
  for (const entry of entries) counts[entry.sender]++;
  return counts;
}

/** "## Conversa ****1234 · 12/11/2026" and one line per message ("[14:03] Cliente: ..."), a separator per day. */
export function conversationMarkdown(conversation: ReviewConversation): string {
  const entries = conversation.entries;
  if (!entries.length) return '';
  const counts = senderCounts(entries);
  const summary = (Object.keys(counts) as ResolvedSender[])
    .filter((sender) => counts[sender])
    .map((sender) => `${SPEAKER[sender]} ${counts[sender]}`)
    .join(' · ');
  const lines = [
    `## Conversa ${conversation.ref} · ${reviewDay(entries[0].at)}`,
    '',
    `${entries.length} mensagens: ${summary}`,
    '',
  ];
  let day = reviewDay(entries[0].at);
  for (const entry of entries) {
    const current = reviewDay(entry.at);
    if (current !== day) {
      lines.push('', `— ${current} —`, '');
      day = current;
    }
    lines.push(`[${reviewTime(entry.at)}] ${SPEAKER[entry.sender]}: ${entry.text.replace(/\s*\n\s*/g, ' / ')}`);
  }
  return `${lines.join('\n')}\n`;
}

export const JSONL_SENDER: Record<ResolvedSender, string> = {
  contact: 'cliente',
  ai: 'ia',
  panel: 'equipe_painel',
  device: 'equipe_celular',
  api: 'api',
  unknown: 'nao_identificado',
};

export function conversationJsonl(conversation: ReviewConversation): string {
  return conversation.entries
    .map(
      (entry) =>
        `${JSON.stringify({
          conversa: conversation.ref,
          em: new Date(entry.at * 1000).toISOString(),
          quem: JSONL_SENDER[entry.sender],
          tipo: entry.type,
          texto: entry.text,
          messageId: entry.messageId,
        })}\n`,
    )
    .join('');
}

function safeJson(value: string): any {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
