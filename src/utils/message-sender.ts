import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Who wrote a WhatsApp message (`Message.sentBy`).
 *
 *   ai      - an automatic answer of the API: chatbots (OpenAI, Typebot...), agenda notices, the call reply
 *   panel   - a person of the team in the WhatsAI panel (request with the `x-wa-origin: panel` header)
 *   api     - any other call of the send routes (integrations, n8n, MCP, Chatwoot)
 *   device  - the number itself outside the API: the phone, WhatsApp Web or Desktop
 *   contact - the customer
 *
 * New rows get the value when they are stored. Older rows have none: `deriveSender` reads what the key allows,
 * and the backfill (scripts/backfill-message-sender.ts) fills what it can prove.
 */
export const MESSAGE_SENDERS = ['ai', 'panel', 'api', 'device', 'contact'] as const;
export type MessageSender = (typeof MESSAGE_SENDERS)[number];
export type ResolvedSender = MessageSender | 'unknown';

export const PANEL_ORIGIN_HEADER = 'x-wa-origin';

export function isMessageSender(value: unknown): value is MessageSender {
  return typeof value === 'string' && (MESSAGE_SENDERS as readonly string[]).includes(value);
}

// ------------------------------------------------------------------------------------------- origin of a send

const sendOrigin = new AsyncLocalStorage<{ panel: boolean }>();

export function runWithSendOrigin<T>(panel: boolean, fn: () => T): T {
  return sendOrigin.run({ panel }, fn);
}

/**
 * Middleware of the send routes: marks the request as written in the panel when it carries `x-wa-origin: panel`.
 * Mounted before the route guards; the context only matters for a request the guards let through.
 */
export function sendOriginMiddleware(
  req: { get?: (name: string) => string | undefined },
  _res: unknown,
  next: () => void,
) {
  const header = String(req?.get?.(PANEL_ORIGIN_HEADER) ?? '')
    .trim()
    .toLowerCase();
  return runWithSendOrigin(header === 'panel', () => next());
}

/** Value stored with a message the API sends. `fromChatbot` is the flag the chatbots and the agenda already pass. */
export function sentByForSend(fromChatbot: boolean): MessageSender {
  if (fromChatbot) return 'ai';
  return sendOrigin.getStore()?.panel ? 'panel' : 'api';
}

/**
 * Value stored with a message that arrives from WhatsApp. A fromMe message arriving here was written on another
 * device of the number (the API's own sends are not delivered back), unless its id is one the API registered as
 * an automatic answer (call reply re-emitted, echo of a chatbot send).
 */
export function sentByForReceived(fromMe: boolean | null | undefined, sentByApiBot: boolean): MessageSender {
  if (!fromMe) return 'contact';
  return sentByApiBot ? 'ai' : 'device';
}

// ------------------------------------------------------------------------------------------- reading old rows

/**
 * Who wrote a stored message, from its column or, for rows stored before it existed, from its key:
 * not fromMe is the contact; fromMe with an id that is not 3EB0... came from the phone; a 3EB0... id is the API or
 * WhatsApp Web (same prefix), so it stays unknown unless the text matches an AI answer (`aiReplies`).
 */
export function deriveSender(
  row: { sentBy?: string | null; key?: any; message?: any },
  aiReplies?: ReadonlySet<string> | null,
): ResolvedSender {
  if (isMessageSender(row?.sentBy)) return row.sentBy;
  const key = typeof row?.key === 'string' ? safeJson(row.key) : row?.key;
  if (!key?.fromMe) return 'contact';
  const id = String(key?.id ?? '');
  if (id && !id.toUpperCase().startsWith('3EB0')) return 'device';
  if (aiReplies?.size && matchesAiReply(messageBodyText(row?.message), aiReplies)) return 'ai';
  return 'unknown';
}

export const SENDER_LABELS: Record<ResolvedSender, string> = {
  ai: 'ia',
  panel: 'equipe_painel',
  device: 'equipe_celular',
  api: 'api',
  contact: 'cliente',
  unknown: 'nao_identificado',
};

export function senderLabel(sender: ResolvedSender): string {
  return SENDER_LABELS[sender] ?? SENDER_LABELS.unknown;
}

// ------------------------------------------------------------------------------------------- AI answers

const normalize = (text: string) =>
  text
    .replace(/[*_~`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

/**
 * The AI answers kept in the history of the bot sessions (context.history, role "assistant"), as an index for an
 * exact match: the whole answer and each part split by a blank line (splitMessages sends them one by one).
 * Formatting marks (*, _, ~, `) and spacing are ignored; nothing else is.
 */
export function aiReplyIndex(sessions: { context?: any }[] | null | undefined): Set<string> {
  const index = new Set<string>();
  for (const session of sessions ?? []) {
    const context = typeof session?.context === 'string' ? safeJson(session.context) : session?.context;
    for (const item of Array.isArray(context?.history) ? context.history : []) {
      if (item?.role !== 'assistant') continue;
      const content =
        typeof item.content === 'string'
          ? item.content
          : Array.isArray(item.content)
            ? item.content.map((part: any) => (part?.type === 'text' ? part.text : '')).join('\n')
            : '';
      if (!content) continue;
      for (const piece of [content, ...content.split(/\n\s*\n/)]) {
        const key = normalize(piece);
        if (key.length >= 2) index.add(key);
      }
    }
  }
  return index;
}

export function matchesAiReply(text: string | null | undefined, index: ReadonlySet<string>): boolean {
  if (!text || !index?.size) return false;
  const key = normalize(text);
  return key.length >= 2 && index.has(key);
}

/** Text written in a stored message (text, caption), without transcriptions. */
export function messageBodyText(message: any): string | null {
  const m = typeof message === 'string' ? safeJson(message) : message;
  if (!m || typeof m !== 'object') return null;
  const text =
    m.conversation ??
    m.extendedTextMessage?.text ??
    m.imageMessage?.caption ??
    m.videoMessage?.caption ??
    m.documentMessage?.caption ??
    m.documentWithCaptionMessage?.message?.documentMessage?.caption ??
    null;
  return typeof text === 'string' && text.trim() ? text : null;
}

function safeJson(value: string): any {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
