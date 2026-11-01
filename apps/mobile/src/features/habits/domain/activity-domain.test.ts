import assert from 'node:assert/strict';
import test from 'node:test';
import {
  fromCanonical,
  measurementForHabit,
  timestampFromLocal,
  toCanonical,
} from './activity-domain.ts';

test('measurement conversion stores exact canonical integer units', () => {
  assert.deepEqual(toCanonical(0.5, 'volume', 'L'), { value: 500, unit: 'mL' });
  assert.deepEqual(toCanonical(30, 'duration', 'min'), { value: 1800, unit: 'seconds' });
  assert.deepEqual(toCanonical(1.5, 'distance', 'km'), { value: 1500, unit: 'meters' });
  assert.deepEqual(toCanonical(12, 'pages', 'pages'), { value: 12, unit: 'pages' });
  assert.equal(fromCanonical(1800, 'duration', 'min'), 30);
  assert.equal(measurementForHabit('quantity', 'pages'), 'pages');
});

test('conversion rejects nonfinite, nonpositive, and fractional count amounts', () => {
  assert.throws(() => toCanonical(Number.NaN, 'volume', 'mL'));
  assert.throws(() => toCanonical(0, 'distance', 'km'));
  assert.throws(() => toCanonical(1.5, 'count', 'reps'));
  assert.throws(() => toCanonical(3_000_000, 'volume', 'L'));
});

test('local timestamp adjustment honors the selected time zone and midnight boundary', () => {
  const timestamp = timestampFromLocal('2026-11-01', '00:15', 'Asia/Karachi');
  assert.equal(timestamp, '2026-10-31T19:15:00.000Z');
  assert.equal(timestampFromLocal('2026-11-01', '10:30', 'UTC'), '2026-11-01T10:30:00.000Z');
});
