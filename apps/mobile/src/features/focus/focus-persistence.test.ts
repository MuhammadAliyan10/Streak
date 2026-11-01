import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { activityMigrationV4 } from '../habits/activity-migration.ts';
import { habitMigrationV2 } from '../habits/habit-migration.ts';
import { plannerMigrationV3 } from '../planner/planner-migration.ts';
import { focusMigrationV5 } from './focus-migration.ts';

function migratedDatabase() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(habitMigrationV2);
  db.exec(plannerMigrationV3);
  db.exec(activityMigrationV4);
  db.exec(focusMigrationV5);
  return db;
}

test('focus migration preserves existing activity and supports pause/restart session restoration', () => {
  const db = migratedDatabase();
  try {
    const now = '2026-11-01T10:00:00.000Z';
    db.prepare(
      `INSERT INTO focus_sessions(id,title,mode,started_at,running_since,active_ms,status,timezone,created_at,updated_at)
      VALUES('focus-1','Study','stopwatch',?,NULL,900000,'paused','UTC',?,?)`,
    ).run(now, now, now);
    db.prepare(
      'INSERT INTO focus_session_intervals(id,session_id,started_at,ended_at,duration_ms,created_at) VALUES(?,?,?,?,?,?)',
    ).run('interval-1', 'focus-1', now, '2026-11-01T10:15:00.000Z', 900000, now);
    const restored = db
      .prepare('SELECT status,active_ms FROM focus_sessions WHERE id=?')
      .get('focus-1') as { status: string; active_ms: number };
    assert.equal(restored.status, 'paused');
    assert.equal(restored.active_ms, 900000);
    assert.equal(
      db
        .prepare('SELECT COUNT(*) count FROM focus_session_intervals WHERE session_id=?')
        .get('focus-1')?.count,
      1,
    );
  } finally {
    db.close();
  }
});

test('only one unfinished session is allowed and failed writes leave existing state intact', () => {
  const db = migratedDatabase();
  try {
    const now = '2026-11-01T10:00:00.000Z';
    const insert =
      db.prepare(`INSERT INTO focus_sessions(id,title,mode,started_at,running_since,active_ms,status,timezone,created_at,updated_at)
      VALUES(?,?,'stopwatch',?,?,0,?,'UTC',?,?)`);
    insert.run('focus-a', 'Study', now, now, 'running', now, now);
    assert.throws(() => insert.run('focus-b', 'Read', now, now, 'paused', now, now));
    assert.throws(() =>
      db.prepare("UPDATE focus_sessions SET status='invalid' WHERE id=?").run('focus-a'),
    );
    assert.equal(
      (
        db.prepare('SELECT status FROM focus_sessions WHERE id=?').get('focus-a') as {
          status: string;
        }
      ).status,
      'running',
    );
  } finally {
    db.close();
  }
});

test('stable activity idempotency keys prevent duplicate linked duration logs', () => {
  const db = migratedDatabase();
  try {
    const now = '2026-11-01T10:00:00.000Z';
    db.prepare(
      `INSERT INTO focus_sessions(id,title,mode,started_at,active_ms,status,timezone,created_at,updated_at)
      VALUES('focus-1','Read','stopwatch',?,60000,'completed','UTC',?,?)`,
    ).run(now, now, now);
    const insert =
      db.prepare(`INSERT OR IGNORE INTO activity_logs(idempotency_key,category,title,measurement,kind,value,unit,occurred_at,local_date,timezone,created_at,focus_session_id)
      VALUES(?, 'other','Read','duration','progress',60,'seconds',?,'2026-11-01','UTC',?,'focus-1')`);
    assert.equal(insert.run('focus:focus-1:r0:2026-11-01', now, now).changes, 1);
    assert.equal(insert.run('focus:focus-1:r0:2026-11-01', now, now).changes, 0);
    const logId = (
      db.prepare('SELECT id FROM activity_logs WHERE focus_session_id=?').get('focus-1') as {
        id: string;
      }
    ).id;
    db.prepare(
      'INSERT INTO focus_session_activity_logs(session_id,activity_log_id,local_date,credited_seconds,revision) VALUES(?,?,?,?,?)',
    ).run('focus-1', logId, '2026-11-01', 60, 0);
    assert.equal(
      db
        .prepare('SELECT COUNT(*) count FROM focus_session_activity_logs WHERE session_id=?')
        .get('focus-1')?.count,
      1,
    );
  } finally {
    db.close();
  }
});
