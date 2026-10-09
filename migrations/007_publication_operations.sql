-- Persist identity and intent before any PDS write. Leases serialize workers;
-- remote compare-and-swap guards also protect against delayed requests.
CREATE TABLE publication_operations (
  did text NOT NULL REFERENCES actors(did),
  operation_key text NOT NULL CHECK (length(operation_key) BETWEEN 1 AND 200),
  action text NOT NULL CHECK (action IN ('create','update','delete')),
  payload_hash text NOT NULL,
  payload jsonb NOT NULL,
  rkey text NOT NULL,
  expected_cid text,
  record jsonb,
  attempted boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','uncertain','succeeded','conflict')),
  result jsonb,
  repo_rev text NOT NULL DEFAULT '',
  projection_pending boolean NOT NULL DEFAULT false,
  lease_token uuid,
  lease_until timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (did, operation_key)
);
CREATE INDEX publication_recovery ON publication_operations(updated_at)
  WHERE status IN ('pending','uncertain') OR projection_pending;
