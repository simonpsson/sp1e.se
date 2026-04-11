-- ─── Talent Seed Data ─────────────────────────────────────────────────────────
-- Run AFTER game-talents-schema.sql.
-- Safe to re-run (INSERT OR REPLACE).
--
--   npx wrangler d1 execute sp1e-db --remote --file=game-talents-seed.sql

-- ═══════════════════════════════════════════════════════════════════════════════
-- RÅNARE — Robbery specialist
-- ═══════════════════════════════════════════════════════════════════════════════

-- TIER 1
INSERT OR REPLACE INTO game_talents VALUES
  ('rob-t1-quickhands','rånare',1,'Snabba Händer',
   '+10% cash per rank från alla rån.','🤲',
   '{"robbery_cash_bonus":0.10}','[]',3,1);
INSERT OR REPLACE INTO game_talents VALUES
  ('rob-t1-casing','rånare',1,'Spaning',
   'Visa exakt success-% på alla rån istället för ungefärlig.','🔭',
   '{"robbery_show_exact_chance":1}','[]',1,2);
INSERT OR REPLACE INTO game_talents VALUES
  ('rob-t1-getaway','rånare',1,'Flyktplan',
   '-15% chans att åka fast vid misslyckade rån.','🚗',
   '{"prison_chance_reduction":0.15}','[]',1,3);
INSERT OR REPLACE INTO game_talents VALUES
  ('rob-t1-nerves','rånare',1,'Kalla Nerver',
   '+5% success-chans per rank på alla rån.','🧠',
   '{"robbery_success_bonus":0.05}','[]',3,4);
INSERT OR REPLACE INTO game_talents VALUES
  ('rob-t1-pockets','rånare',1,'Djupa Fickor',
   '+20% mer loot och kontant utbyte från rån.','💰',
   '{"robbery_loot_bonus":0.20}','[]',1,5);

-- TIER 2
INSERT OR REPLACE INTO game_talents VALUES
  ('rob-t2-safecracker','rånare',2,'Kassaskåpsknäckare',
   'Lås upp exklusivt "Bankvalv"-rån med hög reward.','🔓',
   '{"unlock_bank_vault":1}','["rob-t1-quickhands:2"]',1,1);
INSERT OR REPLACE INTO game_talents VALUES
  ('rob-t2-disguise','rånare',2,'Mästare på Förklädnad',
   '-25% fängelsetid när du åker dit.','🎭',
   '{"prison_time_reduction":0.25}','["rob-t1-getaway"]',1,2);
INSERT OR REPLACE INTO game_talents VALUES
  ('rob-t2-inside','rånare',2,'Insidertips',
   '1 garanterat lyckat rån per dag (100% success).','📋',
   '{"daily_perfect_rob":1}','["rob-t1-casing"]',1,3);
INSERT OR REPLACE INTO game_talents VALUES
  ('rob-t2-fence','rånare',2,'Kontakt med Hälaren',
   '+30% sell-pris på alla looted items.','🤝',
   '{"loot_sell_bonus":0.30}','["rob-t1-pockets"]',1,4);
INSERT OR REPLACE INTO game_talents VALUES
  ('rob-t2-adrenaline','rånare',2,'Adrenalinkick',
   'Lyckade rån ger +3 energi tillbaka.','⚡',
   '{"rob_success_energy_regen":3}','["rob-t1-nerves:2"]',1,5);

-- TIER 3
INSERT OR REPLACE INTO game_talents VALUES
  ('rob-t3-mastermind','rånare',3,'Hjärnan',
   'Alla rån ger +50% respect.','🧩',
   '{"robbery_respect_bonus":0.50}','["rob-t2-safecracker"]',1,1);
INSERT OR REPLACE INTO game_talents VALUES
  ('rob-t3-phantom','rånare',3,'Fantomen',
   '50% chans att undvika fängelse helt vid misslyckande.','👻',
   '{"prison_avoid_chance":0.50}','["rob-t2-disguise"]',1,2);
