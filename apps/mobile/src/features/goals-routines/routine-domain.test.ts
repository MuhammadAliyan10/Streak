import assert from 'node:assert/strict';
import test from 'node:test';
import { routineRunProgress, routineSchema, routineStepSchema } from './routine-domain.ts';

test('routine progress includes skipped steps and requires all steps to be terminal to finish', () => {
  assert.deepEqual(routineRunProgress(['completed', 'skipped', 'pending']), {
    complete: 1,
    skipped: 1,
    pending: 1,
    percent: 67,
    canFinish: false,
  });
  assert.equal(routineRunProgress(['completed', 'skipped']).canFinish, true);
});
test('routine and step validation checks schedules, linked references, and duration bounds', () => {
  const timer = routineStepSchema.safeParse({
    title: 'Focus',
    kind: 'timer',
    habitId: '',
    taskId: '',
    targetMinutes: '1441',
    measurement: '',
    value: '',
    unit: '',
    category: 'other',
    presetId: '',
    note: '',
    skippable: true,
  });
  assert.equal(timer.success, false);
  const invalid = routineSchema.safeParse({
    name: 'Morning',
    description: '',
    icon: 'sparkles',
    color: 'indigo',
    startTime: '07:00',
    windowStart: '09:00',
    windowEnd: '08:00',
    weekdays: [],
    estimatedMinutes: '',
    timezone: 'UTC',
    steps: [],
  });
  assert.equal(invalid.success, false);
});
test('quick measurement steps accept supported amounts and an existing preset link', () => {
  const result = routineStepSchema.safeParse({
    title: 'Drink water',
    kind: 'quick_measurement',
    habitId: 'water-habit',
    taskId: '',
    targetMinutes: '',
    measurement: 'volume',
    value: '250',
    unit: 'mL',
    category: 'habit',
    presetId: 'water-preset',
    note: '',
    skippable: true,
  });
  assert.equal(result.success, true);
});
