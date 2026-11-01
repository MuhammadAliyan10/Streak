import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { notificationMigrationV7 } from './notification-migration.ts';

test('notification migration is repeatable and stores only preferences, overrides, and native IDs', () => {
  const database = new DatabaseSync(':memory:');
  database.exec(notificationMigrationV7);
  database.exec(notificationMigrationV7);
  const preferences = database
    .prepare('SELECT enabled,preferred_time FROM reminder_preferences WHERE singleton_id=1')
    .get() as { enabled: number; preferred_time: string };
  assert.equal(preferences.enabled, 0);
  assert.equal(preferences.preferred_time, '18:00');
  database
    .prepare('INSERT INTO reminder_overrides(entity_kind,entity_id,enabled) VALUES(?,?,?)')
    .run('habit', 'habit-1', 0);
  database
    .prepare(
      'INSERT INTO scheduled_reminders(reminder_key,native_id,entity_kind,entity_id,scheduled_at) VALUES(?,?,?,?,?)',
    )
    .run('habit:habit-1:2026-05-01', 'native-id', 'habit', 'habit-1', '2026-05-01T08:00:00.000Z');
  assert.equal(
    (
      database.prepare('SELECT COUNT(*) AS count FROM reminder_overrides').get() as {
        count: number;
      }
    ).count,
    1,
  );
  assert.equal(
    (
      database.prepare('SELECT COUNT(*) AS count FROM scheduled_reminders').get() as {
        count: number;
      }
    ).count,
    1,
  );
  database.close();
});
