-- Fredagsfett v3: locked-in events on top of availability.
-- Run after fredagsfett-migration-002-availability-times.sql on existing D1 databases.
--
-- Remote:
--   npx wrangler d1 execute sp1e-db --remote --file=fredagsfett-migration-003-events.sql
-- Local:
--   npx wrangler d1 execute sp1e-db --local --file=fredagsfett-migration-003-events.sql
--
-- First-admin seed (run once after applying the migration on remote):
--   npx wrangler d1 execute sp1e-db --remote \
--     --command="UPDATE ff_users SET is_admin = 1 WHERE name = 'Simon';"
-- (Replace 'Simon' with whichever account should be the first admin. The
--  in-app auto-seed in fredagsfettRegister will also promote the first
--  registrant if no admins exist, as a safety net.)

CREATE TABLE IF NOT EXISTS ff_events (
  id                  TEXT PRIMARY KEY,
  group_id            TEXT NOT NULL REFERENCES ff_groups(id) ON DELETE CASCADE,
  date                TEXT NOT NULL,
  status              TEXT NOT NULL CHECK (status IN ('LOCKED','CANCELLED')) DEFAULT 'LOCKED',
  host_user_id        TEXT REFERENCES ff_users(id) ON DELETE SET NULL,
  title               TEXT,
  location            TEXT,
  start_time          TEXT,
  end_time            TEXT,
  notes               TEXT,
  created_by_user_id  TEXT REFERENCES ff_users(id) ON DELETE SET NULL,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
  cancelled_at        TEXT,
  UNIQUE(group_id, date)
);

CREATE INDEX IF NOT EXISTS idx_ff_events_group_date ON ff_events (group_id, date);
CREATE INDEX IF NOT EXISTS idx_ff_events_status ON ff_events (status);
