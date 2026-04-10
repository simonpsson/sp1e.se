-- sp1e.se Mosquito — game tables
-- Run: npx wrangler d1 execute sp1e-db --remote --file=game-schema.sql
-- Local: npx wrangler d1 execute sp1e-db --local  --file=game-schema.sql

-- ─── Rounds ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS game_rounds (
  id           TEXT    PRIMARY KEY,
  round_number INTEGER NOT NULL,
  start_date   TEXT    NOT NULL,
  end_date     TEXT    NOT NULL,
  is_active    INTEGER DEFAULT 1,
  created_at   TEXT    DEFAULT (datetime('now'))
);

-- ─── Players ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS game_players (
  id           TEXT    PRIMARY KEY,
  round_id     TEXT    NOT NULL,
  name         TEXT    NOT NULL,
  level        INTEGER DEFAULT 1,
  xp           INTEGER DEFAULT 0,
  cash         INTEGER DEFAULT 500,
  bank         INTEGER DEFAULT 0,
  respect      INTEGER DEFAULT 0,

  -- Stats (0-100)
  strength     INTEGER DEFAULT 10,
  intelligence INTEGER DEFAULT 10,
  charisma     INTEGER DEFAULT 10,
  stealth      INTEGER DEFAULT 10,

  -- Combat
  hp           INTEGER DEFAULT 100,
  hp_max       INTEGER DEFAULT 100,

  -- Energy (replenishes 1/3min)
  energy          INTEGER DEFAULT 100,
  energy_max      INTEGER DEFAULT 100,
  energy_last_regen TEXT   DEFAULT (datetime('now')),

  -- Profession: rånare, langare, torped, hallick, bedragare
  profession   TEXT    DEFAULT 'none',

  -- Side
  side         TEXT    DEFAULT 'eastside',

  -- Status flags
  in_prison    INTEGER DEFAULT 0,
  prison_until TEXT,
  in_hospital  INTEGER DEFAULT 0,
  hospital_until TEXT,
  is_alive     INTEGER DEFAULT 1,

  last_action  TEXT    DEFAULT (datetime('now')),
  created_at   TEXT    DEFAULT (datetime('now')),
  account_id   TEXT    REFERENCES game_accounts(id),

  FOREIGN KEY (round_id) REFERENCES game_rounds(id)
);

CREATE INDEX        IF NOT EXISTS idx_game_players_round   ON game_players (round_id);
CREATE INDEX        IF NOT EXISTS idx_game_players_respect ON game_players (respect DESC);
-- Names unique within a round only (different rounds can reuse the same name)
CREATE UNIQUE INDEX IF NOT EXISTS idx_game_players_name_round ON game_players (name, round_id);

-- ─── Inventory ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS game_inventory (
  id          TEXT    PRIMARY KEY,
  player_id   TEXT    NOT NULL,
  item_type   TEXT    NOT NULL,  -- weapon, drug, vehicle, armor, tool
  item_name   TEXT    NOT NULL,
  quantity    INTEGER DEFAULT 1,
  buy_price   INTEGER,
  properties  TEXT,              -- JSON: {"damage":15,"accuracy":80}
  item_tier   INTEGER DEFAULT 1,
  equipped    INTEGER DEFAULT 0,
  slot        TEXT,
  sell_price  INTEGER DEFAULT 0,
  effects     TEXT,
  source      TEXT,
  created_at  TEXT    DEFAULT (datetime('now')),
  FOREIGN KEY (player_id) REFERENCES game_players(id)
);

CREATE INDEX IF NOT EXISTS idx_game_inv_player      ON game_inventory (player_id);
CREATE INDEX IF NOT EXISTS idx_game_inventory_player_slot ON game_inventory (player_id, slot);

-- ─── Properties ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS game_properties (
  id               TEXT    PRIMARY KEY,
  player_id        TEXT    NOT NULL,
  property_type    TEXT    NOT NULL,  -- stash_house, nightclub, drug_lab, garage, safehouse
  property_name    TEXT    NOT NULL,
  level            INTEGER DEFAULT 1,
  income_per_hour  INTEGER DEFAULT 0,
  last_collected   TEXT    DEFAULT (datetime('now')),
  created_at       TEXT    DEFAULT (datetime('now')),
  FOREIGN KEY (player_id) REFERENCES game_players(id)
);

CREATE INDEX IF NOT EXISTS idx_game_props_player ON game_properties (player_id);

-- ─── NPCs ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS game_npcs (
  id                 TEXT    PRIMARY KEY,
  round_id           TEXT    NOT NULL,
  name               TEXT    NOT NULL,
  level              INTEGER DEFAULT 1,
  respect            INTEGER DEFAULT 0,
  strength           INTEGER DEFAULT 10,
  cash               INTEGER DEFAULT 100,
  hp                 INTEGER DEFAULT 50,
  side               TEXT    DEFAULT 'eastside',
  personality        TEXT,  -- aggressive, defensive, trader, passive, brawler, schemer, cautious
  is_alive           INTEGER DEFAULT 1,
  npc_weapon         TEXT,
  relation_to_player INTEGER DEFAULT 50,
  last_action_at     DATETIME,
  FOREIGN KEY (round_id) REFERENCES game_rounds(id)
);

