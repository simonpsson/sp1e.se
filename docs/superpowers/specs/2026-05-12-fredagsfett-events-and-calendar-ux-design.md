# Fredagsfett — Events Lock-in + Calendar UX (Design)

**Date:** 2026-05-12
**Status:** Draft for review
**Scope:** `fredagsfett/kalender/`, `fredagsfett/admin/`, `functions/api/[[route]].ts`, new D1 migration `fredagsfett-migration-003-events.sql`

## 1. Goals

1. Promote availability from a soft poll to actual events ("Lock-in" flow).
2. Speed up availability marking via tap-cycle on the day grid.
3. Surface group overlap visually with a heatmap mode.
4. Gate decision-actions (lock / edit / cancel events) to admin users via the existing-but-dormant `ff_users.is_admin` flag.
5. Harden the dev console (`/fredagsfett/admin/`) as the admin control plane, including granting the `is_admin` flag.

## 2. Non-goals (deferred to later iterations)

- Per-event photos, SP1Wise tagging of expenses to events, Spotify playlists, "who brings what" checklists, iCal feeds. These all hang on the event entity introduced here but are out of scope for this iteration.
- Per-user time-window preferences.
- Email / push notifications.
- Multi-group support beyond the single seeded `fredagsfett` group.

## 3. Permissions model

Two auth contexts already exist in `functions/api/[[route]].ts`:

- **User session** — cookie `ff_session`, helper `requireFredagsfettUser`. Any registered group member.
- **Admin (break-glass) session** — cookie `ff_admin_session`, helper `requireFredagsfettAdmin` (which internally calls `requireFredagsfettUser` then verifies the admin cookie). 2-hour TTL. Used today only by the `/fredagsfett/admin` dev console.

The `ff_users.is_admin` column is already surfaced in the user payload (see `fredagsfettUserPayload`) but is not enforced anywhere server-side. This spec activates it.

New helper to add: **`requireFredagsfettAdminUser`** — calls `requireFredagsfettUser`, then returns the session if `session.user.is_admin === 1`, else throws a 403 `not_admin` response. This does **not** require the `ff_admin_session` cookie. It is the gate for ordinary admin actions performed from regular Fredagsfett pages.

Resulting matrix:

| Action | Gate |
|---|---|
| View calendar, view events, view own/others' availability | `requireFredagsfettUser` |
| Upsert / delete own availability | `requireFredagsfettUser` |
| Lock event, edit event, cancel event | `requireFredagsfettAdminUser` (user + `is_admin = 1`) |
| Toggle `is_admin` on another user, rename user, delete user, revoke device | `requireFredagsfettAdmin` (break-glass admin cookie, dev console) |

Rationale: keeping the dev console as the only surface for granting/revoking admin rights means a regular admin user who left their phone unlocked cannot promote themselves' device to "super-admin" without the separate admin password. The break-glass session is the trust boundary around admin-management itself.

## 4. Bootstrap: first admin

`ff_users.is_admin` is currently `0` for all rows. Two safety nets, applied at deploy time:

1. **Manual seed (preferred):** as part of the migration step, the operator runs:
   ```sql
   UPDATE ff_users SET is_admin = 1 WHERE name = 'Simon';
   ```
   (Replace name with whichever account should be the first admin.) This is documented in the migration file header.

2. **Auto-seed safety net:** in `fredagsfettRegister`, when a new user is created, if **no** users with `is_admin = 1` exist yet, the new user is promoted to admin automatically. This means even a clean DB recovers to a usable admin state through normal registration. After at least one admin exists, registrations create normal users.

   This runs **in addition to** the existing `FF_ADMIN_NAMES` env-driven promotion already present in `fredagsfettRegister` (a registrant whose name appears in that comma-separated env var is auto-promoted). The effective rule becomes `isAdmin = nameMatchesFFAdminNames || zeroAdminsExistInDB`. Neither path is removed.

## 5. Design A — Events / Lock-in

### 5.1 Schema (`fredagsfett-migration-003-events.sql`)

