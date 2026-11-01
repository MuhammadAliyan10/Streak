import assert from 'node:assert/strict';
import test from 'node:test';
import {
  allocateIntervalsByLocalDate,
  elapsedFromMonotonic,
  focusSetupSchema,
  formatDuration,
  remainingCountdown,
} from './focus-domain.ts';

test('stopwatch elapsed time is derived from monotonic timestamps and formats hours', () => {
  assert.equal(elapsedFromMonotonic(1_000, 10_000, 3_670_000), 3_661_000);
  assert.equal(formatDuration(3_661_000), '01:01:01');
});

test('countdown validates custom minutes, resumes from active elapsed time, and clamps at zero', () => {
  const base = {
    title: 'Study',
    mode: 'countdown' as const,
    targetMinutes: '25',
    habitId: '',
    taskId: '',
    note: '',
    timezone: 'UTC',
  };
  assert.equal(focusSetupSchema.safeParse(base).success, true);
  assert.equal(focusSetupSchema.safeParse({ ...base, targetMinutes: '0' }).success, false);
  assert.equal(focusSetupSchema.safeParse({ ...base, targetMinutes: '1.5' }).success, false);
  assert.equal(remainingCountdown(1_500, 600_000), 900);
  assert.equal(remainingCountdown(1_500, 1_500_000), 0);
});

test('activity duration splits across local midnight, preserving timezone day allocation', () => {
  const result = allocateIntervalsByLocalDate(
    [{ startedAt: '2026-11-01T18:30:00.000Z', endedAt: '2026-11-01T20:30:00.000Z' }],
    'Asia/Karachi',
  );
  assert.deepEqual(
    result.map(({ localDate, seconds }) => ({ localDate, seconds })),
    [
      { localDate: '2026-11-01', seconds: 1800 },
      { localDate: '2026-11-02', seconds: 5400 },
    ],
  );
});

test('pause intervals contribute only their active durations', () => {
  const result = allocateIntervalsByLocalDate(
    [
      { startedAt: '2026-11-01T10:00:00.000Z', endedAt: '2026-11-01T10:15:00.000Z' },
      { startedAt: '2026-11-01T10:45:00.000Z', endedAt: '2026-11-01T11:00:00.000Z' },
    ],
    'UTC',
  );
  assert.equal(result[0]?.seconds, 1800);
});
