import fs from 'node:fs';

const api = fs.readFileSync('functions/api/[[route]].ts', 'utf8');
const html = fs.readFileSync('mosquito.html', 'utf8');
const index = fs.readFileSync('index.html', 'utf8');
const project = fs.readFileSync('PROJECT.md', 'utf8');

const checks = [];
function check(name, ok) {
  checks.push({ name, ok: Boolean(ok) });
}

function countMatches(text, pattern) {
  return Array.from(text.matchAll(pattern)).length;
}

check(
  'admin auth prefers GAME_ADMIN_PASSWORD_HASH with local fallback',
  /env\.GAME_ADMIN_PASSWORD_HASH\s*\?\?\s*DEFAULT_GAME_ADMIN_HASH|env\.GAME_ADMIN_PASSWORD_HASH\s*\|\|\s*DEFAULT_GAME_ADMIN_HASH/.test(api)
);

check(
  'create-character does not restore by name alone',
  !/population|same-name|auto-restore|restore-by-name/i.test(api.slice(api.indexOf('async function gameCreateCharacter'), api.indexOf('async function gameGetPlayer')))
);

check(
  'collect-income credits only actually updated properties',
  /creditedTotal|credited\s*\+=|meta\.changes|rowsAffected/i.test(api.slice(api.indexOf('async function gameActionCollectIncome'), api.indexOf('async function gameActionChooseProfession')))
);

