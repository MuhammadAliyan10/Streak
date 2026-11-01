import type * as SQLite from 'expo-sqlite';
import { initializeLocalDatabase } from '../../services/local-database';
import {
  measurementForHabit,
  timestampFromLocal,
  toCanonical,
} from '../habits/domain/activity-domain';
import { calculateStreak, dateAdd, todayInTimezone } from '../habits/domain/habit-domain';
import { isWalkingDistanceHabit } from '../habits/walking-tracking-domain';
import { getGoals, type GoalRecord } from '../goals-routines/goal-repository';
import {
  aggregateSecondsByDate,
  calculateHabitConsistency,
  validateInsightRange,
  type HabitAnalyticsDay,
} from './insights-domain';

export type HabitInsight = {
  id: string;
  name: string;
  kind: 'good' | 'bad';
  completed: number;
  eligible: number;
  consistency: number | null;
  currentStreak: number;
  currentStreakCapped: boolean;
  longestStreak: number;
  streakWindowDays: number;
  days: HabitAnalyticsDay[];
};
export type InsightMetricRow = {
  id: string;
  name: string;
  measurement: string;
  unit: string;
  value: number;
  source: 'manual' | 'daily_total' | 'device';
};
export type InsightsData = {
  startDate: string;
  endDate: string;
  today: string;
  habits: HabitInsight[];
  focus: {
    totalSeconds: number;
    sessions: number;
    previousPeriodSeconds: number | null;
    daily: Array<{ date: string; seconds: number }>;
    byActivity: Array<{ title: string; seconds: number }>;
  };
  tasks: { completed: number; pending: number; overdue: number };
  routines: {
    completedRuns: number;
    totalRuns: number;
    completedSteps: number;
    skippedSteps: number;
  };
  categories: Array<{ category: string; activities: number; durationSeconds: number }>;
  measurements: InsightMetricRow[];
  measurementDaily: Array<InsightMetricRow & { date: string }>;
  digitalUsage: Array<
    InsightMetricRow & {
      target: number;
      overLimitDays: number;
      confirmed: boolean;
      hasData: boolean;
    }
  >;
  walking: Array<{ id: string; name: string; distanceMeters: number; days: number }>;
  goals: GoalRecord[];
  achievedMilestones: number;
};
export type RoutineDayEvent = {
  id: string;
  name: string;
  status: 'active' | 'paused' | 'completed' | 'abandoned';
  startedAt: string;
  finishedAt: string | null;
  timezone: string;
};

type HabitRow = {
  id: string;
  name: string;
  kind: 'good' | 'bad';
  status: string;
  created_at: string;
};
type VersionRow = {
  habit_id: string;
  measurement: string;
  target_value: number;
  unit: string;
  target_mode: 'minimum' | 'maximum';
  effective_from: string;
  effective_to: string | null;
};
type ScheduleRow = {
  habit_id: string;
  weekday_mask: number;
  effective_from: string;
  effective_to: string | null;
  mode: 'anytime' | 'fixed' | 'flexible';
  window_end: string | null;
};

async function db(): Promise<SQLite.SQLiteDatabase> {
  return initializeLocalDatabase();
}

function atVersion<T extends { effective_from: string; effective_to: string | null }>(
  versions: T[],
  date: string,
) {
  return versions.find(
    (item) => item.effective_from <= date && (!item.effective_to || item.effective_to >= date),
  );
}

