import { createHash, timingSafeEqual } from 'crypto';
import { Request } from 'express';

import { McpAuth, McpDeps } from './mcp.types';

/** Shortest MCP_PATH_TOKEN accepted: anything shorter leaves the URL mode off. */
export const MIN_PATH_TOKEN_LENGTH = 32;

const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest();

/**
 * Constant-time comparison of two secrets. Both sides are hashed first, so neither the content nor the length of
 * the expected value leaks through timing. Empty values never match.
 */
export function safeEqual(received: unknown, expected: unknown): boolean {
  if (typeof received !== 'string' || typeof expected !== 'string') return false;
  if (!received.length || !expected.length) return false;

  return timingSafeEqual(digest(received), digest(expected));
}

/** `Authorization: Bearer <key>` or `apikey: <key>` (the header the rest of the API already uses). */
export function extractKey(req: Pick<Request, 'headers'>): string | null {
  const authorization = req.headers?.authorization;
  if (typeof authorization === 'string') {
    const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
    if (match && match[1].trim()) return match[1].trim();
  }

  const apikey = req.headers?.apikey;
  const value = Array.isArray(apikey) ? apikey[0] : apikey;

  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function pathTokenEnabled(pathToken: string | undefined): boolean {
  return typeof pathToken === 'string' && pathToken.length >= MIN_PATH_TOKEN_LENGTH;
}

/**
 * Same semantics as the REST guard (auth.guard.ts): the global key opens every instance, the token of an
 * instance (Instance.token) opens only that instance. The instance tokens are compared one by one in constant time
 * (one small query, only when the key is not the global one), never through a `WHERE token = ...` lookup.
 */
export async function authenticateKey(key: string | null, deps: McpDeps): Promise<McpAuth | null> {
  if (!key) return null;

  if (safeEqual(key, deps.config.apiKey)) return { scope: 'global', via: 'header' };

  const instances: { id: string; name: string; token: string | null }[] = await deps.prisma.instance.findMany({
    where: { token: { not: null } },
    select: { id: true, name: true, token: true },
  });

  let match: McpAuth | null = null;
  for (const instance of instances ?? []) {
    // No early exit: every token is compared
    if (safeEqual(key, instance.token) && !match) {
      match = { scope: 'instance', via: 'header', instanceName: instance.name, instanceId: instance.id };
    }
  }

  return match;
}

export function authenticatePathToken(token: string | undefined, deps: McpDeps): McpAuth | null {
  if (!pathTokenEnabled(deps.config.pathToken)) return null;

  return safeEqual(token, deps.config.pathToken) ? { scope: 'global', via: 'path' } : null;
}

/**
 * Client address for the failed-auth limit. Render puts the real client in X-Forwarded-For (appended by its proxy,
 * so the last entry is the one it saw); without the header, the socket address.
 */
export function clientIp(req: Pick<Request, 'headers' | 'socket'>): string {
  const forwarded = req.headers?.['x-forwarded-for'];
  const value = Array.isArray(forwarded) ? forwarded.join(',') : forwarded;

  if (typeof value === 'string' && value.trim()) {
    const parts = value
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }

  return req.socket?.remoteAddress || 'unknown';
}

/**
 * In-memory limit of failed authentications per IP (fixed window). No timer: expired entries are dropped when the
 * map is touched, and the map has a hard size cap, so memory stays bounded even under a flood of addresses.
 */
export class FailedAuthLimiter {
  private readonly entries = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly maxFailures = 10,
    private readonly windowMs = 15 * 60 * 1000,
    private readonly maxEntries = 5000,
    private readonly now: () => number = Date.now,
  ) {}

  /** Seconds until the IP may try again, or 0 when it is not blocked. */
  public blockedFor(ip: string): number {
    const entry = this.entries.get(ip);
    if (!entry) return 0;

    const now = this.now();
    if (entry.resetAt <= now) {
      this.entries.delete(ip);
      return 0;
    }

    return entry.count >= this.maxFailures ? Math.ceil((entry.resetAt - now) / 1000) : 0;
  }

  public fail(ip: string): void {
    const now = this.now();
    const entry = this.entries.get(ip);

    if (entry && entry.resetAt > now) {
      entry.count++;
      return;
    }

    this.prune(now);
    this.entries.set(ip, { count: 1, resetAt: now + this.windowMs });
  }

  public get size(): number {
    return this.entries.size;
  }

  private prune(now: number): void {
    if (this.entries.size < this.maxEntries) return;

    for (const [ip, entry] of this.entries) {
      if (entry.resetAt <= now) this.entries.delete(ip);
    }

    // Still full (a flood of distinct addresses): drop the oldest entries (Map keeps insertion order)
    for (const ip of this.entries.keys()) {
      if (this.entries.size < this.maxEntries) break;
      this.entries.delete(ip);
    }
  }
}