INSERT OR REPLACE INTO game_talents VALUES
  ('rob-t3-crew','rånare',3,'Gangstergänget',
   'NPC-allies hjälper vid rån: +25% success och +25% cash.','👥',
   '{"crew_success_bonus":0.25,"crew_cash_bonus":0.25}','["rob-t2-inside"]',1,3);
INSERT OR REPLACE INTO game_talents VALUES
  ('rob-t3-legendary','rånare',3,'Legendarisk Rånare',
   'Lås upp "Federal Reserve Heist" — det ultimata rånet.','🏛️',
   '{"unlock_federal_heist":1}','["rob-t2-fence"]',1,4);

-- TIER 4 — CAPSTONE
INSERT OR REPLACE INTO game_talents VALUES
  ('rob-t4-kingpin','rånare',4,'Rånarkungen',
   'Alla rån-cooldowns halverade. +100% cash från högnivårån. Ditt namn visas i guld-text i feeden vid lyckade rån.','👑',
   '{"robbery_cooldown_halved":1,"tier5_cash_bonus":1.00,"gold_name_in_feed":1}','["rob-t3-mastermind"]',1,1);

-- ═══════════════════════════════════════════════════════════════════════════════
-- LANGARE — Drug dealing specialist
-- ═══════════════════════════════════════════════════════════════════════════════

-- TIER 1
INSERT OR REPLACE INTO game_talents VALUES
  ('lang-t1-contacts','langare',1,'Kontaktnät',
   '+10% bättre köppriser per rank.','📞',
   '{"drug_buy_discount":0.10}','[]',3,1);
INSERT OR REPLACE INTO game_talents VALUES
  ('lang-t1-haggle','langare',1,'Prutningsmästare',
   '+10% bättre säljpriser per rank.','💬',
   '{"drug_sell_bonus":0.10}','[]',3,2);
INSERT OR REPLACE INTO game_talents VALUES
  ('lang-t1-stash','langare',1,'Gömställe',
   'Dubbel drogkapacitet i inventory.','📦',
   '{"drug_capacity_mult":2}','[]',1,3);
INSERT OR REPLACE INTO game_talents VALUES
  ('lang-t1-trends','langare',1,'Trendspaning',
   'Se prisförändringar 30 min i förväg.','📈',
   '{"show_drug_future_price":1}','[]',1,4);
INSERT OR REPLACE INTO game_talents VALUES
  ('lang-t1-quality','langare',1,'Kvalitetskontroll',
   '+5% chans för "ren vara"-bonus vid köp (dubbel kvantitet).','🔬',
   '{"drug_double_qty_chance":0.05}','[]',1,5);

-- TIER 2
INSERT OR REPLACE INTO game_talents VALUES
  ('lang-t2-wholesale','langare',2,'Grossist',
   'Köp 10+ enheter → 20% rabatt automatiskt.','📊',
   '{"bulk_buy_discount":0.20}','["lang-t1-contacts:2"]',1,1);
INSERT OR REPLACE INTO game_talents VALUES
  ('lang-t2-network','langare',2,'Distributionsnät',
   'Passiv inkomst: säljer droger automatiskt varje timme.','🌐',
   '{"passive_drug_income":1}','["lang-t1-haggle:2"]',1,2);
INSERT OR REPLACE INTO game_talents VALUES
  ('lang-t2-lab','langare',2,'Eget Labb',
   'Tillverka droger från komponenter till lägre kostnad.','⚗️',
   '{"drug_lab_unlocked":1}','["lang-t1-stash"]',1,3);
INSERT OR REPLACE INTO game_talents VALUES
  ('lang-t2-insider','langare',2,'Insiderinformation',
   'Se exakta prisfluktuationer, inte bara trend-pilar.','📉',
   '{"exact_price_info":1}','["lang-t1-trends"]',1,4);
