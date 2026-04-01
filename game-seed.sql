-- sp1e.se Mosquito — seed game data
-- Run AFTER game-schema.sql:
-- npx wrangler d1 execute sp1e-db --remote --file=game-seed.sql

-- ─── Active round 1 ──────────────────────────────────────────────────────────

INSERT OR IGNORE INTO game_rounds (id, round_number, start_date, end_date, is_active)
VALUES (
  'round-001',
  1,
  date('now'),
  date('now', '+30 days'),
  1
);

-- ─── 20 NPC rivals ───────────────────────────────────────────────────────────

INSERT OR IGNORE INTO game_npcs (id, round_id, name, level, respect, strength, cash, side, personality, is_alive) VALUES
  ('npc-01', 'round-001', 'Knansen',       3,   120,  22, 800,   'eastside',  'aggressive', 1),
  ('npc-02', 'round-001', 'Räkansen',      1,    30,  12, 200,   'westside',  'passive',    1),
  ('npc-03', 'round-001', 'Smulansen',     7,   580,  45, 4200,  'eastside',  'aggressive', 1),
  ('npc-04', 'round-001', 'Löansen',       2,    75,  15, 400,   'westside',  'defensive',  1),
  ('npc-05', 'round-001', 'Kansen',        5,   300,  35, 2000,  'eastside',  'trader',     1),
  ('npc-06', 'round-001', 'Fansen',        4,   200,  28, 1200,  'westside',  'passive',    1),
  ('npc-07', 'round-001', 'Blansen',      10,  1200,  62, 9000,  'eastside',  'aggressive', 1),
  ('npc-08', 'round-001', 'Jansen',        2,    50,  14, 300,   'westside',  'defensive',  1),
  ('npc-09', 'round-001', 'Dransen',       8,   820,  52, 6000,  'westside',  'aggressive', 1),
  ('npc-10', 'round-001', 'Spansen',       6,   450,  38, 3000,  'eastside',  'trader',     1),
  ('npc-11', 'round-001', 'Muransen',      1,    20,  10, 150,   'westside',  'passive',    1),
  ('npc-12', 'round-001', 'Plansen',       9,  1050,  58, 7500,  'eastside',  'aggressive', 1),
  ('npc-13', 'round-001', 'Gransen',       3,   110,  20, 700,   'westside',  'defensive',  1),
  ('npc-14', 'round-001', 'Vransen',      12,  2100,  72, 15000, 'eastside',  'aggressive', 1),
  ('npc-15', 'round-001', 'Skansen',       4,   190,  26, 1100,  'westside',  'trader',     1),
  ('npc-16', 'round-001', 'Tansen',        2,    60,  13, 250,   'eastside',  'passive',    1),
  ('npc-17', 'round-001', 'Klansen',      15,  3500,  85, 28000, 'westside',  'aggressive', 1),
  ('npc-18', 'round-001', 'Nansen',        6,   420,  36, 2800,  'eastside',  'defensive',  1),
  ('npc-19', 'round-001', 'Transen',      11,  1800,  68, 12000, 'westside',  'aggressive', 1),
  ('npc-20', 'round-001', 'Snansen',       7,   600,  44, 4500,  'eastside',  'trader',     1);
