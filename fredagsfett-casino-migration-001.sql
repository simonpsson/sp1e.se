-- Fredagsfett Casino migration scaffold 001.
--
-- Goal:
--   Prepare a safe bridge between Fredagsfett auth/devices and the existing
--   Mosquito Casino game tables without dropping, renaming, or rewriting any
--   existing game_* data.
--
-- Table strategy:
--   Reuse existing game_* tables for casino runtime state:
--     game_players
--     game_blackjack_hands
--     game_roulette_spins
--     game_holdem_tables
--     game_action_log
--     game_accounts / game_sessions, if the Mosquito account flow remains active.
--
--   Fredagsfett owns identity through ff_users, ff_devices and ff_session.
--   This bridge links a Fredagsfett user/device to one Mosquito game_player.
--
-- Preservation:
--   If Mosquito player money and history should be preserved, create rows in
--   ff_casino_player_links that point at the existing game_player_id instead of
--   creating new game_players. Do not mutate historical game_action_log rows.
--
-- First-visit creation:
--   The eventual /api/fredagsfett/casino bootstrap handler can create a
--   game_player on first visit, then insert a bridge row here in the same
--   logical flow. That handler should run behind Fredagsfett middleware.

CREATE TABLE IF NOT EXISTS ff_casino_player_links (
  id             TEXT PRIMARY KEY,
  ff_user_id     TEXT REFERENCES ff_users(id) ON DELETE SET NULL,
  ff_device_id   TEXT REFERENCES ff_devices(id) ON DELETE SET NULL,
  game_player_id TEXT NOT NULL REFERENCES game_players(id) ON DELETE CASCADE,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (ff_user_id IS NOT NULL OR ff_device_id IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ff_casino_links_user
  ON ff_casino_player_links (ff_user_id)
  WHERE ff_user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ff_casino_links_device
  ON ff_casino_player_links (ff_device_id)
  WHERE ff_device_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ff_casino_links_game_player
  ON ff_casino_player_links (game_player_id);

CREATE INDEX IF NOT EXISTS idx_ff_casino_links_updated
  ON ff_casino_player_links (updated_at DESC);

-- Keep updated_at explicit in the future API wrapper when a link is touched.
-- Avoiding a trigger keeps this scaffold predictable across local SQLite and D1.
