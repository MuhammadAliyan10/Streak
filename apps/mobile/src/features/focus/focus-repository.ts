import type * as SQLite from 'expo-sqlite';
import { initializeLocalDatabase, enqueueLocalOperation } from '../../services/local-database';
import {
  createActivityLogsAtomically,
  deleteActivityLog,
  getHabitForDate,
  restoreActivityLog,
  updateActivityLog,
  type QuickActivity,
} from '../habits/habit-repository';
import { measurementForHabit } from '../habits/domain/activity-domain';
import { localDateAt } from '../habits/domain/habit-domain';
import {
  allocateIntervalsByLocalDate,
  elapsedFromMonotonic,
  type ActiveInterval,
} from './focus-domain';
import type { FocusSetup } from './focus-domain';
import {
  cancelFocusCompletion,
  scheduleFocusCompletion,
} from '../notifications/notification-service';

export type FocusStatus = 'running' | 'paused' | 'recovery' | 'review' | 'completed' | 'discarded';
export type FocusSession = {
  id: string;
  title: string;
  mode: 'stopwatch' | 'countdown';
  targetSeconds: number | null;
  startedAt: string;
  runningSince: string | null;
  activeMs: number;
  finishedAt: string | null;
  status: FocusStatus;
  recoveryCandidateMs: number;
  timezone: string;
  habitId: string | null;
  taskId: string | null;
  note: string;
  creditedSeconds: number | null;
  completedAt: string | null;
  revision: number;
  updatedAt: string;
};
export type FocusSessionLog = {
  id: string;
  localDate: string;
  creditedSeconds: number;
  active: boolean;
};

