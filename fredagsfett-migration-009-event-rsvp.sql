-- Fredagsfett v9: per-event RSVP separate from generic availability.
--
-- Once an event is locked, members can flip "Jag kommer" / "Kommer inte"
-- without polluting their AVAILABLE/MAYBE/UNAVAILABLE answer for the date.
-- The RSVP overrides the availability when counting attendees in event lists.
--
-- Status ladder:
--   ATTENDING        will be there
--   NOT_ATTENDING    will NOT be there (overrides AVAILABLE answer)
--   (no row)         no explicit RSVP — fall back to ff_availability.status
--
-- Remote:
--   npx wrangler d1 execute sp1e-db --remote --file=fredagsfett-migration-009-event-rsvp.sql
-- Local:
--   npx wrangler d1 execute sp1e-db --local  --file=fredagsfett-migration-009-event-rsvp.sql

CREATE TABLE IF NOT EXISTS ff_event_rsvp (
  id          TEXT PRIMARY KEY,
  event_id    TEXT NOT NULL REFERENCES ff_events(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES ff_users(id) ON DELETE CASCADE,
  status      TEXT NOT NULL CHECK (status IN ('ATTENDING', 'NOT_ATTENDING')),
  note        TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (event_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_ff_event_rsvp_event ON ff_event_rsvp (event_id);
CREATE INDEX IF NOT EXISTS idx_ff_event_rsvp_user  ON ff_event_rsvp (user_id);