check(
  'no incorrect api(path, POST, body) helper calls remain',
  !/api\([^;\n]+,\s*['"]POST['"]\s*,/.test(html) &&
    !/api\([^;\n]+,\s*\{[^}\n]*method:\s*['"]POST['"][^}\n]*body:\s*\{/.test(html)
);

for (const fn of ['loadCasinoState', 'renderCasino', 'doBlackjackStart', 'doBlackjackAction']) {
  check(`${fn} has a single definition`, countMatches(html, new RegExp(`function\\s+${fn}\\s*\\(|async\\s+function\\s+${fn}\\s*\\(`, 'g')) === 1);
}

check(
  'race win cash delta treats prize as gross payout after fee',
  /const\s+winNet\s*=\s*cfg\.prize\s*-\s*cfg\.fee/.test(api) &&
    /won\s*\?\s*winNet\s*:\s*-cfg\.fee/.test(api)
);

check(
  'simulate has a throttle',
  /SIMULATE_THROTTLE_MS|simulate.*throttle|throttled/i.test(api.slice(api.indexOf('async function gameSimulate'), api.indexOf('function svNum')))
);

const simulateBlock = api.slice(api.indexOf('async function gameSimulate'), api.indexOf('function svNum'));

check(
  'world pulse calls simulate with POST',
  /post\(['"]simulate['"]/.test(html) && !/api\(['"]simulate['"]\)/.test(html)
);

check(
  'NPC bot policies are explicit and personality-driven',
  /NPC_BOT_POLICIES/.test(api) && /botPolicyFor/.test(api)
);

check(
  'NPC simulation uses seeded deterministic RNG',
  /createSeededRng|seededBotRng/.test(api) && !/Math\.random\(\)/.test(simulateBlock)
);

check(
  'NPC simulation avoids SQL random ordering',
  !/ORDER BY RANDOM\(\)/i.test(simulateBlock)
);

check(
  'NPC simulation uses per-NPC cooldown state',
  /simulateNpcTick/.test(simulateBlock) &&
    /last_action_at/.test(api.slice(api.indexOf('async function loadNpcsForSimulation'), api.indexOf('function chooseNpcAction'))) &&
    /BOT_NPC_COOLDOWN_MS|last_action_at <= datetime\('now'/.test(api)
);

check(
  'NPC simulation returns structured bot summary',
  /simulated/.test(simulateBlock) && /next_allowed_at/.test(simulateBlock) && /actions/.test(simulateBlock)
);

check(
  'assault player target is filtered by same round',
  /SELECT \* FROM game_players WHERE id = \? AND round_id = \?/.test(api)
);

check(
  'property upgrade is represented in the UI',
  /data-upgrade-prop|upgrade_id/.test(html)
);

check(
  'GATAN is removed from player navigation and no longer the default section',
  !/data-s=["']gatan["']/.test(html) &&
    /section:\s*['"]brott['"]/.test(html) &&
    !/const\s+fns\s*=\s*\{[^}]*gatan\s*:/s.test(html)
);

check(
  'weapon purchase is handled by the primary click router',
  /\[data-buy-weapon\]/.test(html.slice(html.indexOf('document.addEventListener(\'click\',e=>{'), html.indexOf('/* â”€â”€â”€ Gatan'))) &&
    /target\.dataset\.buyWeapon/.test(html)
);

check(
  'inventory routes self-heal D1 inventory extension columns',
  /async function ensureInventoryStorage/.test(api) &&
    /await ensureInventoryStorage\(env\)/.test(api.slice(api.indexOf('async function gameActionBuyWeapon'), api.indexOf('async function gameGetAmmo'))) &&
    /await ensureInventoryStorage\(env\)/.test(api.slice(api.indexOf('async function gameGetInventory'), api.indexOf('const EQUIPPABLE_SLOTS')))
);

const expectedAudioFiles = [
  'assets/audio/casino/casino-bar-loop.wav',
  'assets/audio/casino/holdem-all-in.mp3',
  'assets/audio/casino/card-drop.mp3',
  'assets/audio/casino/chip-drop.mp3',
  'assets/audio/casino/poker-room.mp3',
  'assets/audio/casino/card-slap.mp3',
  'assets/audio/casino/card-place.mp3',
  'assets/audio/ambiance/rain-thunder-loop.wav',
];

check(
  'casino and rain audio assets exist in public static paths',
  expectedAudioFiles.every(file => fs.existsSync(file))
);

check(
  'mosquito audio scene switching is wired for casino and non-casino sections',
  /const\s+MOSQ_AUDIO/.test(html) &&
    /function\s+updateAmbientAudio/.test(html) &&
    /casino-bar-loop\.wav/.test(html) &&
    /rain-thunder-loop\.wav/.test(html) &&
    /function\s+playCasinoCue/.test(html)
);

check(
  'casino jazz loop is dominant and pub room is subdued',
  fs.existsSync('assets/audio/casino/jazz-jardin-du-luxembourg.mp3') &&
    /jazz:\s*['"]\/assets\/audio\/casino\/jazz-jardin-du-luxembourg\.mp3['"]/.test(html) &&
    /loopVolumes:\s*\{[^}]*rain:0\.(2[5-9]|[3-9]\d)[^}]*casinoBar:0\.0[5-9][^}]*pokerRoom:0\.0[1-6][^}]*jazz:0\.(2[5-9]|[3-9]\d)/.test(html)
);

check(
  'blackjack actions use the shared casino card and chip sound cues',
  /async function doBlackjackStart[\s\S]*playCasinoCue\(['"]chipDrop['"][\s\S]*playCasinoCue\(['"]cardDrop['"]/.test(html) &&
    /async function doBlackjackAction[\s\S]*playCasinoCue\(['"]cardDrop['"][\s\S]*playCasinoCue\(['"]cardPlace['"][\s\S]*playCasinoCue\(['"]cardSlap['"][\s\S]*playCasinoCue\(['"]chipDrop['"]/.test(html)
);

check(
  'holdem table has action animation hooks for seats and dealer/card events',
  /function\s+triggerHoldemActionFx/.test(html) &&
    /holdem-seat-action-/.test(html) &&
    /data-seat-id=/.test(html) &&
    /playCasinoCue/.test(html.slice(html.indexOf('async function doHoldemAction'), html.indexOf('function renderLog')))
);

check(
  'landing page uses the local bullfight image as static default',
  fs.existsSync('assets/landing/after-a-bullfight-wide.png') &&
    /\/assets\/landing\/after-a-bullfight-wide\.png/.test(index) &&
    /const\s+LANDING_STATIC_ART/.test(index) &&
    /function\s+gShowStaticLanding/.test(index)
);

const gShowFirstBlock = index.slice(index.indexOf('function gShowFirst'), index.indexOf('function gShowStaticLanding'));

check(
  'landing background load handlers are attached before assigning image src',
  gShowFirstBlock.indexOf('bgFront.onload') !== -1 &&
    gShowFirstBlock.indexOf('bgFront.src = gUrl(art)') !== -1 &&
    gShowFirstBlock.indexOf('bgFront.onload') < gShowFirstBlock.indexOf('bgFront.src = gUrl(art)')
);

check(
  'landing page exposes The Gallery with living background toggle and museum mode',
  />The Gallery<\/button>/.test(index) &&
    /Toggle living background/.test(index) &&
    /The Museum/.test(index) &&
    /function\s+toggleLivingBackground/.test(index) &&
    !/>Immersion<\/button>/.test(index)
);

check(
  'hospital rejects eliminated players',
  /if\s*\(!player\.is_alive\)/.test(api.slice(api.indexOf('async function gameActionHospital'), api.indexOf('async function gameActionBank')))
);

check(
  'bank action has an explicit max amount',
  /MAX_BANK_ACTION_AMOUNT/.test(api)
);

check(
  'PROJECT documents current Mosquito auth requirement',
  /Mosquito[^.\n]*(requires|kr[aä]ver)[^.\n]*site auth|\/mosquito[^.\n]*site auth|game routes[^.\n]*site auth/i.test(project)
);

const failed = checks.filter(c => !c.ok);
for (const c of checks) {
  console.log(`${c.ok ? 'OK  ' : 'FAIL'} ${c.name}`);
}

if (failed.length) {
  console.error(`\n${failed.length} Mosquito stability check(s) failed.`);
  process.exit(1);
}

console.log('\nMosquito stability checks passed.');
