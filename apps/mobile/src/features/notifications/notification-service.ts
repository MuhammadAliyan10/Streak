import * as Notifications from 'expo-notifications';
import { Linking, Platform } from 'react-native';
import { z } from 'zod';
import { initializeLocalDatabase } from '../../services/local-database';
import { dateAdd, todayInTimezone } from '../habits/domain/habit-domain';
import { timestampFromLocal } from '../habits/domain/activity-domain';
import {
  planReminders,
  reconcileOwnedNotifications,
  validReminderDestination,
  type ReminderCandidate,
  type ReminderPreferences,
} from './notification-domain';

const timeSchema = z.string().refine((value) => !value || /^([01]\d|2[0-3]):[0-5]\d$/.test(value));
export const reminderPreferencesSchema = z
  .object({
    enabled: z.boolean(),
    preferredTime: timeSchema,
    advanceMinutes: z.coerce.number().int().min(0).max(120),
    flexibleWarningMinutes: z.coerce.number().int().min(0).max(240),
    quietStart: timeSchema,
    quietEnd: timeSchema,
    soundEnabled: z.boolean(),
  })
  .superRefine((value, context) => {
    if (Boolean(value.quietStart) !== Boolean(value.quietEnd))
      context.addIssue({
        code: 'custom',
        path: ['quietEnd'],
        message: 'Set both quiet-hour times or leave both empty.',
      });
  });

export const defaultReminderPreferences: ReminderPreferences = {
  enabled: false,
  preferredTime: '18:00',
  advanceMinutes: 0,
  flexibleWarningMinutes: 60,
  quietStart: '',
  quietEnd: '',
  soundEnabled: true,
};

let responseSubscription: Notifications.EventSubscription | undefined;

Notifications.setNotificationHandler({
  handleNotification: async (notification) => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: Boolean(notification.request.content.sound),
    shouldSetBadge: false,
  }),
});

export async function getNotificationPermission() {
  const permission = await Notifications.getPermissionsAsync();
  return {
    granted: permission.granted,
    canAskAgain: permission.canAskAgain,
    status: permission.status,
  };
}

export async function requestNotificationPermission() {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('streak-reminders', {
      name: 'Streak reminders',
      importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 200, 100, 200],
    });
  }
  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

export function openNotificationSettings() {
  return Linking.openSettings();
}

export async function getReminderPreferences(): Promise<ReminderPreferences> {
  const database = await initializeLocalDatabase();
  const row = await database.getFirstAsync<Record<string, unknown>>(
    'SELECT * FROM reminder_preferences WHERE singleton_id=1',
  );
  if (!row) return defaultReminderPreferences;
  return reminderPreferencesSchema.parse({
    enabled: Boolean(row.enabled),
    preferredTime: row.preferred_time,
    advanceMinutes: Number(row.advance_minutes),
    flexibleWarningMinutes: Number(row.flexible_warning_minutes),
    quietStart: row.quiet_start,
    quietEnd: row.quiet_end,
    soundEnabled: Boolean(row.sound_enabled),
  });
}

export async function saveReminderPreferences(raw: ReminderPreferences) {
  const preferences = reminderPreferencesSchema.parse(raw);
  if (preferences.enabled && !(await requestNotificationPermission())) {
    throw new Error(
      'Notifications are not allowed. Enable them in your device settings to turn on reminders.',
    );
  }
  const database = await initializeLocalDatabase();
  await database.runAsync(
    `UPDATE reminder_preferences SET enabled=?,preferred_time=?,advance_minutes=?,flexible_warning_minutes=?,quiet_start=?,quiet_end=?,sound_enabled=?,updated_at=? WHERE singleton_id=1`,
    Number(preferences.enabled),
    preferences.preferredTime,
    preferences.advanceMinutes,
    preferences.flexibleWarningMinutes,
    preferences.quietStart,
    preferences.quietEnd,
    Number(preferences.soundEnabled),
    new Date().toISOString(),
  );
  await reconcileReminders();
}

