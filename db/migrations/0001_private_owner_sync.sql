CREATE SCHEMA IF NOT EXISTS private;
CREATE SCHEMA IF NOT EXISTS app;

CREATE TABLE IF NOT EXISTS private.owner_access (
  singleton_id smallint PRIMARY KEY DEFAULT 1 CHECK (singleton_id = 1),
  token_hash text NOT NULL CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  rotated_at timestamptz
);

CREATE TABLE IF NOT EXISTS app.sync_events (
  id uuid PRIMARY KEY,
  entity text NOT NULL CHECK (length(entity) BETWEEN 1 AND 64),
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app.sync_events
  ADD COLUMN IF NOT EXISTS received_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS sync_events_created_at_id_idx
  ON app.sync_events (received_at, id);

REVOKE ALL ON SCHEMA private FROM PUBLIC;
REVOKE ALL ON TABLE private.owner_access FROM PUBLIC;
REVOKE ALL ON SCHEMA app FROM PUBLIC;
REVOKE ALL ON TABLE app.sync_events FROM PUBLIC;
