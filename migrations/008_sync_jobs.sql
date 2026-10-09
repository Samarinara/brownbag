-- One resumable repair per known actor. Staged pages never affect the live index
-- until the entire repository listing has a stable commit.
CREATE TABLE sync_jobs (
  did text PRIMARY KEY REFERENCES actors(did),
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','complete')),
  phase text NOT NULL DEFAULT 'listing' CHECK (phase IN ('listing','applying','deleting')),
  snapshot_cid text,
  snapshot_rev text,
  collection_index integer NOT NULL DEFAULT 0,
  page_cursor text,
  lease_owner uuid,
  lease_until timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  rerun boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX sync_jobs_due ON sync_jobs(available_at) WHERE status <> 'complete';
CREATE TABLE sync_job_records (
  did text NOT NULL REFERENCES sync_jobs(did) ON DELETE CASCADE,
  uri text NOT NULL,
  collection text NOT NULL,
  rkey text NOT NULL,
  cid text NOT NULL,
  record jsonb NOT NULL,
  applied boolean NOT NULL DEFAULT false,
  PRIMARY KEY(did,uri)
);
CREATE TABLE sync_job_cursors (
  did text NOT NULL REFERENCES sync_jobs(did) ON DELETE CASCADE,
  collection text NOT NULL,
  cursor text NOT NULL,
  PRIMARY KEY(did,collection,cursor)
);
CREATE TABLE worker_heartbeats (
  worker text PRIMARY KEY,
  source text NOT NULL,
  connected boolean NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO schema_migrations(version) VALUES (8);
