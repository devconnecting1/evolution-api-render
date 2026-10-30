import '../helpers/setup';

import assert from 'node:assert/strict';
import { afterEach, describe, mock, test } from 'node:test';

import { isBotMessageId, registerBotMessageId } from '@utils/botMessageRegistry';

// CACHE_REDIS_ENABLED / CACHE_LOCAL_ENABLED are off (test/helpers/setup.ts): only the in-memory fallback is used
const TTL_MS = 10 * 60 * 1000;
const MAX_MEMORY_ENTRIES = 10000;

let counter = 0;
const uniqueId = (prefix = 'MSG') => `${prefix}-${process.pid}-${++counter}`;

describe('botMessageRegistry (memory fallback, cache disabled)', () => {
  afterEach(() => mock.restoreAll());

  test('a registered id is recognised for the same instance only', async () => {
    const id = uniqueId('3EB0');
    await registerBotMessageId('inst-a', id);

    assert.equal(await isBotMessageId('inst-a', id), true);
    assert.equal(await isBotMessageId('inst-b', id), false);
    assert.equal(await isBotMessageId('inst-a', uniqueId('3EB0')), false);
  });

  test('empty instance or message id is never registered nor matched', async () => {
    await registerBotMessageId('', 'X');
    await registerBotMessageId('inst-a', '');
    await registerBotMessageId(undefined, undefined);

    assert.equal(await isBotMessageId('', 'X'), false);
    assert.equal(await isBotMessageId('inst-a', ''), false);
    assert.equal(await isBotMessageId(undefined, undefined), false);
  });

  test('entries expire after the 10 minute TTL', async () => {
    const start = Date.now();
    const clock = mock.method(Date, 'now', () => start);
    const id = uniqueId();

    await registerBotMessageId('inst-ttl', id);

    clock.mock.mockImplementation(() => start + TTL_MS - 1);
    assert.equal(await isBotMessageId('inst-ttl', id), true, 'still valid 1 ms before the TTL');

    clock.mock.mockImplementation(() => start + TTL_MS);
    assert.equal(await isBotMessageId('inst-ttl', id), false, 'expired at the TTL');
  });

  test('expired entries are pruned on the next registration', async () => {
    const start = Date.now() + 365 * 24 * 60 * 60 * 1000; // far from the entries of the other tests
    const clock = mock.method(Date, 'now', () => start);
    const old = uniqueId();
    await registerBotMessageId('inst-prune', old);

    clock.mock.mockImplementation(() => start + TTL_MS + 1);
    const fresh = uniqueId();
    await registerBotMessageId('inst-prune', fresh);

    // Going back in time would make a non-pruned entry valid again: it must be gone
    clock.mock.mockImplementation(() => start);
    assert.equal(await isBotMessageId('inst-prune', old), false);
    assert.equal(await isBotMessageId('inst-prune', fresh), true);
  });

  test(`memory is bounded to ${MAX_MEMORY_ENTRIES} entries (oldest dropped first)`, async () => {
    const first = uniqueId('BULK');
    await registerBotMessageId('inst-bulk', first);

    const ids: string[] = [];
    for (let i = 0; i < MAX_MEMORY_ENTRIES + 5; i++) {
      const id = uniqueId('BULK');
      ids.push(id);
      await registerBotMessageId('inst-bulk', id);
    }

    assert.equal(await isBotMessageId('inst-bulk', first), false, 'oldest entry evicted');
    assert.equal(await isBotMessageId('inst-bulk', ids[0]), false, 'second oldest evicted too');
    assert.equal(await isBotMessageId('inst-bulk', ids[ids.length - 1]), true, 'newest kept');
    assert.equal(await isBotMessageId('inst-bulk', ids[ids.length - MAX_MEMORY_ENTRIES]), true, 'window kept');
  });
});
