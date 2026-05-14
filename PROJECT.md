# sp1e.se — Project Knowledge

## Stack

| Layer | Technology |
|---|---|
| Hosting | Cloudflare Pages (static) + Pages Functions (Workers) |
| API | `functions/api/[[route]].ts` — catch-all Pages Function for everything except Fredagsfett |
| Fredagsfett API | `functions/api/fredagsfett/[[route]].ts` — nested catch-all that owns `/api/fredagsfett/*` (split from the parent in batch-4 of the Fredagsfett work; self-contained with its own Env / json / HttpError / AuthError / getCookie / cors copies) |
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
| `/fredagsfett` | `fredagsfett/index.html` | Private gateway — password + device fingerprint, registers a name on first use |
| `/fredagsfett/kalender` | `fredagsfett/kalender/index.html` | Group calendar — tap-cycle availability, weekday default times, heatmap mode, admin event lock-in, Inlåsta fredagar panel |
| `/fredagsfett/sp1wise` | `fredagsfett/sp1wise/index.html` | Group expense split + settlements + CSV export |
| `/fredagsfett/admin` | `fredagsfett/admin/index.html` | Dev console — manage users, rename, toggle `is_admin` flag, revoke devices |

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

### Fredagsfett routes (under `/api/fredagsfett/`)

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `auth` | — | Password + device fingerprint → session cookie (2-year) |
| POST | `register` | user | Register a name for this device's session (auto-promotes first admin) |
| GET | `session` | user | Current session payload incl. `user.is_admin` |
| POST | `logout` | user | Revokes the active device |
| GET | `availability` | user | Group availability rows for a date window |
| POST | `availability` | user | Upsert own availability; missing time keys → weekday default for AVAILABLE, preserve existing for MAYBE/UNAVAILABLE |
| DELETE | `availability?date=` | user | Clear own availability for a date |
| GET | `events` | user | List events in window (default current UTC month); attendees derived from availability |
| POST | `events` | admin-user | Lock a date (upsert on `UNIQUE(group_id, date)`; revives a cancelled row) |
| PATCH | `events/:id` | admin-user | Edit event fields; status toggle flips `cancelled_at` |
| DELETE | `events/:id` | admin-user | Soft cancel (status=CANCELLED) |
| GET    | `events/:id/comments` | user | List comments for a locked event |
| POST   | `events/:id/comments` | user | Add a comment (body: `{ body }`) |
| GET    | `ical-url` | user | Returns the caller's personalized iCal feed URL |
| GET    | `ical/:token` | signed-token | Public iCal feed (text/calendar) of all LOCKED Fredagsfett events; token is HMAC over `ical:<userId>`. Bypasses cookie auth (calendar clients don't send cookies). |
| GET    | `events/:id/items` | user | "Who-brings-what" checklist for an event |
| POST   | `events/:id/items` | user | Add an item (body: `{ label }`) |
| PATCH  | `items/:id` | user | Update item: `{ label?, claimed_by? }`. `claimed_by: null` releases the claim. |
| DELETE | `items/:id` | user | Remove an item |
| GET    | `events/:id/photos` | user | List photo metadata for an event |
| POST   | `events/:id/photos` | user | Upload a photo (body: `{ content_type, data: base64 }`, max 5 MB, image/* only). Prefers R2; falls back to D1 base64. |
| GET    | `photos/:id` | user | Stream a photo (R2 or D1 fallback) |
| DELETE | `photos/:id` | user (uploader or admin) | Delete a photo |
| GET    | `activity?limit=N` | user | Recent activity-log rows for the group (default 30, max 100) |
| POST   | `admin/cleanup` | admin-cookie | Delete revoked devices older than 90 days. No native cron on Pages Functions; call from the dev console or an external scheduler. |
| GET | `sp1wise` | user | Group balances + simplified debts + expense list + activity |
| GET/POST | `sp1wise/groups` | user | List / create sub-groups |
| POST | `sp1wise/expenses` | user | Add expense (split by EQUAL/AMOUNTS/PERCENT/SHARES) |
| PATCH/DELETE | `sp1wise/expenses/:id` | user | Edit / soft-delete expense |
| POST | `sp1wise/settlements` | user | Record a payment |
| POST | `sp1wise/comments` | user | Comment on an expense |
| GET | `sp1wise/export` | user | CSV export |
| POST | `admin/auth` | user | Unlock dev console (`ff_admin_session` cookie, 2 h) |
| GET | `admin/users` | admin-cookie | List users with devices and audit timestamps |
| PATCH | `admin/users/:id` | admin-cookie | Whitelist update (`name`, `is_admin`); rejects unknown fields |
| DELETE | `admin/users/:id` | admin-cookie | Remove user |
| DELETE | `admin/devices/:id` | admin-cookie | Revoke a device |
| POST | `admin/logout` | admin-cookie | Clears the admin session cookie (user session preserved) |

**Permission contexts:**
- `user` — any registered group member via `ff_session`.
- `admin-user` — user session whose `is_admin = 1`. Enforced server-side by `requireFredagsfettAdminUser`, gates event mutations from the calendar.
- `admin-cookie` — separate `ff_admin_session` cookie from the dev-console password unlock. Required for managing the `is_admin` flag itself and other destructive ops.

## D1 Schema

Two SQL bundles:

1. **Hub schema (`schema.sql`):** `sessions`, `categories`, `subcategories`, `notes`, `snippets`, `bookmarks`, `files`, `artworks`, `spotify_tokens`
2. **Game schema (`game-schema.sql` + `game-talents-schema.sql`):** `game_rounds`, `game_players`, `game_npcs`, `game_inventory`, `game_properties`, `game_quests`, `game_action_log`, `game_assault_cooldowns`, `game_blackjack_hands`, `game_holdem_tables`, `game_roulette_spins`, `game_admin_sessions`, `game_admin_audit`, `game_sessions`, `game_leaderboard`, `game_talents`, `game_player_talents`

- `files` has a `data TEXT` column for base64 D1 fallback when R2 is unavailable
- Run `npx wrangler d1 execute sp1e-db --remote --file=schema.sql` to apply
- Game schema + seed: `game-schema.sql`, `game-seed.sql`, `game-talents-schema.sql`, `game-talents-seed.sql`
- Round reset: `game-reset.sql` (truncates all game tables, seeds round 1 + 20 NPCs)
- Fredagsfett schema lives in `fredagsfett-migration-001.sql` (auth/devices/calendar/sp1wise foundations) + `fredagsfett-migration-002-availability-times.sql` (time-window columns) + `fredagsfett-migration-003-events.sql` (`ff_events` lock-in table) + `fredagsfett-migration-004-event-comments-and-tagging.sql` (`ff_event_comments` + `ff_expenses.event_id`) + `fredagsfett-migration-005-event-extras.sql` (`ff_event_items`, `ff_event_photos`, `ff_events.spotify_url`). All five are mirrored into `schema.sql`.

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

# Apply Fredagsfett events migration (v3) to production
npx wrangler d1 execute sp1e-db --remote --file=fredagsfett-migration-003-events.sql

# Promote a Fredagsfett user to admin (one-time; auto-seed in code is a safety net)
npx wrangler d1 execute sp1e-db --remote --command="UPDATE ff_users SET is_admin = 1 WHERE name = 'Simon'"
```
