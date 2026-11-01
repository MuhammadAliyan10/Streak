import * as SQLite from 'expo-sqlite';
import { z } from 'zod';
import { habitMigrationV2 } from '../features/habits/habit-migration';
import { plannerMigrationV3 } from '../features/planner/planner-migration';
import { activityMigrationV4 } from '../features/habits/activity-migration';
import { focusMigrationV5 } from '../features/focus/focus-migration';
import { goalsRoutinesMigrationV6 } from '../features/goals-routines/goals-routines-migration';
import { notificationMigrationV7 } from '../features/notifications/notification-migration';
import { walkingTrackingMigrationV8 } from '../features/habits/walking-tracking-migration';
import { digitalUsageMigrationV9 } from '../features/habits/digital-usage-migration';
import { dailyReviewMigrationV10 } from '../features/planner/daily-review-migration';

const DATABASE_NAME = 'streak.db';

/** Versioned local schema. Keep each migration additive and idempotent. */
const migrations: ReadonlyArray<{ version: number; sql: string }> = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS sync_outbox (
        id TEXT PRIMARY KEY DEFAULT (
          lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
          substr(lower(hex(randomblob(2))), 2) || '-a' ||
          substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))
        ),
        entity TEXT NOT NULL CHECK (length(entity) BETWEEN 1 AND 64),
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sync_cache (
        id TEXT PRIMARY KEY,
        entity TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sync_checkpoint (
        singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
        last_seen_at TEXT,
        last_seen_id TEXT
      );
      INSERT OR IGNORE INTO sync_checkpoint (singleton_id, last_seen_at, last_seen_id) VALUES (1, NULL, NULL);
    `,
  },
  { version: 2, sql: habitMigrationV2 },
  { version: 3, sql: plannerMigrationV3 },
  { version: 4, sql: activityMigrationV4 },
  { version: 5, sql: focusMigrationV5 },
  { version: 6, sql: goalsRoutinesMigrationV6 },
  { version: 7, sql: notificationMigrationV7 },
  { version: 8, sql: walkingTrackingMigrationV8 },
  { version: 9, sql: digitalUsageMigrationV9 },
  { version: 10, sql: dailyReviewMigrationV10 },
];

export type SyncOperation = {
  id: string;
  entity: string;
  payload: Record<string, unknown>;
  createdAt: string;
};
export type SyncCursor = { receivedAt: string; id: string };
const syncPayloadSchema = z.record(z.string(), z.unknown());

export async function initializeLocalDatabase(): Promise<SQLite.SQLiteDatabase> {
  const database = await SQLite.openDatabaseAsync(DATABASE_NAME);
  await database.execAsync('PRAGMA foreign_keys = ON');
  const currentVersion = await database.getFirstAsync<{ user_version: number }>(
    'PRAGMA user_version',
  );
  let version = currentVersion?.user_version ?? 0;

  for (const migration of migrations) {
    if (migration.version <= version) continue;
    await database.withTransactionAsync(async () => {
      await database.execAsync(migration.sql);
      await database.execAsync(`PRAGMA user_version = ${migration.version}`);
    });
    version = migration.version;
  }

  return database;
}

export async function enqueueLocalOperation(
  database: SQLite.SQLiteDatabase,
  entity: string,
  payload: Record<string, unknown>,
): Promise<void> {
  if (entity.trim().length < 1 || entity.length > 64) throw new Error('Invalid sync entity.');
  const encodedPayload = JSON.stringify(payload);
  if (!encodedPayload) throw new Error('Sync payload must be JSON serializable.');
  await database.runAsync(
    'INSERT INTO sync_outbox (entity, payload, created_at) VALUES (?, ?, ?)',
    entity,
    encodedPayload,
    new Date().toISOString(),
  );
}

export async function getPendingOperations(
  database: SQLite.SQLiteDatabase,
  limit = 50,
): Promise<SyncOperation[]> {
  const rows = await database.getAllAsync<{
    id: string;
    entity: string;
    payload: string;
    created_at: string;
  }>(
    'SELECT id, entity, payload, created_at FROM sync_outbox ORDER BY created_at, id LIMIT ?',
    limit,
  );
  return rows.map((row) => ({
    id: row.id,
    entity: row.entity,
    payload: syncPayloadSchema.parse(JSON.parse(row.payload)),
    createdAt: row.created_at,
  }));
}

export async function acknowledgeOperations(
  database: SQLite.SQLiteDatabase,
  operationIds: readonly string[],
): Promise<void> {
  await database.withTransactionAsync(async () => {
    for (const id of operationIds) {
      await database.runAsync('DELETE FROM sync_outbox WHERE id = ?', id);
    }
  });
}

export async function cacheRemoteOperations(
  database: SQLite.SQLiteDatabase,
  operations: readonly SyncOperation[],
  cursor: SyncCursor | null,
): Promise<void> {
  await database.withTransactionAsync(async () => {
    for (const operation of operations) {
      await database.runAsync(
        'INSERT OR IGNORE INTO sync_cache (id, entity, payload, created_at) VALUES (?, ?, ?, ?)',
        operation.id,
        operation.entity,
        JSON.stringify(operation.payload),
        operation.createdAt,
      );
    }
    if (cursor) {
      await database.runAsync(
        'UPDATE sync_checkpoint SET last_seen_at = ?, last_seen_id = ? WHERE singleton_id = 1',
        cursor.receivedAt,
        cursor.id,
      );
    }
  });
}

export async function getSyncCursor(database: SQLite.SQLiteDatabase): Promise<SyncCursor | null> {
  const row = await database.getFirstAsync<{
    last_seen_at: string | null;
    last_seen_id: string | null;
  }>('SELECT last_seen_at, last_seen_id FROM sync_checkpoint WHERE singleton_id = 1');
  if (!row?.last_seen_at || !row.last_seen_id) return null;
  return { receivedAt: row.last_seen_at, id: row.last_seen_id };
}
