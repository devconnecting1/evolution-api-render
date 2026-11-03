import '../helpers/setup';

import assert from 'node:assert/strict';
import { afterEach, describe, mock, test } from 'node:test';

import { claimMessageOnce } from '@utils/processedMessageRegistry';

let counter = 0;
const uniqueId = (prefix = 'MSG') => `${prefix}-${process.pid}-${++counter}`;

// CACHE_REDIS_ENABLED / CACHE_LOCAL_ENABLED are off (test/helpers/setup.ts): only the in-memory fallback is used
describe('processedMessageRegistry.claimMessageOnce (#2737)', () => {
  afterEach(() => mock.restoreAll());

  test('the first claim wins, a redelivery loses', async () => {
    const id = uniqueId();
    assert.equal(await claimMessageOnce('inst-a', id), true);
    assert.equal(await claimMessageOnce('inst-a', id), false);
    assert.equal(await claimMessageOnce('inst-a', id), false);
  });

  test('ids are per instance', async () => {
    const id = uniqueId();
    assert.equal(await claimMessageOnce('inst-a', id), true);
    assert.equal(await claimMessageOnce('inst-b', id), true);
  });

  test('concurrent claims of the same id: exactly one wins', async () => {
    const id = uniqueId();
    const results = await Promise.all(Array.from({ length: 5 }, () => claimMessageOnce('inst-a', id)));
    assert.equal(results.filter(Boolean).length, 1);
  });

  test('without instance or id there is nothing to deduplicate', async () => {
    assert.equal(await claimMessageOnce('inst-a', ''), true);
    assert.equal(await claimMessageOnce('inst-a', ''), true);
    assert.equal(await claimMessageOnce(undefined, undefined), true);
  });

  test('a claim expires after 24 h', async () => {
    const start = Date.now();
    const clock = mock.method(Date, 'now', () => start);
    const id = uniqueId();
    assert.equal(await claimMessageOnce('inst-a', id), true);

    clock.mock.mockImplementation(() => start + 24 * 60 * 60 * 1000 - 1);
    assert.equal(await claimMessageOnce('inst-a', id), false);

    clock.mock.mockImplementation(() => start + 24 * 60 * 60 * 1000 + 1);
    assert.equal(await claimMessageOnce('inst-a', id), true);
  });
});
