-- Meal plans belong to the account, not to the rebuildable public projection.
ALTER TABLE network_records ADD COLUMN recipe_hidden boolean NOT NULL DEFAULT false;
UPDATE network_records n SET recipe_hidden=r.hidden FROM public_recipes r WHERE r.uri=n.uri;

ALTER TABLE meal_entries ADD COLUMN recipe_cid text;
ALTER TABLE meal_entries ADD COLUMN recipe_record jsonb;
UPDATE meal_entries m SET recipe_cid=r.cid,recipe_record=r.record FROM public_recipes r WHERE r.uri=m.uri;
ALTER TABLE meal_entries DROP CONSTRAINT meal_entries_uri_fkey;
-- Restrict ledger deletion: rebuilding public_recipes must not erase private plans.
ALTER TABLE meal_entries ADD CONSTRAINT meal_entries_uri_fkey FOREIGN KEY(uri) REFERENCES network_records(uri) ON DELETE RESTRICT;

CREATE FUNCTION preserve_planner_recipe_visibility() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.hidden := NEW.hidden OR (SELECT recipe_hidden FROM network_records WHERE uri=NEW.uri);
  END IF;
  UPDATE network_records SET recipe_hidden=NEW.hidden WHERE uri=NEW.uri;
  RETURN NEW;
END;
$$;
CREATE TRIGGER planner_recipe_visibility BEFORE INSERT OR UPDATE OF hidden ON public_recipes
  FOR EACH ROW EXECUTE FUNCTION preserve_planner_recipe_visibility();

-- Only an accepted network tombstone invokes the product's existing deletion policy.
-- NetworkStore's revision guard prevents stale deletes from reaching this trigger.
CREATE FUNCTION delete_tombstoned_meal_entries() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.deleted THEN
    DELETE FROM meal_entries WHERE uri=NEW.uri;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER planner_recipe_tombstone AFTER UPDATE OF deleted ON network_records
  FOR EACH ROW EXECUTE FUNCTION delete_tombstoned_meal_entries();

INSERT INTO schema_migrations(version) VALUES (9);
