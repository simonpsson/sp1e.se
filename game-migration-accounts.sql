-- Migration: Add account system tables (run once on existing databases)
-- Apply via: Cloudflare dashboard → D1 → sp1e-db → Console

-- 1. Account table (email + hashed password)
CREATE TABLE IF NOT EXISTS game_accounts (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  is_admin      INTEGER DEFAULT 0,
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_game_accounts_email ON game_accounts (email);

-- 2. Session tokens (replaces anonymous game_session cookie)
CREATE TABLE IF NOT EXISTS game_sessions (
  token      TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  player_id  TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  FOREIGN KEY (account_id) REFERENCES game_accounts(id),
  FOREIGN KEY (player_id)  REFERENCES game_players(id)
);

CREATE INDEX IF NOT EXISTS idx_game_sessions_account  ON game_sessions (account_id);
CREATE INDEX IF NOT EXISTS idx_game_sessions_expires  ON game_sessions (expires_at);

-- 3. Link players to accounts (add column to existing table)
ALTER TABLE game_players ADD COLUMN account_id TEXT REFERENCES game_accounts(id);
