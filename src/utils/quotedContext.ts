import { unwrapMessageContent } from './unwrapMessageContent';

/** Longest quoted text handed to the AI (the rest is cut with "…"). */
export const QUOTED_TEXT_MAX_CHARS = 200;

const QUOTE_PREFIX = '[respondendo a';

/** Short label of a quoted message without text (or with a caption), in PT-BR. */
const MEDIA_LABELS: [key: string, label: string][] = [
  ['imageMessage', 'uma foto'],
  ['videoMessage', 'um vídeo'],
  ['ptvMessage', 'um vídeo'],
  ['audioMessage', 'um áudio'],
  ['documentMessage', 'um documento'],
  ['stickerMessage', 'uma figurinha'],
  ['locationMessage', 'uma localização'],
  ['liveLocationMessage', 'uma localização'],
  ['contactMessage', 'um contato'],
  ['contactsArrayMessage', 'um contato'],
  ['pollCreationMessage', 'uma enquete'],
  ['pollCreationMessageV3', 'uma enquete'],
];

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();

const truncate = (text: string) =>
  text.length > QUOTED_TEXT_MAX_CHARS ? `${text.slice(0, QUOTED_TEXT_MAX_CHARS).trimEnd()}…` : text;

/** The contextInfo of a message as the channels hand it to the chatbots (messageRaw or a raw WAMessage). */
const findContextInfo = (msg: any): any => {
  if (msg?.contextInfo && typeof msg.contextInfo === 'object') return msg.contextInfo;

  const message = msg?.message;
  if (!message || typeof message !== 'object') return undefined;

  for (const value of Object.values(message)) {
    const contextInfo = (value as any)?.contextInfo;
    if (contextInfo && typeof contextInfo === 'object') return contextInfo;
  }

  return undefined;
};

/**
 * One line telling the AI which message the customer is replying to (#2078), e.g.
 * `[respondendo a: "qual o horário?"]` or `[respondendo a uma foto: "legenda"]`. Undefined when the message
 * quotes nothing. Newlines of the quoted text become spaces, so the line never splits the content.
 */
export function describeQuotedMessage(msg: any): string | undefined {
  const contextInfo = findContextInfo(msg);
  if (!contextInfo) return undefined;

  const quoted = unwrapMessageContent(contextInfo.quotedMessage);

  if (!quoted || typeof quoted !== 'object') {
    // Cloud API (and some Baileys payloads) only bring the id of the quoted message
    return contextInfo.stanzaId ? '[respondendo a uma mensagem anterior]' : undefined;
  }

  const text = quoted.conversation || quoted.extendedTextMessage?.text;
  if (typeof text === 'string' && oneLine(text)) {
    return `[respondendo a: "${truncate(oneLine(text))}"]`;
  }

  for (const [key, label] of MEDIA_LABELS) {
    const media = quoted[key];
    if (!media) continue;
    const caption = typeof media.caption === 'string' ? oneLine(media.caption) : '';
    return caption ? `[respondendo a ${label}: "${truncate(caption)}"]` : `[respondendo a ${label}]`;
  }

  return '[respondendo a uma mensagem anterior]';
}

/**
 * The content handed to the AI with the quote line first (own line: media lines and the debounce merge, which
 * joins messages with "\n", keep working). Content that is not text is returned untouched.
 */
export function withQuotedContext(content: any, msg: any): any {
  if (typeof content !== 'string' || content.length === 0) return content;

  const quote = describeQuotedMessage(msg);
  return quote ? `${quote}\n${content}` : content;
}

/** The content without quote lines, e.g. to compare it with the finish keyword. */
export function stripQuotedContext(content: string): string {
  if (typeof content !== 'string' || !content.includes(QUOTE_PREFIX)) return content;

  return content
    .split('\n')
    .filter((line) => !(line.startsWith(QUOTE_PREFIX) && line.endsWith(']')))
    .join('\n');
}
