-- Keep author-entered text in records; derive comparison keys in one place.
CREATE FUNCTION ingredient_key(value text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT lower(btrim(regexp_replace(translate(value, chr(160) || chr(8239), '  '), '[[:space:]]+', ' ', 'g')))
$$;

-- Only unambiguous nonnegative decimal, fraction and mixed-fraction quantities.
-- Ranges, approximate amounts and prose remain NULL rather than guessed.
CREATE FUNCTION ingredient_quantity(value text) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE AS $$
DECLARE
  cleaned text := ingredient_key(value);
  parts text[];
  fraction record;
BEGIN
  cleaned := regexp_replace(cleaned, '([0-9])([¼½¾⅐⅑⅒⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞])', '\1 \2', 'g');
  FOR fraction IN SELECT * FROM (VALUES
    ('¼','1/4'),('½','1/2'),('¾','3/4'),('⅐','1/7'),('⅑','1/9'),('⅒','1/10'),
    ('⅓','1/3'),('⅔','2/3'),('⅕','1/5'),('⅖','2/5'),('⅗','3/5'),('⅘','4/5'),
    ('⅙','1/6'),('⅚','5/6'),('⅛','1/8'),('⅜','3/8'),('⅝','5/8'),('⅞','7/8')
  ) AS fractions(symbol, expanded) LOOP
    cleaned := replace(cleaned, fraction.symbol, fraction.expanded);
  END LOOP;
  IF cleaned ~ '^([0-9]+([.][0-9]+)?|[.][0-9]+)$' THEN
    RETURN cleaned::numeric;
  END IF;
  parts := regexp_match(cleaned, '^([0-9]+ )?([0-9]+)[[:space:]]*/[[:space:]]*([0-9]+)$');
  IF parts IS NOT NULL AND parts[3]::numeric <> 0 THEN
    RETURN coalesce(btrim(parts[1])::numeric, 0) + parts[2]::numeric / parts[3]::numeric;
  END IF;
  RETURN NULL;
END
$$;

CREATE TABLE recipe_ingredients (
  recipe_uri text NOT NULL REFERENCES public_recipes(uri) ON DELETE CASCADE,
  position integer NOT NULL,
  name_key text NOT NULL,
  unit_key text NOT NULL,
  quantity_text text,
  quantity_value numeric,
  PRIMARY KEY(recipe_uri, position)
);
CREATE INDEX recipe_ingredients_name ON recipe_ingredients(name_key text_pattern_ops);
CREATE INDEX recipe_ingredients_unit ON recipe_ingredients(unit_key text_pattern_ops);
CREATE INDEX recipe_ingredients_group ON recipe_ingredients(name_key, unit_key, quantity_value);

CREATE FUNCTION index_recipe_ingredients() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM recipe_ingredients WHERE recipe_uri=NEW.uri;
  INSERT INTO recipe_ingredients(recipe_uri,position,name_key,unit_key,quantity_text,quantity_value)
  SELECT NEW.uri, ordinal::integer - 1, ingredient_key(item->>'name'),
    ingredient_key(coalesce(item->>'unit','')), item->>'quantity',
    ingredient_quantity(item->>'quantity')
  FROM jsonb_array_elements(NEW.record->'ingredients') WITH ORDINALITY AS ingredients(item,ordinal)
  WHERE ingredient_key(item->>'name') <> '';
  RETURN NEW;
END
$$;
CREATE TRIGGER public_recipes_ingredients
AFTER INSERT OR UPDATE OF record ON public_recipes
FOR EACH ROW EXECUTE FUNCTION index_recipe_ingredients();

-- Backfill existing recipes without changing their published records.
INSERT INTO recipe_ingredients(recipe_uri,position,name_key,unit_key,quantity_text,quantity_value)
SELECT r.uri, ordinal::integer - 1, ingredient_key(item->>'name'),
  ingredient_key(coalesce(item->>'unit','')), item->>'quantity',
  ingredient_quantity(item->>'quantity')
FROM public_recipes r,
  LATERAL jsonb_array_elements(r.record->'ingredients') WITH ORDINALITY AS ingredients(item,ordinal)
WHERE ingredient_key(item->>'name') <> '';

INSERT INTO schema_migrations(version) VALUES (5);
