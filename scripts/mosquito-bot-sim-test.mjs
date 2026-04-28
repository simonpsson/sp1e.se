import fs from 'node:fs';

const baseUrl = process.env.MOSQUITO_BASE_URL || 'http://127.0.0.1:8788';
const password = process.env.MOSQUITO_PASSWORD;

const apiSource = fs.readFileSync('functions/api/[[route]].ts', 'utf8');
const htmlSource = fs.readFileSync('mosquito.html', 'utf8');

function assert(condition, message, detail = undefined) {
  if (!condition) {
    console.error(`FAIL ${message}`, detail ?? '');
    process.exit(1);
  }
  console.log(`OK   ${message}`);
}

function activeGameSimulateBlock() {
  const start = apiSource.lastIndexOf('async function gameSimulate');
  const end = apiSource.indexOf('function svNum', start);
  return start >= 0 && end > start ? apiSource.slice(start, end) : '';
}

function runSourceChecks() {
  const simulateBlock = activeGameSimulateBlock();
  const requiredHelpers = [
    'loadNpcsForSimulation',
    'chooseNpcAction',
    'applyNpcAction',
    'simulateNpcTick',
    'buildNpcFeedMessage',
    'clampNpcProgression',
    'getNpcArchetype',
    'npcRiskProfile',
  ];
  for (const helper of requiredHelpers) {
    assert(apiSource.includes(`function ${helper}`) || apiSource.includes(`async function ${helper}`), `helper exists: ${helper}`);
  }
  assert(/id === 'simulate'\s*&&\s*method === 'POST'/.test(apiSource), 'simulate route is POST-only');
  assert(!/id === 'simulate'\s*&&\s*method === 'GET'/.test(apiSource), 'simulate route is not GET-mutating');
  assert(/post\(['"]simulate['"]/.test(htmlSource), 'frontend world pulse uses POST simulate');
  assert(/SIMULATE_THROTTLE_MS/.test(simulateBlock) && /throttled/.test(simulateBlock), 'active simulate has throttle response');
  assert(/getActiveRound/.test(simulateBlock) && /endRound/.test(simulateBlock), 'active simulate checks active/ended round');
  assert(!/ORDER BY RANDOM\(\)/i.test(simulateBlock), 'active simulate does not use SQL random ordering');
  assert(!/Math\.random\(\)/.test(simulateBlock), 'active simulate does not use Math.random');
}

const jar = new Map();

function readSetCookies(headers) {
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie();
  const single = headers.get('set-cookie');
  return single ? [single] : [];
}

function storeCookies(headers) {
  for (const raw of readSetCookies(headers)) {
    const [pair] = raw.split(';', 1);
    const eq = pair.indexOf('=');
    if (eq !== -1) jar.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
}

function cookieHeader() {
  return Array.from(jar.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
}

async function request(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const cookies = cookieHeader();
  if (cookies) headers.set('cookie', cookies);
  const response = await fetch(new URL(path, baseUrl), { ...options, headers, redirect: 'manual' });
  storeCookies(response.headers);
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; }
  catch { data = { raw: text }; }
  return { response, data };
}

async function expectOk(label, fn) {
  const { response, data } = await fn();
  if (!response.ok) {
    console.error(`FAIL ${label}:`, response.status, data);
    process.exit(1);
  }
  console.log(`OK   ${label}:`, response.status);
  return data;
}

function assertBotResponseShape(data, label) {
  assert(data && data.ok === true, `${label}: ok=true`, data);
  assert(typeof data.simulated === 'boolean', `${label}: simulated boolean`);
  assert(typeof data.throttled === 'boolean', `${label}: throttled boolean`);
  assert(Array.isArray(data.actions), `${label}: actions array`);
  assert(Array.isArray(data.events), `${label}: events array`);
  assert('next_allowed_at' in data || data.round_ended || data.round_id === null, `${label}: next_allowed_at/terminal state present`);
}

function assertReadableEvents(events) {
  for (const evt of events) {
    const desc = String(evt.description || '');
    assert(desc.length >= 8, 'event has readable description', evt);
    assert(!/[ÃÂ�]/.test(desc), 'event has no obvious mojibake', desc);
    assert(typeof evt.actor === 'string' && evt.actor.length >= 2, 'event has actor', evt);
  }
}

function assertBoundedActions(actions) {
  const validTypes = new Set(['robbery', 'training', 'drug', 'assault', 'race', 'casino', 'lay_low', 'rob_player', 'threat', 'quest_offer']);
  assert(actions.length <= 6, 'tick action count is bounded');
  for (const action of actions) {
    assert(validTypes.has(action.type), `valid action type: ${action.type}`, action);
    assert(Math.abs(Number(action.cash_delta || 0)) <= 100_000, 'cash delta is bounded', action);
    assert(Math.abs(Number(action.respect_delta || 0)) <= 50, 'respect delta is bounded', action);
    assert(String(action.summary || '').length >= 8, 'action summary is readable', action);
    assert(!/[ÃÂ�]/.test(String(action.summary || '')), 'action summary has no obvious mojibake', action.summary);
  }
}

function assertBoundedNpcs(npcs) {
  for (const npc of npcs) {
    assert(Number(npc.level) >= 1 && Number(npc.level) <= 50, 'NPC level is bounded', npc);
    assert(Number(npc.respect) >= 0 && Number(npc.respect) <= 250_000, 'NPC respect is bounded', npc);
    assert(Number(npc.cash) >= 0 && Number(npc.cash) <= 2_000_000, 'NPC cash is bounded', npc);
  }
}

async function runLiveChecks() {
  if (!password) {
    console.log('\nSkipping live bot checks: set MOSQUITO_PASSWORD to test against a running app.');
    return;
  }

  await expectOk('site login', () => request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password }),
  }));

  const status = await expectOk('status loads', () => request('/api/game/status'));
  if (status.round_ended) {
    await expectOk('start next round', () => request('/api/game/new-round', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    }));
  }

  const playerName = `BotQA${Date.now().toString().slice(-6)}`;
  await expectOk('create character', () => request('/api/game/create-character', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: playerName, side: 'eastside' }),
  }));

  const npcsBefore = await expectOk('NPCs load before simulate', () => request('/api/game/npcs'));
  assert(Array.isArray(npcsBefore.npcs) && npcsBefore.npcs.length > 0, 'NPC list has rows before simulate');

  const first = await expectOk('simulate first call', () => request('/api/game/simulate', { method: 'POST' }));
  assertBotResponseShape(first, 'first simulate');
  if (!first.throttled) {
    assertBoundedActions(first.actions);
    assertReadableEvents(first.events);
  } else {
    console.log('INFO first simulate was already throttled; fresh-event checks skipped for this run.');
  }

  const second = await expectOk('simulate repeated call', () => request('/api/game/simulate', { method: 'POST' }));
  assertBotResponseShape(second, 'second simulate');
  assert(second.throttled === true, 'repeated simulate is throttled', second);
  assert(second.simulated === false, 'throttled simulate does not mutate', second);
  assert(second.actions.length === 0, 'throttled simulate returns no actions', second);
  assert(typeof second.next_allowed_at === 'string' && second.next_allowed_at.length > 10, 'throttled simulate returns next_allowed_at');

  const npcsAfter = await expectOk('NPCs load after simulate', () => request('/api/game/npcs'));
  assertBoundedNpcs(npcsAfter.npcs || []);
  await expectOk('player state still loads', () => request('/api/game/player'));
}

runSourceChecks();
await runLiveChecks();

console.log('\nMosquito bot simulation checks passed.');
