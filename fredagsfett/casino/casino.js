// Live endpoints — Fredagsfett aliases under /api/fredagsfett/casino/*.
// These resolve auth via the ff_session cookie (see getCasinoPlayer() in
// functions/api/[[route]].ts) before forwarding to the shared Mosquito
// casino handlers. NO admin endpoints are exposed here.
export const CASINO_ENDPOINTS = {
  casino: {
    blackjack: '/api/fredagsfett/casino/blackjack/state',
    roulette:  '/api/fredagsfett/casino/roulette/state',
    holdem:    '/api/fredagsfett/casino/holdem/state',
  },
  blackjack: {
    deal:      '/api/fredagsfett/casino/blackjack/deal',
    hit:       '/api/fredagsfett/casino/blackjack/hit',
    stand:     '/api/fredagsfett/casino/blackjack/stand',
    double:    '/api/fredagsfett/casino/blackjack/double',
    split:     '/api/fredagsfett/casino/blackjack/split',
    insurance: '/api/fredagsfett/casino/blackjack/insurance',
  },
  roulette: {
    spin: '/api/fredagsfett/casino/roulette/spin',
  },
  holdem: {
    buyIn:    '/api/fredagsfett/casino/holdem/buy-in',
    action:   '/api/fredagsfett/casino/holdem/action',
    nextHand: '/api/fredagsfett/casino/holdem/next-hand',
    leave:    '/api/fredagsfett/casino/holdem/leave',
  },
};

// Legacy Mosquito routes — kept exported for the migration audit/tests only.
// The adapter no longer calls these; references remain so the contract
// checker can prove we are not pointing at /api/game/* anymore.
export const LEGACY_MOSQUITO_ENDPOINTS = {
  casino: {
    blackjack: '/api/game/casino/blackjack/state',
    roulette:  '/api/game/casino/roulette/state',
    holdem:    '/api/game/casino/holdem/state',
  },
  blackjack: {
    deal:      '/api/game/action/blackjack/start',
    hit:       '/api/game/action/blackjack/hit',
    stand:     '/api/game/action/blackjack/stand',
    double:    '/api/game/action/blackjack/double',
    split:     '/api/game/action/blackjack/split',
    insurance: '/api/game/action/blackjack/insurance',
  },
  roulette: { spin: '/api/game/action/roulette/spin' },
  holdem: {
    buyIn:    '/api/game/action/holdem/start',
    action:   '/api/game/action/holdem/act',
    nextHand: '/api/game/action/holdem/next',
    leave:    '/api/game/action/holdem/leave',
  },
};

// Back-compat aliases (scaffold variable names).
const CURRENT_GAME_ENDPOINTS = CASINO_ENDPOINTS;
export const PROPOSED_FREDAGSFETT_CASINO_ENDPOINTS = CASINO_ENDPOINTS;

const state = {
  rouletteBets: [],
  rouletteLastBets: [],
};

async function requestJson(path, { fetchImpl = globalThis.fetch, method = 'GET', body } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch saknas.');
  const options = {
    method,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
  };
  if (body !== undefined) options.body = JSON.stringify(body);

  const res = await fetchImpl(path, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.error || 'Casino-API:t svarade inte.');
    error.status = res.status;
    error.data = data;
    throw error;
  }
  return data;
}

function normalizeMode(mode, data) {
  return {
    mode,
    ...data,
  };
}

function normalizeAmount(value, label) {
  const amount = Math.floor(Number(value));
  if (!Number.isFinite(amount) || amount <= 0) throw new Error(`${label} måste vara större än 0.`);
  return amount;
}

export async function loadCasinoState(options = {}) {
  const [blackjack, roulette, holdem] = await Promise.all([
    loadBlackjackState(options),
    loadRouletteState(options),
    loadHoldemState(options),
  ]);
  return {
    loaded_at: new Date().toISOString(),
    modes: { blackjack, roulette, holdem },
  };
}

export async function loadBlackjackState(options = {}) {
  const data = await requestJson(CURRENT_GAME_ENDPOINTS.casino.blackjack, options);
  return normalizeMode('blackjack', data);
}

export async function blackjackDeal(bet, options = {}) {
  const data = await requestJson(CURRENT_GAME_ENDPOINTS.blackjack.deal, {
    ...options,
    method: 'POST',
    body: { bet: normalizeAmount(bet, 'Insatsen') },
  });
  return normalizeMode('blackjack', data);
}

export async function blackjackHit(options = {}) {
  return blackjackAction('hit', options);
}

export async function blackjackStand(options = {}) {
  return blackjackAction('stand', options);
}

export async function blackjackDouble(options = {}) {
  return blackjackAction('double', options);
}

export async function blackjackSplit(options = {}) {
  return blackjackAction('split', options);
}

export async function blackjackInsurance(options = {}) {
  return blackjackAction('insurance', options);
}

async function blackjackAction(action, options) {
  const data = await requestJson(CURRENT_GAME_ENDPOINTS.blackjack[action], {
    ...options,
    method: 'POST',
    body: {},
  });
  return normalizeMode('blackjack', data);
}

export async function loadRouletteState(options = {}) {
  const data = await requestJson(CURRENT_GAME_ENDPOINTS.casino.roulette, options);
  return normalizeMode('roulette', {
    ...data,
    pending_bets: [...state.rouletteBets],
  });
}

export function roulettePlaceBet(bet) {
  const normalized = {
    kind: String(bet?.kind || ''),
    target: bet?.target,
    stake: normalizeAmount(bet?.stake, 'Rouletteinsatsen'),
  };
  if (!normalized.kind) throw new Error('Roulettetyp saknas.');
  state.rouletteBets.push(normalized);
  return normalizeMode('roulette', { pending_bets: [...state.rouletteBets] });
}

