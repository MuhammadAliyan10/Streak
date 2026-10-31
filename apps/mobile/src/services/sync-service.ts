import {
  acknowledgeOperations,
  cacheRemoteOperations,
  enqueueLocalOperation,
  getSyncCursor,
  getPendingOperations,
} from './local-database';
import type * as SQLite from 'expo-sqlite';
import { downloadOperations, uploadOperations } from '../features/owner/owner-service';

export type SyncSummary = { uploaded: number; downloaded: number };
let activeSync: Promise<SyncSummary> | null = null;

export function syncLocalData(database: SQLite.SQLiteDatabase): Promise<SyncSummary> {
  if (activeSync) return activeSync;
  activeSync = runSync(database).finally(() => {
    activeSync = null;
  });
  return activeSync;
}

async function runSync(database: SQLite.SQLiteDatabase): Promise<SyncSummary> {
  let uploaded = 0;
  for (;;) {
    const pending = await getPendingOperations(database);
    if (pending.length === 0) break;
    const accepted = await uploadOperations(pending);
    await acknowledgeOperations(database, accepted);
    if (accepted.length === 0) break;
    uploaded += accepted.length;
  }

  let cursor = await getSyncCursor(database);
  let downloaded = 0;
  for (;;) {
    const page = await downloadOperations(cursor);
    await cacheRemoteOperations(database, page.operations, page.cursor);
    downloaded += page.operations.length;
    if (!page.hasMore || !page.cursor) break;
    cursor = page.cursor;
  }
  return { uploaded, downloaded };
}

export async function queueOfflineRecord(
  database: SQLite.SQLiteDatabase,
  entity: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await enqueueLocalOperation(database, entity, payload);
}
