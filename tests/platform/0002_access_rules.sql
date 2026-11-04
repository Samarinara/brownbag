-- Run as the migration owner. Runtime logins must be members of exactly one group.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='polli_api') THEN CREATE ROLE polli_api NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='polli_app') THEN CREATE ROLE polli_app NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='polli_worker') THEN CREATE ROLE polli_worker NOLOGIN; END IF;
END $$;
--> statement-breakpoint
REVOKE ALL ON SCHEMA platform FROM PUBLIC;
GRANT USAGE ON SCHEMA platform TO polli_api, polli_app, polli_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA platform TO polli_api, polli_worker;
REVOKE ALL ON platform.entities, platform.relationships FROM polli_api;
GRANT SELECT, INSERT, DELETE, REFERENCES ON platform.entities TO polli_api, polli_app;
GRANT UPDATE(title, language, revision, updated_at) ON platform.entities TO polli_api, polli_app;
GRANT SELECT, INSERT, DELETE ON platform.relationships TO polli_api, polli_app;
-- App services never receive account, job, rate-limit, receipt or sync-log access.
--> statement-breakpoint
CREATE FUNCTION platform.current_account_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT a.id FROM platform.accounts a WHERE a.status = 'active' AND (
    a.workos_id = nullif(current_setting('polli.workos_id', true),'') OR
    (nullif(current_setting('polli.workos_id', true),'') IS NULL AND a.id::text = current_setting('polli.account_id',true))
  ) LIMIT 1
