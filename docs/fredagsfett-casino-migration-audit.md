# Fredagsfett Casino Migration Audit

Baseline: this scaffold was prepared in a clean worktree from `origin/main` at `c8f1d7b` because the original local checkout was dirty and did not contain the current `fredagsfett/` app files. Existing Mosquito code was inspected from the current repo files and was not removed or moved.

## Repo Shape

- Cloudflare Pages serves root-level static files. `wrangler.toml` uses `pages_build_output_dir = "."`.
- Cloudflare bindings are `DB` for D1 and `FILES` for R2.
- Fredagsfett static pages live under `fredagsfett/`.
- Fredagsfett auth middleware is `functions/_middleware.ts`; it protects `/fredagsfett/*` and `/api/fredagsfett/*` except login/session and signed iCal routes.
- Fredagsfett API is split into `functions/api/fredagsfett/[[route]].ts`.
- Mosquito remains in `mosquito.html` with its backend in `functions/api/[[route]].ts`.

## Fredagsfett Nav Audit

The main top navigation is duplicated across pages.

- `fredagsfett/hem/index.html:801` owns a separate older `.topbar` / `.nav-row` nav. It now has `Casino` immediately after `Karta` at `fredagsfett/hem/index.html:806`.
- `fredagsfett/kalender/index.html:749` owns a `.ff-topbar` / `.ff-nav-row` nav. `Casino` is after `Karta` at `fredagsfett/kalender/index.html:754`.
- `fredagsfett/sp1wise/index.html:267` owns a `.ff-topbar` / `.ff-nav-row` nav. `Casino` is after `Karta` at `fredagsfett/sp1wise/index.html:272`.
- `fredagsfett/karta/index.html:346` owns a `.ff-topbar` / `.ff-nav-row` nav. `Casino` is after `Karta` at `fredagsfett/karta/index.html:351`.
- `fredagsfett/casino/index.html:223` uses the same `.ff-topbar` shell and marks `Casino` with `aria-current="page"` at `fredagsfett/casino/index.html:228`.
- `fredagsfett/admin/index.html` does not include the main Fredagsfett topbar. It is a dark dev console with a small toolbar link back to Kalender, so no topbar Casino link was added there.

TODO: extract the duplicated nav shell into a shared static include/build step or a tiny client-side shell once the repo has a shared build pattern. Do not do this during the Casino migration unless the surrounding pages are already being refactored.

## Mosquito Casino Frontend Inventory

Important `mosquito.html` sections:

- Static Casino tab and panels start at `mosquito.html:1265`.
- Game mode buttons are `data-casino-mode="blackjack|roulette|holdem"` at `mosquito.html:1271`.
- Blackjack cash/bet/actions are around `mosquito.html:1287` and `mosquito.html:1328`.
- Hold'Em buy-in/actions are around `mosquito.html:1350` and `mosquito.html:1379`.
- Roulette stake/outside/advanced/spin controls are around `mosquito.html:1413`, `mosquito.html:1426`, `mosquito.html:1461`, and `mosquito.html:1475`.
- `defaultCasinoState()` is at `mosquito.html:1636`.
- The Mosquito API helper prefixes calls with `/api/game/` at `mosquito.html:1692`.
- The central click dispatcher watches casino datasets at `mosquito.html:2335`.
- Casino client code begins at `mosquito.html:2985`.
- `loadCasinoState()` is at `mosquito.html:3007`.
- Roulette rendering and slip/history helpers are around `mosquito.html:3154` through `mosquito.html:3330`; `renderCasinoRoulette()` starts at `mosquito.html:3267`.
- `renderCasinoBlackjack()` starts at `mosquito.html:3460`.
- `renderCasinoHoldem()` starts at `mosquito.html:3564`.
- `renderCasino()` mode switch starts at `mosquito.html:3653`.
- Blackjack actions start at `mosquito.html:3705` and `mosquito.html:3720`.
- Hold'Em actions start at `mosquito.html:3740`, `mosquito.html:3755`, `mosquito.html:3773`, and `mosquito.html:3783`.
- Roulette spin/repeat starts at `mosquito.html:3793` and `mosquito.html:3818`.

## UI Extraction Plan

