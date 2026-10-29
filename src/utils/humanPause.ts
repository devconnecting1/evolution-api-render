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
/** Set by changeStatus 'paused': a manual pause is only lifted manually, never by humanResumeMinutes. */
export const MANUAL_PAUSE = 'manualPause';

type SessionLike = { status?: string; parameters?: unknown; updatedAt?: Date | string } | null | undefined;

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

/** Returns a copy of `parameters` (which may be null) without `humanLastMessageAt` (and the manual pause flag). */
export const withoutHumanLastMessageAt = (parameters: unknown): Record<string, any> => {
  const result = asObject(parameters);
  delete result[HUMAN_LAST_MESSAGE_AT];
  delete result[MANUAL_PAUSE];
  return result;
};

/** Returns a copy of `parameters` (which may be null) marking a manual pause, without `humanLastMessageAt`. */
export const withManualPause = (parameters: unknown): Record<string, any> => ({
  ...withoutHumanLastMessageAt(parameters),
  [MANUAL_PAUSE]: true,
});

export const isManualPause = (session: SessionLike): boolean => asObject(session?.parameters)[MANUAL_PAUSE] === true;

/** Bot value, then settings value, then 0 (never resume automatically). */
export const resolveHumanResumeMinutes = (bot: any, settings: any): number => {
  const value = Number(bot?.humanResumeMinutes ?? settings?.humanResumeMinutes ?? 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
};

export const isHumanPaused = (session: SessionLike): boolean =>
  session?.status === 'paused' || (session?.status === 'opened' && getHumanLastMessageAt(session) !== null);

/**
 * True when a human pause can be lifted automatically: `minutes` > 0 and at least `minutes` have passed since
 * the last human message. A manual pause (changeStatus 'paused') is never lifted automatically. A legacy paused
 * session (paused by a human before `humanLastMessageAt` existed) uses `updatedAt`, which is when it was paused.
 */
export const isHumanPauseExpired = (session: SessionLike, minutes: number, now = Date.now()): boolean => {
  if (!minutes || minutes <= 0) return false;
  if (isManualPause(session)) return false;

  let last = getHumanLastMessageAt(session);
  if (last === null && session?.status === 'paused' && session?.updatedAt) {
    const updatedAt = new Date(session.updatedAt).getTime();
    last = Number.isFinite(updatedAt) ? updatedAt : null;
  }
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
