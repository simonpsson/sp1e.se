-- Fredagsfett v4: event comments + SP1Wise expense ↔ event tagging.
-- Run after fredagsfett-migration-003-events.sql on existing D1 databases.
--
-- Remote:
--   npx wrangler d1 execute sp1e-db --remote --file=fredagsfett-migration-004-event-comments-and-tagging.sql
-- Local:
--   npx wrangler d1 execute sp1e-db --local --file=fredagsfett-migration-004-event-comments-and-tagging.sql

-- Per-event comment thread. Reuses the same shape as ff_comments (which is
-- expense-scoped) but stays in its own table so the FK is unambiguous and
-- ON DELETE CASCADE works cleanly when an event row is removed.
CREATE TABLE IF NOT EXISTS ff_event_comments (
  id          TEXT PRIMARY KEY,
  event_id    TEXT NOT NULL REFERENCES ff_events(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES ff_users(id) ON DELETE CASCADE,
  body        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_ff_event_comments_event ON ff_event_comments (event_id, created_at);

-- Optional tag linking an SP1Wise expense to a locked Fredagsfett event.
-- ON DELETE SET NULL preserves the expense if the event is later cancelled
-- and hard-deleted.
ALTER TABLE ff_expenses ADD COLUMN event_id TEXT REFERENCES ff_events(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_ff_expenses_event ON ff_expenses (event_id);