export async function getInsightsData(startDate: string, endDate: string): Promise<InsightsData> {
  const database = await db();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const today = todayInTimezone(timezone);
  if (!validateInsightRange(startDate, endDate) || endDate > today)
    throw new Error('Choose a valid Insights date range ending today.');
  const analysisStart = [startDate, dateAdd(today, -119)].sort()[0]!;
  const habits = await database.getAllAsync<HabitRow>(
    "SELECT id,name,kind,status,created_at FROM habits WHERE status IN ('active','paused','archived') ORDER BY name LIMIT 200",
  );
  const [scheduleRows, targetRows, activityRows, pauseRows, totalRows, walkingRows] =
    await Promise.all([
      database.getAllAsync<ScheduleRow>(
        'SELECT habit_id,weekday_mask,effective_from,effective_to,mode,window_end FROM habit_schedules WHERE effective_from<=? AND (effective_to IS NULL OR effective_to>=?)',
        today,
        analysisStart,
      ),
      database.getAllAsync<VersionRow>(
        'SELECT habit_id,measurement,target_value,unit,target_mode,effective_from,effective_to FROM habit_targets WHERE effective_from<=? AND (effective_to IS NULL OR effective_to>=?)',
        today,
        analysisStart,
      ),
      database.getAllAsync<{
        id: string;
        habit_id: string | null;
        local_date: string;
        measurement: string;
        value: number | null;
        unit: string | null;
        kind: string;
        category: string;
        title: string;
        focus_session_id: string | null;
        deleted_at: string | null;
      }>(
        'SELECT id,habit_id,local_date,measurement,value,unit,kind,category,title,focus_session_id,deleted_at FROM activity_logs WHERE local_date BETWEEN ? AND ? AND deleted_at IS NULL ORDER BY local_date,id LIMIT 20000',
        analysisStart,
        today,
      ),
      database.getAllAsync<{ habit_id: string; started_on: string; resumed_on: string | null }>(
        'SELECT habit_id,started_on,resumed_on FROM habit_pauses WHERE started_on<=? AND (resumed_on IS NULL OR resumed_on>=?)',
        today,
        analysisStart,
      ),
      database.getAllAsync<{
        habit_id: string;
        name: string;
        local_date: string;
        measurement: string;
        value: number;
        unit: string;
      }>(
        `SELECT d.habit_id,h.name,d.local_date,d.measurement,d.value,d.unit
         FROM digital_usage_daily_totals d JOIN habits h ON h.id=d.habit_id
         WHERE d.local_date BETWEEN ? AND ? ORDER BY d.local_date,d.habit_id LIMIT 10000`,
        analysisStart,
        today,
      ),
      database.getAllAsync<{
        habit_id: string;
        name: string;
        local_date: string;
        value: number;
      }>(
        `SELECT s.habit_id,h.name,s.local_date,s.value FROM walking_device_snapshots s
         JOIN walking_tracking_preferences p ON p.habit_id=s.habit_id AND p.mode='automatic'
         JOIN habits h ON h.id=s.habit_id
         WHERE s.local_date BETWEEN ? AND ? AND s.measurement='distance'
         ORDER BY s.local_date,s.habit_id LIMIT 10000`,
        analysisStart,
        today,
      ),
    ]);

  const schedulesByHabit = groupBy(scheduleRows, (row) => row.habit_id);
  const targetsByHabit = groupBy(targetRows, (row) => row.habit_id);
  const pausesByHabit = groupBy(pauseRows, (row) => row.habit_id);
  const logsByHabit = groupBy(
    activityRows.filter((row) => row.habit_id),
    (row) => row.habit_id!,
  );
  const totalsByHabit = groupBy(totalRows, (row) => row.habit_id);
  const walkingByHabit = groupBy(walkingRows, (row) => row.habit_id);

  const habitInsights: HabitInsight[] = habits.flatMap((habit) => {
    const schedules = schedulesByHabit.get(habit.id) ?? [];
    const targets = targetsByHabit.get(habit.id) ?? [];
    const currentSchedule = atVersion(schedules, today);
    const currentTarget = atVersion(targets, today);
    if (!schedules.length || !targets.length || !currentSchedule || !currentTarget) return [];
    const history = logsByHabit.get(habit.id) ?? [];
    const totals = totalsByHabit.get(habit.id) ?? [];
    const walking = (walkingByHabit.get(habit.id) ?? []).filter((item) => {
      const target = atVersion(targets, item.local_date);
      return !!target && isWalkingDistanceHabit(habit.name, target.measurement);
    });
    const snapshotDates = new Set(walking.map((item) => item.local_date));
    const targetHistory = targets.map((item) => ({
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
          ? ('bad' as const)
          : ('good' as const),
      startDate: item.effective_from,
      endDate: item.effective_to,
    }));
    const digitalLimit =
      currentTarget.target_mode === 'maximum' &&
      ['duration', 'count'].includes(currentTarget.measurement);
    const streakEntries = [
      ...history.flatMap((item) => {
        const target = atVersion(targets, item.local_date);
        if (!target) return [];
        const isDigital =
          target.target_mode === 'maximum' && ['duration', 'count'].includes(target.measurement);
        if (isDigital || (item.kind === 'progress' && snapshotDates.has(item.local_date)))
          return [];
        if (item.kind === 'progress' && item.measurement !== target.measurement) return [];
        return [{ date: item.local_date, kind: item.kind, value: item.value }];
      }),
      ...walking.map((item) => ({ date: item.local_date, kind: 'progress', value: item.value })),
      ...totals.flatMap((total) => {
        const target = atVersion(targets, total.local_date);
        if (!target || target.target_mode !== 'maximum' || total.measurement !== target.measurement)
          return [];
        const canonicalTarget = toCanonical(
          target.target_value,
          measurementForHabit(target.measurement, target.unit),
          target.unit,
        ).value;
        return [
          {
            date: total.local_date,
            kind: total.value <= canonicalTarget ? 'clean' : 'occurrence',
            value: null,
          },
        ];
      }),
    ];
    const computed = calculateStreak({
      kind: currentTarget.measurement === 'avoidance' || digitalLimit ? 'bad' : habit.kind,
      schedule: {
        weekdayMask: currentSchedule.weekday_mask,
        startDate: currentSchedule.effective_from,
        endDate: currentSchedule.effective_to,
        mode: currentSchedule.mode,
        windowEnd: currentSchedule.window_end,
      },
      scheduleHistory: schedules.map((item) => ({
        weekdayMask: item.weekday_mask,
        startDate: item.effective_from,
        endDate: item.effective_to,
        mode: item.mode,
        windowEnd: item.window_end,
      })),
      targetHistory,
      target: targetHistory.at(-1)?.value ?? 1,
      today,
      deadlinePassedToday: false,
      entries: streakEntries,
      pauses: (pausesByHabit.get(habit.id) ?? []).map((item) => ({
        start: item.started_on,
        end: item.resumed_on,
      })),
      rangeStart: analysisStart,
    });
    const selectedDays = computed.days.filter(
      (day) => day.date >= startDate && day.date <= endDate,
    );
    const consistency = calculateHabitConsistency(selectedDays, today);
    return [
      {
        id: habit.id,
        name: habit.name,
        kind: digitalLimit || currentTarget.measurement === 'avoidance' ? 'bad' : habit.kind,
        completed: consistency.completed,
        eligible: consistency.eligible,
        consistency: consistency.percent,
        currentStreak: computed.current,
        currentStreakCapped:
          computed.current > 0 &&
          computed.current === computed.days.length &&
          ['completed', 'clean'].includes(computed.days[0]?.state ?? ''),
        longestStreak: computed.longest,
        streakWindowDays: computed.days.length,
        days: selectedDays,
      },
    ];
  });

  const [focus, focusSummary, focusActivities, tasks, routines, categories, goals, milestoneRow] =
    await Promise.all([
      database.getAllAsync<{ local_date: string; seconds: number; sessions: number }>(
        `SELECT f.local_date,SUM(f.credited_seconds) seconds,COUNT(DISTINCT f.session_id) sessions
       FROM focus_session_activity_logs f
       JOIN focus_sessions s ON s.id=f.session_id AND s.status='completed'
       JOIN activity_logs a ON a.id=f.activity_log_id AND a.deleted_at IS NULL
       WHERE f.active=1 AND f.local_date BETWEEN ? AND ?
       GROUP BY f.local_date ORDER BY f.local_date`,
        startDate,
        endDate,
      ),
      database.getFirstAsync<{ sessions: number }>(
        `SELECT COUNT(DISTINCT f.session_id) sessions FROM focus_session_activity_logs f
       JOIN focus_sessions s ON s.id=f.session_id AND s.status='completed'
       JOIN activity_logs a ON a.id=f.activity_log_id AND a.deleted_at IS NULL
       WHERE f.active=1 AND f.local_date BETWEEN ? AND ?`,
        startDate,
        endDate,
      ),
      database.getAllAsync<{ title: string; seconds: number }>(
        `SELECT s.title,SUM(f.credited_seconds) seconds FROM focus_session_activity_logs f
       JOIN focus_sessions s ON s.id=f.session_id AND s.status='completed'
       JOIN activity_logs a ON a.id=f.activity_log_id AND a.deleted_at IS NULL
       WHERE f.active=1 AND f.local_date BETWEEN ? AND ?
       GROUP BY s.title ORDER BY seconds DESC LIMIT 8`,
        startDate,
        endDate,
      ),
      database.getFirstAsync<{ completed: number; pending: number; overdue: number }>(
        `SELECT
        SUM(CASE WHEN completed_local_date BETWEEN ? AND ? THEN 1 ELSE 0 END) completed,
        SUM(CASE WHEN status='pending' AND planned_date>=? THEN 1 ELSE 0 END) pending,
        SUM(CASE WHEN status='pending' AND planned_date<? THEN 1 ELSE 0 END) overdue
       FROM tasks WHERE deleted_at IS NULL AND (completed_local_date BETWEEN ? AND ? OR status='pending')`,
        startDate,
        endDate,
        today,
        today,
        startDate,
        endDate,
      ),
      database.getFirstAsync<{
        completed_runs: number;
        total_runs: number;
        completed_steps: number;
        skipped_steps: number;
      }>(
        `SELECT SUM(CASE WHEN r.status='completed' THEN 1 ELSE 0 END) completed_runs,COUNT(*) total_runs,
       (SELECT COUNT(*) FROM routine_run_steps s JOIN routine_runs rr ON rr.id=s.run_id WHERE rr.local_date BETWEEN ? AND ? AND s.status='completed') completed_steps,
       (SELECT COUNT(*) FROM routine_run_steps s JOIN routine_runs rr ON rr.id=s.run_id WHERE rr.local_date BETWEEN ? AND ? AND s.status='skipped') skipped_steps
       FROM routine_runs r WHERE r.local_date BETWEEN ? AND ? AND r.status!='abandoned'`,
        startDate,
        endDate,
        startDate,
        endDate,
        startDate,
        endDate,
      ),
      database.getAllAsync<{ category: string; activities: number; duration_seconds: number }>(
        `SELECT category,COUNT(*) activities,
        SUM(CASE WHEN measurement='duration' AND unit='seconds' THEN value ELSE 0 END) duration_seconds
       FROM activity_logs WHERE local_date BETWEEN ? AND ? AND deleted_at IS NULL
         AND focus_session_id IS NULL AND length(trim(category))>0
       GROUP BY category ORDER BY activities DESC LIMIT 8`,
        startDate,
        endDate,
      ),
      getGoals({ localDate: endDate, cachedHabits: [] }),
      database.getFirstAsync<{ achieved: number }>(
        'SELECT COUNT(*) achieved FROM goal_milestones WHERE completed_at>=? AND completed_at<?',
        timestampFromLocal(startDate, '00:00', timezone),
        timestampFromLocal(dateAdd(endDate, 1), '00:00', timezone),
      ),
    ]);

  const focusDaily = aggregateSecondsByDate(
    focus.map((row) => ({ localDate: row.local_date, seconds: row.seconds ?? 0 })),
  );
  const isCompletePeriod = endDate < today;
  const periodDays =
    Math.floor(
      (new Date(`${endDate}T00:00:00Z`).getTime() - new Date(`${startDate}T00:00:00Z`).getTime()) /
        86_400_000,
    ) + 1;
  const previousFocus = isCompletePeriod
    ? await database.getFirstAsync<{ seconds: number | null }>(
        `SELECT SUM(f.credited_seconds) seconds FROM focus_session_activity_logs f
         JOIN focus_sessions s ON s.id=f.session_id AND s.status='completed'
         JOIN activity_logs a ON a.id=f.activity_log_id AND a.deleted_at IS NULL
         WHERE f.active=1 AND f.local_date BETWEEN ? AND ?`,
        dateAdd(startDate, -periodDays),
        dateAdd(startDate, -1),
      )
    : null;
  const focusData = {
    totalSeconds: focusDaily.reduce((sum, row) => sum + row.seconds, 0),
    sessions: focusSummary?.sessions ?? 0,
    previousPeriodSeconds: previousFocus?.seconds ?? null,
    daily: focusDaily,
    byActivity: focusActivities.map((item) => ({ title: item.title, seconds: item.seconds ?? 0 })),
  };
  const measureMap = new Map<string, InsightMetricRow>();
  const measureDailyMap = new Map<string, InsightMetricRow & { date: string }>();
  for (const row of activityRows) {
    if (
      !row.habit_id ||
      row.value == null ||
      row.deleted_at ||
      row.local_date < startDate ||
      row.local_date > endDate
    )
      continue;
    if (digitalUsageReplaced(row.habit_id, row.local_date, row.measurement, totalRows)) continue;
    if (walkingReplaced(row.habit_id, row.local_date, walkingRows)) continue;
    const habit = habits.find((item) => item.id === row.habit_id);
    const target = atVersion(targetsByHabit.get(row.habit_id) ?? [], row.local_date);
    if (!habit || !target || target.measurement !== row.measurement) continue;
    if (
      (target.target_mode === 'maximum' && ['duration', 'count'].includes(target.measurement)) ||
      isWalkingDistanceHabit(habit.name, target.measurement)
    )
      continue;
    const key = `${row.habit_id}:${row.measurement}:${row.unit}`;
    const current = measureMap.get(key) ?? {
      id: row.habit_id,
      name: habit.name,
      measurement: row.measurement,
      unit: row.unit ?? '',
      value: 0,
      source: 'manual' as const,
    };
    current.value += row.value;
    measureMap.set(key, current);
    const dayKey = `${row.habit_id}:${row.measurement}:${row.unit}:${row.local_date}`;
    const daily = measureDailyMap.get(dayKey) ?? {
      id: row.habit_id,
      name: habit.name,
      measurement: row.measurement,
      unit: row.unit ?? '',
      date: row.local_date,
      value: 0,
      source: 'manual' as const,
    };
    daily.value += row.value;
    measureDailyMap.set(dayKey, daily);
  }
  for (const row of totalRows) {
    if (row.local_date < startDate || row.local_date > endDate) continue;
    const key = `${row.habit_id}:${row.measurement}:${row.unit}`;
    const current = measureMap.get(key) ?? {
      id: row.habit_id,
      name: row.name,
      measurement: row.measurement,
      unit: row.unit,
      value: 0,
      source: 'daily_total' as const,
    };
    current.value += row.value;
    measureMap.set(key, current);
  }
  type DigitalDay = InsightMetricRow & {
    target: number;
    overLimitDays: number;
    confirmed: boolean;
    hasData: boolean;
  };
  const digitalDays = new Map<string, DigitalDay>();
  for (const row of totalRows) {
    if (row.local_date < startDate || row.local_date > endDate) continue;
    const target = atVersion(targetsByHabit.get(row.habit_id) ?? [], row.local_date);
    if (!target || target.target_mode !== 'maximum' || target.measurement !== row.measurement)
      continue;
    const canonicalTarget = toCanonical(
      target.target_value,
      measurementForHabit(target.measurement, target.unit),
      target.unit,
    ).value;
    digitalDays.set(`${row.habit_id}:${row.local_date}:${row.measurement}`, {
      id: row.habit_id,
      name: row.name,
      measurement: row.measurement,
      unit: row.unit,
      value: row.value,
      target: canonicalTarget,
      overLimitDays: Number(row.value > canonicalTarget),
      source: 'daily_total',
      confirmed: true,
      hasData: true,
    });
  }
  for (const row of activityRows) {
    if (
      !row.habit_id ||
      row.value == null ||
      row.local_date < startDate ||
      row.local_date > endDate ||
      digitalUsageReplaced(row.habit_id, row.local_date, row.measurement, totalRows)
    )
      continue;
    const habit = habits.find((item) => item.id === row.habit_id);
    const target = atVersion(targetsByHabit.get(row.habit_id) ?? [], row.local_date);
    if (
      !habit ||
      !target ||
      target.target_mode !== 'maximum' ||
      target.measurement !== row.measurement
    )
      continue;
    const canonicalTarget = toCanonical(
      target.target_value,
      measurementForHabit(target.measurement, target.unit),
      target.unit,
    ).value;
    const key = `${row.habit_id}:${row.local_date}:${row.measurement}`;
    const current = digitalDays.get(key) ?? {
      id: row.habit_id,
      name: habit.name,
      measurement: row.measurement,
      unit: row.unit ?? '',
      value: 0,
      target: canonicalTarget,
      overLimitDays: 0,
      source: 'manual' as const,
      confirmed: false,
      hasData: true,
    };
    current.value += row.value;
    current.overLimitDays = Number(current.value > current.target);
    digitalDays.set(key, current);
  }
  for (const habit of habits) {
    const target = atVersion(targetsByHabit.get(habit.id) ?? [], endDate);
    if (
      !target ||
      target.target_mode !== 'maximum' ||
      !['duration', 'count'].includes(target.measurement)
    )
      continue;
    const hasPeriodData = [...digitalDays.values()].some(
      (item) => item.id === habit.id && item.measurement === target.measurement,
    );
    if (hasPeriodData) continue;
    digitalDays.set(`unknown:${habit.id}:${target.measurement}`, {
      id: habit.id,
      name: habit.name,
      measurement: target.measurement,
      unit: target.measurement === 'duration' ? 'seconds' : 'count',
      value: 0,
      target: toCanonical(
        target.target_value,
        measurementForHabit(target.measurement, target.unit),
        target.unit,
      ).value,
      overLimitDays: 0,
      source: 'manual',
      confirmed: false,
      hasData: false,
    });
  }
  const digitalUsage = [...digitalDays.values()];
  const selectedWalkingRows = walkingRows.filter(
    (row) =>
      row.local_date >= startDate &&
      row.local_date <= endDate &&
      isWalkingDistanceHabit(row.name, 'distance'),
  );
  const walkingTotals = new Map<string, { name: string; meters: number; dates: Set<string> }>();
  for (const row of activityRows) {
    if (
      !row.habit_id ||
      row.value == null ||
      row.measurement !== 'distance' ||
      row.unit !== 'meters' ||
      row.local_date < startDate ||
      row.local_date > endDate ||
      walkingReplaced(row.habit_id, row.local_date, walkingRows)
    )
      continue;
    const habit = habits.find((item) => item.id === row.habit_id);
    const target = atVersion(targetsByHabit.get(row.habit_id) ?? [], row.local_date);
    if (!habit || !target || !isWalkingDistanceHabit(habit.name, target.measurement)) continue;
    const current = walkingTotals.get(row.habit_id) ?? {
      name: habit.name,
      meters: 0,
      dates: new Set<string>(),
    };
    current.meters += row.value;
    current.dates.add(row.local_date);
    walkingTotals.set(row.habit_id, current);
  }
  for (const row of selectedWalkingRows) {
    const current = walkingTotals.get(row.habit_id) ?? {
      name: row.name,
      meters: 0,
      dates: new Set<string>(),
    };
    current.meters += row.value;
    current.dates.add(row.local_date);
    walkingTotals.set(row.habit_id, current);
  }
  for (const row of selectedWalkingRows) {
    const key = `${row.habit_id}:distance:meters`;
    const current = measureMap.get(key) ?? {
      id: row.habit_id,
      name: row.name,
      measurement: 'distance',
      unit: 'meters',
      value: 0,
      source: 'device' as const,
    };
    current.value += row.value;
    measureMap.set(key, current);
  }
  const walking = [...walkingTotals].map(([id, item]) => ({
    id,
    name: item.name,
    distanceMeters: item.meters,
    days: item.dates.size,
  }));

  return {
    startDate,
    endDate,
    today,
    habits: habitInsights,
    focus: focusData,
    tasks: {
      completed: tasks?.completed ?? 0,
      pending: tasks?.pending ?? 0,
      overdue: tasks?.overdue ?? 0,
    },
    routines: {
      completedRuns: routines?.completed_runs ?? 0,
      totalRuns: routines?.total_runs ?? 0,
      completedSteps: routines?.completed_steps ?? 0,
      skippedSteps: routines?.skipped_steps ?? 0,
    },
    categories: categories.map((row) => ({
      category: row.category,
      activities: row.activities,
      durationSeconds: row.duration_seconds ?? 0,
    })),
    measurements: [...measureMap.values()],
    measurementDaily: [...measureDailyMap.values()].sort((left, right) =>
      left.date.localeCompare(right.date),
    ),
    digitalUsage,
    walking,
    goals: goals.filter(
      (goal) =>
        ['active', 'paused', 'achieved'].includes(goal.status) ||
        (goal.status === 'ended' && goal.endDate >= startDate && goal.endDate <= endDate),
    ),
    achievedMilestones: milestoneRow?.achieved ?? 0,
  };
}

