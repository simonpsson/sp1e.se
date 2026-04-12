-- ─── Talent Tree Schema v2 ─────────────────────────────────────────────────────
-- Run AFTER game-schema.sql.
--
--   npx wrangler d1 execute sp1e-db --remote --file=game-talents-schema.sql
--
-- All ALTER TABLE statements fail silently if column already exists.

-- Available talent points (pool; granted on level-up, spent on unlock)
ALTER TABLE game_players ADD COLUMN talent_points INTEGER DEFAULT 0;
-- Denormalized: extra points per level-up from prodigy/mastermind talents
ALTER TABLE game_players ADD COLUMN talent_points_level_bonus INTEGER DEFAULT 0;

-- Daily / streak tracking columns
ALTER TABLE game_players ADD COLUMN last_heist_at TEXT;
ALTER TABLE game_players ADD COLUMN robbery_streak INTEGER DEFAULT 0;
ALTER TABLE game_players ADD COLUMN last_passive_drug_collect TEXT;
ALTER TABLE game_players ADD COLUMN last_extortion_collect TEXT;
ALTER TABLE game_players ADD COLUMN last_survivor_used_at TEXT;
ALTER TABLE game_players ADD COLUMN last_impersonate_at TEXT;
ALTER TABLE game_players ADD COLUMN impersonate_profession TEXT;

-- Grant initial talent points to existing players (retroactive; skipped if already > 0)
UPDATE game_players SET talent_points = MAX(0, level - 1) WHERE talent_points = 0 AND level > 1;

-- ─── Talent definitions ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS game_talents (
  id           TEXT    PRIMARY KEY,
  tree         TEXT    NOT NULL,    -- 'ranare','langare','torped','hallick','bedragare','core'
  tier         INTEGER NOT NULL,    -- 1, 2, 3, 4 (4 = capstone)
  name         TEXT    NOT NULL,
  description  TEXT    NOT NULL,
  talent_type  TEXT    NOT NULL,    -- 'passive','unlock','keystone'
  icon         TEXT    DEFAULT '',
  effects      TEXT    NOT NULL DEFAULT '{}',
  prerequisites TEXT   DEFAULT '[]',
  max_rank     INTEGER DEFAULT 1,
  sort_order   INTEGER DEFAULT 0
);

-- ─── Player talent unlocks ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS game_player_talents (
  id           TEXT PRIMARY KEY,
  player_id    TEXT NOT NULL,
  talent_id    TEXT NOT NULL,
  current_rank INTEGER DEFAULT 1,
  unlocked_at  TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (player_id) REFERENCES game_players(id),
  FOREIGN KEY (talent_id) REFERENCES game_talents(id),
  UNIQUE(player_id, talent_id)
);

-- ─── Extortion relationships (Hallick tree) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS game_extortions (
  id              TEXT PRIMARY KEY,
  player_id       TEXT NOT NULL,
  npc_id          TEXT NOT NULL,
  income_per_hour INTEGER DEFAULT 500,
  started_at      TEXT DEFAULT (datetime('now')),
  UNIQUE(player_id, npc_id),
  FOREIGN KEY (player_id) REFERENCES game_players(id)
);

CREATE INDEX IF NOT EXISTS idx_gpt_player   ON game_player_talents(player_id);
CREATE INDEX IF NOT EXISTS idx_gt_tree_tier ON game_talents(tree, tier, sort_order);
CREATE INDEX IF NOT EXISTS idx_gext_player  ON game_extortions(player_id);
