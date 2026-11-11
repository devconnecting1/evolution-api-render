/**
 * Limit on wrong API keys per client IP: after MAX_FAILURES wrong keys in WINDOW_MS, that IP gets 429 for BLOCK_MS
 * for everything except the global key (checked in memory, constant time). Besides slowing down guessing, it keeps
 * scanners from waking the database: every wrong instance key is a lookup in Postgres (Neon free plan, CU-hours).
 *
 * The client IP only counts when it comes from the edge in front of the API (Cloudflare's CF-Connecting-IP or
 * True-Client-IP, which the client cannot forge through the proxy). Without one of those headers the throttle does
 * nothing: blocking by the proxy's own address would lock out every legitimate client at once.
 */
export const MAX_FAILURES = 40;
export const WINDOW_MS = 10 * 60_000;
export const BLOCK_MS = 15 * 60_000;
const MAX_TRACKED = 10_000;

type Entry = { failures: number[]; blockedUntil: number };

export function clientIp(headers: Record<string, string | string[] | undefined> | undefined): string | null {
  if (!headers) return null;
  for (const name of ['cf-connecting-ip', 'true-client-ip']) {
    const raw = headers[name];
    const value = (Array.isArray(raw) ? raw[0] : raw)?.trim();
    if (value && /^[0-9a-fA-F:.]{3,45}$/.test(value)) return value;
  }
  return null;
}

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
