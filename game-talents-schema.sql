-- ─── Talent Tree Schema ───────────────────────────────────────────────────────
-- Run this AFTER game-schema.sql and game-seed.sql.
--
--   npx wrangler d1 execute sp1e-db --remote --file=game-talents-schema.sql
--
-- Safe to re-run: CREATE TABLE IF NOT EXISTS + ALTER TABLE failure is caught.

-- Add talent_points_spent to existing players (fails silently if already exists)
ALTER TABLE game_players ADD COLUMN talent_points_spent INTEGER DEFAULT 0;

-- talent_points_available is computed: MAX(0, level - 1 - talent_points_spent)

-- ─── Talent definitions (seeded, game-static) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS game_talents (
  id           TEXT    PRIMARY KEY,
  profession   TEXT    NOT NULL,                  -- rånare | langare | torped | hallick | bedragare
  tier         INTEGER NOT NULL,                  -- 1-4
  name         TEXT    NOT NULL,
  description  TEXT    NOT NULL,
  icon         TEXT    DEFAULT '',
  effects      TEXT    NOT NULL DEFAULT '{}',     -- JSON: {"robbery_cash_bonus": 0.10}
  prerequisites TEXT   DEFAULT '[]',             -- JSON: ["talent-id"] or ["talent-id:2"] for min rank 2
  max_rank     INTEGER DEFAULT 1,
  sort_order   INTEGER DEFAULT 0
);

-- ─── Player talent unlocks ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS game_player_talents (
  id           TEXT PRIMARY KEY,
  player_id    TEXT NOT NULL,
  talent_id    TEXT NOT NULL,
  rank         INTEGER DEFAULT 1,
  unlocked_at  TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (player_id) REFERENCES game_players(id),
  FOREIGN KEY (talent_id) REFERENCES game_talents(id),
  UNIQUE(player_id, talent_id)
);

CREATE INDEX IF NOT EXISTS idx_gpt_player   ON game_player_talents(player_id);
CREATE INDEX IF NOT EXISTS idx_gt_prof_tier ON game_talents(profession, tier, sort_order);
