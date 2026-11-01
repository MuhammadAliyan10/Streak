import assert from 'node:assert/strict';
import test from 'node:test';
import {
  dayCounts,
  formatPlannerDate,
  sortTimeline,
  taskSchema,
  type TimelineItem,
} from './planner-domain.ts';

const validTask = {
  title: 'Pay rent',
  description: '',
  priority: 'normal',
  plannedDate: '2026-11-01',
  plannedTime: '',
  estimatedMinutes: '',
  timezone: 'Asia/Karachi',
} as const;

test('task form accepts valid optional values and rejects invalid date, time, and duration', () => {
  assert.equal(taskSchema.safeParse(validTask).success, true);
  assert.equal(taskSchema.safeParse({ ...validTask, plannedDate: '2026-02-30' }).success, false);
  assert.equal(taskSchema.safeParse({ ...validTask, plannedTime: '24:30' }).success, false);
  assert.equal(taskSchema.safeParse({ ...validTask, estimatedMinutes: '0' }).success, false);
  assert.equal(taskSchema.safeParse({ ...validTask, estimatedMinutes: '30' }).success, true);
  assert.equal(taskSchema.safeParse({ ...validTask, timezone: 'Mars/Olympus' }).success, false);
});

test('timeline keeps time order and puts untimed items last', () => {
  const items: TimelineItem[] = [
    { id: 'late', title: 'Late', detail: '', time: '17:00', kind: 'planned', status: 'pending' },
    { id: 'untimed', title: 'Anytime', detail: '', time: null, kind: 'planned', status: 'pending' },
    { id: 'early', title: 'Early', detail: '', time: '08:30', kind: 'actual', status: 'recorded' },
  ];
  assert.deepEqual(
    sortTimeline(items).map((item) => item.id),
    ['early', 'late', 'untimed'],
  );
});

test('daily task counts ignore cancelled tasks', () => {
  assert.deepEqual(
    dayCounts([{ status: 'pending' }, { status: 'completed' }, { status: 'cancelled' }]),
    { pending: 1, completed: 1, cancelled: 1 },
  );
});

test('planner date label stays anchored to its local calendar day', () => {
  assert.match(formatPlannerDate('2026-11-01', 'Asia/Karachi'), /November 1, 2026/);
});
