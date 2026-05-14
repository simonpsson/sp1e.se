-- Fredagsfett v5: per-event item checklist (who brings what), per-event
-- photo gallery, and per-event Spotify playlist URL.
-- Run after fredagsfett-migration-004-event-comments-and-tagging.sql.
--
-- Remote:
--   npx wrangler d1 execute sp1e-db --remote --file=fredagsfett-migration-005-event-extras.sql
-- Local:
--   npx wrangler d1 execute sp1e-db --local --file=fredagsfett-migration-005-event-extras.sql

-- B2 — claimable items per locked event (mat, vin, snacks, spel, …)
CREATE TABLE IF NOT EXISTS ff_event_items (
  id          TEXT PRIMARY KEY,
  event_id    TEXT NOT NULL REFERENCES ff_events(id) ON DELETE CASCADE,
  label       TEXT NOT NULL,
  claimed_by  TEXT REFERENCES ff_users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ff_event_items_event ON ff_event_items (event_id);

-- B5 — per-event photo gallery. r2_key is set when stored in R2 (preferred);
-- data is the base64 fallback for tiny uploads when R2 is unavailable
-- (mirrors the pattern used by the main /api/files endpoint).
CREATE TABLE IF NOT EXISTS ff_event_photos (
  id            TEXT PRIMARY KEY,
  event_id      TEXT NOT NULL REFERENCES ff_events(id) ON DELETE CASCADE,
  uploader_id   TEXT REFERENCES ff_users(id) ON DELETE SET NULL,
  r2_key        TEXT,
  data          TEXT,
  content_type  TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ff_event_photos_event ON ff_event_photos (event_id, created_at);

-- B6 — Spotify playlist URL per event
ALTER TABLE ff_events ADD COLUMN spotify_url TEXT;