export async function setReminderOverride(
  kind: 'habit' | 'task' | 'goal' | 'routine',
  id: string,
  enabled: boolean,
) {
  const database = await initializeLocalDatabase();
  await database.runAsync(
    'INSERT INTO reminder_overrides(entity_kind,entity_id,enabled) VALUES(?,?,?) ON CONFLICT(entity_kind,entity_id) DO UPDATE SET enabled=excluded.enabled',
    kind,
    id,
    Number(enabled),
  );
  await reconcileReminders();
}

export async function getReminderOverrides(kind: 'habit' | 'task' | 'goal' | 'routine') {
  const database = await initializeLocalDatabase();
  const rows = await database.getAllAsync<{ entity_id: string; enabled: number }>(
    'SELECT entity_id,enabled FROM reminder_overrides WHERE entity_kind=?',
    kind,
  );
  return new Map(rows.map((row) => [row.entity_id, Boolean(row.enabled)]));
}

export async function getReminderChoices() {
  const database = await initializeLocalDatabase();
  const rows = await database.getAllAsync<{ entity_kind: string; id: string; title: string }>(
    `SELECT 'habit' entity_kind,id,name title FROM habits WHERE status='active'
     UNION ALL SELECT 'task',id,title FROM tasks WHERE status='pending' AND deleted_at IS NULL
     UNION ALL SELECT 'goal',id,title FROM goals WHERE status='active' AND deleted_at IS NULL
     UNION ALL SELECT 'routine',id,name FROM routines WHERE status='active' AND deleted_at IS NULL`,
  );
  const overrides = await database.getAllAsync<{
    entity_kind: string;
    entity_id: string;
    enabled: number;
  }>('SELECT entity_kind,entity_id,enabled FROM reminder_overrides');
  const byKey = new Map(
    overrides.map((row) => [`${row.entity_kind}:${row.entity_id}`, Boolean(row.enabled)]),
  );
  return rows.map((row) => ({
    kind: row.entity_kind as 'habit' | 'task' | 'goal' | 'routine',
    id: row.id,
    title: row.title,
    enabled: byKey.get(`${row.entity_kind}:${row.id}`) ?? true,
  }));
}

