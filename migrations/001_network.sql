CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE actors (
  did text PRIMARY KEY,
  handle text,
  profile jsonb,
  active boolean NOT NULL DEFAULT true,
  status_time bigint NOT NULL DEFAULT 0,
  identity_time bigint NOT NULL DEFAULT 0,
  profile_rev text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE oauth_state (key text PRIMARY KEY, value jsonb NOT NULL, expires_at timestamptz NOT NULL);
CREATE TABLE oauth_sessions (key text PRIMARY KEY, value jsonb NOT NULL);
CREATE TABLE oauth_locks (key text PRIMARY KEY, owner text NOT NULL, expires_at timestamptz NOT NULL);
CREATE TABLE app_sessions (hash text PRIMARY KEY, did text NOT NULL REFERENCES actors(did), expires_at timestamptz NOT NULL);
CREATE INDEX app_sessions_expiry ON app_sessions(expires_at);

CREATE TABLE network_records (
  uri text PRIMARY KEY,
  did text NOT NULL REFERENCES actors(did),
  collection text NOT NULL,
  rkey text NOT NULL,
  cid text,
  record jsonb,
  repo_rev text NOT NULL,
  deleted boolean NOT NULL DEFAULT false,
  indexed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(did, collection, rkey)
);
CREATE INDEX network_records_owner ON network_records(did,collection) WHERE NOT deleted;
CREATE TABLE public_recipes (
  uri text PRIMARY KEY REFERENCES network_records(uri) ON DELETE CASCADE,
  did text NOT NULL REFERENCES actors(did),
  cid text NOT NULL,
  record jsonb NOT NULL,
  title text NOT NULL,
  ingredient_text text NOT NULL,
  search_document tsvector NOT NULL,
  created_at timestamptz NOT NULL,
  hidden boolean NOT NULL DEFAULT false
);
CREATE INDEX public_recipes_search ON public_recipes USING gin(search_document);
CREATE INDEX public_recipes_feed ON public_recipes(created_at DESC,uri DESC);
CREATE TABLE follows (
  uri text PRIMARY KEY REFERENCES network_records(uri) ON DELETE CASCADE,
  did text NOT NULL REFERENCES actors(did),
  subject text NOT NULL
);
CREATE INDEX follows_edge ON follows(did,subject);
CREATE TABLE drafts (id uuid PRIMARY KEY, did text NOT NULL REFERENCES actors(did), data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX drafts_owner ON drafts(did,updated_at DESC);
CREATE TABLE bookmarks (did text NOT NULL REFERENCES actors(did), uri text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(did,uri));
CREATE TABLE sync_cursors (source text PRIMARY KEY, cursor bigint NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE indexing_failures (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, uri text, reason text NOT NULL, event jsonb, source text, time_us bigint, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE rate_limits (key text PRIMARY KEY, count integer NOT NULL, expires_at timestamptz NOT NULL);
CREATE INDEX rate_limits_expiry ON rate_limits(expires_at);
CREATE TABLE agent_keys (id uuid PRIMARY KEY, did text NOT NULL REFERENCES actors(did), name text NOT NULL, hash text NOT NULL UNIQUE, prefix text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE proposals (id uuid PRIMARY KEY, did text NOT NULL REFERENCES actors(did), key_id uuid REFERENCES agent_keys(id) ON DELETE SET NULL, payload jsonb NOT NULL, status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','applying','approved','rejected')), result jsonb, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX proposals_owner ON proposals(did,created_at DESC);
CREATE TABLE audit_events (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, did text NOT NULL REFERENCES actors(did), event text NOT NULL, detail jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now());

INSERT INTO schema_migrations(version) VALUES (1);
