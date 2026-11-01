import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateStreak, dateAdd, habitSchema, localDateAt } from './habit-domain.ts';

const schedule = {
  weekdayMask: 127,
  startDate: '2026-01-01',
  endDate: null,
  mode: 'anytime' as const,
  windowEnd: null,
};
function streak(
  options: {
    kind?: 'good' | 'bad';
    entries?: Array<{ date: string; kind: string; value: number | null }>;
    today?: string;
    target?: number;
    pauses?: Array<{ start: string; end: string | null }>;
    scheduleHistory?: Array<{
      weekdayMask: number;
      startDate: string;
      endDate: string | null;
      mode: 'anytime' | 'fixed' | 'flexible';
      windowEnd: string | null;
    }>;
    targetHistory?: Array<{
      value: number;
      kind?: 'good' | 'bad';
      startDate: string;
      endDate: string | null;
    }>;
    deadlinePassedToday?: boolean;
  } = {},
) {
  return calculateStreak({
    kind: options.kind ?? 'good',
    schedule,
    target: options.target ?? 1,
    today: options.today ?? '2026-01-05',
    entries: options.entries ?? [],
    pauses: options.pauses ?? [],
    ...(options.scheduleHistory ? { scheduleHistory: options.scheduleHistory } : {}),
    ...(options.targetHistory ? { targetHistory: options.targetHistory } : {}),
    ...(options.deadlinePassedToday === undefined
      ? {}
      : { deadlinePassedToday: options.deadlinePassedToday }),
  });
}

test('validates habit target and schedule before persistence', () => {
  const base = {
    name: 'Read daily',
    kind: 'good',
    description: '',
    icon: 'book',
    color: 'indigo',
    measurement: 'duration',
    digitalUsage: false,
    targetValue: '30',
    unit: 'minutes',
    scheduleMode: 'anytime',
    weekdays: [1, 2],
    timezone: 'Asia/Karachi',
    startDate: '2026-01-01',
    endDate: '',
    fixedTime: '',
    windowStart: '',
    windowEnd: '',
  };
  assert.equal(habitSchema.safeParse(base).success, true);
  assert.equal(habitSchema.safeParse({ ...base, targetValue: '0' }).success, false);
  assert.equal(habitSchema.safeParse({ ...base, endDate: '2025-12-31' }).success, false);
  assert.equal(
    habitSchema.safeParse({
      ...base,
      scheduleMode: 'flexible',
      windowStart: '18:00',
      windowEnd: '07:00',
    }).success,
    false,
  );
  assert.equal(habitSchema.safeParse({ ...base, kind: 'bad' }).success, false);
});

test('digital usage is opt-in, limited to count or duration, and requires a positive maximum', () => {
  const base = {
    name: 'Instagram usage',
    kind: 'bad',
    description: '',
    icon: 'phone',
    color: 'rose',
    measurement: 'duration',
    digitalUsage: true,
    targetValue: '30',
    unit: 'min',
    scheduleMode: 'anytime',
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    timezone: 'Asia/Karachi',
    startDate: '2026-01-01',
    endDate: '',
    fixedTime: '',
    windowStart: '',
    windowEnd: '',
  };
  assert.equal(habitSchema.safeParse(base).success, true);
  assert.equal(
    habitSchema.safeParse({ ...base, measurement: 'count', unit: 'count' }).success,
    true,
  );
  assert.equal(
    habitSchema.safeParse({ ...base, measurement: 'distance', unit: 'km' }).success,
    false,
  );
  assert.equal(habitSchema.safeParse({ ...base, targetValue: '0' }).success, false);
  assert.equal(habitSchema.safeParse({ ...base, digitalUsage: false }).success, false);
});

test('counts consecutive scheduled completions and ignores rest days', () => {
  const result = streak({
    today: '2026-01-10',
    scheduleHistory: [{ ...schedule, weekdayMask: (1 << 1) | (1 << 3) | (1 << 5) }],
    entries: ['2026-01-02', '2026-01-05', '2026-01-07', '2026-01-09'].map((date) => ({
      date,
      kind: 'complete_override',
      value: null,
    })),
  });
  assert.equal(result.current, 4);
  assert.equal(result.longest, 4);
});

test('partial progress does not count complete until target is reached', () => {
  const result = streak({
    target: 180,
    entries: [{ date: '2026-01-05', kind: 'progress', value: 60 }],
  });
  assert.equal(result.days.at(-1)?.state, 'partial');
  assert.equal(result.current, 0);
});