$$;
CREATE FUNCTION platform.is_active_account(target uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT EXISTS (SELECT 1 FROM platform.accounts WHERE id=target AND status='active')
$$;
CREATE FUNCTION platform.can_access(target uuid, action text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT EXISTS (SELECT 1 FROM platform.entities e WHERE e.id=target AND e.deleted_at IS NULL
    AND platform.current_account_id() IS NOT NULL
    AND (e.owner_id=platform.current_account_id() OR (action IN ('read','edit') AND EXISTS (
      SELECT 1 FROM platform.relationships r WHERE r.entity_id=e.id AND r.account_id=platform.current_account_id()
        AND (action='read' OR r.relation='editor')
    ))) AND action IN ('read','edit','share','delete'))
$$;
REVOKE ALL ON FUNCTION platform.current_account_id(), platform.is_active_account(uuid), platform.can_access(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.current_account_id(), platform.is_active_account(uuid), platform.can_access(uuid,text) TO polli_api,polli_app,polli_worker;
--> statement-breakpoint
ALTER TABLE platform.accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY self_account ON platform.accounts TO polli_api USING (workos_id=current_setting('polli.workos_id',true)) WITH CHECK (workos_id=current_setting('polli.workos_id',true));
CREATE POLICY worker_accounts ON platform.accounts TO polli_worker USING (true) WITH CHECK (true);
ALTER TABLE platform.entities ENABLE ROW LEVEL SECURITY;
CREATE POLICY entity_read ON platform.entities FOR SELECT TO polli_api,polli_app USING (deleted_at IS NULL AND (owner_id=platform.current_account_id() OR platform.can_access(id,'read')));
CREATE POLICY entity_create ON platform.entities FOR INSERT TO polli_api,polli_app WITH CHECK (owner_id=platform.current_account_id() AND deleted_at IS NULL);
CREATE POLICY entity_edit ON platform.entities FOR UPDATE TO polli_api,polli_app USING (platform.can_access(id,'edit')) WITH CHECK (platform.can_access(id,'edit'));
CREATE POLICY entity_delete ON platform.entities FOR DELETE TO polli_api,polli_app USING (platform.can_access(id,'delete'));
CREATE POLICY worker_entities ON platform.entities TO polli_worker USING (true) WITH CHECK (true);
ALTER TABLE platform.relationships ENABLE ROW LEVEL SECURITY;
CREATE POLICY relation_read ON platform.relationships FOR SELECT TO polli_api,polli_app USING (account_id=platform.current_account_id() OR platform.can_access(entity_id,'share'));
CREATE POLICY relation_create ON platform.relationships FOR INSERT TO polli_api,polli_app WITH CHECK (platform.can_access(entity_id,'share') AND platform.is_active_account(account_id));
CREATE POLICY relation_delete ON platform.relationships FOR DELETE TO polli_api,polli_app USING (platform.can_access(entity_id,'share'));
CREATE POLICY worker_relationships ON platform.relationships TO polli_worker USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE FUNCTION platform.publish_event(recipient uuid, item uuid, item_type text, event_kind text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE seq integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM platform.accounts WHERE id=recipient) THEN RETURN; END IF;
  INSERT INTO platform.sync_heads(account_id,version) VALUES(recipient,0) ON CONFLICT DO NOTHING;
  UPDATE platform.sync_heads SET version=version+1 WHERE account_id=recipient RETURNING version INTO seq;
  INSERT INTO platform.sync_events(account_id,version,entity_id,type,kind) VALUES(recipient,seq,item,item_type,event_kind);
END $$;
REVOKE ALL ON FUNCTION platform.publish_event(uuid,uuid,text,text) FROM PUBLIC,polli_api,polli_app;
--> statement-breakpoint
CREATE FUNCTION platform.entity_events() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE recipient uuid; item platform.entities; expected text; effective_role text;
BEGIN
  IF TG_OP='INSERT' THEN item:=NEW; ELSE item:=OLD; END IF;
  effective_role:=coalesce(nullif(current_setting('role',true),'none'),session_user);
  IF TG_OP IN ('UPDATE','DELETE') AND NOT pg_has_role(effective_role,'polli_worker','member') THEN
    expected:=current_setting('polli.expected_revision',true);
    IF expected IS NULL OR expected='' OR expected::integer<>OLD.revision THEN
      RAISE EXCEPTION 'stale_revision' USING ERRCODE='P0001';
    END IF;
    PERFORM set_config('polli.expected_revision','',true);
  END IF;
  IF TG_OP='INSERT' THEN NEW.revision:=1; END IF;
  IF TG_OP='UPDATE' THEN NEW.revision:=OLD.revision+1; NEW.updated_at:=clock_timestamp(); END IF;
  -- Lock recipient heads in UUID order. Sequence assignment is serialized until commit.
  FOR recipient IN SELECT id FROM (
    SELECT item.owner_id AS id UNION SELECT r.account_id FROM platform.relationships r WHERE r.entity_id=item.id
  ) recipients ORDER BY id LOOP
    PERFORM platform.publish_event(recipient,item.id,item.type,CASE WHEN TG_OP='DELETE' THEN 'remove' ELSE 'upsert' END);
  END LOOP;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
REVOKE ALL ON FUNCTION platform.entity_events() FROM PUBLIC,polli_api,polli_app;
CREATE TRIGGER entity_change BEFORE INSERT OR UPDATE OR DELETE ON platform.entities FOR EACH ROW EXECUTE FUNCTION platform.entity_events();
--> statement-breakpoint
CREATE FUNCTION platform.relationship_events() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE rel platform.relationships; item platform.entities;
BEGIN
  IF TG_OP='DELETE' THEN rel:=OLD; ELSE rel:=NEW; END IF;
  SELECT * INTO item FROM platform.entities WHERE id=rel.entity_id;
  IF item.id IS NOT NULL THEN
    PERFORM platform.publish_event(rel.account_id,item.id,item.type,CASE WHEN TG_OP='DELETE' THEN 'remove' ELSE 'upsert' END);
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
REVOKE ALL ON FUNCTION platform.relationship_events() FROM PUBLIC,polli_api,polli_app;
CREATE TRIGGER relationship_change AFTER INSERT OR DELETE ON platform.relationships FOR EACH ROW EXECUTE FUNCTION platform.relationship_events();
--> statement-breakpoint
CREATE FUNCTION platform.lock_account() RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid;
BEGIN
  SELECT id INTO actor FROM platform.accounts WHERE id=platform.current_account_id() AND status='active' FOR SHARE;
  IF actor IS NULL THEN RAISE EXCEPTION 'account_unavailable' USING ERRCODE='42501'; END IF;
  RETURN actor;
END $$;
REVOKE ALL ON FUNCTION platform.lock_account() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.lock_account() TO polli_api,polli_app;