export async function rouletteSpin(options = {}) {
  const bets = [...state.rouletteBets];
  if (!bets.length) throw new Error('Lägg minst en rouletteinsats först.');
  state.rouletteLastBets = bets;
  state.rouletteBets = [];
  const data = await requestJson(CURRENT_GAME_ENDPOINTS.roulette.spin, {
    ...options,
    method: 'POST',
    body: { bets },
  });
  return normalizeMode('roulette', data);
}

export async function rouletteRepeat(options = {}) {
  const bets = state.rouletteLastBets.length ? state.rouletteLastBets : state.rouletteBets;
  if (!bets.length) throw new Error('Det finns ingen tidigare rouletteinsats att upprepa.');
  state.rouletteLastBets = [...bets];
  state.rouletteBets = [];
  const data = await requestJson(CURRENT_GAME_ENDPOINTS.roulette.spin, {
    ...options,
    method: 'POST',
    body: { bets },
  });
  return normalizeMode('roulette', data);
}

export async function loadHoldemState(options = {}) {
  const data = await requestJson(CURRENT_GAME_ENDPOINTS.casino.holdem, options);
  return normalizeMode('holdem', data);
}

export async function holdemBuyIn(amount, options = {}) {
  const data = await requestJson(CURRENT_GAME_ENDPOINTS.holdem.buyIn, {
    ...options,
    method: 'POST',
    body: { buy_in: normalizeAmount(amount, 'Buy-in') },
  });
  return normalizeMode('holdem', data);
}

export async function holdemAction(action, options = {}) {
  const data = await requestJson(CURRENT_GAME_ENDPOINTS.holdem.action, {
    ...options,
    method: 'POST',
    body: { action: String(action || '') },
  });
  return normalizeMode('holdem', data);
}

export async function holdemNextHand(options = {}) {
  const data = await requestJson(CURRENT_GAME_ENDPOINTS.holdem.nextHand, {
    ...options,
    method: 'POST',
    body: {},
  });
  return normalizeMode('holdem', data);
}

export async function holdemLeave(options = {}) {
  const data = await requestJson(CURRENT_GAME_ENDPOINTS.holdem.leave, {
    ...options,
    method: 'POST',
    body: {},
  });
  return normalizeMode('holdem', data);
}

function initCasinoTabs(root = document) {
  const tabs = [...root.querySelectorAll('[data-casino-tab]')];
  const panels = [...root.querySelectorAll('[data-casino-panel]')];
  if (!tabs.length || !panels.length) return;

  function activate(mode) {
    for (const tab of tabs) {
      const active = tab.dataset.casinoTab === mode;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    }
    for (const panel of panels) {
      panel.hidden = panel.dataset.casinoPanel !== mode;
    }
  }

  for (const tab of tabs) {
    tab.addEventListener('click', () => activate(tab.dataset.casinoTab));
    tab.addEventListener('keydown', event => {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      event.preventDefault();
      const index = tabs.indexOf(tab);
      const offset = event.key === 'ArrowRight' ? 1 : -1;
      const next = tabs[(index + offset + tabs.length) % tabs.length];
      next.focus();
      activate(next.dataset.casinoTab);
    });
  }
}

/* ──────────────────────────────────────────────────────────────────────
 * Live blackjack table renderer + click handlers.
 * Roulette + Hold'em still use the scaffold placeholder UI; this pass
 * focuses on getting blackjack fully playable through the new aliases.
 * ────────────────────────────────────────────────────────────────────── */

const blackjackUiState = { selectedBet: 250, dealing: false };

function $bj(id) { return document.getElementById(id); }

function setBjStatus(text, klass = '') {
  const el = $bj('bj-status');
  if (!el) return;
  el.textContent = text || '';
  el.className = `bj-status${klass ? ' ' + klass : ' idle'}`;
}

function setBjError(msg) {
  const el = $bj('bj-error');
  if (!el) return;
  if (msg) {
    el.textContent = msg;
    el.hidden = false;
  } else {
    el.textContent = '';
    el.hidden = true;
  }
}

function renderBjCards(containerId, cards) {
  const wrap = $bj(containerId);
  if (!wrap) return;
  if (!cards || !cards.length) { wrap.innerHTML = ''; return; }
  wrap.innerHTML = cards.map(card => {
    if (card.hidden) {
      return '<div class="bj-card" data-color="hidden" aria-label="Dolt kort"><span class="suit" aria-hidden="true">𓀂</span></div>';
    }
    return `<div class="bj-card" data-color="${escapeAttr(card.color || 'black')}">
      <span class="rank">${escapeText(card.rank ?? '')}</span>
      <span class="suit">${escapeText(card.suit ?? '')}</span>
      <span class="rank-end">${escapeText(card.rank ?? '')}</span>
    </div>`;
  }).join('');
}

function escapeText(v) {
  return String(v ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}
function escapeAttr(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' }[c]));
}

function fmtSek(n) {
  return Number(n || 0).toLocaleString('sv-SE');
}

/* ──────────────────────────────────────────────────────────────────────
 * Hand history ledgers — sessionStorage-backed strips under each game's
 * felt. Persist across page refreshes for the duration of the tab. The
 * server doesn't expose a per-player ledger endpoint so we record locally
 * the moment each hand finishes; one entry per finalised result.
 * ────────────────────────────────────────────────────────────────────── */
const HISTORY_LIMIT = 12;

function loadHistory(key) {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.slice(0, HISTORY_LIMIT) : [];
  } catch { return []; }
}
function saveHistory(key, list) {
  try { sessionStorage.setItem(key, JSON.stringify(list.slice(0, HISTORY_LIMIT))); } catch {}
}

const BJ_HISTORY_KEY = 'ff-casino-bj-history';
const HOLD_HISTORY_KEY = 'ff-casino-hold-history';
const _bjSeen = new Set();   // hand IDs already recorded this page-life
const _holdSeen = new Set(); // (table-id, hand-number) keys already recorded

