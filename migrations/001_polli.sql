-- Apply to the existing Polli database as a migration owner, never polli_app.
-- Polli platform migrations must already exist.
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('brownbag.polli.migrations'));
CREATE SCHEMA IF NOT EXISTS brownbag;
REVOKE ALL ON SCHEMA brownbag FROM PUBLIC;
GRANT USAGE ON SCHEMA brownbag TO polli_app;
CREATE TABLE IF NOT EXISTS brownbag.payloads (
 entity_id uuid PRIMARY KEY REFERENCES platform.entities(id) ON DELETE CASCADE,
 payload jsonb NOT NULL CHECK (payload->>'kind' IN ('recipe','meal','shopping'))
);
ALTER TABLE brownbag.payloads ENABLE ROW LEVEL SECURITY;
ALTER TABLE brownbag.payloads FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payload_read ON brownbag.payloads;
CREATE POLICY payload_read ON brownbag.payloads FOR SELECT TO polli_app USING (platform.can_access(entity_id,'read'));
DROP POLICY IF EXISTS payload_insert ON brownbag.payloads;
CREATE POLICY payload_insert ON brownbag.payloads FOR INSERT TO polli_app WITH CHECK (platform.can_access(entity_id,'edit'));
DROP POLICY IF EXISTS payload_update ON brownbag.payloads;
CREATE POLICY payload_update ON brownbag.payloads FOR UPDATE TO polli_app USING (platform.can_access(entity_id,'edit')) WITH CHECK (platform.can_access(entity_id,'edit'));
DROP POLICY IF EXISTS payload_delete ON brownbag.payloads;
CREATE POLICY payload_delete ON brownbag.payloads FOR DELETE TO polli_app USING (platform.can_access(entity_id,'delete'));
GRANT SELECT,INSERT,UPDATE,DELETE ON brownbag.payloads TO polli_app;
CREATE TABLE IF NOT EXISTS brownbag.receipts (
 account_id uuid NOT NULL REFERENCES platform.accounts(id) ON DELETE CASCADE,
 operation_id uuid NOT NULL,
 entity_id uuid REFERENCES platform.entities(id) ON DELETE CASCADE,
 request_hash text NOT NULL,
 result jsonb NOT NULL,
 PRIMARY KEY(account_id,operation_id)
);
ALTER TABLE brownbag.receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE brownbag.receipts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS own_receipts ON brownbag.receipts;
CREATE POLICY own_receipts ON brownbag.receipts TO polli_app USING(account_id=platform.current_account_id()) WITH CHECK(account_id=platform.current_account_id());
GRANT SELECT,INSERT,DELETE ON brownbag.receipts TO polli_app;
COMMIT;
