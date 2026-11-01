import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { goalsRoutinesMigrationV6 } from './goals-routines-migration.ts';
import { habitMigrationV2 } from '../habits/habit-migration.ts';
import { plannerMigrationV3 } from '../planner/planner-migration.ts';
import { activityMigrationV4 } from '../habits/activity-migration.ts';
import { focusMigrationV5 } from '../focus/focus-migration.ts';

test('Goals and Routines migration is additive, indexed, and preserves run snapshots after template edits', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA foreign_keys=ON');
    db.exec(habitMigrationV2);
    db.exec(plannerMigrationV3);
    db.exec(activityMigrationV4);
    db.exec(focusMigrationV5);
    db.exec(goalsRoutinesMigrationV6);
    const columns = db.prepare('PRAGMA table_info(activity_logs)').all() as Array<{ name: string }>;
    assert.ok(columns.some((column) => column.name === 'goal_id'));
    const focusColumns = db.prepare('PRAGMA table_info(focus_sessions)').all() as Array<{
      name: string;
    }>;
    assert.ok(focusColumns.some((column) => column.name === 'routine_run_id'));
    assert.ok(focusColumns.some((column) => column.name === 'routine_step_run_id'));
    const routineId = 'r1';
    const now = '2026-11-01T00:00:00.000Z';
    db.prepare(
      "INSERT INTO goals(id,title,category,period_type,model,measurement,target_value,unit,canonical_unit,start_date,end_date,timezone,status,created_at,updated_at) VALUES('g1','Read 100 pages','learning','custom','cumulative','pages',100,'page','pages','2026-11-01','2026-12-01','Asia/Karachi','active',?,?)",
    ).run(now, now);
    db.prepare(
      "INSERT INTO activity_logs(id,idempotency_key,category,title,measurement,kind,value,unit,occurred_at,local_date,timezone,created_at,goal_id) VALUES('a1','goal-activity-1','learning','Reading','pages','progress',10,'pages',?,'2026-11-01','Asia/Karachi',?,'g1')",
    ).run(now, now);
    assert.equal(
      db.prepare('SELECT goal_id FROM activity_logs WHERE id=?').get('a1')?.goal_id,
      'g1',
    );
    db.prepare(
      'INSERT INTO routines(id,name,timezone,created_at,updated_at) VALUES(?,?,?, ?,?)',
    ).run(routineId, 'Morning', 'Asia/Karachi', now, now);
    db.prepare(
      "INSERT INTO habits(id,name,kind,icon,color,created_at,updated_at) VALUES('h1','Drink water','good','water','sky',?,?)",
    ).run(now, now);
    db.prepare(
      "INSERT INTO routine_steps(id,routine_id,order_index,title,kind,category,note,skippable,created_at) VALUES('s1',?,0,'Read','checklist','other','',1,?)",
    ).run(routineId, now);
    db.prepare(
      "INSERT INTO routine_steps(id,routine_id,order_index,title,kind,habit_id,measurement,value,unit,category,note,skippable,created_at) VALUES('s2',?,1,'Water','quick_measurement','h1','volume',250,'mL','habit','',1,?)",
    ).run(routineId, now);
    db.prepare(
      "INSERT INTO routine_runs(id,routine_id,status,started_at,local_date,timezone,created_at,updated_at) VALUES('run1',?,'active',?,'2026-11-01','Asia/Karachi',?,?)",
    ).run(routineId, now, now, now);
    db.prepare(
      "INSERT INTO routine_run_steps(id,run_id,template_step_id,order_index,title,kind,category,note,skippable,snapshot_json,created_at) VALUES('rs1','run1','s1',0,'Read','checklist','other','',1,'{\"title\":\"Read\"}',?)",
    ).run(now);
    db.prepare(
      "INSERT INTO focus_sessions(id,title,mode,started_at,status,timezone,created_at,updated_at,routine_run_id,routine_step_run_id) VALUES('focus1','Focus','countdown',?,'completed','Asia/Karachi',?,?, 'run1','rs1')",
    ).run(now, now, now);
    assert.equal(
      db.prepare('SELECT routine_run_id FROM focus_sessions WHERE id=?').get('focus1')
        ?.routine_run_id,
      'run1',
    );
    db.prepare("DELETE FROM routine_steps WHERE id='s1'").run();
    const snapshot = db
      .prepare("SELECT template_step_id,title,snapshot_json FROM routine_run_steps WHERE id='rs1'")
      .get() as { template_step_id: string | null; title: string; snapshot_json: string };
    assert.deepEqual(
      { ...snapshot },
      {
        template_step_id: null,
        title: 'Read',
        snapshot_json: '{"title":"Read"}',
      },
    );
    assert.throws(() =>
      db
        .prepare(
          "INSERT INTO goals(id,title,category,period_type,model,measurement,target_value,unit,canonical_unit,start_date,end_date,timezone,status,created_at,updated_at) VALUES('bad','X','other','custom','cumulative','count',0,'count','count','2026-11-01','2026-11-01','UTC','active',?,?)",
        )
        .run(now, now),
    );
  } finally {
    db.close();
  }
});