function recordBjHistory(hand) {
  if (!hand || !hand.id || !hand.finished) return;
  if (_bjSeen.has(hand.id)) return;
  _bjSeen.add(hand.id);
  const list = loadHistory(BJ_HISTORY_KEY);
  const entries = [];
  if (hand.result) entries.push({ result: hand.result, bet: hand.bet, label: 'main' });
  if (hand.split_result) entries.push({ result: hand.split_result, bet: hand.split_bet, label: 'split' });
  for (const e of entries) {
    list.unshift({ ...e, at: Date.now() });
  }
  saveHistory(BJ_HISTORY_KEY, list);
  renderBjHistory();
}

function renderBjHistory() {
  const row = document.getElementById('bj-history-row');
  const strip = document.getElementById('bj-history-strip');
  if (!row || !strip) return;
  const list = loadHistory(BJ_HISTORY_KEY);
  if (!list.length) { row.hidden = true; return; }
  row.hidden = false;
  strip.innerHTML = list.map(h => {
    const cls = (h.result === 'win' || h.result === 'blackjack') ? 'win'
              : (h.result === 'push') ? 'push' : 'lose';
    const sign = cls === 'win' ? '+' : cls === 'lose' ? '−' : '±';
    const num = cls === 'win'  ? Math.round(h.bet * (h.result === 'blackjack' ? 1.5 : 1))
              : cls === 'lose' ? h.bet
              : 0;
    const labelPrefix = h.label === 'split' ? 'SPLIT · ' : '';
    return `<span class="history-tag ${cls}" title="${escapeAttr(labelPrefix + (h.result || ''))} · insats ${fmtSek(h.bet)} kr">
      <span class="delta-num ${cls === 'win' ? 'pos' : cls === 'lose' ? 'neg' : ''}">${sign}${fmtSek(num)}</span>
    </span>`;
  }).join('');
}

function recordHoldHistory(table) {
  if (!table || table.street !== 'hand_over') return;
  const key = `${table.id}|${table.hand_number}`;
  if (_holdSeen.has(key)) return;
  _holdSeen.add(key);
  const list = loadHistory(HOLD_HISTORY_KEY);
  list.unshift({
    hand: table.hand_number,
    pot: table.pot,
    result: table.result || null, // win / lose / push from server
    message: table.message || '',
    at: Date.now(),
  });
  saveHistory(HOLD_HISTORY_KEY, list);
  renderHoldHistory();
}

function renderHoldHistory() {
  const row = document.getElementById('hold-history-row');
  const strip = document.getElementById('hold-history-strip');
  if (!row || !strip) return;
  const list = loadHistory(HOLD_HISTORY_KEY);
  if (!list.length) { row.hidden = true; return; }
  row.hidden = false;
  strip.innerHTML = list.map(h => {
    const cls = h.result === 'win' ? 'win' : h.result === 'lose' ? 'lose' : h.result === 'push' ? 'push' : '';
    return `<span class="history-tag ${cls}" title="Hand #${h.hand} · pot ${fmtSek(h.pot)} kr — ${escapeAttr(h.message || '')}">
      #${h.hand} · ${fmtSek(h.pot)} kr
    </span>`;
  }).join('');
}

function bjResultBadge(result) {
  if (!result) return '';
  const map = {
    win: { label: 'VINST', cls: 'win' },
    blackjack: { label: 'BLACKJACK', cls: 'win' },
    lose: { label: 'FÖRLUST', cls: 'lose' },
    bust: { label: 'BUST', cls: 'lose' },
    dealer_blackjack: { label: 'DEALER BJ', cls: 'lose' },
    push: { label: 'PUSH', cls: 'push' },
  };
  const m = map[result];
  if (!m) return '';
  return ` <span class="bj-hand-result ${m.cls}">${m.label}</span>`;
}