CREATE INDEX IF NOT EXISTS idx_game_npcs_round ON game_npcs (round_id);

-- ─── Action log ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS game_action_log (
  id             TEXT    PRIMARY KEY,
  player_id      TEXT    NOT NULL,
  action_type    TEXT    NOT NULL,  -- robbery, assault, drug_deal, training, property, streetrace
  description    TEXT,
  cash_change    INTEGER DEFAULT 0,
  respect_change INTEGER DEFAULT 0,
  xp_change      INTEGER DEFAULT 0,
  success        INTEGER DEFAULT 1,
  created_at     TEXT    DEFAULT (datetime('now')),
  FOREIGN KEY (player_id) REFERENCES game_players(id)
);

CREATE INDEX IF NOT EXISTS idx_game_log_player  ON game_action_log (player_id);
CREATE INDEX IF NOT EXISTS idx_game_log_created ON game_action_log (created_at DESC);

-- ─── Leaderboard (Hall of Fame) ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS game_leaderboard (
  id            TEXT    PRIMARY KEY,
  round_id      TEXT    NOT NULL,
  round_number  INTEGER NOT NULL,
  player_name   TEXT    NOT NULL,
  final_respect INTEGER NOT NULL,
  final_level   INTEGER,
  final_cash    INTEGER,
  profession    TEXT,
  side          TEXT,
  rank          INTEGER,
  created_at    TEXT    DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_game_lb_round ON game_leaderboard (round_id);

-- ─── Assault cooldowns ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS game_assault_cooldowns (
  attacker_id TEXT NOT NULL,
  target_id   TEXT NOT NULL,
  attacked_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (attacker_id, target_id)
);

-- ─── Admin sessions & audit ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS game_blackjack_hands (
  id            TEXT PRIMARY KEY,
  player_id     TEXT NOT NULL UNIQUE,
  round_id      TEXT NOT NULL,
  bet           INTEGER NOT NULL,
  base_bet      INTEGER DEFAULT 0,
  deck_state    TEXT NOT NULL,
  player_hand   TEXT NOT NULL,
  dealer_hand   TEXT NOT NULL,
  state         TEXT NOT NULL DEFAULT 'player_turn',
  result        TEXT,
  message       TEXT,
  doubled       INTEGER DEFAULT 0,
  split_hand    TEXT,
  split_bet     INTEGER DEFAULT 0,
  split_result  TEXT,
  split_doubled INTEGER DEFAULT 0,
  insurance_bet INTEGER DEFAULT 0,
  created_at    TEXT DEFAULT (datetime('now')),
  updated_at    TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (player_id) REFERENCES game_players(id),
  FOREIGN KEY (round_id) REFERENCES game_rounds(id)
);

CREATE INDEX IF NOT EXISTS idx_game_blackjack_round ON game_blackjack_hands (round_id);

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

CREATE TABLE IF NOT EXISTS game_roulette_spins (
  id            TEXT PRIMARY KEY,
  player_id     TEXT NOT NULL,
  round_id      TEXT NOT NULL,
  winning_number INTEGER NOT NULL,
  color         TEXT NOT NULL,
  total_stake   INTEGER NOT NULL,
  total_payout  INTEGER NOT NULL,
  net_result    INTEGER NOT NULL,
  bets_json     TEXT NOT NULL,
  created_at    TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (player_id) REFERENCES game_players(id),
  FOREIGN KEY (round_id) REFERENCES game_rounds(id)
);

CREATE INDEX IF NOT EXISTS idx_game_roulette_player_created ON game_roulette_spins (player_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_game_roulette_round ON game_roulette_spins (round_id);

CREATE TABLE IF NOT EXISTS game_admin_sessions (
  token      TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_game_admin_sessions_expires ON game_admin_sessions (expires_at);

CREATE TABLE IF NOT EXISTS game_admin_audit (
  id         TEXT PRIMARY KEY,
  player_id  TEXT,
  player_name TEXT,
  command    TEXT NOT NULL,
  outcome    TEXT NOT NULL,
  details    TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_game_admin_audit_created ON game_admin_audit (created_at DESC);

-- ─── Quests ──────────────────────────────────────────────────────────────────

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
  status          TEXT DEFAULT 'pending',  -- pending/accepted/rejected/completed
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at      DATETIME,
  completed_at    DATETIME
);

CREATE INDEX IF NOT EXISTS idx_game_quests_player ON game_quests (player_id, status);

-- ─── Asset registry ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS game_assets (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  category   TEXT NOT NULL,   -- weapon, action, status, ui, misc
  tags       TEXT,            -- JSON array of tags
  file_path  TEXT NOT NULL UNIQUE,
  web_path   TEXT NOT NULL,   -- /assets/icons/filename.png
  format     TEXT NOT NULL,   -- png, svg, webp
  width      INTEGER,
  height     INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_game_assets_category ON game_assets (category);

-- ─── Account system ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS game_accounts (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  is_admin      INTEGER DEFAULT 0,
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_game_accounts_email ON game_accounts (email);

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

-- Add account_id to game_players (run once on existing databases):
-- ALTER TABLE game_players ADD COLUMN account_id TEXT REFERENCES game_accounts(id);
