import { createJid } from '@utils/createJid';

/** Largest JSON text a tool returns; bigger outputs are cut (the tools paginate well below this). */
export const MAX_TEXT_OUTPUT = 120_000;
/** Longest text of one message in a listing. */
export const MAX_MESSAGE_TEXT = 4_000;

export type ToolContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }
  | { type: 'audio'; data: string; mimeType: string }
  | { type: 'resource'; resource: { uri: string; mimeType?: string; blob: string } };

export type ToolResult = { content: ToolContent[]; isError?: boolean };

/** An error whose message is meant for the user (Portuguese, no internals). */
export class McpToolError extends Error {}

export function toJsonText(data: unknown): string {
  const text = JSON.stringify(data, null, 2) ?? 'null';
  if (text.length <= MAX_TEXT_OUTPUT) return text;

  return `${text.slice(0, MAX_TEXT_OUTPUT)}\n... [resposta cortada em ${MAX_TEXT_OUTPUT} caracteres: use paginação ou filtros menores]`;
}

export function jsonResult(data: unknown, extra: ToolContent[] = []): ToolResult {
  return { content: [{ type: 'text', text: toJsonText(data) }, ...extra] };
}

export function errorResult(message: string): ToolResult {
  return { content: [{ type: 'text', text: `Erro: ${message}` }], isError: true };
}

const GENERIC_ERROR = 'falha ao executar a operação no servidor (os detalhes ficam só nos logs do serviço).';

/** Known messages of the services (English) and what to tell the user instead. */
const KNOWN_ERRORS: [RegExp, string][] = [
  [/is disabled/i, 'a integração está desativada neste servidor.'],
  [/Error updating/i, 'o servidor recusou a alteração do bot (gatilho ou modelo duplicado, ou campo inválido).'],
  [/Error changing .* status/i, 'o servidor não conseguiu mudar o estado da sessão do bot.'],
  [/Connection Closed|not connected|Connection closed/i, 'a instância não está conectada ao WhatsApp no momento.'],
  [/not found/i, 'registro não encontrado.'],
  [/exists:\s*false|not on whatsapp/i, 'este número não tem WhatsApp.'],
];

function rawMessage(error: unknown): string {
  let message: unknown = error;
  if (error && typeof error === 'object') {
    const value = (error as any).message ?? (error as any).response?.message ?? (error as any).error;
    message = Array.isArray(value)
      ? value.map((item) => (typeof item === 'string' ? item : JSON.stringify(item))).join('; ')
      : value;
  }
  return typeof message === 'string' ? message.trim() : '';
}

/**
 * Message for the user (Portuguese) of anything a tool throws. McpToolError texts are already meant for the user;
 * anything else (services throw English Errors, strings or the `{ status, error, message: [...] }` objects of
 * src/exceptions) is mapped to a known Portuguese message or to a generic one, so internals never leak.
 */
export function errorMessage(error: unknown): string {
  if (error instanceof McpToolError) return error.message;

  const text = rawMessage(error);
  const known = KNOWN_ERRORS.find(([pattern]) => pattern.test(text));
  return known ? known[1] : GENERIC_ERROR;
}

/** The original text of an error, for the server log only (short, no secrets). */
export function logMessage(error: unknown): string {
  const text = rawMessage(error) || String(error);
  return /bearer|apikey|api_key|token=|password|secret/i.test(text) ? '[mensagem omitida]' : text.slice(0, 300);
}

/** `****abcd`: only the last 4 characters of a long secret; short or empty values are fully hidden. */
export function maskSecret(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;

  const text = String(value);
  return text.length >= 12 ? `****${text.slice(-4)}` : '****';
}

const SECRET_KEY = /(token|api[-_]?key|secret|password|passwd|authorization|cookie|credential|private[-_]?key)/i;

/** Deep copy with every value under a secret-looking key masked (settings, observability snapshot). */
export function scrubSecrets<T>(value: T, depth = 0): T {
  if (depth > 12 || value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((item) => scrubSecrets(item, depth + 1)) as unknown as T;
  if (value instanceof Date) return value;
  if (typeof value !== 'object') return value;

  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY.test(key) && item !== null && item !== undefined && typeof item !== 'boolean') {
      result[key] = typeof item === 'object' ? '****' : maskSecret(item);
    } else {
      result[key] = scrubSecrets(item, depth + 1);
    }
  }

  return result as T;
}

/** Hides credentials in a URL: user:password and every query string value. */
export function maskUrl(url: unknown): string | null {
  if (typeof url !== 'string' || !url) return null;

  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = '****';
    for (const key of [...parsed.searchParams.keys()]) parsed.searchParams.set(key, '****');
    return parsed.toString();
  } catch {
    return '****';
  }
}

const digitsOf = (value: string) => value.replace(/[\s()+.-]/g, '');

/**
 * JID of a contact for reading (chats, messages, sessions): a full JID (`...@s.whatsapp.net`, `...@lid`,
 * `...@g.us`) or a phone number with country code, in any common formatting.
 */
export function normalizeContactJid(input: string): string {
  const value = String(input ?? '').trim();

  if (value.includes('@')) {
    if (!/^[\d-]+(:\d+)?@(s\.whatsapp\.net|lid|g\.us)$/.test(value)) {
      throw new McpToolError(
        `contato inválido "${value}": use o número com DDI e DDD (ex.: 5511999998888) ou um JID completo.`,
      );
    }
    return value.replace(/:\d+@/, '@');
  }

  const digits = digitsOf(value);
  if (!/^\d{8,15}$/.test(digits)) {
    throw new McpToolError(`contato inválido "${value}": use o número com DDI e DDD, só dígitos (ex.: 5511999998888).`);
  }

  return createJid(digits);
}

