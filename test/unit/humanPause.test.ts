import '../helpers/setup';

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  describeHumanPause,
  getHumanLastMessageAt,
  hasHumanWrittenSince,
  HUMAN_LAST_MESSAGE_AT,
  isHumanPaused,
  isHumanPauseExpired,
  isManualPause,
  MANUAL_PAUSE,
  resolveHumanResumeMinutes,
  withHumanLastMessageAt,
  withManualPause,
  withoutHumanLastMessageAt,
} from '@utils/humanPause';

const now = Date.parse('2026-10-29T12:00:00.000Z');
const MIN = 60_000;
const iso = (offsetMinutes: number) => new Date(now + offsetMinutes * MIN).toISOString();
const human = (offsetMinutes: number, extra: Record<string, any> = {}) => ({
  status: 'paused',
  parameters: { [HUMAN_LAST_MESSAGE_AT]: iso(offsetMinutes), ...extra },
});

describe('humanPause: parameters helpers', () => {
  test('withHumanLastMessageAt keeps other keys and accepts null / non-object parameters', () => {
    const date = new Date(now);
    assert.deepEqual(withHumanLastMessageAt({ foo: 1 }, date), { foo: 1, humanLastMessageAt: iso(0) });
    assert.deepEqual(withHumanLastMessageAt(null, date), { humanLastMessageAt: iso(0) });
    assert.deepEqual(withHumanLastMessageAt(['x'], date), { humanLastMessageAt: iso(0) });
    assert.deepEqual(withHumanLastMessageAt('text', date), { humanLastMessageAt: iso(0) });
  });

  test('helpers never mutate the original object', () => {
    const original = { foo: 1, humanLastMessageAt: iso(-5), manualPause: true };
    const copy = structuredClone(original);
    withHumanLastMessageAt(original, new Date(now));
    withoutHumanLastMessageAt(original);
    withManualPause(original);
    assert.deepEqual(original, copy);
  });

  test('withoutHumanLastMessageAt removes the timestamp and the manual flag only', () => {
    assert.deepEqual(withoutHumanLastMessageAt({ a: 1, humanLastMessageAt: 'x', manualPause: true }), { a: 1 });
    assert.deepEqual(withoutHumanLastMessageAt(null), {});
  });

  test('withManualPause marks the manual pause and drops the human timestamp', () => {
    assert.deepEqual(withManualPause({ a: 1, humanLastMessageAt: iso(-1) }), { a: 1, [MANUAL_PAUSE]: true });
    assert.equal(isManualPause({ parameters: withManualPause(null) }), true);
    assert.equal(isManualPause({ parameters: { manualPause: 'true' } }), false);
    assert.equal(isManualPause(null), false);
  });

  test('getHumanLastMessageAt ignores missing and invalid timestamps', () => {
    assert.equal(getHumanLastMessageAt(human(-3)), now - 3 * MIN);
    assert.equal(getHumanLastMessageAt({ parameters: { humanLastMessageAt: 'x2026-01-01' } }), null);
    assert.equal(getHumanLastMessageAt({ parameters: {} }), null);
    assert.equal(getHumanLastMessageAt({ parameters: null }), null);
    assert.equal(getHumanLastMessageAt(undefined), null);
  });
});

describe('humanPause: resolveHumanResumeMinutes (bot > settings > 0)', () => {
  test('precedence and inheritance', () => {
    assert.equal(resolveHumanResumeMinutes({ humanResumeMinutes: 15 }, { humanResumeMinutes: 60 }), 15);
    assert.equal(resolveHumanResumeMinutes({ humanResumeMinutes: null }, { humanResumeMinutes: 5 }), 5);
    assert.equal(resolveHumanResumeMinutes({}, { humanResumeMinutes: 5 }), 5);
    assert.equal(resolveHumanResumeMinutes(null, null), 0);
  });

  test('an explicit 0 on the bot wins over the settings (manual resume only)', () => {
    assert.equal(resolveHumanResumeMinutes({ humanResumeMinutes: 0 }, { humanResumeMinutes: 5 }), 0);
  });

  test('invalid or negative values become 0', () => {
    assert.equal(resolveHumanResumeMinutes({ humanResumeMinutes: -3 }, null), 0);
    assert.equal(resolveHumanResumeMinutes({ humanResumeMinutes: 'abc' }, null), 0);
    assert.equal(resolveHumanResumeMinutes(null, { humanResumeMinutes: Infinity }), 0);
  });
});

