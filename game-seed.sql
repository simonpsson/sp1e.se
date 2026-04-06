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

-- ─── 20 NPC rivals (handpicked names, curated cast) ──────────────────────────
-- Distributed: 10 eastside, 10 westside; mixed levels 1–15

INSERT OR IGNORE INTO game_npcs (id, round_id, name, level, respect, strength, cash, hp, side, personality, is_alive) VALUES
  ('npc-01', 'round-001', 'Amir "Skuggan"',                3,   120,  22,   800,  30, 'eastside',  'aggressive', 1),
  ('npc-02', 'round-001', 'Rico "Turbo" Wallin',           1,    30,  12,   200,  15, 'eastside',  'passive',    1),
  ('npc-03', 'round-001', 'Hassan "Kniven" Jönsson',       7,   580,  45,  4200,  70, 'eastside',  'aggressive', 1),
  ('npc-04', 'round-001', 'Milan "Pantern" Lundberg',      5,   300,  35,  2000,  50, 'eastside',  'trader',     1),
  ('npc-05', 'round-001', 'Alex "Baxarn" Ekström',         4,   200,  28,  1200,  40, 'eastside',  'defensive',  1),
  ('npc-06', 'round-001', 'Kenneth "Smilen" Berglund',     2,    75,  15,   400,  20, 'westside',  'passive',    1),
  ('npc-07', 'round-001', 'Sussan "Mörkret" Holmberg',   10,  1200,  62,  9000, 100, 'eastside',  'aggressive', 1),
  ('npc-08', 'round-001', 'Bella "Kobran" Dahlberg',       6,   450,  38,  3000,  60, 'eastside',  'trader',     1),
  ('npc-09', 'round-001', 'Nadia "Duvan" Söderberg',       9,  1050,  56,  7200,  90, 'eastside',  'defensive',  1),
  ('npc-10', 'round-001', 'Leila "Stålet" Forsberg',      12,  1900,  70, 13000, 120, 'eastside',  'aggressive', 1),
  ('npc-11', 'round-001', 'Ronny "Vargen" Pettersson',     3,   110,  20,   700,  30, 'westside',  'defensive',  1),
  ('npc-12', 'round-001', 'Conny "Kulan" Karlsson',        2,    60,  13,   250,  20, 'westside',  'passive',    1),
  ('npc-13', 'round-001', 'Lill-Mange',                    8,   820,  52,  5800,  80, 'westside',  'aggressive', 1),
  ('npc-14', 'round-001', 'Glenn "Järnet" Andersson',     15,  3400,  83, 26000, 150, 'westside',  'aggressive', 1),
  ('npc-15', 'round-001', 'Roger "Blixten" Svensson',      4,   190,  26,  1100,  40, 'westside',  'trader',     1),
  ('npc-16', 'round-001', 'Sigge "Räven" Larsson',         1,    25,  11,   150,  15, 'westside',  'passive',    1),
  ('npc-17', 'round-001', 'Robban "Kranen" Lindström',     6,   430,  38,  2900,  60, 'westside',  'trader',     1),
  ('npc-18', 'round-001', 'Micke "Boxarn" Nilsson',        7,   580,  44,  4200,  70, 'westside',  'aggressive', 1),
  ('npc-19', 'round-001', 'Bosse "Fimpen" Holm',          11,  1800,  68, 12000, 110, 'westside',  'aggressive', 1),
  ('npc-20', 'round-001', 'Maggan "Tassen" Nyström',       5,   290,  33,  1900,  50, 'westside',  'defensive',  1);
