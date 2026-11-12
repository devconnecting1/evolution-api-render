import '../helpers/setup';

import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';

import { createFakeRedis, createRedisCacheService, FakeRedis } from '../helpers/fake-redis';

/**
 * RedisCache.keys/deleteAll with a client whose scanIterator yields batches (redis 6): every batch must be
 * flattened before the keys are returned or deleted.
 */
describe('RedisCache: SCAN batches in keys() and deleteAll()', () => {
  const KEY_PREFIX = 'evolution:instance:';
  let redis: FakeRedis;
  let cache: ReturnType<typeof createRedisCacheService>;

  beforeEach(() => {
    redis = createFakeRedis();
    cache = createRedisCacheService(redis);
  });

  async function seed(count: number, prefix = '') {
    for (let i = 0; i < count; i++) await cache.hSet(`${prefix}${i}`, 'field', i);
  }

  test('keys() returns the keys of every batch, without duplicates', async () => {
    await seed(150);

    const keys = await cache.keys();

    const expected = Array.from({ length: 150 }, (_, i) => `${KEY_PREFIX}${i}`).sort();
    assert.deepEqual(keys.sort(), expected);
    assert.deepEqual(redis.scanBatches, [100, 50], 'two batches: COUNT 100, then the remaining 50');
  });

  test('deleteAll() deletes the keys of every batch and returns the total', async () => {
    await seed(150);

    const deleted = await cache.deleteAll();

    assert.equal(deleted, 150);
    assert.equal(redis.hashes.size, 0);
    assert.deepEqual(redis.scanBatches, [100, 50]);
  });

  test('the criteria filter keeps the other keys out of both batches', async () => {
    await seed(120, 'law-office:');
    await seed(30, 'other:');

    const keys = await cache.keys('law-office');

    assert.equal(keys.length, 120);
    assert.ok(keys.every((key) => key.startsWith(`${KEY_PREFIX}law-office:`)));
    assert.deepEqual(redis.scanBatches, [100, 20]);

    assert.equal(await cache.deleteAll('law-office'), 120);
    assert.equal(redis.hashes.size, 30);
    assert.ok([...redis.hashes.keys()].every((key) => key.startsWith(`${KEY_PREFIX}other:`)));
  });
});
