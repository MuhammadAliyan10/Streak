import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { digitalUsageMigrationV9 } from './digital-usage-migration.ts';
import {
  digitalTrackingCapability,
  digitalUsageOutcome,
  digitalUsageStatus,
  effectiveDigitalUsage,
} from './digital-usage-domain.ts';
import { habitMigrationV2 } from './habit-migration.ts';
import { activityMigrationV4 } from './activity-migration.ts';

test('partial, confirmed, unknown, and over-limit states stay distinct at the boundary', () => {
  assert.equal(digitalUsageStatus({ observed: null, limit: 1800, confirmed: false }), 'unknown');
  assert.equal(
    digitalUsageStatus({ observed: 1200, limit: 1800, confirmed: false }),
    'below_so_far',
  );
  assert.equal(
    digitalUsageStatus({ observed: 1800, limit: 1800, confirmed: true }),
    'within_limit',
  );
  assert.equal(digitalUsageStatus({ observed: 1801, limit: 1800, confirmed: true }), 'over_limit');
  assert.deepEqual(digitalUsageOutcome(2700, 1800), {
    status: 'over_limit',
    remaining: 0,
    excess: 900,
  });
});

test('a confirmed total replaces increments and a zero total is valid', () => {
  assert.equal(effectiveDigitalUsage({ dailyTotal: null, increments: [] }), null);
  assert.equal(effectiveDigitalUsage({ dailyTotal: null, increments: [300, 900] }), 1200);
  assert.equal(effectiveDigitalUsage({ dailyTotal: 600, increments: [300, 900] }), 600);
  assert.equal(effectiveDigitalUsage({ dailyTotal: 0, increments: [300] }), 0);
});

test('automatic tracking remains unavailable on Android and iOS until native access is verified', () => {
  for (const platform of ['android', 'ios']) {
    const capability = digitalTrackingCapability(platform);
    assert.equal(capability.manual, true);
    assert.equal(capability.automatic, false);
    assert.ok(capability.reason.length > 0);
  }
  assert.equal(digitalTrackingCapability('web').automatic, false);
});

test('daily usage migration is additive and daily totals replace on the unique day key', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA foreign_keys = ON');
    db.exec(habitMigrationV2);
    db.exec(activityMigrationV4);
    db.exec(digitalUsageMigrationV9);
    const habitId = (
      db
        .prepare(
          "INSERT INTO habits(name,kind,icon,color,created_at,updated_at) VALUES ('Instagram','bad','phone','rose','now','now') RETURNING id",
        )
        .get() as { id: string }
    ).id;
    db.prepare(
      "INSERT INTO habit_targets(habit_id,measurement,target_value,unit,effective_from,created_at) VALUES (?,'duration',30,'min','2026-11-01','now')",
    ).run(habitId);
    const save = db.prepare(`INSERT INTO digital_usage_daily_totals
      (habit_id,local_date,measurement,value,unit,input_value,input_unit,source,timezone,recorded_at)
      VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(habit_id,local_date,measurement) DO UPDATE SET
      value=excluded.value,input_value=excluded.input_value,recorded_at=excluded.recorded_at`);
    assert.equal(
      save.run(
        habitId,
        '2026-11-01',
        'duration',
        900,
        'seconds',
        15,
        'min',
        'manual',
        'Asia/Karachi',
        'one',
      ).changes,
      1,
    );
    assert.equal(
      save.run(
        habitId,
        '2026-11-01',
        'duration',
        1200,
        'seconds',
        20,
        'min',
        'manual',
        'Asia/Karachi',
        'two',
      ).changes,
      1,
    );
    assert.equal(
      save.run(
        habitId,
        '2026-11-02',
        'count',
        0,
        'count',
        0,
        'count',
        'manual',
        'Asia/Karachi',
        'three',
      ).changes,
      1,
    );
    const totals = (
      db
        .prepare(
          'SELECT local_date,measurement,value FROM digital_usage_daily_totals ORDER BY local_date',
        )
        .all() as Array<{ local_date: string; measurement: string; value: number }>
    ).map((row) => ({ ...row }));
    assert.deepEqual(totals, [
      { local_date: '2026-11-01', measurement: 'duration', value: 1200 },
      { local_date: '2026-11-02', measurement: 'count', value: 0 },
    ]);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM activity_logs').get()?.count, 0);
  } finally {
    db.close();
  }
});
