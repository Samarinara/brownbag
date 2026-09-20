-- postgres.js uses the target parameter type when serializing values. Early network builds
-- passed JSON.stringify(...) to parameters inferred as jsonb, so Neon stored JSON string
-- scalars instead of objects. Normalize existing data; future writes bind text before casting.
UPDATE network_records SET record=(record #>> '{}')::jsonb
WHERE jsonb_typeof(record)='string';
UPDATE public_recipes SET record=(record #>> '{}')::jsonb
WHERE jsonb_typeof(record)='string';
UPDATE actors SET profile=(profile #>> '{}')::jsonb
WHERE jsonb_typeof(profile)='string';
UPDATE drafts SET data=(data #>> '{}')::jsonb
WHERE jsonb_typeof(data)='string';
UPDATE indexing_failures SET event=(event #>> '{}')::jsonb
WHERE jsonb_typeof(event)='string';
UPDATE audit_events SET detail=(detail #>> '{}')::jsonb
WHERE jsonb_typeof(detail)='string';
UPDATE proposals SET payload=(payload #>> '{}')::jsonb
WHERE jsonb_typeof(payload)='string';
UPDATE proposals SET result=(result #>> '{}')::jsonb
WHERE jsonb_typeof(result)='string';

INSERT INTO schema_migrations(version) VALUES (2);
