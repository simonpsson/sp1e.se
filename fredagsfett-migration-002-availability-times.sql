-- Fredagsfett calendar time windows.
-- Run after fredagsfett-migration-001.sql on existing D1 databases.
--
-- Remote:
--   npx wrangler d1 execute sp1e-db --remote --file=fredagsfett-migration-002-availability-times.sql
--
-- Local:
--   npx wrangler d1 execute sp1e-db --local --file=fredagsfett-migration-002-availability-times.sql

ALTER TABLE ff_availability ADD COLUMN start_time TEXT;
ALTER TABLE ff_availability ADD COLUMN end_time TEXT;
ALTER TABLE ff_availability ADD COLUMN time_note TEXT;