describe('humanPause: isHumanPaused', () => {
  test('paused, opened with a timestamp (race) and opened without one', () => {
    assert.equal(isHumanPaused({ status: 'paused', parameters: null }), true);
    assert.equal(
      isHumanPaused({ status: 'opened', parameters: withHumanLastMessageAt({ a: 1 }, new Date(now)) }),
      true,
    );
    assert.equal(isHumanPaused({ status: 'opened', parameters: {} }), false);
    assert.equal(isHumanPaused({ status: 'opened', parameters: { humanLastMessageAt: 'garbage' } }), false);
    assert.equal(isHumanPaused({ status: 'closed', parameters: { humanLastMessageAt: iso(-1) } }), false);
    assert.equal(isHumanPaused(null), false);
  });
});

describe('humanPause: isHumanPauseExpired', () => {
  test('human pause: not expired before X minutes, expired after', () => {
    assert.equal(
      isHumanPauseExpired({ status: 'paused', parameters: { humanLastMessageAt: iso(-0.5) } }, 1, now),
      false,
    );
    assert.equal(isHumanPauseExpired(human(-1.02), 1, now), true);
  });

  test('exact boundary counts as expired, 1 ms before does not', () => {
    assert.equal(isHumanPauseExpired(human(-30), 30, now), true);
    const almost = { status: 'paused', parameters: { humanLastMessageAt: new Date(now - 30 * MIN + 1).toISOString() } };
    assert.equal(isHumanPauseExpired(almost, 30, now), false);
  });

  test('0 minutes (or invalid) never resumes automatically', () => {
    assert.equal(isHumanPauseExpired(human(-99 * 60), 0, now), false);
    assert.equal(isHumanPauseExpired(human(-99 * 60), -1, now), false);
    assert.equal(isHumanPauseExpired(human(-99 * 60), NaN, now), false);
  });

  test('manual pause is never lifted automatically, even with an old human timestamp', () => {
    const manual = { status: 'paused', parameters: withManualPause(null), updatedAt: new Date(now - 5 * MIN) };
    assert.equal(isHumanPauseExpired(manual, 1, now), false);
    const manualWithHuman = { status: 'paused', parameters: { manualPause: true, humanLastMessageAt: iso(-90) } };
    assert.equal(isHumanPauseExpired(manualWithHuman, 1, now), false);
  });

  test('legacy paused session (no timestamp) counts from updatedAt (Date or string)', () => {
    assert.equal(
      isHumanPauseExpired({ status: 'paused', parameters: null, updatedAt: new Date(now - 5 * MIN) }, 1, now),
      true,
    );
    assert.equal(isHumanPauseExpired({ status: 'paused', parameters: {}, updatedAt: iso(-0.5) }, 1, now), false);
    assert.equal(isHumanPauseExpired({ status: 'paused', parameters: {} }, 1, now), false);
    assert.equal(isHumanPauseExpired({ status: 'paused', updatedAt: 'not a date' }, 1, now), false);
  });

  test('an opened session never uses updatedAt as reference', () => {
    assert.equal(isHumanPauseExpired({ status: 'opened', parameters: {}, updatedAt: iso(-90) }, 1, now), false);
  });

  test('uses Date.now() when no clock is given', () => {
    assert.equal(
      isHumanPauseExpired(
        { status: 'paused', parameters: withHumanLastMessageAt(null, new Date(Date.now() - 2 * MIN)) },
        1,
      ),
      true,
    );
  });
});

describe('humanPause: hasHumanWrittenSince', () => {
  test('detects a newer human message only', () => {
    assert.equal(hasHumanWrittenSince({ parameters: {} }, human(-1)), true);
    assert.equal(hasHumanWrittenSince(null, human(-1)), true);
    assert.equal(hasHumanWrittenSince(human(-5), human(-1)), true);
    assert.equal(hasHumanWrittenSince(human(-1), human(-1)), false);
    assert.equal(hasHumanWrittenSince(human(-1), human(-5)), false);
    assert.equal(hasHumanWrittenSince(human(-1), { parameters: {} }), false);
    assert.equal(hasHumanWrittenSince(human(-1), null), false);
  });
});