function renderBlackjack(state) {
  const cashEl = $bj('casino-cash');
  const subEl = $bj('casino-cash-sub');
  if (cashEl) cashEl.textContent = fmtSek(state.player_cash);
  if (state.idle) {
    if (subEl) subEl.textContent = `Insats ${state.min_bet}–${state.max_bet} kr`;
    renderBjCards('bj-dealer-cards', []);
    renderBjCards('bj-player-cards', []);
    $bj('bj-dealer-total').textContent = '—';
    $bj('bj-player-total').textContent = '—';
    // reset row labels (drop any bet/result chips from a previous hand)
    document.getElementById('bj-player-row-extras')?.replaceChildren();
    document.getElementById('bj-dealer-row-extras')?.replaceChildren();
    $bj('bj-split-row').hidden = true;
    document.getElementById('bj-player-row')?.classList.remove('active');
    document.getElementById('bj-split-row')?.classList.remove('active');
    setBjStatus('Välj insats och tryck Dela för att börja.', 'idle');
    setBjActions({ deal: true });
    return;
  }
  const hand = state.hand || {};
  if (subEl) {
    const totalRisk = (hand.bet || 0) + (hand.split_bet || 0) + (hand.insurance_bet || 0);
    subEl.textContent = `Pågående · ${fmtSek(totalRisk)} kr i spel`;
  }
  renderBjCards('bj-dealer-cards', hand.dealer_cards || []);
  renderBjCards('bj-player-cards', hand.player_cards || []);
  $bj('bj-dealer-total').textContent = hand.dealer_total ?? (hand.dealer_visible_total != null ? `${hand.dealer_visible_total}?` : '—');
  $bj('bj-player-total').textContent = hand.player_total ?? '—';

  // Per-hand bet + result chips
  const playerExtras = document.getElementById('bj-player-row-extras');
  if (playerExtras) {
    const mainResult = hand.split_cards && hand.split_cards.length ? null : hand.result;
    const doubled = hand.doubled ? ' ·×2' : '';
    playerExtras.innerHTML = `<span class="bj-bet-tag">${fmtSek(hand.bet)} kr${doubled}</span>${bjResultBadge(mainResult)}`;
  }
  // Dealer side: surface insurance bet here, plus dealer_blackjack outcome
  const dealerExtras = document.getElementById('bj-dealer-row-extras');
  if (dealerExtras) {
    const parts = [];
    if (hand.insurance_bet) {
      parts.push(`<span class="bj-bet-tag amber">Insurance ${fmtSek(hand.insurance_bet)} kr</span>`);
    }
    dealerExtras.innerHTML = parts.join('');
  }

  // Split row
  if (hand.split_cards && hand.split_cards.length) {
    $bj('bj-split-row').hidden = false;
    renderBjCards('bj-split-cards', hand.split_cards);
    $bj('bj-split-total').textContent = hand.split_total ?? '—';
    const splitExtras = document.getElementById('bj-split-row-extras');
    if (splitExtras) {
      const doubled = hand.split_doubled ? ' ·×2' : '';
      splitExtras.innerHTML = `<span class="bj-bet-tag">${fmtSek(hand.split_bet)} kr${doubled}</span>${bjResultBadge(hand.split_result)}`;
    }
    // Reflect main hand result separately too once we're past split_turn
    if (playerExtras && hand.finished) {
      playerExtras.innerHTML = `<span class="bj-bet-tag">${fmtSek(hand.bet)} kr${hand.doubled ? ' ·×2' : ''}</span>${bjResultBadge(hand.result)}`;
    }
  } else {
    $bj('bj-split-row').hidden = true;
  }

  // Active-hand indicator during split_turn (the API switches the action to
  // the split cards once you finish the main hand).
  const playerRowEl = document.getElementById('bj-player-row');
  const splitRowEl = document.getElementById('bj-split-row');
  playerRowEl?.classList.toggle('active', !hand.finished && !hand.in_split_turn && hand.split_cards?.length > 0);
  splitRowEl?.classList.toggle('active', !!hand.in_split_turn);
  // If there's no split at all, highlight the player row as active by default
  if (!hand.split_cards?.length) playerRowEl?.classList.toggle('active', !hand.finished);

  let klass = 'idle';
  if (hand.result === 'win' || hand.result === 'blackjack') klass = 'win';
  else if (hand.result === 'lose' || hand.result === 'bust' || hand.result === 'dealer_blackjack') klass = 'lose';
  else if (hand.result === 'push') klass = 'push';
  setBjStatus(hand.message || '', klass);

  if (hand.finished) {
    setBjActions({ deal: true });
    recordBjHistory(hand);
  } else {
    setBjActions({
      hit: !!hand.can_hit,
      stand: !!hand.can_stand,
      double: !!hand.can_double,
      split: !!hand.can_split,
      insurance: !!hand.can_insurance,
    });
  }
}

function setBjActions(enabled) {
  ['deal','hit','stand','double','split','insurance'].forEach(name => {
    const btn = document.querySelector(`[data-bj-action="${name}"]`);
    if (btn) btn.disabled = !enabled[name];
  });
}

function initBjBetPills() {
  const pills = document.querySelectorAll('#bj-bet-pills .bet-pill');
  pills.forEach(p => {
    p.addEventListener('click', () => {
      blackjackUiState.selectedBet = Number(p.dataset.bet) || 250;
      pills.forEach(o => o.setAttribute('aria-pressed', o === p ? 'true' : 'false'));
    });
  });
}

function initBjActions() {
  document.querySelectorAll('[data-bj-action]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const action = btn.dataset.bjAction;
      setBjError('');
      setBjActions({}); // disable all while in-flight
      try {
        let state;
        if (action === 'deal')           state = await blackjackDeal(blackjackUiState.selectedBet);
        else if (action === 'hit')       state = await blackjackHit();
        else if (action === 'stand')     state = await blackjackStand();
        else if (action === 'double')    state = await blackjackDouble();
        else if (action === 'split')     state = await blackjackSplit();
        else if (action === 'insurance') state = await blackjackInsurance();
        if (state) renderBlackjack(state);
      } catch (err) {
        setBjError(err.message || 'Något gick fel.');
        // Re-fetch the state so the UI doesn't get stuck disabled
        try { renderBlackjack(await loadBlackjackState()); } catch {}
      }
    });
  });
}

async function bootBlackjack() {
  renderBjHistory();
  try {
    renderBlackjack(await loadBlackjackState());
  } catch (err) {
    const el = document.getElementById('bj-error');
    if (el) {
      el.innerHTML = escapeText(err.message || 'Kunde inte ladda casinot.') +
        ' <button type="button" onclick="bootBlackjack()" style="margin-left:0.4em;padding:0.15rem 0.5rem;font:inherit;border:1px solid currentColor;border-radius:4px;background:transparent;cursor:pointer;">Försök igen</button>';
      el.hidden = false;
    }
    const sub = document.getElementById('casino-cash-sub');
    if (sub) sub.textContent = 'Offline';
  }
}

/* ──────────────────────────────────────────────────────────────────────
 * Roulette: European wheel grid (0–36), clickable cells for inside +
 * outside bets, live "pending bets" display, spin + history.
 *
 * Bet vocabulary (matches the Mosquito server-side schema):
 *   { kind: 'straight',  target: 0–36 }           inside, single number
 *   { kind: 'red'|'black'|'odd'|'even'|'low'|'high' }
 *   { kind: 'dozen',     target: 1|2|3 }
 *   { kind: 'column',    target: 1|2|3 }
 * ────────────────────────────────────────────────────────────────────── */

const RED_NUMS = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
const rouletteUi = { stake: 100, pendings: [] };

function rouletteColorFor(n) {
  if (n === 0) return 'green';
  return RED_NUMS.has(n) ? 'red' : 'black';
}

function $rou(id) { return document.getElementById(id); }

