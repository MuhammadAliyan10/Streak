import { dateAdd } from '../habits/domain/habit-domain.ts';
import { z } from 'zod';

export type InsightPreset = 'today' | '7d' | '30d' | 'custom';
export type HabitDayState =
  | 'completed'
  | 'clean'
  | 'missed'
  | 'incident'
  | 'partial'
  | 'skipped'
  | 'pending'
  | 'unknown'
  | 'paused'
  | 'unscheduled';
export type HabitAnalyticsDay = {
  date: string;
  state: HabitDayState;
  progress: number;
  target: number;
};

export function insightDateRange(
  preset: Exclude<InsightPreset, 'custom'>,
  today: string,
): { startDate: string; endDate: string } {
  const days = preset === 'today' ? 1 : preset === '7d' ? 7 : 30;
  return { startDate: dateAdd(today, 1 - days), endDate: today };
}

const insightRangeSchema = z
  .object({
    startDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine((date) => isCalendarDate(date)),
    endDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine((date) => isCalendarDate(date)),
  })
  .superRefine(({ startDate, endDate }, context) => {
    if (startDate > endDate)
      context.addIssue({
        code: 'custom',
        path: ['endDate'],
        message: 'End date must not be before start date.',
      });
    else if (dateDiff(startDate, endDate) >= 90)
      context.addIssue({
        code: 'custom',
        path: ['endDate'],
        message: 'Choose a range shorter than 90 days.',
      });
  });

export function validateInsightRange(startDate: string, endDate: string): boolean {
  return insightRangeSchema.safeParse({ startDate, endDate }).success;
}

export function calculateHabitConsistency(days: readonly HabitAnalyticsDay[], today: string) {
  const eligible = days.filter(
    ({ date, state }) =>
      date !== today && !['unscheduled', 'paused', 'pending', 'unknown'].includes(state),
  );
  const completed = eligible.filter(
    ({ state }) => state === 'completed' || state === 'clean',
  ).length;
  return {
    completed,
    eligible: eligible.length,
    percent: eligible.length ? Math.round((completed * 100) / eligible.length) : null,
  };
}

export function aggregateSecondsByDate(
  entries: readonly { localDate: string; seconds: number }[],
): Array<{ date: string; seconds: number }> {
  const totals = new Map<string, number>();
  for (const item of entries) {
    if (!Number.isFinite(item.seconds) || item.seconds < 0) continue;
    totals.set(item.localDate, (totals.get(item.localDate) ?? 0) + Math.floor(item.seconds));
  }
  return [...totals]
    .map(([date, seconds]) => ({ date, seconds }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function compareEquivalentPeriods(current: number, previous: number, complete: boolean) {
  if (!complete || !Number.isFinite(current) || !Number.isFinite(previous) || previous === 0)
    return null;
  return Math.round(((current - previous) / previous) * 100);
}

function dateDiff(start: string, end: string) {
  return Math.round(
    (new Date(`${end}T00:00:00Z`).getTime() - new Date(`${start}T00:00:00Z`).getTime()) /
      86_400_000,
  );
}

function isCalendarDate(date: string) {
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}