async function loadActivities(preferences: ReminderPreferences) {
  const database = await initializeLocalDatabase();
  const today = todayInTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  const horizon = 14;
  const overrides = await database.getAllAsync<{
    entity_kind: string;
    entity_id: string;
    enabled: number;
  }>('SELECT entity_kind,entity_id,enabled FROM reminder_overrides');
  const overrideMap = new Map(
    overrides.map((row) => [`${row.entity_kind}:${row.entity_id}`, Boolean(row.enabled)]),
  );
  const activities: Array<{
    id: string;
    kind: ReminderCandidate['kind'];
    title: string;
    route: string;
    timezone: string;
    localDate: string;
    localTime: string;
    body: string;
    enabled?: boolean | undefined;
  }> = [];

  const habitSchedules = await database.getAllAsync<{
    id: string;
    name: string;
    status: string;
    mode: string;
    weekday_mask: number;
    timezone: string;
    effective_from: string;
    effective_to: string | null;
    fixed_time: string | null;
    window_start: string | null;
    window_end: string | null;
  }>(
    `SELECT h.id,h.name,h.status,s.mode,s.weekday_mask,s.timezone,s.effective_from,s.effective_to,s.fixed_time,s.window_start,s.window_end
     FROM habits h JOIN habit_schedules s ON s.habit_id=h.id
     WHERE h.status='active' AND s.effective_from<=? AND (s.effective_to IS NULL OR s.effective_to>=?)
     ORDER BY h.id,s.effective_from DESC`,
    dateAdd(today, horizon + 2),
    dateAdd(today, -2),
  );
  const schedulesByHabit = new Map<string, typeof habitSchedules>();
  for (const schedule of habitSchedules) {
    const schedules = schedulesByHabit.get(schedule.id) ?? [];
    schedules.push(schedule);
    schedulesByHabit.set(schedule.id, schedules);
  }
  for (const schedules of schedulesByHabit.values()) {
    const habit = schedules[0]!;
    const localToday = todayInTimezone(habit.timezone);
    const from = dateAdd(localToday, -1);
    const enabled = overrideMap.get(`habit:${habit.id}`);
    const activityDays = await database.getAllAsync<{
      local_date: string;
      progress: number;
      outcome: number;
    }>(
      `SELECT local_date,SUM(CASE WHEN kind='progress' THEN value ELSE 0 END) progress,MAX(CASE WHEN kind IN ('complete_override','clean','skip') THEN 1 ELSE 0 END) outcome FROM activity_logs WHERE habit_id=? AND deleted_at IS NULL AND local_date>=? GROUP BY local_date`,
      habit.id,
      localToday,
    );
    const doneDates = new Set<string>();
    const confirmedUsage = await database.getAllAsync<{ local_date: string }>(
      'SELECT local_date FROM digital_usage_daily_totals WHERE habit_id=? AND local_date>=?',
      habit.id,
      localToday,
    );
    for (const day of confirmedUsage) doneDates.add(day.local_date);
    for (const day of activityDays) {
      if (day.outcome) {
        doneDates.add(day.local_date);
        continue;
      }
      if (day.progress > 0) {
        const target = await database.getFirstAsync<{ target_value: number; target_mode: string }>(
          `SELECT target_value,target_mode FROM habit_targets WHERE habit_id=? AND effective_from<=? AND (effective_to IS NULL OR effective_to>=?) ORDER BY effective_from DESC LIMIT 1`,
          habit.id,
          day.local_date,
          day.local_date,
        );
        if (target?.target_mode !== 'maximum' && target && day.progress >= target.target_value)
          doneDates.add(day.local_date);
      }
    }
    for (let offset = 0; offset <= horizon; offset += 1) {
      const date = dateAdd(from, offset);
      const schedule = schedules.find(
        (item) => date >= item.effective_from && (!item.effective_to || date <= item.effective_to),
      );
      if (
        !schedule ||
        doneDates.has(date) ||
        !(schedule.weekday_mask & (1 << new Date(`${date}T00:00:00Z`).getUTCDay()))
      )
        continue;
      if (schedule.mode === 'fixed' && schedule.fixed_time) {
        activities.push({
          id: habit.id,
          kind: 'habit',
          title: habit.name,
          route: `/habits/${habit.id}`,
          timezone: schedule.timezone,
          localDate: date,
          localTime: schedule.fixed_time,
          body: `Time for ${habit.name}.`,
          enabled,
        });
        if (preferences.advanceMinutes > 0) {
          const [reminderDate, reminderTime] = shiftLocal(
            date,
            schedule.fixed_time,
            schedule.timezone,
            -preferences.advanceMinutes,
          );
          activities.push({
            id: habit.id,
            kind: 'habit',
            title: habit.name,
            route: `/habits/${habit.id}`,
            timezone: schedule.timezone,
            localDate: reminderDate,
            localTime: reminderTime,
            body: `${habit.name} starts soon.`,
            enabled,
          });
        }
      } else if (schedule.mode === 'flexible' && schedule.window_start && schedule.window_end) {
        activities.push({
          id: habit.id,
          kind: 'habit',
          title: habit.name,
          route: `/habits/${habit.id}`,
          timezone: schedule.timezone,
          localDate: date,
          localTime: schedule.window_start,
          body: `Your ${habit.name} window is open.`,
          enabled,
        });
        if (
          preferences.preferredTime >= schedule.window_start &&
          preferences.preferredTime < schedule.window_end
        )
          activities.push({
            id: habit.id,
            kind: 'habit',
            title: habit.name,
            route: `/habits/${habit.id}`,
            timezone: schedule.timezone,
            localDate: date,
            localTime: preferences.preferredTime,
            body: `Check in on ${habit.name}.`,
            enabled,
          });
        if (preferences.flexibleWarningMinutes > 0) {
          const [warningDate, warningTime] = shiftLocal(
            date,
            schedule.window_end,
            schedule.timezone,
            -preferences.flexibleWarningMinutes,
          );
          if (
            warningDate === date &&
            warningTime >= schedule.window_start &&
            warningTime < schedule.window_end
          )
            activities.push({
              id: habit.id,
              kind: 'habit',
              title: habit.name,
              route: `/habits/${habit.id}`,
              timezone: schedule.timezone,
              localDate: date,
              localTime: warningTime,
              body: `${habit.name} window closes soon.`,
              enabled,
            });
        }
      } else {
        activities.push({
          id: habit.id,
          kind: 'habit',
          title: habit.name,
          route: `/habits/${habit.id}`,
          timezone: schedule.timezone,
          localDate: date,
          localTime: preferences.preferredTime,
          body: `Make time for ${habit.name} today.`,
          enabled,
        });
      }
    }
  }

  const tasks = await database.getAllAsync<{
    id: string;
    title: string;
    planned_date: string;
    planned_time: string | null;
    timezone: string;
  }>(
    `SELECT id,title,planned_date,planned_time,timezone FROM tasks WHERE status='pending' AND deleted_at IS NULL AND planned_date BETWEEN ? AND ?`,
    today,
    dateAdd(today, horizon),
  );
  for (const task of tasks) {
    const time = task.planned_time ?? preferences.preferredTime;
    const enabled = overrideMap.get(`task:${task.id}`);
    activities.push({
      id: task.id,
      kind: 'task',
      title: task.title,
      route: `/tasks/${task.id}/edit`,
      timezone: task.timezone,
      localDate: task.planned_date,
      localTime: time,
      body: `You have a task scheduled for ${time}.`,
      enabled,
    });
    if (task.planned_time && preferences.advanceMinutes > 0) {
      const [d, t] = shiftLocal(
        task.planned_date,
        time,
        task.timezone,
        -preferences.advanceMinutes,
      );
      activities.push({
        id: task.id,
        kind: 'task',
        title: task.title,
        route: `/tasks/${task.id}/edit`,
        timezone: task.timezone,
        localDate: d,
        localTime: t,
        body: `${task.title} is coming up.`,
        enabled,
      });
    }
  }

  const goals = await database.getAllAsync<{
    id: string;
    title: string;
    end_date: string;
    timezone: string;
  }>(
    `SELECT id,title,end_date,timezone FROM goals WHERE status='active' AND deleted_at IS NULL AND end_date BETWEEN ? AND ?`,
    today,
    dateAdd(today, horizon),
  );
  for (const goal of goals) {
    const enabled = overrideMap.get(`goal:${goal.id}`);
    for (const [date, body] of [
      [goal.end_date, `Your goal “${goal.title}” reaches its deadline today.`],
      [dateAdd(goal.end_date, -1), `Your goal “${goal.title}” is due tomorrow.`],
    ] as const)
      activities.push({
        id: `${goal.id}:${date}`,
        kind: 'goal',
        title: goal.title,
        route: `/goals/${goal.id}`,
        timezone: goal.timezone,
        localDate: date,
        localTime: preferences.preferredTime,
        body,
        enabled,
      });
  }
  const milestones = await database.getAllAsync<{
    id: string;
    goal_id: string;
    title: string;
    due_date: string;
    timezone: string;
    current_progress: number;
  }>(
    `SELECT m.id,m.goal_id,m.title,m.due_date,g.timezone,
       COALESCE((SELECT SUM(a.value) FROM activity_logs a WHERE a.deleted_at IS NULL AND a.kind='progress' AND (a.goal_id=m.goal_id OR (a.goal_id IS NULL AND a.habit_id IN (SELECT gh.habit_id FROM goal_habits gh WHERE gh.goal_id=m.goal_id)))),0) current_progress
     FROM goal_milestones m JOIN goals g ON g.id=m.goal_id
     WHERE m.completed_at IS NULL AND g.status='active' AND g.deleted_at IS NULL
       AND m.due_date BETWEEN ? AND ? AND m.target_value>COALESCE((SELECT SUM(a.value) FROM activity_logs a WHERE a.deleted_at IS NULL AND a.kind='progress' AND (a.goal_id=m.goal_id OR (a.goal_id IS NULL AND a.habit_id IN (SELECT gh.habit_id FROM goal_habits gh WHERE gh.goal_id=m.goal_id)))),0)`,
    today,
    dateAdd(today, horizon),
  );
  for (const milestone of milestones)
    activities.push({
      id: milestone.id,
      kind: 'goal',
      title: milestone.title,
      route: `/goals/${milestone.goal_id}`,
      timezone: milestone.timezone,
      localDate: milestone.due_date,
      localTime: preferences.preferredTime,
      body: `Goal milestone due: ${milestone.title}.`,
      enabled: overrideMap.get(`goal:${milestone.goal_id}`),
    });

  const routines = await database.getAllAsync<{
    id: string;
    name: string;
    start_time: string | null;
    weekday_mask: number;
    timezone: string;
  }>(
    `SELECT id,name,start_time,weekday_mask,timezone FROM routines WHERE status='active' AND deleted_at IS NULL`,
  );
  for (const routine of routines) {
    const routineToday = todayInTimezone(routine.timezone);
    for (let offset = 0; offset < horizon; offset += 1) {
      const date = dateAdd(routineToday, offset);
      if (!(routine.weekday_mask & (1 << new Date(`${date}T00:00:00Z`).getUTCDay()))) continue;
      const completed = await database.getFirstAsync<{ id: string }>(
        `SELECT id FROM routine_runs WHERE routine_id=? AND local_date=? AND status IN ('active','paused','completed') LIMIT 1`,
        routine.id,
        date,
      );
      if (completed) continue;
      activities.push({
        id: routine.id,
        kind: 'routine',
        title: routine.name,
        route: `/routines/${routine.id}`,
        timezone: routine.timezone,
        localDate: date,
        localTime: routine.start_time ?? preferences.preferredTime,
        body: `Your ${routine.name} routine is coming up.`,
        enabled: overrideMap.get(`routine:${routine.id}`),
      });
    }
  }
  return { database, activities };
}

