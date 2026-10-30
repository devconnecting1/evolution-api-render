import { inflateSync } from 'zlib';

/**
 * What the OpenAI bot does with media (audio, images, documents) and how much history it keeps.
 * Each value comes from the bot, then from the default settings, then from these defaults (bot null = inherit).
 */
export type OpenaiMediaOptions = {
  transcribeAudio: boolean;
  transcriptionModel: string;
  /** Longer audios are not transcribed. 0 = no limit. */
  maxAudioSeconds: number;
  readImages: boolean;
  readDocuments: boolean;
  maxDocumentMB: number;
  /** Previous messages of the conversation sent to Chat Completions. */
  historyMessages: number;
};

export const OPENAI_MEDIA_DEFAULTS: Readonly<OpenaiMediaOptions> = Object.freeze({
  transcribeAudio: true,
  transcriptionModel: 'gpt-transcribe',
  maxAudioSeconds: 300,
  readImages: true,
  readDocuments: true,
  maxDocumentMB: 10,
  historyMessages: 10,
});

/** Model tried once when OpenAI rejects the configured transcription model. */
export const FALLBACK_TRANSCRIPTION_MODEL = 'whisper-1';

export const HISTORY_MESSAGES_MIN = 2;
export const HISTORY_MESSAGES_MAX = 100;
/** OpenAI accepts up to 32 MB of file content per request. */
export const MAX_DOCUMENT_MB_LIMIT = 32;
export const MAX_AUDIO_SECONDS_LIMIT = 86400;
/** PDFs with more pages are not sent to the model (cost: every page is read as text and as an image). */
export const MAX_PDF_PAGES = 20;

const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';
const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const isInteger = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value);