INSERT OR REPLACE INTO game_talents VALUES
  ('lang-t2-pure','langare',2,'Rent Gods',
   'Dina droger säljer alltid till premium-pris (+15%).','💎',
   '{"drug_premium_sell":0.15}','["lang-t1-quality"]',1,5);

-- TIER 3
INSERT OR REPLACE INTO game_talents VALUES
  ('lang-t3-cartel','langare',3,'Kartellkontakt',
   'Lås upp exklusiv drog "Blått" med högsta marknadsvärde.','🌀',
   '{"unlock_blue_drug":1}','["lang-t2-wholesale"]',1,1);
INSERT OR REPLACE INTO game_talents VALUES
  ('lang-t3-empire','langare',3,'Knarkimperiet',
   'Distributionsnätet ger 3x inkomst.','🏭',
   '{"passive_income_mult":3}','["lang-t2-network"]',1,2);
INSERT OR REPLACE INTO game_talents VALUES
  ('lang-t3-chemist','langare',3,'Kemisten',
   'Labbet producerar dubbelt upp.','🧪',
   '{"lab_production_mult":2}','["lang-t2-lab"]',1,3);
INSERT OR REPLACE INTO game_talents VALUES
  ('lang-t3-manipulation','langare',3,'Marknadsmanipulation',
   'En gång per dag: tvinga ett drogpris att dubblas.','🎲',
   '{"daily_price_double":1}','["lang-t2-insider"]',1,4);

-- TIER 4 — CAPSTONE
INSERT OR REPLACE INTO game_talents VALUES
  ('lang-t4-escobar','langare',4,'Drogkungen',
   'Alla drogpriser visas i realtid med exakt nästa förändring. Distributionsnätet kan inte raideras. +200% på alla drogvinster.','💊',
   '{"realtime_drug_prices":1,"passive_income_unraidable":1,"drug_profit_bonus":2.00}','["lang-t3-empire"]',1,1);

-- ═══════════════════════════════════════════════════════════════════════════════
-- TORPED — Combat specialist
-- ═══════════════════════════════════════════════════════════════════════════════

-- TIER 1
INSERT OR REPLACE INTO game_talents VALUES
  ('torp-t1-ironjaw','torped',1,'Järnkäft',
   '+15 max HP per rank.','🦷',
   '{"hp_max_bonus":15}','[]',3,1);
INSERT OR REPLACE INTO game_talents VALUES
  ('torp-t1-bruteforce','torped',1,'Brutal Kraft',
   '+10% assault-skada per rank.','💪',
   '{"assault_damage_bonus":0.10}','[]',3,2);
INSERT OR REPLACE INTO game_talents VALUES
  ('torp-t1-intimidate','torped',1,'Skrämseltaktik',
   '+10% chans att fienden flyr (instant win).','😤',
   '{"flee_chance":0.10}','[]',1,3);
INSERT OR REPLACE INTO game_talents VALUES
  ('torp-t1-thick','torped',1,'Tjockt Skinn',
   '-10% incoming damage per rank.','🛡️',
   '{"damage_reduction":0.10}','[]',3,4);
INSERT OR REPLACE INTO game_talents VALUES
  ('torp-t1-streetfight','torped',1,'Gatuslagsmål',
   '+20% damage utan vapen (knytnävar).','👊',
   '{"unarmed_damage_bonus":0.20}','[]',1,5);

-- TIER 2
INSERT OR REPLACE INTO game_talents VALUES
  ('torp-t2-execute','torped',2,'Avrätta',
   'Om fienden har <20% HP: garanterad knockout.','💀',
   '{"execute_low_hp":1}','["torp-t1-bruteforce:2"]',1,1);
INSERT OR REPLACE INTO game_talents VALUES
  ('torp-t2-bodyguard','torped',2,'Livvakt',
   'NPC:er attackerar dig 50% mer sällan.','🕴️',
   '{"npc_attack_reduction":0.50}','["torp-t1-intimidate"]',1,2);