function shiftLocal(
  date: string,
  time: string,
  timezone: string,
  minutes: number,
): [string, string] {
  const start = Date.parse(timestampFromLocal(date, time, timezone));
  const shifted = new Date(start + minutes * 60_000);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(shifted);
  const val = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return [`${val('year')}-${val('month')}-${val('day')}`, `${val('hour')}:${val('minute')}`];
}

export async function reconcileReminders() {
  const preferences = await getReminderPreferences();
  const { database, activities } = await loadActivities(preferences);
  if (!(await getNotificationPermission()).granted) {
    const pending = await Notifications.getAllScheduledNotificationsAsync();
    for (const item of pending)
      if (typeof item.content.data?.streakReminderKey === 'string')
        await Notifications.cancelScheduledNotificationAsync(item.identifier);
    await database.runAsync('DELETE FROM scheduled_reminders');
    return 0;
  }
  const candidates = planReminders({ activities, preferences, horizonDays: 14 });
  const androidChannelId = preferences.soundEnabled
    ? 'streak-reminders-sound'
    : 'streak-reminders-silent';
  if (Platform.OS === 'android')
    await Notifications.setNotificationChannelAsync(androidChannelId, {
      name: preferences.soundEnabled ? 'Streak reminders' : 'Streak reminders (silent)',
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: preferences.soundEnabled ? 'default' : null,
    });
  const pending = await Notifications.getAllScheduledNotificationsAsync();
  const owned = pending.filter((item) => typeof item.content.data?.streakReminderKey === 'string');
  const wanted = new Map(candidates.map((candidate) => [candidate.key, candidate]));
  const nativeIds = await reconcileOwnedNotifications({
    wantedKeys: candidates.map((candidate) => candidate.key),
    pending: owned.map((item) => ({
      key: String(item.content.data?.streakReminderKey),
      nativeId: item.identifier,
    })),
    cancel: (nativeId) => Notifications.cancelScheduledNotificationAsync(nativeId),
    schedule: async (key) => {
      const candidate = wanted.get(key);
      if (!candidate) throw new Error('Reminder plan changed during reconciliation.');
      return Notifications.scheduleNotificationAsync({
        content: {
          title: candidate.title,
          body: candidate.body,
          sound: preferences.soundEnabled ? 'default' : false,
          data: {
            streakReminderKey: candidate.key,
            route: candidate.route,
            entityId: candidate.entityId,
            entityKind: candidate.kind,
          },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: new Date(candidate.timestamp),
          ...(Platform.OS === 'android' ? { channelId: androidChannelId } : {}),
        },
      });
    },
  });
  await database.runAsync('DELETE FROM scheduled_reminders');
  for (const candidate of candidates) {
    const nativeId = nativeIds.get(candidate.key);
    if (!nativeId) continue;
    await database.runAsync(
      'INSERT OR REPLACE INTO scheduled_reminders(reminder_key,native_id,entity_kind,entity_id,scheduled_at) VALUES(?,?,?,?,?)',
      candidate.key,
      nativeId,
      candidate.kind,
      candidate.entityId,
      candidate.timestamp,
    );
  }
  return candidates.length;
}

