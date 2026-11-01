import { Platform } from 'react-native';
import { initializeLocalDatabase } from '../../services/local-database';
import { todayInTimezone } from './domain/habit-domain';
import { isWalkingDistanceHabit, localDayBounds } from './walking-tracking-domain';
export { isWalkingDistanceHabit };

export type WalkingTrackingMode = 'manual' | 'automatic';
export type WalkingReadResult =
  | { status: 'unavailable' | 'denied' | 'empty' | 'unconfirmed' }
  | { status: 'value'; meters: number; rangeStart: string; rangeEnd: string };

const distanceType = 'HKQuantityTypeIdentifierDistanceWalkingRunning';

export async function setWalkingTrackingMode(
  habitId: string,
  mode: WalkingTrackingMode,
): Promise<void> {
  const database = await initializeLocalDatabase();
  await database.runAsync(
    `INSERT INTO walking_tracking_preferences(habit_id,mode,updated_at) VALUES(?,?,?)
     ON CONFLICT(habit_id) DO UPDATE SET mode=excluded.mode,updated_at=excluded.updated_at`,
    habitId,
    mode,
    new Date().toISOString(),
  );
}

export async function getWalkingTrackingMode(habitId: string): Promise<WalkingTrackingMode> {
  const database = await initializeLocalDatabase();
  const row = await database.getFirstAsync<{ mode: WalkingTrackingMode }>(
    'SELECT mode FROM walking_tracking_preferences WHERE habit_id=?',
    habitId,
  );
  return row?.mode ?? 'manual';
}

export async function getAutomaticWalkingHabits(): Promise<
  Array<{ id: string; timezone: string }>
> {
  const database = await initializeLocalDatabase();
  const rows = await database.getAllAsync<{
    id: string;
    timezone: string;
    name: string;
    measurement: string;
  }>(
    `SELECT h.id,s.timezone,h.name,t.measurement FROM habits h
     JOIN walking_tracking_preferences p ON p.habit_id=h.id AND p.mode='automatic'
     JOIN habit_schedules s ON s.habit_id=h.id AND s.effective_to IS NULL
     JOIN habit_targets t ON t.habit_id=h.id AND t.effective_to IS NULL
     WHERE h.status='active' AND h.kind='good' AND t.measurement='distance'`,
  );
  return rows
    .filter((habit) => isWalkingDistanceHabit(habit.name, habit.measurement))
    .map(({ id, timezone }) => ({ id, timezone }));
}

async function readWalkingDistance(day: string, timezone: string): Promise<WalkingReadResult> {
  // Load the native module only after the user has explicitly enabled tracking.
  const health = await import('@appeeky/expo-healthkit');
  if (!health.isAvailable()) return { status: 'unavailable' };
  if (!health.getSupportedTypes().includes(distanceType)) return { status: 'unavailable' };

  if (Platform.OS === 'android') {
    const granted = await health.getGrantedPermissions();
    if (!granted.includes('android.permission.health.READ_DISTANCE')) {
      return { status: 'denied' };
    }
  }

  const { from, to } = localDayBounds(day, timezone);
  try {
    const statistics = await health.queryStatistics({
      type: distanceType,
      unit: 'm',
      from,
      to,
      options: health.StatisticsOption.cumulativeSum,
    });
    if (typeof statistics.sum !== 'number' || !Number.isFinite(statistics.sum)) {
      return { status: Platform.OS === 'ios' ? 'unconfirmed' : 'empty' };
    }
    if (statistics.sum === 0 && Platform.OS === 'ios') {
      return { status: 'unconfirmed' };
    }
    return {
      status: 'value',
      meters: Math.max(0, statistics.sum),
      rangeStart: from.toISOString(),
      rangeEnd: to.toISOString(),
    };
  } catch {
    return { status: Platform.OS === 'ios' ? 'unconfirmed' : 'denied' };
  }
}

export async function enableAutomaticWalkingTracking(): Promise<WalkingReadResult['status']> {
  const health = await import('@appeeky/expo-healthkit');
  if (!health.isAvailable() || !health.getSupportedTypes().includes(distanceType)) {
    return 'unavailable';
  }
  const permission = await health.requestAuthorization({ toRead: [distanceType] });
  if (Platform.OS === 'android') {
    const granted = await health.getGrantedPermissions();
    return permission && granted.includes('android.permission.health.READ_DISTANCE')
      ? 'value'
      : 'denied';
  }
  // HealthKit intentionally does not reveal whether read access was denied.
  return permission ? 'unconfirmed' : 'denied';
}

export async function syncWalkingSnapshot(
  habitId: string,
  timezone: string,
  day = todayInTimezone(timezone),
): Promise<WalkingReadResult> {
  if ((await getWalkingTrackingMode(habitId)) !== 'automatic') {
    return { status: 'unconfirmed' };
  }
  const result = await readWalkingDistance(day, timezone);
  if (result.status !== 'value') return result;
  const database = await initializeLocalDatabase();
  await database.runAsync(
    `INSERT INTO walking_device_snapshots
     (habit_id,local_date,provider,measurement,value,unit,range_start,range_end,refreshed_at)
     VALUES(?,?,?,?,?,?,?,?,?)
     ON CONFLICT(habit_id,local_date,measurement) DO UPDATE SET
       provider=excluded.provider,value=excluded.value,unit=excluded.unit,
       range_start=excluded.range_start,range_end=excluded.range_end,refreshed_at=excluded.refreshed_at`,
    habitId,
    day,
    Platform.OS === 'ios' ? 'ios_healthkit' : 'android_health_connect',
    'distance',
    result.meters,
    'meters',
    result.rangeStart,
    result.rangeEnd,
    new Date().toISOString(),
  );
  return result;
}

export async function syncEnabledWalkingSnapshots(day: string): Promise<void> {
  if (activeSync) return activeSync;
  activeSync = (async () => {
    try {
      const habits = await getAutomaticWalkingHabits();
      for (const habit of habits) {
        if (day !== todayInTimezone(habit.timezone)) continue;
        try {
          await syncWalkingSnapshot(habit.id, habit.timezone, day);
        } catch {
          // Retain the last good snapshot and manual fallback if a provider read fails.
        }
      }
    } catch {
      // The planner remains usable if local preference lookup fails.
    }
  })();
  try {
    await activeSync;
  } finally {
    activeSync = null;
  }
}

let activeSync: Promise<void> | null = null;

export async function getWalkingSnapshot(
  habitId: string,
  day: string,
): Promise<{ value: number; refreshedAt: string; provider: string } | null> {
  const database = await initializeLocalDatabase();
  const snapshot = await database.getFirstAsync<{
    value: number;
    refreshed_at: string;
    provider: string;
  }>(
    'SELECT value,refreshed_at,provider FROM walking_device_snapshots WHERE habit_id=? AND local_date=? AND measurement=?',
    habitId,
    day,
    'distance',
  );
  return snapshot
    ? { value: snapshot.value, refreshedAt: snapshot.refreshed_at, provider: snapshot.provider }
    : null;
}