function setRouStatus(text, klass = 'idle') {
  const el = $rou('rou-status');
  if (!el) return;
  el.textContent = text || '';
  el.className = `bj-status ${klass}`;
}

function setRouError(msg) {
  const el = $rou('rou-error');
  if (!el) return;
  if (msg) { el.textContent = msg; el.hidden = false; }
  else { el.textContent = ''; el.hidden = true; }
}

function renderRouletteGrid() {
  const grid = $rou('rou-grid');
  if (!grid) return;
  // 14 columns: zero + 12 number columns + outside (2:1)
  const cells = [];
  // Zero spans 3 rows
  cells.push(`<div class="rou-cell rou-zero" data-bet='${JSON.stringify({kind:'straight',target:0})}' data-color="green" style="grid-row:1/span 3; grid-column:1/span 1;"><span>0</span></div>`);
  // 12 columns × 3 rows. Top row in roulette is 3,6,9,...,36; middle 2,5,...,35; bottom 1,4,...,34.
  // Standard "American/European" layout: row 1 = top (3..36), row 2 = middle (2..35), row 3 = bottom (1..34)
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 12; col++) {
      // bottom row is 1..34, middle 2..35, top 3..36 → number = col*3 + (3-row)
      const n = col * 3 + (3 - row);
      const c = rouletteColorFor(n);
      cells.push(`<div class="rou-cell" data-bet='${JSON.stringify({kind:'straight',target:n})}' data-color="${c}" style="grid-row:${row+1}/span 1; grid-column:${col+2}/span 1;"><span>${n}</span></div>`);
    }
    // 2:1 column bet at the end (right edge): row 1 → column 3 (numbers 3,6,9,...,36), row 2 → column 2, row 3 → column 1
    const colBet = 3 - row;
    cells.push(`<div class="rou-cell outside" data-bet='${JSON.stringify({kind:'column',target:colBet})}' style="grid-row:${row+1}/span 1; grid-column:14/span 1;">2:1</div>`);
  }
  // Bottom row: 3 dozens spanning 4 cols each, then red/black/odd/even/low/high stretched below
  // We'll keep this simple: one dozen row + a second row of even-money below it.
  cells.push(`<div class="rou-cell outside" data-bet='${JSON.stringify({kind:'dozen',target:1})}'  style="grid-row:4/span 1; grid-column:2/span 4;">1st 12</div>`);
  cells.push(`<div class="rou-cell outside" data-bet='${JSON.stringify({kind:'dozen',target:2})}'  style="grid-row:4/span 1; grid-column:6/span 4;">2nd 12</div>`);
  cells.push(`<div class="rou-cell outside" data-bet='${JSON.stringify({kind:'dozen',target:3})}'  style="grid-row:4/span 1; grid-column:10/span 4;">3rd 12</div>`);
  grid.innerHTML = cells.join('');
  // Even-money strip below the grid — render as a second row in the same grid
  const evenStrip = document.createElement('div');
  evenStrip.className = 'rou-grid';
  evenStrip.style.gridTemplateColumns = 'repeat(6, 1fr)';
  evenStrip.style.gridTemplateRows = '1.7rem';
  evenStrip.style.marginTop = '0.4rem';
  evenStrip.innerHTML = [
    {kind:'low',  label:'1–18'},
    {kind:'even', label:'Even'},
    {kind:'red',  label:'Röd', color:'red'},
    {kind:'black',label:'Svart', color:'black'},
    {kind:'odd', label:'Odd'},
    {kind:'high', label:'19–36'},
  ].map(o =>
    `<div class="rou-cell ${o.color ? '' : 'outside'}" data-bet='${JSON.stringify({kind:o.kind})}'${o.color ? ` data-color="${o.color}"` : ''}>${o.label}</div>`
  ).join('');
  grid.parentNode.insertBefore(evenStrip, grid.nextSibling);

  grid.addEventListener('click', onRouCellClick);
  evenStrip.addEventListener('click', onRouCellClick);
}

function rouBetKey(bet) {
  // Stable key for grouping pending chips by cell (so we can stack them).
  if (!bet) return '';
  return `${bet.kind}|${bet.target ?? ''}`;
}

function onRouCellClick(event) {
  const cell = event.target.closest('[data-bet]');
  if (!cell) return;
  let bet;
  try { bet = JSON.parse(cell.dataset.bet); } catch { return; }
  bet.stake = rouletteUi.stake;
  try {
    roulettePlaceBet(bet);
    rouletteUi.pendings.push(bet);
    renderRouPendings();
    renderRouCellStacks();
  } catch (err) {
    setRouError(err.message || 'Kunde inte lägga insats.');
  }
}

// Paint a stacked chip indicator on each cell where the user has dropped
// pending bets. Stake totals are summed per cell.
function renderRouCellStacks() {
  const grid = $rou('rou-grid');
  if (!grid) return;
  // Wipe existing chip-stack markers
  grid.querySelectorAll('.chip-stack').forEach(n => n.remove());
  document.querySelectorAll('#casino-panel-roulette .rou-cell .chip-stack').forEach(n => n.remove());
  // Re-aggregate
  const totals = new Map();
  for (const b of rouletteUi.pendings) {
    const k = rouBetKey(b);
    totals.set(k, (totals.get(k) || 0) + (b.stake || 0));
  }
  // Apply to every visible cell whose data-bet matches
  document.querySelectorAll('#casino-panel-roulette [data-bet]').forEach(cell => {
    let bet;
    try { bet = JSON.parse(cell.dataset.bet); } catch { return; }
    const total = totals.get(rouBetKey(bet)) || 0;
    if (total > 0) {
      const chip = document.createElement('span');
      chip.className = 'chip-stack';
      chip.textContent = total >= 1000 ? `${Math.round(total/100)/10}k` : String(total);
      chip.title = `${rouBetLabel(bet)} · ${fmtSek(total)} kr`;
      cell.appendChild(chip);
    }
  });
}

