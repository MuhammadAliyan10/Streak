export const focusMigrationV5 = `
  ALTER TABLE activity_logs ADD COLUMN focus_session_id TEXT;
  CREATE INDEX IF NOT EXISTS activity_logs_focus_session_idx ON activity_logs(focus_session_id) WHERE focus_session_id IS NOT NULL;

  CREATE TABLE IF NOT EXISTS focus_sessions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL CHECK (length(title) BETWEEN 2 AND 80),
    mode TEXT NOT NULL CHECK (mode IN ('stopwatch','countdown')),
    target_seconds INTEGER CHECK (target_seconds IS NULL OR target_seconds BETWEEN 1 AND 86400),
    started_at TEXT NOT NULL,
    running_since TEXT,
    active_ms INTEGER NOT NULL DEFAULT 0 CHECK (active_ms >= 0),
    finished_at TEXT,
    status TEXT NOT NULL CHECK (status IN ('running','paused','recovery','review','completed','discarded')),
    recovery_candidate_ms INTEGER NOT NULL DEFAULT 0 CHECK (recovery_candidate_ms >= 0),
    timezone TEXT NOT NULL,
    habit_id TEXT,
    task_id TEXT,
    note TEXT NOT NULL DEFAULT '',
    credited_seconds INTEGER CHECK (credited_seconds IS NULL OR credited_seconds BETWEEN 1 AND 604800),
    completed_at TEXT,
    revision INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS focus_sessions_one_unfinished_idx ON focus_sessions((1))
    WHERE status IN ('running','paused','recovery','review');
  CREATE INDEX IF NOT EXISTS focus_sessions_history_idx ON focus_sessions(started_at DESC,id DESC);

  CREATE TABLE IF NOT EXISTS focus_session_intervals (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES focus_sessions(id) ON DELETE CASCADE,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS focus_session_intervals_session_idx ON focus_session_intervals(session_id,started_at);

  CREATE TABLE IF NOT EXISTS focus_session_events (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES focus_sessions(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL CHECK (event_type IN ('paused','resumed','backgrounded','foregrounded','recovery_required','recovered','finished','saved','discarded','credit_corrected','reset')),
    occurred_at TEXT NOT NULL,
    details_json TEXT NOT NULL DEFAULT '{}'
  );
  CREATE INDEX IF NOT EXISTS focus_session_events_session_idx ON focus_session_events(session_id,occurred_at);

  CREATE TABLE IF NOT EXISTS focus_session_activity_logs (
    session_id TEXT NOT NULL REFERENCES focus_sessions(id) ON DELETE CASCADE,
    activity_log_id TEXT NOT NULL REFERENCES activity_logs(id) ON DELETE RESTRICT,
    local_date TEXT NOT NULL,
    credited_seconds INTEGER NOT NULL CHECK (credited_seconds > 0),
    revision INTEGER NOT NULL,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
    PRIMARY KEY (session_id,activity_log_id)
  );
  CREATE INDEX IF NOT EXISTS focus_session_activity_date_idx ON focus_session_activity_logs(local_date,session_id);
`;
