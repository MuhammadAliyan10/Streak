import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { habitMigrationV2 } from './habit-migration.ts';
import { walkingTrackingMigrationV8 } from './walking-tracking-migration.ts';
import {
  effectiveWalkingProgress,
  isWalkingDistanceHabit,
  localDayBounds,
} from './walking-tracking-domain.ts';

test('automatic tracking is limited to explicitly named walking distance habits', () => {
  assert.equal(isWalkingDistanceHabit('Walk 8 km', 'distance'), true);
  assert.equal(isWalkingDistanceHabit('Walking every day', 'distance'), true);
  assert.equal(isWalkingDistanceHabit('Cycling 8 km', 'distance'), false);
  assert.equal(isWalkingDistanceHabit('Walk 8 km', 'duration'), false);
});

test('local health query ranges honor daylight-saving day boundaries', () => {
  const spring = localDayBounds('2026-03-08', 'America/New_York');
  const fall = localDayBounds('2026-11-01', 'America/New_York');
  assert.equal((spring.to.getTime() - spring.from.getTime()) / 3_600_000, 23);
  assert.equal((fall.to.getTime() - fall.from.getTime()) / 3_600_000, 25);
});

test('a device snapshot replaces manual progress only when a snapshot exists', () => {
  assert.equal(effectiveWalkingProgress(1200, 2800), 2800);
  assert.equal(effectiveWalkingProgress(1200, 0), 0);
  assert.equal(effectiveWalkingProgress(1200, null), 1200);
});

test('walking migration keeps one replaceable device total per habit and local day', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA foreign_keys = ON');
    db.exec(habitMigrationV2);
    const habitId = (
      db
        .prepare(
          "INSERT INTO habits(name,kind,icon,color,created_at,updated_at) VALUES ('Walk 8 km','good','fitness','indigo','now','now') RETURNING id",
        )
        .get() as { id: string }
    ).id;
    db.exec(walkingTrackingMigrationV8);
    db.prepare(
      'INSERT INTO walking_tracking_preferences(habit_id,mode,updated_at) VALUES(?,?,?)',
    ).run(habitId, 'automatic', 'now');
    const save = db.prepare(
      `INSERT INTO walking_device_snapshots
       (habit_id,local_date,provider,measurement,value,unit,range_start,range_end,refreshed_at)
       VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(habit_id,local_date,measurement) DO UPDATE SET
       provider=excluded.provider,value=excluded.value,unit=excluded.unit,
       range_start=excluded.range_start,range_end=excluded.range_end,refreshed_at=excluded.refreshed_at`,
    );
    const values = [
      habitId,
      '2026-11-01',
      'ios_healthkit',
      'distance',
      2600,
      'meters',
      '2026-11-01T00:00:00Z',
      '2026-11-02T00:00:00Z',
      'now',
    ] as const;
    save.run(...values);
    save.run(...values.slice(0, 4), 3100, ...values.slice(5));
    const snapshot = db
      .prepare('SELECT value,unit FROM walking_device_snapshots WHERE habit_id=? AND local_date=?')
      .get(habitId, '2026-11-01') as { value: number; unit: string };
    assert.deepEqual({ ...snapshot }, { value: 3100, unit: 'meters' });
    assert.equal(
      (db.prepare('SELECT COUNT(*) count FROM walking_device_snapshots').get() as { count: number })
        .count,
      1,
    );
  } finally {
    db.close();
  }
});
