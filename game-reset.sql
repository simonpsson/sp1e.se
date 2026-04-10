-- sp1e.se Mosquito — full round reset
-- WARNING: Wipes all player and game data. Run in D1 console:
-- npx wrangler d1 execute sp1e-db --remote --file=game-reset.sql

DELETE FROM game_action_log;
DELETE FROM game_inventory;
DELETE FROM game_properties;
DELETE FROM game_quests;
DELETE FROM game_npcs;
DELETE FROM game_players;
DELETE FROM game_rounds;
DELETE FROM game_leaderboard;

-- ─── Fresh round 1 ───────────────────────────────────────────────────────────

INSERT INTO game_rounds (id, round_number, start_date, end_date, is_active)
VALUES ('round-001', 1, datetime('now'), datetime('now', '+30 days'), 1);

-- ─── 20 NPC rivals ───────────────────────────────────────────────────────────

INSERT INTO game_npcs (id, round_id, name, level, respect, strength, cash, side, personality, is_alive) VALUES
  ('npc-01', 'round-001', 'Ronny "Vargen" Pettersson',  12,  8500, 45, 35000, 'westside', 'aggressive', 1),
  ('npc-02', 'round-001', 'Conny "Kulan" Karlsson',     10,  6200, 38, 22000, 'westside', 'brawler',    1),
  ('npc-03', 'round-001', 'Lill-Mange',                  8,  4100, 30, 15000, 'westside', 'cautious',   1),
  ('npc-04', 'round-001', 'Glenn "Järnet" Andersson',   15, 12000, 55, 80000, 'westside', 'aggressive', 1),
  ('npc-05', 'round-001', 'Roger "Blixten" Svensson',   11,  7300, 42, 28000, 'westside', 'schemer',    1),
  ('npc-06', 'round-001', 'Sigge "Räven" Larsson',       9,  5000, 35, 18000, 'westside', 'trader',     1),
  ('npc-07', 'round-001', 'Robban "Kranen" Lindström',  13,  9800, 50, 45000, 'eastside', 'brawler',    1),
  ('npc-08', 'round-001', 'Micke "Boxarn" Nilsson',     14, 11000, 52, 55000, 'eastside', 'aggressive', 1),
  ('npc-09', 'round-001', 'Bosse "Fimpen" Holm',         7,  3200, 28, 12000, 'westside', 'cautious',   1),
  ('npc-10', 'round-001', 'Kenneth "Smilen" Berglund',  10,  6500, 40, 25000, 'westside', 'schemer',    1),
  ('npc-11', 'round-001', 'Amir "Skuggan"',             16, 14000, 58, 95000, 'eastside', 'aggressive', 1),
  ('npc-12', 'round-001', 'Hassan "Kniven" Jönsson',    13,  9500, 48, 42000, 'eastside', 'brawler',    1),
  ('npc-13', 'round-001', 'Rico "Turbo" Wallin',        11,  7800, 44, 30000, 'eastside', 'trader',     1),
  ('npc-14', 'round-001', 'Milan "Pantern" Lundberg',   15, 13000, 56, 75000, 'eastside', 'aggressive', 1),
  ('npc-15', 'round-001', 'Alex "Baxarn" Ekström',       9,  4800, 34, 16000, 'eastside', 'schemer',    1),
  ('npc-16', 'round-001', 'Bella "Kobran" Dahlberg',    12,  8800, 46, 38000, 'eastside', 'aggressive', 1),
  ('npc-17', 'round-001', 'Sussan "Mörkret" Holmberg',  10,  6000, 36, 20000, 'westside', 'cautious',   1),
  ('npc-18', 'round-001', 'Nadia "Duvan" Söderberg',     8,  4500, 32, 14000, 'eastside', 'trader',     1),
  ('npc-19', 'round-001', 'Maggan "Tassen" Nyström',    11,  7100, 41, 26000, 'westside', 'schemer',    1),
  ('npc-20', 'round-001', 'Leila "Stålet" Forsberg',    14, 10500, 53, 60000, 'eastside', 'brawler',    1);
