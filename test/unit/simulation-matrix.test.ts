import '../helpers/setup';

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { VirtualClock } from '../simulation/clock';
import {
  allPairs,
  buildCases,
  compatible,
  coverage,
  DIMENSION_NAMES,
  DIMENSIONS,
  pairwiseRows,
} from '../simulation/matrix';

describe('simulator: coverage matrix', () => {
  test('pairwise rows cover every compatible pair of values', () => {
    const rows = pairwiseRows(42);
    const cases = rows.map((row, index) => ({ ...(row as any), index, seed: index }));
    const result = coverage(cases);
    assert.equal(result.pairs.covered, result.pairs.total);
    assert.equal(result.missingPairs.length, 0);
    assert.ok(
      rows.every((row) => compatible(row)),
      'no impossible combination',
    );
    assert.ok(rows.length < 450, `small matrix (${rows.length} rows)`);
  });

  test('filled to the requested size, deterministic for a seed, every value present', () => {
    const cases = buildCases(1200, 7);
    assert.equal(cases.length, 1200);
    assert.deepEqual(buildCases(1200, 7), cases);
    assert.notDeepEqual(buildCases(1200, 8), cases);
    const result = coverage(cases);
    for (const dim of DIMENSION_NAMES) {
      for (const value of DIMENSIONS[dim]) assert.ok(result.perDimension[dim][value] > 0, `${dim}=${value}`);
    }
    assert.ok(allPairs().size > 1500);
  });
});

describe('simulator: virtual clock', () => {
  test('timers fire in order of due time, Date follows the clock, no real waiting', async () => {
    const start = Date.UTC(2026, 10, 16, 12, 0, 0);
    const clock = new VirtualClock(start).install();
    const fired: string[] = [];
    try {
      setTimeout(() => fired.push(`b@${Date.now() - start}`), 5000);
      setTimeout(() => fired.push(`a@${Date.now() - start}`), 1000);
      const cancelled = setTimeout(() => fired.push('never'), 2000);
      clearTimeout(cancelled);
      const done = (async () => {
        await new Promise((resolve) => setTimeout(resolve, 3 * 24 * 3600 * 1000));
        fired.push(`days@${new Date().toISOString()}`);
      })();
      await clock.runUntil(() => fired.length === 3);
      await done;
    } finally {
      clock.uninstall();
    }
    assert.deepEqual(fired, ['a@1000', 'b@5000', 'days@2026-11-19T12:00:00.000Z']);
    assert.ok(Date.now() > start + 1000 || Date.now() < start, 'real Date is back');
  });
});
