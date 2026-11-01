import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { activityMigrationV4 } from './activity-migration.ts';
import { habitMigrationV2 } from './habit-migration.ts';

test('activity migration preserves entry identity and converts stored values to canonical units', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA foreign_keys = ON');
    db.exec(habitMigrationV2);
    const habitId = (
      db
        .prepare(
          "INSERT INTO habits(name,kind,icon,color,created_at,updated_at) VALUES ('Walk','good','fitness','indigo','now','now') RETURNING id",
        )
        .get() as { id: string }
    ).id;
    const scheduleId = (
      db
        .prepare(
          "INSERT INTO habit_schedules(habit_id,mode,weekday_mask,timezone,effective_from,created_at) VALUES (?,'anytime',127,'Asia/Karachi','2026-11-01','now') RETURNING id",
        )
        .get(habitId) as { id: string }
    ).id;
    const targetId = (
      db
        .prepare(
          "INSERT INTO habit_targets(habit_id,measurement,target_value,unit,effective_from,created_at) VALUES (?,'distance',3,'km','2026-11-01','now') RETURNING id",
        )
        .get(habitId) as { id: string }
    ).id;
    const logId = (
      db
        .prepare(
          "INSERT INTO habit_entries(idempotency_key,habit_id,schedule_id,target_id,kind,value,unit,note,occurred_at,local_date,timezone,created_at) VALUES ('walk-event',?,?,?,'progress',1.5,'km','Evening walk','2026-11-01T13:00:00.000Z','2026-11-01','Asia/Karachi','2026-11-01T13:01:00.000Z') RETURNING id",
        )
        .get(habitId, scheduleId, targetId) as { id: string }
    ).id;
    db.exec(activityMigrationV4);
    const migrated = db
      .prepare(
        'SELECT id,idempotency_key,value,unit,input_value,input_unit,created_at FROM activity_logs WHERE habit_id=?',
      )
      .get(habitId) as {
      id: string;
      idempotency_key: string;
      value: number;
      unit: string;
      input_value: number;
      input_unit: string;
      created_at: string;
    };
    assert.deepEqual(
      { ...migrated },
      {
        id: logId,
        idempotency_key: 'walk-event',
        value: 1500,
        unit: 'meters',
        input_value: 1.5,
        input_unit: 'km',
        created_at: '2026-11-01T13:01:00.000Z',
      },
    );
    assert.equal(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='habit_entries'")
        .get(),
      undefined,
    );
  } finally {
    db.close();
  }
});

test('unassociated logs, presets, corrections, and soft deletion keep one measurable source', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA foreign_keys = ON');
    db.exec(habitMigrationV2);
    db.exec(activityMigrationV4);
    const add = db.prepare(`INSERT OR IGNORE INTO activity_logs (
      idempotency_key,category,title,measurement,kind,value,unit,input_value,input_unit,note,
      occurred_at,local_date,timezone,created_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const logValues = [
      'quick-water-1',
      'water',
      'Water',
      'volume',
      'progress',
      500,
      'mL',
      0.5,
      'L',
      '',
      '2026-11-01T10:15:00Z',
      '2026-11-01',
      'Asia/Karachi',
      '2026-11-01T10:15:00Z',
    ] as const;
    assert.equal(add.run(...logValues).changes, 1);
    assert.equal(add.run(...logValues).changes, 0);
    assert.equal(add.run('quick-water-2', ...logValues.slice(1)).changes, 1);
    const ids = db.prepare("SELECT id FROM activity_logs WHERE category='water'").all() as Array<{
      id: string;
    }>;
    assert.equal(new Set(ids.map((row) => row.id)).size, 2);
    const logId = ids[0]!.id;
    const presetHabit = (
      db
        .prepare(
          "INSERT INTO habits(name,kind,icon,color,created_at,updated_at) VALUES ('Water','good','water','sky','now','now') RETURNING id",
        )
        .get() as { id: string }
    ).id;
    const addPreset =
      db.prepare(`INSERT INTO activity_presets(habit_id,name,measurement,value,unit,input_value,input_unit,is_default,sort_order,created_at,updated_at)
      VALUES (?,'My Glass','volume',500,'mL',0.5,'L',1,0,'now','now') RETURNING id`);
    const presetId = (addPreset.get(presetHabit) as { id: string }).id;
    db.prepare(
      "UPDATE activity_presets SET name='Large Glass',value=750,input_value=0.75 WHERE id=?",
    ).run(presetId);
    assert.equal(
      db.prepare('SELECT name FROM activity_presets WHERE id=?').get(presetId)?.name,
      'Large Glass',
    );
    db.prepare(
      'INSERT INTO activity_log_revisions(log_id,idempotency_key,event_type,snapshot_json,occurred_at) VALUES (?,?,?,?,?)',
    ).run(
      logId,
      'undo-revision',
      'deleted',
      JSON.stringify({ value: 500, unit: 'mL' }),
      '2026-11-01T12:00:00Z',
    );
    db.prepare('UPDATE activity_logs SET deleted_at=? WHERE id=?').run(
      '2026-11-01T12:00:00Z',
      logId,
    );
    assert.equal(
      db
        .prepare(
          "SELECT SUM(value) total FROM activity_logs WHERE category='water' AND deleted_at IS NULL",
        )
        .get()?.total,
      500,
    );
    assert.equal(
      db.prepare('SELECT COUNT(*) count FROM activity_log_revisions WHERE log_id=?').get(logId)
        ?.count,
      1,
    );
    db.prepare('UPDATE activity_logs SET deleted_at=NULL WHERE id=?').run(logId);
    assert.equal(
      db
        .prepare(
          "SELECT SUM(value) total FROM activity_logs WHERE category='water' AND deleted_at IS NULL",
        )
        .get()?.total,
      1000,
    );
    db.prepare('DELETE FROM activity_presets WHERE id=?').run(presetId);
    assert.equal(
      db.prepare('SELECT COUNT(*) count FROM activity_presets WHERE id=?').get(presetId)?.count,
      0,
    );
  } finally {
    db.close();
  }
});
