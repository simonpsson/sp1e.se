-- Adds persisted Roulette spin history for Mosquito Casino.
-- Run on an existing database that already has the main game tables.
--
-- Remote:
--   npx wrangler d1 execute sp1e-db --remote --file=game-migration-roulette.sql
--
-- Local:
--   npx wrangler d1 execute sp1e-db --local --file=game-migration-roulette.sql

CREATE TABLE IF NOT EXISTS game_roulette_spins (
  id             TEXT PRIMARY KEY,
  player_id      TEXT NOT NULL,
  round_id       TEXT NOT NULL,
  winning_number INTEGER NOT NULL,
  color          TEXT NOT NULL,
  total_stake    INTEGER NOT NULL,
  total_payout   INTEGER NOT NULL,
  net_result     INTEGER NOT NULL,
  bets_json      TEXT NOT NULL,
  created_at     TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (player_id) REFERENCES game_players(id),
  FOREIGN KEY (round_id) REFERENCES game_rounds(id)
);

CREATE INDEX IF NOT EXISTS idx_game_roulette_player_created ON game_roulette_spins (player_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_game_roulette_round ON game_roulette_spins (round_id);
