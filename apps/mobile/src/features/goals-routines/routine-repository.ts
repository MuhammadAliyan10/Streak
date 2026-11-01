import type * as SQLite from 'expo-sqlite';
import { enqueueLocalOperation, initializeLocalDatabase } from '../../services/local-database';
import {
  createActivityLog,
  getHabitForDate,
  getPresetsForHabits,
  listHabits,
} from '../habits/habit-repository';
import { measurementForHabit, type MeasurementKind } from '../habits/domain/activity-domain';
import { localDateAt, todayInTimezone } from '../habits/domain/habit-domain';
import { reconcileReminders } from '../notifications/notification-service';
import { applyTaskAction, getTask } from '../planner/planner-repository';
import {
  routineSchema,
  routineRunProgress,
  type RoutineInput,
  type RoutineStepInput,
  type RoutineStepState,
} from './routine-domain';

export type RoutineStep = RoutineStepInput & { id: string; order: number };
export type RoutineRecord = {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  startTime: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  weekdays: number[];
  estimatedMinutes: number | null;
  timezone: string;
  steps: RoutineStep[];
  activeRunId: string | null;
};
export type RoutineRunStep = RoutineStep & {
  runStepId: string;
  status: RoutineStepState;
  startedAt: string | null;
  completedAt: string | null;
  linkedActivityId: string | null;
  linkedSessionId: string | null;
};
export type RoutineRun = {
  id: string;
  routineId: string;
  routineName: string;
  status: 'active' | 'paused' | 'completed' | 'abandoned';
  startedAt: string;
  finishedAt: string | null;
  localDate: string;
  timezone: string;
  steps: RoutineRunStep[];
  progress: ReturnType<typeof routineRunProgress>;
};
const id = (prefix: string) =>
  `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
async function db() {
  return initializeLocalDatabase();
}
function mask(days: number[]) {
  return days.reduce((result, day) => result | (1 << day), 0);
}
function mapStep(row: Record<string, unknown>, run = false): RoutineStep | RoutineRunStep {
  const step: RoutineStep = {
    id: String(run ? (row.template_step_id ?? row.id) : row.id),
    order: Number(row.order_index),
    title: String(row.title),
    kind: row.kind as RoutineStepInput['kind'],
    habitId: String(row.habit_id ?? ''),
    taskId: String(row.task_id ?? ''),
    targetMinutes: row.target_seconds == null ? '' : String(Number(row.target_seconds) / 60),
    measurement: String(row.measurement ?? ''),
    value: row.value == null ? '' : String(row.value),
    unit: String(row.unit ?? ''),
    category: String(row.category ?? 'other'),
    presetId: String(row.preset_id ?? ''),
    note: String(row.note ?? ''),
    skippable: !!Number(row.skippable),
  };
  if (!run) return step;
  return {
    ...step,
    runStepId: String(row.id),
    status: row.status as RoutineStepState,
    startedAt: row.started_at as string | null,
    completedAt: row.completed_at as string | null,
    linkedActivityId: row.linked_activity_id as string | null,
    linkedSessionId: row.linked_session_id as string | null,
  };
}
async function loadRoutine(
  database: SQLite.SQLiteDatabase,
  routineId: string,
): Promise<RoutineRecord | null> {
  const row = await database.getFirstAsync<Record<string, unknown>>(
    'SELECT * FROM routines WHERE id=? AND deleted_at IS NULL',
    routineId,
  );
  if (!row) return null;
  const steps = await database.getAllAsync<Record<string, unknown>>(
    'SELECT * FROM routine_steps WHERE routine_id=? ORDER BY order_index',
    routineId,
  );
  const run = await database.getFirstAsync<{ id: string }>(
    "SELECT id FROM routine_runs WHERE routine_id=? AND status IN ('active','paused') ORDER BY started_at DESC LIMIT 1",
    routineId,
  );
  const weekdayMask = Number(row.weekday_mask);
  return {
    id: String(row.id),
    name: String(row.name),
    description: String(row.description),
    icon: String(row.icon),
    color: String(row.color),
    startTime: row.start_time as string | null,
    windowStart: row.window_start as string | null,
    windowEnd: row.window_end as string | null,
    weekdays: Array.from({ length: 7 }, (_, day) => day).filter((day) => weekdayMask & (1 << day)),
    estimatedMinutes: row.estimated_minutes == null ? null : Number(row.estimated_minutes),
    timezone: String(row.timezone),
    steps: steps.map((step) => mapStep(step) as RoutineStep),
    activeRunId: run?.id ?? null,
  };
}
export async function getRoutinesForDate(localDate: string): Promise<RoutineRecord[]> {
  const database = await db();
  const rows = await database.getAllAsync<{ id: string }>(
    "SELECT id FROM routines WHERE status='active' AND deleted_at IS NULL AND (weekday_mask & (1 << CAST(strftime('%w',?) AS INTEGER))) != 0 ORDER BY start_time,name LIMIT 50",
    localDate,
  );
  const routines = await Promise.all(rows.map((row) => loadRoutine(database, row.id)));
  return routines.filter((routine): routine is RoutineRecord => routine !== null);
}
export async function getRoutines(): Promise<RoutineRecord[]> {
  const database = await db();
  const rows = await database.getAllAsync<{ id: string }>(
    "SELECT id FROM routines WHERE status='active' AND deleted_at IS NULL ORDER BY name LIMIT 100",
  );
  return (await Promise.all(rows.map((row) => loadRoutine(database, row.id)))).filter(
    (routine): routine is RoutineRecord => routine !== null,
  );
}
export async function getRoutine(routineId: string): Promise<RoutineRecord | null> {
  return loadRoutine(await db(), routineId);
}
export async function saveRoutine(raw: RoutineInput, routineId?: string): Promise<string> {
  const input = routineSchema.parse(raw);
  const database = await db();
  const habits = await listHabits('all', true);
  const tasks = new Map<string, Awaited<ReturnType<typeof getTask>>>();
  for (const step of input.steps) {
    if (step.kind === 'habit') {
      const habit = habits.find((item) => item.id === step.habitId && item.status !== 'archived');
      if (!habit) throw new Error('Choose an available habit for each habit step.');
      if (
        step.measurement &&
        measurementForHabit(habit.measurement, habit.unit) !== step.measurement
      )
        throw new Error(`${habit.name} uses a different measurement.`);
    }
    if (step.kind === 'task') {
      const task = await getTask(step.taskId);
      if (!task) throw new Error('Choose an available task for each task step.');
      tasks.set(step.taskId, task);
    }
    if (step.kind === 'quick_measurement' && step.presetId) {
      const preset = (await getPresetsForHabits([step.habitId])).find(
        (item) => item.id === step.presetId,
      );
      if (!preset) throw new Error('Choose an available quick-log preset.');
      const habit = habits.find((item) => item.id === step.habitId);
      if (!habit || measurementForHabit(habit.measurement, habit.unit) !== preset.measurement)
        throw new Error('This quick-log preset no longer matches its habit measurement.');
    }
  }
  const now = new Date().toISOString();
  const key = routineId ?? id('routine');
  await database.withTransactionAsync(async () => {
    if (routineId) {
      const existing = await database.getFirstAsync<{ id: string }>(
        'SELECT id FROM routines WHERE id=? AND deleted_at IS NULL',
        routineId,
      );
      if (!existing) throw new Error('This routine is no longer available.');
      await database.runAsync(
        'UPDATE routines SET name=?,description=?,icon=?,color=?,start_time=?,window_start=?,window_end=?,weekday_mask=?,estimated_minutes=?,timezone=?,updated_at=? WHERE id=?',
        input.name.trim(),
        input.description.trim(),
        input.icon,
        input.color,
        input.startTime || null,
        input.windowStart || null,
        input.windowEnd || null,
        mask(input.weekdays),
        input.estimatedMinutes ? Number(input.estimatedMinutes) : null,
        input.timezone,
        now,
        routineId,
      );
      await database.runAsync('DELETE FROM routine_steps WHERE routine_id=?', routineId);
    } else {
      await database.runAsync(
        'INSERT INTO routines(id,name,description,icon,color,start_time,window_start,window_end,weekday_mask,estimated_minutes,timezone,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
        key,
        input.name.trim(),
        input.description.trim(),
        input.icon,
        input.color,
        input.startTime || null,
        input.windowStart || null,
        input.windowEnd || null,
        mask(input.weekdays),
        input.estimatedMinutes ? Number(input.estimatedMinutes) : null,
        input.timezone,
        now,
        now,
      );
    }
    for (const [index, step] of input.steps.entries()) {
      await database.runAsync(
        'INSERT INTO routine_steps(id,routine_id,order_index,title,kind,habit_id,task_id,target_seconds,measurement,value,unit,category,preset_id,note,skippable,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        id('routine-step'),
        key,
        index,
        step.title.trim(),
        step.kind,
        step.kind === 'habit' || (step.kind === 'quick_measurement' && step.presetId)
          ? step.habitId
          : null,
        step.kind === 'task' ? step.taskId : null,
        step.targetMinutes ? Number(step.targetMinutes) * 60 : null,
        step.measurement || null,
        step.value ? Number(step.value) : null,
        step.unit || null,
        step.category,
        step.presetId || null,
        step.note.trim(),
        step.skippable ? 1 : 0,
        now,
      );
    }
    await enqueueLocalOperation(database, 'routine', {
      action: routineId ? 'update' : 'create',
      routineId: key,
      input,
      occurredAt: now,
    });
  });
  await reconcileReminders().catch(() => undefined);
  return key;
}
export async function archiveRoutine(routineId: string): Promise<void> {
  const database = await db();
  const now = new Date().toISOString();
  await database.withTransactionAsync(async () => {
    await database.runAsync(
      "UPDATE routines SET status='archived',updated_at=? WHERE id=?",
      now,
      routineId,
    );
    await enqueueLocalOperation(database, 'routine', {
      action: 'archive',
      routineId,
      occurredAt: now,
    });
  });
  await reconcileReminders().catch(() => undefined);
}
export async function startRoutineRun(routineId: string, localDate?: string): Promise<string> {
  const database = await db();
  const routine = await loadRoutine(database, routineId);
  if (!routine || !routine.steps.length) throw new Error('This routine has no steps yet.');
  const day = localDate ?? todayInTimezone(routine.timezone);
  const runId = id('routine-run');
  const now = new Date().toISOString();
  await database.withTransactionAsync(async () => {
    const existing = await database.getFirstAsync<{ id: string }>(
      "SELECT id FROM routine_runs WHERE routine_id=? AND status IN ('active','paused') LIMIT 1",
      routineId,
    );
    if (existing) throw new Error('Resume the unfinished run before starting another.');
    await database.runAsync(
      "INSERT INTO routine_runs(id,routine_id,status,started_at,local_date,timezone,created_at,updated_at) VALUES(?,?,'active',?,?,?,?,?)",
      runId,
      routineId,
      now,
      day,
      routine.timezone,
      now,
      now,
    );
    for (const step of routine.steps) {
      const snapshot = JSON.stringify(step);
      await database.runAsync(
        'INSERT INTO routine_run_steps(id,run_id,template_step_id,order_index,title,kind,habit_id,task_id,target_seconds,measurement,value,unit,category,preset_id,note,skippable,snapshot_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        id('routine-run-step'),
        runId,
        step.id,
        step.order,
        step.title,
        step.kind,
        step.habitId || null,
        step.taskId || null,
        step.targetMinutes ? Number(step.targetMinutes) * 60 : null,
        step.measurement || null,
        step.value ? Number(step.value) : null,
        step.unit || null,
        step.category,
        step.presetId || null,
        step.note,
        step.skippable ? 1 : 0,
        snapshot,
        now,
      );
    }
    await enqueueLocalOperation(database, 'routine_run', {
      action: 'start',
      runId,
      routineId,
      localDate: day,
      occurredAt: now,
    });
  });
  await reconcileReminders().catch(() => undefined);
  return runId;
}
export async function getRoutineRun(runId: string): Promise<RoutineRun | null> {
  const database = await db();
  const row = await database.getFirstAsync<{
    id: string;
    routine_id: string;
    status: RoutineRun['status'];
    started_at: string;
    finished_at: string | null;
    local_date: string;
    timezone: string;
    name: string;
  }>(
    'SELECT rr.*,r.name FROM routine_runs rr JOIN routines r ON r.id=rr.routine_id WHERE rr.id=?',
    runId,
  );
  if (!row) return null;
  const rows = await database.getAllAsync<Record<string, unknown>>(
    'SELECT * FROM routine_run_steps WHERE run_id=? ORDER BY order_index',
    runId,
  );
  const steps = rows.map((item) => mapStep(item, true) as RoutineRunStep);
  return {
    id: row.id,
    routineId: row.routine_id,
    routineName: row.name,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    localDate: row.local_date,
    timezone: row.timezone,
    steps,
    progress: routineRunProgress(steps.map((step) => step.status)),
  };
}
export async function updateRoutineRun(
  runId: string,
  action: 'pause' | 'resume' | 'abandon' | 'finish',
): Promise<void> {
  const database = await db();
  const run = await getRoutineRun(runId);
  if (!run) throw new Error('This routine run could not be found.');
  if (!['active', 'paused'].includes(run.status))
    throw new Error('This routine run has already ended.');
  if (action === 'finish' && !run.progress.canFinish)
    throw new Error('Complete or skip the remaining steps before finishing.');
  const status =
    action === 'pause'
      ? 'paused'
      : action === 'resume'
        ? 'active'
        : action === 'finish'
          ? 'completed'
          : 'abandoned';
  const now = new Date().toISOString();
  await database.withTransactionAsync(async () => {
    await database.runAsync(
      'UPDATE routine_runs SET status=?,finished_at=?,updated_at=? WHERE id=?',
      status,
      ['completed', 'abandoned'].includes(status) ? now : null,
      now,
      runId,
    );
    await enqueueLocalOperation(database, 'routine_run', { action, runId, occurredAt: now });
  });
  await reconcileReminders().catch(() => undefined);
}
export async function completeRoutineStep(runId: string, runStepId: string): Promise<void> {
  const database = await db();
  const run = await getRoutineRun(runId);
  const step = run?.steps.find((item) => item.runStepId === runStepId);
  if (!run || !step || run.status !== 'active')
    throw new Error('This routine step is no longer available.');
  if (step.status === 'completed' || step.status === 'skipped') return;
  if (step.kind === 'timer') throw new Error('Start the focus timer to complete this step.');
  let activityId: string | null = null;
  if (step.kind === 'task') {
    await applyTaskAction(step.taskId, 'complete');
  } else if (step.kind === 'habit') {
    const habit = await getHabitForDate(step.habitId, run.localDate);
    if (!habit) throw new Error('The linked habit is unavailable for this date.');
    const measurement = measurementForHabit(habit.measurement, habit.unit);
    const isMeasurable = ['duration', 'distance', 'volume', 'count', 'pages', 'quantity'].includes(
      measurement,
    );
    activityId = await createActivityLog({
      idempotencyKey: `routine:${run.id}:${step.runStepId}`,
      habit,
      category: 'habit',
      title: habit.name,
      measurement,
      kind: isMeasurable ? 'progress' : habit.kind === 'bad' ? 'clean' : 'complete_override',
      value: isMeasurable ? Number(step.value || habit.configuredTargetValue) : null,
      unit: isMeasurable ? step.unit || habit.configuredUnit : null,
      note: step.note,
      occurredAt: new Date().toISOString(),
      timezone: run.timezone,
    });
  } else if (step.kind === 'quick_measurement') {
    const localDate = localDateAt(new Date(), run.timezone);
    const habit = step.habitId ? await getHabitForDate(step.habitId, localDate) : null;
    const preset = step.presetId
      ? (await getPresetsForHabits(step.habitId ? [step.habitId] : [])).find(
          (item) => item.id === step.presetId,
        )
      : null;
    if (habit && measurementForHabit(habit.measurement, habit.unit) !== step.measurement)
      throw new Error('This habit now uses a different measurement. Update the routine step.');
    activityId = await createActivityLog({
      idempotencyKey: `routine:${run.id}:${step.runStepId}`,
      habit,
      category: habit ? 'habit' : step.category,
      title: step.title,
      measurement: step.measurement as MeasurementKind,
      kind: 'progress',
      value: Number(step.value),
      unit: step.unit,
      presetId: step.presetId || null,
      presetName: preset?.name ?? null,
      note: step.note,
      occurredAt: new Date().toISOString(),
      timezone: run.timezone,
    });
  }
  const now = new Date().toISOString();
  await database.withTransactionAsync(async () => {
    await database.runAsync(
      "UPDATE routine_run_steps SET status='completed',completed_at=?,linked_activity_id=COALESCE(?,linked_activity_id) WHERE id=? AND status IN ('pending','in_progress')",
      now,
      activityId,
      runStepId,
    );
    await enqueueLocalOperation(database, 'routine_run_step', {
      action: 'complete',
      runId,
      runStepId,
      activityId,
      occurredAt: now,
    });
  });
}
export async function skipRoutineStep(runId: string, runStepId: string): Promise<void> {
  const database = await db();
  const run = await getRoutineRun(runId);
  const step = run?.steps.find((item) => item.runStepId === runStepId);
  if (!run || run.status !== 'active' || !step || !step.skippable)
    throw new Error('This step cannot be skipped.');
  if (step.status === 'completed') return;
  const now = new Date().toISOString();
  await database.withTransactionAsync(async () => {
    await database.runAsync(
      "UPDATE routine_run_steps SET status='skipped',completed_at=? WHERE id=? AND status IN ('pending','in_progress')",
      now,
      runStepId,
    );
    await enqueueLocalOperation(database, 'routine_run_step', {
      action: 'skip',
      runId,
      runStepId,
      occurredAt: now,
    });
  });
}
export async function getActiveRoutineRun(routineId: string): Promise<RoutineRun | null> {
  const database = await db();
  const row = await database.getFirstAsync<{ id: string }>(
    "SELECT id FROM routine_runs WHERE routine_id=? AND status IN ('active','paused') ORDER BY started_at DESC LIMIT 1",
    routineId,
  );
  return row ? getRoutineRun(row.id) : null;
}
export async function getRoutineRunHistory(routineId: string): Promise<RoutineRun[]> {
  const database = await db();
  const rows = await database.getAllAsync<{ id: string }>(
    'SELECT id FROM routine_runs WHERE routine_id=? ORDER BY started_at DESC,id DESC LIMIT 50',
    routineId,
  );
  return (await Promise.all(rows.map((row) => getRoutineRun(row.id)))).filter(
    (run): run is RoutineRun => run !== null,
  );
}
