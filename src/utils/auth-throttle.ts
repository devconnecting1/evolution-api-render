/**
 * Limit on wrong API keys per client IP: after MAX_FAILURES wrong keys in WINDOW_MS, that IP gets 429 for BLOCK_MS
 * for everything except the global key (checked in memory, constant time). Besides slowing down guessing, it keeps
 * scanners from waking the database: every wrong instance key is a lookup in Postgres (Neon free plan, CU-hours).
 *
 * The client IP only counts when it comes from a header the edge in front of the API sets (see clientIp). Without
 * it the throttle does nothing: blocking by the proxy's own address would lock out every legitimate client at once.
 */
export const MAX_FAILURES = 40;
export const WINDOW_MS = 10 * 60_000;
export const BLOCK_MS = 15 * 60_000;
const MAX_TRACKED = 10_000;

type Entry = { failures: number[]; blockedUntil: number };

const IP_RE = /^[0-9a-fA-F:.]{3,45}$/;
const DEFAULT_TRUSTED = 'cf-connecting-ip,true-client-ip';

/**
 * Client IP from the header the edge in front of the API sets and the client cannot forge.
 * TRUSTED_CLIENT_IP_HEADER (Render env) picks it: comma-separated header names, tried in order; for a list header
 * such as X-Forwarded-For, ":first" or ":last" chooses the entry (e.g. "x-forwarded-for:last"). Default: Cloudflare's
 * CF-Connecting-IP / True-Client-IP. GET /admin/client-ip (global key) shows what actually arrives.
 */
export function clientIp(
  headers: Record<string, string | string[] | undefined> | undefined,
  trusted: string = process.env.TRUSTED_CLIENT_IP_HEADER || DEFAULT_TRUSTED,
): string | null {
  if (!headers) return null;
  for (const spec of trusted.split(',')) {
    const [rawName, pick] = spec.trim().toLowerCase().split(':');
    if (!rawName) continue;
    const raw = headers[rawName];
    const joined = Array.isArray(raw) ? raw.join(',') : raw;
    if (!joined) continue;
    const parts = joined
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
    const value = pick === 'last' ? parts[parts.length - 1] : parts[0];
    if (value && IP_RE.test(value)) return value;
  }
  return null;
}

/** Headers that may carry the client IP, for the admin diagnostic. */
export const IP_HEADERS = [
  'cf-connecting-ip',
  'true-client-ip',
  'x-forwarded-for',
  'x-real-ip',
  'forwarded',
  'x-envoy-external-address',
  'rndr-id',
];

export class AuthThrottle {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly now: () => number = Date.now) {}

  isBlocked(ip: string | null): boolean {
    if (!ip) return false;
    const entry = this.entries.get(ip);
    return !!entry && entry.blockedUntil > this.now();
  }

  /** Seconds until the block ends (for Retry-After). */
  retryAfter(ip: string | null): number {
    const entry = ip ? this.entries.get(ip) : undefined;
    return entry ? Math.max(1, Math.ceil((entry.blockedUntil - this.now()) / 1000)) : 0;
  }

  recordFailure(ip: string | null): void {
    if (!ip) return;
    const now = this.now();
    let entry = this.entries.get(ip);
    if (!entry) {
      if (this.entries.size >= MAX_TRACKED) this.prune(now);
      if (this.entries.size >= MAX_TRACKED) return;
      entry = { failures: [], blockedUntil: 0 };
      this.entries.set(ip, entry);
    }
    entry.failures = entry.failures.filter((t) => now - t < WINDOW_MS);
    entry.failures.push(now);
    if (entry.failures.length >= MAX_FAILURES) {
      entry.blockedUntil = now + BLOCK_MS;
      entry.failures = [];
    }
  }

  private prune(now: number): void {
    for (const [ip, entry] of this.entries) {
      if (entry.blockedUntil <= now && entry.failures.every((t) => now - t >= WINDOW_MS)) this.entries.delete(ip);
    }
  }
}

export const authThrottle = new AuthThrottle();
