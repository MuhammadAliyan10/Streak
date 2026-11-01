export const habitMigrationV2 = `
  CREATE TABLE IF NOT EXISTS habits (
    id TEXT PRIMARY KEY NOT NULL DEFAULT (
      lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
      substr(lower(hex(randomblob(2))), 2) || '-a' ||
      substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))
    ),
    name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 80),
    kind TEXT NOT NULL CHECK (kind IN ('good', 'bad')),
    description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 500),
    icon TEXT NOT NULL CHECK (icon IN ('book', 'fitness', 'water', 'phone', 'money', 'sparkles')),
    color TEXT NOT NULL CHECK (color IN ('indigo', 'emerald', 'amber', 'rose', 'sky', 'violet')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    archived_at TEXT
  );

  CREATE TABLE IF NOT EXISTS habit_schedules (
    id TEXT PRIMARY KEY NOT NULL DEFAULT (
      lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
      substr(lower(hex(randomblob(2))), 2) || '-a' ||
      substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))
    ),
    habit_id TEXT NOT NULL REFERENCES habits(id) ON DELETE RESTRICT,
    mode TEXT NOT NULL CHECK (mode IN ('anytime', 'fixed', 'flexible')),
    weekday_mask INTEGER NOT NULL CHECK (weekday_mask BETWEEN 1 AND 127),
    timezone TEXT NOT NULL CHECK (length(timezone) BETWEEN 1 AND 64),
    effective_from TEXT NOT NULL,
    effective_to TEXT,
    fixed_time TEXT,
    window_start TEXT,
    window_end TEXT,
    created_at TEXT NOT NULL,
    CHECK (effective_to IS NULL OR effective_to >= effective_from),
    CHECK (
      (mode = 'anytime' AND fixed_time IS NULL AND window_start IS NULL AND window_end IS NULL) OR
      (mode = 'fixed' AND fixed_time IS NOT NULL AND window_start IS NULL AND window_end IS NULL) OR
      (mode = 'flexible' AND fixed_time IS NULL AND window_start IS NOT NULL AND window_end IS NOT NULL AND window_end > window_start)
    )
  );

  CREATE TABLE IF NOT EXISTS habit_targets (
    id TEXT PRIMARY KEY NOT NULL DEFAULT (
      lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
      substr(lower(hex(randomblob(2))), 2) || '-a' ||
      substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))
    ),
    habit_id TEXT NOT NULL REFERENCES habits(id) ON DELETE RESTRICT,
    measurement TEXT NOT NULL CHECK (measurement IN ('check_off', 'duration', 'count', 'quantity', 'distance', 'avoidance')),
    target_value REAL NOT NULL CHECK (target_value > 0),
    unit TEXT NOT NULL CHECK (length(trim(unit)) BETWEEN 1 AND 24),
    effective_from TEXT NOT NULL,
    effective_to TEXT,
    created_at TEXT NOT NULL,
    CHECK (effective_to IS NULL OR effective_to >= effective_from)
  );

  CREATE TABLE IF NOT EXISTS habit_entries (
    id TEXT PRIMARY KEY NOT NULL DEFAULT (
      lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
      substr(lower(hex(randomblob(2))), 2) || '-a' ||
      substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))
    ),
    idempotency_key TEXT NOT NULL UNIQUE,
    habit_id TEXT NOT NULL REFERENCES habits(id) ON DELETE RESTRICT,
    schedule_id TEXT NOT NULL REFERENCES habit_schedules(id) ON DELETE RESTRICT,
    target_id TEXT NOT NULL REFERENCES habit_targets(id) ON DELETE RESTRICT,
    kind TEXT NOT NULL CHECK (kind IN ('progress', 'complete_override', 'occurrence', 'clean', 'skip')),
    value REAL,
    unit TEXT,
    note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 280),
    occurred_at TEXT NOT NULL,
    local_date TEXT NOT NULL,
    timezone TEXT NOT NULL CHECK (length(timezone) BETWEEN 1 AND 64),
    created_at TEXT NOT NULL,
    CHECK ((kind = 'progress' AND value > 0 AND unit IS NOT NULL) OR (kind != 'progress' AND value IS NULL))
  );

  CREATE TABLE IF NOT EXISTS habit_pauses (
    id TEXT PRIMARY KEY NOT NULL DEFAULT (
      lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
      substr(lower(hex(randomblob(2))), 2) || '-a' ||
      substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))
    ),
    habit_id TEXT NOT NULL REFERENCES habits(id) ON DELETE RESTRICT,
    started_on TEXT NOT NULL,
    resumed_on TEXT,
    created_at TEXT NOT NULL,
    CHECK (resumed_on IS NULL OR resumed_on >= started_on)
  );

  CREATE TABLE IF NOT EXISTS habit_history (
    id TEXT PRIMARY KEY NOT NULL DEFAULT (
      lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
      substr(lower(hex(randomblob(2))), 2) || '-a' ||
      substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))
    ),
    habit_id TEXT NOT NULL REFERENCES habits(id) ON DELETE RESTRICT,
    event_type TEXT NOT NULL CHECK (event_type IN ('created', 'edited', 'paused', 'resumed', 'archived', 'restored', 'entry_recorded')),
    details_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(details_json)),
    occurred_at TEXT NOT NULL,
    local_date TEXT NOT NULL,
    timezone TEXT NOT NULL CHECK (length(timezone) BETWEEN 1 AND 64)
  );

  CREATE INDEX IF NOT EXISTS habit_schedules_effective_idx ON habit_schedules (habit_id, effective_from, effective_to);
  CREATE INDEX IF NOT EXISTS habit_targets_effective_idx ON habit_targets (habit_id, effective_from, effective_to);
  CREATE INDEX IF NOT EXISTS habit_entries_day_idx ON habit_entries (habit_id, local_date, kind);
  CREATE INDEX IF NOT EXISTS habit_entries_history_idx ON habit_entries (habit_id, occurred_at DESC, id DESC);
  CREATE UNIQUE INDEX IF NOT EXISTS habit_entries_daily_outcome_idx
    ON habit_entries (habit_id, local_date, kind)
    WHERE kind IN ('complete_override', 'clean', 'skip');
  CREATE INDEX IF NOT EXISTS habit_pauses_period_idx ON habit_pauses (habit_id, started_on, resumed_on);
  CREATE INDEX IF NOT EXISTS habit_history_list_idx ON habit_history (habit_id, occurred_at DESC, id DESC);
`;
