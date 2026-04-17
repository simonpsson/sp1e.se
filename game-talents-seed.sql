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

-- LANGARE TREE (13 talents)
INSERT OR REPLACE INTO game_talents VALUES
('lang-t1-contacts','langare',1,'Kontaktnät','Drug buy price -10% per rank','passive','{"drug_buy_discount":0.10}',NULL,3,1),
('lang-t1-haggle','langare',1,'Förhandlare','Drug sell price +10% per rank','passive','{"drug_sell_bonus":0.10}',NULL,3,2),
('lang-t1-stash','langare',1,'Gömställe','Drug inventory capacity x3','passive','{"drug_capacity_mult":3}',NULL,1,3),
('lang-t1-trends','langare',1,'Marknadsanalys','See exact next price change (time + direction + amount)','unlock','{"drug_show_exact_trend":1}',NULL,1,4),
('lang-t2-wholesale','langare',2,'Grossist','Buying 10+ units gives additional 20% discount','passive','{"drug_bulk_discount":0.20,"drug_bulk_threshold":10}','["lang-t1-contacts"]',1,5),
('lang-t2-distribution','langare',2,'Distributionsnät','Auto-sell 1 drug unit per hour at market price','unlock','{"drug_auto_sell_per_hour":1}','["lang-t1-haggle"]',1,6),
('lang-t2-lab','langare',2,'Eget Labb','Unlock Manufacture Drugs action. Produce at 40% market cost.','unlock','{"unlock_drug_manufacture":1,"manufacture_cost_mult":0.40}','["lang-t1-stash"]',1,7),
('lang-t2-insider','langare',2,'Insidertips','Drug prices fluctuate 2x more (higher peaks and lower valleys)','passive','{"drug_volatility_mult":2}','["lang-t1-trends"]',1,8),
('lang-t3-cartel','langare',3,'Kartellkontakt','Unlock exclusive drug Blue (cost 1000, sells 2000-5000). Only available to you.','unlock','{"unlock_drug_blue":1}','["lang-t2-wholesale"]',1,9),
('lang-t3-empire','langare',3,'Narkotikaimperiet','Auto-sell 5 units/hour. All drugs sell at +15% above market.','passive','{"drug_auto_sell_per_hour":5,"drug_sell_bonus":0.15}','["lang-t2-distribution"]',1,10),
('lang-t3-chemist','langare',3,'Kemisten','Lab produces 2x quantity per manufacture action.','passive','{"manufacture_quantity_mult":2}','["lang-t2-lab"]',1,11),
('lang-t3-manipulation','langare',3,'Marknadsmanipulation','Once per 12h: choose a drug, its price doubles for 2 hours.','unlock','{"market_manipulation_cooldown_hours":12}','["lang-t2-insider"]',1,12),
('lang-t4-narcos','langare',4,'Drogbaronen','All drug profits x3. Auto-sell 10/hour. No level-req on drugs. TRADE-OFF: Cannot do robberies.','keystone','{"drug_profit_mult":3,"drug_auto_sell_per_hour":10,"robberies_disabled":1}','["lang-t3-cartel"]',1,13);

