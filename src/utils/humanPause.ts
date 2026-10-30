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
 * The moment a human pause counts from: the last human message or, for a legacy paused session (paused by a
 * human before `humanLastMessageAt` existed), `updatedAt`, which is when it was paused. Null when unknown.
 */
const getHumanPauseReference = (session: SessionLike): number | null => {
  const last = getHumanLastMessageAt(session);
  if (last !== null) return last;

  if (session?.status === 'paused' && session?.updatedAt) {
    const updatedAt = new Date(session.updatedAt).getTime();
    return Number.isFinite(updatedAt) ? updatedAt : null;
  }

  return null;
};

/**
 * True when a human pause can be lifted automatically: `minutes` > 0 and at least `minutes` have passed since
 * the last human message. A manual pause (changeStatus 'paused') is never lifted automatically. A legacy paused
 * session (paused by a human before `humanLastMessageAt` existed) uses `updatedAt`, which is when it was paused.
 */
export const isHumanPauseExpired = (session: SessionLike, minutes: number, now = Date.now()): boolean => {
  if (!minutes || minutes <= 0) return false;
  if (isManualPause(session)) return false;

  const last = getHumanPauseReference(session);
  if (last === null) return false;

  return now - last >= minutes * 60 * 1000;
};

export type HumanPauseReason = 'human' | 'manual' | 'legacy';

export type HumanPauseInfo = {
  /** human: paused by a message of the owner; manual: changeStatus 'paused'; legacy: paused before the timestamp existed */
  reason: HumanPauseReason;
  /** ISO. When the pause counts from: the last human message, or `updatedAt` for manual/legacy */
  since: string | null;
  /** ISO of the last message the owner wrote, null when there is none on record */
  lastHumanMessageAt: string | null;
  /** Effective minutes (bot, then settings, then 0 = only manual resume) */
  resumeMinutes: number;
  /** ISO. When the pause expires; null for a manual pause or when `resumeMinutes` is 0 */
  resumesAt: string | null;
  /** Seconds left (>= 0); 0 once expired, the bot then resumes on the next message of the contact. Null as `resumesAt` */
  remainingSeconds: number | null;
  /** True when the pause lifts by itself (an expiry time exists) */
  autoResume: boolean;
};

const toIso = (time: number | null): string | null => (time === null ? null : new Date(time).toISOString());

/**
 * Describes the human pause of a session for API consumers, or null when it is not paused. Follows the same rules
 * as `isHumanPaused` and `isHumanPauseExpired`, so `remainingSeconds` is 0 exactly when the pause is expired.
 */
export const describeHumanPause = (
  session: SessionLike,
  resumeMinutes: number,
  now = Date.now(),
): HumanPauseInfo | null => {
  if (!isHumanPaused(session)) return null;

  const lastHuman = getHumanLastMessageAt(session);
  const manual = isManualPause(session);
  const reason: HumanPauseReason = manual ? 'manual' : lastHuman !== null ? 'human' : 'legacy';

  let since = getHumanPauseReference(session);
  if (reason === 'manual') {
    const updatedAt = session?.updatedAt ? new Date(session.updatedAt).getTime() : NaN;
    since = Number.isFinite(updatedAt) ? updatedAt : null;
  }

  const minutes = Number.isFinite(Number(resumeMinutes)) && Number(resumeMinutes) > 0 ? Number(resumeMinutes) : 0;
  const reference = getHumanPauseReference(session);
  const resumesAtTime = !manual && minutes > 0 && reference !== null ? reference + minutes * 60 * 1000 : null;

  return {
    reason,
    since: toIso(since),
    lastHumanMessageAt: toIso(lastHuman),
    resumeMinutes: minutes,
    resumesAt: toIso(resumesAtTime),
    remainingSeconds: resumesAtTime === null ? null : Math.max(0, Math.ceil((resumesAtTime - now) / 1000)),
    autoResume: resumesAtTime !== null,
  };
};

/** True when `current` records a human message newer than the one known in `snapshot`. */
export const hasHumanWrittenSince = (snapshot: SessionLike, current: SessionLike): boolean => {
  const currentAt = getHumanLastMessageAt(current);
  if (currentAt === null) return false;

  const snapshotAt = getHumanLastMessageAt(snapshot);
  return snapshotAt === null || currentAt > snapshotAt;
};
