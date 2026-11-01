export const digitalUsageMigrationV9 = `
  ALTER TABLE habit_targets ADD COLUMN target_mode TEXT NOT NULL DEFAULT 'minimum'
    CHECK (target_mode IN ('minimum','maximum'));
  ALTER TABLE habit_targets ADD COLUMN tracking_method TEXT NOT NULL DEFAULT 'manual'
    CHECK (tracking_method IN ('manual','automatic'));

  CREATE TABLE IF NOT EXISTS digital_usage_daily_totals (
    habit_id TEXT NOT NULL REFERENCES habits(id) ON DELETE RESTRICT,
    local_date TEXT NOT NULL,
    measurement TEXT NOT NULL CHECK (measurement IN ('duration','count')),
    value INTEGER NOT NULL CHECK (value >= 0),
    unit TEXT NOT NULL CHECK (unit IN ('seconds','count')),
    input_value REAL NOT NULL CHECK (input_value >= 0),
    input_unit TEXT NOT NULL CHECK (length(input_unit) BETWEEN 1 AND 24),
    source TEXT NOT NULL CHECK (source = 'manual'),
    timezone TEXT NOT NULL CHECK (length(timezone) BETWEEN 1 AND 64),
    recorded_at TEXT NOT NULL,
    PRIMARY KEY (habit_id,local_date,measurement)
  );
  CREATE INDEX IF NOT EXISTS digital_usage_totals_date_idx
    ON digital_usage_daily_totals(local_date,habit_id);
`;