-- TORPED TREE (13 talents)
INSERT OR REPLACE INTO game_talents VALUES
('torp-t1-ironjaw','torped',1,'Järnkäft','Max HP +20 per rank','passive','{"max_hp":20}',NULL,3,1),
('torp-t1-bruteforce','torped',1,'Brutal Kraft','Assault damage +12% per rank','passive','{"assault_damage_mult":0.12}',NULL,3,2),
('torp-t1-intimidate','torped',1,'Skrämseltaktik','Unlock Intimidate action: 60% chance NPC gives 10-30% of cash without fight. 5 energy.','unlock','{"unlock_intimidate":1}',NULL,1,3),
('torp-t1-absorb','torped',1,'Inkassera','Incoming damage -10% per rank','passive','{"damage_reduction":0.10}',NULL,2,4),
('torp-t2-execute','torped',2,'Exekvering','If enemy <25% HP: next attack does 3x damage (guaranteed knockout)','passive','{"execute_threshold":0.25,"execute_damage_mult":3}','["torp-t1-bruteforce"]',1,5),
('torp-t2-berserker','torped',2,'Bärsärk','Below 30% HP: all damage +80%. TRADE-OFF: Cannot use hospital quick-heal.','keystone','{"berserker_threshold":0.30,"berserker_damage_mult":0.80,"hospital_quickheal_disabled":1}','["torp-t1-ironjaw"]',1,6),
('torp-t2-dualwield','torped',2,'Bäst i Närstrid','Melee weapons do 50% more damage.','passive','{"melee_damage_mult":0.50}','["torp-t1-absorb"]',1,7),
('torp-t2-shakedown','torped',2,'Utpressning','After NPC knockout: take ALL their cash + their equipped weapon.','unlock','{"assault_take_all_cash":1,"assault_take_weapon":1}','["torp-t1-intimidate"]',1,8),
('torp-t3-hitman','torped',3,'Professionell Torped','Assault costs 5 energy instead of 15. Cooldown halved.','passive','{"assault_energy_cost":5,"assault_cooldown_mult":0.5}','["torp-t2-execute"]',1,9),
('torp-t3-bloodlust','torped',3,'Blodtörst','Each knockout: +10 HP, +5 energy, +100 respect.','passive','{"knockout_hp_restore":10,"knockout_energy_restore":5,"knockout_respect":100}','["torp-t2-berserker"]',1,10),
('torp-t3-warlord','torped',3,'Krigsherren','Unlock Challenge: fight any NPC regardless of level. Win: +500 respect + their best item. Lose: -20% cash.','unlock','{"unlock_challenge":1}','["torp-t2-shakedown"]',1,11),
('torp-t3-tank','torped',3,'Stridsvagn','Max HP +100. All damage -30%. Cannot be knocked out by lower-level NPCs.','passive','{"max_hp":100,"damage_reduction":0.30,"low_level_immune":1}','["torp-t2-dualwield"]',1,12),
('torp-t4-destroyer','torped',4,'Förstöraren','100% win vs NPCs. Take all cash + best item + 1000 respect per knockout. TRADE-OFF: Drug prices -50%.','keystone','{"assault_auto_win_npc":1,"knockout_respect":1000,"drug_sell_penalty":0.50}','["torp-t3-hitman"]',1,13);

-- HALLICK TREE (13 talents)
INSERT OR REPLACE INTO game_talents VALUES
('hall-t1-income','hallick',1,'Ökad Avkastning','Property income +20% per rank','passive','{"property_income_mult":0.20}',NULL,3,1),
('hall-t1-negotiator','hallick',1,'Affärssinne','Property buy price -15% per rank','passive','{"property_buy_discount":0.15}',NULL,2,2),
('hall-t1-manager','hallick',1,'Förvaltare','Income auto-collected (no manual collect needed)','passive','{"property_auto_collect":1}',NULL,1,3),
('hall-t1-reputation','hallick',1,'Rykte','NPC relation +10 per rank on quest completion','passive','{"npc_relation_bonus":10}',NULL,2,4),
('hall-t2-luxury','hallick',2,'Lyxfastigheter','Unlock Penthouse (2000/h), Strip Club (3000/h), Casino (5000/h). Requires level 15.','unlock','{"unlock_luxury_properties":1}','["hall-t1-negotiator"]',1,5),
('hall-t2-protection','hallick',2,'Beskyddarverksamhet','Unlock Demand Protection Money: NPC pays 500/h. Max 3 NPCs.','unlock','{"unlock_protection_racket":1,"protection_max":3,"protection_income":500}','["hall-t1-reputation"]',1,6),
('hall-t2-security','hallick',2,'Säkerhetssystem','Properties cannot be raided. Cash-on-hand cannot be stolen.','passive','{"property_raid_immune":1,"cash_theft_immune":1}','["hall-t1-manager"]',1,7),
('hall-t2-upgrade','hallick',2,'Effektiv Renovering','Property upgrades cost 40% less and give 50% more income boost.','passive','{"property_upgrade_discount":0.40,"property_upgrade_bonus":0.50}','["hall-t1-income"]',1,8),
('hall-t3-mogul','hallick',3,'Fastighetsmogul','+5 max property slots. All properties give 2x income.','passive','{"property_slots_bonus":5,"property_income_mult":2.0}','["hall-t2-luxury"]',1,9),
('hall-t3-racket','hallick',3,'Utpressningsimperiet','Protection money up to 1500/h per NPC. Max 6 NPCs.','passive','{"protection_income":1500,"protection_max":6}','["hall-t2-protection"]',1,10),
('hall-t3-fortress','hallick',3,'Fästningen','50% chance to auto-win when attacked by NPC (0 damage taken).','passive','{"auto_defend_chance":0.50}','["hall-t2-security"]',1,11),
('hall-t3-empire','hallick',3,'Företagsimperiet','Unlock Hostile Takeover: buy any NPC property for 2x market value.','unlock','{"unlock_hostile_takeover":1}','["hall-t2-upgrade"]',1,12),
('hall-t4-godfather','hallick',4,'Gudfadern','Properties 3x income. All NPCs on your side pay 2000/h auto. Net worth counts as respect. TRADE-OFF: Cannot assault.','keystone','{"property_income_mult":3,"auto_protection_all_side":1,"networth_as_respect":1,"assault_disabled":1}','["hall-t3-mogul"]',1,13);

