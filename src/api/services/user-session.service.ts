/**
 * "Equipe" (proposta V, etapa 1): the person who entered with Google and their sessions.
 *
 * - One User per allowed e-mail (global table, control database). UserSession stores only the SHA-256 of the token,
 *   with an expiry and a revokedAt; the token itself is shown once, in the answer of the exchange.
 * - resolve() is called on every authenticated request by the guard: a resolved session is cached in memory for
 *   30 s (no Neon query per request) and lastSeenAt is written at most once every 10 minutes per session.
 * - Revoking deletes the cache entry of that token before writing, so the next request of this process is already
 *   refused (no waiting for the cache to expire).
 * - The service never reaches Google; it is tested with a fake Prisma in test/unit/user-session.test.ts and on a
 *   real PostgreSQL in test/integration/user-session.test.ts.
 */
import { generateSessionToken, hashSessionToken, isSessionToken, PublicSession } from '@utils/google-login';

export type SessionUser = {
  userId: string;
  sessionId: string;
  email: string;
  name: string | null;
  picture: string | null;
};

export type SessionRow = PublicSession & {
  userId: string;
  email: string;
  name: string | null;
  picture: string | null;
};

type Deps = {
  prisma: any;
  now?: () => number;
  /** How long a resolved session is trusted before the database is read again (default 30 s). */
  cacheTtlMs?: number;
  /** Session lifetime (default 30 days). */
  sessionTtlMs?: number;
  /** lastSeenAt is written at most once per this interval per session (default 10 min). */
  touchIntervalMs?: number;
  log?: (message: string) => void;
};

const CACHE_TTL_MS = 30_000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60_000;
const TOUCH_INTERVAL_MS = 10 * 60_000;
const USER_SELECT = { id: true, email: true, name: true, picture: true };

function iso(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(+date) ? null : date.toISOString();
}

export class UserSessionService {
  private readonly cache = new Map<string, { at: number; user: SessionUser | null }>();
  private readonly touched = new Map<string, number>();

  constructor(private readonly deps: Deps) {}

  private now() {
    return (this.deps.now ?? Date.now)();
  }

  private ttl() {
    return this.deps.sessionTtlMs ?? SESSION_TTL_MS;
  }

  /** The person behind a "was_" token, or null (unknown, expired or revoked). */
  public async resolve(token: string): Promise<SessionUser | null> {
    if (!isSessionToken(token)) return null;
    const hash = hashSessionToken(token);
    const ttl = this.deps.cacheTtlMs ?? CACHE_TTL_MS;
    const hit = this.cache.get(hash);
    if (hit && this.now() - hit.at < ttl) return hit.user;

    const row = await this.deps.prisma.userSession.findUnique({
      where: { tokenHash: hash },
      include: { User: { select: USER_SELECT } },
    });
    const valid =
      row && !row.revokedAt && row.expiresAt && +new Date(row.expiresAt) > this.now() && row.User ? row.User : null;
    const user: SessionUser | null = valid
      ? {
          userId: valid.id,
          sessionId: row.id,
          email: valid.email,
          name: valid.name ?? null,
          picture: valid.picture ?? null,
        }
      : null;
    if (this.cache.size > 500) this.cache.clear();
    this.cache.set(hash, { at: this.now(), user });
    if (user) this.touch(hash, row.id);
    return user;
  }

  private touch(hash: string, id: string) {
    const interval = this.deps.touchIntervalMs ?? TOUCH_INTERVAL_MS;
    const last = this.touched.get(hash) ?? 0;
    if (this.now() - last < interval) return;
    this.touched.set(hash, this.now());
    Promise.resolve(
      this.deps.prisma.userSession.update({ where: { id }, data: { lastSeenAt: new Date(this.now()) } }),
    ).catch((error: any) => this.deps.log?.(`user session lastSeenAt: ${error?.message ?? error}`));
  }

  /** Finds the person by e-mail (created on the first login) and records the login. */
  public async findOrCreateUser(claims: { email: string; name?: string | null; picture?: string | null }): Promise<{
    id: string;
    email: string;
    name: string | null;
    picture: string | null;
    lastLoginAt: string | null;
  }> {
    const now = new Date(this.now());
    const email = String(claims.email).trim().toLowerCase();
    const row = await this.deps.prisma.user.upsert({
      where: { email },
      create: { email, name: claims.name ?? null, picture: claims.picture ?? null, lastLoginAt: now },
      update: {
        lastLoginAt: now,
        ...(claims.name ? { name: claims.name } : {}),
        ...(claims.picture ? { picture: claims.picture } : {}),
      },
    });
    return {
      id: row.id,
      email: row.email,
      name: row.name ?? null,
      picture: row.picture ?? null,
      lastLoginAt: iso(row.lastLoginAt),
    };
  }

