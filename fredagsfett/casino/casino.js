const CURRENT_GAME_ENDPOINTS = {
  casino: {
    blackjack: '/api/game/casino/blackjack/state',
    roulette: '/api/game/casino/roulette/state',
    holdem: '/api/game/casino/holdem/state',
  },
  blackjack: {
    deal: '/api/game/action/blackjack/start',
    hit: '/api/game/action/blackjack/hit',
    stand: '/api/game/action/blackjack/stand',
    double: '/api/game/action/blackjack/double',
    split: '/api/game/action/blackjack/split',
    insurance: '/api/game/action/blackjack/insurance',
  },
  roulette: {
    spin: '/api/game/action/roulette/spin',
  },
  holdem: {
    buyIn: '/api/game/action/holdem/start',
    action: '/api/game/action/holdem/act',
    nextHand: '/api/game/action/holdem/next',
    leave: '/api/game/action/holdem/leave',
  },
};

export const PROPOSED_FREDAGSFETT_CASINO_ENDPOINTS = {
  casino: {
    blackjack: '/api/fredagsfett/casino/blackjack/state',
    roulette: '/api/fredagsfett/casino/roulette/state',
    holdem: '/api/fredagsfett/casino/holdem/state',
  },
  blackjack: '/api/fredagsfett/casino/blackjack/:action',
  roulette: '/api/fredagsfett/casino/roulette/:action',
  holdem: '/api/fredagsfett/casino/holdem/:action',
};

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
      proposed: PROPOSED_FREDAGSFETT_CASINO_ENDPOINTS,
    },
  };

  document.addEventListener('DOMContentLoaded', () => initCasinoTabs());
}