export async function getDailyReviewFacts(localDate: string) {
  const database = await db();
  const [focus, routines, activity, usage, trackedRows] = await Promise.all([
    database.getFirstAsync<{ sessions: number; seconds: number }>(
      `SELECT COUNT(DISTINCT f.session_id) sessions,COALESCE(SUM(f.credited_seconds),0) seconds
       FROM focus_session_activity_logs f JOIN focus_sessions s ON s.id=f.session_id AND s.status='completed'
       JOIN activity_logs a ON a.id=f.activity_log_id AND a.deleted_at IS NULL
       WHERE f.active=1 AND f.local_date=?`,
      localDate,
    ),
    database.getFirstAsync<{ runs: number; completed: number; skipped: number }>(
      `SELECT COUNT(DISTINCT r.id) runs,
        SUM(CASE WHEN s.status='completed' THEN 1 ELSE 0 END) completed,
        SUM(CASE WHEN s.status='skipped' THEN 1 ELSE 0 END) skipped
       FROM routine_runs r LEFT JOIN routine_run_steps s ON s.run_id=r.id
       WHERE r.local_date=? AND r.status!='abandoned'`,
      localDate,
    ),
    database.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) count FROM activity_logs WHERE local_date=? AND deleted_at IS NULL',
      localDate,
    ),
    database.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) count FROM digital_usage_daily_totals WHERE local_date=?',
      localDate,
    ),
    database.getAllAsync<{
      id: string;
      name: string;
      measurement: string;
      value: number;
      unit: string;
      input_value: number | null;
      input_unit: string | null;
      source: string;
      occurred_at: string;
    }>(
      `SELECT * FROM (
        SELECT e.id,h.name,e.measurement,e.value,e.unit,e.input_value,e.input_unit,'manual' source,e.occurred_at
        FROM activity_logs e JOIN habits h ON h.id=e.habit_id
        WHERE e.local_date=? AND e.deleted_at IS NULL AND e.focus_session_id IS NULL
          AND e.kind='progress' AND e.value IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM digital_usage_daily_totals d WHERE d.habit_id=e.habit_id AND d.local_date=e.local_date AND d.measurement=e.measurement)
          AND NOT EXISTS (SELECT 1 FROM walking_device_snapshots w JOIN walking_tracking_preferences p ON p.habit_id=w.habit_id AND p.mode='automatic'
            WHERE w.habit_id=e.habit_id AND w.local_date=e.local_date AND w.measurement=e.measurement)
        UNION ALL
        SELECT 'usage:'||d.habit_id||':'||d.local_date,h.name,d.measurement,d.value,d.unit,d.input_value,d.input_unit,'manual_daily_total',d.recorded_at
        FROM digital_usage_daily_totals d JOIN habits h ON h.id=d.habit_id WHERE d.local_date=?
        UNION ALL
        SELECT 'device:'||w.habit_id||':'||w.local_date,h.name,'distance',w.value,'meters',NULL,NULL,'device_snapshot',w.refreshed_at
        FROM walking_device_snapshots w JOIN walking_tracking_preferences p ON p.habit_id=w.habit_id AND p.mode='automatic'
        JOIN habits h ON h.id=w.habit_id WHERE w.local_date=? AND w.measurement='distance'
      ) ORDER BY occurred_at LIMIT 100`,
      localDate,
      localDate,
      localDate,
    ),
  ]);
  return {
    focusSessions: focus?.sessions ?? 0,
    focusSeconds: focus?.seconds ?? 0,
    routineRuns: routines?.runs ?? 0,
    routineCompletedSteps: routines?.completed ?? 0,
    routineSkippedSteps: routines?.skipped ?? 0,
    recordedActivities: activity?.count ?? 0,
    confirmedUsageTotals: usage?.count ?? 0,
    trackedRecords: trackedRows
      .filter(
        (row) =>
          row.source !== 'device_snapshot' || isWalkingDistanceHabit(row.name, row.measurement),
      )
      .map((row) => ({
        id: row.id,
        name: row.name,
        value: row.input_value ?? row.value,
        unit: row.input_unit ?? row.unit,
        source: row.source,
        occurredAt: row.occurred_at,
      })),
  };
}