| Part | Migration treatment |
| --- | --- |
| Casino shell/header | Rewrite into Fredagsfett light UI. Keep only the product structure: mode switcher, cash summary, status/result area. |
| Shared money/bet controls | Translate into Fredagsfett controls using `light-ui.css` variables. Preserve bet presets and validation rules behind adapter calls. |
| Blackjack panel | Translate into Fredagsfett light UI. Reuse API concepts for hand state, 3:2 payout, split, double, insurance. Do not copy dark table styling. |
| Roulette panel | Translate. Keep European wheel model, inside/outside bet model and recent spin history behind adapter/API calls. Rebuild visual table for light UI. |
| Texas Hold'Em panel | Translate. Keep fixed-limit table state, buy-in, action availability, seats and showdown data behind adapter/API calls. |
| Result/log/toast system | Reuse Fredagsfett light toast/status conventions. Keep Mosquito messages only where tone still fits Fredagsfett. |
| Audio/sprites | Defer. Only bring assets that survive the Fredagsfett visual direction. |

## Current Casino Backend Routes

Confirmed route dispatch in `functions/api/[[route]].ts`:

- `GET /api/game/casino/blackjack/state` -> `gameGetBlackjackState()` at `functions/api/[[route]].ts:3589`.
- `GET /api/game/casino/roulette/state` -> `gameGetRouletteState()` at `functions/api/[[route]].ts:3837`.
- `GET /api/game/casino/holdem/state` -> `gameGetHoldemState()` at `functions/api/[[route]].ts:6821`.
- `POST /api/game/action/blackjack/start` -> `gameActionBlackjackStart()` at `functions/api/[[route]].ts:3620`.
- `POST /api/game/action/blackjack/hit` -> `gameActionBlackjackHit()` at `functions/api/[[route]].ts:3702`.
- `POST /api/game/action/blackjack/stand` -> `gameActionBlackjackStand()` at `functions/api/[[route]].ts:3740`.
- `POST /api/game/action/blackjack/double` -> `gameActionBlackjackDouble()` at `functions/api/[[route]].ts:3771`.
- `POST /api/game/action/blackjack/split` -> `gameActionBlackjackSplit()` at `functions/api/[[route]].ts:3984`.
- `POST /api/game/action/blackjack/insurance` -> `gameActionBlackjackInsurance()` at `functions/api/[[route]].ts:4027`.
- `POST /api/game/action/roulette/spin` -> `gameActionRouletteSpin()` at `functions/api/[[route]].ts:3850`.
- `POST /api/game/action/holdem/start` -> `gameActionHoldemStart()` at `functions/api/[[route]].ts:6834`.
- `POST /api/game/action/holdem/act` -> `gameActionHoldemAct()` at `functions/api/[[route]].ts:6881`.
- `POST /api/game/action/holdem/next` -> `gameActionHoldemNextHand()` at `functions/api/[[route]].ts:6931`.
- `POST /api/game/action/holdem/leave` -> `gameActionHoldemLeave()` at `functions/api/[[route]].ts:6962`.
- `ensureCasinoStorage()` at `functions/api/[[route]].ts:5270` can create missing Blackjack, Roulette and Hold'Em persistence tables.

Admin routes such as `/api/game/admin-auth`, `/api/game/admin-status`, `/api/game/admin-logout`, and `/api/game/admin` must not be aliased into Fredagsfett Casino.

## Proposed Fredagsfett API Alias Map

The frontend adapter currently calls confirmed `/api/game/...` endpoints. The target backend should add thin authenticated aliases under `/api/fredagsfett/casino/...`.

| Existing endpoint | Proposed Fredagsfett endpoint | Treatment |
| --- | --- | --- |
| `GET /api/game/casino/blackjack/state` | `GET /api/fredagsfett/casino/blackjack/state` | Thin wrapper after Fredagsfett user/device -> game player resolution. |
| `POST /api/game/action/blackjack/start` | `POST /api/fredagsfett/casino/blackjack/deal` | Wrapper; translate `{ bet }`. |
| `POST /api/game/action/blackjack/hit` | `POST /api/fredagsfett/casino/blackjack/hit` | Wrapper. |
| `POST /api/game/action/blackjack/stand` | `POST /api/fredagsfett/casino/blackjack/stand` | Wrapper. |
| `POST /api/game/action/blackjack/double` | `POST /api/fredagsfett/casino/blackjack/double` | Wrapper. |
| `POST /api/game/action/blackjack/split` | `POST /api/fredagsfett/casino/blackjack/split` | Wrapper. |
| `POST /api/game/action/blackjack/insurance` | `POST /api/fredagsfett/casino/blackjack/insurance` | Wrapper. |
| `GET /api/game/casino/roulette/state` | `GET /api/fredagsfett/casino/roulette/state` | Wrapper. |
| `POST /api/game/action/roulette/spin` | `POST /api/fredagsfett/casino/roulette/spin` | Wrapper; preserve `bets[]` shape. |
| `GET /api/game/casino/holdem/state` | `GET /api/fredagsfett/casino/holdem/state` | Wrapper. |
| `POST /api/game/action/holdem/start` | `POST /api/fredagsfett/casino/holdem/buy-in` | Wrapper; translate `{ amount }` or keep `{ buy_in }` consistently. |
| `POST /api/game/action/holdem/act` | `POST /api/fredagsfett/casino/holdem/action` | Wrapper; preserve `{ action }`. |
| `POST /api/game/action/holdem/next` | `POST /api/fredagsfett/casino/holdem/next-hand` | Wrapper. |
| `POST /api/game/action/holdem/leave` | `POST /api/fredagsfett/casino/holdem/leave` | Wrapper. |

