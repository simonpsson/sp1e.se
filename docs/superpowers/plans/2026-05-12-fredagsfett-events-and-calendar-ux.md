# Fredagsfett — Events Lock-in + Calendar UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "lock-in event" concept on top of the existing availability poll, speed up availability marking with tap-cycle + heatmap, and gate decision actions on `ff_users.is_admin` with a hardened dev console as the admin control plane.

**Architecture:** New D1 table `ff_events` (UNIQUE per `group_id, date`, soft-cancel). New server helper `requireFredagsfettAdminUser` enforces `is_admin = 1` on the user's regular session — no separate admin cookie needed for event mutations. Dev console (`/fredagsfett/admin`) keeps the existing break-glass admin cookie as the gate for managing the `is_admin` flag itself. All calendar UI changes live in the existing `fredagsfett/kalender/index.html` (~650 lines). All backend changes live in `functions/api/[[route]].ts` (already ~10.4k lines — extend, don't restructure).

**Tech Stack:** Cloudflare Pages Functions (TypeScript), Cloudflare D1 (SQLite), vanilla HTML/CSS/JS for the four `fredagsfett/*` static pages. "Tests" are regex contract checks under `scripts/fredagsfett-*-contract-check.mjs` invoked via `node`.

**Spec:** [docs/superpowers/specs/2026-05-12-fredagsfett-events-and-calendar-ux-design.md](../specs/2026-05-12-fredagsfett-events-and-calendar-ux-design.md)

---

## File map

**Create:**
- `fredagsfett-migration-003-events.sql` — schema for `ff_events`.

**Modify (server):**
- `functions/api/[[route]].ts`:
  - Add `requireFredagsfettAdminUser` helper.
  - Update `fredagsfettRegister` — auto-promote first user when zero admins exist.
  - Update `fredagsfettAdminUpdateUser` — accept `{ is_admin }`, reject unknown fields.
  - Update `fredagsfettAvailabilityUpsert` — weekday default times; relax start-without-end rule.
  - Add `fredagsfettEventsList`, `fredagsfettEventsCreate`, `fredagsfettEventsUpdate`, `fredagsfettEventsCancel`.
  - Wire `id === 'events'` dispatch.
- `schema.sql` — append `ff_events` table so a fresh DB has the column.

**Modify (frontend):**
- `fredagsfett/kalender/index.html` — admin detection, lock button + mini-form, event card, tap-cycle, heatmap toggle, "Inlåsta fredagar" panel, edit-form always sends both time keys.
- `fredagsfett/admin/index.html` — `adminApi` wrapper, confirms, admin toggle, rename inline, status styling, scroll-preserving refresh, audit line per user.

**Modify (tests + docs):**
- `scripts/fredagsfett-auth-contract-check.mjs` — assertions for `requireFredagsfettAdminUser`, register safety net, admin update-user whitelist.
- `scripts/fredagsfett-feature-contract-check.mjs` — assertions for events endpoints, kalender lock UI, tap-cycle, heatmap, dev console hardening.
- `PROJECT.md` — document new `/events` routes, `fredagsfett` page surface, migration step.

---

## Execution conventions

- Work on `main` directly per project convention (see `PROJECT.md` § Deployment). Each task commits separately; no PRs unless asked.
- "Tests" in this project are **regex contract checks** against source files. The TDD loop per task is:
  1. Add new regex assertions to the relevant contract-check file.
  2. Run `node scripts/fredagsfett-auth-contract-check.mjs` and/or `node scripts/fredagsfett-feature-contract-check.mjs`. Observe the new assertions FAIL.
  3. Implement source changes until assertions PASS.
  4. Commit.
- D1 changes are applied locally first with `--local`, only applied `--remote` at the very end (Task 12) per the deploy block.

---

## Task 1: Schema migration + `requireFredagsfettAdminUser` helper

**Files:**
- Create: `fredagsfett-migration-003-events.sql`
- Modify: `functions/api/[[route]].ts` (add helper, ~10 lines near the existing `requireFredagsfettAdmin`)
- Modify: `schema.sql` (append `ff_events` block to mirror migration)
- Modify: `scripts/fredagsfett-auth-contract-check.mjs` (add regex assertions)

- [ ] **Step 1.1: Add the regex assertions to the auth contract check**

Append to `scripts/fredagsfett-auth-contract-check.mjs`, before the `failed` aggregation at the bottom:

```js
const migration003 = read('fredagsfett-migration-003-events.sql');
check('ff_events migration creates the table with required columns',
  /CREATE TABLE IF NOT EXISTS ff_events/.test(migration003)
  && /UNIQUE\(group_id, date\)/.test(migration003)
  && /status\s+TEXT\s+NOT NULL\s+CHECK \(status IN \('LOCKED','CANCELLED'\)\)/.test(migration003)
  && /host_user_id\s+TEXT REFERENCES ff_users\(id\) ON DELETE SET NULL/.test(migration003)
  && /idx_ff_events_group_date/.test(migration003));
check('Cumulative schema includes ff_events',
  /CREATE TABLE IF NOT EXISTS ff_events/.test(schema));
check('requireFredagsfettAdminUser helper exists and gates on is_admin',
  /async function requireFredagsfettAdminUser/.test(api)
  && /requireFredagsfettUser\(request, env\)/.test(api)
  && /not_admin/.test(api));
```

- [ ] **Step 1.2: Run the contract check to confirm the new assertions fail**

```bash
node scripts/fredagsfett-auth-contract-check.mjs
```

Expected: three new `FAIL` lines for the assertions added above. Existing checks still pass.

- [ ] **Step 1.3: Create the migration file**

`fredagsfett-migration-003-events.sql`:

```sql
-- Fredagsfett v3: locked-in events on top of availability.
-- Run after fredagsfett-migration-002-availability-times.sql on existing D1 databases.
--
-- Remote:
--   npx wrangler d1 execute sp1e-db --remote --file=fredagsfett-migration-003-events.sql
-- Local:
--   npx wrangler d1 execute sp1e-db --local --file=fredagsfett-migration-003-events.sql
--
-- First-admin seed (run once after applying the migration on remote):
--   npx wrangler d1 execute sp1e-db --remote \
--     --command="UPDATE ff_users SET is_admin = 1 WHERE name = 'Simon';"
-- (Replace 'Simon' with whichever account should be the first admin. The
--  in-app auto-seed in fredagsfettRegister will also promote the first
--  registrant if no admins exist, as a safety net.)

CREATE TABLE IF NOT EXISTS ff_events (
  id                  TEXT PRIMARY KEY,
  group_id            TEXT NOT NULL REFERENCES ff_groups(id) ON DELETE CASCADE,
  date                TEXT NOT NULL,
  status              TEXT NOT NULL CHECK (status IN ('LOCKED','CANCELLED')) DEFAULT 'LOCKED',
  host_user_id        TEXT REFERENCES ff_users(id) ON DELETE SET NULL,
  title               TEXT,
  location            TEXT,
  start_time          TEXT,
  end_time            TEXT,
  notes               TEXT,
  created_by_user_id  TEXT REFERENCES ff_users(id) ON DELETE SET NULL,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
  cancelled_at        TEXT,
  UNIQUE(group_id, date)
);

CREATE INDEX IF NOT EXISTS idx_ff_events_group_date ON ff_events (group_id, date);
CREATE INDEX IF NOT EXISTS idx_ff_events_status ON ff_events (status);
```

