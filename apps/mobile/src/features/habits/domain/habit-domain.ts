import { z } from 'zod';
import { measurementForHabit, toCanonical } from './activity-domain.ts';

export const habitSchema = z
  .object({
    name: z.string().trim().min(2, 'Use at least 2 characters.').max(80),
    kind: z.enum(['good', 'bad']),
    description: z.string().trim().max(500),
    icon: z.enum(['book', 'fitness', 'water', 'phone', 'money', 'sparkles']),
    color: z.enum(['indigo', 'emerald', 'amber', 'rose', 'sky', 'violet']),
    measurement: z.enum(['check_off', 'duration', 'count', 'quantity', 'distance', 'avoidance']),
    digitalUsage: z.boolean(),
    targetValue: z.string(),
    unit: z.string(),
    scheduleMode: z.enum(['anytime', 'fixed', 'flexible']),
    weekdays: z.array(z.number().int().min(0).max(6)).min(1, 'Choose at least one day.'),
    timezone: z.string().min(1),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a valid start date.'),
    endDate: z.string(),
    fixedTime: z.string(),
    windowStart: z.string(),
    windowEnd: z.string(),
  })
  .superRefine((value, context) => {
    const isDate = (input: string) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) return false;
      const parsed = new Date(`${input}T00:00:00Z`);
      return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === input;
    };
    const validTime = (input: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(input);
    const bad = value.kind === 'bad';
    if (value.digitalUsage && (!bad || !['duration', 'count'].includes(value.measurement)))
      context.addIssue({
        code: 'custom',
        path: ['measurement'],
        message: 'Digital usage limits must use duration or count measurements.',
      });
    if (bad && !value.digitalUsage && value.measurement !== 'avoidance')
      context.addIssue({
        code: 'custom',
        path: ['measurement'],
        message: 'Bad habits use avoidance tracking.',
      });
    if (!bad && value.measurement === 'avoidance')
      context.addIssue({
        code: 'custom',
        path: ['measurement'],
        message: 'Choose a good habit target.',
      });
    if (
      value.measurement !== 'check_off' &&
      (value.digitalUsage || value.measurement !== 'avoidance')
    ) {
      const amount = Number(value.targetValue);
      if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000)
        context.addIssue({
          code: 'custom',
          path: ['targetValue'],
          message: 'Enter a target greater than zero.',
        });
      else {
        try {
          toCanonical(amount, measurementForHabit(value.measurement, value.unit), value.unit);
        } catch (error) {
          context.addIssue({
            code: 'custom',
            path: ['targetValue'],
            message: error instanceof Error ? error.message : 'Choose a valid target and unit.',
          });
        }
      }
      if (value.unit.trim().length < 1 || value.unit.length > 24)
        context.addIssue({
          code: 'custom',
          path: ['unit'],
          message: 'Enter a unit (up to 24 characters).',
        });
    }
    if (!isDate(value.startDate))
      context.addIssue({
        code: 'custom',
        path: ['startDate'],
        message: 'Choose a valid start date.',
      });
    if (value.endDate && (!isDate(value.endDate) || value.endDate < value.startDate))
      context.addIssue({
        code: 'custom',
        path: ['endDate'],
        message: 'End date must be on or after the start date.',
      });
    if (value.scheduleMode === 'fixed' && !validTime(value.fixedTime))
      context.addIssue({
        code: 'custom',
        path: ['fixedTime'],
        message: 'Choose a valid planned time.',
      });
    if (
      value.scheduleMode === 'flexible' &&
      (!validTime(value.windowStart) ||
        !validTime(value.windowEnd) ||
        value.windowEnd <= value.windowStart)
    )
      context.addIssue({
        code: 'custom',
        path: ['windowEnd'],
        message: 'End time must be later than the start time.',
      });
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: value.timezone }).format(new Date());
    } catch {
      context.addIssue({
        code: 'custom',
        path: ['timezone'],
        message: 'Choose a valid time zone.',
      });
    }
  });
export type HabitInput = z.infer<typeof habitSchema>;
export type HabitKind = 'good' | 'bad';
export type DayState =
  | 'completed'
  | 'partial'
  | 'missed'
  | 'skipped'
  | 'incident'
  | 'clean'
  | 'pending'
  | 'unknown'
  | 'paused'
  | 'unscheduled';
export type StreakDay = { date: string; state: DayState; progress: number; target: number };
export type StreakSummary = {
  current: number;
  longest: number;
  totalCompleted: number;
  completionPercent: number;
  days: StreakDay[];
};