const pick = <T>(isValid: (value: unknown) => value is T, fallback: T, ...values: unknown[]): T => {
  const found = values.find((value) => value !== null && value !== undefined && isValid(value));
  return (found as T) ?? fallback;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Media options of a bot: bot value, then settings value, then default (invalid values are ignored). */
export const resolveOpenaiMediaOptions = (bot: any, settings: any): OpenaiMediaOptions => {
  const d = OPENAI_MEDIA_DEFAULTS;

  return {
    transcribeAudio: pick(isBoolean, d.transcribeAudio, bot?.transcribeAudio, settings?.transcribeAudio),
    transcriptionModel: pick(
      isNonEmptyString,
      d.transcriptionModel,
      bot?.transcriptionModel,
      settings?.transcriptionModel,
    ).trim(),
    maxAudioSeconds: clamp(
      pick(isInteger, d.maxAudioSeconds, bot?.maxAudioSeconds, settings?.maxAudioSeconds),
      0,
      MAX_AUDIO_SECONDS_LIMIT,
    ),
    readImages: pick(isBoolean, d.readImages, bot?.readImages, settings?.readImages),
    readDocuments: pick(isBoolean, d.readDocuments, bot?.readDocuments, settings?.readDocuments),
    maxDocumentMB: clamp(
      pick(isInteger, d.maxDocumentMB, bot?.maxDocumentMB, settings?.maxDocumentMB),
      1,
      MAX_DOCUMENT_MB_LIMIT,
    ),
    historyMessages: clamp(
      pick(isInteger, d.historyMessages, bot?.historyMessages, settings?.historyMessages),
      HISTORY_MESSAGES_MIN,
      HISTORY_MESSAGES_MAX,
    ),
  };
};

// ---------------------------------------------------------------------------------------------------------------
// Texts the model receives in place of media it cannot (or must not) read. Never shown to the contact.
// ---------------------------------------------------------------------------------------------------------------
export const MEDIA_TEXT = {
  audio: '[o contato enviou um áudio]',
  audioTooLong: (minutes: number) => `[o contato enviou um áudio de ${minutes} min; a equipe vai ouvir]`,
  image: '[o contato enviou uma imagem]',
  video: '[o contato enviou um vídeo]',
  sticker: '[figurinha]',
};

export const withCaption = (text: string, caption?: string | null) => {
  const trimmed = typeof caption === 'string' ? caption.trim() : '';
  return trimmed ? `${text}\n${trimmed}` : text;
};

/** "[o contato enviou um áudio de N min; ...]" with N rounded up (at least 1). */
export const describeLongAudio = (seconds: number) => MEDIA_TEXT.audioTooLong(Math.max(1, Math.ceil(seconds / 60)));

const toNumber = (value: any): number | undefined => {
  if (value === null || value === undefined || value === '') return undefined;
  // Baileys may hand protobuf Long objects
  const number = typeof value === 'object' && typeof value.toNumber === 'function' ? value.toNumber() : Number(value);
  return Number.isFinite(number) ? number : undefined;
};

/** Duration of a WhatsApp audio message, when the channel provides it (Baileys `seconds`). */
export const getAudioSeconds = (msg: any): number | undefined => {
  const seconds = toNumber(msg?.message?.audioMessage?.seconds);
  return seconds !== undefined && seconds > 0 ? seconds : undefined;
};

const formatCoordinate = (value: any) => {
  const number = toNumber(value);
  return number === undefined ? undefined : String(Number(number.toFixed(6)));
};

const contactName = (contact: any): string | undefined => {
  if (!contact) return undefined;
  if (isNonEmptyString(contact.displayName)) return contact.displayName.trim();
  const fn = typeof contact.vcard === 'string' ? /^FN:(.+)$/m.exec(contact.vcard)?.[1]?.trim() : undefined;
  return fn || undefined;
};

/**
 * Clear text for message types the OpenAI bot cannot read (video, sticker, location, shared contact), or
 * undefined to keep the regular content. Used only by the OpenAI bot: the other integrations keep the raw content.
 */
export const describeOpenaiMessage = (msg: any): string | undefined => {
  const message = msg?.message;
  if (!message || typeof message !== 'object') return undefined;

  let text: string | undefined;

  if (message.stickerMessage) {
    text = MEDIA_TEXT.sticker;
  } else if (message.locationMessage || message.liveLocationMessage) {
    const location = message.locationMessage || message.liveLocationMessage;
    const lat = formatCoordinate(location.degreesLatitude);
    const long = formatCoordinate(location.degreesLongitude);
    const details = [location.name, location.address]
      .filter(isNonEmptyString)
      .map((part: string) => part.trim().replace(/\s+/g, ' '))
      .filter((part, index, parts) => parts.indexOf(part) === index);
    const coordinates = lat !== undefined && long !== undefined ? `${lat}, ${long}` : 'sem coordenadas';
    text = `[localização: ${coordinates}${details.length ? ` - ${details.join(' - ')}` : ''}]`;
  } else if (message.contactMessage) {
    text = `[contato compartilhado: ${contactName(message.contactMessage) ?? 'sem nome'}]`;
  } else if (message.contactsArrayMessage) {
    const names = (message.contactsArrayMessage.contacts || []).map(contactName).filter(Boolean);
    text = names.length
      ? `[contatos compartilhados: ${names.join(', ')}]`
      : `[contato compartilhado: ${message.contactsArrayMessage.displayName || 'sem nome'}]`;
  } else {
    const video =
      message.videoMessage || message.ptvMessage || message.viewOnceMessageV2?.message?.videoMessage || undefined;
    if (video) text = withCaption(MEDIA_TEXT.video, video.caption);
  }

  if (text === undefined) return undefined;

  const adBody = msg?.contextInfo?.externalAdReply?.body;
  return adBody ? `${text}\nexternalAdReplyBody|${adBody}` : text;
};

// ---------------------------------------------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------------------------------------------
export type DocumentInfo = {
  fileName?: string;
  mimetype?: string;
  caption?: string;
  /** Size declared by the channel (Baileys fileLength), before downloading. */
  sizeBytes?: number;
  isPdf: boolean;
  /** Short type for the text the model receives: PDF, DOCX, XLSX... */
  typeLabel: string;
};

const MIME_LABELS: Record<string, string> = {
  'application/pdf': 'PDF',
  'application/msword': 'DOC',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
  'application/vnd.ms-excel': 'XLS',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX',
  'application/vnd.ms-powerpoint': 'PPT',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PPTX',
  'application/vnd.oasis.opendocument.text': 'ODT',
  'application/vnd.oasis.opendocument.spreadsheet': 'ODS',
  'application/zip': 'ZIP',
  'application/x-rar-compressed': 'RAR',
  'text/plain': 'TXT',
  'text/csv': 'CSV',
};

export const normalizeMimetype = (mimetype: unknown): string | undefined => {
  if (typeof mimetype !== 'string') return undefined;
  const normalized = mimetype.split(';')[0].trim().toLowerCase();
  return normalized || undefined;
};

/** The documentMessage of a message (Baileys documentMessage / documentWithCaptionMessage, Cloud API document). */
export const getDocumentMessage = (msg: any): any =>
  msg?.message?.documentMessage ?? msg?.message?.documentWithCaptionMessage?.message?.documentMessage;

/** File name, type and declared size of a document message (Baileys and Cloud API field names). */
export const getDocumentInfo = (msg: any, fallbackCaption?: string): DocumentInfo => {
  const document = getDocumentMessage(msg) ?? {};
  const fileName = [document.fileName, document.filename, document.title]
    .find(isNonEmptyString)
    ?.trim()
    .replace(/[\r\n|[\]]+/g, ' ');
  const mimetype = normalizeMimetype(document.mimetype ?? document.mime_type);
  const extension = fileName && /\.([a-z0-9]{1,8})$/i.exec(fileName)?.[1]?.toUpperCase();
  const isPdf = mimetype === 'application/pdf' || (!mimetype && extension === 'PDF');
  const typeLabel =
    (mimetype && MIME_LABELS[mimetype]) || extension || (mimetype ? mimetype.split('/').pop().toUpperCase() : '');
  const caption = [document.caption, fallbackCaption].find(isNonEmptyString)?.trim();

  return { fileName, mimetype, caption, sizeBytes: toNumber(document.fileLength), isPdf, typeLabel };
};

/** "[o contato enviou o documento <nome> (<tipo>)]" + caption, for documents the model does not read. */
export const describeDocument = (info: DocumentInfo, details?: string) => {
  const type = [info.typeLabel, details].filter(Boolean).join(', ');
  const suffix = type ? ` (${type})` : '';
  const text = info.fileName
    ? `[o contato enviou o documento ${info.fileName}${suffix}]`
    : `[o contato enviou um documento${suffix}]`;
  return withCaption(text, info.caption);
};

/** Text kept in the history / logs in place of a document sent to the model. */
export const documentHistoryPlaceholder = (fileName?: string) =>
  fileName ? `[documento: ${fileName}]` : '[documento]';

const MAX_INFLATED_BYTES = 8 * 1024 * 1024;

/**
 * Number of pages of a PDF without a PDF library: the /Count of the page tree root or, without it, the number
 * of page objects (also inside compressed object streams). Null when it cannot be told. Only counts: the content
 * of the document is never read or logged.
 */
export const countPdfPages = (pdf: Buffer): number | null => {
  if (!Buffer.isBuffer(pdf) || pdf.length < 8 || pdf.subarray(0, 1024).indexOf('%PDF-') < 0) return null;

  const sources = [pdf.toString('latin1')];

  // PDF 1.5+ may keep the page objects inside compressed object streams
  const raw = sources[0];
  let inflated = 0;
  let cursor = 0;
  while (inflated < MAX_INFLATED_BYTES) {
    const streamAt = raw.indexOf('stream', cursor);
    if (streamAt < 0) break;
    cursor = streamAt + 6;
    if (raw.startsWith('end', streamAt - 3)) continue;

    const header = raw.slice(Math.max(0, raw.lastIndexOf('obj', streamAt)), streamAt);
    if (!/\/Type\s*\/ObjStm/.test(header) || !/\/FlateDecode/.test(header)) continue;

    let start = streamAt + 6;
    if (raw[start] === '\r') start++;
    if (raw[start] === '\n') start++;
    const end = raw.indexOf('endstream', start);
    if (end < 0) break;
    cursor = end + 9;

    try {
      const data = inflateSync(pdf.subarray(start, end), {
        finishFlush: 2, // Z_SYNC_FLUSH: tolerate the end-of-line before "endstream"
        maxOutputLength: MAX_INFLATED_BYTES - inflated,
      });
      inflated += data.length;
      sources.push(data.toString('latin1'));
    } catch {
      // damaged or unusual stream: ignore it
    }
  }

  let rootCount = 0;
  let pageObjects = 0;

  for (const text of sources) {
    for (const match of text.matchAll(/\/Type\s*\/Pages(?![A-Za-z])/g)) {
      const dictStart = text.lastIndexOf('<<', match.index);
      const dictEnd = text.indexOf('>>', match.index);
      const dict = text.slice(dictStart < 0 ? match.index : dictStart, dictEnd < 0 ? undefined : dictEnd);
      const count = Number(/\/Count\s+(\d+)/.exec(dict)?.[1]);
      if (Number.isFinite(count) && count > rootCount) rootCount = count;
    }
    pageObjects += (text.match(/\/Type\s*\/Page(?![A-Za-z])/g) || []).length;
  }

  if (rootCount > 0) return rootCount;
  return pageObjects > 0 ? pageObjects : null;
};