function rouBetLabel(b) {
  if (!b) return '';
  if (b.kind === 'straight') return `Straight · ${b.target}`;
  if (b.kind === 'red')   return 'Röd (jämn vinst)';
  if (b.kind === 'black') return 'Svart (jämn vinst)';
  if (b.kind === 'odd')   return 'Udda (jämn vinst)';
  if (b.kind === 'even')  return 'Jämn (jämn vinst)';
  if (b.kind === 'low')   return '1–18 (jämn vinst)';
  if (b.kind === 'high')  return '19–36 (jämn vinst)';
  if (b.kind === 'dozen') return `Dozen ${b.target} (2:1)`;
  if (b.kind === 'column') return `Kolumn ${b.target} (2:1)`;
  return b.kind;
}

function renderRouPendings() {
  const wrap = $rou('rou-pendings');
  const staked = $rou('rou-staked');
  const spinBtn = document.querySelector('[data-rou-action="spin"]');
  const clearBtn = document.querySelector('[data-rou-action="clear"]');
  const total = rouletteUi.pendings.reduce((s, b) => s + (b.stake || 0), 0);
  if (staked) staked.textContent = `${fmtSek(total)} kr`;
  if (!wrap) return;
  if (!rouletteUi.pendings.length) {
    wrap.textContent = 'Klicka i rutnätet för att lägga marker.';
    if (spinBtn) spinBtn.disabled = true;
    if (clearBtn) clearBtn.disabled = true;
    renderRouCellStacks();
    return;
  }
  // Aggregate same-cell bets so the pending list shows one chip per target
  // with a summed stake (cleaner UX than 5 chips on the same number).
  const agg = new Map();
  for (const b of rouletteUi.pendings) {
    const k = rouBetKey(b);
    const cur = agg.get(k) || { kind: b.kind, target: b.target, stake: 0, count: 0 };
    cur.stake += b.stake || 0;
    cur.count += 1;
    agg.set(k, cur);
  }
  wrap.innerHTML = [...agg.values()].map(b => {
    const label = b.kind === 'straight' ? `${b.target}` :
                  b.kind === 'red' ? 'Röd' :
                  b.kind === 'black' ? 'Svart' :
                  b.kind === 'odd' ? 'Odd' :
                  b.kind === 'even' ? 'Even' :
                  b.kind === 'low' ? '1–18' :
                  b.kind === 'high' ? '19–36' :
                  b.kind === 'dozen' ? `Dozen ${b.target}` :
                  b.kind === 'column' ? `Kol ${b.target}` :
                  b.kind;
    const countTag = b.count > 1 ? ` ×${b.count}` : '';
    const tip = `${rouBetLabel(b)} — ${b.count} marker à ${fmtSek(Math.round(b.stake / b.count))} kr · totalt ${fmtSek(b.stake)} kr`;
    return `<span class="rou-pending-chip" title="${escapeAttr(tip)}"><span class="dot"></span>${escapeText(label)}${countTag} · ${fmtSek(b.stake)} kr</span>`;
  }).join('');
  if (spinBtn) spinBtn.disabled = false;
  if (clearBtn) clearBtn.disabled = false;
  renderRouCellStacks();
}

function renderRouletteState(state, lastSpin) {
  if (state.player_cash != null) {
    const cashEl = document.getElementById('casino-cash');
    if (cashEl) cashEl.textContent = fmtSek(state.player_cash);
  }
  const lastEl = $rou('rou-last');
  if (lastEl) {
    const ls = lastSpin || state.last_spin;
    if (ls && ls.winning_number != null) {
      lastEl.textContent = `${ls.winning_number}`;
      lastEl.style.color = ls.winning_color === 'red' ? '#f0a896' :
                            ls.winning_color === 'green' ? '#c0e6c8' : '#e7e1cc';
    } else {
      lastEl.textContent = '—';
    }
  }
  const history = $rou('rou-history');
  if (history) {
    const recent = (state.recent || []).slice(0, 12);
    history.innerHTML = recent.map((r, i) => {
      const color = r.winning_color || rouletteColorFor(r.winning_number);
      return `<span class="dot${i === 0 ? ' latest' : ''}" data-color="${color}">${r.winning_number}</span>`;
    }).join('');
  }
}

function initRouletteStakePills() {
  document.querySelectorAll('#rou-stake-pills .bet-pill').forEach(p => {
    p.addEventListener('click', () => {
      rouletteUi.stake = Number(p.dataset.stake) || 100;
      document.querySelectorAll('#rou-stake-pills .bet-pill').forEach(o => o.setAttribute('aria-pressed', o === p ? 'true' : 'false'));
    });
  });
}

function initRouletteActions() {
  document.querySelectorAll('[data-rou-action]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const action = btn.dataset.rouAction;
      setRouError('');
      if (action === 'clear') {
        rouletteUi.pendings = [];
        // Adapter has internal state for queued bets — reset it by re-syncing
        try { renderRouletteState(await loadRouletteState()); } catch {}
        renderRouPendings();
        renderRouCellStacks();
        setRouStatus('Insatser rensade.', 'idle');
        return;
      }
      btn.disabled = true;
      try {
        if (action === 'spin') {
          const state = await rouletteSpin();
          rouletteUi.pendings = [];
          renderRouPendings();
          renderRouletteState(state);
          const ls = state.last_spin;
          if (ls) {
            const color = ls.winning_color || rouletteColorFor(ls.winning_number);
            const colorLabel = color === 'red' ? 'rött' : color === 'black' ? 'svart' : 'grönt';
            setRouStatus(`Snurr: ${ls.winning_number} (${colorLabel}). ${ls.payout != null ? `Vinst: ${fmtSek(ls.payout)} kr.` : ''}`,
              ls.payout > 0 ? 'win' : 'lose');
          }
        } else if (action === 'repeat') {
          const state = await rouletteRepeat();
          rouletteUi.pendings = [];
          renderRouPendings();
          renderRouletteState(state);
          const ls = state.last_spin;
          if (ls) {
            const color = ls.winning_color || rouletteColorFor(ls.winning_number);
            setRouStatus(`Snurr (upprepat): ${ls.winning_number} ${color}.`, ls.payout > 0 ? 'win' : 'lose');
          }
        }
      } catch (err) {
        setRouError(err.message || 'Något gick fel.');
      } finally {
        btn.disabled = false;
        renderRouPendings();
      }
    });
  });
}

