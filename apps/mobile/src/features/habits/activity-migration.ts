/** Converts existing habit entries in place conceptually: IDs and history survive, while
 * future reads and writes use this single unified activity log table. */
export const activityMigrationV4 = `
  CREATE TABLE IF NOT EXISTS activity_logs (
    id TEXT PRIMARY KEY NOT NULL DEFAULT (
      lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
      substr(lower(hex(randomblob(2))), 2) || '-a' ||
      substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))
    ),
    idempotency_key TEXT NOT NULL UNIQUE,
    habit_id TEXT REFERENCES habits(id) ON DELETE RESTRICT,
    schedule_id TEXT REFERENCES habit_schedules(id) ON DELETE RESTRICT,
    target_id TEXT REFERENCES habit_targets(id) ON DELETE RESTRICT,
    category TEXT NOT NULL CHECK (length(category) BETWEEN 1 AND 32),
    title TEXT NOT NULL DEFAULT '' CHECK (length(title) <= 80),
    measurement TEXT NOT NULL CHECK (length(measurement) BETWEEN 1 AND 24),
    kind TEXT NOT NULL CHECK (kind IN ('progress', 'complete_override', 'occurrence', 'clean', 'skip')),
    value INTEGER,
    unit TEXT,
    input_value REAL,
    input_unit TEXT,
    note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 280),
    occurred_at TEXT NOT NULL,
    local_date TEXT NOT NULL,
    timezone TEXT NOT NULL CHECK (length(timezone) BETWEEN 1 AND 64),
    created_at TEXT NOT NULL,
    preset_id TEXT,
    preset_name TEXT,
    corrected_at TEXT,
    correction_count INTEGER NOT NULL DEFAULT 0 CHECK (correction_count >= 0),
    deleted_at TEXT,
    CHECK ((habit_id IS NULL AND schedule_id IS NULL AND target_id IS NULL) OR
      (habit_id IS NOT NULL AND schedule_id IS NOT NULL AND target_id IS NOT NULL)),
    CHECK ((kind = 'progress' AND value > 0 AND unit IS NOT NULL) OR
      (kind != 'progress' AND value IS NULL))
  );

  INSERT INTO activity_logs (
    id,idempotency_key,habit_id,schedule_id,target_id,category,title,measurement,kind,
    value,unit,input_value,input_unit,note,occurred_at,local_date,timezone,created_at
  )
  SELECT e.id,e.idempotency_key,e.habit_id,e.schedule_id,e.target_id,'habit',h.name,
    CASE
      WHEN t.measurement='duration' THEN 'duration'
      WHEN t.measurement='distance' THEN 'distance'
      WHEN t.measurement='count' THEN 'count'
      WHEN t.measurement='quantity' AND lower(trim(e.unit)) IN ('page','pages') THEN 'pages'
      WHEN t.measurement='quantity' AND lower(trim(e.unit)) IN ('ml','milliliter','milliliters','millilitre','millilitres','l','liter','liters','litre','litres','oz','ounce','ounces','fluid ounce','fluid ounces','cup') THEN 'volume'
      WHEN t.measurement='quantity' THEN 'quantity'
      ELSE 'count'
    END,
    e.kind,
    CASE WHEN e.kind!='progress' THEN NULL ELSE CAST(ROUND(e.value * CASE
      WHEN t.measurement='duration' AND lower(trim(e.unit)) IN ('minute','minutes','min') THEN 60
      WHEN t.measurement='duration' AND lower(trim(e.unit)) IN ('hour','hours','hr','hrs','h') THEN 3600
      WHEN t.measurement='distance' AND lower(trim(e.unit)) IN ('km','kilometer','kilometers','kilometre','kilometres') THEN 1000
      WHEN t.measurement='distance' AND lower(trim(e.unit)) IN ('mi','mile','miles') THEN 1609.344
      WHEN t.measurement='quantity' AND lower(trim(e.unit)) IN ('l','liter','liters','litre','litres') THEN 1000
      WHEN t.measurement='quantity' AND lower(trim(e.unit)) IN ('oz','ounce','ounces','fluid ounce','fluid ounces') THEN 29.5735295625
      WHEN t.measurement='quantity' AND lower(trim(e.unit))='cup' THEN 240
      WHEN t.measurement='quantity' AND lower(trim(e.unit)) NOT IN ('ml','milliliter','milliliters','millilitre','millilitres','l','liter','liters','litre','litres','oz','ounce','ounces','fluid ounce','fluid ounces','cup','page','pages') THEN 1000
      ELSE 1 END) AS INTEGER) END,
    CASE WHEN e.kind!='progress' THEN NULL
      WHEN t.measurement='duration' THEN 'seconds'
      WHEN t.measurement='distance' THEN 'meters'
      WHEN t.measurement='count' THEN CASE WHEN lower(trim(e.unit)) IN ('rep','reps','repetition','repetitions') THEN 'reps' ELSE 'count' END
      WHEN lower(trim(e.unit)) IN ('page','pages') THEN 'pages'
      WHEN lower(trim(e.unit)) IN ('ml','milliliter','milliliters','millilitre','millilitres','l','liter','liters','litre','litres','oz','ounce','ounces','fluid ounce','fluid ounces','cup') THEN 'mL'
      ELSE 'milli:' || lower(trim(e.unit)) END,
    e.value,e.unit,e.note,e.occurred_at,e.local_date,e.timezone,e.created_at
  FROM habit_entries e
  JOIN habits h ON h.id=e.habit_id
  JOIN habit_targets t ON t.id=e.target_id;

  DROP TABLE habit_entries;

  CREATE INDEX IF NOT EXISTS activity_logs_habit_day_idx ON activity_logs (habit_id,local_date,kind) WHERE deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS activity_logs_timeline_idx ON activity_logs (local_date,occurred_at,id) WHERE deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS activity_logs_history_idx ON activity_logs (habit_id,occurred_at DESC,id DESC);
  CREATE UNIQUE INDEX IF NOT EXISTS activity_logs_daily_outcome_idx
    ON activity_logs (habit_id,local_date,kind)
    WHERE habit_id IS NOT NULL AND kind IN ('complete_override','clean','skip') AND deleted_at IS NULL;

  CREATE TABLE IF NOT EXISTS activity_presets (
    id TEXT PRIMARY KEY NOT NULL DEFAULT (
      lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
      substr(lower(hex(randomblob(2))), 2) || '-a' ||
      substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))
    ),
    habit_id TEXT NOT NULL REFERENCES habits(id) ON DELETE RESTRICT,
    name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 32),
    measurement TEXT NOT NULL CHECK (length(measurement) BETWEEN 1 AND 24),
    value INTEGER NOT NULL CHECK (value > 0),
    unit TEXT NOT NULL CHECK (length(unit) BETWEEN 1 AND 32),
    input_value REAL NOT NULL CHECK (input_value > 0),
    input_unit TEXT NOT NULL CHECK (length(input_unit) BETWEEN 1 AND 24),
    is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0,1)),
    sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS activity_presets_habit_order_idx ON activity_presets (habit_id,is_default DESC,sort_order,name);
  CREATE UNIQUE INDEX IF NOT EXISTS activity_presets_one_default_idx ON activity_presets (habit_id) WHERE is_default=1;

  CREATE TABLE IF NOT EXISTS activity_log_revisions (
    id TEXT PRIMARY KEY NOT NULL DEFAULT (
      lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
      substr(lower(hex(randomblob(2))), 2) || '-a' ||
      substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))
    ),
    log_id TEXT NOT NULL REFERENCES activity_logs(id) ON DELETE RESTRICT,
    idempotency_key TEXT NOT NULL UNIQUE,
    event_type TEXT NOT NULL CHECK (event_type IN ('edited','deleted','restored')),
    snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
    occurred_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS activity_log_revisions_log_idx ON activity_log_revisions (log_id,occurred_at DESC);
`;
