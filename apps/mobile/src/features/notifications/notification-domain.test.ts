import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildHabitReminders,
  nextOccurrenceDates,
  planReminders,
  reconcileOwnedNotifications,
  validReminderDestination,
  type ReminderPreferences,
} from './notification-domain.ts';
import { timestampFromLocal } from '../habits/domain/activity-domain.ts';

const prefs: ReminderPreferences = {
  enabled: true,
  preferredTime: '18:00',
  advanceMinutes: 0,
  flexibleWarningMinutes: 60,
  quietStart: '',
  quietEnd: '',
  soundEnabled: true,
};
const habit = {
  id: 'h-1',
  name: 'Study',
  status: 'active',
  mode: 'fixed',
  weekdayMask: 127,
  timezone: 'UTC',
  startDate: '2026-05-01',
  endDate: null,
  fixedTime: '08:00',
  windowStart: null,
  windowEnd: null,
};

test('fixed-time habits use their configured time', () => {
  const reminders = buildHabitReminders({
    habit,
    preferences: prefs,
    fromDate: '2026-05-01',
    days: 1,
  });
  assert.equal(reminders[0]?.localTime, '08:00');
  assert.equal(reminders[0]?.route, '/habits/h-1');
});

test('fixed-time habits keep the scheduled reminder and add the configured advance reminder', () => {
  const reminders = buildHabitReminders({
    habit,
    preferences: { ...prefs, advanceMinutes: 15 },
    fromDate: '2026-05-01',
    days: 1,
  });
  assert.deepEqual(
    reminders.map((item) => item.localTime),
    ['08:00', '07:45'],
  );
});

test('flexible-window habits keep reminders inside the window and warn before its end', () => {
  const reminders = buildHabitReminders({
    habit: {
      ...habit,
      mode: 'flexible',
      fixedTime: null,
      windowStart: '07:00',
      windowEnd: '18:00',
    },
    preferences: { ...prefs, preferredTime: '12:00' },
    fromDate: '2026-05-01',
    days: 1,
  });
  assert.deepEqual(
    reminders.map((item) => item.localTime),
    ['07:00', '12:00', '17:00'],
  );
});

test('anytime habits use the preferred reminder time', () => {
  const reminders = buildHabitReminders({
    habit: { ...habit, mode: 'anytime', fixedTime: null },
    preferences: prefs,
    fromDate: '2026-05-01',
    days: 1,
  });
  assert.equal(reminders[0]?.localTime, '18:00');
});

test('inactive habits do not produce reminders', () => {
  assert.deepEqual(
    buildHabitReminders({
      habit: { ...habit, status: 'paused' },
      preferences: prefs,
      fromDate: '2026-05-01',
    }),
    [],
  );
  assert.deepEqual(
    buildHabitReminders({
      habit: { ...habit, status: 'archived' },
      preferences: prefs,
      fromDate: '2026-05-01',
    }),
    [],
  );
});

test('weekday recurrence and month boundaries are calculated by local calendar date', () => {
  const mondayOnly = 1 << 1;
  assert.deepEqual(
    nextOccurrenceDates({
      startDate: '2026-01-30',
      weekdayMask: mondayOnly,
      fromDate: '2026-01-30',
      days: 6,
    }),
    ['2026-02-02'],
  );
});

test('planner applies quiet hours, excludes past reminders, and removes duplicate keys', () => {
  const activities = [
    {
      id: 'task-1',
      kind: 'task' as const,
      title: 'Task',
      route: '/tasks/task-1/edit',
      timezone: 'UTC',
      localDate: '2026-05-01',
      localTime: '21:30',
      body: 'Task reminder',
    },
    {
      id: 'task-1',
      kind: 'task' as const,
      title: 'Task',
      route: '/tasks/task-1/edit',
      timezone: 'UTC',
      localDate: '2026-05-01',
      localTime: '21:30',
      body: 'Duplicate task reminder',
    },
    {
      id: 'task-2',
      kind: 'task' as const,
      title: 'Quiet task',
      route: '/tasks/task-2/edit',
      timezone: 'UTC',
      localDate: '2026-05-01',
      localTime: '23:30',
      body: 'Quiet-hour reminder',
    },
  ];
  const planned = planReminders({
    activities,
    preferences: { ...prefs, quietStart: '22:00', quietEnd: '07:00' },
    now: new Date('2026-05-01T12:00:00Z'),
    horizonDays: 2,
  });
  assert.equal(planned.length, 1);
  assert.equal(planned[0]?.timestamp, '2026-05-01T21:30:00.000Z');
  assert.equal(
    planned.some((item) => item.entityId === 'task-2'),
    false,
  );
  assert.equal(
    planReminders({
      activities,
      preferences: { ...prefs, enabled: false },
      now: new Date('2026-05-01T12:00:00Z'),
    }).length,
    0,
  );
});

test('local recurrence spans the spring daylight-saving transition correctly', () => {
  const before = Date.parse(timestampFromLocal('2026-03-07', '09:00', 'America/New_York'));
  const after = Date.parse(timestampFromLocal('2026-03-08', '09:00', 'America/New_York'));
  assert.equal((after - before) / 3_600_000, 23);
});

test('notification reconciliation retains one existing request, removes stale duplicates, and schedules only missing keys', async () => {
  const cancelled: string[] = [];
  const scheduled: string[] = [];
  const result = await reconcileOwnedNotifications({
    wantedKeys: ['keep', 'new'],
    pending: [
      { key: 'keep', nativeId: 'native-1' },
      { key: 'keep', nativeId: 'duplicate' },
      { key: 'stale', nativeId: 'stale' },
    ],
    cancel: async (id) => {
      cancelled.push(id);
    },
    schedule: async (key) => {
      scheduled.push(key);
      return `id-${key}`;
    },
  });
  assert.deepEqual(cancelled.sort(), ['duplicate', 'stale']);
  assert.deepEqual(scheduled, ['new']);
  assert.equal(result.get('keep'), 'native-1');
});

test('failed native scheduling rejects reconciliation without hiding the failure', async () => {
  await assert.rejects(
    reconcileOwnedNotifications({
      wantedKeys: ['new'],
      pending: [],
      cancel: async () => {},
      schedule: async () => {
        throw new Error('native unavailable');
      },
    }),
    /native unavailable/,
  );
});

test('only safe internal activity destinations are accepted', () => {
  assert.equal(validReminderDestination('/habits/abc-123'), true);
  assert.equal(validReminderDestination('/tasks/abc-123/edit'), true);
  assert.equal(validReminderDestination('/https://example.com'), false);
  assert.equal(validReminderDestination('/goals/../setup'), false);
});