INSERT OR REPLACE INTO game_talents VALUES
  ('torp-t2-berserker','torped',2,'Bärsärk',
   'Under 30% HP: +50% damage.','🔥',
   '{"berserker_damage_bonus":0.50}','["torp-t1-ironjaw:2"]',1,3);
INSERT OR REPLACE INTO game_talents VALUES
  ('torp-t2-armor','torped',2,'Kroppspansar',
   'Rustning ger dubbel effekt.','🦺',
   '{"armor_effectiveness_mult":2}','["torp-t1-thick:2"]',1,4);
INSERT OR REPLACE INTO game_talents VALUES
  ('torp-t2-dualwield','torped',2,'Dubbla Vapen',
   'Använd primärt OCH sekundärt vapen i strid.','⚔️',
   '{"dual_wield":1}','["torp-t1-streetfight"]',1,5);

-- TIER 3
INSERT OR REPLACE INTO game_talents VALUES
  ('torp-t3-hitman','torped',3,'Torped-elite',
   'Assault kostar 50% mindre energi.','🎯',
   '{"assault_energy_reduction":0.50}','["torp-t2-execute"]',1,1);
INSERT OR REPLACE INTO game_talents VALUES
  ('torp-t3-fearsome','torped',3,'Fruktad',
   'NPC:er med lägre level flyr automatiskt.','😱',
   '{"lower_level_flee":1}','["torp-t2-bodyguard"]',1,2);
INSERT OR REPLACE INTO game_talents VALUES
  ('torp-t3-bloodlust','torped',3,'Blodtörst',
   'Varje knockout ger +5 HP och +2 energi.','🩸',
   '{"kill_hp_regen":5,"kill_energy_regen":2}','["torp-t2-berserker"]',1,3);
INSERT OR REPLACE INTO game_talents VALUES
  ('torp-t3-tank','torped',3,'Stridsvagnen',
   'Max HP +100, alla inkommande skador -25%.','🏋️',
   '{"hp_max_flat_bonus":100,"damage_reduction_flat":0.25}','["torp-t2-armor"]',1,4);

-- TIER 4 — CAPSTONE
INSERT OR REPLACE INTO game_talents VALUES
  ('torp-t4-warlord','torped',4,'Krigsherren',
   'Attackera vilken NPC som helst oavsett level. Assault ger 3x respect. Du kan inte knockoutas (HP stannar på 1 en gång per dag).','⚔️',
   '{"attack_any_level":1,"assault_respect_mult":3,"no_knockout_daily":1}','["torp-t3-hitman"]',1,1);

-- ═══════════════════════════════════════════════════════════════════════════════
-- HALLICK — Property & passive income specialist
-- ═══════════════════════════════════════════════════════════════════════════════

-- TIER 1
INSERT OR REPLACE INTO game_talents VALUES
  ('hall-t1-income','hallick',1,'Ökad Avkastning',
   '+15% property-inkomst per rank.','📈',
   '{"property_income_bonus":0.15}','[]',3,1);
INSERT OR REPLACE INTO game_talents VALUES
  ('hall-t1-charm','hallick',1,'Charm',
   '+10% charisma per rank.','✨',
   '{"charisma_bonus":0.10}','[]',3,2);
INSERT OR REPLACE INTO game_talents VALUES
  ('hall-t1-negotiator','hallick',1,'Förhandlare',
   '-10% köppris på properties.','🤝',
   '{"property_buy_discount":0.10}','[]',1,3);
INSERT OR REPLACE INTO game_talents VALUES
  ('hall-t1-manager','hallick',1,'Förvaltare',
   'Properties genererar inkomst 20% snabbare.','⏱️',
   '{"property_income_speed":0.20}','[]',1,4);
INSERT OR REPLACE INTO game_talents VALUES
  ('hall-t1-network','hallick',1,'Socialt Nätverk',
   '+1 max property-slot.','🏘️',
   '{"property_slot_bonus":1}','[]',1,5);

