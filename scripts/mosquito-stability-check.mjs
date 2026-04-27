import fs from 'node:fs';

const api = fs.readFileSync('functions/api/[[route]].ts', 'utf8');
const html = fs.readFileSync('mosquito.html', 'utf8');
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

check(
  'assault player target is filtered by same round',
  /SELECT \* FROM game_players WHERE id = \? AND round_id = \?/.test(api)
);

check(
  'property upgrade is represented in the UI',
  /data-upgrade-prop|upgrade_id/.test(html)
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