- [ ] **Step 1.4: Append the same `ff_events` block to `schema.sql`**

So a fresh-DB install matches the migrated state. Place it after the `ff_*` blocks already present in the cumulative schema. Drop the migration-only comments; keep just the `CREATE TABLE` + indexes.

- [ ] **Step 1.5: Apply the migration to local D1**

```bash
npx wrangler d1 execute sp1e-db --local --file=fredagsfett-migration-003-events.sql
```

Expected: "🚣 Executed 3 commands in X.XXms".

- [ ] **Step 1.6: Add the `requireFredagsfettAdminUser` helper to `functions/api/[[route]].ts`**

Place it directly below the existing `requireFredagsfettAdmin` (around line 10827). Use the same return shape so call-sites can swap helpers without other changes:

```ts
async function requireFredagsfettAdminUser(request: Request, env: Env): Promise<{ cfg: FredagsfettConfig; payload: FredagsfettSessionPayload; device: FredagsfettDeviceRow; user: FredagsfettUserRow }> {
  const session = await requireFredagsfettUser(request, env);
  if (!session.user.is_admin) {
    throw fredagsfettJson({ error: 'not_admin' }, 403);
  }
  return session;
}
```

Note: `requireFredagsfettUser` already throws `Response` objects via `fredagsfettJson` on failure; mirror that pattern so callers can `await` without explicit try/catch.

- [ ] **Step 1.7: Run the contract check again — all PASS**

```bash
node scripts/fredagsfett-auth-contract-check.mjs
```

Expected: all checks pass (including the three new ones).

- [ ] **Step 1.8: Commit**

```bash
git add fredagsfett-migration-003-events.sql schema.sql functions/api/'[[route]].ts' scripts/fredagsfett-auth-contract-check.mjs
git commit -m "Add ff_events schema and requireFredagsfettAdminUser helper"
```

---

## Task 2: Auto-seed first admin + admin-update whitelist

**Files:**
- Modify: `functions/api/[[route]].ts` — `fredagsfettRegister` and `fredagsfettAdminUpdateUser`
- Modify: `scripts/fredagsfett-auth-contract-check.mjs`

- [ ] **Step 2.1: Add regex assertions**

Append to `scripts/fredagsfett-auth-contract-check.mjs`:

```js
check('Register auto-promotes first user when zero admins exist',
  /SELECT COUNT\(\*\) as cnt FROM ff_users WHERE is_admin = 1/.test(api)
  && /zero[_ ]?admins?/i.test(api));
check('Admin user PATCH accepts is_admin and rejects unknown fields',
  /fredagsfettAdminUpdateUser/.test(api)
  && /body\.is_admin/.test(api)
  && /unknown_field|unknown field/i.test(api));
```

- [ ] **Step 2.2: Run the contract check, observe two new failures**

```bash
node scripts/fredagsfett-auth-contract-check.mjs
```

- [ ] **Step 2.3: Modify `fredagsfettRegister` for the safety net**

Locate `fredagsfettRegister` (around line 9936). The existing line that computes admin status is:

```ts
const isAdmin = cfg.value.adminNames.has(name.toLocaleLowerCase('sv-SE')) ? 1 : 0;
```

Replace it with:

```ts
const nameIsAdminListed = cfg.value.adminNames.has(name.toLocaleLowerCase('sv-SE'));

// Safety net: if no admins exist yet, the first registrant is auto-promoted.
// This unblocks recovery after a DB wipe even when FF_ADMIN_NAMES isn't set.
const adminCountRow = await env.DB.prepare(
  `SELECT COUNT(*) as cnt FROM ff_users WHERE is_admin = 1 AND deleted_at IS NULL`
).first<{ cnt: number }>();
const zeroAdminsExist = !adminCountRow || adminCountRow.cnt === 0;

const isAdmin = nameIsAdminListed || zeroAdminsExist ? 1 : 0;
```

The downstream `INSERT INTO ff_users (..., is_admin, ...)` binding already uses `isAdmin` — no further changes needed. Keep both paths; do not remove the `FF_ADMIN_NAMES` match.

- [ ] **Step 2.4: Modify `fredagsfettAdminUpdateUser` to accept `is_admin` and reject unknown fields**

Locate `fredagsfettAdminUpdateUser` (around line 10398). Replace the body destructure + handling with:

```ts
let body: Record<string, unknown>;
try { body = await request.json(); }
catch { return fredagsfettJson({ error: 'Ogiltig JSON.' }, 400); }

const ALLOWED_FIELDS = new Set(['name', 'is_admin']);
const unknown = Object.keys(body).filter(k => !ALLOWED_FIELDS.has(k));
if (unknown.length) {
  return fredagsfettJson({ error: 'unknown_field', fields: unknown }, 400);
}

const updates: string[] = [];
const bindings: unknown[] = [];

if ('name' in body) {
  const name = normalizeFredagsfettShortText(body.name as string, 80);
  if (!name) return fredagsfettJson({ error: 'Ange ett namn.' }, 400);
  updates.push('name = ?');
  bindings.push(name);
}
if ('is_admin' in body) {
  const flag = body.is_admin === 1 || body.is_admin === true || body.is_admin === '1' ? 1 : 0;
  updates.push('is_admin = ?');
  bindings.push(flag);
}
if (!updates.length) return fredagsfettJson({ error: 'Inget att uppdatera.' }, 400);

updates.push("updated_at = datetime('now')");
bindings.push(userId);

try {
  await env.DB.prepare(
    `UPDATE ff_users SET ${updates.join(', ')} WHERE id = ?`
  ).bind(...bindings).run();
} catch (err) {
  // UNIQUE constraint on name
  if (String(err).includes('UNIQUE')) return fredagsfettJson({ error: 'Namnet är upptaget.' }, 409);
  throw err;
}
return fredagsfettJson({ success: true });
```

Verify by reading the existing helper imports — `fredagsfettJson` and `normalizeFredagsfettShortText` already exist in the file.

- [ ] **Step 2.5: Run the contract check — all PASS**

```bash
node scripts/fredagsfett-auth-contract-check.mjs
```

- [ ] **Step 2.6: Commit**

```bash
git add functions/api/'[[route]].ts' scripts/fredagsfett-auth-contract-check.mjs
git commit -m "Auto-seed first Fredagsfett admin and extend admin user PATCH"
```

---

## Task 3: Events API — GET list