-- TIER 2
INSERT OR REPLACE INTO game_talents VALUES
  ('hall-t2-luxury','hallick',2,'Lyxfastigheter',
   'Lås upp Penthouse och Nattklubb Deluxe med hög income.','🏰',
   '{"unlock_luxury_properties":1}','["hall-t1-negotiator"]',1,1);
INSERT OR REPLACE INTO game_talents VALUES
  ('hall-t2-protection','hallick',2,'Beskyddarverksamhet',
   'Samla "skyddspeng" från NPC:er (passiv income).','💼',
   '{"npc_passive_income":1}','["hall-t1-charm:2"]',1,2);
INSERT OR REPLACE INTO game_talents VALUES
  ('hall-t2-upgrade','hallick',2,'Snabb Uppgradering',
   'Property-uppgraderingar kostar 30% mindre.','🔧',
   '{"property_upgrade_discount":0.30}','["hall-t1-income:2"]',1,3);
INSERT OR REPLACE INTO game_talents VALUES
  ('hall-t2-territory','hallick',2,'Territorium',
   'Dina properties kan inte raidas av NPC:er.','🗺️',
   '{"property_unraidable":1}','["hall-t1-manager"]',1,4);
INSERT OR REPLACE INTO game_talents VALUES
  ('hall-t2-expansion','hallick',2,'Expansion',
   '+2 max property-slots.','🏗️',
   '{"property_slot_bonus":2}','["hall-t1-network"]',1,5);

-- TIER 3
INSERT OR REPLACE INTO game_talents VALUES
  ('hall-t3-mogul','hallick',3,'Fastighetsmogul',
   'Alla properties auto-uppgraderar 1 level per dag.','🏙️',
   '{"property_auto_upgrade":1}','["hall-t2-luxury"]',1,1);
INSERT OR REPLACE INTO game_talents VALUES
  ('hall-t3-racket','hallick',3,'Utpressning',
   'Passiv inkomst från alla NPC:er på din sida.','💰',
   '{"side_passive_income":1}','["hall-t2-protection"]',1,2);
INSERT OR REPLACE INTO game_talents VALUES
  ('hall-t3-empire','hallick',3,'Imperiet',
   'Max property-slots +5, income +50%.','🌆',
   '{"property_slot_bonus":5,"property_income_bonus":0.50}','["hall-t2-expansion"]',1,3);
INSERT OR REPLACE INTO game_talents VALUES
  ('hall-t3-launder','hallick',3,'Pengatvätt',
   'Banken tar 0% avgift istället för 5%.','🏦',
   '{"bank_fee_zero":1}','["hall-t2-upgrade"]',1,4);

-- TIER 4 — CAPSTONE
INSERT OR REPLACE INTO game_talents VALUES
  ('hall-t4-don','hallick',4,'Gudfadern',
   'Alla properties ger 3x income. Du kan köpa vilken NPC:s property som helst. Ditt nettovärde (cash + properties) räknas till respect.','🎩',
   '{"property_income_mult":3,"hostile_takeover":1,"networth_respect":1}','["hall-t3-mogul"]',1,1);

-- ═══════════════════════════════════════════════════════════════════════════════
-- BEDRAGARE — All-rounder, utility, deception
-- ═══════════════════════════════════════════════════════════════════════════════

-- TIER 1
INSERT OR REPLACE INTO game_talents VALUES
  ('bed-t1-adaptable','bedragare',1,'Anpassningsbar',
   '+5% bonus till ALLA stats per rank.','🎭',
   '{"all_stats_bonus":0.05}','[]',3,1);
INSERT OR REPLACE INTO game_talents VALUES
  ('bed-t1-fastlearner','bedragare',1,'Snabb Inlärare',
   '+15% XP per rank.','📚',
   '{"xp_bonus":0.15}','[]',3,2);
INSERT OR REPLACE INTO game_talents VALUES
  ('bed-t1-silver','bedragare',1,'Silvertunga',
   'NPC:er ger dig bättre quest-rewards.','🗣️',
   '{"quest_reward_bonus":0.20}','[]',1,3);