async function bootRoulette() {
  renderRouletteGrid();
  initRouletteStakePills();
  initRouletteActions();
  try {
    renderRouletteState(await loadRouletteState());
  } catch (err) {
    const el = document.getElementById('rou-error');
    if (el) {
      el.innerHTML = escapeText(err.message || 'Kunde inte ladda rouletten.') +
        ' <button type="button" onclick="bootRoulette()" style="margin-left:0.4em;padding:0.15rem 0.5rem;font:inherit;border:1px solid currentColor;border-radius:4px;background:transparent;cursor:pointer;">Försök igen</button>';
      el.hidden = false;
    }
  }
}

/* ──────────────────────────────────────────────────────────────────────
 * Texas Hold'em: oval table with 4 seats (top/right/bottom/left), 5 community
 * cards in the middle, pot label. Player seat (kind === 'player') stays at
 * pos 2 (bottom-center) so the user sees their own hand closest.
 * ────────────────────────────────────────────────────────────────────── */
const holdemUi = { buyIn: 2500 };

function $hold(id) { return document.getElementById(id); }
function setHoldStatus(text, klass = 'idle') {
  const el = $hold('hold-status');
  if (!el) return;
  el.textContent = text || '';
  el.className = `bj-status ${klass}`;
}
function setHoldError(msg) {
  const el = $hold('hold-error');
  if (!el) return;
  if (msg) { el.textContent = msg; el.hidden = false; }
  else { el.textContent = ''; el.hidden = true; }
}

// Hold'em archetype → short Swedish flavour label. Matches the
// HOLDEM_ARCHETYPES enum on the server side (see functions/api/[[route]].ts).
const HOLD_ARCHETYPE_LABEL = {
  tight: 'noggrann',
  loose: 'lös',
  aggressive: 'aggressiv',
  passive: 'passiv',
  gambler: 'vild',
  shark: 'haj',
};
const HOLD_ARCHETYPE_TONE = {
  tight: 'tone-cool', loose: 'tone-warm', aggressive: 'tone-hot',
  passive: 'tone-cool', gambler: 'tone-warm', shark: 'tone-hot',
};

function renderHoldCardBig(card) {
  if (!card || card.hidden) return '<div class="hold-card hold-big-card" data-color="hidden" aria-label="Dolt kort"></div>';
  return `<div class="hold-card hold-big-card" data-color="${escapeAttr(card.color)}">${escapeText(card.rank || '')}${escapeText(card.suit || '')}</div>`;
}
function renderHoldCardSmall(card) {
  if (!card || card.hidden) return '<div class="hold-card" data-color="hidden" aria-label="Dolt kort"></div>';
  return `<div class="hold-card" data-color="${escapeAttr(card.color)}">${escapeText(card.rank || '')}${escapeText(card.suit || '')}</div>`;
}

function renderHoldem(state) {
  const cashEl = document.getElementById('casino-cash');
  if (cashEl && state.player_cash != null) cashEl.textContent = fmtSek(state.player_cash);

  const empty = $hold('hold-empty');
  const community = $hold('hold-community');
  const pot = $hold('hold-pot');
  const table = $hold('hold-table');

  // Remove any existing seat divs (we rebuild on each render)
  table?.querySelectorAll('.hold-seat').forEach(n => n.remove());

  if (state.idle || !state.table) {
    if (empty) {
      empty.hidden = false;
      empty.textContent = `Köp in dig (${fmtSek(state.min_buy_in)}–${fmtSek(state.max_buy_in)} kr) för att sätta dig vid bordet. Blinds ${state.small_blind}/${state.big_blind}.`;
    }
    if (community) community.innerHTML = '';
    if (pot) pot.textContent = 'Pot —';
    setHoldStatus('Köp in dig för att starta.', 'idle');
    setHoldActions({ buyIn: true });
    return;
  }

  const t = state.table;
  if (empty) empty.hidden = true;
  if (pot) pot.textContent = `Pot · ${fmtSek(t.pot)} kr`;
  if (community) community.innerHTML = (t.community_cards || []).map(renderHoldCardBig).join('');

  // The player seat is always rendered at pos 2 (bottom). Other seats fill 0/1/3 in order.
  const positions = [0, 1, 2, 3];
  const playerSeat = (t.seats || []).find(s => s.is_player);
  const otherSeats = (t.seats || []).filter(s => !s.is_player);
  // Lay out: player at pos 2, others at 1, 0, 3 (right, top, left)
  const layout = [];
  if (playerSeat) layout.push({ seat: playerSeat, pos: 2 });
  const otherPositions = [0, 1, 3];
  otherSeats.slice(0, 3).forEach((s, i) => layout.push({ seat: s, pos: otherPositions[i] }));

  for (const { seat, pos } of layout) {
    const isSelf = seat.is_player;
    const cls = ['hold-seat'];
    if (isSelf) cls.push('self');
    if (seat.is_turn) cls.push('turn');
    if (seat.folded) cls.push('folded');
    const cardsHtml = (seat.hole_cards || []).map(renderHoldCardSmall).join('');
    const div = document.createElement('div');
    div.className = cls.join(' ');
    div.dataset.pos = String(pos);
    const blindBadge = seat.small_blind ? 'SB' : seat.big_blind ? 'BB' : seat.dealer ? 'D' : '';
    // Bot personality flavour: archetype is the table-poker trait (tight/loose
    // /aggressive/passive/gambler/shark); personality is the broader NPC
    // disposition. Show archetype as an italic tag, personality only when it
    // adds info (skip generic 'passive').
    const archLabel = !isSelf && seat.archetype ? (HOLD_ARCHETYPE_LABEL[seat.archetype] || seat.archetype) : '';
    const archTone  = HOLD_ARCHETYPE_TONE[seat.archetype] || '';
    const flavor = !isSelf && seat.personality && seat.personality !== seat.archetype
      ? `<span class="seat-personality">${escapeText(seat.personality)}</span>` : '';
    div.innerHTML = `
      <div class="seat-head">
        <span class="name">${escapeText(seat.name || '—')}</span>
        ${blindBadge ? `<span class="seat-badge">${blindBadge}</span>` : ''}
      </div>
      ${archLabel ? `<div class="seat-arche ${archTone}">${escapeText(archLabel)}${flavor}</div>` : ''}
      <div class="stack">${fmtSek(seat.stack)} kr</div>
      <div class="action">${escapeText(seat.last_action || (seat.is_turn ? 'i tur' : ''))}</div>
      <div class="cards">${cardsHtml}</div>
    `;
    table.appendChild(div);
  }

  // Status / message
  let klass = 'idle';
  if (t.result === 'win') klass = 'win';
  else if (t.result === 'lose') klass = 'lose';
  setHoldStatus(t.message || `${t.street.replace('_', ' ')} · Hand #${t.hand_number}`, klass);

  setHoldActions({
    fold: !!t.can_fold,
    check: !!t.can_check,
    call: !!t.can_call,
    bet: !!t.can_bet,
    raise: !!t.can_raise,
    nextHand: !!t.can_next_hand,
    leave: !!t.can_leave,
    buyIn: false, // already seated
  });
  recordHoldHistory(t);
}

