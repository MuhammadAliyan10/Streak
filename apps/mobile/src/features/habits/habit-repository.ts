import type * as SQLite from 'expo-sqlite';
import { enqueueLocalOperation, initializeLocalDatabase } from '../../services/local-database';
import {
  dateAdd,
  localDateAt,
  todayInTimezone,
  type HabitInput,
  type HabitKind,
  type StreakSummary,
  calculateStreak,
} from './domain/habit-domain';
import {
  fromCanonical,
  measurementForHabit,
  toCanonical,
  type MeasurementKind,
  type PresetInput,
} from './domain/activity-domain';
import { reconcileReminders } from '../notifications/notification-service';
import { isWalkingDistanceHabit, type WalkingTrackingMode } from './walking-tracking';
import { effectiveWalkingProgress } from './walking-tracking-domain';
import { digitalUsageStatus } from './digital-usage-domain';

export type HabitRecord = {
  id: string;
  name: string;
  kind: HabitKind;
  description: string;
  icon: string;
  color: string;
  status: 'active' | 'paused' | 'archived';
  scheduleId: string;
  scheduleMode: 'anytime' | 'fixed' | 'flexible';
  weekdayMask: number;
  timezone: string;
  startDate: string;
  endDate: string | null;
  fixedTime: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  targetId: string;
  measurement: string;
  digitalUsage: boolean;
  targetMode: 'minimum' | 'maximum';
  trackingMethod: 'manual' | 'automatic';
  usageConfirmed: boolean;
  usageStatus: 'below_so_far' | 'within_limit' | 'over_limit' | 'unknown' | null;
  targetValue: number;
  canonicalTargetValue: number;
  configuredTargetValue: number;
  configuredUnit: string;
  unit: string;
  progress: number;
  trackingMode: WalkingTrackingMode;
  deviceSnapshotRefreshedAt: string | null;
  occurrenceCount: number;
  incidentDays: number;
  todayState: string;
  streak: StreakSummary;
};
export type ActivityEntry = {
  id: string;
  idempotency_key: string;
  kind: string;
  value: number | null;
  unit: string | null;
  note: string;
  occurred_at: string;
  created_at: string;
  local_date: string;
  measurement: MeasurementKind;
  input_value: number | null;
  input_unit: string | null;
  preset_id: string | null;
  preset_name: string | null;
  deleted_at: string | null;
  correction_count: number;
  value_mode: 'increment' | 'daily_total';
  source: 'manual' | 'manual_daily_total' | 'android_usage' | 'ios_device_activity';
  category: string;
  title: string;
  timezone: string;
  habit_id: string | null;
  habit_name: string | null;
  focus_session_id: string | null;
  goal_id?: string | null;
};
export type HabitEntry = ActivityEntry;
export type HabitTimelineEntry = ActivityEntry & {
  habit_kind: HabitKind | null;
  planned_mode: 'anytime' | 'fixed' | 'flexible' | null;
  planned_time: string | null;
  window_start: string | null;
  window_end: string | null;
};
export type ActivityPreset = {
  id: string;
  habitId: string;
  name: string;
  measurement: MeasurementKind;
  value: number;
  unit: string;
  inputValue: number;
  inputUnit: string;
  isDefault: boolean;
  sortOrder: number;
};
export type QuickActivity = {
  id?: string;
  idempotencyKey: string;
  habit: HabitRecord | null;
  category: string;
  title: string;
  measurement: MeasurementKind;
  kind?: 'progress' | 'complete_override' | 'occurrence' | 'clean' | 'skip';
  value: number | null;
  unit: string | null;
  note?: string;
  occurredAt: string;
  timezone: string;
  presetId?: string | null;
  presetName?: string | null;
  focusSessionId?: string | null;
  goalId?: string | null;
};
export type HabitBundle = {
  habit: HabitRecord;
  entries: HabitEntry[];
  history: Array<{
    event_type: string;
    details_json: string;
    occurred_at: string;
    local_date: string;
  }>;
};

