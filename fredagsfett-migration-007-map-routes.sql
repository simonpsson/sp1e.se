-- Fredagsfett v7: server-side persisted map routes shared across the group.
-- Replaces the localStorage-only storage that shipped with /fredagsfett/karta
-- so every member sees the same routes from any device.
--
-- Remote:
--   npx wrangler d1 execute sp1e-db --remote --file=fredagsfett-migration-007-map-routes.sql
-- Local:
--   npx wrangler d1 execute sp1e-db --local --file=fredagsfett-migration-007-map-routes.sql

CREATE TABLE IF NOT EXISTS ff_map_routes (
  id          TEXT PRIMARY KEY,
  group_id    TEXT NOT NULL REFERENCES ff_groups(id) ON DELETE CASCADE,
  user_id     TEXT REFERENCES ff_users(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  geojson     TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_ff_map_routes_group_created ON ff_map_routes (group_id, created_at DESC);