export async function cancelReminderForEntity(kind: string, id: string) {
  const database = await initializeLocalDatabase();
  const rows = await database.getAllAsync<{ native_id: string }>(
    'SELECT native_id FROM scheduled_reminders WHERE entity_kind=? AND entity_id=?',
    kind,
    id,
  );
  for (const row of rows) await Notifications.cancelScheduledNotificationAsync(row.native_id);
  await database.runAsync(
    'DELETE FROM scheduled_reminders WHERE entity_kind=? AND entity_id=?',
    kind,
    id,
  );
}

export async function scheduleFocusCompletion(
  sessionId: string,
  title: string,
  remainingSeconds: number,
  enabled = true,
) {
  await cancelFocusCompletion(sessionId);
  if (!enabled || remainingSeconds <= 0 || !(await getNotificationPermission()).granted) return;
  const preferences = await getReminderPreferences();
  if (!preferences.enabled) return;
  const database = await initializeLocalDatabase();
  const nativeId = await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Focus session complete',
      body: `Your ${title} countdown has finished.`,
      sound: preferences.soundEnabled ? 'default' : false,
      data: {
        streakReminderKey: `focus:${sessionId}`,
        route: `/focus/session?sessionId=${encodeURIComponent(sessionId)}`,
        entityId: sessionId,
        entityKind: 'focus',
      },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: Math.max(1, Math.floor(remainingSeconds)),
      repeats: false,
    },
  });
  await database.runAsync(
    'INSERT OR REPLACE INTO scheduled_reminders(reminder_key,native_id,entity_kind,entity_id,scheduled_at) VALUES(?,?,?,?,?)',
    `focus:${sessionId}`,
    nativeId,
    'focus',
    sessionId,
    new Date(Date.now() + remainingSeconds * 1000).toISOString(),
  );
}

export async function cancelFocusCompletion(sessionId: string) {
  await cancelReminderForEntity('focus', sessionId);
}

export function listenForNotificationResponses(onRoute: (route: string) => void) {
  responseSubscription?.remove();
  let lastResponse = '';
  const handleResponse = (response: Notifications.NotificationResponse) => {
    const routeSchema = z
      .string()
      .refine(validReminderDestination, 'Invalid notification destination.');
    const data = z
      .object({ streakReminderKey: z.string().min(1), route: routeSchema })
      .safeParse(response.notification.request.content.data);
    if (data.success) {
      const responseKey = `${response.notification.request.identifier}:${data.data.route}`;
      if (responseKey === lastResponse) return;
      lastResponse = responseKey;
      onRoute(data.data.route);
      void Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
    }
  };
  void Notifications.getLastNotificationResponseAsync()
    .then((response) => {
      if (response) handleResponse(response);
    })
    .catch(() => undefined);
  responseSubscription = Notifications.addNotificationResponseReceivedListener(handleResponse);
  return () => {
    responseSubscription?.remove();
    responseSubscription = undefined;
  };
}
