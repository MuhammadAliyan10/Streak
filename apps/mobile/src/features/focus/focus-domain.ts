import { z } from 'zod';
import { localDateAt } from '../habits/domain/habit-domain.ts';
import { timestampFromLocal } from '../habits/domain/activity-domain.ts';

export const focusSetupSchema = z
  .object({
    title: z.string().trim().min(2, 'Use at least 2 characters.').max(80),
    mode: z.enum(['stopwatch', 'countdown']),
    targetMinutes: z.string().trim(),
    habitId: z.string(),
    taskId: z.string(),
    note: z.string().trim().max(280, 'Keep notes under 280 characters.'),
    timezone: z.string().min(1),
  })
  .superRefine((value, context) => {
    if (value.mode === 'countdown') {
      const minutes = Number(value.targetMinutes);
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
        context.addIssue({
          code: 'custom',
          path: ['targetMinutes'],
          message: 'Choose a duration from 1 minute to 24 hours.',
        });
      }
    }
    if (value.habitId && value.taskId) {
      context.addIssue({
        code: 'custom',
        path: ['taskId'],
        message: 'Link a session to one habit or one task.',
      });
    }
  });
export type FocusSetup = z.infer<typeof focusSetupSchema>;

export const creditedDurationSchema = z.object({
  minutes: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,3})?$/, 'Enter minutes as a number.')
    .refine((value) => Number(value) >= 0.01 && Number(value) <= 10080, 'Use 0.01–10,080 minutes.'),
});

export type ActiveInterval = { startedAt: string; endedAt: string };
export type DayAllocation = { localDate: string; seconds: number; startedAt: string };

export function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':');
}

export function elapsedFromMonotonic(baseMilliseconds: number, startedAt: number, now: number) {
  return Math.max(0, Math.floor(baseMilliseconds + now - startedAt));
}

export function remainingCountdown(targetSeconds: number, activeMilliseconds: number): number {
  return Math.max(0, targetSeconds - Math.floor(activeMilliseconds / 1000));
}

function addLocalDays(date: string, count: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const next = new Date(Date.UTC(year!, month! - 1, day! + count));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
}

export function allocateIntervalsByLocalDate(
  intervals: readonly ActiveInterval[],
  timezone: string,
): DayAllocation[] {
  const byDate = new Map<string, { seconds: number; startedAt: string }>();
  for (const interval of intervals) {
    let cursor = new Date(interval.startedAt).getTime();
    const end = new Date(interval.endedAt).getTime();
    if (!Number.isFinite(cursor) || !Number.isFinite(end) || end <= cursor) continue;
    while (cursor < end) {
      const localDate = localDateAt(new Date(cursor), timezone);
      const nextMidnight = new Date(
        timestampFromLocal(addLocalDays(localDate, 1), '00:00', timezone),
      ).getTime();
      const segmentEnd = Math.min(end, nextMidnight > cursor ? nextMidnight : end);
      const seconds = Math.floor((segmentEnd - cursor) / 1000);
      if (seconds > 0) {
        const existing = byDate.get(localDate);
        byDate.set(localDate, {
          seconds: (existing?.seconds ?? 0) + seconds,
          startedAt: existing?.startedAt ?? new Date(cursor).toISOString(),
        });
      }
      cursor = segmentEnd;
    }
  }
  return [...byDate.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([localDate, value]) => ({ localDate, ...value }));
}
