-- Adds persisted Texas Hold 'Em table state for Mosquito Casino.
-- Run on an existing database that already has the main game tables.
--
-- Remote:
--   npx wrangler d1 execute sp1e-db --remote --file=game-migration-holdem.sql
--
-- Local:
--   npx wrangler d1 execute sp1e-db --local --file=game-migration-holdem.sql

CREATE TABLE IF NOT EXISTS game_holdem_tables (
  id          TEXT PRIMARY KEY,
  player_id   TEXT NOT NULL UNIQUE,
  round_id    TEXT NOT NULL,
  buy_in      INTEGER NOT NULL,
  small_blind INTEGER NOT NULL DEFAULT 50,
  big_blind   INTEGER NOT NULL DEFAULT 100,
  status      TEXT NOT NULL DEFAULT 'active',
  state_json  TEXT NOT NULL,
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (player_id) REFERENCES game_players(id),
  FOREIGN KEY (round_id) REFERENCES game_rounds(id)
);

CREATE INDEX IF NOT EXISTS idx_game_holdem_round ON game_holdem_tables (round_id);
