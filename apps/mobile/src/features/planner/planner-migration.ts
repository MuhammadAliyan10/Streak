export const plannerMigrationV3 = `
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY NOT NULL DEFAULT (
      lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
      substr(lower(hex(randomblob(2))), 2) || '-a' ||
      substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))
    ),
    title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 2 AND 100),
    description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 1000),
    priority TEXT NOT NULL CHECK (priority IN ('low', 'normal', 'high')),
    planned_date TEXT NOT NULL CHECK (length(planned_date) = 10),
    planned_time TEXT,
    estimated_minutes INTEGER CHECK (estimated_minutes IS NULL OR estimated_minutes BETWEEN 1 AND 1440),
    timezone TEXT NOT NULL CHECK (length(timezone) BETWEEN 1 AND 64),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'cancelled')),
    completed_at TEXT,
    completed_local_date TEXT,
    completed_timezone TEXT,
    deleted_at TEXT,
    deleted_previous_status TEXT CHECK (deleted_previous_status IS NULL OR deleted_previous_status IN ('pending', 'completed', 'cancelled')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK ((status = 'completed' AND completed_at IS NOT NULL AND completed_local_date IS NOT NULL AND completed_timezone IS NOT NULL) OR
      (status != 'completed' AND completed_at IS NULL AND completed_local_date IS NULL AND completed_timezone IS NULL)),
    CHECK ((deleted_at IS NULL AND deleted_previous_status IS NULL) OR
      (deleted_at IS NOT NULL AND deleted_previous_status IS NOT NULL)),
    CHECK (planned_time IS NULL OR (planned_time GLOB '[0-2][0-9]:[0-5][0-9]' AND planned_time < '24:00'))
  );

  CREATE TABLE IF NOT EXISTS task_history (
    id TEXT PRIMARY KEY NOT NULL DEFAULT (
      lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
      substr(lower(hex(randomblob(2))), 2) || '-a' ||
      substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))
    ),
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
    idempotency_key TEXT NOT NULL UNIQUE,
    event_type TEXT NOT NULL CHECK (event_type IN ('created', 'edited', 'completed', 'reopened', 'rescheduled', 'cancelled', 'deleted', 'restored')),
    details_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(details_json)),
    occurred_at TEXT NOT NULL,
    local_date TEXT NOT NULL,
    timezone TEXT NOT NULL CHECK (length(timezone) BETWEEN 1 AND 64)
  );

  CREATE TABLE IF NOT EXISTS daily_reviews (
    local_date TEXT PRIMARY KEY NOT NULL CHECK (length(local_date) = 10),
    timezone TEXT NOT NULL CHECK (length(timezone) BETWEEN 1 AND 64),
    note TEXT NOT NULL CHECK (length(note) <= 2000),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS tasks_planned_day_idx ON tasks (planned_date, planned_time, status) WHERE deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS tasks_completed_day_idx ON tasks (completed_local_date, completed_at) WHERE deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS task_history_day_idx ON task_history (local_date, occurred_at, id);
  CREATE INDEX IF NOT EXISTS task_history_task_idx ON task_history (task_id, occurred_at DESC, id DESC);
`;
