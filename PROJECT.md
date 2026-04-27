# sp1e.se — Project Knowledge

## Stack

| Layer | Technology |
|---|---|
| Hosting | Cloudflare Pages (static) + Pages Functions (Workers) |
| API | `functions/api/[[route]].ts` — catch-all Pages Function |
| Database | Cloudflare D1 (SQLite) — binding `DB`, name `sp1e-db` |
| File storage | Cloudflare R2 — binding `FILES`, bucket `sp1e-files` |
| Auth | PBKDF2-SHA256 (100 000 iterations) via Web Crypto; session cookie |
| Password hash | Env var `AUTH_PASSWORD_HASH`; generate with `node scripts/hash-password.js "pw"` |
| Game admin | Env var `GAME_ADMIN_PASSWORD_HASH` preferred; local/dev fallback hash exists; `game_admin_session` cookie |
| Spotify | OAuth client (`SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_REDIRECT_URI`); tokens stored in `spotify_tokens` |

## Current Status

- **Landing page** (`/`) — art background (AIC impressionism API), Immersion mode, Mosquito + Σ.Π. entry points
- **Hub** (`/hub`) — seeded categories, art gallery, full-text search, recent items, export
- **Auth** — PBKDF2 hash working, session cookies set/cleared correctly
- **D1** — base schema + default categories seeded via `schema.sql`; DAX import also needs `seed-dax-categories.sql`
- **R2** — bucket created; base64 D1 fallback for files ≤ 1 MB when R2 unavailable

## Pages

| Route | File | Description |
|---|---|---|
| `/` | `index.html` | Landing page — logo, Mosquito + Σ.Π. cards, painting background, Immersion mode |
| `/hub` | `hub.html` | Private hub — categories, gallery, search, recent items |
| `/mosquito` | `mosquito.html` | Mosquito game — currently requires site auth for all game routes; character creation, crime, robbery, casino (blackjack, roulette, hold'em), gang, properties, leaderboard |
| `/hub/note/*` | `hub/note/index.html` | Note detail/edit view |
| `/visitor` | (redirect) | Redirects to `/mosquito` |

## Landing Page Features

- **Background gallery** — impressionist paintings from Art Institute of Chicago public API (`/api/art` proxy), rotating every 28 s, shared sessionStorage/localStorage cache `sp1e-gallery-v6`
- **Immersion mode** — full-screen `object-fit: contain` painting view; ‹ › navigation arrows; idle auto-hide (3 s); painting info caption (artist, title, year); exits on × or Escape
- **Entry points** — "Mosquito" → `/mosquito`; "Σ.Π." → password modal → `/hub`
- **Password modal** — bare input, Enter submits, Escape/backdrop closes, red flash on wrong password; no teal anywhere

## API Routes (all under `/api/`)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `health` | — | Health check |
| GET | `art` | — | AIC impressionism proxy (1-hour in-memory cache) |
| GET | `gallery/impressionism` | — | Legacy AIC proxy (has `classification_title: painting` filter) |
| GET | `import-dax` | ✓ | One-shot DAX snippet import into `snippets` (requires DAX subcategory seed first) |
| POST | `auth/login` | — | Password → session cookie |
| POST | `auth/logout` | — | Clears session cookie |
| GET | `auth/check` | — | Returns `{ authenticated: bool }` |
| GET | `categories` | ✓ | All categories with item counts |
| GET | `subcategories` | ✓ | Subcategories (optionally by category) |
| GET | `recent` | ✓ | 20 most recently updated items |
| GET/POST | `notes` | ✓ | List / create notes |
| GET/PUT/DELETE | `notes/:id` | ✓ | Note CRUD |
| GET/POST | `snippets` | ✓ | List / create snippets |
| GET/PUT/DELETE | `snippets/:id` | ✓ | Snippet CRUD |
| GET/POST | `bookmarks` | ✓ | List / create bookmarks |
| GET/PUT/DELETE | `bookmarks/:id` | ✓ | Bookmark CRUD |
| POST | `files` | ✓ | Upload file (R2 + D1 base64 fallback ≤ 1 MB) |
| GET | `files/:id` | ✓ | Download file |
| DELETE | `files/:id` | ✓ | Delete file |
| GET | `search` | ✓ | Full-text search across all content types |
| GET | `public/items` | — | Public items (is_public = 1) |
| GET | `seed` | ✓ | Seed default categories + subcategories |

## D1 Schema

Two SQL bundles:

1. **Hub schema (`schema.sql`):** `sessions`, `categories`, `subcategories`, `notes`, `snippets`, `bookmarks`, `files`, `artworks`, `spotify_tokens`
2. **Game schema (`game-schema.sql` + `game-talents-schema.sql`):** `game_rounds`, `game_players`, `game_npcs`, `game_inventory`, `game_properties`, `game_quests`, `game_action_log`, `game_assault_cooldowns`, `game_blackjack_hands`, `game_holdem_tables`, `game_roulette_spins`, `game_admin_sessions`, `game_admin_audit`, `game_sessions`, `game_leaderboard`, `game_talents`, `game_player_talents`

- `files` has a `data TEXT` column for base64 D1 fallback when R2 is unavailable
- Run `npx wrangler d1 execute sp1e-db --remote --file=schema.sql` to apply
- Game schema + seed: `game-schema.sql`, `game-seed.sql`, `game-talents-schema.sql`, `game-talents-seed.sql`
- Round reset: `game-reset.sql` (truncates all game tables, seeds round 1 + 20 NPCs)

## DAX Deploy Flow

`main` is the source-of-truth branch for the DAX import flow.

1. Apply the base schema:
   `npx wrangler d1 execute sp1e-db --remote --file=schema.sql`
2. Seed the extra Power BI DAX subcategories:
   `npx wrangler d1 execute sp1e-db --remote --file=seed-dax-categories.sql`
3. Log in to the deployed site and trigger the import:
   `https://sp1e.se/api/import-dax`
4. Verify the Power BI category page:
   `https://sp1e.se/hub/category/?id=power-bi`

Notes:
- `schema.sql` does not include the extra `pb-*` DAX subcategories. Those come from `seed-dax-categories.sql`.
- The runtime import data is inlined directly inside `functions/api/[[route]].ts` as `DAX_MEASURES`.
- `scripts/parse-dax-measures.js` can regenerate `_dax-data.ts` from `hemfrid_dax_measures.md` if the source needs to be re-parsed; the generated file is not committed and not imported at runtime.

## Known Issues / TODO

- [ ] File upload to R2 not tested end-to-end
- [ ] Bookmarks auto-fetch-meta needs testing
- [ ] Search full-text ranking may need tuning
- [ ] Mobile responsive testing needed across all pages
- [ ] `/visitor` redirect to `/mosquito` not implemented (old links will 404)
- [ ] Light theme in hub not fully tested with all components

## Deployment

Cloudflare Pages auto-deploys from `main` branch. Push to `main` to deploy.

Development branches (e.g. `claude/recommend-improvements-*`) create preview deployments.

### Wrangler commands
```bash
# Apply D1 schema to production
npx wrangler d1 execute sp1e-db --remote --file=schema.sql

# Seed DAX subcategories for Power BI imports
npx wrangler d1 execute sp1e-db --remote --file=seed-dax-categories.sql

# Check D1 tables
npx wrangler d1 execute sp1e-db --remote --command="SELECT name FROM sqlite_master WHERE type='table'"

# Generate password hash
node scripts/hash-password.js "your-password"
```