**Files:**
- Modify: `functions/api/[[route]].ts` — new `fredagsfettEventsList`, route dispatch
- Modify: `scripts/fredagsfett-feature-contract-check.mjs`

- [ ] **Step 3.1: Add regex assertions**

Append to `scripts/fredagsfett-feature-contract-check.mjs`:

```js
check('Events GET list endpoint exists and is user-gated',
  /fredagsfettEventsList/.test(api)
  && /id === ['"]events['"]/.test(api)
  && /requireFredagsfettUser\(request, env\)/.test(api));
check('Events GET joins availability for attendees',
  /fredagsfettEventsList[\s\S]*?ff_availability[\s\S]*?status IN \('AVAILABLE','MAYBE'\)/.test(api));
```

- [ ] **Step 3.2: Run feature contract check, observe failures**

```bash
node scripts/fredagsfett-feature-contract-check.mjs
```

- [ ] **Step 3.3: Add the `fredagsfettEventsList` handler**

Place it after the existing availability handlers (around line 10103). Reads `from` / `to` query params, defaults to current month:

```ts
async function fredagsfettEventsList(request: Request, env: Env): Promise<Response> {
  const session = await requireFredagsfettUser(request, env);
  const groupId = 'fredagsfett';
  const url = new URL(request.url);
  const today = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
  const lastOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().slice(0, 10);
  const from = normalizeFredagsfettDate(url.searchParams.get('from')) ?? firstOfMonth;
  const to = normalizeFredagsfettDate(url.searchParams.get('to')) ?? lastOfMonth;

  const events = await env.DB.prepare(
    `SELECT e.id, e.date, e.status, e.host_user_id, e.title, e.location,
            e.start_time, e.end_time, e.notes, e.created_by_user_id,
            e.created_at, e.updated_at, e.cancelled_at,
            host.name AS host_name
       FROM ff_events e
       LEFT JOIN ff_users host ON host.id = e.host_user_id
      WHERE e.group_id = ? AND e.date >= ? AND e.date <= ?
      ORDER BY e.date ASC`
  ).bind(groupId, from, to).all<{
    id: string; date: string; status: string;
    host_user_id: string | null; host_name: string | null;
    title: string | null; location: string | null;
    start_time: string | null; end_time: string | null;
    notes: string | null; created_by_user_id: string | null;
    created_at: string; updated_at: string; cancelled_at: string | null;
  }>();

  const attendeesByDate = new Map<string, Array<{ user_id: string; name: string; status: string }>>();
  if (events.results?.length) {
    const dates = events.results.map(e => e.date);
    const placeholders = dates.map(() => '?').join(',');
    const rows = await env.DB.prepare(
      `SELECT a.date, a.user_id, a.status, u.name
         FROM ff_availability a
         JOIN ff_users u ON u.id = a.user_id
        WHERE a.date IN (${placeholders})
          AND a.status IN ('AVAILABLE','MAYBE')
          AND u.deleted_at IS NULL`
    ).bind(...dates).all<{ date: string; user_id: string; status: string; name: string }>();
    for (const r of rows.results ?? []) {
      const list = attendeesByDate.get(r.date) ?? [];
      list.push({ user_id: r.user_id, name: r.name, status: r.status });
      attendeesByDate.set(r.date, list);
    }
  }

  const items = (events.results ?? []).map(e => ({
    ...e,
    attendees: attendeesByDate.get(e.date) ?? [],
  }));
  return fredagsfettJson({ events: items, from, to });
}
```

- [ ] **Step 3.4: Add the route dispatch**

Locate the existing `fredagsfett` block in the route dispatcher (around line 130). Add after the last availability line, before sp1wise:

```ts
if (id === 'events' && !sub && method === 'GET')  return fredagsfettEventsList(request, env);
```

- [ ] **Step 3.5: Run the check — PASS**

```bash
node scripts/fredagsfett-feature-contract-check.mjs
```

- [ ] **Step 3.6: Commit**

```bash
git add functions/api/'[[route]].ts' scripts/fredagsfett-feature-contract-check.mjs
git commit -m "Add Fredagsfett events list endpoint"
```

---

## Task 4: Events API — POST create (admin-only)

**Files:**
- Modify: `functions/api/[[route]].ts` — `fredagsfettEventsCreate`, route, activity log
- Modify: `scripts/fredagsfett-feature-contract-check.mjs`

- [ ] **Step 4.1: Add regex assertions**

```js
check('Events POST gated on requireFredagsfettAdminUser',
  /fredagsfettEventsCreate/.test(api)
  && /requireFredagsfettAdminUser\(request, env\)/.test(api));
check('Events POST upserts via ON CONFLICT(group_id, date)',
  /INSERT INTO ff_events[\s\S]*?ON CONFLICT\(group_id, date\)\s*DO UPDATE/.test(api));
check('Events POST writes event_locked to activity log',
  /event_locked/.test(api));
```

- [ ] **Step 4.2: Run check, observe failures**

```bash
node scripts/fredagsfett-feature-contract-check.mjs
```

- [ ] **Step 4.3: Add `fredagsfettEventsCreate`**

