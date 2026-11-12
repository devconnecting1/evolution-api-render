/**
 * In-memory stand-in for the node-redis client methods RedisCache uses, and a real CacheService + RedisCache on top
 * of it: the values go through exactly the same (double) JSON encoding as in production. No network.
 */
import { CacheService } from '@api/services/cache.service';
import { RedisCache } from '@cache/rediscache';

export type FakeRedis = ReturnType<typeof createFakeRedis>;

/** Redis glob for the patterns used here (`*` and `?`); everything else is matched literally. */
function matchesPattern(pattern: string, value: string) {
  const regex = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');

  return new RegExp(`^${regex}$`).test(value);
}

export function createFakeRedis() {
  const hashes = new Map<string, Map<string, string>>();
  /** `down: true` makes every command fail, like a Redis that is restarting. */
  const state = { down: false };
  /** Sizes of the batches yielded by each `scanIterator` run, in order. */
  const scanBatches: number[] = [];
  const guard = () => {
    if (state.down) throw new Error('redis down');
  };
  return {
    hashes,
    state,
    scanBatches,
    hGet: async (key: string, field: string) => (guard(), hashes.get(key)?.get(field) ?? null),
    hSet: async (key: string, field: string, value: string) => {
      guard();
      if (!hashes.has(key)) hashes.set(key, new Map());
      hashes.get(key).set(field, value);
      return 1;
    },
    hDel: async (key: string, field: string) => (guard(), hashes.get(key)?.delete(field) ? 1 : 0),
    hGetAll: async (key: string) => (guard(), Object.fromEntries(hashes.get(key) ?? new Map())),
    del: async (key: string | string[]) => {
      guard();
      const keys = Array.isArray(key) ? key : [key];
      let deleted = 0;
      for (const k of keys) if (hashes.delete(k)) deleted++;
      return deleted;
    },
    exists: async (key: string) => (guard(), hashes.has(key) ? 1 : 0),
    /** Like redis 6: each iteration yields a batch of keys from SCAN, not a single key. */
    scanIterator: async function* (options: { MATCH?: string; COUNT?: number } = {}) {
      guard();
      const match = options.MATCH ?? '*';
      const count = options.COUNT && options.COUNT > 0 ? options.COUNT : 10;
      const keys = [...hashes.keys()].filter((key) => matchesPattern(match, key));
      for (let i = 0; i < keys.length; i += count) {
        const batch = keys.slice(i, i + count);
        scanBatches.push(batch.length);
        yield batch;
      }
    },
  };
}

/** CacheService of the `instance` module (keys `evolution:instance:<key>`) backed by the fake client. */
export function createRedisCacheService(redis: FakeRedis, module = 'instance') {
  const engine = Object.create(RedisCache.prototype);
  Object.assign(engine, {
    client: redis,
    conf: { PREFIX_KEY: 'evolution' },
    module,
    logger: { error: () => undefined, verbose: () => undefined },
  });
  return new CacheService(engine);
}
