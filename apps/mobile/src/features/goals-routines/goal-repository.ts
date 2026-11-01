import type * as SQLite from 'expo-sqlite';
import { enqueueLocalOperation, initializeLocalDatabase } from '../../services/local-database';
import {
  createActivityLog,
  listHabits,
  newActivityKey,
  type ActivityEntry,
  type HabitRecord,
} from '../habits/habit-repository';
import {
  fromCanonical,
  measurementForHabit,
  toCanonical,
  type MeasurementKind,
} from '../habits/domain/activity-domain';
import { localDateAt, todayInTimezone } from '../habits/domain/habit-domain';
import { isWalkingDistanceHabit } from '../habits/walking-tracking-domain';
import { timestampFromLocal } from '../habits/domain/activity-domain';
import { reconcileReminders } from '../notifications/notification-service';
import {
  calculateGoalProgress,
  goalSchema,
  nextGoalVersionDate,
  pauseDurationDays,
  pausedThroughDate,
  type GoalInput,
  type GoalProgress,
  type GoalProgressLog,
  type GoalSnapshot,
} from './goal-domain';

export type GoalStatus =
  'upcoming' | 'active' | 'paused' | 'achieved' | 'ended' | 'archived' | 'deleted';
export type GoalRecord = {
  id: string;
  title: string;
  description: string;
  category: string;
  periodType: GoalInput['periodType'];
  model: GoalInput['model'];
  recurrence: GoalInput['recurrence'] | null;
  measurement: string;
  targetValue: number;
  unit: string;
  canonicalUnit: string;
  startDate: string;
  endDate: string;
  weekdayMask: number;
  timezone: string;
  status: GoalStatus;
  progress: GoalProgress;
  linkedHabits: HabitRecord[];
  createdAt: string;
  updatedAt: string;
};
export type GoalMilestone = {
  id: string;
  title: string;
  targetValue: number;
  dueDate: string | null;
  completedAt: string | null;
  achieved: boolean;
};
export type GoalEvent = {
  eventType: string;
  details: Record<string, unknown>;
  occurredAt: string;
  localDate: string;
};
export type GoalBundle = {
  goal: GoalRecord;
  milestones: GoalMilestone[];
  events: GoalEvent[];
  activity: ActivityEntry[];
  versions: GoalSnapshot[];
};

