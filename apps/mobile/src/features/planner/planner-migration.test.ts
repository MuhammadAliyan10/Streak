import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { plannerMigrationV3 } from './planner-migration.ts';
import { dailyReviewMigrationV10 } from './daily-review-migration.ts';

test('planner migration is additive, repeatable, and supports recoverable tasks and reviews', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA foreign_keys = ON');
    db.exec(plannerMigrationV3);
    db.exec(plannerMigrationV3);
    const task = db
      .prepare(
        'INSERT INTO tasks (title,priority,planned_date,timezone,created_at,updated_at) VALUES (?,?,?,?,?,?) RETURNING id',
      )
      .get(
        'Read a chapter',
        'normal',
        '2026-11-01',
        'Asia/Karachi',
        '2026-11-01T10:00:00Z',
        '2026-11-01T10:00:00Z',
      ) as { id: string };
    const insertHistory = db.prepare(
      'INSERT OR IGNORE INTO task_history (task_id,idempotency_key,event_type,details_json,occurred_at,local_date,timezone) VALUES (?,?,?,?,?,?,?)',
    );
    const history = [
      task.id,
      'task-create-1',
      'created',
      '{}',
      '2026-11-01T10:00:00Z',
      '2026-11-01',
      'Asia/Karachi',
    ] as const;
    assert.equal(insertHistory.run(...history).changes, 1);
    assert.equal(insertHistory.run(...history).changes, 0);
    db.prepare('UPDATE tasks SET deleted_at=?,deleted_previous_status=status WHERE id=?').run(
      '2026-11-01T11:00:00Z',
      task.id,
    );
    db.prepare('UPDATE tasks SET deleted_at=NULL,deleted_previous_status=NULL WHERE id=?').run(
      task.id,
    );
    db.prepare(
      'INSERT INTO daily_reviews (local_date,timezone,note,created_at,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(local_date) DO UPDATE SET note=excluded.note',
    ).run(
      '2026-11-01',
      'Asia/Karachi',
      'A good day',
      '2026-11-01T12:00:00Z',
      '2026-11-01T12:00:00Z',
    );
    assert.equal(
      db.prepare('SELECT COUNT(*) count FROM tasks WHERE id=? AND deleted_at IS NULL').get(task.id)
        ?.count,
      1,
    );
    assert.equal(
      db.prepare('SELECT note FROM daily_reviews WHERE local_date=?').get('2026-11-01')?.note,
      'A good day',
    );
    assert.throws(() =>
      db
        .prepare(
          'INSERT INTO tasks (title,priority,planned_date,timezone,created_at,updated_at) VALUES (?,?,?,?,?,?)',
        )
        .run('No id', 'urgent', '2026-11-01', 'Asia/Karachi', 'now', 'now'),
    );
  } finally {
    db.close();
  }
});

test('daily review migration preserves a legacy note and allows optional reflection fields to be empty', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(plannerMigrationV3);
    db.prepare(
      'INSERT INTO daily_reviews(local_date,timezone,note,created_at,updated_at) VALUES(?,?,?,?,?)',
    ).run('2026-11-01', 'Asia/Karachi', 'Legacy reflection', 'now', 'now');
    db.exec(dailyReviewMigrationV10);
    const preserved = db
      .prepare(
        'SELECT note,went_well,improve,tomorrow_priority FROM daily_reviews WHERE local_date=?',
      )
      .get('2026-11-01') as {
      note: string;
      went_well: string;
      improve: string;
      tomorrow_priority: string;
    };
    assert.deepEqual(
      { ...preserved },
      {
        note: 'Legacy reflection',
        went_well: 'Legacy reflection',
        improve: '',
        tomorrow_priority: '',
      },
    );
    db.prepare(
      'INSERT INTO daily_reviews(local_date,timezone,note,went_well,improve,tomorrow_priority,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',
    ).run('2026-11-02', 'Asia/Karachi', '', '', '', '', 'now', 'now');
    assert.equal(
      (db.prepare('SELECT COUNT(*) count FROM daily_reviews').get() as { count: number }).count,
      2,
    );
  } finally {
    db.close();
  }
});

test('daily reflection edits update only the selected local date and can clear optional answers', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(plannerMigrationV3);
    db.exec(dailyReviewMigrationV10);
    const save = db.prepare(`INSERT INTO daily_reviews
      (local_date,timezone,note,went_well,improve,tomorrow_priority,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(local_date) DO UPDATE SET
      note=excluded.note,went_well=excluded.went_well,improve=excluded.improve,
      tomorrow_priority=excluded.tomorrow_priority,updated_at=excluded.updated_at`);
    save.run('2026-11-01', 'Asia/Karachi', 'One win', 'One win', 'Sleep earlier', 'Read', 'a', 'a');
    save.run('2026-11-01', 'Asia/Karachi', '', '', '', '', 'a', 'b');
    save.run('2026-11-02', 'Asia/Karachi', 'Other day', 'Other day', '', '', 'a', 'a');
    assert.equal(
      (db.prepare('SELECT COUNT(*) count FROM daily_reviews').get() as { count: number }).count,
      2,
    );
    const edit = db
      .prepare(
        'SELECT went_well,improve,tomorrow_priority,updated_at FROM daily_reviews WHERE local_date=?',
      )
      .get('2026-11-01') as Record<string, string>;
    assert.deepEqual(
      { ...edit },
      { went_well: '', improve: '', tomorrow_priority: '', updated_at: 'b' },
    );
    assert.equal(
      (
        db.prepare('SELECT note FROM daily_reviews WHERE local_date=?').get('2026-11-02') as {
          note: string;
        }
      ).note,
      'Other day',
    );
  } finally {
    db.close();
  }
});