describe('humanPause: describeHumanPause', () => {
  test('null when the session is not paused', () => {
    assert.equal(describeHumanPause({ status: 'opened', parameters: {} }, 30, now), null);
    assert.equal(describeHumanPause({ status: 'closed', parameters: { humanLastMessageAt: iso(-5) } }, 30, now), null);
    assert.equal(describeHumanPause(null, 30, now), null);
  });

  test('human pause still running', () => {
    assert.deepEqual(describeHumanPause({ ...human(-10), updatedAt: iso(-1) }, 30, now), {
      reason: 'human',
      since: iso(-10),
      lastHumanMessageAt: iso(-10),
      resumeMinutes: 30,
      resumesAt: iso(20),
      remainingSeconds: 1200,
      autoResume: true,
    });
  });

  test('opened + timestamp (race) is still reported as a human pause', () => {
    const info = describeHumanPause({ status: 'opened', parameters: { humanLastMessageAt: iso(-10) } }, 30, now);
    assert.equal(info.reason, 'human');
    assert.equal(info.remainingSeconds, 1200);
  });

  test('expired: remainingSeconds 0 exactly when isHumanPauseExpired is true', () => {
    const expired = human(-45);
    assert.equal(describeHumanPause(expired, 30, now).remainingSeconds, 0);
    assert.equal(isHumanPauseExpired(expired, 30, now), true);

    const edge = human(-30);
    assert.equal(describeHumanPause(edge, 30, now).remainingSeconds, 0);
    assert.equal(isHumanPauseExpired(edge, 30, now), true);

    const almost = {
      status: 'paused',
      parameters: { humanLastMessageAt: new Date(now - 30 * MIN + 400).toISOString() },
    };
    assert.equal(describeHumanPause(almost, 30, now).remainingSeconds, 1);
    assert.equal(isHumanPauseExpired(almost, 30, now), false);
  });

  test('0 minutes: only manual resume', () => {
    assert.deepEqual(describeHumanPause(human(-10), 0, now), {
      reason: 'human',
      since: iso(-10),
      lastHumanMessageAt: iso(-10),
      resumeMinutes: 0,
      resumesAt: null,
      remainingSeconds: null,
      autoResume: false,
    });
  });

  test('manual pause: since = updatedAt, never auto resumes (even with a human message on top)', () => {
    assert.deepEqual(
      describeHumanPause({ status: 'paused', parameters: { manualPause: true }, updatedAt: iso(-7) }, 30, now),
      {
        reason: 'manual',
        since: iso(-7),
        lastHumanMessageAt: null,
        resumeMinutes: 30,
        resumesAt: null,
        remainingSeconds: null,
        autoResume: false,
      },
    );

    const info = describeHumanPause(
      {
        status: 'paused',
        parameters: { manualPause: true, humanLastMessageAt: iso(-2) },
        updatedAt: new Date(now - MIN),
      },
      30,
      now,
    );
    assert.equal(info.reason, 'manual');
    assert.equal(info.since, iso(-1));
    assert.equal(info.lastHumanMessageAt, iso(-2));
    assert.equal(info.autoResume, false);
  });

  test('legacy pause: counts from updatedAt', () => {
    assert.deepEqual(describeHumanPause({ status: 'paused', parameters: null, updatedAt: iso(-20) }, 30, now), {
      reason: 'legacy',
      since: iso(-20),
      lastHumanMessageAt: null,
      resumeMinutes: 30,
      resumesAt: iso(10),
      remainingSeconds: 600,
      autoResume: true,
    });

    const expired = { status: 'paused', parameters: {}, updatedAt: iso(-90) };
    assert.equal(describeHumanPause(expired, 30, now).remainingSeconds, 0);
    assert.equal(isHumanPauseExpired(expired, 30, now), true);

    const noMinutes = describeHumanPause({ status: 'paused', parameters: {}, updatedAt: iso(-20) }, 0, now);
    assert.equal(noMinutes.reason, 'legacy');
    assert.equal(noMinutes.resumesAt, null);
    assert.equal(noMinutes.autoResume, false);

    const noUpdatedAt = describeHumanPause({ status: 'paused', parameters: {} }, 30, now);
    assert.equal(noUpdatedAt.since, null);
    assert.equal(noUpdatedAt.autoResume, false);

    assert.equal(
      describeHumanPause({ status: 'paused', updatedAt: new Date(now - 20 * MIN) }, 30, now).since,
      iso(-20),
    );
  });

  test('invalid resumeMinutes are treated as 0', () => {
    assert.equal(describeHumanPause(human(-1), NaN, now).resumeMinutes, 0);
    assert.equal(describeHumanPause(human(-1), -5, now).autoResume, false);
  });
});