type GoalRow = {
  id: string;
  title: string;
  description: string;
  category: string;
  period_type: GoalInput['periodType'];
  model: GoalInput['model'];
  recurrence: GoalInput['recurrence'] | null;
  measurement: string;
  target_value: number;
  unit: string;
  canonical_unit: string;
  start_date: string;
  end_date: string;
  weekday_mask: number;
  timezone: string;
  status: 'active' | 'paused' | 'archived';
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};
const id = (prefix: string) =>
  `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
async function db() {
  return initializeLocalDatabase();
}
function addDays(date: string, amount: number) {
  const [year, month, day] = date.split('-').map(Number);
  const next = new Date(Date.UTC(year!, month! - 1, day! + amount));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
}
function dayMask(days: number[]) {
  return days.reduce((mask, day) => mask | (1 << day), 0);
}
async function recordGoalEvent(
  database: SQLite.SQLiteDatabase,
  goalId: string,
  eventType: string,
  timezone: string,
  details: Record<string, unknown> = {},
) {
  const now = new Date().toISOString();
  await database.runAsync(
    'INSERT INTO goal_events(id,goal_id,event_type,details_json,occurred_at,local_date,timezone) VALUES(?,?,?,?,?,?,?)',
    id('goal-event'),
    goalId,
    eventType,
    JSON.stringify(details),
    now,
    todayInTimezone(timezone),
    timezone,
  );
}
async function queueGoal(
  database: SQLite.SQLiteDatabase,
  action: string,
  goalId: string,
  details: Record<string, unknown> = {},
) {
  await enqueueLocalOperation(database, 'goal', {
    action,
    goalId,
    ...details,
    occurredAt: new Date().toISOString(),
  });
}
async function linkedHabits(
  database: SQLite.SQLiteDatabase,
  goalId: string,
  cachedHabits?: HabitRecord[],
) {
  const rows = await database.getAllAsync<{ habit_id: string }>(
    'SELECT habit_id FROM goal_habits WHERE goal_id=?',
    goalId,
  );
  const all = cachedHabits ?? (await listHabits('all', true));
  return rows
    .map((row) => all.find((habit) => habit.id === row.habit_id))
    .filter((habit): habit is HabitRecord => !!habit);
}
async function getDailyProgressLogs(
  database: SQLite.SQLiteDatabase,
  goal: GoalRow,
): Promise<GoalProgressLog[]> {
  const habitRows = await database.getAllAsync<{ habit_id: string }>(
    'SELECT habit_id FROM goal_habits WHERE goal_id=?',
    goal.id,
  );
  const habitIds = habitRows.map((row) => row.habit_id);
  const params: (string | number | null)[] = [
    goal.id,
    timestampFromLocal(goal.start_date, '00:00', goal.timezone),
    timestampFromLocal(addDays(goal.end_date, 1), '00:00', goal.timezone),
    goal.measurement,
    goal.canonical_unit,
  ];
  const habitClause = habitIds.length
    ? ` OR e.habit_id IN (${habitIds.map(() => '?').join(',')})`
    : '';
  params.push(...habitIds);
  const rows = await database.getAllAsync<{
    id: string;
    measurement: string;
    value: number | null;
    unit: string | null;
    occurred_at: string;
    habit_id: string | null;
    local_date: string;
  }>(
    `SELECT e.id,e.measurement,e.value,e.unit,e.occurred_at,e.habit_id,e.local_date FROM activity_logs e
     WHERE e.deleted_at IS NULL AND e.kind IN ('progress','complete_override','clean') AND (e.goal_id=?${habitClause})
       AND e.occurred_at>=? AND e.occurred_at<?
       AND (?='days' OR (e.measurement=? AND e.unit=?))
       AND NOT EXISTS (SELECT 1 FROM digital_usage_daily_totals d
         WHERE d.habit_id=e.habit_id AND d.local_date=e.local_date AND d.measurement=e.measurement)
     ORDER BY e.occurred_at,e.id LIMIT 5000`,
    ...params.slice(0, 1),
    ...habitIds,
    ...params.slice(1, 3),
    ...params.slice(3, 4),
    goal.measurement,
    goal.canonical_unit,
  );
  const distinct = new Map<string, GoalProgressLog>();
  const logDates = new Map<string, { habitId: string | null; localDate: string }>();
  for (const row of rows) {
    if (distinct.has(row.id)) continue;
    const localDate = row.local_date || localDateAt(new Date(row.occurred_at), goal.timezone);
    distinct.set(row.id, { id: row.id, value: row.value, unit: row.unit, localDate });
    logDates.set(row.id, { habitId: row.habit_id, localDate });
  }
  if (habitIds.length) {
    const totals = await database.getAllAsync<{
      id: string;
      value: number;
      unit: string;
      local_date: string;
      habit_id: string;
    }>(
      `SELECT 'digital-total:'||d.habit_id||':'||d.local_date id,d.value,d.unit,d.local_date,d.habit_id
       FROM digital_usage_daily_totals d
       JOIN goal_habits gh ON gh.habit_id=d.habit_id AND gh.goal_id=?
       JOIN habit_targets t ON t.habit_id=d.habit_id AND t.measurement=d.measurement
         AND t.target_mode='maximum' AND t.effective_from<=d.local_date
         AND (t.effective_to IS NULL OR t.effective_to>=d.local_date)
       WHERE d.local_date BETWEEN ? AND ? AND d.measurement=? AND d.unit=?`,
      goal.id,
      goal.start_date,
      goal.end_date,
      goal.measurement,
      goal.canonical_unit,
    );
    for (const row of totals) {
      for (const [id, log] of logDates) {
        if (log.habitId === row.habit_id && log.localDate === row.local_date) {
          distinct.delete(id);
          logDates.delete(id);
        }
      }
      distinct.set(row.id, {
        id: row.id,
        value: row.value,
        unit: row.unit,
        localDate: row.local_date,
      });
    }
  }
  if (goal.canonical_unit === 'meters' && habitIds.length) {
    const placeholders = habitIds.map(() => '?').join(',');
    const snapshots = await database.getAllAsync<{
      habit_id: string;
      local_date: string;
      value: number;
      name: string;
      measurement: string;
    }>(
      `SELECT s.habit_id,s.local_date,s.value,h.name,t.measurement FROM walking_device_snapshots s
       JOIN walking_tracking_preferences p ON p.habit_id=s.habit_id AND p.mode='automatic'
       JOIN habits h ON h.id=s.habit_id
       JOIN habit_targets t ON t.habit_id=h.id AND t.effective_to IS NULL
       WHERE s.measurement='distance' AND s.habit_id IN (${placeholders})
         AND s.local_date BETWEEN ? AND ?`,
      ...habitIds,
      goal.start_date,
      goal.end_date,
    );
    for (const snapshot of snapshots.filter((item) =>
      isWalkingDistanceHabit(item.name, item.measurement),
    )) {
      for (const [id, log] of logDates) {
        if (log.habitId === snapshot.habit_id && log.localDate === snapshot.local_date) {
          distinct.delete(id);
          logDates.delete(id);
        }
      }
      const id = `device:${snapshot.habit_id}:${snapshot.local_date}`;
      distinct.set(id, {
        id,
        value: snapshot.value,
        unit: 'meters',
        localDate: snapshot.local_date,
      });
    }
  }
  return [...distinct.values()];
}
async function mapGoal(
  database: SQLite.SQLiteDatabase,
  row: GoalRow,
  today: string,
  cachedHabits?: HabitRecord[],
): Promise<GoalRecord> {
  const [logs, versions, habits, pauseRows] = await Promise.all([
    getDailyProgressLogs(database, row),
    database.getAllAsync<{ snapshot_json: string; effective_from: string }>(
      'SELECT snapshot_json,effective_from FROM goal_versions WHERE goal_id=? ORDER BY effective_from',
      row.id,
    ),
    linkedHabits(database, row.id, cachedHabits),
    database.getAllAsync<{ started_on: string; resumed_on: string | null }>(
      'SELECT started_on,resumed_on FROM goal_pauses WHERE goal_id=? ORDER BY started_on',
      row.id,
    ),
  ]);
  const snapshots: GoalSnapshot[] = versions.map((version) => {
    const parsed = JSON.parse(version.snapshot_json) as Omit<GoalSnapshot, 'effectiveFrom'>;
    return { ...parsed, effectiveFrom: version.effective_from };
  });
  const progress = calculateGoalProgress({
    startDate: row.start_date,
    endDate: row.end_date,
    today,
    model: row.model,
    recurrence: row.recurrence,
    measurement: row.measurement,
    targetValue: row.target_value,
    weekdayMask: row.weekday_mask,
    versions: snapshots,
    logs,
    pauses: pauseRows.map((pause) => ({
      startedOn: pause.started_on,
      resumedOn: pause.resumed_on,
    })),
  });
  const status: GoalStatus = row.deleted_at
    ? 'deleted'
    : row.status === 'archived'
      ? 'archived'
      : row.status === 'paused'
        ? 'paused'
        : today < row.start_date
          ? 'upcoming'
          : today > row.end_date
            ? progress.achieved
              ? 'achieved'
              : 'ended'
            : row.model === 'cumulative' && progress.totalValue >= row.target_value
              ? 'achieved'
              : 'active';
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category,
    periodType: row.period_type,
    model: row.model,
    recurrence: row.recurrence,
    measurement: row.measurement,
    targetValue: row.target_value,
    unit: row.unit,
    canonicalUnit: row.canonical_unit,
    startDate: row.start_date,
    endDate: row.end_date,
    weekdayMask: row.weekday_mask,
    timezone: row.timezone,
    status,
    progress,
    linkedHabits: habits,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function normalizeGoalInput(input: GoalInput) {
  const measure = input.measurement;
  const canonical =
    measure === 'days'
      ? { value: Number(input.targetValue), unit: 'days' }
      : toCanonical(Number(input.targetValue), measure as MeasurementKind, input.unit);
  return {
    canonical,
    mask: dayMask(input.weekdays),
    recurrence: input.model === 'recurring' ? input.recurrence : null,
  };
}
async function validateGoalLinks(
  database: SQLite.SQLiteDatabase,
  input: GoalInput,
  canonicalUnit: string,
) {
  const all = await listHabits('all', true);
  for (const habitId of input.habitIds) {
    const habit = all.find((item) => item.id === habitId);
    if (!habit || habit.status === 'archived')
      throw new Error('A linked habit is no longer available.');
    if (input.measurement !== 'days') {
      const kind = measurementForHabit(habit.measurement, habit.unit);
      if (kind !== input.measurement)
        throw new Error(`“${habit.name}” uses a different measurement.`);
      if (toCanonical(1, kind, habit.unit).unit !== canonicalUnit)
        throw new Error(`“${habit.name}” uses a different unit.`);
    }
  }
  return database;
}
const goalColumns = `id,title,description,category,period_type,model,recurrence,measurement,target_value,unit,canonical_unit,start_date,end_date,weekday_mask,timezone,status,deleted_at,created_at,updated_at`;

export async function saveGoal(rawInput: GoalInput, goalId?: string): Promise<string> {
  const input = goalSchema.parse(rawInput);
  const database = await db();
  const { canonical, mask, recurrence } = normalizeGoalInput(input);
  await validateGoalLinks(database, input, canonical.unit);
  const now = new Date().toISOString();
  const localToday = todayInTimezone(input.timezone);
  const idValue = goalId ?? id('goal');
  await database.withTransactionAsync(async () => {
    const previous = goalId
      ? await database.getFirstAsync<GoalRow>(
          `SELECT ${goalColumns} FROM goals WHERE id=? AND deleted_at IS NULL`,
          goalId,
        )
      : null;
    if (goalId && !previous) throw new Error('This goal is no longer available.');
    if (!previous) {
      await database.runAsync(
        `INSERT INTO goals(id,title,description,category,period_type,model,recurrence,measurement,target_value,unit,canonical_unit,start_date,end_date,weekday_mask,timezone,status,created_at,updated_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'active',?,?)`,
        idValue,
        input.title.trim(),
        input.description.trim(),
        input.category,
        input.periodType,
        input.model,
        recurrence || null,
        input.measurement,
        canonical.value,
        input.unit,
        canonical.unit,
        input.startDate,
        input.endDate,
        mask,
        input.timezone,
        now,
        now,
      );
      const snapshot = {
        targetValue: canonical.value,
        measurement: input.measurement,
        unit: canonical.unit,
        recurrence: recurrence || null,
        weekdayMask: mask,
      };
      await database.runAsync(
        'INSERT INTO goal_versions(id,goal_id,effective_from,snapshot_json,created_at) VALUES(?,?,?,?,?)',
        id('goal-version'),
        idValue,
        input.startDate,
        JSON.stringify(snapshot),
        now,
      );
      await recordGoalEvent(database, idValue, 'created', input.timezone, { title: input.title });
    } else {
      if (
        previous.measurement !== input.measurement ||
        previous.canonical_unit !== canonical.unit ||
        previous.model !== input.model ||
        previous.recurrence !== recurrence ||
        previous.start_date !== input.startDate ||
        previous.end_date !== input.endDate ||
        previous.timezone !== input.timezone
      ) {
        throw new Error(
          'Measurement, goal model, recurrence, and date range are fixed after creation so existing progress keeps its meaning. You can still change the target, daily weekdays, title, and description.',
        );
      }
      const effectiveFrom =
        previous.model === 'recurring'
          ? nextGoalVersionDate(localToday, previous.recurrence ?? 'daily')
          : localToday;
      await database.runAsync(
        `UPDATE goals SET title=?,description=?,category=?,period_type=?,model=?,recurrence=?,measurement=?,target_value=?,unit=?,canonical_unit=?,start_date=?,end_date=?,weekday_mask=?,timezone=?,updated_at=? WHERE id=?`,
        input.title.trim(),
        input.description.trim(),
        input.category,
        input.periodType,
        input.model,
        recurrence || null,
        input.measurement,
        canonical.value,
        input.unit,
        canonical.unit,
        input.startDate,
        input.endDate,
        mask,
        input.timezone,
        now,
        idValue,
      );
      const snapshot = {
        targetValue: canonical.value,
        measurement: input.measurement,
        unit: canonical.unit,
        recurrence: recurrence || null,
        weekdayMask: mask,
      };
      await database.runAsync(
        `INSERT INTO goal_versions(id,goal_id,effective_from,snapshot_json,created_at) VALUES(?,?,?,?,?)
         ON CONFLICT(goal_id,effective_from) DO UPDATE SET snapshot_json=excluded.snapshot_json,created_at=excluded.created_at`,
        id('goal-version'),
        idValue,
        effectiveFrom,
        JSON.stringify(snapshot),
        now,
      );
      await recordGoalEvent(database, idValue, 'edited', input.timezone, {
        effectiveFrom,
        targetValue: canonical.value,
      });
    }
    await database.runAsync('DELETE FROM goal_habits WHERE goal_id=?', idValue);
    for (const habitId of input.habitIds)
      await database.runAsync(
        'INSERT INTO goal_habits(goal_id,habit_id,created_at) VALUES(?,?,?)',
        idValue,
        habitId,
        now,
      );
    await enqueueLocalOperation(database, 'goal', {
      action: previous ? 'update' : 'create',
      goalId: idValue,
      input,
      canonicalTarget: canonical,
      effectiveFrom: previous ? localToday : input.startDate,
      occurredAt: now,
    });
  });
  await reconcileReminders().catch(() => undefined);
  return idValue;
}

export async function getGoals(
  options: {
    includeArchived?: boolean;
    localDate?: string;
    cachedHabits?: HabitRecord[];
  } = {},
): Promise<GoalRecord[]> {
  const includeArchived = options.includeArchived ?? true;
  const localDate =
    options.localDate ?? todayInTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  const database = await db();
  const cachedHabits = options.cachedHabits ?? (await listHabits('all', true));
  const rows = await database.getAllAsync<GoalRow>(
    `SELECT ${goalColumns} FROM goals WHERE deleted_at IS NULL ${includeArchived ? '' : "AND status!='archived'"} ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END,end_date,title LIMIT 50`,
  );
  return Promise.all(rows.map((row) => mapGoal(database, row, localDate, cachedHabits)));
}

export async function getDeletedGoals(): Promise<GoalRecord[]> {
  const database = await db();
  const cachedHabits = await listHabits('all', true);
  const rows = await database.getAllAsync<GoalRow>(
    `SELECT ${goalColumns} FROM goals WHERE deleted_at IS NOT NULL ORDER BY updated_at DESC LIMIT 50`,
  );
  return Promise.all(
    rows.map((row) => mapGoal(database, row, todayInTimezone(row.timezone), cachedHabits)),
  );
}

export async function getGoalBundle(goalId: string): Promise<GoalBundle | null> {
  const database = await db();
  const row = await database.getFirstAsync<GoalRow>(
    `SELECT ${goalColumns} FROM goals WHERE id=?`,
    goalId,
  );
  if (!row) return null;
  const cachedHabits = await listHabits('all', true);
  const today = todayInTimezone(row.timezone);
  const [goal, milestoneRows, eventRows, activity, versionRows] = await Promise.all([
    mapGoal(database, row, today, cachedHabits),
    database.getAllAsync<{
      id: string;
      title: string;
      target_value: number;
      due_date: string | null;
      completed_at: string | null;
    }>(
      'SELECT id,title,target_value,due_date,completed_at FROM goal_milestones WHERE goal_id=? ORDER BY target_value,id',
      goalId,
    ),
    database.getAllAsync<{
      event_type: string;
      details_json: string;
      occurred_at: string;
      local_date: string;
    }>(
      'SELECT event_type,details_json,occurred_at,local_date FROM goal_events WHERE goal_id=? ORDER BY occurred_at DESC,id DESC LIMIT 100',
      goalId,
    ),
    database.getAllAsync<ActivityEntry>(
      `SELECT e.id,e.idempotency_key,e.kind,e.value,e.unit,e.note,e.occurred_at,e.created_at,e.local_date,e.measurement,e.input_value,e.input_unit,e.preset_id,e.preset_name,e.focus_session_id,e.deleted_at,e.correction_count,e.category,e.title,e.timezone,e.habit_id,h.name AS habit_name,e.goal_id
      FROM activity_logs e LEFT JOIN habits h ON h.id=e.habit_id WHERE e.goal_id=? OR e.habit_id IN (SELECT habit_id FROM goal_habits WHERE goal_id=?) ORDER BY e.occurred_at DESC,e.id DESC LIMIT 100`,
      goalId,
      goalId,
    ),
    database.getAllAsync<{ effective_from: string; snapshot_json: string }>(
      'SELECT effective_from,snapshot_json FROM goal_versions WHERE goal_id=? ORDER BY effective_from DESC LIMIT 50',
      goalId,
    ),
  ]);
  const milestones: GoalMilestone[] = milestoneRows.map((milestone) => ({
    ...{
      id: milestone.id,
      title: milestone.title,
      targetValue: milestone.target_value,
      dueDate: milestone.due_date,
      completedAt: milestone.completed_at,
      achieved: goal.progress.totalValue >= milestone.target_value,
    },
  }));
  return {
    goal,
    milestones,
    events: eventRows.map((event) => ({
      eventType: event.event_type,
      details: JSON.parse(event.details_json) as Record<string, unknown>,
      occurredAt: event.occurred_at,
      localDate: event.local_date,
    })),
    activity,
    versions: versionRows.map((version) => ({
      ...(JSON.parse(version.snapshot_json) as Omit<GoalSnapshot, 'effectiveFrom'>),
      effectiveFrom: version.effective_from,
    })),
  };
}

export async function setGoalStatus(
  goalId: string,
  action: 'pause' | 'resume' | 'archive' | 'delete' | 'restore',
): Promise<void> {
  const database = await db();
  const now = new Date().toISOString();
  await database.withTransactionAsync(async () => {
    const row = await database.getFirstAsync<{
      status: string;
      deleted_at: string | null;
      timezone: string;
      end_date: string;
    }>('SELECT status,deleted_at,timezone,end_date FROM goals WHERE id=?', goalId);
    if (!row) throw new Error('This goal could not be found.');
    if (action === 'pause' && row.status === 'paused') return;
    if (action === 'resume' && row.status !== 'paused') return;
    const eventType = {
      pause: 'paused',
      resume: 'resumed',
      archive: 'archived',
      delete: 'deleted',
      restore: 'restored',
    }[action];
    let eventDetails: Record<string, unknown> = {};
    if (action === 'pause') {
      await database.runAsync(
        "UPDATE goals SET status='paused',updated_at=? WHERE id=? AND deleted_at IS NULL",
        now,
        goalId,
      );
      await database.runAsync(
        'INSERT INTO goal_pauses(id,goal_id,started_on,created_at) VALUES(?,?,?,?)',
        id('goal-pause'),
        goalId,
        todayInTimezone(row.timezone),
        now,
      );
    } else if (action === 'resume') {
      await database.runAsync(
        "UPDATE goals SET status='active',updated_at=? WHERE id=? AND deleted_at IS NULL",
        now,
        goalId,
      );
      const resumedOn = todayInTimezone(row.timezone);
      const pause = await database.getFirstAsync<{ started_on: string }>(
        'SELECT started_on FROM goal_pauses WHERE goal_id=? AND resumed_on IS NULL ORDER BY started_on DESC LIMIT 1',
        goalId,
      );
      if (pause) {
        const pausedDays = pauseDurationDays(pause.started_on, resumedOn);
        const newEndDate = addDays(row.end_date, pausedDays);
        await database.runAsync(
          'UPDATE goal_pauses SET resumed_on=? WHERE goal_id=? AND resumed_on IS NULL',
          pausedThroughDate(pause.started_on, resumedOn),
          goalId,
        );
        await database.runAsync(
          'UPDATE goals SET end_date=?,updated_at=? WHERE id=?',
          newEndDate,
          now,
          goalId,
        );
        eventDetails = { pauseStartedOn: pause.started_on, resumedOn, pausedDays, newEndDate };
      }
    } else if (action === 'archive') {
      await database.runAsync(
        "UPDATE goals SET status='archived',updated_at=? WHERE id=? AND deleted_at IS NULL",
        now,
        goalId,
      );
    } else if (action === 'delete') {
      await database.runAsync(
        'UPDATE goals SET deleted_at=?,deleted_previous_status=status,updated_at=? WHERE id=? AND deleted_at IS NULL',
        now,
        now,
        goalId,
      );
    } else {
      await database.runAsync(
        "UPDATE goals SET status=COALESCE(deleted_previous_status,'active'),deleted_at=NULL,deleted_previous_status=NULL,updated_at=? WHERE id=? AND deleted_at IS NOT NULL",
        now,
        goalId,
      );
    }
    await recordGoalEvent(database, goalId, eventType, row.timezone, eventDetails);
    await queueGoal(database, action, goalId);
  });
  await reconcileReminders().catch(() => undefined);
}

export async function addGoalProgress(
  goalId: string,
  amount: number,
  localDate: string,
  note = '',
): Promise<string> {
  const database = await db();
  const goal = await database.getFirstAsync<GoalRow>(
    `SELECT ${goalColumns} FROM goals WHERE id=? AND deleted_at IS NULL`,
    goalId,
  );
  if (!goal || goal.status === 'archived')
    throw new Error('This goal is not available for progress logging.');
  if (localDate < goal.start_date || localDate > goal.end_date)
    throw new Error('Choose a date inside this goal’s range.');
  const measurement: MeasurementKind =
    goal.measurement === 'days' ? 'count' : (goal.measurement as MeasurementKind);
  const inputUnit = goal.measurement === 'days' ? 'count' : goal.unit;
  const value = goal.measurement === 'days' ? 1 : amount;
  if (goal.measurement === 'days' && amount !== 1)
    throw new Error('Record one achieved day at a time so progress stays tied to its date.');
  const timestamp = timestampFromLocal(localDate, '12:00', goal.timezone);
  return createActivityLog({
    idempotencyKey: newActivityKey(),
    habit: null,
    goalId,
    category: 'other',
    title: goal.title,
    measurement,
    kind: 'progress',
    value,
    unit: inputUnit,
    note,
    occurredAt: timestamp,
    timezone: goal.timezone,
  });
}

export async function saveGoalMilestone(
  goalId: string,
  title: string,
  targetValue: number,
  dueDate: string | null,
  milestoneId?: string,
): Promise<void> {
  const cleanTitle = title.trim();
  if (
    cleanTitle.length < 2 ||
    cleanTitle.length > 80 ||
    !Number.isFinite(targetValue) ||
    targetValue <= 0
  )
    throw new Error('Enter a milestone name and a positive target.');
  const database = await db();
  const now = new Date().toISOString();
  const milestoneKey = milestoneId ?? id('goal-milestone');
  await database.withTransactionAsync(async () => {
    const exists = await database.getFirstAsync<{ id: string; measurement: string; unit: string }>(
      'SELECT id,measurement,unit FROM goals WHERE id=? AND deleted_at IS NULL',
      goalId,
    );
    if (!exists) throw new Error('This goal is no longer available.');
    const canonicalTarget =
      exists.measurement === 'days'
        ? targetValue
        : toCanonical(targetValue, exists.measurement as MeasurementKind, exists.unit).value;
    await database.runAsync(
      `INSERT INTO goal_milestones(id,goal_id,title,target_value,due_date,created_at,updated_at) VALUES(?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET title=excluded.title,target_value=excluded.target_value,due_date=excluded.due_date,updated_at=excluded.updated_at`,
      milestoneKey,
      goalId,
      cleanTitle,
      canonicalTarget,
      dueDate,
      now,
      now,
    );
    await enqueueLocalOperation(database, 'goal_milestone', {
      action: milestoneId ? 'update' : 'create',
      goalId,
      milestoneId: milestoneKey,
      title: cleanTitle,
      targetValue: canonicalTarget,
      dueDate,
      occurredAt: now,
    });
  });
  await reconcileReminders().catch(() => undefined);
}

export async function deleteGoalMilestone(goalId: string, milestoneId: string): Promise<void> {
  const database = await db();
  await database.withTransactionAsync(async () => {
    await database.runAsync(
      'DELETE FROM goal_milestones WHERE id=? AND goal_id=?',
      milestoneId,
      goalId,
    );
    await enqueueLocalOperation(database, 'goal_milestone', {
      action: 'delete',
      goalId,
      milestoneId,
      occurredAt: new Date().toISOString(),
    });
  });
  await reconcileReminders().catch(() => undefined);
}

export async function getLinkedHabitsForGoal(): Promise<HabitRecord[]> {
  return listHabits('all', false);
}

export function formatGoalTarget(goal: Pick<GoalRecord, 'targetValue' | 'measurement' | 'unit'>) {
  const value =
    goal.measurement === 'days'
      ? goal.targetValue
      : fromCanonical(goal.targetValue, goal.measurement as MeasurementKind, goal.unit);
  return `${Number(value.toFixed(2))} ${goal.unit}`;
}