```ts
async function fredagsfettEventsCreate(request: Request, env: Env): Promise<Response> {
  const session = await requireFredagsfettAdminUser(request, env);
  let body: {
    date?: string;
    title?: string | null;
    host_user_id?: string | null;
    location?: string | null;
    start_time?: string | null;
    end_time?: string | null;
    notes?: string | null;
  };
  try { body = await request.json(); }
  catch { return fredagsfettJson({ error: 'Ogiltig JSON.' }, 400); }

  const date = normalizeFredagsfettDate(body.date);
  if (!date) return fredagsfettJson({ error: 'Ogiltigt datum.' }, 400);

  const hostUserId = body.host_user_id ? normalizeFredagsfettId(body.host_user_id) : null;
  if (body.host_user_id && !hostUserId) return fredagsfettJson({ error: 'Ogiltig värd.' }, 400);
  if (hostUserId) {
    const exists = await env.DB.prepare(`SELECT 1 FROM ff_users WHERE id = ? AND deleted_at IS NULL`).bind(hostUserId).first();
    if (!exists) return fredagsfettJson({ error: 'Värden finns inte.' }, 400);
  }

  const title = normalizeFredagsfettShortText(body.title, 80);
  const location = normalizeFredagsfettShortText(body.location, 200);
  const startTime = normalizeFredagsfettTime(body.start_time);
  const endTime = normalizeFredagsfettTime(body.end_time);
  const notes = normalizeFredagsfettShortText(body.notes, 1000);
  if (startTime && endTime && startTime >= endTime) {
    return fredagsfettJson({ error: 'Sluttiden måste vara efter starttiden.' }, 400);
  }

  const groupId = 'fredagsfett';
  const id = `ev-${crypto.randomUUID()}`;
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO ff_events (id, group_id, date, status, host_user_id, title, location, start_time, end_time, notes, created_by_user_id, created_at, updated_at)
       VALUES (?, ?, ?, 'LOCKED', ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
       ON CONFLICT(group_id, date) DO UPDATE SET
         status = 'LOCKED',
         host_user_id = excluded.host_user_id,
         title = excluded.title,
         location = excluded.location,
         start_time = excluded.start_time,
         end_time = excluded.end_time,
         notes = excluded.notes,
         cancelled_at = NULL,
         updated_at = datetime('now')`
    ).bind(id, groupId, date, hostUserId, title, location, startTime, endTime, notes, session.user.id),
    fredagsfettLogStatement(env, groupId, session.user.id, 'event_locked', 'event', id, `${session.user.name} låste in ${date}.`),
  ]);
  return fredagsfettJson({ success: true, event_id: id });
}
```

- [ ] **Step 4.4: Wire the route**

Below the GET events line in the dispatcher:

```ts
if (id === 'events' && !sub && method === 'POST') return fredagsfettEventsCreate(request, env);
```

- [ ] **Step 4.5: Run check — PASS**

```bash
node scripts/fredagsfett-feature-contract-check.mjs
```

- [ ] **Step 4.6: Commit**

```bash
git add functions/api/'[[route]].ts' scripts/fredagsfett-feature-contract-check.mjs
git commit -m "Add Fredagsfett events create endpoint (admin-gated)"
```

---

## Task 5: Events API — PATCH update + DELETE cancel

**Files:**
- Modify: `functions/api/[[route]].ts` — `fredagsfettEventsUpdate`, `fredagsfettEventsCancel`, routes
- Modify: `scripts/fredagsfett-feature-contract-check.mjs`

- [ ] **Step 5.1: Add regex assertions**

```js
check('Events PATCH updates non-date fields and bumps updated_at',
  /fredagsfettEventsUpdate/.test(api)
  && /requireFredagsfettAdminUser\(request, env\)/.test(api)
  && /UPDATE ff_events SET[\s\S]*?updated_at = datetime\('now'\)/.test(api));
check('Events DELETE soft-cancels with status=CANCELLED and cancelled_at',
  /fredagsfettEventsCancel/.test(api)
  && /status\s*=\s*'CANCELLED'/.test(api)
  && /cancelled_at\s*=\s*datetime\('now'\)/.test(api));
check('Events activity log emits event_updated and event_cancelled',
  /event_updated/.test(api) && /event_cancelled/.test(api));
```

- [ ] **Step 5.2: Run check, observe failures**

- [ ] **Step 5.3: Add the two handlers**

```ts
async function fredagsfettEventsUpdate(request: Request, env: Env, eventId: string): Promise<Response> {
  const session = await requireFredagsfettAdminUser(request, env);
  const event = await env.DB.prepare(`SELECT group_id, date FROM ff_events WHERE id = ?`).bind(eventId).first<{ group_id: string; date: string }>();
  if (!event) return fredagsfettJson({ error: 'Eventet finns inte.' }, 404);

  let body: Record<string, unknown>;
  try { body = await request.json(); }
  catch { return fredagsfettJson({ error: 'Ogiltig JSON.' }, 400); }

  const ALLOWED = new Set(['title', 'host_user_id', 'location', 'start_time', 'end_time', 'notes', 'status']);
  const unknown = Object.keys(body).filter(k => !ALLOWED.has(k));
  if (unknown.length) return fredagsfettJson({ error: 'unknown_field', fields: unknown }, 400);

  const updates: string[] = [];
  const bindings: unknown[] = [];
  if ('title' in body)        { updates.push('title = ?');        bindings.push(normalizeFredagsfettShortText(body.title as string, 80)); }
  if ('host_user_id' in body) {
    const hostId = body.host_user_id ? normalizeFredagsfettId(body.host_user_id as string) : null;
    updates.push('host_user_id = ?'); bindings.push(hostId);
  }
  if ('location' in body)     { updates.push('location = ?');     bindings.push(normalizeFredagsfettShortText(body.location as string, 200)); }
  if ('start_time' in body)   { updates.push('start_time = ?');   bindings.push(normalizeFredagsfettTime(body.start_time as string)); }
  if ('end_time' in body)     { updates.push('end_time = ?');     bindings.push(normalizeFredagsfettTime(body.end_time as string)); }
  if ('notes' in body)        { updates.push('notes = ?');        bindings.push(normalizeFredagsfettShortText(body.notes as string, 1000)); }
  if ('status' in body) {
    const s = String(body.status).toUpperCase();
    if (s !== 'LOCKED' && s !== 'CANCELLED') return fredagsfettJson({ error: 'Ogiltig status.' }, 400);
    updates.push('status = ?'); bindings.push(s);
    if (s === 'CANCELLED') updates.push("cancelled_at = datetime('now')");
    else updates.push('cancelled_at = NULL');
  }
  if (!updates.length) return fredagsfettJson({ error: 'Inget att uppdatera.' }, 400);
  updates.push("updated_at = datetime('now')");
  bindings.push(eventId);

  await env.DB.batch([
    env.DB.prepare(`UPDATE ff_events SET ${updates.join(', ')} WHERE id = ?`).bind(...bindings),
    fredagsfettLogStatement(env, event.group_id, session.user.id, 'event_updated', 'event', eventId, `${session.user.name} uppdaterade ${event.date}.`),
  ]);
  return fredagsfettJson({ success: true });
}