function setHoldActions(enabled) {
  ['fold','check','call','bet','raise','next-hand','leave'].forEach(name => {
    const btn = document.querySelector(`[data-hold-action="${name}"]`);
    if (btn) btn.disabled = !enabled[name === 'next-hand' ? 'nextHand' : name];
  });
  const buyBtn = document.querySelector('[data-hold-action="buy-in"]');
  if (buyBtn) buyBtn.disabled = !enabled.buyIn;
}

function initHoldBuyinPills() {
  document.querySelectorAll('#hold-buyin-pills .bet-pill').forEach(p => {
    p.addEventListener('click', () => {
      holdemUi.buyIn = Number(p.dataset.buyin) || 2500;
      document.querySelectorAll('#hold-buyin-pills .bet-pill').forEach(o => o.setAttribute('aria-pressed', o === p ? 'true' : 'false'));
    });
  });
}

function initHoldActions() {
  document.querySelectorAll('[data-hold-action]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const action = btn.dataset.holdAction;
      setHoldError('');
      btn.disabled = true;
      try {
        let state;
        if (action === 'buy-in') {
          state = await holdemBuyIn(holdemUi.buyIn);
        } else if (action === 'next-hand') {
          state = await holdemNextHand();
        } else if (action === 'leave') {
          state = await holdemLeave();
        } else {
          state = await holdemAction(action);
        }
        if (state) renderHoldem(state);
      } catch (err) {
        setHoldError(err.message || 'Något gick fel.');
        try { renderHoldem(await loadHoldemState()); } catch {}
      }
    });
  });
}

async function bootHoldem() {
  initHoldBuyinPills();
  initHoldActions();
  renderHoldHistory();

  // Timeout guard: if loadHoldemState doesn’t resolve within 6 s, show error+retry
  let holdemLoadDone = false;
  const holdemTimeoutId = setTimeout(() => {
    if (holdemLoadDone) return;
    const el = document.getElementById(‘hold-error’);
    if (el) {
      el.innerHTML = ‘Hämtar bordet tog för lång tid.’ +
        ‘ <button type="button" onclick="bootHoldem()" style="margin-left:0.4em;padding:0.15rem 0.5rem;font:inherit;border:1px solid currentColor;border-radius:4px;background:transparent;cursor:pointer;">Försök igen</button>’;
      el.hidden = false;
    }
  }, 6000);

  try {
    renderHoldem(await loadHoldemState());
  } catch (err) {
    const el = document.getElementById(‘hold-error’);
    if (el) {
      el.innerHTML = escapeText(err.message || "Kunde inte ladda Hold’em.") +
        ‘ <button type="button" onclick="bootHoldem()" style="margin-left:0.4em;padding:0.15rem 0.5rem;font:inherit;border:1px solid currentColor;border-radius:4px;background:transparent;cursor:pointer;">Försök igen</button>’;
      el.hidden = false;
    }
  } finally {
    holdemLoadDone = true;
    clearTimeout(holdemTimeoutId);
  }
}

if (typeof window !== 'undefined') {
  window.FredagsfettCasino = {
    loadCasinoState,
    loadBlackjackState,
    blackjackDeal,
    blackjackHit,
    blackjackStand,
    blackjackDouble,
    blackjackSplit,
    blackjackInsurance,
    loadRouletteState,
    roulettePlaceBet,
    rouletteSpin,
    rouletteRepeat,
    loadHoldemState,
    holdemBuyIn,
    holdemAction,
    holdemNextHand,
    holdemLeave,
    endpoints: {
      current: CURRENT_GAME_ENDPOINTS,
      legacy: LEGACY_MOSQUITO_ENDPOINTS,
    },
  };

  document.addEventListener('DOMContentLoaded', () => {
    initCasinoTabs();
    initBjBetPills();
    initBjActions();
    void bootBlackjack();
    void bootRoulette();
    void bootHoldem();
  });
}
