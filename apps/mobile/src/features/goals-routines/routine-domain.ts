import { z } from 'zod';
import { measurementKinds } from '../habits/domain/activity-domain.ts';

const optionalTime = z
  .string()
  .refine((value) => !value || /^([01]\d|2[0-3]):[0-5]\d$/.test(value), 'Use 24-hour time.');
export const routineStepSchema = z
  .object({
    title: z.string().trim().min(2, 'Name the step.').max(80),
    kind: z.enum(['checklist', 'habit', 'task', 'timer', 'quick_measurement']),
    habitId: z.string(),
    taskId: z.string(),
    targetMinutes: z.string(),
    measurement: z.string(),
    value: z.string(),
    unit: z.string(),
    category: z.string(),
    presetId: z.string(),
    note: z.string().trim().max(280),
    skippable: z.boolean(),
  })
  .superRefine((step, context) => {
    if (step.kind === 'habit' && !step.habitId)
      context.addIssue({ code: 'custom', path: ['habitId'], message: 'Choose a habit.' });
    if (step.kind === 'task' && !step.taskId)
      context.addIssue({ code: 'custom', path: ['taskId'], message: 'Choose a task.' });
    if (step.kind === 'timer') {
      const minutes = Number(step.targetMinutes);
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440)
        context.addIssue({
          code: 'custom',
          path: ['targetMinutes'],
          message: 'Choose a timer duration from 1 to 1,440 minutes.',
        });
    }
    if (step.kind === 'quick_measurement' || (step.kind === 'habit' && step.measurement)) {
      if (!measurementKinds.includes(step.measurement as (typeof measurementKinds)[number])) {
        context.addIssue({
          code: 'custom',
          path: ['measurement'],
          message: 'Choose a supported measurement type.',
        });
      }
      if (!/^\d+(\.\d{1,4})?$/.test(step.value) || Number(step.value) <= 0)
        context.addIssue({
          code: 'custom',
          path: ['value'],
          message: 'Enter a positive measurement amount.',
        });
      if (!step.unit.trim())
        context.addIssue({ code: 'custom', path: ['unit'], message: 'Choose a unit.' });
    }
  });
export type RoutineStepInput = z.infer<typeof routineStepSchema>;
export const routineSchema = z
  .object({
    name: z.string().trim().min(2, 'Use at least 2 characters.').max(80),
    description: z.string().trim().max(500),
    icon: z.string().min(1).max(32),
    color: z.string().min(1).max(24),
    startTime: optionalTime,
    windowStart: optionalTime,
    windowEnd: optionalTime,
    weekdays: z.array(z.number().int().min(0).max(6)).min(1, 'Choose at least one day.'),
    estimatedMinutes: z.string(),
    timezone: z.string().min(1),
    steps: z.array(routineStepSchema).min(1, 'Add at least one step.'),
  })
  .superRefine((value, context) => {
    if (value.windowStart && value.windowEnd && value.windowEnd <= value.windowStart) {
      context.addIssue({
        code: 'custom',
        path: ['windowEnd'],
        message: 'Window end must be later than its start.',
      });
    }
    if (
      value.estimatedMinutes &&
      (!Number.isInteger(Number(value.estimatedMinutes)) ||
        Number(value.estimatedMinutes) < 1 ||
        Number(value.estimatedMinutes) > 1440)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['estimatedMinutes'],
        message: 'Estimated time must be 1–1,440 minutes.',
      });
    }
    if (value.steps.some((step) => step.habitId && step.taskId)) {
      context.addIssue({
        code: 'custom',
        path: ['steps'],
        message: 'Each step can link to one item.',
      });
    }
  });
export type RoutineInput = z.infer<typeof routineSchema>;

export type RoutineStepState = 'pending' | 'in_progress' | 'completed' | 'skipped';
export type RoutineRunProgress = {
  complete: number;
  skipped: number;
  pending: number;
  percent: number;
  canFinish: boolean;
};
export function routineRunProgress(states: readonly RoutineStepState[]): RoutineRunProgress {
  const complete = states.filter((state) => state === 'completed').length;
  const skipped = states.filter((state) => state === 'skipped').length;
  const pending = states.length - complete - skipped;
  return {
    complete,
    skipped,
    pending,
    percent: states.length ? Math.round(((complete + skipped) / states.length) * 100) : 0,
    canFinish: states.length > 0 && pending === 0,
  };
}