test('a missed scheduled day breaks current streak after its deadline', () => {
  const result = streak({
    today: '2026-01-05',
    deadlinePassedToday: true,
    entries: [{ date: '2026-01-04', kind: 'complete_override', value: null }],
  });
  assert.equal(result.days.at(-1)?.state, 'missed');
  assert.equal(result.current, 0);
  assert.equal(result.longest, 1);
});

test('an unfinished current day remains pending before the deadline', () => {
  assert.equal(streak().days.at(-1)?.state, 'pending');
});

test('paused days bridge a streak without counting as successful days', () => {
  const result = streak({
    today: '2026-01-05',
    entries: [
      { date: '2026-01-02', kind: 'complete_override', value: null },
      { date: '2026-01-05', kind: 'complete_override', value: null },
    ],
    pauses: [{ start: '2026-01-03', end: '2026-01-05' }],
  });
  assert.equal(result.current, 2);
  assert.equal(result.totalCompleted, 2);
  assert.equal(result.days.find(({ date }) => date === '2026-01-03')?.state, 'paused');
});

test('bad-habit unknown days do not become clean and occurrences break the streak', () => {
  const result = streak({
    kind: 'bad',
    today: '2026-01-05',
    entries: [
      { date: '2026-01-03', kind: 'clean', value: null },
      { date: '2026-01-04', kind: 'occurrence', value: null },
    ],
  });
  assert.equal(result.days.find(({ date }) => date === '2026-01-05')?.state, 'pending');
  assert.equal(result.days.find(({ date }) => date === '2026-01-04')?.state, 'incident');
  assert.equal(result.days.find(({ date }) => date === '2026-01-02')?.state, 'unknown');
  assert.equal(result.current, 0);
});

test('repeated same-day bad occurrences create one incident day in derived history', () => {
  const result = streak({
    kind: 'bad',
    entries: [
      { date: '2026-01-04', kind: 'occurrence', value: null },
      { date: '2026-01-04', kind: 'occurrence', value: null },
    ],
  });
  assert.equal(result.days.filter(({ state }) => state === 'incident').length, 1);
});

test('historical targets keep old completions evaluated against their original target', () => {
  const result = streak({
    today: '2026-01-05',
    target: 180,
    targetHistory: [
      { value: 60, startDate: '2026-01-01', endDate: '2026-01-03' },
      { value: 180, startDate: '2026-01-04', endDate: null },
    ],
    entries: [{ date: '2026-01-02', kind: 'progress', value: 60 }],
  });
  assert.equal(result.days.find(({ date }) => date === '2026-01-02')?.state, 'completed');
});

test('changing habit type does not reinterpret earlier records', () => {
  const result = streak({
    kind: 'bad',
    today: '2026-01-05',
    targetHistory: [
      { value: 1, kind: 'good', startDate: '2026-01-01', endDate: '2026-01-03' },
      { value: 1, kind: 'bad', startDate: '2026-01-04', endDate: null },
    ],
    entries: [
      { date: '2026-01-02', kind: 'complete_override', value: null },
      { date: '2026-01-04', kind: 'occurrence', value: null },
    ],
  });
  assert.equal(result.days.find(({ date }) => date === '2026-01-02')?.state, 'completed');
  assert.equal(result.days.find(({ date }) => date === '2026-01-04')?.state, 'incident');
});

test('schedule edits preserve history while applying new weekdays forward', () => {
  const result = streak({
    today: '2026-01-05',
    scheduleHistory: [
      { ...schedule, weekdayMask: 127, startDate: '2026-01-01', endDate: '2026-01-03' },
      {
        ...schedule,
        weekdayMask: (1 << 1) | (1 << 2) | (1 << 3) | (1 << 4) | (1 << 5),
        startDate: '2026-01-04',
      },
    ],
    entries: [
      { date: '2026-01-02', kind: 'complete_override', value: null },
      { date: '2026-01-03', kind: 'complete_override', value: null },
    ],
  });
  assert.equal(result.days.find(({ date }) => date === '2026-01-03')?.state, 'completed');
  assert.equal(result.days.find(({ date }) => date === '2026-01-04')?.state, 'unscheduled');
  assert.equal(result.current, 2);
});

test('timezone and month-boundary date utilities are deterministic', () => {
  assert.equal(dateAdd('2026-01-31', 1), '2026-02-01');
  assert.equal(localDateAt(new Date('2026-01-01T01:00:00Z'), 'America/Los_Angeles'), '2025-12-31');
});
