const baseUrl = process.env.MOSQUITO_BASE_URL || 'http://127.0.0.1:8788';
const password = process.env.MOSQUITO_PASSWORD;
const adminPassword = process.env.MOSQUITO_ADMIN_PASSWORD || password;

if (!password) {
  console.error('Set MOSQUITO_PASSWORD before running the smoke test.');
  process.exit(1);
}

const jar = new Map();
const otherJar = new Map();

function readSetCookies(headers) {
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie();
  const single = headers.get('set-cookie');
  return single ? [single] : [];
}

function storeCookies(headers, targetJar = jar) {
  for (const raw of readSetCookies(headers)) {
    const [pair] = raw.split(';', 1);
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    targetJar.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
}

function cookieHeader(sourceJar = jar) {
  return Array.from(sourceJar.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
}

async function request(path, options = {}, targetJar = jar) {
  const headers = new Headers(options.headers || {});
  const cookies = cookieHeader(targetJar);
  if (cookies) headers.set('cookie', cookies);
  const response = await fetch(new URL(path, baseUrl), { ...options, headers, redirect: 'manual' });
  storeCookies(response.headers, targetJar);
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
  console.log(`OK   ${label}:`, response.status, data.message || data.error || '');
  return data;
}

async function expectStatus(label, expectedStatus, fn) {
  const { response, data } = await fn();
  if (response.status !== expectedStatus) {
    console.error(`FAIL ${label}: expected ${expectedStatus}, got ${response.status}`, data);
    process.exit(1);
  }
  console.log(`OK   ${label}:`, response.status, data.message || data.error || '');
  return data;
}

async function main() {
  await expectOk('site login', () => request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password }),
  }));

  const status = await expectOk('status', () => request('/api/game/status'));
  if (status.round_ended) {
    await expectOk('start next round', () => request('/api/game/new-round', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    }));
  }

  const playerName = `Smoke${Date.now().toString().slice(-6)}`;
  const create = await expectOk('create character', () => request('/api/game/create-character', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: playerName, side: 'eastside' }),
  }));
  if (!create.player) {
    console.error('FAIL create character: missing player payload', create);
    process.exit(1);
  }

  await expectOk('second site login', () => request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password }),
  }, otherJar));
  await expectStatus('duplicate character rejected', 409, () => request('/api/game/create-character', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: playerName, side: 'eastside' }),
  }, otherJar));

  await expectOk('player', () => request('/api/game/player'));
  await expectOk('admin unlock', () => request('/api/game/admin-auth', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: adminPassword }),
  }));
  await expectOk('admin status', () => request('/api/game/admin-status'));
  await expectOk('admin help', () => request('/api/game/admin', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ command: 'help' }),
  }));
  await expectOk('admin rich', () => request('/api/game/admin', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ command: 'rich' }),
  }));
  await expectOk('simulate first tick', () => request('/api/game/simulate', { method: 'POST' }));
  const throttled = await expectOk('simulate throttled tick', () => request('/api/game/simulate', { method: 'POST' }));
  if (!throttled.throttled) {
    console.error('FAIL simulate throttled tick: expected throttled=true', throttled);
    process.exit(1);
  }
  await expectOk('bank deposit', () => request('/api/game/action/bank', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'deposit', amount: 1000 }),
  }));
  await expectStatus('bank over-limit rejected', 400, () => request('/api/game/action/bank', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'deposit', amount: 10000001 }),
  }));
  await expectOk('bank withdraw', () => request('/api/game/action/bank', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'withdraw', amount: 500 }),
  }));
  await expectOk('admin logout', () => request('/api/game/admin-logout', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  }));
  await expectOk('final player', () => request('/api/game/player'));

  console.log('\nMosquito smoke test passed.');
}

main().catch(err => {
  console.error('FAIL smoke test:', err);
  process.exit(1);
});
