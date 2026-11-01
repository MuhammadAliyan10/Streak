import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { habitMigrationV2 } from './habit-migration.ts';

function database(path = ':memory:'): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(habitMigrationV2);
  return db;
}

function seed(db: DatabaseSync): { habitId: string; scheduleId: string; targetId: string } {
  const habit = db
    .prepare(
      'INSERT INTO habits (name,kind,icon,color,created_at,updated_at) VALUES (?,?,?,?,?,?) RETURNING id',
    )
    .get(
      'Read daily',
      'good',
      'book',
      'indigo',
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
    ) as { id: string };
  const schedule = db
    .prepare(
      'INSERT INTO habit_schedules (habit_id,mode,weekday_mask,timezone,effective_from,created_at) VALUES (?,?,?,?,?,?) RETURNING id',
    )
    .get(habit.id, 'anytime', 127, 'Asia/Karachi', '2026-01-01', '2026-01-01T00:00:00.000Z') as {
    id: string;
  };
  const target = db
    .prepare(
      'INSERT INTO habit_targets (habit_id,measurement,target_value,unit,effective_from,created_at) VALUES (?,?,?,?,?,?) RETURNING id',
    )
    .get(habit.id, 'duration', 30, 'minutes', '2026-01-01', '2026-01-01T00:00:00.000Z') as {
    id: string;
  };
  return { habitId: habit.id, scheduleId: schedule.id, targetId: target.id };
}

test('habit migration is repeatable and creates strong IDs and indexes', () => {
  const db = database();
  try {
    db.exec(habitMigrationV2);
    const { habitId } = seed(db);
    assert.match(habitId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'habit_%'")
      .all();
    assert.ok(indexes.length >= 7);
  } finally {
    db.close();
  }
});

test('entries are foreign-key checked and duplicate idempotency keys do not duplicate writes', () => {
  const db = database();
  try {
    const { habitId, scheduleId, targetId } = seed(db);
    const insert = db.prepare(
      "INSERT OR IGNORE INTO habit_entries (idempotency_key,habit_id,schedule_id,target_id,kind,value,unit,occurred_at,local_date,timezone,created_at) VALUES (?,?,?,?, 'progress', ?, ?, ?, ?, ?, ?)",
    );
    const values = [
      'operation-1',
      habitId,
      scheduleId,
      targetId,
      15,
      'minutes',
      '2026-01-01T08:00:00Z',
      '2026-01-01',
      'Asia/Karachi',
      '2026-01-01T08:00:00Z',
    ] as const;
    assert.equal(insert.run(...values).changes, 1);
    assert.equal(insert.run(...values).changes, 0);
    assert.equal(
      db.prepare('SELECT COUNT(*) count FROM habit_entries WHERE habit_id=?').get(habitId)?.count,
      1,
    );
    assert.throws(() =>
      db
        .prepare(
          "INSERT INTO habit_entries (idempotency_key,habit_id,schedule_id,target_id,kind,occurred_at,local_date,timezone,created_at) VALUES ('bad-fk','missing','missing','missing','clean','2026-01-01T08:00:00Z','2026-01-01','Asia/Karachi','2026-01-01T08:00:00Z')",
        )
        .run(),
    );
  } finally {
    db.close();
  }
});

test('daily outcomes are unique while separate occurrences on one day remain countable', () => {
  const db = database();
  try {
    const { habitId, scheduleId, targetId } = seed(db);
    const outcome = db.prepare(
      "INSERT OR IGNORE INTO habit_entries (idempotency_key,habit_id,schedule_id,target_id,kind,occurred_at,local_date,timezone,created_at) VALUES (?,?,?,?,?,'2026-01-01T08:00:00Z','2026-01-01','Asia/Karachi','2026-01-01T08:00:00Z')",
    );
    assert.equal(outcome.run('clean-1', habitId, scheduleId, targetId, 'clean').changes, 1);
    assert.equal(outcome.run('clean-2', habitId, scheduleId, targetId, 'clean').changes, 0);
    assert.equal(
      outcome.run('occurrence-1', habitId, scheduleId, targetId, 'occurrence').changes,
      1,
    );
    assert.equal(
      outcome.run('occurrence-2', habitId, scheduleId, targetId, 'occurrence').changes,
      1,
    );
    assert.equal(
      db
        .prepare("SELECT COUNT(*) count FROM habit_entries WHERE habit_id=? AND kind='occurrence'")
        .get(habitId)?.count,
      2,
    );
  } finally {
    db.close();
  }
});

test('a rolled-back multi-record write leaves no partial habit behind', () => {
  const db = database();
  try {
    db.exec('BEGIN');
    try {
      seed(db);
      throw new Error('simulate failed entry enqueue');
    } catch (error) {
      db.exec('ROLLBACK');
      assert.match(String(error), /simulate failed/);
    }
    assert.equal(db.prepare('SELECT COUNT(*) count FROM habits').get()?.count, 0);
  } finally {
    db.close();
  }
});

test('SQLite data persists when the database is reopened', () => {
  const directory = mkdtempSync(join(tmpdir(), 'streak-habit-'));
  const file = join(directory, 'habits.db');
  try {
    const first = database(file);
    const { habitId } = seed(first);
    first.close();
    const reopened = new DatabaseSync(file);
    try {
      assert.equal(
        reopened.prepare('SELECT name FROM habits WHERE id=?').get(habitId)?.name,
        'Read daily',
      );
    } finally {
      reopened.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
