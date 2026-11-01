export const goalsRoutinesMigrationV6 = `
  CREATE TABLE IF NOT EXISTS goals (
    id TEXT PRIMARY KEY NOT NULL DEFAULT (
      lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
      substr(lower(hex(randomblob(2))), 2) || '-a' ||
      substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))
    ),
    title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 2 AND 80),
    description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 500),
    category TEXT NOT NULL CHECK (category IN ('health','learning','fitness','work','finance','personal','other')),
    period_type TEXT NOT NULL CHECK (period_type IN ('daily','weekly','monthly','yearly','custom')),
    model TEXT NOT NULL CHECK (model IN ('cumulative','recurring')),
    recurrence TEXT CHECK (recurrence IS NULL OR recurrence IN ('daily','weekly','monthly','yearly')),
    measurement TEXT NOT NULL CHECK (measurement IN ('volume','duration','distance','count','pages','quantity','days')),
    target_value REAL NOT NULL CHECK (target_value > 0),
    unit TEXT NOT NULL CHECK (length(trim(unit)) BETWEEN 1 AND 24),
    canonical_unit TEXT NOT NULL CHECK (length(trim(canonical_unit)) BETWEEN 1 AND 32),
    start_date TEXT NOT NULL CHECK (length(start_date) = 10),
    end_date TEXT NOT NULL CHECK (length(end_date) = 10 AND end_date >= start_date),
    weekday_mask INTEGER NOT NULL DEFAULT 127 CHECK (weekday_mask BETWEEN 1 AND 127),
    timezone TEXT NOT NULL CHECK (length(timezone) BETWEEN 1 AND 64),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','archived')),
    deleted_at TEXT,
    deleted_previous_status TEXT CHECK (deleted_previous_status IS NULL OR deleted_previous_status IN ('active','paused','archived')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK ((model='cumulative' AND recurrence IS NULL) OR (model='recurring' AND recurrence IS NOT NULL)),
    CHECK ((deleted_at IS NULL AND deleted_previous_status IS NULL) OR (deleted_at IS NOT NULL AND deleted_previous_status IS NOT NULL))
  );
  CREATE INDEX IF NOT EXISTS goals_active_period_idx ON goals(status,start_date,end_date) WHERE deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS goals_end_date_idx ON goals(end_date,title) WHERE deleted_at IS NULL;

  CREATE TABLE IF NOT EXISTS goal_habits (
    goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE RESTRICT,
    habit_id TEXT NOT NULL REFERENCES habits(id) ON DELETE RESTRICT,
    created_at TEXT NOT NULL,
    PRIMARY KEY(goal_id,habit_id)
  );
  CREATE INDEX IF NOT EXISTS goal_habits_habit_idx ON goal_habits(habit_id,goal_id);

  CREATE TABLE IF NOT EXISTS goal_versions (
    id TEXT PRIMARY KEY NOT NULL,
    goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    effective_from TEXT NOT NULL,
    snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
    created_at TEXT NOT NULL,
    UNIQUE(goal_id,effective_from)
  );
  CREATE INDEX IF NOT EXISTS goal_versions_effective_idx ON goal_versions(goal_id,effective_from DESC);

  CREATE TABLE IF NOT EXISTS goal_pauses (
    id TEXT PRIMARY KEY NOT NULL,
    goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    started_on TEXT NOT NULL,
    resumed_on TEXT,
    created_at TEXT NOT NULL,
    CHECK (resumed_on IS NULL OR resumed_on >= started_on)
  );
  CREATE INDEX IF NOT EXISTS goal_pauses_range_idx ON goal_pauses(goal_id,started_on,resumed_on);

  CREATE TABLE IF NOT EXISTS goal_events (
    id TEXT PRIMARY KEY NOT NULL,
    goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL CHECK (event_type IN ('created','edited','paused','resumed','archived','deleted','restored','achieved','ended')),
    details_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(details_json)),
    occurred_at TEXT NOT NULL,
    local_date TEXT NOT NULL,
    timezone TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS goal_events_history_idx ON goal_events(goal_id,occurred_at DESC,id DESC);

  CREATE TABLE IF NOT EXISTS goal_milestones (
    id TEXT PRIMARY KEY NOT NULL,
    goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 2 AND 80),
    target_value REAL NOT NULL CHECK (target_value > 0),
    due_date TEXT,
    completed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS goal_milestones_goal_idx ON goal_milestones(goal_id,target_value);

  CREATE TABLE IF NOT EXISTS routines (
    id TEXT PRIMARY KEY NOT NULL DEFAULT (
      lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
      substr(lower(hex(randomblob(2))), 2) || '-a' ||
      substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))
    ),
    name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 80),
    description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 500),
    icon TEXT NOT NULL DEFAULT 'sparkles',
    color TEXT NOT NULL DEFAULT 'indigo',
    start_time TEXT,
    window_start TEXT,
    window_end TEXT,
    weekday_mask INTEGER NOT NULL DEFAULT 127 CHECK (weekday_mask BETWEEN 1 AND 127),
    estimated_minutes INTEGER CHECK (estimated_minutes IS NULL OR estimated_minutes BETWEEN 1 AND 1440),
    timezone TEXT NOT NULL CHECK (length(timezone) BETWEEN 1 AND 64),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
    deleted_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (start_time IS NULL OR (start_time GLOB '[0-2][0-9]:[0-5][0-9]' AND start_time < '24:00')),
    CHECK ((window_start IS NULL AND window_end IS NULL) OR (window_start IS NOT NULL AND window_end IS NOT NULL AND window_end > window_start))
  );
  CREATE INDEX IF NOT EXISTS routines_schedule_idx ON routines(weekday_mask,start_time,name) WHERE status='active' AND deleted_at IS NULL;

  CREATE TABLE IF NOT EXISTS routine_steps (
    id TEXT PRIMARY KEY NOT NULL,
    routine_id TEXT NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
    order_index INTEGER NOT NULL CHECK (order_index >= 0),
    title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 2 AND 80),
    kind TEXT NOT NULL CHECK (kind IN ('checklist','habit','task','timer','quick_measurement')),
    habit_id TEXT REFERENCES habits(id) ON DELETE RESTRICT,
    task_id TEXT REFERENCES tasks(id) ON DELETE RESTRICT,
    target_seconds INTEGER CHECK (target_seconds IS NULL OR target_seconds BETWEEN 1 AND 86400),
    measurement TEXT CHECK (measurement IS NULL OR length(measurement) BETWEEN 1 AND 24),
    value REAL CHECK (value IS NULL OR value > 0),
    unit TEXT,
    category TEXT NOT NULL DEFAULT 'other',
    preset_id TEXT,
    note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 280),
    skippable INTEGER NOT NULL DEFAULT 1 CHECK (skippable IN (0,1)),
    created_at TEXT NOT NULL,
    UNIQUE(routine_id,order_index),
    CHECK ((kind='habit' AND habit_id IS NOT NULL AND task_id IS NULL) OR
      (kind='task' AND task_id IS NOT NULL AND habit_id IS NULL) OR
      (kind IN ('checklist','timer') AND habit_id IS NULL AND task_id IS NULL) OR
      (kind='quick_measurement' AND task_id IS NULL))
  );
  CREATE INDEX IF NOT EXISTS routine_steps_order_idx ON routine_steps(routine_id,order_index);

  CREATE TABLE IF NOT EXISTS routine_runs (
    id TEXT PRIMARY KEY NOT NULL,
    routine_id TEXT NOT NULL REFERENCES routines(id) ON DELETE RESTRICT,
    status TEXT NOT NULL CHECK (status IN ('active','paused','completed','abandoned')),
    started_at TEXT NOT NULL,
    finished_at TEXT,
    local_date TEXT NOT NULL,
    timezone TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 500),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS routine_run_one_active_idx ON routine_runs(routine_id) WHERE status IN ('active','paused');
  CREATE INDEX IF NOT EXISTS routine_runs_history_idx ON routine_runs(routine_id,started_at DESC,id DESC);
  CREATE INDEX IF NOT EXISTS routine_runs_day_idx ON routine_runs(local_date,status);

  CREATE TABLE IF NOT EXISTS routine_run_steps (
    id TEXT PRIMARY KEY NOT NULL,
    run_id TEXT NOT NULL REFERENCES routine_runs(id) ON DELETE CASCADE,
    template_step_id TEXT REFERENCES routine_steps(id) ON DELETE SET NULL,
    order_index INTEGER NOT NULL CHECK (order_index >= 0),
    title TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('checklist','habit','task','timer','quick_measurement')),
    habit_id TEXT,
    task_id TEXT,
    target_seconds INTEGER,
    measurement TEXT,
    value REAL,
    unit TEXT,
    category TEXT NOT NULL,
    preset_id TEXT,
    note TEXT NOT NULL,
    skippable INTEGER NOT NULL CHECK (skippable IN (0,1)),
    snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','completed','skipped')),
    started_at TEXT,
    completed_at TEXT,
    linked_activity_id TEXT REFERENCES activity_logs(id) ON DELETE SET NULL,
    linked_session_id TEXT REFERENCES focus_sessions(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    UNIQUE(run_id,order_index)
  );
  CREATE INDEX IF NOT EXISTS routine_run_steps_order_idx ON routine_run_steps(run_id,order_index);

  ALTER TABLE activity_logs ADD COLUMN goal_id TEXT REFERENCES goals(id) ON DELETE SET NULL;
  CREATE INDEX IF NOT EXISTS activity_logs_goal_idx ON activity_logs(goal_id,local_date,occurred_at) WHERE goal_id IS NOT NULL AND deleted_at IS NULL;
  ALTER TABLE focus_sessions ADD COLUMN routine_run_id TEXT REFERENCES routine_runs(id) ON DELETE SET NULL;
  ALTER TABLE focus_sessions ADD COLUMN routine_step_run_id TEXT REFERENCES routine_run_steps(id) ON DELETE SET NULL;
`;
