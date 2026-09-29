ALTER TABLE bookmarks ADD COLUMN removed boolean NOT NULL DEFAULT false;
ALTER TABLE bookmarks ADD COLUMN tags jsonb NOT NULL DEFAULT '[]'::jsonb;
CREATE TABLE cookbook_tags (
  did text NOT NULL REFERENCES actors(did),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 25),
  PRIMARY KEY (did, name)
);

INSERT INTO schema_migrations(version) VALUES (3);
