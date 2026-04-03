-- sp1e.se Mosquito — Blackjack migration
-- Run on an existing Mosquito database to add persistent Blackjack hand state.
-- Remote:
--   npx wrangler d1 execute sp1e-db --remote --file=game-migration-blackjack.sql
-- Local:
--   npx wrangler d1 execute sp1e-db --local  --file=game-migration-blackjack.sql

CREATE TABLE IF NOT EXISTS game_blackjack_hands (
  id          TEXT PRIMARY KEY,
  player_id   TEXT NOT NULL UNIQUE,
  round_id    TEXT NOT NULL,
  bet         INTEGER NOT NULL,
  deck_state  TEXT NOT NULL,
  player_hand TEXT NOT NULL,
  dealer_hand TEXT NOT NULL,
  state       TEXT NOT NULL DEFAULT 'player_turn',
  result      TEXT,
  message     TEXT,
  doubled     INTEGER DEFAULT 0,
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (player_id) REFERENCES game_players(id),
  FOREIGN KEY (round_id) REFERENCES game_rounds(id)
);

CREATE INDEX IF NOT EXISTS idx_game_blackjack_round ON game_blackjack_hands (round_id);
