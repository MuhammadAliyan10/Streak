import type * as SQLite from 'expo-sqlite';
import { enqueueLocalOperation, initializeLocalDatabase } from '../../services/local-database';
import { todayInTimezone } from '../habits/domain/habit-domain';
import { reconcileReminders } from '../notifications/notification-service';
import type { TaskInput, TaskPriority, TaskStatus } from './planner-domain';

export type PlannerTask = {
  id: string;
  title: string;
  description: string;
  priority: TaskPriority;
  plannedDate: string;
  plannedTime: string | null;
  estimatedMinutes: number | null;
  timezone: string;
  status: TaskStatus;
  completedAt: string | null;
  completedLocalDate: string | null;
  createdAt: string;
  updatedAt: string;
};
export type TaskEvent = {
  id: string;
  taskId: string;
  taskTitle: string;
  eventType: string;
  details: Record<string, unknown>;
  occurredAt: string;
  localDate: string;
  timezone: string;
};
export type DailyReview = {
  localDate: string;
  timezone: string;
  note: string;
  wentWell: string;
  improve: string;
  tomorrowPriority: string;
  updatedAt: string;
};
export type DailyReviewInput = Pick<DailyReview, 'wentWell' | 'improve' | 'tomorrowPriority'>;

async function db(): Promise<SQLite.SQLiteDatabase> {
  return initializeLocalDatabase();
}
function eventKey(): string {
  return `task-event:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}
function mapTask(row: {
  id: string;
  title: string;
  description: string;
  priority: TaskPriority;
  planned_date: string;
  planned_time: string | null;
  estimated_minutes: number | null;
  timezone: string;
  status: TaskStatus;
  completed_at: string | null;
  completed_local_date: string | null;
  created_at: string;
  updated_at: string;
}): PlannerTask {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    priority: row.priority,
    plannedDate: row.planned_date,
    plannedTime: row.planned_time,
    estimatedMinutes: row.estimated_minutes,
    timezone: row.timezone,
    status: row.status,
    completedAt: row.completed_at,
    completedLocalDate: row.completed_local_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
async function recordTaskEvent(
  database: SQLite.SQLiteDatabase,
  taskId: string,
  eventType: string,
  timezone: string,
  details: Record<string, unknown>,
  now: string,
): Promise<void> {
  await database.runAsync(
    'INSERT INTO task_history (task_id,idempotency_key,event_type,details_json,occurred_at,local_date,timezone) VALUES (?,?,?,?,?,?,?)',
    taskId,
    eventKey(),
    eventType,
    JSON.stringify(details),
    now,
    todayInTimezone(timezone),
    timezone,
  );
}
const taskColumns = `id,title,description,priority,planned_date,planned_time,estimated_minutes,timezone,status,completed_at,completed_local_date,created_at,updated_at`;

export async function getTasksForDate(localDate: string): Promise<PlannerTask[]> {
  const database = await db();
  const rows = await database.getAllAsync<Parameters<typeof mapTask>[0]>(
    `SELECT ${taskColumns} FROM tasks WHERE deleted_at IS NULL AND (planned_date=? OR completed_local_date=?) ORDER BY CASE WHEN planned_time IS NULL THEN 1 ELSE 0 END, planned_time, created_at`,
    localDate,
    localDate,
  );
  return rows.map(mapTask);
}

export async function getDeletedTasksForDate(localDate: string): Promise<PlannerTask[]> {
  const database = await db();
  const rows = await database.getAllAsync<Parameters<typeof mapTask>[0]>(
    `SELECT ${taskColumns} FROM tasks WHERE deleted_at IS NOT NULL AND planned_date=? ORDER BY updated_at DESC`,
    localDate,
  );
  return rows.map(mapTask);
}

export async function getTask(id: string): Promise<PlannerTask | null> {
  const database = await db();
  const row = await database.getFirstAsync<Parameters<typeof mapTask>[0]>(
    `SELECT ${taskColumns} FROM tasks WHERE id=? AND deleted_at IS NULL`,
    id,
  );
  return row ? mapTask(row) : null;
}

export async function getTaskEventsForDate(localDate: string): Promise<TaskEvent[]> {
  const database = await db();
  const rows = await database.getAllAsync<{
    id: string;
    task_id: string;
    title: string;
    event_type: string;
    details_json: string;
    occurred_at: string;
    local_date: string;
    timezone: string;
  }>(
    `SELECT th.id,th.task_id,t.title,th.event_type,th.details_json,th.occurred_at,th.local_date,th.timezone
     FROM task_history th JOIN tasks t ON t.id=th.task_id
     WHERE th.local_date=? AND t.deleted_at IS NULL ORDER BY th.occurred_at,th.id`,
    localDate,
  );
  return rows.map((row) => ({
    id: row.id,
    taskId: row.task_id,
    taskTitle: row.title,
    eventType: row.event_type,
    details: JSON.parse(row.details_json) as Record<string, unknown>,
    occurredAt: row.occurred_at,
    localDate: row.local_date,
    timezone: row.timezone,
  }));
}

export async function saveTask(input: TaskInput, id?: string): Promise<string> {
  const database = await db();
  const now = new Date().toISOString();
  const minutes = input.estimatedMinutes ? Number(input.estimatedMinutes) : null;
  let taskId = id;
  await database.withTransactionAsync(async () => {
    if (!taskId) {
      const inserted = await database.getFirstAsync<{ id: string }>(
        'INSERT INTO tasks (title,description,priority,planned_date,planned_time,estimated_minutes,timezone,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?) RETURNING id',
        input.title.trim(),
        input.description.trim(),
        input.priority,
        input.plannedDate,
        input.plannedTime || null,
        minutes,
        input.timezone,
        now,
        now,
      );
      taskId = inserted!.id;
      await recordTaskEvent(
        database,
        taskId,
        'created',
        input.timezone,
        {
          title: input.title,
          plannedDate: input.plannedDate,
          plannedTime: input.plannedTime || null,
        },
        now,
      );
    } else {
      const previous = await database.getFirstAsync<{
        title: string;
        planned_date: string;
        planned_time: string | null;
        timezone: string;
        deleted_at: string | null;
      }>(
        'SELECT title,planned_date,planned_time,timezone,deleted_at FROM tasks WHERE id=?',
        taskId,
      );
      if (!previous || previous.deleted_at) throw new Error('This task is no longer available.');
      await database.runAsync(
        'UPDATE tasks SET title=?,description=?,priority=?,planned_date=?,planned_time=?,estimated_minutes=?,timezone=?,updated_at=? WHERE id=? AND deleted_at IS NULL',
        input.title.trim(),
        input.description.trim(),
        input.priority,
        input.plannedDate,
        input.plannedTime || null,
        minutes,
        input.timezone,
        now,
        taskId,
      );
      const rescheduled =
        previous.planned_date !== input.plannedDate ||
        previous.planned_time !== (input.plannedTime || null);
      await recordTaskEvent(
        database,
        taskId,
        rescheduled ? 'rescheduled' : 'edited',
        input.timezone,
        {
          title: input.title,
          fromDate: previous.planned_date,
          fromTime: previous.planned_time,
          toDate: input.plannedDate,
          toTime: input.plannedTime || null,
        },
        now,
      );
    }
    await enqueueLocalOperation(database, 'task', {
      action: id ? 'update' : 'create',
      taskId: taskId!,
      input: { ...input, estimatedMinutes: minutes },
      occurredAt: now,
    });
  });
  await reconcileReminders().catch(() => undefined);
  return taskId!;
}

export type TaskAction = 'complete' | 'reopen' | 'cancel' | 'delete' | 'restore';
export async function applyTaskAction(id: string, action: TaskAction): Promise<void> {
  const database = await db();
  const now = new Date().toISOString();
  await database.withTransactionAsync(async () => {
    const task = await database.getFirstAsync<{
      status: TaskStatus;
      timezone: string;
      deleted_at: string | null;
      deleted_previous_status: TaskStatus | null;
    }>('SELECT status,timezone,deleted_at,deleted_previous_status FROM tasks WHERE id=?', id);
    if (!task) throw new Error('This task could not be found.');
    const isDeleted = task.deleted_at !== null;
    if (action === 'restore') {
      if (!isDeleted) return;
      const restoredStatus = task.deleted_previous_status ?? 'pending';
      await database.runAsync(
        'UPDATE tasks SET status=?,deleted_at=NULL,deleted_previous_status=NULL,updated_at=? WHERE id=?',
        restoredStatus,
        now,
        id,
      );
      await recordTaskEvent(
        database,
        id,
        'restored',
        task.timezone,
        { status: restoredStatus },
        now,
      );
    } else {
      if (isDeleted) return;
      if (action === 'complete') {
        if (task.status !== 'pending') return;
        const completedDate = todayInTimezone(task.timezone);
        await database.runAsync(
          "UPDATE tasks SET status='completed',completed_at=?,completed_local_date=?,completed_timezone=?,updated_at=? WHERE id=? AND status='pending' AND deleted_at IS NULL",
          now,
          completedDate,
          task.timezone,
          now,
          id,
        );
        await recordTaskEvent(
          database,
          id,
          'completed',
          task.timezone,
          { completedAt: now, completedLocalDate: completedDate },
          now,
        );
      } else if (action === 'reopen') {
        if (task.status === 'pending') return;
        await database.runAsync(
          "UPDATE tasks SET status='pending',completed_at=NULL,completed_local_date=NULL,completed_timezone=NULL,updated_at=? WHERE id=? AND deleted_at IS NULL",
          now,
          id,
        );
        await recordTaskEvent(
          database,
          id,
          'reopened',
          task.timezone,
          { previousStatus: task.status },
          now,
        );
      } else if (action === 'cancel') {
        if (task.status !== 'pending') return;
        await database.runAsync(
          "UPDATE tasks SET status='cancelled',updated_at=? WHERE id=? AND status='pending' AND deleted_at IS NULL",
          now,
          id,
        );
        await recordTaskEvent(database, id, 'cancelled', task.timezone, {}, now);
      } else if (action === 'delete') {
        await database.runAsync(
          'UPDATE tasks SET deleted_at=?,deleted_previous_status=status,updated_at=? WHERE id=? AND deleted_at IS NULL',
          now,
          now,
          id,
        );
        await recordTaskEvent(
          database,
          id,
          'deleted',
          task.timezone,
          { previousStatus: task.status },
          now,
        );
      }
    }
    await enqueueLocalOperation(database, 'task', { action, taskId: id, occurredAt: now });
  });
  await reconcileReminders().catch(() => undefined);
}

export async function getDailyReview(localDate: string): Promise<DailyReview | null> {
  const database = await db();
  const row = await database.getFirstAsync<{
    local_date: string;
    timezone: string;
    note: string;
    went_well: string;
    improve: string;
    tomorrow_priority: string;
    updated_at: string;
  }>(
    'SELECT local_date,timezone,note,went_well,improve,tomorrow_priority,updated_at FROM daily_reviews WHERE local_date=?',
    localDate,
  );
  return row
    ? {
        localDate: row.local_date,
        timezone: row.timezone,
        note: row.note,
        wentWell: row.went_well,
        improve: row.improve,
        tomorrowPriority: row.tomorrow_priority,
        updatedAt: row.updated_at,
      }
    : null;
}

export async function saveDailyReview(
  localDate: string,
  timezone: string,
  input: DailyReviewInput,
): Promise<void> {
  const database = await db();
  const now = new Date().toISOString();
  await database.withTransactionAsync(async () => {
    await database.runAsync(
      'INSERT INTO daily_reviews (local_date,timezone,note,went_well,improve,tomorrow_priority,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(local_date) DO UPDATE SET timezone=excluded.timezone,note=excluded.note,went_well=excluded.went_well,improve=excluded.improve,tomorrow_priority=excluded.tomorrow_priority,updated_at=excluded.updated_at',
      localDate,
      timezone,
      input.wentWell.trim(),
      input.wentWell.trim(),
      input.improve.trim(),
      input.tomorrowPriority.trim(),
      now,
      now,
    );
    await enqueueLocalOperation(database, 'daily_review', {
      localDate,
      timezone,
      note: input.wentWell.trim(),
      wentWell: input.wentWell.trim(),
      improve: input.improve.trim(),
      tomorrowPriority: input.tomorrowPriority.trim(),
      updatedAt: now,
    });
  });
}
