CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS private.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_slot smallint NOT NULL DEFAULT 1 UNIQUE CHECK (owner_slot = 1),
  full_name text NOT NULL CHECK (length(full_name) BETWEEN 2 AND 100),
  email text NOT NULL UNIQUE CHECK (email = lower(btrim(email)) AND length(email) <= 254),
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS private.sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES private.users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON private.sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_expiration_idx ON private.sessions (expires_at) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS private.auth_login_attempts (
  email text PRIMARY KEY CHECK (email = lower(btrim(email)) AND length(email) <= 254),
  window_started_at timestamptz NOT NULL DEFAULT now(),
  failed_attempts integer NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  blocked_until timestamptz
);

REVOKE ALL ON SCHEMA private FROM PUBLIC;
REVOKE ALL ON TABLE private.users FROM PUBLIC;
REVOKE ALL ON TABLE private.sessions FROM PUBLIC;
REVOKE ALL ON TABLE private.auth_login_attempts FROM PUBLIC;
