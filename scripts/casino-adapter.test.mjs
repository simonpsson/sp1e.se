import assert from 'node:assert/strict';
import test from 'node:test';

import {
  blackjackDeal,
  loadCasinoState,
  roulettePlaceBet,
  rouletteRepeat,
} from '../fredagsfett/casino/casino.js';

function jsonResponse(data, ok = true, status = 200) {
  return {
    ok,
    status,
    async json() {
      return data;
    },
  };
}

test('loadCasinoState reads the confirmed Mosquito casino state endpoints with credentials', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.includes('/blackjack/')) return jsonResponse({ hand: { id: 'bj-1' }, player_cash: 1200 });
    if (url.includes('/roulette/')) return jsonResponse({ recent: [], player_cash: 1200 });
    if (url.includes('/holdem/')) return jsonResponse({ table: null, player_cash: 1200 });
    throw new Error(`Unexpected URL ${url}`);
  };

  const state = await loadCasinoState({ fetchImpl });

  assert.deepEqual(calls.map(call => call.url), [
    '/api/game/casino/blackjack/state',
    '/api/game/casino/roulette/state',
    '/api/game/casino/holdem/state',
  ]);
  assert.ok(calls.every(call => call.options.credentials === 'same-origin'));
  assert.equal(state.modes.blackjack.hand.id, 'bj-1');
  assert.equal(state.modes.roulette.recent.length, 0);
  assert.equal(state.modes.holdem.table, null);
});

test('blackjackDeal posts the normalized bet to the confirmed Mosquito action endpoint', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    return jsonResponse({ hand: { bet: 250 } });
  };

  const state = await blackjackDeal(250, { fetchImpl });

  assert.equal(calls[0].url, '/api/game/action/blackjack/start');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.credentials, 'same-origin');
  assert.equal(calls[0].options.headers['Content-Type'], 'application/json');
  assert.equal(calls[0].options.body, JSON.stringify({ bet: 250 }));
  assert.equal(state.mode, 'blackjack');
  assert.equal(state.hand.bet, 250);
});

test('rouletteRepeat replays the most recent queued roulette bets', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    return jsonResponse({ last_spin: { winning_number: 17 }, recent: [] });
  };

  roulettePlaceBet({ kind: 'straight', target: 17, stake: 100 });
  const state = await rouletteRepeat({ fetchImpl });

  assert.equal(calls[0].url, '/api/game/action/roulette/spin');
  assert.equal(calls[0].options.body, JSON.stringify({
    bets: [{ kind: 'straight', target: 17, stake: 100 }],
  }));
  assert.equal(state.mode, 'roulette');
  assert.equal(state.last_spin.winning_number, 17);
});
