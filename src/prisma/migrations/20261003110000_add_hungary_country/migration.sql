BEGIN;

LOCK TABLE "Country" IN SHARE ROW EXCLUSIVE MODE;

-- IDs 1–34 belong to the existing country seed, which may run after migrations.
INSERT INTO "Country" ("id", "isoCode", "nameEn", "nameRu", "nameKk", "createdAt", "updatedAt")
SELECT GREATEST(35, COALESCE(MAX("id"), 0) + 1), 'HU', 'Hungary', 'Венгрия', 'Мажарстан', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Country"
ON CONFLICT ("isoCode") DO NOTHING;

-- Legacy seeds supply explicit IDs, so the sequence may lag behind existing rows.
SELECT setval(
  pg_get_serial_sequence('"Country"', 'id'),
  GREATEST((SELECT MAX("id") FROM "Country"), nextval(pg_get_serial_sequence('"Country"', 'id'))),
  true
);

COMMIT;
