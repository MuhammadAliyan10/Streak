import { z } from 'zod';

const validDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};
const validTime = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

export const taskSchema = z
  .object({
    title: z.string().trim().min(2, 'Use at least 2 characters.').max(100),
    description: z.string().trim().max(1000),
    priority: z.enum(['low', 'normal', 'high']),
    plannedDate: z.string().refine(validDate, 'Choose a valid date.'),
    plannedTime: z.string(),
    estimatedMinutes: z.string(),
    timezone: z.string().min(1),
  })
  .superRefine((value, context) => {
    if (value.plannedTime && !validTime(value.plannedTime)) {
      context.addIssue({ code: 'custom', path: ['plannedTime'], message: 'Choose a valid time.' });
    }
    if (value.estimatedMinutes) {
      const minutes = Number(value.estimatedMinutes);
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
        context.addIssue({
          code: 'custom',
          path: ['estimatedMinutes'],
          message: 'Enter 1 to 1440 minutes.',
        });
      }
    }
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

export type TaskInput = z.infer<typeof taskSchema>;
export type TaskPriority = 'low' | 'normal' | 'high';
export type TaskStatus = 'pending' | 'completed' | 'cancelled';
export type TimelineItem = {
  id: string;
  title: string;
  detail: string;
  time: string | null;
  kind: 'planned' | 'actual' | 'change';
  status: 'pending' | 'completed' | 'missed' | 'cancelled' | 'recorded';
};

export function localTimeAt(timestamp: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(timestamp));
}

export function formatPlannerDate(localDate: string, timezone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: timezone,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(`${localDate}T12:00:00Z`));
}

export function sortTimeline(items: readonly TimelineItem[]): TimelineItem[] {
  const kindOrder = { planned: 0, actual: 1, change: 2 } as const;
  return [...items].sort((a, b) => {
    const timeA = a.time ?? '99:99';
    const timeB = b.time ?? '99:99';
    return (
      timeA.localeCompare(timeB) ||
      kindOrder[a.kind] - kindOrder[b.kind] ||
      a.id.localeCompare(b.id)
    );
  });
}

export function dayCounts<T extends { status: TaskStatus }>(tasks: readonly T[]) {
  return {
    pending: tasks.filter((task) => task.status === 'pending').length,
    completed: tasks.filter((task) => task.status === 'completed').length,
    cancelled: tasks.filter((task) => task.status === 'cancelled').length,
  };
}