  public async createSession(
    userId: string,
    meta: { userAgent?: string | null; ip?: string | null } = {},
  ): Promise<{ token: string; session: PublicSession }> {
    const { token, hash } = generateSessionToken();
    const now = this.now();
    const row = await this.deps.prisma.userSession.create({
      data: {
        userId,
        tokenHash: hash,
        userAgent: meta.userAgent ? String(meta.userAgent).slice(0, 255) : null,
        ip: meta.ip ? String(meta.ip).slice(0, 64) : null,
        lastSeenAt: new Date(now),
        expiresAt: new Date(now + this.ttl()),
      },
    });
    this.touched.set(hash, now);
    const user = await this.deps.prisma.user
      .findUnique({ where: { id: userId }, select: USER_SELECT })
      .catch(() => null);
    if (user) {
      this.cache.set(hash, {
        at: now,
        user: { userId, sessionId: row.id, email: user.email, name: user.name ?? null, picture: user.picture ?? null },
      });
    }
    return { token, session: this.publicSession(row) };
  }

  /** Revokes a session. With `userId`, only a session of that person can be revoked. */
  public async revokeSession(id: string, userId?: string): Promise<boolean> {
    if (!id || typeof id !== 'string' || id.length > 100) return false;
    const row = await this.deps.prisma.userSession.findUnique({ where: { id } });
    if (!row || (userId && row.userId !== userId)) return false;
    this.cache.delete(row.tokenHash);
    if (row.revokedAt) return true;
    await this.deps.prisma.userSession.update({ where: { id }, data: { revokedAt: new Date(this.now()) } });
    return true;
  }

  /** Active sessions of one person, newest first, with the current one marked. */
  public async listSessions(userId: string, currentSessionId?: string): Promise<SessionRow[]> {
    const rows = await this.deps.prisma.userSession.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date(this.now()) } },
      include: { User: { select: USER_SELECT } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return (rows || []).map((row: any) => this.row(row, currentSessionId));
  }

  /** Active sessions of everyone (administrator view), newest first. */
  public async listAllSessions(currentSessionId?: string): Promise<SessionRow[]> {
    const rows = await this.deps.prisma.userSession.findMany({
      where: { revokedAt: null, expiresAt: { gt: new Date(this.now()) } },
      include: { User: { select: USER_SELECT } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return (rows || []).map((row: any) => this.row(row, currentSessionId));
  }

  /**
   * "Equipe" overview (administrator): every e-mail of the allowlist with the person and their active sessions,
   * plus all active sessions. An e-mail that never logged in appears with `loggedIn: false` (no invites in V1).
   */
  public async overview(allowlist: string[]) {
    const emails = [...new Set(allowlist.map((email) => String(email).toLowerCase()))];
    const users = emails.length
      ? await this.deps.prisma.user.findMany({ where: { email: { in: emails } }, take: 200 })
      : [];
    const sessions = await this.listAllSessions();
    const people = emails.map((email) => {
      const user = (users || []).find((row: any) => row.email === email);
      const mine = sessions.filter((session) => session.email === email);
      const lastSeenAt = mine
        .map((session) => session.lastSeenAt)
        .filter(Boolean)
        .sort()
        .pop();
      return {
        email,
        loggedIn: !!user,
        name: user?.name ?? null,
        picture: user?.picture ?? null,
        lastLoginAt: iso(user?.lastLoginAt),
        lastSeenAt: lastSeenAt ?? null,
        activeSessions: mine.length,
      };
    });
    return { people, sessions };
  }

  private publicSession(row: any): PublicSession {
    return {
      id: row.id,
      createdAt: iso(row.createdAt),
      lastSeenAt: iso(row.lastSeenAt),
      expiresAt: iso(row.expiresAt),
      userAgent: row.userAgent ?? null,
      revokedAt: iso(row.revokedAt),
      current: false,
    };
  }

  private row(row: any, currentSessionId?: string): SessionRow {
    return {
      ...this.publicSession(row),
      current: !!currentSessionId && row.id === currentSessionId,
      userId: row.userId,
      email: row.User?.email ?? '',
      name: row.User?.name ?? null,
      picture: row.User?.picture ?? null,
    };
  }
}
