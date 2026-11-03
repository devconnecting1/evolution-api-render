import { CacheStore } from 'baileys';
import NodeCache from 'node-cache';

/**
 * Palliative for GHSA-qvv5-jq5g-4cgg / CVE-2026-48063 until Baileys is upgraded (>= rc12).
 *
 * Baileys < rc12 turns any "placeholder resend" response it receives into a `messages.upsert` (with `requestId`)
 * whose key and content come from the response bytes, so a contact can forge a message with any key: a forged
 * `fromMe` pauses the bot (human takeover) and a forged contact message makes the AI answer.
 *
 * The same path is legitimate: when a message cannot be decrypted, Baileys asks the phone to resend it and the
 * answer arrives as an upsert with `requestId`. This tracker is the `placeholderResendCache` handed to the
 * socket: Baileys writes there the id of every message it asks the phone to resend, and the tracker remembers
 * those ids for a while, even after Baileys clears its own entry (15 s after the request). An upsert with
 * `requestId` is only accepted for an id that was really requested.
 */
export class PlaceholderResendTracker {
  /** Store given to Baileys (`placeholderResendCache` of the socket config). */
  readonly cache: CacheStore;

  private readonly requested = new Map<string, number>();

  constructor(
    private readonly ttlMs = 10 * 60 * 1000,
    private readonly maxEntries = 1000,
  ) {
    // Same defaults Baileys uses when no cache is given (1 h, no clones)
    const inner = new NodeCache({ stdTTL: 60 * 60, useClones: false });

    this.cache = {
      get: <T>(key: string) => inner.get<T>(key),
      set: <T>(key: string, value: T) => {
        this.remember(key);
        return inner.set(key, value);
      },
      del: (key: string) => inner.del(key),
      flushAll: () => inner.flushAll(),
    };
  }

  private remember(id: string) {
    if (!id) return;

    const now = Date.now();
    this.requested.delete(id);
    this.requested.set(id, now + this.ttlMs);

    for (const [key, expiresAt] of this.requested) {
      if (expiresAt <= now || this.requested.size > this.maxEntries) this.requested.delete(key);
      else break;
    }
  }

  /** Whether a resend of this message id was requested (consumes it: one answer per request). */
  consume(id: string | null | undefined): boolean {
    if (!id) return false;

    const expiresAt = this.requested.get(id);
    if (!expiresAt) return false;

    this.requested.delete(id);
    return expiresAt > Date.now();
  }
}
