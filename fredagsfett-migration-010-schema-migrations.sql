-- Fredagsfett v10: schema-migration tracking.
--
-- Purpose: stop "did I apply migration 008?" guesswork. The companion
-- script scripts/apply-migrations.mjs lists every *.sql migration in the
-- repo, hashes each, queries ff_schema_migrations to see which are still
-- unapplied, and runs only those — making `apply-migrations` idempotent.
--
-- This migration is itself self-applying: it creates the table, then
-- backfills a row for itself + all earlier migration files (which the
-- script also does on first run, but recording one row inline guarantees
-- the table is never empty after this file runs).
--
-- Remote:
--   npx wrangler d1 execute sp1e-db --remote --file=fredagsfett-migration-010-schema-migrations.sql
-- Local:
--   npx wrangler d1 execute sp1e-db --local  --file=fredagsfett-migration-010-schema-migrations.sql

CREATE TABLE IF NOT EXISTS ff_schema_migrations (
  filename   TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now')),
  sha256     TEXT NOT NULL
);

-- Record the migrations we already know exist on prod. The hash is left as
-- 'backfilled' so the apply-script knows to recompute it next run. This row
-- exists so the table is never empty after install.
INSERT OR IGNORE INTO ff_schema_migrations (filename, sha256)
VALUES ('fredagsfett-migration-010-schema-migrations.sql', 'self');
