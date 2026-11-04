/**
 * In-process count of incoming messages that could not be stored or read from the database (#2714: Neon
 * unreachable, P1001/P2024...). Shown by the observability "Sistema" card, so a database outage that silently
 * drops messages becomes visible. Only counters, codes and timestamps: never message content or numbers.
 * Resets on restart (one replica on Render).
 */
export type MessageStoreFailures = {
  count: number;
  lastAt: string | null;
  lastCode: string | null;
};

const state: MessageStoreFailures = { count: 0, lastAt: null, lastCode: null };

/** Prisma error code (P1001, P2024...) or the error name, for logs and the counter. */
export const databaseErrorCode = (error: any): string => {
  const code = error?.code ?? error?.errorCode;
  if (typeof code === 'string' && code) return code;
  return error?.name && error.name !== 'Error' ? String(error.name) : 'unknown';
};

export const recordMessageStoreFailure = (error: any, now = Date.now()) => {
  state.count++;
  state.lastAt = new Date(now).toISOString();
  state.lastCode = databaseErrorCode(error);
};

export const getMessageStoreFailures = (): MessageStoreFailures => ({ ...state });

/** Tests only. */
export const resetMessageStoreFailures = () => {
  state.count = 0;
  state.lastAt = null;
  state.lastCode = null;
};