```sql
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

Notes:
- `UNIQUE(group_id, date)` enforces one event per day. Re-locking a cancelled date updates the existing row (`status = 'LOCKED'`, `cancelled_at = NULL`, `updated_at = now`) rather than inserting a duplicate.
- Time columns are `TEXT` in `HH:MM` form, matching `ff_availability.start_time` / `end_time`.

### 5.2 API endpoints

All under `/api/fredagsfett/`. Read endpoints take user session; write endpoints take admin-user session.

| Method | Path | Auth | Body | Notes |
|---|---|---|---|---|
| `GET` | `events?from=YYYY-MM-DD&to=YYYY-MM-DD` | user | — | Default window: first to last day of current month. Response items include `attendees: [{ user_id, name, status }]` derived from `ff_availability` joined on `(group, date)` where `status IN ('AVAILABLE','MAYBE')`. |
| `POST` | `events` | admin-user | `{ date, title?, host_user_id?, location?, start_time?, end_time?, notes? }` | Creates or revives event for `(default_group, date)`. Returns the event row. 400 if `date` malformed. |
| `PATCH` | `events/:id` | admin-user | partial event fields | Updates `updated_at`. Cannot change `date` (delete + recreate if needed). |
| `DELETE` | `events/:id` | admin-user | — | Soft cancel: `status='CANCELLED'`, `cancelled_at=now`. The row is retained for activity-log integrity. |

Validation:
- `date`: ISO `YYYY-MM-DD`. No restriction on past dates — admins may need to log past lock-ins retroactively.
- `host_user_id` must exist in `ff_users` and not be deleted.
- `start_time` / `end_time`: optional, both `HH:MM` (24-hour). No range validation beyond format.

Activity log: every create / edit / cancel writes a row to `ff_activity_log` with `entity_type = 'event'`, `entity_id = <event.id>`, `type ∈ {'event_locked','event_updated','event_cancelled'}`.

### 5.3 Calendar UI changes (`fredagsfett/kalender/index.html`)

**Client admin-detection.** The kalender page determines whether the current viewer is an admin by reading `is_admin` from the response of `GET /api/fredagsfett/session` (already returned by `fredagsfettUserPayload`). All admin-only UI affordances (lock button, edit/cancel buttons, lock form) are gated on this client-side flag; the server-side `requireFredagsfettAdminUser` enforces authority on every write.

**Day grid rendering** (in `renderCalendar()`):
- Day with `status='LOCKED'` event: gold ring border (`var(--accent)`), 𓀂 hieroglyph centered in cell. Availability initials still rendered below as a thin row.
- Day with `status='CANCELLED'` event: rendered normally (event is hidden from UI; cancellation is a history artifact).

**Side panel** (selected-day section, currently the status pills + time fields):
- *Non-event day, viewer is admin:* a new **"Lås in dagen"** button below the existing "Spara"/"Rensa" row opens an inline mini-form (title, host select from group members, location text, start/end time prefilled per §5.4, notes textarea). "Bekräfta inlåsning" POSTs `/events`.
- *Non-event day, viewer is non-admin:* no lock button. Status pills + time fields function as today.
- *Day with LOCKED event, viewer is admin:* event card shown read-only at top of panel (host name, time range, location, notes) with **"Redigera"** and **"Avbryt"** action buttons. Edit reuses the same mini-form prefilled from the event. Cancel calls DELETE after `window.confirm`.
- *Day with LOCKED event, viewer is non-admin:* event card shown read-only, no action buttons. Status pills + time fields remain so the user can still update their own availability.

**Replacement of "Bästa datum" panel block** (currently below the calendar):
- Becomes **"Inlåsta fredagar"** — list of upcoming LOCKED events (date, day-of-week label, host name if set, attendee count). Click a row scrolls the calendar to that month and selects that day. If there are zero locked events in the next 90 days, show the previous "best dates" list as a fallback ("Tipsade datum") so admins know where to focus.

### 5.4 Time-default heuristic for the lock form

When the admin opens the lock form, prefilled `start_time` / `end_time` are computed in this priority order:

1. Most common `(start_time, end_time)` pair across `AVAILABLE` entries on that date (excluding `NULL` times).
2. If tied or no entries: weekday default from §6.2 (Fri 18:00, Sat 17:00, Sun 12:00, otherwise empty).

The admin can overwrite either field before submitting.

## 6. Design B — Calendar UX

### 6.1 Tap-cycle on day grid

Current behavior: clicking a day selects it and opens the side panel; status pills must be clicked to change state, then "Spara" pressed.

New behavior:
- A **click on a day cell** cycles the *current user's* status on that date: `(no entry) → AVAILABLE → MAYBE → UNAVAILABLE → (no entry)`. The transition immediately calls the existing `POST /availability` (or `DELETE` for the final clearing step). The side panel still opens (single source of truth for editing time / notes), and the status pills reflect the new state.
- Optimistic update: the cell's status indicator changes color before the network round-trip completes. On API error, the cell reverts and `#calendar-error` shows the message.
- **Discoverability:** sessionStorage key `ff-tap-cycle-hint-seen`. On first click in a session (when the flag is absent), a one-line toast appears above the calendar: *"Tryck igen för att växla mellan tillgänglig / kanske / inte tillgänglig."* The toast auto-dismisses after 4 s or on next click. The flag is set on first toast display.
- **Accessibility:** day cells already use `<button type="button">`. Add `aria-label` that describes the current status and announces "klicka för att växla". Keyboard `Enter` / `Space` triggers the same cycle.