export function localDateAt(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function todayInTimezone(timezone: string): string {
  return localDateAt(new Date(), timezone);
}
export function dateAdd(day: string, offset: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}
export function weekdayFor(day: string): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}

export function calculateStreak(input: {
  kind: HabitKind;
  schedule: {
    weekdayMask: number;
    startDate: string;
    endDate: string | null;
    mode: 'anytime' | 'fixed' | 'flexible';
    windowEnd: string | null;
  };
  scheduleHistory?: Array<{
    weekdayMask: number;
    startDate: string;
    endDate: string | null;
    mode: 'anytime' | 'fixed' | 'flexible';
    windowEnd: string | null;
  }>;
  targetHistory?: Array<{
    value: number;
    kind?: HabitKind;
    startDate: string;
    endDate: string | null;
  }>;
  target: number;
  today: string;
  deadlinePassedToday?: boolean;
  entries: Array<{ date: string; kind: string; value: number | null }>;
  pauses: Array<{ start: string; end: string | null }>;
  rangeStart?: string;
}): StreakSummary {
  const beginning = input.rangeStart ?? dateAdd(input.today, -119);
  const byDay = new Map<
    string,
    {
      progress: number;
      incident: boolean;
      clean: boolean;
      skipped: boolean;
      completeOverride: boolean;
    }
  >();
  for (const entry of input.entries) {
    const item = byDay.get(entry.date) ?? {
      progress: 0,
      incident: false,
      clean: false,
      skipped: false,
      completeOverride: false,
    };
    if (entry.kind === 'progress') item.progress += entry.value ?? 0;
    if (entry.kind === 'occurrence') item.incident = true;
    if (entry.kind === 'clean') item.clean = true;
    if (entry.kind === 'skip') item.skipped = true;
    if (entry.kind === 'complete_override') item.completeOverride = true;
    byDay.set(entry.date, item);
  }
  const days: StreakDay[] = [];
  for (let date = beginning; date <= input.today; date = dateAdd(date, 1)) {
    const schedule =
      input.scheduleHistory?.find(
        (item) => date >= item.startDate && (!item.endDate || date <= item.endDate),
      ) ?? input.schedule;
    const target =
      input.targetHistory?.find(
        (item) => date >= item.startDate && (!item.endDate || date <= item.endDate),
      )?.value ?? input.target;
    const dayKind =
      input.targetHistory?.find(
        (item) => date >= item.startDate && (!item.endDate || date <= item.endDate),
      )?.kind ?? input.kind;
    const scheduled =
      date >= schedule.startDate &&
      (!schedule.endDate || date <= schedule.endDate) &&
      (schedule.weekdayMask & (1 << weekdayFor(date))) !== 0;
    const pause = input.pauses.some(({ start, end }) => date >= start && (!end || date < end));
    const entry = byDay.get(date);
    let state: DayState = 'unscheduled';
    let progress = entry?.progress ?? 0;
    if (scheduled) {
      if (pause) state = 'paused';
      else if (entry?.skipped) state = 'skipped';
      else if (dayKind === 'bad')
        state = entry?.incident
          ? 'incident'
          : entry?.clean
            ? 'clean'
            : date === input.today && !input.deadlinePassedToday
              ? 'pending'
              : 'unknown';
      else if (entry?.completeOverride || progress >= target) state = 'completed';
      else if (progress > 0) state = 'partial';
      else if (date === input.today && !input.deadlinePassedToday) state = 'pending';
      else if (date === input.today) state = 'missed';
      else state = 'missed';
      if (dayKind === 'bad' && entry?.incident) progress = 0;
    }
    days.push({ date, state, progress, target });
  }
  let longest = 0;
  let run = 0;
  for (const day of days) {
    if (day.state === 'completed' || day.state === 'clean') run += 1;
    else if (day.state !== 'unscheduled' && day.state !== 'paused') {
      longest = Math.max(longest, run);
      run = 0;
    }
  }
  longest = Math.max(longest, run);
  let current = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    const state = days[i]!.state;
    if (state === 'unscheduled' || state === 'paused') continue;
    if (state === 'pending') continue;
    if (state === 'completed' || state === 'clean') current += 1;
    else break;
  }
  const considered = days.filter(
    ({ state }) => !['unscheduled', 'paused', 'pending', 'unknown'].includes(state),
  );
  const completed = considered.filter(
    ({ state }) => state === 'completed' || state === 'clean',
  ).length;
  return {
    current,
    longest,
    totalCompleted: completed,
    completionPercent: considered.length ? Math.round((completed * 100) / considered.length) : 0,
    days,
  };
}
