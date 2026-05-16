-- Fredagsfett v8: add TENTATIVE as a 4th availability status.
--
-- The original ff_availability.status CHECK clause only allowed
-- ('AVAILABLE', 'MAYBE', 'UNAVAILABLE'). SQLite cannot ALTER a CHECK
-- constraint in place, so we rebuild the table with the wider list:
-- ('AVAILABLE', 'TENTATIVE', 'MAYBE', 'UNAVAILABLE').
--
-- Status ladder (intent):
--   AVAILABLE   100% yes
--   TENTATIVE    lean yes (new, ~75% confidence)
--   MAYBE        50/50
--   UNAVAILABLE  no
--
-- Remote:
--   npx wrangler d1 execute sp1e-db --remote --file=fredagsfett-migration-008-tentative-status.sql
-- Local:
--   npx wrangler d1 execute sp1e-db --local --file=fredagsfett-migration-008-tentative-status.sql

PRAGMA foreign_keys = OFF;

BEGIN TRANSACTION;

CREATE TABLE ff_availability_new (
  id         TEXT PRIMARY KEY,
  group_id   TEXT NOT NULL REFERENCES ff_groups(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES ff_users(id) ON DELETE CASCADE,
  date       TEXT NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('AVAILABLE', 'TENTATIVE', 'MAYBE', 'UNAVAILABLE')),
  note       TEXT,
  start_time TEXT,
  end_time   TEXT,
  time_note  TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (group_id, user_id, date)
);

INSERT INTO ff_availability_new
  (id, group_id, user_id, date, status, note, start_time, end_time, time_note, created_at, updated_at)
SELECT
  id, group_id, user_id, date, status, note, start_time, end_time, time_note, created_at, updated_at
FROM ff_availability;

DROP TABLE ff_availability;

ALTER TABLE ff_availability_new RENAME TO ff_availability;

CREATE INDEX IF NOT EXISTS idx_ff_availability_group_date ON ff_availability (group_id, date);
CREATE INDEX IF NOT EXISTS idx_ff_availability_user_date  ON ff_availability (user_id,  date);

COMMIT;

PRAGMA foreign_keys = ON;
