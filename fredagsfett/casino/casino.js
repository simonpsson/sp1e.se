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
  });
}