INSERT OR REPLACE INTO game_talents VALUES
  ('bed-t1-observant','bedragare',1,'Observant',
   'Se NPC:ers exakta stats och cash i strids-vyn.','👁️',
   '{"see_npc_stats":1}','[]',1,4);
INSERT OR REPLACE INTO game_talents VALUES
  ('bed-t1-lucky','bedragare',1,'Tur',
   '+5% på alla RNG-rolls (loot, rån, strid).','🍀',
   '{"rng_bonus":0.05}','[]',1,5);

-- TIER 2
INSERT OR REPLACE INTO game_talents VALUES
  ('bed-t2-impersonate','bedragare',2,'Identitetsstöld',
   'Utför 1 rån per dag som valfri annan klass med deras bonusar.','🎪',
   '{"daily_class_rob":1}','["bed-t1-adaptable:2"]',1,1);
INSERT OR REPLACE INTO game_talents VALUES
  ('bed-t2-xpmaster','bedragare',2,'Erfarenhetsexpert',
   'Varje action ger minimum 50 XP (aldrig 0).','🎓',
   '{"min_xp_per_action":50}','["bed-t1-fastlearner:2"]',1,2);
INSERT OR REPLACE INTO game_talents VALUES
  ('bed-t2-snitcher','bedragare',2,'Tjallare',
   'Ange en NPC → de hamnar i fängelse, du får deras cash.','📱',
   '{"snitch_ability":1}','["bed-t1-silver"]',1,3);
INSERT OR REPLACE INTO game_talents VALUES
  ('bed-t2-intel','bedragare',2,'Underrättelsetjänst',
   'Se nästa NPC-action i feeden (förutse attacker).','🕵️',
   '{"predict_npc_action":1}','["bed-t1-observant"]',1,4);
INSERT OR REPLACE INTO game_talents VALUES
  ('bed-t2-jackpot','bedragare',2,'Jackpot',
   'Loot-tier uppgraderas 1 steg 15% av tiden.','🎰',
   '{"loot_upgrade_chance":0.15}','["bed-t1-lucky"]',1,5);

-- TIER 3
INSERT OR REPLACE INTO game_talents VALUES
  ('bed-t3-mastermind','bedragare',3,'Schackspelaren',
   'Alla cooldowns -30%.','♟️',
   '{"cooldown_reduction":0.30}','["bed-t2-impersonate"]',1,1);
INSERT OR REPLACE INTO game_talents VALUES
  ('bed-t3-prodigy','bedragare',3,'Underbarn',
   'Level-up ger 2 talent-poäng istället för 1 (retroaktivt).','⭐',
   '{"double_talent_points":1}','["bed-t2-xpmaster"]',1,2);
INSERT OR REPLACE INTO game_talents VALUES
  ('bed-t3-network','bedragare',3,'Dubbelagent',
   'Få quests och bonusar från BÅDA sidorna (east + west).','🔄',
   '{"both_sides_quests":1}','["bed-t2-snitcher"]',1,3);
INSERT OR REPLACE INTO game_talents VALUES
  ('bed-t3-fortune','bedragare',3,'Lyckans Favorit',
   'Alla RNG-rolls +15%, loot-tier +1 steg 25% av gångerna.','🌟',
   '{"rng_bonus":0.15,"loot_upgrade_chance":0.25}','["bed-t2-jackpot"]',1,4);

-- TIER 4 — CAPSTONE
INSERT OR REPLACE INTO game_talents VALUES
  ('bed-t4-ghost','bedragare',4,'Spöket',
   'Byt profession EN gång per runda utan att förlora talents. Sätt 1 point i valfritt tree till normal kostnad. Alla fängelse- och sjukhustider halverade.','👻',
   '{"free_profession_change":1,"cross_tree_normal_cost":1,"prison_hospital_halved":1}','["bed-t3-mastermind"]',1,1);
