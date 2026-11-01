import { z } from 'zod';
import {
  measurementKinds,
  toCanonical,
  type MeasurementKind,
} from '../habits/domain/activity-domain.ts';

export const goalSchema = z
  .object({
    title: z.string().trim().min(2, 'Use at least 2 characters.').max(80),
    description: z.string().trim().max(500),
    category: z.enum(['health', 'learning', 'fitness', 'work', 'finance', 'personal', 'other']),
    periodType: z.enum(['daily', 'weekly', 'monthly', 'yearly', 'custom']),
    model: z.enum(['cumulative', 'recurring']),
    recurrence: z.enum(['daily', 'weekly', 'monthly', 'yearly', '']),
    measurement: z.enum([...measurementKinds, 'days']),
    targetValue: z
      .string()
      .trim()
      .regex(/^\d+(\.\d{1,4})?$/, 'Enter a valid target.'),
    unit: z.string().trim().min(1).max(24),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    weekdays: z.array(z.number().int().min(0).max(6)).min(1),
    timezone: z.string().min(1),
    habitIds: z.array(z.string()),
  })
  .superRefine((value, context) => {
    const target = Number(value.targetValue);
    if (!Number.isFinite(target) || target <= 0 || target > 1_000_000_000) {
      context.addIssue({
        code: 'custom',
        path: ['targetValue'],
        message: 'Target must be a positive amount.',
      });
    }
    if (value.measurement === 'days' && !Number.isInteger(target)) {
      context.addIssue({
        code: 'custom',
        path: ['targetValue'],
        message: 'Days must be a whole number.',
      });
    }
    if (value.endDate < value.startDate) {
      context.addIssue({
        code: 'custom',
        path: ['endDate'],
        message: 'End date must be on or after the start date.',
      });
    }
    if (value.model === 'recurring' && !value.recurrence) {
      context.addIssue({
        code: 'custom',
        path: ['recurrence'],
        message: 'Choose how often this goal repeats.',
      });
    }
    if (value.model === 'cumulative' && value.recurrence) {
      context.addIssue({
        code: 'custom',
        path: ['recurrence'],
        message: 'Cumulative goals do not use a recurrence.',
      });
    }
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: value.timezone }).format(new Date());
      const date = new Date(`${value.startDate}T00:00:00Z`);
      if (date.toISOString().slice(0, 10) !== value.startDate) throw new Error('invalid date');
      const end = new Date(`${value.endDate}T00:00:00Z`);
      if (end.toISOString().slice(0, 10) !== value.endDate) throw new Error('invalid date');
    } catch {
      context.addIssue({
        code: 'custom',
        path: ['startDate'],
        message: 'Choose valid dates and a valid time zone.',
      });
    }
    if (value.measurement !== 'days') {
      try {
        toCanonical(target, value.measurement as MeasurementKind, value.unit);
      } catch (error) {
        context.addIssue({
          code: 'custom',
          path: ['unit'],
          message: error instanceof Error ? error.message : 'Choose a supported unit.',
        });
      }
    }
  });
export type GoalInput = z.infer<typeof goalSchema>;

export const goalProgressInputSchema = z.object({
  amount: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,4})?$/, 'Enter a valid amount.'),
  localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().trim().max(280),
});

export type GoalSnapshot = {
  targetValue: number;
  measurement: string;
  unit: string;
  recurrence: string | null;
  weekdayMask: number;
  effectiveFrom: string;
};
export type GoalProgressLog = {
  id: string;
  value: number | null;
  unit: string | null;
  localDate: string;
};
export type GoalPause = { startedOn: string; resumedOn: string | null };
export type GoalBucket = {
  startDate: string;
  endDate: string;
  target: number;
  actual: number;
  achieved: boolean;
  scheduled: boolean;
};
export type GoalProgress = {
  totalValue: number;
  targetValue: number;
  progressPercent: number;
  achievedPeriods: number;
  elapsedPeriods: number;
  missedPeriods: number;
  scheduledPeriods: number;
  daysRemaining: number;
  achieved: boolean;
  buckets: GoalBucket[];
};

