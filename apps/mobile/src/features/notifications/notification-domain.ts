import { dateAdd, weekdayFor } from '../habits/domain/habit-domain.ts';
import { timestampFromLocal } from '../habits/domain/activity-domain.ts';

export type ReminderPreferences = {
  enabled: boolean;
  preferredTime: string;
  advanceMinutes: number;
  flexibleWarningMinutes: number;
  quietStart: string;
  quietEnd: string;
  soundEnabled: boolean;
};
export type ReminderCandidate = {
  key: string;
  kind: 'habit' | 'task' | 'goal' | 'routine' | 'focus';
  entityId: string;
  title: string;
  body: string;
  route: string;
  timestamp: string;
};
export type ReminderActivity = {
  id: string;
  kind: ReminderCandidate['kind'];
  title: string;
  route: string;
  timezone: string;
  localDate: string;
  localTime: string;
  body: string;
  enabled?: boolean | undefined;
};
export type OwnedNotification = { key: string; nativeId: string };

export async function reconcileOwnedNotifications(input: {
  wantedKeys: readonly string[];
  pending: readonly OwnedNotification[];
  cancel: (nativeId: string) => Promise<void>;
  schedule: (key: string) => Promise<string>;
}): Promise<Map<string, string>> {
  const wanted = new Set(input.wantedKeys);
  const retained = new Map<string, string>();
  for (const item of input.pending) {
    if (!wanted.has(item.key) || retained.has(item.key)) await input.cancel(item.nativeId);
    else retained.set(item.key, item.nativeId);
  }
  for (const key of wanted) if (!retained.has(key)) retained.set(key, await input.schedule(key));
  return retained;
}

export function validReminderDestination(route: string): boolean {
  return (
    /^\/(habits|goals|routines)\/[A-Za-z0-9:_-]{1,128}$/.test(route) ||
    /^\/tasks\/[A-Za-z0-9:_-]{1,128}\/edit$/.test(route) ||
    /^\/focus\/session\?sessionId=[A-Za-z0-9%:_-]{1,384}$/.test(route)
  );
}