export async function getRoutineEventsForDate(localDate: string): Promise<RoutineDayEvent[]> {
  const database = await db();
  return database.getAllAsync<RoutineDayEvent>(
    `SELECT rr.id,r.name,rr.status,rr.started_at startedAt,rr.finished_at finishedAt,rr.timezone
     FROM routine_runs rr JOIN routines r ON r.id=rr.routine_id
     WHERE rr.local_date=? ORDER BY rr.started_at,rr.id LIMIT 100`,
    localDate,
  );
}

function groupBy<T, K extends string>(items: T[], key: (item: T) => K) {
  const result = new Map<K, T[]>();
  for (const item of items) {
    const value = key(item);
    const group = result.get(value) ?? [];
    group.push(item);
    result.set(value, group);
  }
  return result;
}

function digitalUsageReplaced(
  habitId: string,
  date: string,
  measurement: string,
  totals: Array<{ habit_id: string; local_date: string; measurement: string }>,
) {
  return totals.some(
    (row) => row.habit_id === habitId && row.local_date === date && row.measurement === measurement,
  );
}

function walkingReplaced(
  habitId: string,
  date: string,
  snapshots: Array<{ habit_id: string; local_date: string }>,
) {
  return snapshots.some((row) => row.habit_id === habitId && row.local_date === date);
}