type SessionRow = {
  id: string;
  title: string;
  mode: 'stopwatch' | 'countdown';
  target_seconds: number | null;
  started_at: string;
  running_since: string | null;
  active_ms: number;
  finished_at: string | null;
  completed_at: string | null;
  status: FocusStatus;
  recovery_candidate_ms: number;
  timezone: string;
  habit_id: string | null;
  task_id: string | null;
  note: string;
  credited_seconds: number | null;
  revision: number;
  updated_at: string;
};
const anchors = new Map<string, { mono: number; wall: number; baseMs: number }>();
const nowIso = () => new Date().toISOString();
const monoNow = () => globalThis.performance?.now?.() ?? Date.now();
const id = (prefix: string) =>
  `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
async function db(): Promise<SQLite.SQLiteDatabase> {
  return initializeLocalDatabase();
}

function mapSession(row: SessionRow): FocusSession {
  return {
    id: row.id,
    title: row.title,
    mode: row.mode,
    targetSeconds: row.target_seconds,
    startedAt: row.started_at,
    runningSince: row.running_since,
    activeMs: row.active_ms,
    finishedAt: row.finished_at,
    status: row.status,
    recoveryCandidateMs: row.recovery_candidate_ms,
    timezone: row.timezone,
    habitId: row.habit_id,
    taskId: row.task_id,
    note: row.note,
    creditedSeconds: row.credited_seconds,
    completedAt: row.completed_at,
    revision: row.revision,
    updatedAt: row.updated_at,
  };
}
async function getRow(
  database: SQLite.SQLiteDatabase,
  sessionId: string,
): Promise<SessionRow | null> {
  return database.getFirstAsync<SessionRow>('SELECT * FROM focus_sessions WHERE id=?', sessionId);
}
async function event(
  database: SQLite.SQLiteDatabase,
  sessionId: string,
  type: string,
  details: Record<string, unknown> = {},
) {
  await database.runAsync(
    'INSERT INTO focus_session_events(id,session_id,event_type,occurred_at,details_json) VALUES(?,?,?,?,?)',
    id('focus-event'),
    sessionId,
    type,
    nowIso(),
    JSON.stringify(details),
  );
}
async function queueSession(
  database: SQLite.SQLiteDatabase,
  action: string,
  session: FocusSession,
  details: Record<string, unknown> = {},
) {
  await enqueueLocalOperation(database, 'focus_session', {
    action,
    sessionId: session.id,
    session,
    ...details,
  });
}

function anchorSession(session: FocusSession) {
  anchors.set(session.id, { mono: monoNow(), wall: Date.now(), baseMs: session.activeMs });
}
export function focusElapsedMilliseconds(session: FocusSession): number {
  if (session.status !== 'running') return session.activeMs;
  const anchor = anchors.get(session.id);
  if (anchor) return elapsedFromMonotonic(anchor.baseMs, anchor.mono, monoNow());
  if (!session.runningSince) return session.activeMs;
  return session.activeMs + Math.max(0, Date.now() - new Date(session.runningSince).getTime());
}

export async function startFocusSession(
  input: FocusSetup,
  routineLink?: { routineRunId: string; routineStepRunId: string },
): Promise<string> {
  const database = await db();
  const now = nowIso();
  const sessionId = id('focus-session');
  const targetSeconds = input.mode === 'countdown' ? Number(input.targetMinutes) * 60 : null;
  await database.withTransactionAsync(async () => {
    const existing = await database.getFirstAsync<{ id: string }>(
      "SELECT id FROM focus_sessions WHERE status IN ('running','paused','recovery','review') LIMIT 1",
    );
    if (existing) throw new Error('Finish or discard the current focus session first.');
    await database.runAsync(
      `INSERT INTO focus_sessions(id,title,mode,target_seconds,started_at,running_since,active_ms,status,timezone,habit_id,task_id,note,created_at,updated_at,routine_run_id,routine_step_run_id)
       VALUES(?,?,?,?,?,?,0,'running',?,?,?,?,?,?,?,?)`,
      sessionId,
      input.title.trim(),
      input.mode,
      targetSeconds,
      now,
      now,
      input.timezone,
      input.habitId || null,
      input.taskId || null,
      input.note.trim(),
      now,
      now,
      routineLink?.routineRunId ?? null,
      routineLink?.routineStepRunId ?? null,
    );
    if (routineLink) {
      await database.runAsync(
        "UPDATE routine_run_steps SET status='in_progress',started_at=COALESCE(started_at,?),linked_session_id=? WHERE id=? AND run_id=? AND status='pending'",
        now,
        sessionId,
        routineLink.routineStepRunId,
        routineLink.routineRunId,
      );
    }
    await database.runAsync(
      'INSERT INTO focus_session_intervals(id,session_id,started_at,created_at) VALUES(?,?,?,?)',
      id('focus-interval'),
      sessionId,
      now,
      now,
    );
    await event(database, sessionId, 'resumed', { initial: true });
    const session = await getRow(database, sessionId);
    if (!session) throw new Error('Could not create the focus session.');
    await queueSession(database, 'start', mapSession(session));
  });
  const row = await getRow(database, sessionId);
  if (!row) throw new Error('Could not start the focus session.');
  anchorSession(mapSession(row));
  if (row.mode === 'countdown' && row.target_seconds)
    await scheduleFocusCompletion(sessionId, row.title, row.target_seconds).catch(() => undefined);
  return sessionId;
}

export async function getFocusSession(sessionId: string): Promise<FocusSession | null> {
  const database = await db();
  const row = await getRow(database, sessionId);
  if (!row) return null;
  if (row.status === 'running' && !anchors.has(row.id)) return markRecoveryRequired(database, row);
  return mapSession(row);
}

export async function getCurrentFocusSession(): Promise<FocusSession | null> {
  const database = await db();
  const row = await database.getFirstAsync<SessionRow>(
    "SELECT * FROM focus_sessions WHERE status IN ('running','paused','recovery','review') ORDER BY created_at DESC LIMIT 1",
  );
  if (!row) return null;
  if (row.status === 'running' && !anchors.has(row.id)) return markRecoveryRequired(database, row);
  return mapSession(row);
}

async function markRecoveryRequired(
  database: SQLite.SQLiteDatabase,
  row: SessionRow,
): Promise<FocusSession> {
  const diff = Date.now() - new Date(row.running_since ?? row.started_at).getTime();
  const candidate = Number.isFinite(diff) && diff >= 0 && diff <= 12 * 60 * 60 * 1000 ? diff : 0;
  const now = nowIso();
  await database.withTransactionAsync(async () => {
    await database.runAsync(
      "UPDATE focus_sessions SET status='recovery',recovery_candidate_ms=?,running_since=NULL,updated_at=? WHERE id=? AND status='running'",
      candidate,
      now,
      row.id,
    );
    await event(database, row.id, 'recovery_required', { candidateMs: candidate });
  });
  anchors.delete(row.id);
  await cancelFocusCompletion(row.id).catch(() => undefined);
  const updated = await getRow(database, row.id);
  if (!updated) throw new Error('Could not restore this focus session.');
  return mapSession(updated);
}

export async function recordFocusAppState(
  sessionId: string,
  state: 'backgrounded' | 'foregrounded',
) {
  const database = await db();
  const session = await getRow(database, sessionId);
  if (!session || session.status !== 'running') return;
  await event(database, sessionId, state);
}

export async function pauseFocusSession(sessionId: string): Promise<void> {
  const database = await db();
  const row = await getRow(database, sessionId);
  if (!row || row.status !== 'running') throw new Error('This session is not running.');
  const anchor = anchors.get(sessionId);
  if (!anchor) {
    await markRecoveryRequired(database, row);
    throw new Error('Review recovered time before pausing.');
  }
  const monoDelta = Math.max(0, monoNow() - anchor.mono);
  const wallNow = Date.now();
  const drift = Math.abs(wallNow - anchor.wall - monoDelta);
  const end = nowIso();
  if (drift > 120_000) {
    await markRecoveryRequired(database, row);
    throw new Error('The device clock changed. Review the session time before continuing.');
  }
  const activeMs = row.active_ms + Math.floor(monoDelta);
  await database.withTransactionAsync(async () => {
    await database.runAsync(
      'UPDATE focus_session_intervals SET ended_at=?,duration_ms=? WHERE session_id=? AND ended_at IS NULL',
      end,
      Math.floor(monoDelta),
      sessionId,
    );
    await database.runAsync(
      "UPDATE focus_sessions SET status='paused',running_since=NULL,active_ms=?,updated_at=? WHERE id=? AND status='running'",
      activeMs,
      end,
      sessionId,
    );
    await event(database, sessionId, 'paused');
    const updated = await getRow(database, sessionId);
    if (updated) await queueSession(database, 'pause', mapSession(updated));
  });
  anchors.delete(sessionId);
  await cancelFocusCompletion(sessionId).catch(() => undefined);
}

export async function resumeFocusSession(sessionId: string): Promise<void> {
  const database = await db();
  const now = nowIso();
  await database.withTransactionAsync(async () => {
    const row = await getRow(database, sessionId);
    if (!row || row.status !== 'paused') throw new Error('This session cannot be resumed.');
    await database.runAsync(
      "UPDATE focus_sessions SET status='running',running_since=?,updated_at=? WHERE id=? AND status='paused'",
      now,
      now,
      sessionId,
    );
    await database.runAsync(
      'INSERT INTO focus_session_intervals(id,session_id,started_at,created_at) VALUES(?,?,?,?)',
      id('focus-interval'),
      sessionId,
      now,
      now,
    );
    await event(database, sessionId, 'resumed');
    const updated = await getRow(database, sessionId);
    if (updated) {
      anchorSession(mapSession(updated));
      await queueSession(database, 'resume', mapSession(updated));
    }
  });
  const resumed = await getRow(database, sessionId);
  if (resumed?.mode === 'countdown' && resumed.target_seconds) {
    const remaining = Math.ceil((resumed.target_seconds * 1000 - resumed.active_ms) / 1000);
    await scheduleFocusCompletion(sessionId, resumed.title, remaining).catch(() => undefined);
  }
}

export async function resetPausedFocusSession(sessionId: string): Promise<void> {
  const database = await db();
  const now = nowIso();
  await database.withTransactionAsync(async () => {
    const session = await getRow(database, sessionId);
    if (!session || session.status !== 'paused')
      throw new Error('Pause the session before resetting it.');
    await database.runAsync('DELETE FROM focus_session_intervals WHERE session_id=?', sessionId);
    await database.runAsync(
      "UPDATE focus_sessions SET started_at=?,active_ms=0,running_since=NULL,finished_at=NULL,recovery_candidate_ms=0,updated_at=? WHERE id=? AND status='paused'",
      now,
      now,
      sessionId,
    );
    await event(database, sessionId, 'reset');
    const updated = await getRow(database, sessionId);
    if (updated) await queueSession(database, 'reset', mapSession(updated));
  });
  await cancelFocusCompletion(sessionId).catch(() => undefined);
}

export async function finishFocusSession(sessionId: string): Promise<void> {
  const database = await db();
  const row = await getRow(database, sessionId);
  if (!row) throw new Error('This session could not be found.');
  if (row.status === 'review' || row.status === 'completed') return;
  if (!['running', 'paused'].includes(row.status))
    throw new Error('Review this session before finishing.');
  let activeMs = row.active_ms;
  const end = nowIso();
  if (row.status === 'running') {
    const anchor = anchors.get(sessionId);
    if (!anchor) {
      await markRecoveryRequired(database, row);
      throw new Error('Review recovered time before finishing.');
    }
    const delta = Math.max(0, monoNow() - anchor.mono);
    const drift = Math.abs(Date.now() - anchor.wall - delta);
    if (drift > 120_000) {
      await markRecoveryRequired(database, row);
      throw new Error('The device clock changed. Review the session time before finishing.');
    }
    activeMs += Math.floor(delta);
    if (row.target_seconds !== null) activeMs = Math.min(activeMs, row.target_seconds * 1000);
    const intervalDuration = Math.max(0, activeMs - row.active_ms);
    await database.withTransactionAsync(async () => {
      await database.runAsync(
        'UPDATE focus_session_intervals SET ended_at=?,duration_ms=? WHERE session_id=? AND ended_at IS NULL',
        end,
        intervalDuration,
        sessionId,
      );
      await database.runAsync(
        "UPDATE focus_sessions SET status='review',running_since=NULL,active_ms=?,finished_at=?,updated_at=? WHERE id=? AND status IN ('running','paused')",
        activeMs,
        end,
        end,
        sessionId,
      );
      await event(database, sessionId, 'finished', { activeMs });
      const updated = await getRow(database, sessionId);
      if (updated) await queueSession(database, 'finish', mapSession(updated));
    });
  } else {
    if (row.target_seconds !== null) activeMs = Math.min(activeMs, row.target_seconds * 1000);
    await database.withTransactionAsync(async () => {
      await database.runAsync(
        "UPDATE focus_sessions SET status='review',running_since=NULL,active_ms=?,finished_at=?,updated_at=? WHERE id=? AND status IN ('running','paused')",
        activeMs,
        end,
        end,
        sessionId,
      );
      await event(database, sessionId, 'finished', { activeMs });
      const updated = await getRow(database, sessionId);
      if (updated) await queueSession(database, 'finish', mapSession(updated));
    });
  }
  anchors.delete(sessionId);
  await cancelFocusCompletion(sessionId).catch(() => undefined);
}

export async function resolveFocusRecovery(
  sessionId: string,
  includeCandidate: boolean,
): Promise<void> {
  const database = await db();
  const now = nowIso();
  await database.withTransactionAsync(async () => {
    const row = await getRow(database, sessionId);
    if (!row || row.status !== 'recovery') throw new Error('This session does not need recovery.');
    const activeMs = row.active_ms + (includeCandidate ? row.recovery_candidate_ms : 0);
    const interval = await database.getFirstAsync<{ id: string }>(
      'SELECT id FROM focus_session_intervals WHERE session_id=? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1',
      sessionId,
    );
    if (interval) {
      const start = await database.getFirstAsync<{ started_at: string }>(
        'SELECT started_at FROM focus_session_intervals WHERE id=?',
        interval.id,
      );
      const duration = includeCandidate ? row.recovery_candidate_ms : 0;
      await database.runAsync(
        'UPDATE focus_session_intervals SET ended_at=?,duration_ms=? WHERE id=?',
        includeCandidate ? now : (start?.started_at ?? now),
        duration,
        interval.id,
      );
    }
    await database.runAsync(
      "UPDATE focus_sessions SET status='paused',active_ms=?,recovery_candidate_ms=0,updated_at=? WHERE id=? AND status='recovery'",
      activeMs,
      now,
      sessionId,
    );
    await event(database, sessionId, 'recovered', {
      includedMs: includeCandidate ? row.recovery_candidate_ms : 0,
    });
    const updated = await getRow(database, sessionId);
    if (updated) await queueSession(database, 'recover', mapSession(updated));
  });
  await cancelFocusCompletion(sessionId).catch(() => undefined);
}

export async function discardFocusSession(sessionId: string): Promise<void> {
  const database = await db();
  const now = nowIso();
  await database.withTransactionAsync(async () => {
    const row = await getRow(database, sessionId);
    if (!row || ['completed', 'discarded'].includes(row.status)) return;
    await database.runAsync(
      "UPDATE focus_sessions SET status='discarded',running_since=NULL,finished_at=?,updated_at=? WHERE id=?",
      now,
      now,
      sessionId,
    );
    await event(database, sessionId, 'discarded');
    const updated = await getRow(database, sessionId);
    if (updated) await queueSession(database, 'discard', mapSession(updated));
    const link = await database.getFirstAsync<{
      routine_run_id: string | null;
      routine_step_run_id: string | null;
    }>('SELECT routine_run_id,routine_step_run_id FROM focus_sessions WHERE id=?', sessionId);
    if (link?.routine_step_run_id) {
      await database.runAsync(
        "UPDATE routine_run_steps SET status='pending',started_at=NULL,linked_session_id=NULL WHERE id=? AND status='in_progress'",
        link.routine_step_run_id,
      );
      await enqueueLocalOperation(database, 'routine_run_step', {
        action: 'timer_discard',
        runId: link.routine_run_id,
        runStepId: link.routine_step_run_id,
        occurredAt: now,
      });
    }
  });
  anchors.delete(sessionId);
  await cancelFocusCompletion(sessionId).catch(() => undefined);
}

async function intervalsForSession(
  database: SQLite.SQLiteDatabase,
  session: FocusSession,
): Promise<ActiveInterval[]> {
  const rows = await database.getAllAsync<{ started_at: string; ended_at: string | null }>(
    'SELECT started_at,ended_at FROM focus_session_intervals WHERE session_id=? ORDER BY started_at',
    session.id,
  );
  return rows
    .filter((row): row is { started_at: string; ended_at: string } => !!row.ended_at)
    .map((row) => ({ startedAt: row.started_at, endedAt: row.ended_at }));
}

function scaleAllocations(
  allocations: ReturnType<typeof allocateIntervalsByLocalDate>,
  totalSeconds: number,
) {
  if (!allocations.length) return [];
  const total = allocations.reduce((sum, item) => sum + item.seconds, 0);
  if (!total) return [];
  let used = 0;
  return allocations
    .map((item, index) => {
      const seconds =
        index === allocations.length - 1
          ? totalSeconds - used
          : Math.floor((totalSeconds * item.seconds) / total);
      used += seconds;
      return { ...item, seconds };
    })
    .filter((item) => item.seconds > 0);
}

export async function saveFocusSession(sessionId: string, creditedSeconds: number): Promise<void> {
  if (!Number.isInteger(creditedSeconds) || creditedSeconds < 1 || creditedSeconds > 86400)
    throw new Error('Choose a valid credited duration.');
  const database = await db();
  const row = await getRow(database, sessionId);
  if (!row || row.status !== 'review') throw new Error('This session is not ready to save.');
  const session = mapSession(row);
  const intervals = await intervalsForSession(database, session);
  const base = allocateIntervalsByLocalDate(intervals, session.timezone);
  let allocations = scaleAllocations(base, creditedSeconds);
  if (!allocations.length) {
    const localDate = localDateAt(new Date(session.startedAt), session.timezone);
    allocations = [{ localDate, seconds: creditedSeconds, startedAt: session.startedAt }];
  }
  const habitCandidate = session.habitId
    ? await getHabitForDate(session.habitId, allocations[0]!.localDate)
    : null;
  const durationHabit =
    habitCandidate &&
    habitCandidate.status !== 'archived' &&
    habitCandidate.kind === 'good' &&
    measurementForHabit(habitCandidate.measurement, habitCandidate.unit) === 'duration'
      ? habitCandidate
      : null;
  const activities: QuickActivity[] = [];
  for (const item of allocations) {
    const habit = session.habitId ? await getHabitForDate(session.habitId, item.localDate) : null;
    const linkedHabit =
      durationHabit &&
      habit &&
      habit.status !== 'archived' &&
      measurementForHabit(habit.measurement, habit.unit) === 'duration'
        ? habit
        : null;
    const activity: QuickActivity = {
      idempotencyKey: `focus:${session.id}:r${session.revision}:${item.localDate}`,
      habit: linkedHabit,
      category: linkedHabit ? 'habit' : 'other',
      title: session.title,
      measurement: 'duration',
      kind: 'progress',
      value: item.seconds,
      unit: 's',
      note: session.note,
      occurredAt: item.startedAt,
      timezone: session.timezone,
      focusSessionId: session.id,
    };
    activities.push(activity);
  }
  const logIds = await createActivityLogsAtomically(activities);
  for (const [index, item] of allocations.entries()) {
    await database.runAsync(
      `INSERT INTO focus_session_activity_logs(session_id,activity_log_id,local_date,credited_seconds,revision,active)
       VALUES(?,?,?,?,?,1) ON CONFLICT(session_id,activity_log_id) DO UPDATE SET local_date=excluded.local_date,credited_seconds=excluded.credited_seconds,revision=excluded.revision,active=1`,
      session.id,
      logIds[index]!,
      item.localDate,
      item.seconds,
      session.revision,
    );
  }
  const completed = nowIso();
  await database.withTransactionAsync(async () => {
    await database.runAsync(
      "UPDATE focus_sessions SET status='completed',credited_seconds=?,completed_at=?,updated_at=? WHERE id=? AND status='review'",
      creditedSeconds,
      completed,
      completed,
      session.id,
    );
    await event(database, session.id, 'saved', { creditedSeconds });
    const link = await database.getFirstAsync<{
      routine_run_id: string | null;
      routine_step_run_id: string | null;
    }>('SELECT routine_run_id,routine_step_run_id FROM focus_sessions WHERE id=?', session.id);
    if (link?.routine_step_run_id) {
      await database.runAsync(
        "UPDATE routine_run_steps SET status='completed',completed_at=?,linked_activity_id=?,linked_session_id=? WHERE id=? AND status IN ('pending','in_progress')",
        completed,
        logIds[0] ?? null,
        session.id,
        link.routine_step_run_id,
      );
      await enqueueLocalOperation(database, 'routine_run_step', {
        action: 'timer_complete',
        runId: link.routine_run_id,
        runStepId: link.routine_step_run_id,
        sessionId: session.id,
        activityId: logIds[0] ?? null,
        occurredAt: completed,
      });
    }
    const updated = await getRow(database, session.id);
    if (updated) await queueSession(database, 'save', mapSession(updated));
  });
}

export async function correctSavedFocusSession(
  sessionId: string,
  creditedSeconds: number,
): Promise<void> {
  if (!Number.isInteger(creditedSeconds) || creditedSeconds < 1 || creditedSeconds > 604800) {
    throw new Error('Choose a valid credited duration.');
  }
  const database = await db();
  const row = await getRow(database, sessionId);
  if (!row || row.status !== 'completed')
    throw new Error('This saved session cannot be corrected.');
  const session = mapSession(row);
  const revision = session.revision + 1;
  const base = allocateIntervalsByLocalDate(
    await intervalsForSession(database, session),
    session.timezone,
  );
  const allocations = scaleAllocations(base, creditedSeconds);
  if (!allocations.length) throw new Error('Session intervals are unavailable for correction.');
  const linkedRows = await database.getAllAsync<{
    activity_log_id: string;
    local_date: string;
    active: number;
  }>(
    'SELECT activity_log_id,local_date,active FROM focus_session_activity_logs WHERE session_id=?',
    session.id,
  );
  const activeByDate = new Map(
    linkedRows
      .filter((entry) => entry.active)
      .map((entry) => [entry.local_date, entry.activity_log_id]),
  );
  const newActivities: QuickActivity[] = [];
  const newDates: string[] = [];
  for (const item of allocations) {
    const habit = session.habitId ? await getHabitForDate(session.habitId, item.localDate) : null;
    const linkedHabit =
      habit &&
      habit.status !== 'archived' &&
      habit.kind === 'good' &&
      measurementForHabit(habit.measurement, habit.unit) === 'duration'
        ? habit
        : null;
    const activity: QuickActivity = {
      idempotencyKey: `focus:${session.id}:r${revision}:${item.localDate}`,
      habit: linkedHabit,
      category: linkedHabit ? 'habit' : 'other',
      title: session.title,
      measurement: 'duration',
      kind: 'progress',
      value: item.seconds,
      unit: 's',
      note: session.note,
      occurredAt: item.startedAt,
      timezone: session.timezone,
      focusSessionId: session.id,
    };
    const existingId = activeByDate.get(item.localDate);
    if (existingId) {
      await updateActivityLog(existingId, activity);
      await database.runAsync(
        'UPDATE focus_session_activity_logs SET credited_seconds=?,revision=?,active=1 WHERE session_id=? AND activity_log_id=?',
        item.seconds,
        revision,
        session.id,
        existingId,
      );
    } else {
      newActivities.push(activity);
      newDates.push(item.localDate);
    }
  }
  const newLogIds = await createActivityLogsAtomically(newActivities);
  for (const [index, activityLogId] of newLogIds.entries()) {
    const item = allocations.find((allocation) => allocation.localDate === newDates[index]);
    if (!item) continue;
    await database.runAsync(
      `INSERT INTO focus_session_activity_logs(session_id,activity_log_id,local_date,credited_seconds,revision,active)
       VALUES(?,?,?,?,?,1) ON CONFLICT(session_id,activity_log_id) DO UPDATE SET local_date=excluded.local_date,credited_seconds=excluded.credited_seconds,revision=excluded.revision,active=1`,
      session.id,
      activityLogId,
      item.localDate,
      item.seconds,
      revision,
    );
  }
  const allocatedDates = new Set(allocations.map((item) => item.localDate));
  for (const previous of linkedRows) {
    if (previous.active && !allocatedDates.has(previous.local_date)) {
      await deleteActivityLog(previous.activity_log_id);
      await database.runAsync(
        'UPDATE focus_session_activity_logs SET active=0 WHERE session_id=? AND activity_log_id=?',
        session.id,
        previous.activity_log_id,
      );
    }
  }
  const now = nowIso();
  await database.withTransactionAsync(async () => {
    await database.runAsync(
      "UPDATE focus_sessions SET credited_seconds=?,revision=?,updated_at=? WHERE id=? AND status='completed'",
      creditedSeconds,
      revision,
      now,
      session.id,
    );
    await event(database, session.id, 'credit_corrected', { creditedSeconds, revision });
    const updated = await getRow(database, session.id);
    if (updated) await queueSession(database, 'correct', mapSession(updated));
  });
}

export async function deleteSavedFocusSession(sessionId: string): Promise<void> {
  const database = await db();
  const session = await getRow(database, sessionId);
  if (!session || session.status !== 'completed')
    throw new Error('This saved session cannot be removed.');
  const logs = await database.getAllAsync<{ activity_log_id: string; active: number }>(
    'SELECT activity_log_id,active FROM focus_session_activity_logs WHERE session_id=?',
    sessionId,
  );
  for (const log of logs) {
    if (!log.active) continue;
    await deleteActivityLog(log.activity_log_id);
    await database.runAsync(
      'UPDATE focus_session_activity_logs SET active=0 WHERE session_id=? AND activity_log_id=?',
      sessionId,
      log.activity_log_id,
    );
  }
  const now = nowIso();
  await database.withTransactionAsync(async () => {
    await database.runAsync(
      "UPDATE focus_sessions SET status='discarded',updated_at=? WHERE id=? AND status='completed'",
      now,
      sessionId,
    );
    await event(database, sessionId, 'discarded', { savedSession: true });
    const updated = await getRow(database, sessionId);
    if (updated) await queueSession(database, 'delete_saved', mapSession(updated));
  });
}

export async function restoreSavedFocusSession(sessionId: string): Promise<void> {
  const database = await db();
  const session = await getRow(database, sessionId);
  if (!session || session.status !== 'discarded' || session.completed_at === null) {
    throw new Error('This removed session cannot be restored.');
  }
  const logs = await database.getAllAsync<{ activity_log_id: string; active: number }>(
    'SELECT activity_log_id,active FROM focus_session_activity_logs WHERE session_id=?',
    sessionId,
  );
  for (const log of logs) {
    if (log.active) continue;
    await restoreActivityLog(log.activity_log_id);
    await database.runAsync(
      'UPDATE focus_session_activity_logs SET active=1 WHERE session_id=? AND activity_log_id=?',
      sessionId,
      log.activity_log_id,
    );
  }
  const now = nowIso();
  await database.withTransactionAsync(async () => {
    await database.runAsync(
      "UPDATE focus_sessions SET status='completed',updated_at=? WHERE id=? AND status='discarded'",
      now,
      sessionId,
    );
    await event(database, sessionId, 'recovered', { restoredSavedSession: true });
    const updated = await getRow(database, sessionId);
    if (updated) await queueSession(database, 'restore_saved', mapSession(updated));
  });
}

export async function getFocusSessionLogs(sessionId: string): Promise<FocusSessionLog[]> {
  const database = await db();
  const rows = await database.getAllAsync<{
    id: string;
    local_date: string;
    credited_seconds: number;
    active: number;
  }>(
    `SELECT l.id,a.local_date,a.credited_seconds,a.active FROM focus_session_activity_logs a
     JOIN activity_logs l ON l.id=a.activity_log_id WHERE a.session_id=? ORDER BY a.local_date`,
    sessionId,
  );
  return rows.map((row) => ({
    id: row.id,
    localDate: row.local_date,
    creditedSeconds: row.credited_seconds,
    active: Boolean(row.active),
  }));
}
