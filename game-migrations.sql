-- sp1e.se Mosquito - schema migrations
-- Run AFTER game-schema.sql when upgrading an existing database.
-- Each statement is safe to re-run ONLY if the described state is not yet present.
-- Some early statements are intentionally one-time migrations and will fail if rerun
-- against a database that already contains those changes.
-- For dedicated upgrades on an existing DB, prefer the specific migration files when available.
-- Check current schema first:
--   npx wrangler d1 execute sp1e-db --remote --command="PRAGMA table_info(game_npcs);"

-- Migration 1: Add hp column to game_npcs
-- Run only if `hp` column is absent from PRAGMA table_info(game_npcs).
ALTER TABLE game_npcs ADD COLUMN hp INTEGER DEFAULT 50;

-- Migration 2: Relax global name uniqueness on game_players
-- SQLite cannot drop a column constraint without rebuilding the table.
-- The global UNIQUE index is named sqlite_autoindex_game_players_1 internally.
-- Safest path: rebuild the table. Only needed if you want cross-round name reuse.
-- The composite unique index below is additive and safe to run any time:
CREATE UNIQUE INDEX IF NOT EXISTS idx_game_players_name_round ON game_players (name, round_id);

-- Migration 3: Add admin session + audit tables
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

-- Migration 4: Add blackjack hand persistence
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

-- Migration 5: Add Hold 'Em table persistence
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

-- Migration 6: Loot system - extend game_inventory
ALTER TABLE game_inventory ADD COLUMN item_tier  INTEGER DEFAULT 1;
ALTER TABLE game_inventory ADD COLUMN equipped   INTEGER DEFAULT 0;
ALTER TABLE game_inventory ADD COLUMN slot       TEXT;
ALTER TABLE game_inventory ADD COLUMN sell_price INTEGER DEFAULT 0;
ALTER TABLE game_inventory ADD COLUMN effects    TEXT;
ALTER TABLE game_inventory ADD COLUMN source     TEXT;

CREATE INDEX IF NOT EXISTS idx_game_inventory_player_slot ON game_inventory (player_id, slot);

-- Migration 7: NPC AI - extended NPC fields + quest system
ALTER TABLE game_npcs ADD COLUMN npc_weapon         TEXT;
ALTER TABLE game_npcs ADD COLUMN relation_to_player INTEGER DEFAULT 50;
ALTER TABLE game_npcs ADD COLUMN last_action_at     DATETIME;

CREATE TABLE IF NOT EXISTS game_quests (
  id              TEXT PRIMARY KEY,
  player_id       TEXT NOT NULL,
  round_id        TEXT NOT NULL,
  npc_id          TEXT NOT NULL,
  npc_name        TEXT NOT NULL,
  title           TEXT NOT NULL,
  description     TEXT NOT NULL,
  reward_cash     INTEGER DEFAULT 0,
  reward_respect  INTEGER DEFAULT 0,
  status          TEXT DEFAULT 'pending',
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at      DATETIME,
  completed_at    DATETIME
);

CREATE INDEX IF NOT EXISTS idx_game_quests_player ON game_quests (player_id, status);

-- ─── Migration 8: Add Roulette spin history ───────────────────────────────────
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

-- ─── Migration 9: Blackjack — split + insurance columns ──────────────────────
ALTER TABLE game_blackjack_hands ADD COLUMN base_bet        INTEGER DEFAULT 0;
ALTER TABLE game_blackjack_hands ADD COLUMN split_hand      TEXT;
ALTER TABLE game_blackjack_hands ADD COLUMN split_bet       INTEGER DEFAULT 0;
ALTER TABLE game_blackjack_hands ADD COLUMN split_result    TEXT;
ALTER TABLE game_blackjack_hands ADD COLUMN split_doubled   INTEGER DEFAULT 0;
ALTER TABLE game_blackjack_hands ADD COLUMN insurance_bet   INTEGER DEFAULT 0;

-- ─── Migration 10: Asset registry ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS game_assets (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  category   TEXT NOT NULL,
  tags       TEXT,
  file_path  TEXT NOT NULL UNIQUE,
  web_path   TEXT NOT NULL,
  format     TEXT NOT NULL,
  width      INTEGER,
  height     INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_game_assets_category ON game_assets (category);