function addDays(date: string, count: number) {
  const [year, month, day] = date.split('-').map(Number);
  const next = new Date(Date.UTC(year!, month! - 1, day! + count));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
}
export function pauseDurationDays(startedOn: string, resumedOn: string): number {
  const elapsed = Math.floor(
    (Date.parse(`${resumedOn}T00:00:00Z`) - Date.parse(`${startedOn}T00:00:00Z`)) / 86_400_000,
  );
  return Number.isFinite(elapsed) ? Math.max(1, elapsed) : 1;
}
export function pausedThroughDate(startedOn: string, resumedOn: string): string {
  const elapsed = Date.parse(`${resumedOn}T00:00:00Z`) - Date.parse(`${startedOn}T00:00:00Z`);
  return elapsed > 0 ? addDays(resumedOn, -1) : resumedOn;
}
function firstOfNextMonth(date: string) {
  const [year, month] = date.split('-').map(Number);
  const next = new Date(Date.UTC(year!, month!, 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-01`;
}
function firstOfNextYear(date: string) {
  return `${Number(date.slice(0, 4)) + 1}-01-01`;
}
function mondayOf(date: string) {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, -((weekday + 6) % 7));
}
function nextBucketStart(date: string, recurrence: string) {
  if (recurrence === 'daily') return addDays(date, 1);
  if (recurrence === 'weekly') {
    const monday = mondayOf(date);
    return addDays(monday, 7);
  }
  if (recurrence === 'monthly') return firstOfNextMonth(date);
  return firstOfNextYear(date);
}
function weekdayOf(date: string) {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}
function bucketSnapshot(
  date: string,
  versions: readonly GoalSnapshot[],
  fallback: number,
): GoalSnapshot {
  return (
    [...versions]
      .filter((version) => version.effectiveFrom <= date)
      .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))
      .at(-1) ?? {
      targetValue: fallback,
      measurement: '',
      unit: '',
      recurrence: null,
      weekdayMask: 127,
      effectiveFrom: date,
    }
  );
}

export function nextGoalVersionDate(today: string, recurrence: string): string {
  return nextBucketStart(today, recurrence);
}

export function calculateGoalProgress(input: {
  startDate: string;
  endDate: string;
  today: string;
  model: 'cumulative' | 'recurring';
  recurrence: string | null;
  measurement: string;
  targetValue: number;
  weekdayMask: number;
  versions?: readonly GoalSnapshot[];
  logs: readonly GoalProgressLog[];
  pauses?: readonly GoalPause[];
}): GoalProgress {
  const sumLogs = (start: string, end: string) => {
    const periodLogs = [...new Map(input.logs.map((log) => [log.id, log])).values()].filter(
      (log) => log.localDate >= start && log.localDate <= end,
    );
    if (input.measurement === 'days') {
      return new Set(periodLogs.map((log) => log.localDate)).size;
    }
    return periodLogs.reduce((total, log) => total + (log.value ?? 0), 0);
  };
  const isPaused = (date: string) =>
    (input.pauses ?? []).some(
      (pause) => pause.startedOn <= date && (!pause.resumedOn || pause.resumedOn >= date),
    );
  const totalValue = sumLogs(input.startDate, input.endDate);
  const today =
    input.today < input.startDate
      ? input.startDate
      : input.today > input.endDate
        ? input.endDate
        : input.today;
  const dayDiff = Math.max(
    0,
    Math.floor(
      (Date.parse(`${input.endDate}T00:00:00Z`) - Date.parse(`${input.today}T00:00:00Z`)) /
        86_400_000,
    ),
  );
  if (input.model === 'cumulative') {
    const targetValue = input.targetValue;
    const progressPercent = Math.min(100, Math.round((totalValue / targetValue) * 100));
    return {
      totalValue,
      targetValue,
      progressPercent,
      achievedPeriods: totalValue >= targetValue ? 1 : 0,
      elapsedPeriods: 1,
      missedPeriods: input.today > input.endDate && totalValue < targetValue ? 1 : 0,
      scheduledPeriods: 1,
      daysRemaining: dayDiff,
      achieved: totalValue >= targetValue,
      buckets: [
        {
          startDate: input.startDate,
          endDate: input.endDate,
          target: targetValue,
          actual: totalValue,
          achieved: totalValue >= targetValue,
          scheduled: true,
        },
      ],
    };
  }
  const recurrence = input.recurrence ?? 'daily';
  const versions = input.versions ?? [];
  const buckets: GoalBucket[] = [];
  let cursor = input.startDate;
  while (cursor <= input.endDate) {
    const boundary = nextBucketStart(cursor, recurrence);
    const bucketEnd = addDays(boundary, -1) < input.endDate ? addDays(boundary, -1) : input.endDate;
    const snapshot = bucketSnapshot(cursor, versions, input.targetValue);
    let unpausedScheduledDay = false;
    for (let date = cursor; date <= bucketEnd; date = addDays(date, 1)) {
      if (
        !isPaused(date) &&
        (recurrence !== 'daily' || (snapshot.weekdayMask & (1 << weekdayOf(date))) !== 0)
      ) {
        unpausedScheduledDay = true;
        break;
      }
    }
    const scheduled = unpausedScheduledDay;
    const actual = sumLogs(cursor, bucketEnd);
    const target = snapshot.targetValue;
    buckets.push({
      startDate: cursor,
      endDate: bucketEnd,
      target,
      actual,
      achieved: scheduled && actual >= target,
      scheduled,
    });
    cursor = boundary;
  }
  const elapsed = buckets.filter((bucket) => bucket.startDate <= today);
  const scheduled = elapsed.filter((bucket) => bucket.scheduled);
  const achievedPeriods = scheduled.filter((bucket) => bucket.achieved).length;
  const missedPeriods = scheduled.filter(
    (bucket) => bucket.endDate < input.today && !bucket.achieved,
  ).length;
  const progressPercent = scheduled.length
    ? Math.round((achievedPeriods / scheduled.length) * 100)
    : 0;
  const achieved =
    input.today > input.endDate && scheduled.length > 0 && achievedPeriods === scheduled.length;
  return {
    totalValue,
    targetValue: input.targetValue,
    progressPercent,
    achievedPeriods,
    elapsedPeriods: scheduled.length,
    missedPeriods,
    scheduledPeriods: buckets.filter((bucket) => bucket.scheduled).length,
    daysRemaining: dayDiff,
    achieved,
    buckets,
  };
}