async function fredagsfettEventsCancel(request: Request, env: Env, eventId: string): Promise<Response> {
  const session = await requireFredagsfettAdminUser(request, env);
  const event = await env.DB.prepare(`SELECT group_id, date FROM ff_events WHERE id = ? AND status = 'LOCKED'`).bind(eventId).first<{ group_id: string; date: string }>();
  if (!event) return fredagsfettJson({ error: 'Eventet finns inte eller är redan avbrutet.' }, 404);
  await env.DB.batch([
    env.DB.prepare(`UPDATE ff_events SET status = 'CANCELLED', cancelled_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).bind(eventId),
    fredagsfettLogStatement(env, event.group_id, session.user.id, 'event_cancelled', 'event', eventId, `${session.user.name} avbröt ${event.date}.`),
  ]);
  return fredagsfettJson({ success: true });
}
```

- [ ] **Step 5.4: Wire routes**

```ts
if (id === 'events' && sub && method === 'PATCH')  return fredagsfettEventsUpdate(request, env, sub);
if (id === 'events' && sub && method === 'DELETE') return fredagsfettEventsCancel(request, env, sub);
```

(The route dispatcher uses `sub` for the id segment for resource/:id patterns — verify by looking at the existing SP1Wise `expenses/:id` handling around line 142 and mirror exactly.)

- [ ] **Step 5.5: Run check — PASS, commit**

```bash
node scripts/fredagsfett-feature-contract-check.mjs
git add functions/api/'[[route]].ts' scripts/fredagsfett-feature-contract-check.mjs
git commit -m "Add Fredagsfett events update and cancel endpoints"
```

---

## Task 6: Weekday default time windows + edit-form contract

**Files:**
- Modify: `functions/api/[[route]].ts` — `fredagsfettAvailabilityUpsert`
- Modify: `scripts/fredagsfett-feature-contract-check.mjs`

Note on existing behavior: today `fredagsfettAvailabilityUpsert` enforces "both or neither" on `start_time` / `end_time` (`if ((body.start_time || body.end_time || timeNote) && (!startTime || !endTime))` at ~line 10071). This spec relaxes the rule because the weekday defaults set `start_time` without `end_time`. The new rule: only `time_note` requires both times; a standalone `start_time` or standalone `end_time` is allowed.

- [ ] **Step 6.1: Add regex assertions**

```js
check('Availability upsert applies weekday default times when keys are missing',
  /fredagsfettWeekdayDefaultTimes/.test(api)
  && /18:00/.test(api) && /17:00/.test(api) && /12:00/.test(api));
check('Availability upsert distinguishes missing key from empty string',
  /'start_time' in body/.test(api) && /'end_time' in body/.test(api));
check('Availability upsert allows standalone start_time when default applies',
  !/(body\.start_time \|\| body\.end_time \|\| timeNote)\s*\)\s*&&\s*\(!startTime \|\| !endTime\)/.test(api));
```

(The third assertion is *negative* — it verifies the old "both or neither" guard has been replaced. Word the regex to match the exact old form.)

- [ ] **Step 6.2: Run check, observe failures (the negative check passes today, the positive ones fail)**

```bash
node scripts/fredagsfett-feature-contract-check.mjs
```

- [ ] **Step 6.3: Modify `fredagsfettAvailabilityUpsert`**

Replace the current "both-or-neither" guard at ~line 10071 with default-application + a softer guard:

```ts
// Apply weekday default times only when both keys are missing entirely and status is AVAILABLE.
let appliedStart = startTime;
let appliedEnd = endTime;
if (status === 'AVAILABLE' && !('start_time' in body) && !('end_time' in body)) {
  const def = fredagsfettWeekdayDefaultTimes(date);
  appliedStart = def.start_time;
  appliedEnd = def.end_time;
}

// time_note only makes sense if there is at least a start time.
if (timeNote && !appliedStart) {
  return json({ error: 'Ange en starttid för tidskommentaren.' }, 400);
}
if (appliedStart && appliedEnd && appliedStart >= appliedEnd) {
  return json({ error: 'Sluttiden måste vara efter starttiden.' }, 400);
}
```

Then change the `bind` call to use `appliedStart` / `appliedEnd` instead of `startTime` / `endTime`.

Note: the existing `fredagsfettAvailabilityUpsert` uses the bare `json(...)` helper (not `fredagsfettJson(...)`) for its responses. Keep `json(...)` here for stylistic consistency with the rest of the function.

Add a new helper near the other Fredagsfett helpers (say next to `normalizeFredagsfettTime`):

```ts
function fredagsfettWeekdayDefaultTimes(date: string): { start_time: string | null; end_time: string | null } {
  // date is YYYY-MM-DD; compute UTC weekday (matches D1 storage, which is date-only).
  const weekday = new Date(date + 'T00:00:00Z').getUTCDay(); // 0=Sun..6=Sat
  if (weekday === 5) return { start_time: '18:00', end_time: null };
  if (weekday === 6) return { start_time: '17:00', end_time: null };
  if (weekday === 0) return { start_time: '12:00', end_time: null };
  return { start_time: null, end_time: null };
}
```

- [ ] **Step 6.4: Run the check — PASS**

```bash
node scripts/fredagsfett-feature-contract-check.mjs
```

- [ ] **Step 6.5: Commit**

```bash
git add functions/api/'[[route]].ts' scripts/fredagsfett-feature-contract-check.mjs
git commit -m "Apply weekday default times on tap-cycle availability upserts"
```

---

## Task 7: Kalender — admin detection, lock UI, event card

**Files:**
- Modify: `fredagsfett/kalender/index.html`
- Modify: `scripts/fredagsfett-feature-contract-check.mjs`

This task does **not** add tap-cycle yet (Task 8). It adds the data-loading, admin-gated lock form, and event card display. The existing click-to-open-side-panel flow still works.

- [ ] **Step 7.1: Add regex assertions**

```js
check('Calendar loads events alongside availability',
  /loadEvents/.test(calendar)
  && /\/api\/fredagsfett\/events/.test(calendar));
check('Calendar reads is_admin from session and gates the lock button',
  /session\.user\.is_admin/.test(calendar)
  && /lock-event-btn/.test(calendar));
check('Calendar renders LOCKED events with a glyph and ring',
  /class=["']day[^"']*locked-event/.test(calendar)
  && /𓀂/.test(calendar));
check('Calendar shows event-card with edit and cancel actions for admins',
  /id=["']event-card["']/.test(calendar)
  && /data-action=["']edit-event["']/.test(calendar)
  && /data-action=["']cancel-event["']/.test(calendar));
```

- [ ] **Step 7.2: Run check, observe failures**

```bash
node scripts/fredagsfett-feature-contract-check.mjs
```

- [ ] **Step 7.3: Add HTML structure**

In `fredagsfett/kalender/index.html`, inside the side panel block (the `<section class="panel-block">` that contains the status pills), prepend an event-card placeholder and a lock-button placeholder. Both start hidden:

```html
<div id="event-card" class="event-card" hidden>
  <div class="event-card-head">
    <strong id="event-card-title">Inlåst</strong>
    <span id="event-card-time" class="tiny"></span>
  </div>
  <div id="event-card-host" class="tiny"></div>
  <div id="event-card-location" class="tiny"></div>
  <div id="event-card-notes"></div>
  <div class="nav admin-only" data-admin-only style="margin-top:0.6rem">
    <button type="button" data-action="edit-event">Redigera</button>
    <button type="button" data-action="cancel-event">Avbryt</button>
  </div>
</div>

<button id="lock-event-btn" type="button" class="lock-event-btn admin-only" data-admin-only hidden>Lås in dagen</button>

<form id="lock-event-form" class="lock-event-form admin-only" data-admin-only hidden>
  <!-- inputs: title, host (select), location, start_time, end_time, notes; submit + cancel -->
  ...
</form>
```

Style additions (in the existing `<style>` block):

```css
.event-card { border: 1px solid var(--line-hot); border-radius: 12px; padding: 0.85rem; background: rgba(205,176,110,0.08); margin-bottom: 0.8rem; }
.lock-event-btn { margin-top: 0.6rem; }
.day.locked-event { border-color: var(--line-hot); box-shadow: inset 0 0 0 1px var(--line-hot); }
.day.locked-event::before { content: '𓀂'; display: block; color: var(--accent); }
body:not(.is-admin) [data-admin-only] { display: none !important; }
```

- [ ] **Step 7.4: Add the JS**

In the existing script block:

- After `loadAvailability()` is defined, add a parallel `loadEvents()` that fetches `/api/fredagsfett/events` and stores the result in a module-level `eventsByDate` Map.
- Modify `boot()` to call `Promise.all([loadAvailability(), loadEvents(), loadSession()])`. (If `loadSession` doesn't already exist, add one that GETs `/api/fredagsfett/session` and stores `currentSession`.)
- After session loads, toggle `document.body.classList.toggle('is-admin', !!currentSession?.user?.is_admin)`.
- In `renderCalendar()`, when building each day cell, look up `eventsByDate.get(date)`. If found and `status === 'LOCKED'`, add `locked-event` class.
- In `renderSelectedDay()`, look up the event for the selected date. Show / hide `#event-card` and populate its fields. Show / hide `#lock-event-btn` based on (no event OR event cancelled) AND `is-admin`.
- Wire `lock-event-btn` click to reveal `#lock-event-form` (prefilled with majority-time heuristic — implement as a helper that scans `availability[selectedDate]` and picks the modal `(start_time, end_time)` pair).
- Wire `lock-event-form` submit to `POST /api/fredagsfett/events` with the form fields, then reload events and re-render.
- Wire `data-action="edit-event"` to open the lock form prefilled from the event.
- Wire `data-action="cancel-event"` to `DELETE /api/fredagsfett/events/:id` after `window.confirm("Avbryt eventet för " + selectedDate + "?")`.

- [ ] **Step 7.5: Run the contract check — PASS**

```bash
node scripts/fredagsfett-feature-contract-check.mjs
```

- [ ] **Step 7.6: Manual smoke (local dev)**

```bash
npx wrangler pages dev . --d1 sp1e-db --local
```

Log in as an admin (after Task 2's safety net, the first registered user is admin). Verify:
- Lock button appears on a non-event day.
- Filling the form and submitting creates an event; reload shows the gold-ring glyph on that day.
- Logging in as a non-admin (toggle `is_admin = 0` for the user via local D1) hides the lock button and edit/cancel buttons; the event card itself is still visible.

- [ ] **Step 7.7: Commit**

```bash
git add fredagsfett/kalender/index.html scripts/fredagsfett-feature-contract-check.mjs
git commit -m "Add admin-gated event lock form and event card to kalender"
```

---

## Task 8: Kalender — tap-cycle on day grid

**Files:**
- Modify: `fredagsfett/kalender/index.html`
- Modify: `scripts/fredagsfett-feature-contract-check.mjs`

- [ ] **Step 8.1: Add assertions**

```js
check('Calendar implements tap-cycle on day cells with sessionStorage hint',
  /tapCycleStatus|cycleAvailability/.test(calendar)
  && /ff-tap-cycle-hint-seen/.test(calendar));
check('Calendar edit form always sends both time keys (value or empty string)',
  /start_time:\s*timeStartInput\.value\s*(\?\?|\|\|)\s*['"]/.test(calendar)
  && /end_time:\s*timeEndInput\.value\s*(\?\?|\|\|)\s*['"]/.test(calendar));
```

- [ ] **Step 8.2: Run check, observe failures**

- [ ] **Step 8.3: Implement tap-cycle**

In `fredagsfett/kalender/index.html`, modify the day-button click handler:

```js
const CYCLE = ['AVAILABLE', 'MAYBE', 'UNAVAILABLE', null];
async function tapCycleStatus(date) {
  const current = selfEntry(date)?.status ?? null;
  const idx = CYCLE.indexOf(current);
  const next = CYCLE[(idx + 1) % CYCLE.length];

  // Optimistic UI
  const prevState = current;
  applyOptimisticStatus(date, next);

  try {
    if (next === null) {
      await api(`/api/fredagsfett/availability?date=${encodeURIComponent(date)}`, { method: 'DELETE' });
    } else {
      // Tap-cycle never sends time fields — server applies weekday default.
      await api('/api/fredagsfett/availability', { method: 'POST', body: JSON.stringify({ date, status: next }) });
    }
    await loadAvailability();
    showTapCycleHintOnce();
  } catch (err) {
    applyOptimisticStatus(date, prevState);
    document.getElementById('calendar-error').textContent = err.message;
  }
}

function showTapCycleHintOnce() {
  if (sessionStorage.getItem('ff-tap-cycle-hint-seen')) return;
  sessionStorage.setItem('ff-tap-cycle-hint-seen', '1');
  showToast('Tryck igen för att växla mellan tillgänglig / kanske / inte tillgänglig.');
}
```

Add a small `showToast` helper (single floating div, 4s auto-dismiss) and a `applyOptimisticStatus` helper that updates the local `availability` Map and the cell DOM without a refetch.

Modify the existing day-click handler to first call `tapCycleStatus(date)` then open the side panel as before.

- [ ] **Step 8.4: Change edit form submit to always include both time keys**

Locate `saveAvailability()`. The current body almost certainly conditionally omits empty time fields. Change to always include them:

```js
body: JSON.stringify({
  date: selectedDate,
  status: selectedStatus,
  note: noteInput.value || null,
  start_time: timeStartInput.value || '',   // '' signals "intentionally cleared", not "missing"
  end_time:   timeEndInput.value   || '',
  time_note:  timeNoteInput.value  || null,
}),
```

This is the contract the spec calls for in §6.2 — it ensures re-saving never re-applies the weekday default over an explicit user choice.

- [ ] **Step 8.5: Run check — PASS**

```bash
node scripts/fredagsfett-feature-contract-check.mjs
```

- [ ] **Step 8.6: Manual smoke**

Tap a Friday three times in `wrangler pages dev`:
- First tap → AVAILABLE, server stores `start_time = '18:00'`.
- Second tap → MAYBE (no time change).
- Third tap → UNAVAILABLE.
- Fourth tap → cleared.
- Toast appears once per session.

Open a Saturday in the side panel, clear the start_time field, click Spara → reload → start_time stays empty (not 17:00).

- [ ] **Step 8.7: Commit**

```bash
git add fredagsfett/kalender/index.html scripts/fredagsfett-feature-contract-check.mjs
git commit -m "Add tap-cycle availability with optimistic update and hint toast"
```

---

## Task 9: Kalender — heatmap toggle + "Inlåsta fredagar" panel

**Files:**
- Modify: `fredagsfett/kalender/index.html`
- Modify: `scripts/fredagsfett-feature-contract-check.mjs`

- [ ] **Step 9.1: Add assertions**

```js
check('Calendar has a view-mode toggle for initials / heatmap',
  /data-view-mode=["']initials["']/.test(calendar)
  && /data-view-mode=["']heatmap["']/.test(calendar)
  && /Värmekarta/.test(calendar));
check('Calendar persists view mode in sessionStorage',
  /ff-calendar-view-mode/.test(calendar));
check('Calendar replaces "Bästa datum" panel with "Inlåsta fredagar"',
  /Inlåsta fredagar/.test(calendar)
  && /id=["']locked-events-list["']/.test(calendar)
  && !/Bästa datum/.test(calendar) // header text removed
);
```

- [ ] **Step 9.2: Run check, observe failures**

- [ ] **Step 9.3: Add the segmented toggle**

In the `<div class="summer">` toolbar (the existing summer-shortcuts row), add a sibling control:

```html
<div class="view-mode" role="tablist" aria-label="Vy">
  <button type="button" data-view-mode="initials" aria-pressed="true">Initialer</button>
  <button type="button" data-view-mode="heatmap"  aria-pressed="false">Värmekarta</button>
</div>
```

CSS:

```css
.view-mode { display: inline-flex; gap: 0; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
.view-mode button { border: 0; padding: 0.4rem 0.75rem; background: transparent; color: var(--muted); }
.view-mode button[aria-pressed="true"] { background: rgba(205,176,110,0.12); color: var(--text); }
.day.heatmap-mode .initials { display: none; }
.day.heatmap-mode .count { display: inline-block; font-family: 'DM Mono', monospace; font-size: 0.85rem; }
```

JS — on toggle button click, set `viewMode` (read/write `sessionStorage.getItem('ff-calendar-view-mode')`) and re-render the calendar. In the cell renderer, toggle `heatmap-mode` class and adjust per-cell content (initials vs count + background tint).

The tint: compute `groupSize = members.length` once after `loadSp1wise` or by a new small `loadMembers()` call to `/api/fredagsfett/admin/users` — **but** that endpoint is admin-only. Instead, derive group size from the union of users present in the `availability` payload over the last 90 days (or simply use a constant fallback of 4 — acceptable for a tiny private group, no server change). Document the choice in a one-line code comment.

- [ ] **Step 9.4: Replace "Bästa datum" panel with "Inlåsta fredagar"**

Find the existing `panel-block` that titles "Bästa datum" (text + `#best-dates` list). Replace heading and id, repurpose the renderer:

```html
<section class="panel-block">
  <h3>Inlåsta fredagar</h3>
  <div class="locked-events-list" id="locked-events-list"></div>
  <div class="tiny" id="locked-events-empty" hidden>Inga inlåsta datum framåt. <span id="best-dates-hint"></span></div>
</section>
```

In JS, `renderLockedEvents()` iterates `eventsByDate` filtered to `status === 'LOCKED'` and `date >= today`, sorts ascending, renders rows like:

```js
`<button type="button" class="locked-row" data-date="${date}">
   <span class="locked-date">${formatSwedishDate(date)}</span>
   ${event.title ? `<span class="locked-title">${escapeHtml(event.title)}</span>` : ''}
   ${event.host_name ? `<span class="locked-host">hos ${escapeHtml(event.host_name)}</span>` : ''}
   <span class="locked-count">${event.attendees.length} ja</span>
 </button>`
```

If the list is empty: show the existing best-dates content inside `#best-dates-hint` (carry the old logic over as a fallback only).

Wire `.locked-row` click to set `selectedDate = date`, scroll the calendar to that month, and re-render.

- [ ] **Step 9.5: Run check — PASS**

```bash
node scripts/fredagsfett-feature-contract-check.mjs
```

- [ ] **Step 9.6: Manual smoke**

Toggle Värmekarta in dev; verify day cells switch to a numeric count + background tint and LOCKED events keep their gold ring + glyph (heatmap does not override). Refresh — mode persists for the session.

- [ ] **Step 9.7: Commit**

```bash
git add fredagsfett/kalender/index.html scripts/fredagsfett-feature-contract-check.mjs
git commit -m "Add heatmap calendar view and Inlåsta fredagar panel"
```

---

## Task 10: Dev console — admin toggle, rename, audit line

**Files:**
- Modify: `fredagsfett/admin/index.html`
- Modify: `scripts/fredagsfett-auth-contract-check.mjs`

- [ ] **Step 10.1: Add assertions**

```js
check('Dev console renders admin toggle per user and PATCHes is_admin',
  /data-action=["']toggle-admin["']/.test(admin)
  && /is_admin/.test(admin)
  && /method:\s*['"]PATCH['"]/.test(admin));
check('Dev console can rename a user inline',
  /data-action=["']rename["']/.test(admin)
  && /name:\s*\w+\.value\.trim\(\)/.test(admin));
check('Dev console shows audit line with created_at and last_seen',
  /Skapad/.test(admin) && /Senast inloggad/.test(admin));
```

- [ ] **Step 10.2: Run check, observe failures**

```bash
node scripts/fredagsfett-auth-contract-check.mjs
```

- [ ] **Step 10.3: Extend `renderUsers()` in `fredagsfett/admin/index.html`**

Add to the existing user-card template (around `function renderUsers(users)`):

```html
<div class="user-audit tiny">
  Skapad ${escapeHtml(fmt(user.created_at))} · Senast inloggad ${escapeHtml(fmt(latestSeen(user.devices)))}
</div>
<label class="user-admin">
  <input type="checkbox" data-action="toggle-admin" ${user.is_admin ? 'checked' : ''}>
  Admin
</label>
<div class="user-rename">
  <input type="text" data-rename-input value="${escapeHtml(user.name)}" maxlength="80">
  <button type="button" data-action="rename">Spara namn</button>
</div>
```

Add a `latestSeen(devices)` helper that picks the most recent `last_seen_at` from the user's device list (returns `'—'` when no devices).

Add click handlers for `[data-action="toggle-admin"]` and `[data-action="rename"]` that call `adminApi` (added in Task 11) — but for now, while Task 11 isn't done, use the existing pattern with `fetch` directly. Task 11 will swap them.

The fetch body for toggle-admin:
```js
adminApi(`/api/fredagsfett/admin/users/${userId}`, { method: 'PATCH', body: JSON.stringify({ is_admin: checked ? 1 : 0 }) })
```

For rename:
```js
adminApi(`/api/fredagsfett/admin/users/${userId}`, { method: 'PATCH', body: JSON.stringify({ name: input.value.trim() }) })
```

- [ ] **Step 10.4: Run check — PASS**

```bash
node scripts/fredagsfett-auth-contract-check.mjs
```

- [ ] **Step 10.5: Commit**

```bash
git add fredagsfett/admin/index.html scripts/fredagsfett-auth-contract-check.mjs
git commit -m "Add admin toggle, rename, and audit line to dev console"
```

---

## Task 11: Dev console — adminApi wrapper, confirms, robust UX

**Files:**
- Modify: `fredagsfett/admin/index.html`
- Modify: `scripts/fredagsfett-auth-contract-check.mjs`

- [ ] **Step 11.1: Add assertions**

```js
check('Dev console wraps fetch in adminApi with 401 re-auth handling',
  /function adminApi/.test(admin)
  && /res\.status === 401/.test(admin)
  && /setAdminUnlocked\(false\)/.test(admin));
check('Dev console confirms destructive actions in Swedish',
  /window\.confirm\(['"`].*\?['"`]\)/.test(admin));
check('Dev console preserves scroll position across refreshes',
  /window\.scrollY/.test(admin) && /scrollTo\(/.test(admin));
check('Dev console disables buttons while requests are in flight',
  /button\.disabled = true/.test(admin) && /button\.disabled = false/.test(admin));
```

- [ ] **Step 11.2: Run check, observe failures**

- [ ] **Step 11.3: Implement `adminApi` wrapper**

Near the top of the script block in `fredagsfett/admin/index.html`:

```js
async function adminApi(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  if (res.status === 401) {
    setAdminUnlocked(false);
    setStatus('Din admin-session löpte ut. Logga in igen.', false);
    document.getElementById('admin-password')?.focus();
    throw new Error('admin_session_expired');
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(data.error || `${res.status}`);
  return data;
}
```

Replace every direct `fetch('/api/fredagsfett/admin/...')` with `adminApi(...)`.

- [ ] **Step 11.4: Add confirms**

Wrap delete-user and revoke-device handlers in `window.confirm` with Swedish strings:

```js
if (!window.confirm(`Ta bort ${user.name} och alla deras enheter?`)) return;
// ...
if (!window.confirm('Återkalla den här enheten?')) return;
```

- [ ] **Step 11.5: Add scroll-preserving refresh**

Modify `loadUsers()` to record and restore `window.scrollY`:

```js
async function loadUsers() {
  const y = window.scrollY;
  // ...existing fetch + render...
  requestAnimationFrame(() => window.scrollTo(0, y));
}
```

- [ ] **Step 11.6: Add in-flight button disabling**

For each action handler that mutates server state (toggle-admin, rename, delete, revoke), wrap with:

```js
const button = event.currentTarget;
button.disabled = true;
try {
  await adminApi(...);
  await loadUsers();
} catch (err) {
  setStatus(err.message, false);
} finally {
  button.disabled = false;
}
```

For checkbox toggles, treat the checkbox itself as the button.

- [ ] **Step 11.7: Run check — PASS**

```bash
node scripts/fredagsfett-auth-contract-check.mjs
```

- [ ] **Step 11.8: Manual smoke**

- Let the admin session expire (2 hours, or temp-shorten `FREDAGSFETT_ADMIN_SESSION_MAX_AGE_SECONDS` locally to 60). Trigger an action — re-auth message shows; password field focuses.
- Delete user, revoke device — confirms appear.
- Scroll halfway down the user list, toggle admin on a user, list refreshes, scroll stays.

- [ ] **Step 11.9: Commit**

```bash
git add fredagsfett/admin/index.html scripts/fredagsfett-auth-contract-check.mjs
git commit -m "Harden Fredagsfett dev console with adminApi wrapper and UX guards"
```

---

## Task 12: Documentation + production deployment

**Files:**
- Modify: `PROJECT.md`

- [ ] **Step 12.1: Update `PROJECT.md`**

In the "Pages" table, replace the visitor row with:

```
| `/fredagsfett`           | `fredagsfett/index.html`           | Private gateway — password + device fingerprint |
| `/fredagsfett/kalender`  | `fredagsfett/kalender/index.html`  | Group calendar — availability, tap-cycle, heatmap, locked events |
| `/fredagsfett/sp1wise`   | `fredagsfett/sp1wise/index.html`   | Group expense split + settlements + CSV export |
| `/fredagsfett/admin`     | `fredagsfett/admin/index.html`     | Admin dev console — manage users, devices, admin flag |
```

In "API Routes", under the existing fredagsfett block, add:

```
| GET    | `fredagsfett/events`            | user        | List events in window (default current month); attendees joined from availability |
| POST   | `fredagsfett/events`            | admin-user  | Lock a date (upsert on UNIQUE(group, date)) |
| PATCH  | `fredagsfett/events/:id`        | admin-user  | Edit event fields |
| DELETE | `fredagsfett/events/:id`        | admin-user  | Soft cancel (status=CANCELLED) |
```

Add a new "Wrangler commands" entry:

```bash
# Apply Fredagsfett events migration to production
npx wrangler d1 execute sp1e-db --remote --file=fredagsfett-migration-003-events.sql

# Seed first admin (one-time, optional — auto-seed in code is a safety net)
npx wrangler d1 execute sp1e-db --remote \
  --command="UPDATE ff_users SET is_admin = 1 WHERE name = 'Simon';"
```

In "Known Issues / TODO", remove items now addressed (none directly, but flag if any apply) and add follow-up bullets for the out-of-spec items: photo galleries per event, SP1Wise event-tagging, iCal feed, activity-log viewer.

- [ ] **Step 12.2: Commit docs**

```bash
git add PROJECT.md
git commit -m "Document Fredagsfett events API and admin console capabilities"
```

- [ ] **Step 12.3: Apply migration to production D1**

```bash
npx wrangler d1 execute sp1e-db --remote --file=fredagsfett-migration-003-events.sql
```

Expected: 3 commands executed (1 table + 2 indexes).

- [ ] **Step 12.4: Seed first admin (if needed)**

Check first whether any admins already exist:

```bash
npx wrangler d1 execute sp1e-db --remote --command="SELECT id, name, is_admin FROM ff_users ORDER BY created_at ASC LIMIT 5"
```

If none have `is_admin = 1` and the FF_ADMIN_NAMES env doesn't already cover the operator's name:

```bash
npx wrangler d1 execute sp1e-db --remote --command="UPDATE ff_users SET is_admin = 1 WHERE name = 'Simon'"
```

(Substitute the actual registered name.)

- [ ] **Step 12.5: Push to deploy**

```bash
git push origin main
```

Cloudflare Pages auto-deploys.

- [ ] **Step 12.6: Verify on production**

- Log in to https://sp1e.se/fredagsfett as the seeded admin.
- Open the calendar — "Lås in dagen" button appears.
- Lock a test Friday with title, host, time. Reload — event renders with gold ring.
- Cancel it from the side panel — confirms, then day returns to normal.
- Open `/fredagsfett/admin`, toggle admin off on yourself, refresh the calendar — lock button disappears.
- Re-enable admin via D1 command, refresh — back to normal.

---

## Closing

After Task 12, the spec's Goals 1–5 are met and the Non-goals are explicitly left for follow-up plans (photo galleries, SP1Wise event-tagging, iCal feeds, activity-log viewer).

The codebase will gain ~600 lines in `functions/api/[[route]].ts` (now ~11k lines — past time to split, but out of scope here; flagged in the spec § "Code hygiene" suggestion). All UI changes are localized to the four existing `fredagsfett/*` pages — no new HTML files.
