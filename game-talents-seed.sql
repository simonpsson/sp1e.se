-- ─── Talent Seed Data ─────────────────────────────────────────────────────────
-- Run AFTER game-talents-schema.sql.
-- Safe to re-run (INSERT OR REPLACE).
--
--   npx wrangler d1 execute sp1e-db --remote --file=game-talents-seed.sql

-- CORE TREE (15 talents)
INSERT OR REPLACE INTO game_talents VALUES
('core-t1-endurance','core',1,'Uthållighet','Max energy +10 per rank','passive','{"max_energy":10}',NULL,3,1),
('core-t1-toughness','core',1,'Härdad','Max HP +20 per rank','passive','{"max_hp":20}',NULL,3,2),
('core-t1-hustle','core',1,'Hustle','XP +10% per rank','passive','{"xp_mult":0.10}',NULL,3,3),
('core-t1-streetwise','core',1,'Gatusmart','All actions cost 1 less energy','passive','{"energy_cost_all":-1}',NULL,1,4),
('core-t2-regen','core',2,'Snabb Återhämtning','Energy regen 2x faster','passive','{"energy_regen_mult":2}','["core-t1-endurance"]',1,5),
('core-t2-bankroll','core',2,'Bankrulle','Bank takes 0% fee','passive','{"bank_fee":0}','["core-t1-hustle"]',1,6),
('core-t2-resilience','core',2,'Motståndskraft','Prison and hospital time -25%','passive','{"prison_time_mult":0.75,"hospital_time_mult":0.75}','["core-t1-toughness"]',1,7),
('core-t2-lucky','core',2,'Tur','All RNG rolls +5% per rank','passive','{"luck":0.05}','["core-t1-streetwise"]',2,8),
('core-t2-quickfingers','core',2,'Kvicka Fingrar','All cooldowns -20%','passive','{"cooldown_mult":0.80}','["core-t1-streetwise"]',1,9),
('core-t3-survivor','core',3,'Överlevare','Survive knockout 1x per 24h (stay at 1 HP)','passive','{"death_save_daily":1}','["core-t2-resilience"]',1,10),
('core-t3-opportunist','core',3,'Opportunist','25% chance for bonus loot after robbery','passive','{"bonus_loot_chance":0.25}','["core-t2-lucky"]',1,11),
('core-t3-efficiency','core',3,'Effektivitet','Every 5th action costs 0 energy','passive','{"free_action_every":5}','["core-t2-regen"]',1,12),
('core-t3-investor','core',3,'Investerare','Bank generates 1% daily interest (max 10000/day)','passive','{"bank_interest_pct":0.01,"bank_interest_cap":10000}','["core-t2-bankroll"]',1,13),
('core-t4-ironwill','core',4,'Järnvilja','Cannot be knocked out by NPCs. Prison time halved. TRADE-OFF: Cannot flee from fights.','keystone','{"npc_knockout_immune":true,"prison_time_mult":0.5,"flee_disabled":true}','["core-t3-survivor"]',1,14),
('core-t4-mastermind','core',4,'Strategen','See NPC plans. +1 extra talent point per 5 levels. TRADE-OFF: All actions cost +2 energy.','keystone','{"see_npc_plans":true,"bonus_tp_per_5_levels":1,"energy_cost_all":2}','["core-t3-efficiency"]',1,15);

-- RÅNARE TREE (13 talents)
INSERT OR REPLACE INTO game_talents VALUES
('rob-t1-quickhands','ranare',1,'Snabba Händer','Robbery cash +15% per rank','passive','{"robbery_cash_mult":0.15}',NULL,3,1),
('rob-t1-casing','ranare',1,'Spaning','See exact success% and loot table on all robberies','unlock','{"robbery_show_exact":true}',NULL,1,2),
('rob-t1-getaway','ranare',1,'Flyktväg','Caught chance -15% per rank','passive','{"robbery_caught_reduction":0.15}',NULL,2,3),
('rob-t1-nerves','ranare',1,'Kalla Nerver','Robbery success +8% per rank','passive','{"robbery_success_bonus":0.08}',NULL,2,4),
('rob-t2-safecracker','ranare',2,'Kassaskåpsknäckare','Unlock Bank Vault robbery (50k-200k, 20% base)','unlock','{"unlock_robbery_vault":true}','["rob-t1-quickhands"]',1,5),
('rob-t2-adrenaline','ranare',2,'Adrenalinkick','Successful robberies refund +5 energy','passive','{"robbery_energy_refund":5}','["rob-t1-nerves"]',1,6),
('rob-t2-mule','ranare',2,'Lastdjuret','Inventory capacity x2','passive','{"inventory_mult":2}','["rob-t1-casing"]',1,7),
('rob-t2-shadow','ranare',2,'I Skuggorna','Prison time halved. +20% escape chance.','passive','{"prison_time_mult":0.5,"prison_escape_bonus":0.20}','["rob-t1-getaway"]',1,8),
('rob-t3-heist','ranare',3,'Kuppen','Once per day: perfect robbery (100% success, 3x cash, guaranteed rare+ loot)','unlock','{"daily_perfect_robbery":true}','["rob-t2-safecracker"]',1,9),
('rob-t3-phantom','ranare',3,'Fantomen','40% chance to avoid prison entirely on failed robbery','passive','{"robbery_prison_dodge":0.40}','["rob-t2-shadow"]',1,10),
('rob-t3-looter','ranare',3,'Plundrare','All loot rolls upgrade 1 tier','passive','{"loot_tier_bonus":1}','["rob-t2-mule"]',1,11),
('rob-t3-chain','ranare',3,'Kedjerån','3 successful robberies in a row: next gives 5x cash and 0 energy','unlock','{"chain_robbery_mult":5,"chain_robbery_threshold":3}','["rob-t2-adrenaline"]',1,12),
('rob-t4-kingpin','ranare',4,'Mästerrånaren','Unlock Federal Reserve Heist (500k-2M). All robbery energy -50%. TRADE-OFF: Cannot buy properties.','keystone','{"unlock_robbery_federal":true,"robbery_energy_mult":0.5,"properties_disabled":true}','["rob-t3-heist"]',1,13);