async function db(): Promise<SQLite.SQLiteDatabase> {
  return initializeLocalDatabase();
}
function key(): string {
  const randomPart = Array.from({ length: 16 }, () =>
    Math.floor(Math.random() * 256)
      .toString(16)
      .padStart(2, '0'),
  ).join('');
  return `activity:${Date.now()}:${randomPart}`;
}
function mask(days: number[]): number {
  return days.reduce((value, day) => value | (1 << day), 0);
}
async function recordHistory(
  database: SQLite.SQLiteDatabase,
  habitId: string,
  type: string,
  timezone: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  const now = new Date();
  await database.runAsync(
    'INSERT INTO habit_history (habit_id,event_type,details_json,occurred_at,local_date,timezone) VALUES (?,?,?,?,?,?)',
    habitId,
    type,
    JSON.stringify(details),
    now.toISOString(),
    todayInTimezone(timezone),
    timezone,
  );
}
export async function listHabits(
  filter: 'all' | HabitKind = 'all',
  includeArchived = false,
  forDate?: string,
): Promise<HabitRecord[]> {
  const database = await db();
  const rows = await database.getAllAsync<{
    id: string;
    name: string;
    kind: HabitKind;
    description: string;
    icon: string;
    color: string;
    status: 'active' | 'paused' | 'archived';
    created_at: string;
  }>(
    `SELECT id,name,kind,description,icon,color,status,created_at FROM habits WHERE (?=1 OR status != 'archived') ORDER BY created_at DESC`,
    includeArchived ? 1 : 0,
  );
  // Local day lookup is performed in JS so SQLite does not need a custom timezone function.
  const records: HabitRecord[] = [];
  for (const row of rows) {
    const versions = await database.getAllAsync<{
      id: string;
      mode: 'anytime' | 'fixed' | 'flexible';
      weekday_mask: number;
      timezone: string;
      effective_from: string;
      effective_to: string | null;
      fixed_time: string | null;
      window_start: string | null;
      window_end: string | null;
    }>(
      'SELECT id,mode,weekday_mask,timezone,effective_from,effective_to,fixed_time,window_start,window_end FROM habit_schedules WHERE habit_id=? ORDER BY effective_from DESC',
      row.id,
    );
    const schedule = versions.find((item) => {
      const localDay = forDate ?? todayInTimezone(item.timezone);
      return (
        item.effective_from <= localDay && (!item.effective_to || item.effective_to >= localDay)
      );
    });
    if (!schedule) continue;
    const targets = await database.getAllAsync<{
      id: string;
      measurement: string;
      target_value: number;
      unit: string;
      target_mode: 'minimum' | 'maximum';
      tracking_method: 'manual' | 'automatic';
      effective_from: string;
      effective_to: string | null;
    }>(
      'SELECT id,measurement,target_value,unit,target_mode,tracking_method,effective_from,effective_to FROM habit_targets WHERE habit_id=? ORDER BY effective_from DESC',
      row.id,
    );
    const targetVersion = targets.find(
      (item) =>
        item.effective_from <= (forDate ?? todayInTimezone(schedule.timezone)) &&
        (!item.effective_to ||
          item.effective_to >= (forDate ?? todayInTimezone(schedule.timezone))),
    );
    if (!targetVersion) continue;
    const selectedDay = forDate ?? todayInTimezone(schedule.timezone);
    const today = todayInTimezone(schedule.timezone);
    const isDigitalLimit =
      targetVersion.target_mode === 'maximum' &&
      ['duration', 'count'].includes(targetVersion.measurement);
    const digitalMeasure = measurementForHabit(targetVersion.measurement, targetVersion.unit);
    const digitalCanonicalUnit = isDigitalLimit
      ? toCanonical(1, digitalMeasure, targetVersion.unit).unit
      : '';
    const progress = await database.getFirstAsync<{ total: number | null; confirmed: number }>(
      `SELECT COALESCE(
          (SELECT value FROM digital_usage_daily_totals WHERE habit_id=? AND local_date=?
            AND (?=1 AND measurement=?) LIMIT 1),
          (SELECT SUM(value) FROM activity_logs WHERE habit_id=? AND local_date=? AND kind='progress'
            AND deleted_at IS NULL AND (?=0 OR (measurement=? AND unit=?)))
        ) total,
        EXISTS(SELECT 1 FROM digital_usage_daily_totals WHERE habit_id=? AND local_date=?
          AND (?=1 AND measurement=?)) confirmed`,
      row.id,
      selectedDay,
      Number(isDigitalLimit),
      targetVersion.measurement,
      row.id,
      selectedDay,
      Number(isDigitalLimit),
      targetVersion.measurement,
      digitalCanonicalUnit,
      row.id,
      selectedDay,
      Number(isDigitalLimit),
      targetVersion.measurement,
    );
    const trackingMode: WalkingTrackingMode = isWalkingDistanceHabit(
      row.name,
      targetVersion.measurement,
    )
      ? ((
          await database.getFirstAsync<{ mode: WalkingTrackingMode }>(
            'SELECT mode FROM walking_tracking_preferences WHERE habit_id=?',
            row.id,
          )
        )?.mode ?? 'manual')
      : 'manual';
    const deviceSnapshots =
      trackingMode === 'automatic'
        ? await database.getAllAsync<{
            local_date: string;
            value: number;
            refreshed_at: string;
          }>(
            'SELECT local_date,value,refreshed_at FROM walking_device_snapshots WHERE habit_id=? AND measurement=?',
            row.id,
            'distance',
          )
        : [];
    const deviceToday = deviceSnapshots.find((snapshot) => snapshot.local_date === selectedDay);
    const entryRows = await database.getAllAsync<{
      local_date: string;
      kind: string;
      value: number | null;
    }>(
      'SELECT local_date,kind,value FROM activity_logs WHERE habit_id=? AND deleted_at IS NULL ORDER BY local_date',
      row.id,
    );
    const digitalTotals = await database.getAllAsync<{
      local_date: string;
      value: number;
    }>(
      'SELECT local_date,value FROM digital_usage_daily_totals WHERE habit_id=? AND measurement=?',
      row.id,
      targetVersion.measurement,
    );
    const pauses = await database.getAllAsync<{ started_on: string; resumed_on: string | null }>(
      'SELECT started_on,resumed_on FROM habit_pauses WHERE habit_id=?',
      row.id,
    );
    const snapshotDates = new Set(deviceSnapshots.map((snapshot) => snapshot.local_date));
    const digitalUsage = isDigitalLimit;
    const baseEntries = [
      ...entryRows
        .filter((item) => !(item.kind === 'progress' && snapshotDates.has(item.local_date)))
        .map((item) => ({ date: item.local_date, kind: item.kind, value: item.value })),
      ...deviceSnapshots.map((snapshot) => ({
        date: snapshot.local_date,
        kind: 'progress',
        value: snapshot.value,
      })),
    ];
    const measurementKind = measurementForHabit(targetVersion.measurement, targetVersion.unit);
    const entries = digitalUsage
      ? digitalTotals.flatMap((entry) => {
          const historicalTarget = targets.find(
            (item) =>
              item.effective_from <= entry.local_date &&
              (!item.effective_to || item.effective_to >= entry.local_date),
          );
          if (!historicalTarget) return [];
          const limit = toCanonical(
            historicalTarget.target_value,
            measurementForHabit(historicalTarget.measurement, historicalTarget.unit),
            historicalTarget.unit,
          ).value;
          return [
            {
              date: entry.local_date,
              kind: entry.value <= limit ? 'clean' : 'occurrence',
              value: null,
            },
          ];
        })
      : baseEntries;
    const canonicalTarget =
      targetVersion.measurement === 'check_off' || targetVersion.measurement === 'avoidance'
        ? 1
        : toCanonical(targetVersion.target_value, measurementKind, targetVersion.unit).value;
    const progressInConfiguredUnit = fromCanonical(
      effectiveWalkingProgress(progress?.total ?? 0, deviceToday?.value ?? null),
      measurementKind,
      targetVersion.unit,
    );
    const target =
      targetVersion.measurement === 'check_off' || targetVersion.measurement === 'avoidance'
        ? 1
        : targetVersion.target_value;
    const effectiveKind: HabitKind =
      targetVersion.measurement === 'avoidance' || digitalUsage ? 'bad' : 'good';
    const usageStatus = digitalUsage
      ? digitalUsageStatus({
          observed: progress?.total == null ? null : progressInConfiguredUnit,
          limit: targetVersion.target_value,
          confirmed: progress?.confirmed === 1,
        })
      : null;
    const occurrenceStats = await database.getFirstAsync<{ count: number; days: number }>(
      "SELECT COUNT(*) count,COUNT(DISTINCT local_date) days FROM activity_logs WHERE habit_id=? AND kind='occurrence' AND deleted_at IS NULL",
      row.id,
    );
    const localTime = new Intl.DateTimeFormat('en-GB', {
      timeZone: schedule.timezone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date());
    const deadline =
      schedule.mode === 'fixed'
        ? schedule.fixed_time
        : schedule.mode === 'flexible'
          ? schedule.window_end
          : null;
    const deadlinePassedToday = !!deadline && localTime >= deadline;
    const streak = calculateStreak({
      kind: effectiveKind,
      schedule: {
        weekdayMask: schedule.weekday_mask,
        startDate: schedule.effective_from,
        endDate: schedule.effective_to,
        mode: schedule.mode,
        windowEnd: schedule.window_end,
      },
      scheduleHistory: versions.map((item) => ({
        weekdayMask: item.weekday_mask,
        startDate: item.effective_from,
        endDate: item.effective_to,
        mode: item.mode,
        windowEnd: item.window_end,
      })),
      targetHistory: targets.map((item) => ({
        value:
          item.measurement === 'check_off' || item.measurement === 'avoidance'
            ? 1
            : toCanonical(
                item.target_value,
                measurementForHabit(item.measurement, item.unit),
                item.unit,
              ).value,
        kind:
          item.measurement === 'avoidance' ||
          (item.target_mode === 'maximum' && ['duration', 'count'].includes(item.measurement))
            ? 'bad'
            : 'good',
        startDate: item.effective_from,
        endDate: item.effective_to,
      })),
      target,
      today,
      deadlinePassedToday,
      entries,
      pauses: pauses.map((pause) => ({ start: pause.started_on, end: pause.resumed_on })),
      rangeStart: versions[versions.length - 1]?.effective_from ?? schedule.effective_from,
    });
    const todayEntry = streak.days.find((day) => day.date === selectedDay);
    records.push({
      id: row.id,
      name: row.name,
      kind: effectiveKind,
      description: row.description,
      icon: row.icon,
      color: row.color,
      status: row.status,
      scheduleId: schedule.id,
      scheduleMode: schedule.mode,
      weekdayMask: schedule.weekday_mask,
      timezone: schedule.timezone,
      startDate: schedule.effective_from,
      endDate: schedule.effective_to,
      fixedTime: schedule.fixed_time,
      windowStart: schedule.window_start,
      windowEnd: schedule.window_end,
      targetId: targetVersion.id,
      measurement: targetVersion.measurement,
      digitalUsage,
      targetMode: targetVersion.target_mode,
      trackingMethod: targetVersion.tracking_method,
      usageConfirmed: digitalUsage && progress?.confirmed === 1,
      usageStatus,
      targetValue: target,
      canonicalTargetValue: canonicalTarget,
      configuredTargetValue: target,
      configuredUnit: targetVersion.unit,
      unit:
        targetVersion.measurement === 'check_off' || targetVersion.measurement === 'avoidance'
          ? 'times'
          : targetVersion.unit,
      progress: progressInConfiguredUnit,
      trackingMode,
      deviceSnapshotRefreshedAt: deviceToday?.refreshed_at ?? null,
      occurrenceCount: occurrenceStats?.count ?? 0,
      incidentDays: occurrenceStats?.days ?? 0,
      todayState: todayEntry?.state ?? (selectedDay > today ? 'pending' : 'unknown'),
      streak,
    });
  }
  return filter === 'all' ? records : records.filter((record) => record.kind === filter);
}

export async function getHabitForDate(
  habitId: string,
  localDate: string,
): Promise<HabitRecord | null> {
  const habits = await listHabits('all', true, localDate);
  return habits.find((habit) => habit.id === habitId) ?? null;
}

export async function getActivityLogsForDate(
  localDate: string,
  includeDeleted = false,
): Promise<HabitTimelineEntry[]> {
  const database = await db();
  const activityRows = await database.getAllAsync<HabitTimelineEntry>(
    `SELECT e.id,e.idempotency_key,e.kind,e.value,e.unit,e.note,e.occurred_at,e.created_at,e.local_date,e.measurement,
      e.input_value,e.input_unit,e.preset_id,e.preset_name,e.focus_session_id,e.deleted_at,e.correction_count,
      'increment' AS value_mode,'manual' AS source,
      e.habit_id,h.name AS habit_name,h.kind AS habit_kind,
      s.mode AS planned_mode,s.fixed_time AS planned_time,s.window_start,s.window_end,e.timezone,e.category,e.title
     FROM activity_logs e
     LEFT JOIN habits h ON h.id=e.habit_id
     LEFT JOIN habit_schedules s ON s.id=e.schedule_id
     WHERE e.local_date=? ${includeDeleted ? '' : 'AND e.deleted_at IS NULL'} ORDER BY e.occurred_at,e.id`,
    localDate,
  );
  const totals = await database.getAllAsync<HabitTimelineEntry>(
    `SELECT 'digital-total:'||d.habit_id||':'||d.local_date id,
      'digital-total:'||d.habit_id||':'||d.local_date idempotency_key,
      'progress' kind,d.value,d.unit,'Self-reported daily total' note,d.recorded_at occurred_at,
      d.recorded_at created_at,d.local_date,d.measurement,d.input_value,d.input_unit,
      NULL preset_id,NULL preset_name,NULL focus_session_id,NULL deleted_at,0 correction_count,
      'daily_total' value_mode,'manual_daily_total' source,d.habit_id,h.name habit_name,h.kind habit_kind,
      s.mode planned_mode,s.fixed_time planned_time,s.window_start,s.window_end,d.timezone,'habit' category,h.name title
     FROM digital_usage_daily_totals d JOIN habits h ON h.id=d.habit_id
     LEFT JOIN habit_schedules s ON s.habit_id=d.habit_id AND s.effective_from<=d.local_date
       AND (s.effective_to IS NULL OR s.effective_to>=d.local_date)
     WHERE d.local_date=? ORDER BY d.recorded_at`,
    localDate,
  );
  return [...activityRows, ...totals].sort((left, right) =>
    left.occurred_at.localeCompare(right.occurred_at),
  );
}
export async function getHabitEntriesForDate(localDate: string): Promise<HabitTimelineEntry[]> {
  return getActivityLogsForDate(localDate);
}
export async function getHabitBundle(
  id: string,
  includeArchived = false,
): Promise<HabitBundle | null> {
  const [habit] = await listHabits('all', includeArchived).then((items) =>
    items.filter((item) => item.id === id),
  );
  if (!habit) {
    const database = await db();
    const row = await database.getFirstAsync<{ status: string }>(
      'SELECT status FROM habits WHERE id=?',
      id,
    );
    if (!row || (row.status === 'archived' && !includeArchived)) return null;
  }
  const database = await db();
  const entries = await database.getAllAsync<HabitEntry>(
    `SELECT e.id,e.idempotency_key,e.kind,e.value,e.unit,e.note,e.occurred_at,e.created_at,e.local_date,e.measurement,e.input_value,e.input_unit,e.preset_id,e.preset_name,e.focus_session_id,e.deleted_at,e.correction_count,e.category,e.title,e.timezone,e.habit_id,h.name AS habit_name,
      'increment' value_mode,'manual' source FROM activity_logs e JOIN habits h ON h.id=e.habit_id WHERE e.habit_id=? ORDER BY e.occurred_at DESC,e.id DESC LIMIT 100`,
    id,
  );
  const totals = await database.getAllAsync<HabitEntry>(
    `SELECT 'digital-total:'||d.habit_id||':'||d.local_date id,
      'digital-total:'||d.habit_id||':'||d.local_date idempotency_key,'progress' kind,d.value,d.unit,
      'Self-reported daily total' note,d.recorded_at occurred_at,d.recorded_at created_at,d.local_date,d.measurement,
      d.input_value,d.input_unit,NULL preset_id,NULL preset_name,NULL focus_session_id,NULL deleted_at,0 correction_count,
      'habit' category,h.name title,d.timezone,d.habit_id,h.name habit_name,
      'daily_total' value_mode,'manual_daily_total' source
     FROM digital_usage_daily_totals d JOIN habits h ON h.id=d.habit_id WHERE d.habit_id=?
     ORDER BY d.local_date DESC LIMIT 100`,
    id,
  );
  entries.push(...totals);
  entries.sort((left, right) => right.occurred_at.localeCompare(left.occurred_at));
  const history = await database.getAllAsync<{
    event_type: string;
    details_json: string;
    occurred_at: string;
    local_date: string;
  }>(
    'SELECT event_type,details_json,occurred_at,local_date FROM habit_history WHERE habit_id=? ORDER BY occurred_at DESC,id DESC LIMIT 50',
    id,
  );
  return habit ? { habit, entries, history } : null;
}

export async function getActivityLogsForHabit(
  habitId: string,
  limit = 30,
  offset = 0,
): Promise<ActivityEntry[]> {
  const database = await db();
  return database.getAllAsync<ActivityEntry>(
    `SELECT * FROM (
       SELECT e.id,e.idempotency_key,e.kind,e.value,e.unit,e.note,e.occurred_at,e.created_at,e.local_date,e.measurement,
         e.input_value,e.input_unit,e.preset_id,e.preset_name,e.focus_session_id,e.deleted_at,e.correction_count,e.category,e.title,
         e.timezone,e.habit_id,h.name AS habit_name,'increment' value_mode,'manual' source
       FROM activity_logs e JOIN habits h ON h.id=e.habit_id WHERE e.habit_id=?
       UNION ALL
       SELECT 'digital-total:'||d.habit_id||':'||d.local_date id,'digital-total:'||d.habit_id||':'||d.local_date idempotency_key,
         'progress' kind,d.value,d.unit,'Self-reported daily total' note,d.recorded_at occurred_at,d.recorded_at created_at,
         d.local_date,d.measurement,d.input_value,d.input_unit,NULL preset_id,NULL preset_name,NULL focus_session_id,
         NULL deleted_at,0 correction_count,'habit' category,h.name title,d.timezone,d.habit_id,h.name habit_name,
         'daily_total' value_mode,'manual_daily_total' source
       FROM digital_usage_daily_totals d JOIN habits h ON h.id=d.habit_id WHERE d.habit_id=?
     ) ORDER BY occurred_at DESC,id DESC LIMIT ? OFFSET ?`,
    habitId,
    habitId,
    Math.max(1, Math.min(100, Math.trunc(limit))),
    Math.max(0, Math.trunc(offset)),
  );
}

async function saveScheduleVersion(
  database: SQLite.SQLiteDatabase,
  habitId: string,
  input: HabitInput,
  effectiveFrom: string,
  now: string,
): Promise<void> {
  const existing = await database.getFirstAsync<{ id: string }>(
    'SELECT id FROM habit_schedules WHERE habit_id=? AND effective_from=?',
    habitId,
    effectiveFrom,
  );
  const values = [
    input.scheduleMode,
    mask(input.weekdays),
    input.timezone,
    input.endDate || null,
    input.scheduleMode === 'fixed' ? input.fixedTime : null,
    input.scheduleMode === 'flexible' ? input.windowStart : null,
    input.scheduleMode === 'flexible' ? input.windowEnd : null,
  ] as const;
  if (existing) {
    await database.runAsync(
      'UPDATE habit_schedules SET mode=?,weekday_mask=?,timezone=?,effective_to=?,fixed_time=?,window_start=?,window_end=? WHERE id=?',
      ...values,
      existing.id,
    );
    return;
  }
  await database.runAsync(
    'UPDATE habit_schedules SET effective_to=? WHERE habit_id=? AND effective_from<? AND (effective_to IS NULL OR effective_to>=?)',
    dateAdd(effectiveFrom, -1),
    habitId,
    effectiveFrom,
    effectiveFrom,
  );
  await database.runAsync(
    'INSERT INTO habit_schedules (habit_id,mode,weekday_mask,timezone,effective_from,effective_to,fixed_time,window_start,window_end,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    habitId,
    input.scheduleMode,
    mask(input.weekdays),
    input.timezone,
    effectiveFrom,
    input.endDate || null,
    input.scheduleMode === 'fixed' ? input.fixedTime : null,
    input.scheduleMode === 'flexible' ? input.windowStart : null,
    input.scheduleMode === 'flexible' ? input.windowEnd : null,
    now,
  );
}

async function saveTargetVersion(
  database: SQLite.SQLiteDatabase,
  habitId: string,
  input: HabitInput,
  effectiveFrom: string,
  now: string,
): Promise<void> {
  const existing = await database.getFirstAsync<{ id: string }>(
    'SELECT id FROM habit_targets WHERE habit_id=? AND effective_from=?',
    habitId,
    effectiveFrom,
  );
  const measurement = input.digitalUsage
    ? input.measurement
    : input.kind === 'bad'
      ? 'avoidance'
      : input.measurement;
  const targetValue =
    measurement === 'check_off' || measurement === 'avoidance' ? 1 : Number(input.targetValue);
  const unit =
    measurement === 'check_off' || measurement === 'avoidance' ? 'times' : input.unit.trim();
  if (existing) {
    await database.runAsync(
      'UPDATE habit_targets SET measurement=?,target_value=?,unit=?,effective_to=?,target_mode=?,tracking_method=? WHERE id=?',
      measurement,
      targetValue,
      unit,
      input.endDate || null,
      input.digitalUsage ? 'maximum' : 'minimum',
      'manual',
      existing.id,
    );
    return;
  }
  await database.runAsync(
    'UPDATE habit_targets SET effective_to=? WHERE habit_id=? AND effective_from<? AND (effective_to IS NULL OR effective_to>=?)',
    dateAdd(effectiveFrom, -1),
    habitId,
    effectiveFrom,
    effectiveFrom,
  );
  await database.runAsync(
    'INSERT INTO habit_targets (habit_id,measurement,target_value,unit,effective_from,effective_to,created_at,target_mode,tracking_method) VALUES (?,?,?,?,?,?,?,?,?)',
    habitId,
    measurement,
    targetValue,
    unit,
    effectiveFrom,
    input.endDate || null,
    now,
    input.digitalUsage ? 'maximum' : 'minimum',
    'manual',
  );
}

export async function saveHabit(input: HabitInput, id?: string): Promise<string> {
  const database = await db();
  const now = new Date().toISOString();
  const start = input.startDate;
  const today = todayInTimezone(input.timezone);
  const applyDate = id && start <= today ? dateAdd(today, 1) : start;
  const measurement = input.digitalUsage
    ? input.measurement
    : input.kind === 'bad'
      ? 'avoidance'
      : input.measurement;
  let habitId = id;
  await database.withTransactionAsync(async () => {
    if (!habitId) {
      const inserted = await database.getFirstAsync<{ id: string }>(
        'INSERT INTO habits (name,kind,description,icon,color,created_at,updated_at) VALUES (?,?,?,?,?,?,?) RETURNING id',
        input.name.trim(),
        input.kind,
        input.description.trim(),
        input.icon,
        input.color,
        now,
        now,
      );
      habitId = inserted!.id;
    } else {
      await database.runAsync(
        'UPDATE habits SET name=?,kind=?,description=?,icon=?,color=?,updated_at=? WHERE id=?',
        input.name.trim(),
        input.kind,
        input.description.trim(),
        input.icon,
        input.color,
        now,
        habitId,
      );
    }
    await saveScheduleVersion(database, habitId!, input, applyDate, now);
    await saveTargetVersion(database, habitId!, input, applyDate, now);
    await database.runAsync(
      'UPDATE habits SET kind=? WHERE id=?',
      input.digitalUsage ? 'bad' : input.kind,
      habitId!,
    );
    await recordHistory(database, habitId!, id ? 'edited' : 'created', input.timezone, {
      name: input.name,
      kind: input.kind,
      measurement,
      targetValue:
        measurement === 'check_off' || measurement === 'avoidance' ? 1 : Number(input.targetValue),
      unit: input.unit,
      scheduleMode: input.scheduleMode,
      weekdays: input.weekdays,
      effectiveFrom: applyDate,
    });
    await enqueueLocalOperation(database, 'habit', {
      action: id ? 'update' : 'create',
      habitId: habitId!,
      input: {
        ...input,
        kind: input.digitalUsage ? 'bad' : input.kind,
      },
      effectiveFrom: applyDate,
    });
  });
  await reconcileReminders().catch(() => undefined);
  return habitId!;
}
export async function addHabitEntry(
  habit: HabitRecord,
  kind: 'progress' | 'complete_override' | 'occurrence' | 'clean' | 'skip',
  value: number | null = null,
  note = '',
): Promise<void> {
  await createActivityLog({
    idempotencyKey: key(),
    habit,
    category: 'habit',
    title: habit.name,
    measurement: measurementForHabit(habit.measurement, habit.unit),
    kind,
    value,
    unit: kind === 'progress' ? habit.unit : null,
    note,
    occurredAt: new Date().toISOString(),
    timezone: habit.timezone,
  });
  await reconcileReminders().catch(() => undefined);
}

export async function recordDigitalUsageTotal(
  habit: HabitRecord,
  inputValue: number,
  inputUnit = habit.configuredUnit,
): Promise<void> {
  if (!habit.digitalUsage || habit.trackingMethod !== 'manual') {
    throw new Error('Manual digital usage is not enabled for this activity.');
  }
  if (!Number.isFinite(inputValue) || inputValue < 0 || inputValue > 1_000_000) {
    throw new Error('Enter a daily total between zero and one million.');
  }
  const measure = measurementForHabit(habit.measurement, inputUnit);
  if (measure !== 'duration' && measure !== 'count') {
    throw new Error('Digital usage needs a duration or count measurement.');
  }
  const canonical =
    inputValue === 0
      ? toCanonical(1, measure, inputUnit)
      : toCanonical(inputValue, measure, inputUnit);
  const value = inputValue === 0 ? 0 : canonical.value;
  const timezone = habit.timezone;
  const localDate = todayInTimezone(timezone);
  const recordedAt = new Date().toISOString();
  const database = await db();
  await database.withTransactionAsync(async () => {
    await database.runAsync(
      `INSERT INTO digital_usage_daily_totals
       (habit_id,local_date,measurement,value,unit,input_value,input_unit,source,timezone,recorded_at)
       VALUES(?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(habit_id,local_date,measurement) DO UPDATE SET
         value=excluded.value,unit=excluded.unit,input_value=excluded.input_value,
         input_unit=excluded.input_unit,source=excluded.source,timezone=excluded.timezone,
         recorded_at=excluded.recorded_at`,
      habit.id,
      localDate,
      measure,
      value,
      canonical.unit,
      inputValue,
      inputUnit,
      'manual',
      timezone,
      recordedAt,
    );
    await recordHistory(database, habit.id, 'digital_usage_total', timezone, {
      measurement: measure,
      value,
      unit: canonical.unit,
      source: 'manual',
      localDate,
    });
  });
}

export function newActivityKey(): string {
  return key();
}

export async function createActivityLog(input: QuickActivity): Promise<string> {
  const database = await db();
  const occurredAt = new Date(input.occurredAt);
  if (!Number.isFinite(occurredAt.getTime())) throw new Error('Choose a valid activity time.');
  const timezone = input.timezone;
  const localDate = localDateAt(occurredAt, timezone);
  const kind = input.kind ?? 'progress';
  const canonical =
    kind === 'progress' ? toCanonical(input.value ?? 0, input.measurement, input.unit ?? '') : null;
  const now = new Date().toISOString();
  let logId = '';
  await database.withTransactionAsync(async () => {
    const duplicate = await database.getFirstAsync<{ id: string }>(
      'SELECT id FROM activity_logs WHERE idempotency_key=?',
      input.idempotencyKey,
    );
    if (duplicate) {
      logId = duplicate.id;
      return;
    }
    let scheduleId = input.habit?.scheduleId ?? null;
    let targetId = input.habit?.targetId ?? null;
    if (input.habit) {
      const version = await database.getFirstAsync<{
        schedule_id: string;
        target_id: string;
        measurement: string;
        unit: string;
      }>(
        `SELECT s.id schedule_id,t.id target_id,t.measurement,t.unit
         FROM habit_schedules s JOIN habit_targets t ON t.habit_id=s.habit_id
         WHERE s.habit_id=? AND s.effective_from<=? AND (s.effective_to IS NULL OR s.effective_to>=?)
         AND t.effective_from<=? AND (t.effective_to IS NULL OR t.effective_to>=?)
         ORDER BY s.effective_from DESC,t.effective_from DESC LIMIT 1`,
        input.habit.id,
        localDate,
        localDate,
        localDate,
        localDate,
      );
      if (!version) throw new Error('No habit settings exist for the selected date.');
      if (
        kind === 'progress' &&
        input.measurement !== measurementForHabit(version.measurement, version.unit)
      ) {
        throw new Error('This log does not match the measurement configured for that date.');
      }
      scheduleId = version.schedule_id;
      targetId = version.target_id;
    }
    if (input.habit && ['complete_override', 'clean', 'skip'].includes(kind)) {
      const existing = await database.getFirstAsync<{ id: string }>(
        'SELECT id FROM activity_logs WHERE habit_id=? AND local_date=? AND kind=? AND deleted_at IS NULL',
        input.habit.id,
        localDate,
        kind,
      );
      if (existing) {
        logId = existing.id;
        return;
      }
    }
    if (input.habit && kind === 'clean') {
      const occurrence = await database.getFirstAsync<{ id: string }>(
        "SELECT id FROM activity_logs WHERE habit_id=? AND local_date=? AND kind='occurrence' AND deleted_at IS NULL LIMIT 1",
        input.habit.id,
        localDate,
      );
      if (occurrence)
        throw new Error(
          'An occurrence is already recorded for this day, so it cannot be marked clean.',
        );
    }
    if (input.habit && kind === 'occurrence') {
      const clean = await activitySnapshotByKind(database, input.habit.id, localDate, 'clean');
      if (clean) {
        await database.runAsync(
          'UPDATE activity_logs SET deleted_at=? WHERE id=?',
          now,
          clean.id as string,
        );
        await recordActivityRevision(database, clean.id as string, 'deleted', clean, now);
        await enqueueLocalOperation(database, 'activity_log', {
          action: 'delete',
          activityLogId: clean.id,
          idempotencyKey: key(),
          occurredAt: now,
        });
      }
    }
    const row = await database.getFirstAsync<{ id: string }>(
      `INSERT OR IGNORE INTO activity_logs (
        idempotency_key,habit_id,schedule_id,target_id,category,title,measurement,kind,
        value,unit,input_value,input_unit,note,occurred_at,local_date,timezone,created_at,
        preset_id,preset_name,focus_session_id,goal_id
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id`,
      input.idempotencyKey,
      input.habit?.id ?? null,
      scheduleId,
      targetId,
      input.category,
      input.title.trim().slice(0, 80),
      input.measurement,
      kind,
      canonical?.value ?? null,
      canonical?.unit ?? null,
      kind === 'progress' ? input.value : null,
      kind === 'progress' ? input.unit : null,
      (input.note ?? '').trim().slice(0, 280),
      occurredAt.toISOString(),
      localDate,
      timezone,
      now,
      input.presetId ?? null,
      input.presetName ?? null,
      input.focusSessionId ?? null,
      input.goalId ?? null,
    );
    if (!row) return;
    logId = row.id;
    if (input.habit) {
      await recordHistory(database, input.habit.id, 'entry_recorded', timezone, {
        kind,
        value: canonical?.value ?? null,
        unit: canonical?.unit ?? null,
        activityLogId: logId,
      });
    }
    await enqueueLocalOperation(database, 'activity_log', {
      action: 'create',
      activityLogId: logId,
      idempotencyKey: input.idempotencyKey,
      habitId: input.habit?.id ?? null,
      category: input.category,
      title: input.title,
      measurement: input.measurement,
      kind,
      value: canonical?.value ?? null,
      unit: canonical?.unit ?? null,
      note: input.note ?? '',
      occurredAt: occurredAt.toISOString(),
      localDate,
      timezone,
      presetId: input.presetId ?? null,
      presetName: input.presetName ?? null,
      focusSessionId: input.focusSessionId ?? null,
      goalId: input.goalId ?? null,
    });
  });
  if (!logId && input.habit && ['complete_override', 'clean', 'skip'].includes(kind)) {
    const existing = await database.getFirstAsync<{ id: string }>(
      'SELECT id FROM activity_logs WHERE habit_id=? AND local_date=? AND kind=? AND deleted_at IS NULL',
      input.habit.id,
      localDate,
      kind,
    );
    if (existing) logId = existing.id;
  }
  if (!logId) throw new Error('The activity could not be saved. Try again.');
  await reconcileReminders().catch(() => undefined);
  return logId;
}

/** Persists a multi-day activity as one atomic local write. Used by focus sessions crossing midnight. */
export async function createActivityLogsAtomically(
  inputs: readonly QuickActivity[],
): Promise<string[]> {
  if (!inputs.length) return [];
  if (inputs.some((input) => (input.kind ?? 'progress') !== 'progress')) {
    throw new Error('Only progress activities can be written as a batch.');
  }
  const database = await db();
  const logIds: string[] = [];
  await database.withTransactionAsync(async () => {
    for (const input of inputs) {
      const occurredAt = new Date(input.occurredAt);
      if (!Number.isFinite(occurredAt.getTime())) throw new Error('Choose a valid activity time.');
      const localDate = localDateAt(occurredAt, input.timezone);
      const canonical = toCanonical(input.value ?? 0, input.measurement, input.unit ?? '');
      const duplicate = await database.getFirstAsync<{ id: string }>(
        'SELECT id FROM activity_logs WHERE idempotency_key=?',
        input.idempotencyKey,
      );
      if (duplicate) {
        logIds.push(duplicate.id);
        continue;
      }
      let scheduleId = input.habit?.scheduleId ?? null;
      let targetId = input.habit?.targetId ?? null;
      if (input.habit) {
        const version = await database.getFirstAsync<{
          schedule_id: string;
          target_id: string;
          measurement: string;
          unit: string;
        }>(
          `SELECT s.id schedule_id,t.id target_id,t.measurement,t.unit FROM habit_schedules s
           JOIN habit_targets t ON t.habit_id=s.habit_id WHERE s.habit_id=?
           AND s.effective_from<=? AND (s.effective_to IS NULL OR s.effective_to>=?)
           AND t.effective_from<=? AND (t.effective_to IS NULL OR t.effective_to>=?)
           ORDER BY s.effective_from DESC,t.effective_from DESC LIMIT 1`,
          input.habit.id,
          localDate,
          localDate,
          localDate,
          localDate,
        );
        if (!version) throw new Error('No habit settings exist for the selected date.');
        if (input.measurement !== measurementForHabit(version.measurement, version.unit)) {
          throw new Error('This log does not match the measurement configured for that date.');
        }
        scheduleId = version.schedule_id;
        targetId = version.target_id;
      }
      const now = new Date().toISOString();
      const inserted = await database.getFirstAsync<{ id: string }>(
        `INSERT OR IGNORE INTO activity_logs(idempotency_key,habit_id,schedule_id,target_id,category,title,measurement,kind,
          value,unit,input_value,input_unit,note,occurred_at,local_date,timezone,created_at,preset_id,preset_name,focus_session_id)
         VALUES(?,?,?,?,?,? ,?,'progress',?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id`,
        input.idempotencyKey,
        input.habit?.id ?? null,
        scheduleId,
        targetId,
        input.category,
        input.title.trim().slice(0, 80),
        input.measurement,
        canonical.value,
        canonical.unit,
        input.value,
        input.unit,
        (input.note ?? '').trim().slice(0, 280),
        occurredAt.toISOString(),
        localDate,
        input.timezone,
        now,
        input.presetId ?? null,
        input.presetName ?? null,
        input.focusSessionId ?? null,
      );
      const logId =
        inserted?.id ??
        (
          await database.getFirstAsync<{ id: string }>(
            'SELECT id FROM activity_logs WHERE idempotency_key=?',
            input.idempotencyKey,
          )
        )?.id;
      if (!logId) throw new Error('The activity could not be saved. Try again.');
      logIds.push(logId);
      if (inserted && input.habit) {
        await recordHistory(database, input.habit.id, 'entry_recorded', input.timezone, {
          kind: 'progress',
          value: canonical.value,
          unit: canonical.unit,
          activityLogId: logId,
        });
      }
      if (inserted)
        await enqueueLocalOperation(database, 'activity_log', {
          action: 'create',
          activityLogId: logId,
          idempotencyKey: input.idempotencyKey,
          habitId: input.habit?.id ?? null,
          category: input.category,
          title: input.title,
          measurement: input.measurement,
          kind: 'progress',
          value: canonical.value,
          unit: canonical.unit,
          note: input.note ?? '',
          occurredAt: occurredAt.toISOString(),
          localDate,
          timezone: input.timezone,
          presetId: input.presetId ?? null,
          presetName: input.presetName ?? null,
          focusSessionId: input.focusSessionId ?? null,
        });
    }
  });
  await reconcileReminders().catch(() => undefined);
  return logIds;
}

async function activitySnapshot(database: SQLite.SQLiteDatabase, id: string) {
  return database.getFirstAsync<Record<string, unknown>>(
    'SELECT * FROM activity_logs WHERE id=?',
    id,
  );
}
async function activitySnapshotByKind(
  database: SQLite.SQLiteDatabase,
  habitId: string,
  day: string,
  kind: string,
) {
  return database.getFirstAsync<Record<string, unknown>>(
    'SELECT * FROM activity_logs WHERE habit_id=? AND local_date=? AND kind=? AND deleted_at IS NULL LIMIT 1',
    habitId,
    day,
    kind,
  );
}
async function recordActivityRevision(
  database: SQLite.SQLiteDatabase,
  id: string,
  eventType: 'edited' | 'deleted' | 'restored',
  snapshot: Record<string, unknown>,
  now: string,
) {
  await database.runAsync(
    'INSERT INTO activity_log_revisions (log_id,idempotency_key,event_type,snapshot_json,occurred_at) VALUES (?,?,?,?,?)',
    id,
    key(),
    eventType,
    JSON.stringify(snapshot),
    now,
  );
}

export async function updateActivityLog(id: string, input: QuickActivity): Promise<void> {
  const database = await db();
  const occurredAt = new Date(input.occurredAt);
  if (!Number.isFinite(occurredAt.getTime())) throw new Error('Choose a valid activity time.');
  const localDate = localDateAt(occurredAt, input.timezone);
  const kind = input.kind ?? 'progress';
  const canonical =
    kind === 'progress' ? toCanonical(input.value ?? 0, input.measurement, input.unit ?? '') : null;
  const now = new Date().toISOString();
  await database.withTransactionAsync(async () => {
    const previous = await activitySnapshot(database, id);
    if (!previous || previous.deleted_at) throw new Error('This log is no longer available.');
    let scheduleId = input.habit?.scheduleId ?? null;
    let targetId = input.habit?.targetId ?? null;
    if (input.habit) {
      const version = await database.getFirstAsync<{
        schedule_id: string;
        target_id: string;
        measurement: string;
        unit: string;
      }>(
        `SELECT s.id schedule_id,t.id target_id,t.measurement,t.unit FROM habit_schedules s JOIN habit_targets t ON t.habit_id=s.habit_id
         WHERE s.habit_id=? AND s.effective_from<=? AND (s.effective_to IS NULL OR s.effective_to>=?)
         AND t.effective_from<=? AND (t.effective_to IS NULL OR t.effective_to>=?)
         ORDER BY s.effective_from DESC,t.effective_from DESC LIMIT 1`,
        input.habit.id,
        localDate,
        localDate,
        localDate,
        localDate,
      );
      if (!version) throw new Error('No habit settings exist for that date.');
      if (
        kind === 'progress' &&
        input.measurement !== measurementForHabit(version.measurement, version.unit)
      ) {
        throw new Error('This correction does not match the measurement configured for that date.');
      }
      scheduleId = version.schedule_id;
      targetId = version.target_id;
    }
    await database.runAsync(
      `UPDATE activity_logs SET habit_id=?,schedule_id=?,target_id=?,category=?,title=?,measurement=?,kind=?,
       value=?,unit=?,input_value=?,input_unit=?,note=?,occurred_at=?,local_date=?,timezone=?,preset_id=?,preset_name=?,focus_session_id=?,
       corrected_at=?,correction_count=correction_count+1 WHERE id=? AND deleted_at IS NULL`,
      input.habit?.id ?? null,
      scheduleId,
      targetId,
      input.category,
      input.title.trim().slice(0, 80),
      input.measurement,
      kind,
      canonical?.value ?? null,
      canonical?.unit ?? null,
      kind === 'progress' ? input.value : null,
      kind === 'progress' ? input.unit : null,
      (input.note ?? '').trim().slice(0, 280),
      occurredAt.toISOString(),
      localDate,
      input.timezone,
      input.presetId ?? null,
      input.presetName ?? null,
      input.focusSessionId ?? null,
      now,
      id,
    );
    await recordActivityRevision(database, id, 'edited', previous, now);
    await enqueueLocalOperation(database, 'activity_log', {
      action: 'update',
      activityLogId: id,
      idempotencyKey: key(),
      category: input.category,
      title: input.title,
      measurement: input.measurement,
      kind,
      value: canonical?.value ?? null,
      unit: canonical?.unit ?? null,
      note: input.note ?? '',
      occurredAt: occurredAt.toISOString(),
      localDate,
      timezone: input.timezone,
      focusSessionId: input.focusSessionId ?? null,
    });
  });
  await reconcileReminders().catch(() => undefined);
}

export async function deleteActivityLog(id: string): Promise<void> {
  const database = await db();
  const now = new Date().toISOString();
  await database.withTransactionAsync(async () => {
    const snapshot = await activitySnapshot(database, id);
    if (!snapshot || snapshot.deleted_at) return;
    await database.runAsync(
      'UPDATE activity_logs SET deleted_at=? WHERE id=? AND deleted_at IS NULL',
      now,
      id,
    );
    await recordActivityRevision(database, id, 'deleted', snapshot, now);
    await enqueueLocalOperation(database, 'activity_log', {
      action: 'delete',
      activityLogId: id,
      idempotencyKey: key(),
      occurredAt: now,
    });
  });
  await reconcileReminders().catch(() => undefined);
}

export async function restoreActivityLog(id: string): Promise<void> {
  const database = await db();
  const now = new Date().toISOString();
  await database.withTransactionAsync(async () => {
    const snapshot = await activitySnapshot(database, id);
    if (!snapshot || !snapshot.deleted_at) return;
    await database.runAsync(
      'UPDATE activity_logs SET deleted_at=NULL WHERE id=? AND deleted_at IS NOT NULL',
      id,
    );
    await recordActivityRevision(database, id, 'restored', snapshot, now);
    await enqueueLocalOperation(database, 'activity_log', {
      action: 'restore',
      activityLogId: id,
      idempotencyKey: key(),
      occurredAt: now,
    });
  });
  await reconcileReminders().catch(() => undefined);
}

function mapPreset(row: {
  id: string;
  habit_id: string;
  name: string;
  measurement: MeasurementKind;
  value: number;
  unit: string;
  input_value: number;
  input_unit: string;
  is_default: number;
  sort_order: number;
}): ActivityPreset {
  return {
    id: row.id,
    habitId: row.habit_id,
    name: row.name,
    measurement: row.measurement,
    value: row.value,
    unit: row.unit,
    inputValue: row.input_value,
    inputUnit: row.input_unit,
    isDefault: row.is_default === 1,
    sortOrder: row.sort_order,
  };
}
const presetColumns =
  'id,habit_id,name,measurement,value,unit,input_value,input_unit,is_default,sort_order';
export async function getHabitPresets(habitId: string): Promise<ActivityPreset[]> {
  const database = await db();
  const rows = await database.getAllAsync<Parameters<typeof mapPreset>[0]>(
    `SELECT ${presetColumns} FROM activity_presets WHERE habit_id=? ORDER BY is_default DESC,sort_order,name`,
    habitId,
  );
  return rows.map(mapPreset);
}
export async function getPresetsForHabits(habitIds: readonly string[]): Promise<ActivityPreset[]> {
  if (!habitIds.length) return [];
  const database = await db();
  const placeholders = habitIds.map(() => '?').join(',');
  const rows = await database.getAllAsync<Parameters<typeof mapPreset>[0]>(
    `SELECT ${presetColumns} FROM activity_presets WHERE habit_id IN (${placeholders}) ORDER BY is_default DESC,sort_order,name`,
    ...habitIds,
  );
  return rows.map(mapPreset);
}

export function getBuiltInDigitalPresets(habit: HabitRecord): ActivityPreset[] {
  if (!habit.digitalUsage) return [];
  const measurement = measurementForHabit(habit.measurement, habit.unit);
  const options =
    measurement === 'duration'
      ? [
          { value: 5, unit: 'min', name: '+5 min' },
          { value: 15, unit: 'min', name: '+15 min' },
        ]
      : measurement === 'count'
        ? [
            { value: 1, unit: 'count', name: '+1' },
            { value: 5, unit: 'count', name: '+5' },
            { value: 10, unit: 'count', name: '+10' },
          ]
        : [];
  return options.map((option, index) => ({
    id: `digital-quick:${habit.id}:${option.name}`,
    habitId: habit.id,
    name: option.name,
    measurement,
    value: toCanonical(option.value, measurement, option.unit).value,
    unit: toCanonical(option.value, measurement, option.unit).unit,
    inputValue: option.value,
    inputUnit: option.unit,
    isDefault: false,
    sortOrder: index,
  }));
}
export async function saveHabitPreset(
  habit: HabitRecord,
  input: PresetInput,
  id?: string,
): Promise<string> {
  const database = await db();
  const kind = measurementForHabit(habit.measurement, input.unit);
  const canonical = toCanonical(Number(input.amount), kind, input.unit);
  const now = new Date().toISOString();
  let presetId = id;
  await database.withTransactionAsync(async () => {
    if (input.isDefault)
      await database.runAsync(
        'UPDATE activity_presets SET is_default=0 WHERE habit_id=?',
        habit.id,
      );
    if (presetId) {
      await database.runAsync(
        `UPDATE activity_presets SET name=?,measurement=?,value=?,unit=?,input_value=?,input_unit=?,is_default=?,sort_order=?,updated_at=? WHERE id=? AND habit_id=?`,
        input.name.trim(),
        kind,
        canonical.value,
        canonical.unit,
        Number(input.amount),
        input.unit,
        input.isDefault ? 1 : 0,
        input.sortOrder,
        now,
        presetId,
        habit.id,
      );
    } else {
      const row = await database.getFirstAsync<{ id: string }>(
        `INSERT INTO activity_presets (habit_id,name,measurement,value,unit,input_value,input_unit,is_default,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) RETURNING id`,
        habit.id,
        input.name.trim(),
        kind,
        canonical.value,
        canonical.unit,
        Number(input.amount),
        input.unit,
        input.isDefault ? 1 : 0,
        input.sortOrder,
        now,
        now,
      );
      presetId = row!.id;
    }
    await enqueueLocalOperation(database, 'activity_preset', {
      action: id ? 'update' : 'create',
      presetId,
      habitId: habit.id,
      name: input.name.trim(),
      measurement: kind,
      value: canonical.value,
      unit: canonical.unit,
      inputValue: Number(input.amount),
      inputUnit: input.unit,
      isDefault: input.isDefault,
      sortOrder: input.sortOrder,
    });
  });
  return presetId!;
}
export async function deleteHabitPreset(habitId: string, id: string): Promise<void> {
  const database = await db();
  await database.withTransactionAsync(async () => {
    await database.runAsync('DELETE FROM activity_presets WHERE id=? AND habit_id=?', id, habitId);
    const fallback = await database.getFirstAsync<{ id: string }>(
      'SELECT id FROM activity_presets WHERE habit_id=? ORDER BY sort_order,name LIMIT 1',
      habitId,
    );
    if (fallback)
      await database.runAsync('UPDATE activity_presets SET is_default=1 WHERE id=?', fallback.id);
    await enqueueLocalOperation(database, 'activity_preset', {
      action: 'delete',
      presetId: id,
      habitId,
    });
  });
}
export async function setHabitStatus(
  id: string,
  status: 'active' | 'paused' | 'archived',
): Promise<void> {
  const database = await db();
  const now = new Date().toISOString();
  const habit = await database.getFirstAsync<{ status: string }>(
    'SELECT status FROM habits WHERE id=?',
    id,
  );
  const schedules = await database.getAllAsync<{
    timezone: string;
    effective_from: string;
    effective_to: string | null;
  }>(
    'SELECT timezone,effective_from,effective_to FROM habit_schedules WHERE habit_id=? ORDER BY effective_from DESC',
    id,
  );
  const schedule =
    schedules.find((item) => {
      const today = todayInTimezone(item.timezone);
      return item.effective_from <= today && (!item.effective_to || item.effective_to >= today);
    }) ?? schedules[0];
  if (!habit || !schedule) throw new Error('This habit could not be found.');
  await database.withTransactionAsync(async () => {
    await database.runAsync(
      'UPDATE habits SET status=?,archived_at=?,updated_at=? WHERE id=?',
      status,
      status === 'archived' ? now : null,
      now,
      id,
    );
    if (status === 'paused') {
      const day = todayInTimezone(schedule.timezone);
      await database.runAsync(
        'INSERT INTO habit_pauses (habit_id,started_on,created_at) VALUES (?,?,?)',
        id,
        day,
        now,
      );
      await recordHistory(database, id, 'paused', schedule.timezone);
    } else if (status === 'active') {
      await database.runAsync(
        'UPDATE habit_pauses SET resumed_on=? WHERE habit_id=? AND resumed_on IS NULL',
        todayInTimezone(schedule.timezone),
        id,
      );
      await recordHistory(
        database,
        id,
        habit.status === 'archived' ? 'restored' : 'resumed',
        schedule.timezone,
      );
    } else await recordHistory(database, id, 'archived', schedule.timezone);
    await enqueueLocalOperation(database, 'habit', {
      action: status,
      habitId: id,
      occurredAt: now,
    });
  });
  await reconcileReminders().catch(() => undefined);
}
export async function restoreHabit(id: string): Promise<void> {
  await setHabitStatus(id, 'active');
}
