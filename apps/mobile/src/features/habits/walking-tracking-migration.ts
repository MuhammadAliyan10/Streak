export const walkingTrackingMigrationV8 = `
  CREATE TABLE IF NOT EXISTS walking_tracking_preferences (
    habit_id TEXT PRIMARY KEY NOT NULL REFERENCES habits(id) ON DELETE RESTRICT,
    mode TEXT NOT NULL CHECK (mode IN ('manual','automatic')) DEFAULT 'manual',
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS walking_device_snapshots (
    habit_id TEXT NOT NULL REFERENCES habits(id) ON DELETE RESTRICT,
    local_date TEXT NOT NULL,
    provider TEXT NOT NULL CHECK (provider IN ('ios_healthkit','android_health_connect')),
    measurement TEXT NOT NULL CHECK (measurement = 'distance'),
    value REAL NOT NULL CHECK (value >= 0),
    unit TEXT NOT NULL CHECK (unit = 'meters'),
    range_start TEXT NOT NULL,
    range_end TEXT NOT NULL,
    refreshed_at TEXT NOT NULL,
    PRIMARY KEY (habit_id, local_date, measurement)
  );
  CREATE INDEX IF NOT EXISTS walking_device_snapshots_day_idx
    ON walking_device_snapshots(local_date,habit_id);
`;
