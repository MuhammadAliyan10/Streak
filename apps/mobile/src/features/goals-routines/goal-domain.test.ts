import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateGoalProgress,
  goalSchema,
  nextGoalVersionDate,
  pauseDurationDays,
  pausedThroughDate,
  type GoalProgressLog,
} from './goal-domain.ts';

const log = (id: string, localDate: string, value: number): GoalProgressLog => ({
  id,
  localDate,
  value,
  unit: 'seconds',
});
test('cumulative goals sum partial activity only toward their total target', () => {
  const progress = calculateGoalProgress({
    startDate: '2026-11-01',
    endDate: '2026-11-30',
    today: '2026-11-10',
    model: 'cumulative',
    recurrence: null,
    measurement: 'duration',
    targetValue: 3600,
    weekdayMask: 127,
    logs: [log('a', '2026-11-02', 900), log('b', '2026-11-03', 900)],
  });
  assert.equal(progress.totalValue, 1800);
  assert.equal(progress.progressPercent, 50);
  assert.equal(progress.missedPeriods, 0);
});
test('the same persisted activity ID is counted only once', () => {
  const repeated = log('same-record', '2026-11-02', 600);
  const progress = calculateGoalProgress({
    startDate: '2026-11-01',
    endDate: '2026-11-30',
    today: '2026-11-02',
    model: 'cumulative',
    recurrence: null,
    measurement: 'duration',
    targetValue: 1200,
    weekdayMask: 127,
    logs: [repeated, repeated],
  });
  assert.equal(progress.totalValue, 600);
});
test('daily recurring goals measure each scheduled day independently and preserve weekday versions', () => {
  const progress = calculateGoalProgress({
    startDate: '2026-11-02',
    endDate: '2026-11-08',
    today: '2026-11-05',
    model: 'recurring',
    recurrence: 'daily',
    measurement: 'duration',
    targetValue: 180,
    weekdayMask: 127,
    versions: [
      {
        targetValue: 180,
        measurement: 'duration',
        unit: 'seconds',
        recurrence: 'daily',
        weekdayMask: 62,
        effectiveFrom: '2026-11-02',
      },
    ],
    logs: [
      log('mon', '2026-11-02', 360),
      log('tue', '2026-11-03', 90),
      log('wed', '2026-11-04', 180),
    ],
  });
  assert.equal(progress.totalValue, 630);
  assert.equal(progress.achievedPeriods, 2);
  assert.equal(progress.missedPeriods, 1);
  assert.equal(progress.elapsedPeriods, 4);
});
test('weekly and monthly recurrence uses calendar buckets for custom multi-month spans', () => {
  const weekly = calculateGoalProgress({
    startDate: '2026-11-03',
    endDate: '2026-11-20',
    today: '2026-11-20',
    model: 'recurring',
    recurrence: 'weekly',
    measurement: 'count',
    targetValue: 5,
    weekdayMask: 127,
    logs: Array.from({ length: 5 }, (_, index) =>
      log(`w${index}`, `2026-11-${String(index + 3).padStart(2, '0')}`, 1),
    ),
  });
  assert.equal(weekly.buckets.length, 3);
  const monthly = calculateGoalProgress({
    startDate: '2026-11-15',
    endDate: '2027-02-10',
    today: '2026-12-01',
    model: 'recurring',
    recurrence: 'monthly',
    measurement: 'pages',
    targetValue: 20,
    weekdayMask: 127,
    logs: [log('nov', '2026-11-20', 20)],
  });
  assert.equal(monthly.buckets.length, 4);
  assert.equal(monthly.achievedPeriods, 1);
});
test('yearly recurrence handles leap-year custom ranges and days are distinct calendar dates', () => {
  const yearly = calculateGoalProgress({
    startDate: '2024-02-28',
    endDate: '2025-03-01',
    today: '2024-03-01',
    model: 'recurring',
    recurrence: 'yearly',
    measurement: 'count',
    targetValue: 1,
    weekdayMask: 127,
    logs: [log('year', '2024-02-29', 1)],
  });
  assert.equal(yearly.buckets.length, 2);
  const days = calculateGoalProgress({
    startDate: '2026-11-01',
    endDate: '2026-11-30',
    today: '2026-11-30',
    model: 'cumulative',
    recurrence: null,
    measurement: 'days',
    targetValue: 3,
    weekdayMask: 127,
    logs: [log('a', '2026-11-01', 1), log('b', '2026-11-01', 1), log('c', '2026-11-02', 1)],
  });
  assert.equal(days.totalValue, 2);
});
test('target changes use the next daily/weekly period and goal validation rejects invalid ranges', () => {
  assert.equal(nextGoalVersionDate('2026-11-03', 'daily'), '2026-11-04');
  assert.equal(nextGoalVersionDate('2026-11-04', 'weekly'), '2026-11-09');
  const invalid = goalSchema.safeParse({
    title: 'X',
    description: '',
    category: 'personal',
    periodType: 'custom',
    model: 'cumulative',
    recurrence: '',
    measurement: 'count',
    targetValue: '0',
    unit: 'count',
    startDate: '2026-12-01',
    endDate: '2026-11-01',
    weekdays: [0],
    timezone: 'UTC',
    habitIds: [],
  });
  assert.equal(invalid.success, false);
});

test('paused daily periods are omitted from recurring consistency and missed-day counts', () => {
  const progress = calculateGoalProgress({
    startDate: '2026-11-02',
    endDate: '2026-11-04',
    today: '2026-11-04',
    model: 'recurring',
    recurrence: 'daily',
    measurement: 'count',
    targetValue: 1,
    weekdayMask: 127,
    pauses: [{ startedOn: '2026-11-03', resumedOn: '2026-11-03' }],
    logs: [log('wed', '2026-11-04', 1)],
  });
  assert.equal(progress.elapsedPeriods, 2);
  assert.equal(progress.missedPeriods, 1);
  assert.equal(progress.achievedPeriods, 1);
});
test('resuming a goal extends its deadline by fully paused calendar days', () => {
  assert.equal(pauseDurationDays('2026-11-02', '2026-11-05'), 3);
  assert.equal(pausedThroughDate('2026-11-02', '2026-11-05'), '2026-11-04');
  assert.equal(pauseDurationDays('2026-11-02', '2026-11-02'), 1);
  assert.equal(pausedThroughDate('2026-11-02', '2026-11-02'), '2026-11-02');
});