/**
 * Recipient of an outbound message: a phone number with country code (10 to 15 digits) or a private-chat JID.
 * Groups are refused on purpose.
 */
export function normalizeRecipient(input: string): string {
  const value = String(input ?? '').trim();

  if (value.includes('@')) {
    if (value.endsWith('@g.us')) throw new McpToolError('o envio para grupos não é permitido pelo MCP.');
    if (!/^\d{8,15}@s\.whatsapp\.net$/.test(value) && !/^\d{6,20}@lid$/.test(value)) {
      throw new McpToolError(`destinatário inválido "${value}".`);
    }
    return value;
  }

  const digits = digitsOf(value);
  if (!/^\d{10,15}$/.test(digits)) {
    throw new McpToolError(
      `número inválido "${value}": use DDI + DDD + número, só dígitos (ex.: 5511999998888), de 10 a 15 dígitos.`,
    );
  }

  return digits;
}

export const phoneOf = (jid: unknown): string | null =>
  typeof jid === 'string' && jid.endsWith('@s.whatsapp.net') ? jid.split('@')[0] : null;

const WRAPPERS = [
  'ephemeralMessage',
  'viewOnceMessage',
  'viewOnceMessageV2',
  'viewOnceMessageV2Extension',
  'documentWithCaptionMessage',
  'editedMessage',
];

/** The inner message of the WhatsApp wrappers (temporary, view once, document with caption, edited). */
export function unwrapMessage(message: any): any {
  let current = message;
  for (let i = 0; i < 4 && current && typeof current === 'object'; i++) {
    const wrapper = WRAPPERS.find((name) => current[name]?.message);
    if (!wrapper) break;
    current = { ...current, ...current[wrapper].message };
  }
  return current ?? {};
}

export const MEDIA_TYPES = [
  'imageMessage',
  'videoMessage',
  'audioMessage',
  'documentMessage',
  'stickerMessage',
  'ptvMessage',
] as const;

export type MediaInfo = {
  kind: 'image' | 'video' | 'audio' | 'document' | 'sticker';
  messageType: string;
  mimetype: string | null;
  fileName: string | null;
  sizeBytes: number | null;
  seconds: number | null;
  width: number | null;
  height: number | null;
  caption: string | null;
  voiceNote: boolean;
};

/** `fileLength` comes as number, string or protobuf Long (`{ low, high }`). */
export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return Number.isFinite(Number(value)) ? Number(value) : null;
  if (typeof value === 'object' && 'low' in (value as any)) {
    const { low, high } = value as { low: number; high: number };
    return (high >>> 0) * 2 ** 32 + (low >>> 0);
  }
  return null;
}

export function mediaInfo(message: any): MediaInfo | null {
  const inner = unwrapMessage(message);
  const type = MEDIA_TYPES.find((name) => inner?.[name] && typeof inner[name] === 'object');
  if (!type) return null;

  const node = inner[type];
  const kind = (
    {
      imageMessage: 'image',
      videoMessage: 'video',
      ptvMessage: 'video',
      audioMessage: 'audio',
      documentMessage: 'document',
      stickerMessage: 'sticker',
    } as const
  )[type];

  return {
    kind,
    messageType: type,
    mimetype: node.mimetype ?? null,
    fileName: node.fileName ?? null,
    sizeBytes: toNumber(node.fileLength),
    seconds: toNumber(node.seconds),
    width: toNumber(node.width),
    height: toNumber(node.height),
    caption: node.caption ?? null,
    voiceNote: !!node.ptt,
  };
}

const truncate = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}… [cortado]` : text);

/** Readable text of a stored message (text, caption, transcription or a short description of the type). */
export function messageText(message: any, max = MAX_MESSAGE_TEXT): string | null {
  const m = unwrapMessage(message);
  const media = mediaInfo(m);

  const text =
    m.conversation ||
    m.extendedTextMessage?.text ||
    media?.caption ||
    m.speechToText ||
    m.buttonsResponseMessage?.selectedDisplayText ||
    m.templateButtonReplyMessage?.selectedDisplayText ||
    m.listResponseMessage?.title ||
    m.pollCreationMessage?.name ||
    m.pollCreationMessageV3?.name ||
    (m.reactionMessage ? `[reação ${m.reactionMessage.text || ''}]`.trim() : null) ||
    (m.locationMessage
      ? `[localização ${m.locationMessage.degreesLatitude}, ${m.locationMessage.degreesLongitude}]`
      : null) ||
    (m.contactMessage ? `[contato ${m.contactMessage.displayName || ''}]`.trim() : null) ||
    (media
      ? `[${media.kind}${media.fileName ? ` ${media.fileName}` : ''}${media.seconds ? ` ${media.seconds}s` : ''}]`
      : null);

  return typeof text === 'string' && text ? truncate(text, max) : null;
}

export const isoFromSeconds = (seconds: unknown): string | null => {
  const value = toNumber(seconds);
  return value && value > 0 ? new Date(value * 1000).toISOString() : null;
};

export const isoDate = (value: unknown): string | null => {
  if (!value) return null;
  const time = value instanceof Date ? value.getTime() : new Date(value as string).getTime();
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
};
