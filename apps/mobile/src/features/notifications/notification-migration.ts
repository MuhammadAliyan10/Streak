export const notificationMigrationV7 = `
  CREATE TABLE IF NOT EXISTS reminder_preferences (
    singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
    enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)),
    preferred_time TEXT NOT NULL DEFAULT '18:00',
    advance_minutes INTEGER NOT NULL DEFAULT 0 CHECK (advance_minutes BETWEEN 0 AND 120),
    flexible_warning_minutes INTEGER NOT NULL DEFAULT 60 CHECK (flexible_warning_minutes BETWEEN 0 AND 240),
    quiet_start TEXT NOT NULL DEFAULT '',
    quiet_end TEXT NOT NULL DEFAULT '',
    sound_enabled INTEGER NOT NULL DEFAULT 1 CHECK (sound_enabled IN (0,1)),
    updated_at TEXT NOT NULL
  );
  INSERT OR IGNORE INTO reminder_preferences(singleton_id, updated_at) VALUES (1, datetime('now'));
  CREATE TABLE IF NOT EXISTS reminder_overrides (
    entity_kind TEXT NOT NULL CHECK (entity_kind IN ('habit','task','goal','routine')),
    entity_id TEXT NOT NULL,
    enabled INTEGER NOT NULL CHECK (enabled IN (0,1)),
    PRIMARY KEY(entity_kind, entity_id)
  );
  CREATE TABLE IF NOT EXISTS scheduled_reminders (
    reminder_key TEXT PRIMARY KEY NOT NULL,
    native_id TEXT NOT NULL,
    entity_kind TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    scheduled_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS scheduled_reminders_entity_idx ON scheduled_reminders(entity_kind,entity_id);
`;
