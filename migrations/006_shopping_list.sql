CREATE TABLE shopping_purchases (
  did text NOT NULL REFERENCES actors(did) ON DELETE CASCADE,
  planned_date date NOT NULL,
  item_key text NOT NULL CHECK(item_key ~ '^[a-f0-9]{64}$'),
  quantity numeric NOT NULL DEFAULT 0 CHECK(quantity >= 0),
  unspecified jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(unspecified)='array'),
  PRIMARY KEY(did, planned_date, item_key)
);
CREATE INDEX shopping_purchases_retention ON shopping_purchases(planned_date);
INSERT INTO schema_migrations(version) VALUES (6);