### 6.2 Weekday default time window (server-side)

In `fredagsfettAvailabilityUpsert` (the POST handler):

```ts
// pseudocode
if (status === 'AVAILABLE'
    && !('start_time' in body)
    && !('end_time' in body)) {
  const weekday = dayOfWeek(date); // 0=Sun..6=Sat
  if (weekday === 5) { start_time = '18:00'; end_time = null; }
  else if (weekday === 6) { start_time = '17:00'; end_time = null; }
  else if (weekday === 0) { start_time = '12:00'; end_time = null; }
}
```

Semantics:
- Key **missing** from body → apply default (this is what tap-cycle sends — no time fields at all).
- Key present with empty string `""` → store `NULL`, *do not* apply default (this is what the explicit edit form sends when the user clears the field).
- Key present with a value → store the value.

Edit-form contract: the explicit time-fields side-panel form **always** includes both `start_time` and `end_time` keys in the POST body — either as a string value or as `""` when the user cleared the field. This guarantees that re-saving a row via the form never re-applies the weekday default and silently overwrites a previously stored explicit time. Only the tap-cycle path (which sends no time keys) is eligible for the default.

### 6.3 Overlap heatmap toggle

The existing summer-view (`<div class="summer">`) toolbar gets a second segmented control: **"Initialer / Värmekarta"**.

- *Initialer* (default, current behavior): each day cell shows up to 4 initials of users with entries.
- *Värmekarta*: each day cell shows the AVAILABLE count as a numeral; background tinted with `rgba(205,176,110, count / groupSize)`. MAYBE entries contribute a secondary tint (`rgba(217,189,103, 0.5 * maybeCount / groupSize)`) layered behind. UNAVAILABLE entries are not visualized in heatmap mode.

State persists per session via `sessionStorage.ff-calendar-view-mode`. LOCKED-event styling (gold ring + glyph) overrides both modes.

No new API call — heatmap reuses the same `/availability` payload.

## 7. Dev Console hardening (`fredagsfett/admin/index.html`)

### 7.1 New functional capabilities

- **Toggle admin flag per user**: render a checkbox next to each user's name. Change calls `PATCH /api/fredagsfett/admin/users/:id` with `{ is_admin: 0|1 }`. The endpoint at `fredagsfettAdminUpdateUser` currently accepts only `{ name }` — extend it to also accept `is_admin` and to **reject unknown fields** (400) so that broadening the surface stays explicit rather than accidental.
- **Rename user**: inline text input + save button. Same PATCH endpoint with `{ name }`. Server already enforces UNIQUE; surface `409` as "namnet är upptaget".
- **Show admin badge** on users with `is_admin = 1` even when the toggle is collapsed.

(An events-tab read-only listing of LOCKED/CANCELLED events would be useful but is **deferred** — it is not strictly required to operate as admin, and it expands the surface.)

### 7.2 Robustness improvements