Wrappers should not trust a Mosquito `game_session` cookie. They should resolve the Fredagsfett session first, then map to `game_players` through `ff_casino_player_links`.

## SQL Table Inventory

Casino-related Mosquito tables:

- `game_rounds` at `game-schema.sql:7`.
- `game_players` at `game-schema.sql:18`; includes money, respect, health, account link and round.
- `game_action_log` at `game-schema.sql:134`; casino actions log with `type = 'casino'`.
- `game_blackjack_hands` at `game-schema.sql:179` and `game-migration-blackjack.sql:8`.
- `game_holdem_tables` at `game-schema.sql:205` and `game-migration-holdem.sql:10`.
- `game_roulette_spins` at `game-schema.sql:222` and `game-migration-roulette.sql:10`.
- `game_admin_sessions` and `game_admin_audit` at `game-schema.sql:240` and `game-schema.sql:248`.
- `game_accounts` and `game_sessions` at `game-schema.sql:299` and `game-schema.sql:310`, also scaffolded by `game-migration-accounts.sql`.
- `game_assets` exists for Mosquito asset registry but is not required for the Fredagsfett Casino scaffold.

Fredagsfett identity tables:

- `ff_users` at `schema.sql:200`.
- `ff_devices` at `schema.sql:212`.
- `ff_auth_attempts` at `schema.sql:227`.

New scaffold:

- `fredagsfett-casino-migration-001.sql` creates `ff_casino_player_links` with indexes and no destructive changes.

## Auth And Session Bridge Design

- `/fredagsfett/casino` is protected by `functions/_middleware.ts` because it is under `/fredagsfett/`.
- New API aliases should live under `/api/fredagsfett/casino/...`, so the same middleware blocks unauthenticated requests before route code runs.
- The backend implementation should call `requireFredagsfettUser()` from `functions/api/fredagsfett/[[route]].ts:1907` for all money-changing casino actions.
- A bootstrap helper should resolve:
  1. current Fredagsfett `ff_session`,
  2. `ff_devices.id`,
  3. registered `ff_users.id`,
  4. `ff_casino_player_links.game_player_id`,
  5. active `game_players` row.
- Automatic game player creation on first Casino visit is reasonable for registered Fredagsfett users. For unregistered devices, return a registration-needed response instead of creating durable casino money.
- If preserving Mosquito history, link the Fredagsfett user/device to the existing `game_players.id` and leave `game_action_log` untouched.
- Admin/dev endpoints must stay behind existing admin unlocks and must not be exposed under `/api/fredagsfett/casino`.
- Do not bypass Fredagsfett middleware, do not expose secrets, and do not allow client-provided `game_player_id`.

## Frontend Scaffold Added

- `fredagsfett/casino/index.html` uses the shared light UI shell and `aria-current="page"` on the Casino nav link.
- `fredagsfett/casino/casino.js` defines the adapter surface requested for future migration:
  - `loadCasinoState()`
  - `loadBlackjackState()`
  - `blackjackDeal(bet)`
  - `blackjackHit()`
  - `blackjackStand()`
  - `blackjackDouble()`
  - `blackjackSplit()`
  - `blackjackInsurance()`
  - `loadRouletteState()`
  - `roulettePlaceBet(bet)`
  - `rouletteSpin()`
  - `rouletteRepeat()`
  - `loadHoldemState()`
  - `holdemBuyIn(amount)`
  - `holdemAction(action)`
  - `holdemNextHand()`
  - `holdemLeave()`
- The adapter also documents proposed Fredagsfett endpoints in `PROPOSED_FREDAGSFETT_CASINO_ENDPOINTS`.

## Claude Code Follow-Up

Open questions for the next migration pass:

- Decide whether Fredagsfett Casino should require registered `ff_users` before creating casino players.
- Decide how to link existing Mosquito `game_accounts` and `game_players` to Fredagsfett users.
- Implement `/api/fredagsfett/casino/...` wrappers without exposing Mosquito admin routes.
- Replace the placeholder Casino panels with translated light UI game panels.
- Move the adapter from `/api/game/...` to `/api/fredagsfett/casino/...` once aliases exist.
