import '../helpers/setup';

import assert from 'node:assert/strict';
import { afterEach, describe, mock, test } from 'node:test';

import { PlaceholderResendTracker } from '@utils/placeholderResendTracker';

describe('PlaceholderResendTracker (GHSA-qvv5-jq5g-4cgg palliative)', () => {
  afterEach(() => mock.restoreAll());

  test('an id Baileys asked to resend is accepted once, even after Baileys deletes its entry', async () => {
    const tracker = new PlaceholderResendTracker();
    await tracker.cache.set('MSG1', true);
    assert.equal(await tracker.cache.get('MSG1'), true, 'works as the Baileys cache');

    await tracker.cache.del('MSG1');
    assert.equal(await tracker.cache.get('MSG1'), undefined);

    assert.equal(tracker.consume('MSG1'), true);
    assert.equal(tracker.consume('MSG1'), false, 'one answer per request');
  });

  test('an id never requested is refused', () => {
    const tracker = new PlaceholderResendTracker();
    assert.equal(tracker.consume('FORGED'), false);
    assert.equal(tracker.consume(undefined), false);
    assert.equal(tracker.consume(''), false);
  });

  test('a request expires after the TTL and the memory is bounded', async () => {
    const start = Date.now();
    const clock = mock.method(Date, 'now', () => start);
    const tracker = new PlaceholderResendTracker(1000, 3);

    await tracker.cache.set('OLD', true);
    clock.mock.mockImplementation(() => start + 1001);
    assert.equal(tracker.consume('OLD'), false);

    for (const id of ['A', 'B', 'C', 'D']) await tracker.cache.set(id, true);
    assert.equal(tracker.consume('A'), false, 'oldest dropped above the cap');
    assert.equal(tracker.consume('D'), true);
  });
});
