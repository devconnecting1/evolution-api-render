import { normalizeMessageContent, proto } from 'baileys';

/**
 * Real content of a received message (#2773): unwraps `ephemeralMessage` (disappearing messages),
 * `viewOnceMessage*`, `documentWithCaptionMessage` and `editedMessage` with Baileys' own helper, so text,
 * audio transcription, media and the chatbots see e.g. `extendedTextMessage`/`audioMessage` instead of the
 * wrapper. `downloadMediaMessage` keeps working: it normalizes the content the same way.
 *
 * The top level `messageContextInfo` (e.g. the `messageSecret` of a poll) is kept when the inner message has none.
 */
export function unwrapMessageContent<T extends proto.IMessage | null | undefined>(message: T): T {
  if (!message) return message;

  const normalized = normalizeMessageContent(message);

  if (!normalized || normalized === message) return message;

  if (message.messageContextInfo && !normalized.messageContextInfo) {
    return { ...normalized, messageContextInfo: message.messageContextInfo } as T;
  }

  return normalized as T;
}
