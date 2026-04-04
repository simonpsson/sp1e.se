-- sp1e.se Mosquito — schema migrations
-- Run AFTER game-schema.sql when upgrading an existing database.
-- Each statement is safe to re-run ONLY if the described state is not yet present.
-- Some early statements are intentionally one-time migrations and will fail if rerun
-- against a database that already contains those changes.
-- For the Blackjack rollout on an existing DB, prefer the dedicated file:
--   npx wrangler d1 execute sp1e-db --remote --file=game-migration-blackjack.sql
-- Check current schema first:
--   npx wrangler d1 execute sp1e-db --remote --command="PRAGMA table_info(game_npcs);"

-- ─── Migration 1: Add hp column to game_npcs ─────────────────────────────────
-- Run only if `hp` column is absent from PRAGMA table_info(game_npcs).
ALTER TABLE game_npcs ADD COLUMN hp INTEGER DEFAULT 50;

-- ─── Migration 2: Relax global name uniqueness on game_players ───────────────
-- SQLite cannot drop a column constraint without rebuilding the table.
-- The global UNIQUE index is named sqlite_autoindex_game_players_1 internally.
-- Safest path: rebuild the table.  Only needed if you want cross-round name reuse.
-- The composite unique index below is additive and safe to run any time:
CREATE UNIQUE INDEX IF NOT EXISTS idx_game_players_name_round ON game_players (name, round_id);

-- ─── Migration 3: Add admin session + audit tables ───────────────────────────
CREATE TABLE IF NOT EXISTS game_admin_sessions (
  token      TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_game_admin_sessions_expires ON game_admin_sessions (expires_at);

CREATE TABLE IF NOT EXISTS game_admin_audit (
  id          TEXT PRIMARY KEY,
  player_id   TEXT,
  player_name TEXT,
  command     TEXT NOT NULL,
  outcome     TEXT NOT NULL,
  details     TEXT,
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_game_admin_audit_created ON game_admin_audit (created_at DESC);

-- ─── Migration 4: Add blackjack hand persistence ───────────────────────────
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

-- ─── Migration 5: Add Hold 'Em table persistence ───────────────────────────
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
