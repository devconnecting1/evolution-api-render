/**
 * In-memory stand-in for the node-redis client methods RedisCache uses, and a real CacheService + RedisCache on top
 * of it: the values go through exactly the same (double) JSON encoding as in production. No network.
 */
import { CacheService } from '@api/services/cache.service';
import { RedisCache } from '@cache/rediscache';

export type FakeRedis = ReturnType<typeof createFakeRedis>;

export function createFakeRedis() {
  const hashes = new Map<string, Map<string, string>>();
  /** `down: true` makes every command fail, like a Redis that is restarting. */
  const state = { down: false };
  const guard = () => {
    if (state.down) throw new Error('redis down');
  };
  return {
    hashes,
    state,
    hGet: async (key: string, field: string) => (guard(), hashes.get(key)?.get(field) ?? null),
    hSet: async (key: string, field: string, value: string) => {
      guard();
      if (!hashes.has(key)) hashes.set(key, new Map());
      hashes.get(key).set(field, value);
      return 1;
    },
    hDel: async (key: string, field: string) => (guard(), hashes.get(key)?.delete(field) ? 1 : 0),
    hGetAll: async (key: string) => (guard(), Object.fromEntries(hashes.get(key) ?? new Map())),
    del: async (key: string) => (guard(), hashes.delete(key) ? 1 : 0),
    exists: async (key: string) => (guard(), hashes.has(key) ? 1 : 0),
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
