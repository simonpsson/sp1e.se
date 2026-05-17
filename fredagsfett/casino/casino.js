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
      return '<div class="bj-card" data-color="hidden"><span class="suit">𓀂</span></div>';
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
    $bj('bj-split-row').hidden = true;
    setBjStatus('Välj insats och tryck Dela för att börja.', 'idle');
    setBjActions({ deal: true });
    return;
  }
  const hand = state.hand || {};
  if (subEl) subEl.textContent = `Pågående hand · ${fmtSek(hand.bet)} kr`;
  renderBjCards('bj-dealer-cards', hand.dealer_cards || []);
  renderBjCards('bj-player-cards', hand.player_cards || []);
  $bj('bj-dealer-total').textContent = hand.dealer_total ?? (hand.dealer_visible_total != null ? `${hand.dealer_visible_total}?` : '—');
  $bj('bj-player-total').textContent = hand.player_total ?? '—';

  // Split row
  if (hand.split_cards && hand.split_cards.length) {
    $bj('bj-split-row').hidden = false;
    renderBjCards('bj-split-cards', hand.split_cards);
    $bj('bj-split-total').textContent = hand.split_total ?? '—';
  } else {
    $bj('bj-split-row').hidden = true;
  }

  let klass = 'idle';
  if (hand.result === 'win' || hand.result === 'blackjack') klass = 'win';
  else if (hand.result === 'lose' || hand.result === 'bust' || hand.result === 'dealer_blackjack') klass = 'lose';
  else if (hand.result === 'push') klass = 'push';
  setBjStatus(hand.message || '', klass);

  if (hand.finished) {
    setBjActions({ deal: true });
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
  try {
    renderBlackjack(await loadBlackjackState());
  } catch (err) {
    setBjError(err.message || 'Kunde inte ladda casinot.');
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
  } catch (err) {
    setRouError(err.message || 'Kunde inte lägga insats.');
  }
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
    return;
  }
  wrap.innerHTML = rouletteUi.pendings.map(b => {
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
    return `<span class="rou-pending-chip"><span class="dot"></span>${escapeText(label)} · ${fmtSek(b.stake)} kr</span>`;
  }).join('');
  if (spinBtn) spinBtn.disabled = false;
  if (clearBtn) clearBtn.disabled = false;
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
    setRouError(err.message || 'Kunde inte ladda rouletten.');
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

function renderHoldCardBig(card) {
  if (!card || card.hidden) return '<div class="hold-card hold-big-card" data-color="hidden"></div>';
  return `<div class="hold-card hold-big-card" data-color="${escapeAttr(card.color)}">${escapeText(card.rank || '')}${escapeText(card.suit || '')}</div>`;
}
function renderHoldCardSmall(card) {
  if (!card || card.hidden) return '<div class="hold-card" data-color="hidden"></div>';
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
    const blindBadge = seat.small_blind ? ' · SB' : seat.big_blind ? ' · BB' : seat.dealer ? ' · D' : '';
    div.innerHTML = `
      <div class="name">${escapeText(seat.name || '—')}${escapeText(blindBadge)}</div>
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
  try {
    renderHoldem(await loadHoldemState());
  } catch (err) {
    setHoldError(err.message || 'Kunde inte ladda Hold’em.');
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
