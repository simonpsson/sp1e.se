-- sp1e.se Mosquito — schema migrations
-- Run AFTER game-schema.sql when upgrading an existing database.
-- Each statement is safe to re-run ONLY if the described state is not yet present.
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