- A shared `adminApi(path, options)` wrapper for all admin fetches:
  - `401`: treat as session expired → call `setAdminUnlocked(false)`, show toast "Din admin-session löpte ut", focus the lock-screen password input.
  - `403`: hard error, surface message.
  - `>= 500` or network error: transient — show retry button beside the failed action; do not log the user out.
- `window.confirm` (Swedish) before **Delete user** and **Revoke device**. Already-revoked devices and the current device cannot be revoked (mirrors today's `disabled` state).
- Status line styling: green for ok, red for error, dimmed for in-flight. Currently single danger color.
- Auto-refresh user list after every successful mutation; preserve scroll position by storing `window.scrollY` before refresh and restoring after.
- Disable the triggering button during in-flight requests; re-enable in `finally`. This applies to delete user, revoke device, toggle admin, rename.
- Add a thin **audit row** at the top of each user card: `Skapad <date> · Senast inloggad <date>` derived from the existing `ff_users.created_at` and the most recent `ff_devices.last_seen_at` for that user. Read-only.

### 7.3 What dev console does *not* gain in this iteration

- Event management UI (use the calendar page as admin).
- Activity log viewer.
- SP1Wise admin functions.

These are valid future additions; out of scope here.

## 8. Migration & deployment

Order of operations on production:

1. Apply schema migration:
   ```bash
   npx wrangler d1 execute sp1e-db --remote --file=fredagsfett-migration-003-events.sql
   ```
2. Seed first admin (one-time, if no admins exist yet):
   ```bash
   npx wrangler d1 execute sp1e-db --remote --command="UPDATE ff_users SET is_admin = 1 WHERE name = 'Simon';"
   ```
   The auto-seed safety net in `fredagsfettRegister` (§4) provides a backstop if this is forgotten.
3. Push `main` (Cloudflare Pages auto-deploys).
4. Verify on production:
   - Log in as the seeded admin → calendar shows "Lås in dagen" button.
   - Log in as a non-admin → calendar does not show the button; lock attempts via raw API return 403.
   - Dev console → admin toggle works; revoke / delete with confirms.

## 9. Testing

### 9.1 Contract checks

Update `scripts/fredagsfett-feature-contract-check.mjs`:
- `GET /events` (anonymous → 401; user → 200; admin → 200).
- `POST /events` (anonymous → 401; user → 403; admin → 201).
- `PATCH /events/:id` (user → 403; admin → 200).
- `DELETE /events/:id` (user → 403; admin → 200; verify `status='CANCELLED'`).

Update `scripts/fredagsfett-auth-contract-check.mjs`:
- `requireFredagsfettAdminUser` returns 403 with `error: 'not_admin'` for a non-admin user.

### 9.2 Manual smoke test

- Tap-cycle a day three times (none → AVAILABLE → MAYBE → UNAVAILABLE → none); verify each click persists and toast shows once per session.
- Heatmap toggle reflects current group state; switching views does not refetch.
- Lock an event as admin → re-load page → non-admin viewer sees it read-only.
- Cancel the event → calendar reverts that day to normal availability rendering.
- Re-lock the same date → existing row is revived (UNIQUE constraint).
- Dev console: promote a non-admin to admin, confirm the next page load on that user's session shows lock buttons.

## 10. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Forgetting to seed the first admin leaves the system with no one able to lock events. | Auto-seed safety net in `fredagsfettRegister` (§4). |
| Tap-cycle change confuses returning users who expect the old click → panel flow. | Side panel still opens on click; toast hint on first interaction; original Save / Clear buttons remain functional. |
| Heatmap visual interferes with LOCKED-event styling. | LOCKED ring + glyph rendered last, overriding heatmap tint. |
| `ff_admin_session` expiry during dev-console use disrupts admin work mid-action. | `adminApi` wrapper treats 401 as soft, surfaces a re-auth toast without losing pending input. |
| Deleting a user (via dev console) leaves orphan events with NULL `host_user_id`. | Schema uses `ON DELETE SET NULL`; UI renders missing host as "—". |

## 11. Out-of-spec follow-ups (tracked for later)

- Event-tagged SP1Wise expenses.
- Photo gallery per event (R2 already configured).
- "Who brings what" checklist per event.
- iCal feed per user.
- Activity-log viewer in dev console.
- Self-service device re-link when IP/UA changes.