function addMinutes(
  date: string,
  time: string,
  timezone: string,
  offset: number,
): [string, string] {
  const start = Date.parse(timestampFromLocal(date, time, timezone));
  const shifted = new Date(start + offset * 60_000);
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

function inQuietHours(time: string, start: string, end: string): boolean {
  if (!start || !end || start === end) return false;
  return start < end ? time >= start && time < end : time >= start || time < end;
}

function reminderHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function quietAdjusted(
  activity: ReminderActivity,
  preferences: ReminderPreferences,
): ReminderActivity | null {
  if (inQuietHours(activity.localTime, preferences.quietStart, preferences.quietEnd)) return null;
  return activity;
}

export function reminderTimestamp(date: string, time: string, timezone: string): string {
  return timestampFromLocal(date, time, timezone);
}

export function planReminders(input: {
  activities: readonly ReminderActivity[];
  preferences: ReminderPreferences;
  now?: Date;
  horizonDays?: number;
}): ReminderCandidate[] {
  if (!input.preferences.enabled) return [];
  const now = input.now ?? new Date();
  const horizonEnd = now.getTime() + (input.horizonDays ?? 14) * 86_400_000;
  const candidates = new Map<string, ReminderCandidate>();
  for (const raw of input.activities) {
    if (raw.enabled === false) continue;
    const candidate = quietAdjusted(raw, input.preferences);
    if (!candidate) continue;
    let timestamp: string;
    try {
      timestamp = reminderTimestamp(candidate.localDate, candidate.localTime, candidate.timezone);
    } catch {
      continue;
    }
    const epoch = Date.parse(timestamp);
    if (!Number.isFinite(epoch) || epoch <= now.getTime() || epoch > horizonEnd) continue;
    const identity = `${candidate.kind}:${candidate.id}:${timestamp}`;
    if (candidates.has(identity)) continue;
    const key = `${identity}:${reminderHash(`${candidate.title}|${candidate.body}|${candidate.route}|${input.preferences.soundEnabled}`)}`;
    candidates.set(identity, {
      key,
      kind: candidate.kind,
      entityId: candidate.id,
      title: candidate.title,
      body: candidate.body,
      route: candidate.route,
      timestamp,
    });
  }
  return [...candidates.values()]
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    .slice(0, 60);
}

export function weekdayMatches(mask: number, date: string): boolean {
  return (mask & (1 << weekdayFor(date))) !== 0;
}

export function nextOccurrenceDates(input: {
  startDate: string;
  endDate?: string | null;
  weekdayMask: number;
  fromDate: string;
  days: number;
}): string[] {
  const dates: string[] = [];
  for (let offset = 0; offset < input.days; offset += 1) {
    const date = dateAdd(input.fromDate, offset);
    if (date < input.startDate || (input.endDate && date > input.endDate)) continue;
    if (weekdayMatches(input.weekdayMask, date)) dates.push(date);
  }
  return dates;
}

export function localDateTime(date: Date, timezone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const val = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return {
    date: `${val('year')}-${val('month')}-${val('day')}`,
    time: `${val('hour')}:${val('minute')}`,
  };
}

export function buildHabitReminders(input: {
  habit: {
    id: string;
    name: string;
    status: string;
    mode: string;
    weekdayMask: number;
    timezone: string;
    startDate: string;
    endDate: string | null;
    fixedTime: string | null;
    windowStart: string | null;
    windowEnd: string | null;
  };
  preferences: ReminderPreferences;
  fromDate: string;
  days?: number;
  enabled?: boolean;
}): ReminderActivity[] {
  const habit = input.habit;
  if (habit.status !== 'active' || input.enabled === false) return [];
  const days = input.days ?? 14;
  const reminderTimes: Array<{ date: string; time: string; body: string }> = [];
  for (const date of nextOccurrenceDates({
    startDate: habit.startDate,
    endDate: habit.endDate,
    weekdayMask: habit.weekdayMask,
    fromDate: input.fromDate,
    days,
  })) {
    if (habit.mode === 'fixed' && habit.fixedTime) {
      reminderTimes.push({
        date,
        time: habit.fixedTime,
        body: `Time for ${habit.name}.`,
      });
      if (input.preferences.advanceMinutes > 0) {
        const [reminderDate, reminderTime] = addMinutes(
          date,
          habit.fixedTime,
          habit.timezone,
          -input.preferences.advanceMinutes,
        );
        reminderTimes.push({
          date: reminderDate,
          time: reminderTime,
          body: `${habit.name} starts soon.`,
        });
      }
    } else if (habit.mode === 'flexible' && habit.windowStart && habit.windowEnd) {
      reminderTimes.push({
        date,
        time: habit.windowStart,
        body: `Your ${habit.name} window is open.`,
      });
      if (
        input.preferences.preferredTime >= habit.windowStart &&
        input.preferences.preferredTime < habit.windowEnd
      )
        reminderTimes.push({
          date,
          time: input.preferences.preferredTime,
          body: `Check in on ${habit.name}.`,
        });
      if (input.preferences.flexibleWarningMinutes > 0) {
        const [warningDate, warningTime] = addMinutes(
          date,
          habit.windowEnd,
          habit.timezone,
          -input.preferences.flexibleWarningMinutes,
        );
        if (
          warningDate === date &&
          warningTime >= habit.windowStart &&
          warningTime < habit.windowEnd
        )
          reminderTimes.push({
            date: warningDate,
            time: warningTime,
            body: `${habit.name} window closes soon.`,
          });
      }
    } else {
      reminderTimes.push({
        date,
        time: input.preferences.preferredTime,
        body: `Make time for ${habit.name} today.`,
      });
    }
  }
  return reminderTimes.map((reminder) => ({
    id: habit.id,
    kind: 'habit',
    title: habit.name,
    route: `/habits/${habit.id}`,
    timezone: habit.timezone,
    localDate: reminder.date,
    localTime: reminder.time,
    body: reminder.body,
    enabled: input.enabled,
  }));
}