-- BEDRAGARE TREE (13 talents)
INSERT OR REPLACE INTO game_talents VALUES
('bed-t1-adaptive','bedragare',1,'Anpassningsbar','+3 to ALL stats per rank','passive','{"all_stats":3}',NULL,3,1),
('bed-t1-fastlearner','bedragare',1,'Snabblärd','XP +15% per rank','passive','{"xp_mult":0.15}',NULL,3,2),
('bed-t1-observe','bedragare',1,'Observatör','See all NPC stats, cash, weapon, and next planned action.','unlock','{"npc_full_intel":1}',NULL,1,3),
('bed-t1-slippery','bedragare',1,'Hal som en Ål','Prison time -20% per rank. Escape chance +15% per rank.','passive','{"prison_time_mult":-0.20,"prison_escape_bonus":0.15}',NULL,2,4),
('bed-t2-impersonate','bedragare',2,'Identitetsstöld','Once per 8h: do 1 action with another professions bonuses.','unlock','{"impersonate_cooldown_hours":8}','["bed-t1-adaptive"]',1,5),
('bed-t2-doublelife','bedragare',2,'Dubbelliv','Cross-class talents cost 1 point instead of 2.','passive','{"cross_class_cost":1}','["bed-t1-fastlearner"]',1,6),
('bed-t2-snitch','bedragare',2,'Tjallare','Unlock Snitch: NPC jailed 2h, you get 20% of their cash. 5 energy. Max 2/day.','unlock','{"unlock_snitch":1,"snitch_max_daily":2}','["bed-t1-observe"]',1,7),
('bed-t2-escape','bedragare',2,'Mästare på Flykt','Auto-escape prison after 5 minutes (always, free).','passive','{"auto_prison_escape_minutes":5}','["bed-t1-slippery"]',1,8),
('bed-t3-mastermind','bedragare',3,'Hjärnan','All cooldowns -40%. All actions cost -3 energy.','passive','{"cooldown_mult":0.60,"energy_cost_all":-3}','["bed-t2-impersonate"]',1,9),
('bed-t3-prodigy','bedragare',3,'Prodigy','Level-up gives +2 talent points instead of +1.','passive','{"talent_points_per_level":2}','["bed-t2-doublelife"]',1,10),
('bed-t3-puppet','bedragare',3,'Dockspelaren','Unlock Manipulate: make 2 NPCs fight each other. Then attack the weakened winner at +50% damage.','unlock','{"unlock_manipulate":1}','["bed-t2-snitch"]',1,11),
('bed-t3-ghost','bedragare',3,'Spöket','NPCs cannot attack you or raid your assets. Invisible to NPC simulation.','passive','{"npc_attack_immune":1,"npc_raid_immune":1}','["bed-t2-escape"]',1,12),
('bed-t4-chameleon','bedragare',4,'Kameleonten','Switch profession once per round keeping all talents. Can have 2 capstones. Cross-class costs 1pt. TRADE-OFF: All base stats -15.','keystone','{"profession_switch_keep_talents":1,"dual_capstone":1,"cross_class_cost":1,"all_stats":-15}','["bed-t3-prodigy"]',1,13);
