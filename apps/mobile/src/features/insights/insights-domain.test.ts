import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aggregateSecondsByDate,
  calculateHabitConsistency,
  compareEquivalentPeriods,
  insightDateRange,
  validateInsightRange,
} from './insights-domain.ts';

test('date presets use local calendar dates and custom ranges are bounded', () => {
  assert.deepEqual(insightDateRange('today', '2026-03-01'), {
    startDate: '2026-03-01',
    endDate: '2026-03-01',
  });
  assert.deepEqual(insightDateRange('7d', '2026-03-01'), {
    startDate: '2026-02-23',
    endDate: '2026-03-01',
  });
  assert.deepEqual(insightDateRange('30d', '2026-03-01'), {
    startDate: '2026-01-31',
    endDate: '2026-03-01',
  });
  assert.equal(validateInsightRange('2026-02-28', '2026-03-01'), true);
  assert.equal(validateInsightRange('2026-03-02', '2026-03-01'), false);
  assert.equal(validateInsightRange('2026-01-01', '2026-04-01'), false);
});

test('habit consistency excludes paused, unscheduled, unknown bad days, pending, and the unfinished current day', () => {
  const result = calculateHabitConsistency(
    [
      { date: '2026-01-01', state: 'completed', progress: 1, target: 1 },
      { date: '2026-01-02', state: 'missed', progress: 0, target: 1 },
      { date: '2026-01-03', state: 'unknown', progress: 0, target: 1 },
      { date: '2026-01-04', state: 'paused', progress: 0, target: 1 },
      { date: '2026-01-05', state: 'unscheduled', progress: 0, target: 1 },
      { date: '2026-01-06', state: 'skipped', progress: 0, target: 1 },
      { date: '2026-01-07', state: 'partial', progress: 20, target: 30 },
      { date: '2026-01-08', state: 'pending', progress: 0, target: 1 },
      { date: '2026-01-09', state: 'partial', progress: 10, target: 30 },
    ],
    '2026-01-09',
  );
  assert.deepEqual(result, { completed: 1, eligible: 4, percent: 25 });
});

test('credited focus seconds group by local date and incomplete comparison periods stay unlabeled', () => {
  assert.deepEqual(
    aggregateSecondsByDate([
      { localDate: '2026-01-01', seconds: 1200 },
      { localDate: '2026-01-01', seconds: 600 },
      { localDate: '2026-01-02', seconds: 300 },
      { localDate: '2026-01-02', seconds: -1 },
    ]),
    [
      { date: '2026-01-01', seconds: 1800 },
      { date: '2026-01-02', seconds: 300 },
    ],
  );
  assert.equal(compareEquivalentPeriods(10, 8, true), 25);
  assert.equal(compareEquivalentPeriods(10, 8, false), null);
  assert.equal(compareEquivalentPeriods(10, 0, true), null);
});
