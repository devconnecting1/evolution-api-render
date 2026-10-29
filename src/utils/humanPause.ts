/**
 * Helpers for the "human takeover" pause of chatbot sessions.
 *
 * When the owner of the WhatsApp number (a human) writes to a contact, the bot session of that chat is
 * paused (`IntegrationSession.status = 'paused'`) and the time of the last human message is stored in
 * `IntegrationSession.parameters.humanLastMessageAt` (ISO string). Other keys in `parameters` are preserved.
 *
 * Invariant: `humanLastMessageAt` is present only while the session is paused by a human. Every path that
 * reopens a session on purpose (automatic resume, changeStatus) removes it, so a session that is `opened`
 * but still carries it was reopened by a race (e.g. a slow bot reply finishing after the human wrote) and is
 * still treated as paused.
 */
export const HUMAN_LAST_MESSAGE_AT = 'humanLastMessageAt';

type SessionLike = { status?: string; parameters?: unknown } | null | undefined;

const asObject = (parameters: unknown): Record<string, any> =>
  parameters && typeof parameters === 'object' && !Array.isArray(parameters)
    ? { ...(parameters as Record<string, any>) }
    : {};

export const getHumanLastMessageAt = (session: SessionLike): number | null => {
  const value = asObject(session?.parameters)[HUMAN_LAST_MESSAGE_AT];
  if (!value) return null;

  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
};

/** Returns a copy of `parameters` (which may be null) with `humanLastMessageAt` set. */
export const withHumanLastMessageAt = (parameters: unknown, date: Date): Record<string, any> => ({
  ...asObject(parameters),
  [HUMAN_LAST_MESSAGE_AT]: date.toISOString(),
});

/** Returns a copy of `parameters` (which may be null) without `humanLastMessageAt`. */
export const withoutHumanLastMessageAt = (parameters: unknown): Record<string, any> => {
  const result = asObject(parameters);
  delete result[HUMAN_LAST_MESSAGE_AT];
  return result;
};

/** Bot value, then settings value, then 0 (never resume automatically). */
export const resolveHumanResumeMinutes = (bot: any, settings: any): number => {
  const value = Number(bot?.humanResumeMinutes ?? settings?.humanResumeMinutes ?? 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
};

export const isHumanPaused = (session: SessionLike): boolean =>
  session?.status === 'paused' || (session?.status === 'opened' && getHumanLastMessageAt(session) !== null);

/**
 * True when a human pause can be lifted automatically: `minutes` > 0 and at least `minutes` have passed since
 * the last human message. A paused session without `humanLastMessageAt` (legacy, or paused through
 * changeStatus) is never resumed automatically.
 */
export const isHumanPauseExpired = (session: SessionLike, minutes: number, now = Date.now()): boolean => {
  if (!minutes || minutes <= 0) return false;

  const last = getHumanLastMessageAt(session);
  if (last === null) return false;

  return now - last >= minutes * 60 * 1000;
};

/** True when `current` records a human message newer than the one known in `snapshot`. */
export const hasHumanWrittenSince = (snapshot: SessionLike, current: SessionLike): boolean => {
  const currentAt = getHumanLastMessageAt(current);
  if (currentAt === null) return false;

  const snapshotAt = getHumanLastMessageAt(snapshot);
  return snapshotAt === null || currentAt > snapshotAt;
};
