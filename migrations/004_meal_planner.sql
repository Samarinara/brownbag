CREATE TABLE planner_settings (
  did text PRIMARY KEY REFERENCES actors(did) ON DELETE CASCADE,
  default_slot text NOT NULL DEFAULT 'dinner' CHECK(default_slot IN ('breakfast','lunch','dinner','other'))
);
CREATE TABLE meal_entries (
  id uuid PRIMARY KEY,
  did text NOT NULL REFERENCES actors(did) ON DELETE CASCADE,
  uri text NOT NULL REFERENCES public_recipes(uri) ON DELETE CASCADE,
  planned_date date NOT NULL,
  slot text NOT NULL CHECK(slot IN ('breakfast','lunch','dinner','other')),
  note text NOT NULL DEFAULT '' CHECK(char_length(note) <= 2000),
  position bigint GENERATED ALWAYS AS IDENTITY,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX meal_entries_owner_date ON meal_entries(did,planned_date,position);
CREATE INDEX meal_entries_recipe ON meal_entries(uri);
CREATE INDEX meal_entries_retention ON meal_entries(planned_date);
INSERT INTO schema_migrations(version) VALUES (4);
