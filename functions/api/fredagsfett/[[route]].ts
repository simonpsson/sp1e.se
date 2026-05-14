/**
 * Fredagsfett Pages Function — /api/fredagsfett/*
 *
 * Split out of /api/[[route]].ts so the Fredagsfett feature (auth, calendar,
 * events, SP1Wise, admin, iCal, items, photos, activity) lives in one focused
 * file. Cloudflare Pages routes /api/fredagsfett/* here because this nested
 * catch-all is more specific than the sibling /api/[[route]].ts.
 *
 * Self-contained: includes its own Env interface, shared utility helpers
 * (json, HttpError, AuthError, getCookie, cors), and constants. The parent
 * /api/[[route]].ts no longer dispatches Fredagsfett routes.
 */

export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  FF_PASSWORD?: string;
  FF_SESSION_SECRET?: string;
  FF_DEVICE_HASH_SALT?: string;
  FF_ADMIN_NAMES?: string;
  FF_ADMIN_PASSWORD?: string;
}

class AuthError extends Error { constructor() { super('Unauthorized'); } }
class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

function getCookie(request: Request, name: string): string | null {
  const header = request.headers.get('Cookie') ?? '';
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq !== -1 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

function cors(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': 'https://sp1e.se',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors() },
  });
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ─── Fredagsfett constants (moved from /api/[[route]].ts) ────────────────────

const FREDAGSFETT_SESSION_COOKIE = 'ff_session';
const FREDAGSFETT_ADMIN_COOKIE = 'ff_admin_session';
const FREDAGSFETT_SESSION_MAX_AGE_SECONDS = 2 * 365 * 24 * 60 * 60;
const FREDAGSFETT_ADMIN_SESSION_MAX_AGE_SECONDS = 2 * 60 * 60;
const FREDAGSFETT_AUTH_WINDOW_SECONDS = 10 * 60;
const FREDAGSFETT_AUTH_MAX_ATTEMPTS = 5;
// Local/dev fallback only. Production should set FF_PASSWORD in Cloudflare Pages secrets.
const DEFAULT_FREDAGSFETT_PASSWORD = 'färskfisk';
// Local/dev fallback for the 𓀂 admin console. Production may set FF_ADMIN_PASSWORD.
const DEFAULT_FREDAGSFETT_ADMIN_PASSWORD = 'Adderall123!';

// ─── Fredagsfett types, handlers, helpers (moved from /api/[[route]].ts) ───

// ─── Auth handlers ────────────────────────────────────────────────────────────

type FredagsfettConfig = {
  passwordCandidates: string[];
  sessionSecret: string;
  hashSalt: string;
  adminNames: Set<string>;
};

type FredagsfettSessionPayload = {
  v: 1;
  deviceId: string;
  userId: string | null;
  exp: number;
};

type FredagsfettAdminPayload = {
  v: 1;
  scope: 'fredagsfett-admin';
  exp: number;
};

type FredagsfettDeviceRow = {
  id: string;
  user_id: string | null;
  ip_hash: string;
  user_agent_hash: string;
  revoked_at: string | null;
};

type FredagsfettUserRow = {
  id: string;
  name: string;
  is_admin: number;
  deleted_at: string | null;
};

type FredagsfettAdminUserRow = {
  id: string;
  name: string;
  is_admin: number;
  created_at: string;
  updated_at: string;
  device_count: number;
  active_device_count: number;
};

type FredagsfettAdminDeviceRow = {
  id: string;
  user_id: string | null;
  created_at: string;
  last_seen_at: string;
  revoked_at: string | null;
};

type FredagsfettAvailabilityRow = {
  id: string;
  user_id: string;
  user_name: string;
  date: string;
  status: 'AVAILABLE' | 'MAYBE' | 'UNAVAILABLE';
  note: string | null;
  start_time: string | null;
  end_time: string | null;
  time_note: string | null;
  updated_at: string;
};

type FredagsfettMemberRow = {
  id: string;
  name: string;
  is_admin: number;
};

type FredagsfettGroupRow = {
  id: string;
  name: string;
  created_at: string;
};

type FredagsfettExpenseRow = {
  id: string;
  group_id: string;
  paid_by_id: string;
  paid_by_name: string;
  amount_cents: number;
  currency: string;
  description: string;
  date: string;
  split_method: string;
  created_at: string;
  updated_at: string;
};

type FredagsfettExpenseShareRow = {
  id: string;
  expense_id: string;
  user_id: string;
  user_name: string;
  amount_cents: number;
};

type FredagsfettSettlementRow = {
  id: string;
  group_id: string;
  from_user_id: string;
  from_user_name: string;
  to_user_id: string;
  to_user_name: string;
  amount_cents: number;
  currency: string;
  date: string;
  note: string | null;
  created_at: string;
};

type FredagsfettCommentRow = {
  id: string;
  expense_id: string;
  user_id: string;
  user_name: string;
  body: string;
  created_at: string;
};

async function fredagsfettAuth(request: Request, env: Env): Promise<Response> {
  const cfg = fredagsfettConfig(env);
  if (!cfg.ok) return cfg.response;

  let body: { password?: string };
  try { body = await request.json(); }
  catch { return json({ error: 'Ogiltig JSON.' }, 400); }

  if (typeof body.password !== 'string') return json({ error: 'Lösenord krävs.' }, 400);

  const fingerprint = await fredagsfettFingerprint(request, cfg.value);
  const throttle = await fredagsfettAuthThrottle(env, fingerprint.ipHash);
  if (throttle.throttled) {
    return json({ error: 'För många försök. Vänta en stund.', next_allowed_at: throttle.nextAllowedAt }, 429);
  }

  const valid = fredagsfettPasswordMatches(body.password, cfg.value.passwordCandidates);
  await fredagsfettRecordAuthAttempt(env, fingerprint.ipHash, throttle.windowStart);
  if (!valid) {
    await sleep(220 + Math.random() * 220);
    return json({ error: 'Fel lösenord.' }, 401);
  }

  const device = await fredagsfettFindOrCreateDevice(env, fingerprint.ipHash, fingerprint.userAgentHash);
  const user = device.user_id ? await fredagsfettLoadUser(env, device.user_id) : null;
  const token = await signFredagsfettSession({
    v: 1,
    deviceId: device.id,
    userId: user?.id ?? null,
    exp: fredagsfettSessionExpiry(),
  }, cfg.value.sessionSecret);

  return fredagsfettJson({
    success: true,
    authenticated: true,
    needs_registration: !user,
    user: user ? fredagsfettUserPayload(user) : null,
  }, 200, fredagsfettSessionCookie(token));
}

async function fredagsfettSession(request: Request, env: Env): Promise<Response> {
  const cfg = fredagsfettConfig(env);
  if (!cfg.ok) return cfg.response;

  const cookie = getCookie(request, FREDAGSFETT_SESSION_COOKIE);
  if (cookie) {
    const session = await fredagsfettSessionFromCookie(env, cookie, cfg.value.sessionSecret);
    if (session) {
      await fredagsfettTouchDevice(env, session.device.id);
      return json({
        authenticated: true,
        needs_registration: !session.user,
        user: session.user ? fredagsfettUserPayload(session.user) : null,
      });
    }
  }

  const fingerprint = await fredagsfettFingerprint(request, cfg.value);
  const device = await env.DB.prepare(
    `SELECT id, user_id, ip_hash, user_agent_hash, revoked_at
       FROM ff_devices
      WHERE ip_hash = ? AND user_agent_hash = ? AND revoked_at IS NULL AND user_id IS NOT NULL`
  ).bind(fingerprint.ipHash, fingerprint.userAgentHash).first<FredagsfettDeviceRow>();

  if (!device?.user_id) return json({ authenticated: false, needs_registration: true, user: null });

  const user = await fredagsfettLoadUser(env, device.user_id);
  if (!user) return json({ authenticated: false, needs_registration: true, user: null });

  await fredagsfettTouchDevice(env, device.id);
  const token = await signFredagsfettSession({
    v: 1,
    deviceId: device.id,
    userId: user.id,
    exp: fredagsfettSessionExpiry(),
  }, cfg.value.sessionSecret);

  return fredagsfettJson({
    authenticated: true,
    restored: true,
    needs_registration: false,
    user: fredagsfettUserPayload(user),
  }, 200, fredagsfettSessionCookie(token));
}

async function fredagsfettRegister(request: Request, env: Env): Promise<Response> {
  const cfg = fredagsfettConfig(env);
  if (!cfg.ok) return cfg.response;

  const cookie = getCookie(request, FREDAGSFETT_SESSION_COOKIE);
  if (!cookie) return json({ error: 'Session saknas.' }, 401);

  const session = await fredagsfettSessionFromCookie(env, cookie, cfg.value.sessionSecret);
  if (!session) return json({ error: 'Sessionen är ogiltig.' }, 401);

  if (session.user) {
    return json({
      success: true,
      needs_registration: false,
      user: fredagsfettUserPayload(session.user),
    });
  }

  let body: { name?: string };
  try { body = await request.json(); }
  catch { return json({ error: 'Ogiltig JSON.' }, 400); }

  const name = normalizeFredagsfettName(body.name);
  if (!name) return json({ error: 'Ange ett namn mellan 2 och 80 tecken.' }, 400);

  const userId = crypto.randomUUID();
  const nameIsAdminListed = cfg.value.adminNames.has(name.toLocaleLowerCase('sv-SE'));

  // Safety net: if no admins exist yet, the first registrant is auto-promoted.
  // This unblocks recovery after a DB wipe even when FF_ADMIN_NAMES isn't set.
  const adminCountRow = await env.DB.prepare(
    `SELECT COUNT(*) as cnt FROM ff_users WHERE is_admin = 1 AND deleted_at IS NULL`
  ).first<{ cnt: number }>();
  const zeroAdminsExist = !adminCountRow || adminCountRow.cnt === 0;

  const isAdmin = nameIsAdminListed || zeroAdminsExist ? 1 : 0;
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO ff_users (id, name, is_admin, created_at, updated_at)
         VALUES (?, ?, ?, datetime('now'), datetime('now'))`
      ).bind(userId, name, isAdmin),
      env.DB.prepare(
        `UPDATE ff_devices SET user_id = ?, last_seen_at = datetime('now') WHERE id = ? AND revoked_at IS NULL`
      ).bind(userId, session.device.id),
      env.DB.prepare(
        `INSERT OR IGNORE INTO ff_group_members (group_id, user_id, role) VALUES ('fredagsfett', ?, ?)`
      ).bind(userId, isAdmin ? 'admin' : 'member'),
    ]);
  } catch (err) {
    const msg = errorMessage(err);
    if (/unique|constraint/i.test(msg)) return json({ error: 'Namnet är upptaget. Välj ett annat namn.' }, 409);
    throw err;
  }

  const user = await fredagsfettLoadUser(env, userId);
  const token = await signFredagsfettSession({
    v: 1,
    deviceId: session.device.id,
    userId,
    exp: fredagsfettSessionExpiry(),
  }, cfg.value.sessionSecret);

  return fredagsfettJson({
    success: true,
    needs_registration: false,
    user: user ? fredagsfettUserPayload(user) : { id: userId, name, is_admin: !!isAdmin },
  }, 200, fredagsfettSessionCookie(token));
}

async function fredagsfettLogout(request: Request, env: Env): Promise<Response> {
  const cfg = fredagsfettConfig(env);
  const cookie = getCookie(request, FREDAGSFETT_SESSION_COOKIE);
  if (cfg.ok && cookie) {
    const session = await fredagsfettSessionFromCookie(env, cookie, cfg.value.sessionSecret);
    if (session) {
      await env.DB.prepare(
        `UPDATE ff_devices SET revoked_at = datetime('now'), last_seen_at = datetime('now') WHERE id = ?`
      ).bind(session.device.id).run().catch(() => {});
    }
  }
  return fredagsfettJson({ success: true }, 200, clearFredagsfettSessionCookie());
}

async function fredagsfettAvailabilityList(request: Request, env: Env): Promise<Response> {
  const session = await requireFredagsfettUser(request, env);
  await fredagsfettEnsureAvailabilityTimeColumns(env);
  const url = new URL(request.url);
  const month = normalizeFredagsfettMonth(url.searchParams.get('month')) ?? currentFredagsfettMonth();
  const nextMonth = addMonthsToFredagsfettMonth(month, 1);

  const entries = await env.DB.prepare(
    `SELECT a.id, a.user_id, u.name AS user_name, u.is_admin AS user_is_admin,
            a.date, a.status, a.note, a.start_time, a.end_time, a.time_note, a.updated_at
       FROM ff_availability a
       JOIN ff_users u ON u.id = a.user_id AND u.deleted_at IS NULL
      WHERE a.date >= ? AND a.date < ?
      ORDER BY a.date ASC, u.name COLLATE NOCASE ASC`
  ).bind(month, nextMonth).all<FredagsfettAvailabilityRow & { user_is_admin: number }>();

  const bestDates = await env.DB.prepare(
    `SELECT a.date,
            SUM(CASE WHEN a.status = 'AVAILABLE' THEN 1 ELSE 0 END) AS available_count,
            SUM(CASE WHEN a.status = 'MAYBE' THEN 1 ELSE 0 END) AS maybe_count,
            SUM(CASE WHEN a.status = 'UNAVAILABLE' THEN 1 ELSE 0 END) AS unavailable_count
       FROM ff_availability a
       JOIN ff_users u ON u.id = a.user_id AND u.deleted_at IS NULL
      WHERE a.date >= date('now')
      GROUP BY a.date
      ORDER BY available_count DESC, unavailable_count ASC, maybe_count DESC, a.date ASC
      LIMIT 8`
  ).all<{ date: string; available_count: number; maybe_count: number; unavailable_count: number }>();

  return json({
    user: fredagsfettUserPayload(session.user),
    month,
    entries: (entries.results ?? []).map(entry => ({
      ...entry,
      user_is_admin: !!entry.user_is_admin,
      is_self: entry.user_id === session.user.id,
    })),
    best_dates: (bestDates.results ?? []).map(row => ({
      date: row.date,
      available_count: Number(row.available_count ?? 0),
      maybe_count: Number(row.maybe_count ?? 0),
      unavailable_count: Number(row.unavailable_count ?? 0),
    })),
  });
}

async function fredagsfettAvailabilityUpsert(request: Request, env: Env): Promise<Response> {
  const session = await requireFredagsfettUser(request, env);
  await fredagsfettEnsureAvailabilityTimeColumns(env);
  let body: { date?: string; status?: string; note?: string | null; start_time?: string | null; end_time?: string | null; time_note?: string | null };
  try { body = await request.json(); }
  catch { return json({ error: 'Ogiltig JSON.' }, 400); }

  const date = normalizeFredagsfettDate(body.date);
  if (!date) return json({ error: 'Ogiltigt datum.' }, 400);
  const status = normalizeFredagsfettAvailabilityStatus(body.status);
  if (!status) return json({ error: 'Välj Tillgänglig, Kanske eller Inte tillgänglig.' }, 400);
  const note = normalizeFredagsfettShortText(body.note, 240);
  const startTime = normalizeFredagsfettTime(body.start_time);
  const endTime = normalizeFredagsfettTime(body.end_time);
  const timeNote = normalizeFredagsfettTimeNote(body.time_note);

  // When both time keys are missing from the body (tap-cycle path), do not clobber
  // any existing time window. For AVAILABLE we substitute the weekday default;
  // for MAYBE/UNAVAILABLE we preserve whatever was previously stored.
  let appliedStart = startTime;
  let appliedEnd = endTime;
  let appliedTimeNote = timeNote;
  const timeKeysAbsent = !('start_time' in body) && !('end_time' in body);
  if (timeKeysAbsent) {
    if (status === 'AVAILABLE') {
      const def = fredagsfettWeekdayDefaultTimes(date);
      appliedStart = def.start_time;
      appliedEnd = def.end_time;
    } else {
      const existing = await env.DB.prepare(
        `SELECT start_time, end_time, time_note FROM ff_availability WHERE user_id = ? AND date = ?`
      ).bind(session.user.id, date).first<{ start_time: string | null; end_time: string | null; time_note: string | null }>();
      if (existing) {
        appliedStart = existing.start_time;
        appliedEnd = existing.end_time;
        if (!('time_note' in body)) appliedTimeNote = existing.time_note;
      }
    }
  }

  // time_note only makes sense if there is at least a start time.
  if (appliedTimeNote && !appliedStart) {
    return json({ error: 'Ange en starttid för tidskommentaren.' }, 400);
  }
  if (appliedStart && appliedEnd && appliedStart >= appliedEnd) {
    return json({ error: 'Sluttiden måste vara efter starttiden.' }, 400);
  }

  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO ff_availability (id, user_id, date, status, note, start_time, end_time, time_note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
     ON CONFLICT(user_id, date) DO UPDATE SET
       status = excluded.status,
       note = excluded.note,
       start_time = excluded.start_time,
       end_time = excluded.end_time,
       time_note = excluded.time_note,
       updated_at = datetime('now')`
  ).bind(id, session.user.id, date, status, note, appliedStart, appliedEnd, appliedTimeNote).run();

  const timeSummary = appliedStart && appliedEnd ? ` ${appliedStart}-${appliedEnd}` : (appliedStart ? ` ${appliedStart}` : '');
  await fredagsfettLog(env, 'fredagsfett', session.user.id, 'availability', 'availability', date, `${session.user.name} markerade ${fredagsfettAvailabilityLabel(status).toLowerCase()} ${date}${timeSummary}.`);
  return json({ success: true });
}

async function fredagsfettAvailabilityDelete(request: Request, env: Env): Promise<Response> {
  const session = await requireFredagsfettUser(request, env);
  await fredagsfettEnsureAvailabilityTimeColumns(env);
  const date = normalizeFredagsfettDate(new URL(request.url).searchParams.get('date'));
  if (!date) return json({ error: 'Ogiltigt datum.' }, 400);
  await env.DB.prepare(`DELETE FROM ff_availability WHERE user_id = ? AND date = ?`).bind(session.user.id, date).run();
  return json({ success: true });
}

async function fredagsfettEventsList(request: Request, env: Env): Promise<Response> {
  await requireFredagsfettUser(request, env);
  const groupId = 'fredagsfett';
  const url = new URL(request.url);
  // Workers run in UTC by default, so this matches the YYYY-MM-DD strings stored in D1.
  const today = new Date();
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth();
  const firstOfMonth = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  const lastOfMonth = new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
  const from = normalizeFredagsfettDate(url.searchParams.get('from')) ?? firstOfMonth;
  const to = normalizeFredagsfettDate(url.searchParams.get('to')) ?? lastOfMonth;

  const events = await env.DB.prepare(
    `SELECT e.id, e.date, e.status, e.host_user_id, e.title, e.location,
            e.start_time, e.end_time, e.notes, e.spotify_url, e.created_by_user_id,
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
    notes: string | null; spotify_url: string | null;
    created_by_user_id: string | null;
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
  return json({ events: items, from, to });
}

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
    spotify_url?: string | null;
  };
  try { body = await request.json(); }
  catch { return json({ error: 'Ogiltig JSON.' }, 400); }

  const date = normalizeFredagsfettDate(body.date);
  if (!date) return json({ error: 'Ogiltigt datum.' }, 400);

  const hostUserId = body.host_user_id ? normalizeFredagsfettId(body.host_user_id) : null;
  if (body.host_user_id && !hostUserId) return json({ error: 'Ogiltig värd.' }, 400);
  if (hostUserId) {
    const exists = await env.DB.prepare(`SELECT 1 FROM ff_users WHERE id = ? AND deleted_at IS NULL`).bind(hostUserId).first();
    if (!exists) return json({ error: 'Värden finns inte.' }, 400);
  }

  const title = normalizeFredagsfettShortText(body.title, 80);
  const location = normalizeFredagsfettShortText(body.location, 200);
  const startTime = normalizeFredagsfettTime(body.start_time);
  const endTime = normalizeFredagsfettTime(body.end_time);
  const notes = normalizeFredagsfettShortText(body.notes, 1000);
  const spotifyUrl = normalizeFredagsfettSpotifyUrl(body.spotify_url);
  if (body.spotify_url && spotifyUrl === undefined) return json({ error: 'Ogiltig Spotify-länk.' }, 400);
  if (startTime && endTime && startTime >= endTime) {
    return json({ error: 'Sluttiden måste vara efter starttiden.' }, 400);
  }

  const groupId = 'fredagsfett';

  // Reuse the existing row's id if this is a revive; otherwise mint a new id.
  // SQLite's ON CONFLICT DO UPDATE keeps the original PK, so we must look it up
  // rather than trusting the id we'd otherwise bind.
  const existing = await env.DB.prepare(
    `SELECT id FROM ff_events WHERE group_id = ? AND date = ?`
  ).bind(groupId, date).first<{ id: string }>();
  const id = existing?.id ?? `ev-${crypto.randomUUID()}`;

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO ff_events (id, group_id, date, status, host_user_id, title, location, start_time, end_time, notes, spotify_url, created_by_user_id, created_at, updated_at)
       VALUES (?, ?, ?, 'LOCKED', ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
       ON CONFLICT(group_id, date) DO UPDATE SET
         status = 'LOCKED',
         host_user_id = excluded.host_user_id,
         title = excluded.title,
         location = excluded.location,
         start_time = excluded.start_time,
         end_time = excluded.end_time,
         notes = excluded.notes,
         spotify_url = excluded.spotify_url,
         cancelled_at = NULL,
         updated_at = datetime('now')`
    ).bind(id, groupId, date, hostUserId, title, location, startTime, endTime, notes, spotifyUrl ?? null, session.user.id),
    fredagsfettLogStatement(env, groupId, session.user.id, 'event_locked', 'event', id, `${session.user.name} låste in ${date}.`),
  ]);
  return json({ success: true, event_id: id });
}

function normalizeFredagsfettSpotifyUrl(value: unknown): string | null | undefined {
  // Returns: null = explicit clear, string = valid URL, undefined = invalid input.
  if (value === null || value === '' || value === undefined) return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^https?:\/\/(open\.spotify\.com|spotify\.link)\//i.test(trimmed)) return undefined;
  return trimmed.slice(0, 500);
}

async function fredagsfettEventsUpdate(request: Request, env: Env, eventId: string): Promise<Response> {
  const session = await requireFredagsfettAdminUser(request, env);
  const event = await env.DB.prepare(
    `SELECT group_id, date, start_time, end_time FROM ff_events WHERE id = ?`
  ).bind(eventId).first<{ group_id: string; date: string; start_time: string | null; end_time: string | null }>();
  if (!event) return json({ error: 'Eventet finns inte.' }, 404);

  let body: Record<string, unknown>;
  try { body = await request.json(); }
  catch { return json({ error: 'Ogiltig JSON.' }, 400); }

  const ALLOWED = new Set(['title', 'host_user_id', 'location', 'start_time', 'end_time', 'notes', 'status', 'spotify_url']);
  const unknown = Object.keys(body).filter(k => !ALLOWED.has(k));
  if (unknown.length) return json({ error: 'unknown_field', fields: unknown }, 400);

  const updates: string[] = [];
  const bindings: unknown[] = [];
  if ('title' in body)        { updates.push('title = ?');        bindings.push(normalizeFredagsfettShortText(body.title as string, 80)); }
  if ('host_user_id' in body) {
    let hostId: string | null = null;
    if (body.host_user_id != null && body.host_user_id !== '') {
      hostId = normalizeFredagsfettId(body.host_user_id as string);
      if (!hostId) return json({ error: 'Ogiltig värd.' }, 400);
      const exists = await env.DB.prepare(
        `SELECT 1 FROM ff_users WHERE id = ? AND deleted_at IS NULL`
      ).bind(hostId).first();
      if (!exists) return json({ error: 'Värden finns inte.' }, 400);
    }
    updates.push('host_user_id = ?');
    bindings.push(hostId);
  }
  if ('location' in body)     { updates.push('location = ?');     bindings.push(normalizeFredagsfettShortText(body.location as string, 200)); }
  if ('start_time' in body)   { updates.push('start_time = ?');   bindings.push(normalizeFredagsfettTime(body.start_time as string)); }
  if ('end_time' in body)     { updates.push('end_time = ?');     bindings.push(normalizeFredagsfettTime(body.end_time as string)); }
  if ('notes' in body)        { updates.push('notes = ?');        bindings.push(normalizeFredagsfettShortText(body.notes as string, 1000)); }
  if ('spotify_url' in body) {
    const sv = normalizeFredagsfettSpotifyUrl(body.spotify_url);
    if (sv === undefined) return json({ error: 'Ogiltig Spotify-länk.' }, 400);
    updates.push('spotify_url = ?');
    bindings.push(sv);
  }
  if ('status' in body) {
    const s = String(body.status).toUpperCase();
    if (s !== 'LOCKED' && s !== 'CANCELLED') return json({ error: 'Ogiltig status.' }, 400);
    updates.push('status = ?'); bindings.push(s);
    if (s === 'CANCELLED') updates.push("cancelled_at = datetime('now')");
    else updates.push('cancelled_at = NULL');
  }
  // Compute the effective post-update time pair: a field present in the body wins,
  // otherwise we keep the row's current value. This catches both "PATCH only start_time"
  // and "PATCH only end_time" cases that the per-field validation alone would miss.
  const effectiveStart = 'start_time' in body ? normalizeFredagsfettTime(body.start_time as string) : event.start_time;
  const effectiveEnd   = 'end_time'   in body ? normalizeFredagsfettTime(body.end_time   as string) : event.end_time;
  if (effectiveStart && effectiveEnd && effectiveStart >= effectiveEnd) {
    return json({ error: 'Sluttiden måste vara efter starttiden.' }, 400);
  }
  if (!updates.length) return json({ error: 'Inget att uppdatera.' }, 400);
  updates.push("updated_at = datetime('now')");
  bindings.push(eventId);

  await env.DB.batch([
    env.DB.prepare(`UPDATE ff_events SET ${updates.join(', ')} WHERE id = ?`).bind(...bindings),
    fredagsfettLogStatement(env, event.group_id, session.user.id, 'event_updated', 'event', eventId, `${session.user.name} uppdaterade ${event.date}.`),
  ]);
  return json({ success: true });
}

async function fredagsfettEventsCancel(request: Request, env: Env, eventId: string): Promise<Response> {
  const session = await requireFredagsfettAdminUser(request, env);
  const event = await env.DB.prepare(`SELECT group_id, date FROM ff_events WHERE id = ? AND status = 'LOCKED'`).bind(eventId).first<{ group_id: string; date: string }>();
  if (!event) return json({ error: 'Eventet finns inte eller är redan avbrutet.' }, 404);
  await env.DB.batch([
    env.DB.prepare(`UPDATE ff_events SET status = 'CANCELLED', cancelled_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).bind(eventId),
    fredagsfettLogStatement(env, event.group_id, session.user.id, 'event_cancelled', 'event', eventId, `${session.user.name} avbröt ${event.date}.`),
  ]);
  return json({ success: true });
}

async function fredagsfettEventCommentsList(request: Request, env: Env, eventId: string): Promise<Response> {
  await requireFredagsfettUser(request, env);
  const event = await env.DB.prepare(`SELECT id FROM ff_events WHERE id = ?`).bind(eventId).first();
  if (!event) return json({ error: 'Eventet finns inte.' }, 404);
  const rows = await env.DB.prepare(
    `SELECT c.id, c.user_id, u.name AS user_name, c.body, c.created_at
       FROM ff_event_comments c
       JOIN ff_users u ON u.id = c.user_id
      WHERE c.event_id = ? AND c.deleted_at IS NULL
      ORDER BY c.created_at ASC`
  ).bind(eventId).all<{ id: string; user_id: string; user_name: string; body: string; created_at: string }>();
  return json({ comments: rows.results ?? [] });
}

// B4 — iCal feed per user. The signed token is the auth (calendar clients
// don't send cookies). Token shape: <userId>.<hmac>. Stable per (userId, secret).
async function fredagsfettIcalSign(userId: string, secret: string): Promise<string> {
  const data = new TextEncoder().encode(`ical:${userId}`);
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, data);
  let bin = '';
  for (const b of new Uint8Array(sig)) bin += String.fromCharCode(b);
  const b64 = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  return `${userId}.${b64}`;
}

async function fredagsfettIcalVerify(token: string, secret: string): Promise<string | null> {
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return null;
  const userId = token.slice(0, dot);
  const expected = await fredagsfettIcalSign(userId, secret);
  if (!constantTimeStringEqual(token, expected)) return null;
  return userId;
}

async function fredagsfettIcalUrl(request: Request, env: Env): Promise<Response> {
  const session = await requireFredagsfettUser(request, env);
  const token = await fredagsfettIcalSign(session.user.id, session.cfg.sessionSecret);
  const origin = new URL(request.url).origin;
  return json({ url: `${origin}/api/fredagsfett/ical/${token}` });
}

async function fredagsfettIcalFeed(request: Request, env: Env, token: string): Promise<Response> {
  const cfg = fredagsfettConfig(env);
  if (!cfg.ok) return cfg.response;
  const userId = await fredagsfettIcalVerify(token, cfg.value.sessionSecret);
  if (!userId) return new Response('Invalid token', { status: 401 });
  const user = await env.DB.prepare(
    `SELECT id, name FROM ff_users WHERE id = ? AND deleted_at IS NULL`
  ).bind(userId).first<{ id: string; name: string }>();
  if (!user) return new Response('User not found', { status: 404 });

  const events = await env.DB.prepare(
    `SELECT e.id, e.date, e.title, e.location, e.start_time, e.end_time, e.notes,
            host.name AS host_name
       FROM ff_events e
       LEFT JOIN ff_users host ON host.id = e.host_user_id
      WHERE e.group_id = 'fredagsfett' AND e.status = 'LOCKED'
      ORDER BY e.date ASC`
  ).all<{
    id: string; date: string; title: string | null; location: string | null;
    start_time: string | null; end_time: string | null; notes: string | null; host_name: string | null;
  }>();

  const lines: string[] = [];
  lines.push('BEGIN:VCALENDAR');
  lines.push('VERSION:2.0');
  lines.push('PRODID:-//sp1e.se//Fredagsfett//SV');
  lines.push('CALSCALE:GREGORIAN');
  lines.push('METHOD:PUBLISH');
  lines.push('X-WR-CALNAME:Fredagsfett');
  lines.push('X-WR-TIMEZONE:Europe/Stockholm');
  for (const e of events.results ?? []) {
    const dateNoSep = e.date.replace(/-/g, '');
    const hasTimes = !!e.start_time;
    const startStr = hasTimes
      ? `${dateNoSep}T${e.start_time!.replace(':', '')}00`
      : dateNoSep;
    let endStr: string;
    if (hasTimes && e.end_time) {
      endStr = `${dateNoSep}T${e.end_time.replace(':', '')}00`;
    } else if (hasTimes) {
      // Start-only: default a 4-hour event for calendar clients that require DTEND.
      const [h, m] = e.start_time!.split(':').map(Number);
      const endH = String((h + 4) % 24).padStart(2, '0');
      const endM = String(m).padStart(2, '0');
      endStr = `${dateNoSep}T${endH}${endM}00`;
    } else {
      // All-day: DTEND is exclusive next day.
      const next = new Date(e.date + 'T00:00:00Z');
      next.setUTCDate(next.getUTCDate() + 1);
      endStr = next.toISOString().slice(0, 10).replace(/-/g, '');
    }
    const summary = e.title ? e.title : 'Fredagsfett';
    const descParts: string[] = [];
    if (e.host_name) descParts.push(`Värd: ${e.host_name}`);
    if (e.notes) descParts.push(e.notes);
    const description = descParts.join('\\n');
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${e.id}@sp1e.se`);
    lines.push(`DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')}`);
    if (hasTimes) {
      lines.push(`DTSTART;TZID=Europe/Stockholm:${startStr}`);
      lines.push(`DTEND;TZID=Europe/Stockholm:${endStr}`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${startStr}`);
      lines.push(`DTEND;VALUE=DATE:${endStr}`);
    }
    lines.push(`SUMMARY:${fredagsfettIcalEscape(summary)}`);
    if (description) lines.push(`DESCRIPTION:${fredagsfettIcalEscape(description)}`);
    if (e.location) lines.push(`LOCATION:${fredagsfettIcalEscape(e.location)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');

  return new Response(lines.join('\r\n'), {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  });
}

function fredagsfettIcalEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

// B2 — Who-brings-what checklist per event ───────────────────────────────────

async function fredagsfettEventItemsList(request: Request, env: Env, eventId: string): Promise<Response> {
  await requireFredagsfettUser(request, env);
  const event = await env.DB.prepare(`SELECT id FROM ff_events WHERE id = ?`).bind(eventId).first();
  if (!event) return json({ error: 'Eventet finns inte.' }, 404);
  const rows = await env.DB.prepare(
    `SELECT i.id, i.label, i.claimed_by, u.name AS claimed_by_name, i.created_at, i.updated_at
       FROM ff_event_items i
       LEFT JOIN ff_users u ON u.id = i.claimed_by
      WHERE i.event_id = ?
      ORDER BY i.created_at ASC`
  ).bind(eventId).all<{ id: string; label: string; claimed_by: string | null; claimed_by_name: string | null; created_at: string; updated_at: string }>();
  return json({ items: rows.results ?? [] });
}

async function fredagsfettEventItemsCreate(request: Request, env: Env, eventId: string): Promise<Response> {
  const session = await requireFredagsfettUser(request, env);
  const event = await env.DB.prepare(`SELECT id, group_id, date FROM ff_events WHERE id = ?`).bind(eventId).first<{ id: string; group_id: string; date: string }>();
  if (!event) return json({ error: 'Eventet finns inte.' }, 404);
  let body: { label?: string };
  try { body = await request.json(); }
  catch { return json({ error: 'Ogiltig JSON.' }, 400); }
  const label = normalizeFredagsfettShortText(body.label, 80);
  if (!label) return json({ error: 'Ange något att ta med.' }, 400);
  const id = `evi-${crypto.randomUUID()}`;
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO ff_event_items (id, event_id, label, created_at, updated_at) VALUES (?, ?, ?, datetime('now'), datetime('now'))`
    ).bind(id, eventId, label),
    fredagsfettLogStatement(env, event.group_id, session.user.id, 'event_item_add', 'event', eventId, `${session.user.name} lade till "${label}" på ${event.date}.`),
  ]);
  return json({ success: true, item_id: id });
}

async function fredagsfettEventItemsUpdate(request: Request, env: Env, itemId: string): Promise<Response> {
  const session = await requireFredagsfettUser(request, env);
  const item = await env.DB.prepare(
    `SELECT i.id, i.event_id, i.label, i.claimed_by, e.group_id, e.date
       FROM ff_event_items i JOIN ff_events e ON e.id = i.event_id
      WHERE i.id = ?`
  ).bind(itemId).first<{ id: string; event_id: string; label: string; claimed_by: string | null; group_id: string; date: string }>();
  if (!item) return json({ error: 'Item finns inte.' }, 404);
  let body: { label?: string; claimed_by?: string | null };
  try { body = await request.json(); }
  catch { return json({ error: 'Ogiltig JSON.' }, 400); }

  const updates: string[] = [];
  const bindings: unknown[] = [];
  if ('label' in body) {
    const label = normalizeFredagsfettShortText(body.label, 80);
    if (!label) return json({ error: 'Ange något att ta med.' }, 400);
    updates.push('label = ?'); bindings.push(label);
  }
  let logType = 'event_item_update';
  if ('claimed_by' in body) {
    let claimer: string | null = null;
    if (body.claimed_by != null && body.claimed_by !== '') {
      claimer = normalizeFredagsfettId(body.claimed_by);
      if (!claimer) return json({ error: 'Ogiltig användare.' }, 400);
      const exists = await env.DB.prepare(`SELECT 1 FROM ff_users WHERE id = ? AND deleted_at IS NULL`).bind(claimer).first();
      if (!exists) return json({ error: 'Användaren finns inte.' }, 400);
    }
    updates.push('claimed_by = ?'); bindings.push(claimer);
    logType = claimer ? 'event_item_claim' : 'event_item_unclaim';
  }
  if (!updates.length) return json({ error: 'Inget att uppdatera.' }, 400);
  updates.push("updated_at = datetime('now')");
  bindings.push(itemId);

  await env.DB.batch([
    env.DB.prepare(`UPDATE ff_event_items SET ${updates.join(', ')} WHERE id = ?`).bind(...bindings),
    fredagsfettLogStatement(env, item.group_id, session.user.id, logType, 'event', item.event_id, `${session.user.name} uppdaterade "${item.label}" (${item.date}).`),
  ]);
  return json({ success: true });
}

async function fredagsfettEventItemsDelete(request: Request, env: Env, itemId: string): Promise<Response> {
  const session = await requireFredagsfettUser(request, env);
  const item = await env.DB.prepare(
    `SELECT i.id, i.label, e.group_id, e.id AS event_id, e.date
       FROM ff_event_items i JOIN ff_events e ON e.id = i.event_id
      WHERE i.id = ?`
  ).bind(itemId).first<{ id: string; label: string; group_id: string; event_id: string; date: string }>();
  if (!item) return json({ error: 'Item finns inte.' }, 404);
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM ff_event_items WHERE id = ?`).bind(itemId),
    fredagsfettLogStatement(env, item.group_id, session.user.id, 'event_item_delete', 'event', item.event_id, `${session.user.name} tog bort "${item.label}" (${item.date}).`),
  ]);
  return json({ success: true });
}

// B5 — Per-event photo gallery (R2 with D1 base64 fallback) ─────────────────

const FREDAGSFETT_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const FREDAGSFETT_PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

async function fredagsfettEventPhotosList(request: Request, env: Env, eventId: string): Promise<Response> {
  await requireFredagsfettUser(request, env);
  const event = await env.DB.prepare(`SELECT id FROM ff_events WHERE id = ?`).bind(eventId).first();
  if (!event) return json({ error: 'Eventet finns inte.' }, 404);
  const rows = await env.DB.prepare(
    `SELECT p.id, p.content_type, p.size_bytes, p.uploader_id, u.name AS uploader_name, p.created_at
       FROM ff_event_photos p
       LEFT JOIN ff_users u ON u.id = p.uploader_id
      WHERE p.event_id = ?
      ORDER BY p.created_at DESC`
  ).bind(eventId).all<{ id: string; content_type: string; size_bytes: number; uploader_id: string | null; uploader_name: string | null; created_at: string }>();
  return json({ photos: rows.results ?? [] });
}

async function fredagsfettEventPhotosCreate(request: Request, env: Env, eventId: string): Promise<Response> {
  const session = await requireFredagsfettUser(request, env);
  const event = await env.DB.prepare(`SELECT id, group_id, date FROM ff_events WHERE id = ?`).bind(eventId).first<{ id: string; group_id: string; date: string }>();
  if (!event) return json({ error: 'Eventet finns inte.' }, 404);
  let body: { content_type?: string; data?: string };
  try { body = await request.json(); }
  catch { return json({ error: 'Ogiltig JSON.' }, 400); }
  const contentType = (body.content_type || '').toLowerCase().trim();
  if (!FREDAGSFETT_PHOTO_TYPES.has(contentType)) return json({ error: 'Endast JPEG / PNG / WebP / GIF tillåts.' }, 400);
  if (!body.data || typeof body.data !== 'string') return json({ error: 'Ingen bilddata.' }, 400);
  // Strip a data: prefix if present
  const b64 = body.data.replace(/^data:[^;]+;base64,/, '');
  let bytes: Uint8Array;
  try {
    const bin = atob(b64);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } catch { return json({ error: 'Ogiltig base64-data.' }, 400); }
  if (bytes.byteLength > FREDAGSFETT_PHOTO_MAX_BYTES) return json({ error: 'Max 5 MB per bild.' }, 400);

  const id = `evp-${crypto.randomUUID()}`;
  let r2Key: string | null = null;
  let dataFallback: string | null = null;
  // Prefer R2 if the binding is present; fall back to D1 base64 otherwise.
  const filesBucket = (env as unknown as { FILES?: R2Bucket }).FILES;
  if (filesBucket) {
    try {
      r2Key = `ff/event-photos/${id}`;
      await filesBucket.put(r2Key, bytes, { httpMetadata: { contentType } });
    } catch (err) {
      console.error('R2 put failed, falling back to D1:', err);
      r2Key = null;
      dataFallback = b64;
    }
  } else {
    dataFallback = b64;
  }

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO ff_event_photos (id, event_id, uploader_id, r2_key, data, content_type, size_bytes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    ).bind(id, eventId, session.user.id, r2Key, dataFallback, contentType, bytes.byteLength),
    fredagsfettLogStatement(env, event.group_id, session.user.id, 'event_photo_add', 'event', eventId, `${session.user.name} laddade upp en bild för ${event.date}.`),
  ]);
  return json({ success: true, photo_id: id });
}

async function fredagsfettEventPhotoDownload(request: Request, env: Env, photoId: string): Promise<Response> {
  await requireFredagsfettUser(request, env);
  const row = await env.DB.prepare(
    `SELECT id, r2_key, data, content_type FROM ff_event_photos WHERE id = ?`
  ).bind(photoId).first<{ id: string; r2_key: string | null; data: string | null; content_type: string }>();
  if (!row) return new Response('Photo not found', { status: 404 });
  if (row.r2_key) {
    const filesBucket = (env as unknown as { FILES?: R2Bucket }).FILES;
    if (filesBucket) {
      const obj = await filesBucket.get(row.r2_key);
      if (obj) {
        return new Response(obj.body, {
          status: 200,
          headers: {
            'Content-Type': row.content_type,
            'Cache-Control': 'private, max-age=31536000, immutable',
          },
        });
      }
    }
  }
  if (row.data) {
    const bin = atob(row.data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Response(bytes, {
      status: 200,
      headers: {
        'Content-Type': row.content_type,
        'Cache-Control': 'private, max-age=31536000, immutable',
      },
    });
  }
  return new Response('Photo storage unavailable', { status: 500 });
}

async function fredagsfettEventPhotoDelete(request: Request, env: Env, photoId: string): Promise<Response> {
  const session = await requireFredagsfettUser(request, env);
  const row = await env.DB.prepare(
    `SELECT p.id, p.r2_key, p.uploader_id, e.group_id, e.id AS event_id, e.date
       FROM ff_event_photos p JOIN ff_events e ON e.id = p.event_id
      WHERE p.id = ?`
  ).bind(photoId).first<{ id: string; r2_key: string | null; uploader_id: string | null; group_id: string; event_id: string; date: string }>();
  if (!row) return json({ error: 'Bilden finns inte.' }, 404);
  // Uploader or admin can delete.
  if (row.uploader_id !== session.user.id && !session.user.is_admin) {
    return json({ error: 'Bara uppladdaren eller en admin kan ta bort.' }, 403);
  }
  if (row.r2_key) {
    const filesBucket = (env as unknown as { FILES?: R2Bucket }).FILES;
    if (filesBucket) {
      try { await filesBucket.delete(row.r2_key); } catch (err) { console.error('R2 delete failed:', err); }
    }
  }
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM ff_event_photos WHERE id = ?`).bind(photoId),
    fredagsfettLogStatement(env, row.group_id, session.user.id, 'event_photo_delete', 'event', row.event_id, `${session.user.name} tog bort en bild för ${row.date}.`),
  ]);
  return json({ success: true });
}

// E3 — Activity-log viewer ──────────────────────────────────────────────────

async function fredagsfettActivityList(request: Request, env: Env): Promise<Response> {
  await requireFredagsfettUser(request, env);
  const limit = Math.min(100, Math.max(1, Number(new URL(request.url).searchParams.get('limit')) || 30));
  const rows = await env.DB.prepare(
    `SELECT id, group_id, user_id AS actor_id, type, entity_type, entity_id, body AS message, created_at
       FROM ff_activity_log
      WHERE group_id = 'fredagsfett'
      ORDER BY created_at DESC
      LIMIT ?`
  ).bind(limit).all<{ id: string; group_id: string; actor_id: string | null; type: string; entity_type: string | null; entity_id: string | null; message: string; created_at: string }>();
  return json({ activity: rows.results ?? [] });
}

async function fredagsfettEventCommentsCreate(request: Request, env: Env, eventId: string): Promise<Response> {
  const session = await requireFredagsfettUser(request, env);
  const event = await env.DB.prepare(`SELECT id, group_id, date FROM ff_events WHERE id = ?`).bind(eventId).first<{ id: string; group_id: string; date: string }>();
  if (!event) return json({ error: 'Eventet finns inte.' }, 404);
  let body: { body?: string };
  try { body = await request.json(); }
  catch { return json({ error: 'Ogiltig JSON.' }, 400); }
  const text = normalizeFredagsfettShortText(body.body, 1000);
  if (!text) return json({ error: 'Skriv en kommentar.' }, 400);
  const id = `evc-${crypto.randomUUID()}`;
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO ff_event_comments (id, event_id, user_id, body, created_at) VALUES (?, ?, ?, ?, datetime('now'))`
    ).bind(id, eventId, session.user.id, text),
    fredagsfettLogStatement(env, event.group_id, session.user.id, 'event_comment', 'event', eventId, `${session.user.name} kommenterade ${event.date}.`),
  ]);
  return json({ success: true, comment_id: id });
}

async function fredagsfettSp1wise(request: Request, env: Env): Promise<Response> {
  const session = await requireFredagsfettUser(request, env);
  await fredagsfettEnsureDefaultMembership(env, session.user.id, !!session.user.is_admin);
  const url = new URL(request.url);
  const groupId = normalizeFredagsfettId(url.searchParams.get('group_id')) ?? 'fredagsfett';
  return json(await fredagsfettBuildSp1wiseState(env, session.user, groupId));
}

async function fredagsfettSp1wiseGroups(request: Request, env: Env): Promise<Response> {
  const session = await requireFredagsfettUser(request, env);
  await fredagsfettEnsureDefaultMembership(env, session.user.id, !!session.user.is_admin);
  const groups = await env.DB.prepare(
    `SELECT g.id, g.name, g.created_at
       FROM ff_groups g
       JOIN ff_group_members gm ON gm.group_id = g.id
      WHERE gm.user_id = ?
      ORDER BY g.created_at ASC`
  ).bind(session.user.id).all<FredagsfettGroupRow>();
  return json({ groups: groups.results ?? [] });
}

async function fredagsfettSp1wiseCreateGroup(request: Request, env: Env): Promise<Response> {
  const session = await requireFredagsfettUser(request, env);
  let body: { name?: string };
  try { body = await request.json(); }
  catch { return json({ error: 'Ogiltig JSON.' }, 400); }
  const name = normalizeFredagsfettShortText(body.name, 80);
  if (!name) return json({ error: 'Ange ett gruppnamn.' }, 400);
  const id = `ff-${crypto.randomUUID()}`;
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO ff_groups (id, name, created_at) VALUES (?, ?, datetime('now'))`).bind(id, name),
    env.DB.prepare(`INSERT INTO ff_group_members (group_id, user_id, role, created_at) VALUES (?, ?, 'admin', datetime('now'))`).bind(id, session.user.id),
  ]);
  return json({ success: true, group: { id, name } });
}

async function fredagsfettSp1wiseCreateExpense(request: Request, env: Env): Promise<Response> {
  const session = await requireFredagsfettUser(request, env);
  let body: {
    group_id?: string;
    paid_by_id?: string;
    amount?: number | string;
    currency?: string;
    description?: string;
    date?: string;
    split_method?: string;
    participants?: string[];
    shares?: Array<{ user_id?: string; amount?: number | string; percent?: number | string; shares?: number | string }>;
    event_id?: string | null;
  };
  try { body = await request.json(); }
  catch { return json({ error: 'Ogiltig JSON.' }, 400); }

  const groupId = normalizeFredagsfettId(body.group_id) ?? 'fredagsfett';
  const members = await fredagsfettLoadGroupMembers(env, groupId);
  if (!members.some(member => member.id === session.user.id)) return json({ error: 'Du är inte medlem i gruppen.' }, 403);
  const paidById = normalizeFredagsfettId(body.paid_by_id) ?? session.user.id;
  if (!members.some(member => member.id === paidById)) return json({ error: 'Betalaren finns inte i gruppen.' }, 400);
  const amountCents = parseFredagsfettMoney(body.amount);
  if (!amountCents || amountCents > 10_000_000_00) return json({ error: 'Ange ett rimligt belopp.' }, 400);
  const description = normalizeFredagsfettShortText(body.description, 140);
  if (!description) return json({ error: 'Ange en beskrivning.' }, 400);
  const date = normalizeFredagsfettDate(body.date) ?? currentFredagsfettDate();
  const currency = normalizeFredagsfettCurrency(body.currency);
  const splitMethod = normalizeFredagsfettSplitMethod(body.split_method);
  const shares = buildFredagsfettExpenseShares(amountCents, splitMethod, body, members);
  if (!shares.length) return json({ error: 'Kunde inte räkna ut delningen.' }, 400);

  let eventId: string | null = null;
  if (body.event_id) {
    eventId = normalizeFredagsfettId(body.event_id);
    if (!eventId) return json({ error: 'Ogiltigt event-id.' }, 400);
    const eventExists = await env.DB.prepare(
      `SELECT 1 FROM ff_events WHERE id = ? AND group_id = ?`
    ).bind(eventId, groupId).first();
    if (!eventExists) return json({ error: 'Eventet finns inte.' }, 400);
  }

  const expenseId = crypto.randomUUID();
  const statements = [
    env.DB.prepare(
      `INSERT INTO ff_expenses (id, group_id, paid_by_id, amount_cents, currency, description, date, split_method, event_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
    ).bind(expenseId, groupId, paidById, amountCents, currency, description, date, splitMethod, eventId),
    ...shares.map(share => env.DB.prepare(
      `INSERT INTO ff_expense_shares (id, expense_id, user_id, amount_cents) VALUES (?, ?, ?, ?)`
    ).bind(crypto.randomUUID(), expenseId, share.user_id, share.amount_cents)),
    fredagsfettLogStatement(env, groupId, session.user.id, 'expense', 'expense', expenseId, `${session.user.name} lade till ${description} på ${formatFredagsfettKr(amountCents)}.`),
  ];
  await env.DB.batch(statements);
  return json({ success: true, ...(await fredagsfettBuildSp1wiseState(env, session.user, groupId)) });
}

async function fredagsfettSp1wiseUpdateExpense(request: Request, env: Env, expenseId: string): Promise<Response> {
  const session = await requireFredagsfettUser(request, env);
  let body: { amount?: number | string; description?: string; date?: string; event_id?: string | null };
  try { body = await request.json(); }
  catch { return json({ error: 'Ogiltig JSON.' }, 400); }

  const expense = await fredagsfettLoadExpenseForMember(env, expenseId, session.user.id);
  if (!expense) return json({ error: 'Utgiften hittades inte.' }, 404);
  const amountCents = parseFredagsfettMoney(body.amount) ?? Number(expense.amount_cents);
  const description = normalizeFredagsfettShortText(body.description, 140) ?? expense.description;
  const date = normalizeFredagsfettDate(body.date) ?? expense.date;
  let nextEventId: string | null | undefined = undefined;
  if ('event_id' in body) {
    if (body.event_id === null || body.event_id === '') {
      nextEventId = null;
    } else {
      const normalized = normalizeFredagsfettId(body.event_id);
      if (!normalized) return json({ error: 'Ogiltigt event-id.' }, 400);
      const eventExists = await env.DB.prepare(
        `SELECT 1 FROM ff_events WHERE id = ? AND group_id = ?`
      ).bind(normalized, expense.group_id).first();
      if (!eventExists) return json({ error: 'Eventet finns inte.' }, 400);
      nextEventId = normalized;
    }
  }
  const currentShares = await env.DB.prepare(
    `SELECT user_id, amount_cents FROM ff_expense_shares WHERE expense_id = ? ORDER BY user_id ASC`
  ).bind(expenseId).all<{ user_id: string; amount_cents: number }>();
  const shareUsers = (currentShares.results ?? []).map(share => share.user_id);
  const members = await fredagsfettLoadGroupMembers(env, expense.group_id);
  const shares = distributeFredagsfettEqual(amountCents, shareUsers.length ? shareUsers : members.map(member => member.id));

  const updateStmt = nextEventId !== undefined
    ? env.DB.prepare(
        `UPDATE ff_expenses SET amount_cents = ?, description = ?, date = ?, event_id = ?, updated_at = datetime('now') WHERE id = ?`
      ).bind(amountCents, description, date, nextEventId, expenseId)
    : env.DB.prepare(
        `UPDATE ff_expenses SET amount_cents = ?, description = ?, date = ?, updated_at = datetime('now') WHERE id = ?`
      ).bind(amountCents, description, date, expenseId);

  await env.DB.batch([
    updateStmt,
    env.DB.prepare(`DELETE FROM ff_expense_shares WHERE expense_id = ?`).bind(expenseId),
    ...shares.map(share => env.DB.prepare(
      `INSERT INTO ff_expense_shares (id, expense_id, user_id, amount_cents) VALUES (?, ?, ?, ?)`
    ).bind(crypto.randomUUID(), expenseId, share.user_id, share.amount_cents)),
    fredagsfettLogStatement(env, expense.group_id, session.user.id, 'expense_update', 'expense', expenseId, `${session.user.name} ändrade ${description}.`),
  ]);
  return json({ success: true, ...(await fredagsfettBuildSp1wiseState(env, session.user, expense.group_id)) });
}

async function fredagsfettSp1wiseDeleteExpense(request: Request, env: Env, expenseId: string): Promise<Response> {
  const session = await requireFredagsfettUser(request, env);
  const expense = await fredagsfettLoadExpenseForMember(env, expenseId, session.user.id);
  if (!expense) return json({ error: 'Utgiften hittades inte.' }, 404);
  await env.DB.batch([
    env.DB.prepare(`UPDATE ff_expenses SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).bind(expenseId),
    fredagsfettLogStatement(env, expense.group_id, session.user.id, 'expense_delete', 'expense', expenseId, `${session.user.name} tog bort ${expense.description}.`),
  ]);
  return json({ success: true, ...(await fredagsfettBuildSp1wiseState(env, session.user, expense.group_id)) });
}

async function fredagsfettSp1wiseCreateSettlement(request: Request, env: Env): Promise<Response> {
  const session = await requireFredagsfettUser(request, env);
  let body: { group_id?: string; from_user_id?: string; to_user_id?: string; amount?: number | string; currency?: string; date?: string; note?: string };
  try { body = await request.json(); }
  catch { return json({ error: 'Ogiltig JSON.' }, 400); }

  const groupId = normalizeFredagsfettId(body.group_id) ?? 'fredagsfett';
  const members = await fredagsfettLoadGroupMembers(env, groupId);
  if (!members.some(member => member.id === session.user.id)) return json({ error: 'Du är inte medlem i gruppen.' }, 403);
  const fromUserId = normalizeFredagsfettId(body.from_user_id);
  const toUserId = normalizeFredagsfettId(body.to_user_id);
  if (!fromUserId || !toUserId || fromUserId === toUserId) return json({ error: 'Välj två olika personer.' }, 400);
  if (!members.some(member => member.id === fromUserId) || !members.some(member => member.id === toUserId)) return json({ error: 'Personen finns inte i gruppen.' }, 400);
  const amountCents = parseFredagsfettMoney(body.amount);
  if (!amountCents) return json({ error: 'Ange ett belopp.' }, 400);
  const date = normalizeFredagsfettDate(body.date) ?? currentFredagsfettDate();
  const note = normalizeFredagsfettShortText(body.note, 180);
  const id = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO ff_settlements (id, group_id, from_user_id, to_user_id, amount_cents, currency, date, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    ).bind(id, groupId, fromUserId, toUserId, amountCents, normalizeFredagsfettCurrency(body.currency), date, note),
    fredagsfettLogStatement(env, groupId, session.user.id, 'settlement', 'settlement', id, `${session.user.name} registrerade en betalning på ${formatFredagsfettKr(amountCents)}.`),
  ]);
  return json({ success: true, ...(await fredagsfettBuildSp1wiseState(env, session.user, groupId)) });
}

async function fredagsfettSp1wiseCreateComment(request: Request, env: Env): Promise<Response> {
  const session = await requireFredagsfettUser(request, env);
  let body: { expense_id?: string; body?: string };
  try { body = await request.json(); }
  catch { return json({ error: 'Ogiltig JSON.' }, 400); }
  const expenseId = normalizeFredagsfettId(body.expense_id);
  const commentBody = normalizeFredagsfettShortText(body.body, 500);
  if (!expenseId || !commentBody) return json({ error: 'Kommentaren saknar innehåll.' }, 400);
  const expense = await fredagsfettLoadExpenseForMember(env, expenseId, session.user.id);
  if (!expense) return json({ error: 'Utgiften hittades inte.' }, 404);
  const id = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO ff_comments (id, expense_id, user_id, body, created_at) VALUES (?, ?, ?, ?, datetime('now'))`
    ).bind(id, expenseId, session.user.id, commentBody),
    fredagsfettLogStatement(env, expense.group_id, session.user.id, 'comment', 'expense', expenseId, `${session.user.name} kommenterade ${expense.description}.`),
  ]);
  return json({ success: true, ...(await fredagsfettBuildSp1wiseState(env, session.user, expense.group_id)) });
}

async function fredagsfettSp1wiseExport(request: Request, env: Env): Promise<Response> {
  const session = await requireFredagsfettUser(request, env);
  const groupId = normalizeFredagsfettId(new URL(request.url).searchParams.get('group_id')) ?? 'fredagsfett';
  const state = await fredagsfettBuildSp1wiseState(env, session.user, groupId);
  const lines = [
    ['typ', 'datum', 'beskrivning', 'betalare/fran', 'till', 'belopp', 'valuta'].join(','),
    ...state.expenses.map(expense => [
      'expense',
      expense.date,
      csvFredagsfett(expense.description),
      csvFredagsfett(expense.paid_by_name),
      '',
      (expense.amount_cents / 100).toFixed(2),
      expense.currency,
    ].join(',')),
    ...state.settlements.map(settlement => [
      'settlement',
      settlement.date,
      csvFredagsfett(settlement.note || 'Settle up'),
      csvFredagsfett(settlement.from_user_name),
      csvFredagsfett(settlement.to_user_name),
      (settlement.amount_cents / 100).toFixed(2),
      settlement.currency,
    ].join(',')),
  ];
  return new Response(lines.join('\n'), {
    headers: {
      ...cors(),
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="sp1wise-${groupId}.csv"`,
    },
  });
}

async function fredagsfettAdminAuth(request: Request, env: Env): Promise<Response> {
  const session = await requireFredagsfettUser(request, env);
  let body: { password?: string };
  try { body = await request.json(); }
  catch { return json({ error: 'Ogiltig JSON.' }, 400); }

  if (typeof body.password !== 'string' || !body.password) {
    return json({ error: 'Ange adminlösenordet.' }, 400);
  }

  const candidates = fredagsfettAdminPasswordCandidates(env);
  if (!fredagsfettPasswordMatches(body.password, candidates)) {
    return json({ error: 'Fel adminlösenord.' }, 401);
  }

  const token = await signFredagsfettAdminSession({
    v: 1,
    scope: 'fredagsfett-admin',
    exp: fredagsfettAdminSessionExpiry(),
  }, session.cfg.sessionSecret);

  return fredagsfettJson({
    success: true,
    unlocked: true,
    user: fredagsfettUserPayload(session.user),
  }, 200, fredagsfettAdminSessionCookie(token));
}

async function fredagsfettAdminStatus(request: Request, env: Env): Promise<Response> {
  const session = await requireFredagsfettUser(request, env);
  return json({
    unlocked: await fredagsfettHasAdminUnlock(request, session.cfg.sessionSecret),
    user: fredagsfettUserPayload(session.user),
  });
}

async function fredagsfettAdminLogout(request: Request, env: Env): Promise<Response> {
  await requireFredagsfettUser(request, env);
  return fredagsfettJson({ success: true, unlocked: false }, 200, clearFredagsfettAdminSessionCookie());
}

async function fredagsfettAdminUsers(request: Request, env: Env): Promise<Response> {
  const session = await requireFredagsfettAdmin(request, env);
  const users = await env.DB.prepare(
    `SELECT u.id, u.name, u.is_admin, u.created_at, u.updated_at,
            COUNT(d.id) AS device_count,
            SUM(CASE WHEN d.revoked_at IS NULL THEN 1 ELSE 0 END) AS active_device_count
       FROM ff_users u
       LEFT JOIN ff_devices d ON d.user_id = u.id
      WHERE u.deleted_at IS NULL
      GROUP BY u.id
      ORDER BY u.created_at ASC`
  ).all<FredagsfettAdminUserRow>();
  const devices = await env.DB.prepare(
    `SELECT id, user_id, created_at, last_seen_at, revoked_at
       FROM ff_devices
      WHERE user_id IS NOT NULL
      ORDER BY last_seen_at DESC`
  ).all<FredagsfettAdminDeviceRow>();
  const devicesByUser = new Map<string, FredagsfettAdminDeviceRow[]>();
  for (const device of devices.results ?? []) {
    if (!device.user_id) continue;
    const list = devicesByUser.get(device.user_id) ?? [];
    list.push(device);
    devicesByUser.set(device.user_id, list);
  }
  return json({
    user: fredagsfettUserPayload(session.user),
    users: (users.results ?? []).map(user => ({
      id: user.id,
      name: user.name,
      is_admin: !!user.is_admin,
      created_at: user.created_at,
      updated_at: user.updated_at,
      device_count: Number(user.device_count ?? 0),
      active_device_count: Number(user.active_device_count ?? 0),
      devices: (devicesByUser.get(user.id) ?? []).map(device => ({
        id: device.id,
        created_at: device.created_at,
        last_seen_at: device.last_seen_at,
        revoked_at: device.revoked_at,
        is_current: device.id === session.device.id,
      })),
    })),
  });
}

async function fredagsfettAdminUpdateUser(request: Request, env: Env, userId: string): Promise<Response> {
  await requireFredagsfettAdmin(request, env);

  let body: Record<string, unknown>;
  try { body = await request.json(); }
  catch { return json({ error: 'Ogiltig JSON.' }, 400); }

  const ALLOWED_FIELDS = new Set(['name', 'is_admin']);
  const unknown = Object.keys(body).filter(k => !ALLOWED_FIELDS.has(k));
  if (unknown.length) {
    return json({ error: 'unknown_field', fields: unknown }, 400);
  }

  const updates: string[] = [];
  const bindings: unknown[] = [];

  if ('name' in body) {
    const name = normalizeFredagsfettName(body.name as string);
    if (!name) return json({ error: 'Ange ett namn mellan 2 och 80 tecken.' }, 400);
    updates.push('name = ?');
    bindings.push(name);
  }
  if ('is_admin' in body) {
    const truthy = body.is_admin === 1 || body.is_admin === true || body.is_admin === '1';
    const falsy = body.is_admin === 0 || body.is_admin === false || body.is_admin === '0';
    if (!truthy && !falsy) {
      return json({ error: 'is_admin måste vara 0/1 eller true/false.' }, 400);
    }
    updates.push('is_admin = ?');
    bindings.push(truthy ? 1 : 0);
  }
  if (!updates.length) return json({ error: 'Inget att uppdatera.' }, 400);

  updates.push("updated_at = datetime('now')");
  bindings.push(userId);

  try {
    const result = await env.DB.prepare(
      `UPDATE ff_users SET ${updates.join(', ')} WHERE id = ? AND deleted_at IS NULL`
    ).bind(...bindings).run();
    if (!result.meta?.changes) return json({ error: 'Användaren hittades inte.' }, 404);
  } catch (err) {
    const msg = errorMessage(err);
    if (/unique|constraint/i.test(msg)) return json({ error: 'Namnet är upptaget. Välj ett annat namn.' }, 409);
    throw err;
  }

  const user = await fredagsfettLoadUser(env, userId);
  return json({ success: true, user: user ? fredagsfettUserPayload(user) : null });
}

async function fredagsfettAdminDeleteUser(request: Request, env: Env, userId: string): Promise<Response> {
  const session = await requireFredagsfettAdmin(request, env);
  if (userId === session.user.id) return json({ error: 'Du kan inte ta bort din egen admin-användare.' }, 400);

  const result = await env.DB.prepare(
    `UPDATE ff_users
        SET deleted_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ? AND deleted_at IS NULL`
  ).bind(userId).run();
  if (!result.meta?.changes) return json({ error: 'Användaren hittades inte.' }, 404);

  await env.DB.prepare(
    `UPDATE ff_devices SET revoked_at = datetime('now') WHERE user_id = ? AND revoked_at IS NULL`
  ).bind(userId).run();
  return json({ success: true });
}

async function fredagsfettAdminRevokeDevice(request: Request, env: Env, deviceId: string): Promise<Response> {
  const session = await requireFredagsfettAdmin(request, env);
  if (deviceId === session.device.id) return json({ error: 'Du kan inte återkalla enheten du använder just nu.' }, 400);
  const result = await env.DB.prepare(
    `UPDATE ff_devices SET revoked_at = datetime('now') WHERE id = ? AND revoked_at IS NULL`
  ).bind(deviceId).run();
  if (!result.meta?.changes) return json({ error: 'Enheten hittades inte eller är redan återkallad.' }, 404);
  return json({ success: true });
}

// E4 — manually-triggered cleanup of revoked devices older than 90 days.
// Cloudflare Pages Functions don't natively support cron triggers for catch-all
// routes, so this is exposed as an admin-cookie endpoint that the dev console
// (or an external scheduler hitting POST /api/fredagsfett/admin/cleanup) can call.
async function fredagsfettAdminCleanup(request: Request, env: Env): Promise<Response> {
  await requireFredagsfettAdmin(request, env);
  const result = await env.DB.prepare(
    `DELETE FROM ff_devices
      WHERE revoked_at IS NOT NULL
        AND revoked_at < datetime('now', '-90 days')`
  ).run();
  return json({ success: true, deleted_devices: result.meta?.changes ?? 0 });
}

async function fredagsfettBuildSp1wiseState(env: Env, user: FredagsfettUserRow, groupId: string) {
  await fredagsfettEnsureDefaultMembership(env, user.id, !!user.is_admin);
  const membership = await env.DB.prepare(
    `SELECT group_id FROM ff_group_members WHERE group_id = ? AND user_id = ?`
  ).bind(groupId, user.id).first<{ group_id: string }>();
  if (!membership) throw new HttpError(403, 'Du är inte medlem i gruppen.');

  const group = await env.DB.prepare(
    `SELECT id, name, created_at FROM ff_groups WHERE id = ?`
  ).bind(groupId).first<FredagsfettGroupRow>();
  if (!group) throw new HttpError(404, 'Gruppen hittades inte.');

  const groups = await env.DB.prepare(
    `SELECT g.id, g.name, g.created_at
       FROM ff_groups g
       JOIN ff_group_members gm ON gm.group_id = g.id
      WHERE gm.user_id = ?
      ORDER BY g.created_at ASC`
  ).bind(user.id).all<FredagsfettGroupRow>();
  const members = await fredagsfettLoadGroupMembers(env, groupId);
  const expenses = await env.DB.prepare(
    `SELECT e.id, e.group_id, e.paid_by_id, u.name AS paid_by_name, e.amount_cents, e.currency,
            e.description, e.date, e.split_method, e.event_id, ev.date AS event_date, ev.title AS event_title,
            e.created_at, e.updated_at
       FROM ff_expenses e
       JOIN ff_users u ON u.id = e.paid_by_id
       LEFT JOIN ff_events ev ON ev.id = e.event_id
      WHERE e.group_id = ? AND e.deleted_at IS NULL
      ORDER BY e.date DESC, e.created_at DESC`
  ).bind(groupId).all<FredagsfettExpenseRow & { event_id: string | null; event_date: string | null; event_title: string | null }>();
  const expenseIds = (expenses.results ?? []).map(expense => expense.id);

  const shares = expenseIds.length
    ? await env.DB.prepare(
        `SELECT s.id, s.expense_id, s.user_id, u.name AS user_name, s.amount_cents
           FROM ff_expense_shares s
           JOIN ff_users u ON u.id = s.user_id
          WHERE s.expense_id IN (${expenseIds.map(() => '?').join(',')})
          ORDER BY u.name COLLATE NOCASE ASC`
      ).bind(...expenseIds).all<FredagsfettExpenseShareRow>()
    : { results: [] as FredagsfettExpenseShareRow[] };
  const comments = expenseIds.length
    ? await env.DB.prepare(
        `SELECT c.id, c.expense_id, c.user_id, u.name AS user_name, c.body, c.created_at
           FROM ff_comments c
           JOIN ff_users u ON u.id = c.user_id
          WHERE c.expense_id IN (${expenseIds.map(() => '?').join(',')})
          ORDER BY c.created_at ASC`
      ).bind(...expenseIds).all<FredagsfettCommentRow>()
    : { results: [] as FredagsfettCommentRow[] };
  const settlements = await env.DB.prepare(
    `SELECT st.id, st.group_id, st.from_user_id, fu.name AS from_user_name,
            st.to_user_id, tu.name AS to_user_name, st.amount_cents, st.currency,
            st.date, st.note, st.created_at
       FROM ff_settlements st
       JOIN ff_users fu ON fu.id = st.from_user_id
       JOIN ff_users tu ON tu.id = st.to_user_id
      WHERE st.group_id = ?
      ORDER BY st.date DESC, st.created_at DESC`
  ).bind(groupId).all<FredagsfettSettlementRow>();
  const activity = await env.DB.prepare(
    `SELECT id, user_id AS actor_id, type, body AS message, created_at
       FROM ff_activity_log
      WHERE group_id = ?
      ORDER BY created_at DESC
      LIMIT 40`
  ).bind(groupId).all<{ id: string; actor_id: string | null; type: string; message: string; created_at: string }>();

  const sharesByExpense = new Map<string, FredagsfettExpenseShareRow[]>();
  for (const share of shares.results ?? []) {
    const list = sharesByExpense.get(share.expense_id) ?? [];
    list.push(share);
    sharesByExpense.set(share.expense_id, list);
  }
  const commentsByExpense = new Map<string, FredagsfettCommentRow[]>();
  for (const comment of comments.results ?? []) {
    const list = commentsByExpense.get(comment.expense_id) ?? [];
    list.push(comment);
    commentsByExpense.set(comment.expense_id, list);
  }

  const balances = new Map<string, number>();
  for (const member of members) balances.set(member.id, 0);
  for (const expense of expenses.results ?? []) {
    balances.set(expense.paid_by_id, (balances.get(expense.paid_by_id) ?? 0) + Number(expense.amount_cents));
    for (const share of sharesByExpense.get(expense.id) ?? []) {
      balances.set(share.user_id, (balances.get(share.user_id) ?? 0) - Number(share.amount_cents));
    }
  }
  for (const settlement of settlements.results ?? []) {
    balances.set(settlement.from_user_id, (balances.get(settlement.from_user_id) ?? 0) + Number(settlement.amount_cents));
    balances.set(settlement.to_user_id, (balances.get(settlement.to_user_id) ?? 0) - Number(settlement.amount_cents));
  }

  const balanceRows = members.map(member => ({
    user_id: member.id,
    name: member.name,
    amount_cents: balances.get(member.id) ?? 0,
  }));

  return {
    user: fredagsfettUserPayload(user),
    group,
    groups: groups.results ?? [],
    members: members.map(member => ({ id: member.id, name: member.name, is_admin: !!member.is_admin })),
    expenses: (expenses.results ?? []).map(expense => ({
      ...expense,
      amount_cents: Number(expense.amount_cents),
      shares: (sharesByExpense.get(expense.id) ?? []).map(share => ({ ...share, amount_cents: Number(share.amount_cents) })),
      comments: commentsByExpense.get(expense.id) ?? [],
    })),
    settlements: (settlements.results ?? []).map(settlement => ({ ...settlement, amount_cents: Number(settlement.amount_cents) })),
    balances: balanceRows,
    simplified_debts: fredagsfettSimplifyDebts(balanceRows),
    activity: activity.results ?? [],
  };
}

async function fredagsfettEnsureDefaultMembership(env: Env, userId: string, isAdmin: boolean): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO ff_groups (id, name, created_at) VALUES ('fredagsfett', 'Fredagsfett', datetime('now'))`),
    env.DB.prepare(`INSERT OR IGNORE INTO ff_group_members (group_id, user_id, role, created_at) VALUES ('fredagsfett', ?, ?, datetime('now'))`).bind(userId, isAdmin ? 'admin' : 'member'),
  ]);
}

async function fredagsfettLoadGroupMembers(env: Env, groupId: string): Promise<FredagsfettMemberRow[]> {
  const members = await env.DB.prepare(
    `SELECT u.id, u.name, u.is_admin
       FROM ff_group_members gm
       JOIN ff_users u ON u.id = gm.user_id AND u.deleted_at IS NULL
      WHERE gm.group_id = ?
      ORDER BY u.name COLLATE NOCASE ASC`
  ).bind(groupId).all<FredagsfettMemberRow>();
  return members.results ?? [];
}

async function fredagsfettLoadExpenseForMember(env: Env, expenseId: string, userId: string): Promise<FredagsfettExpenseRow | null> {
  const id = normalizeFredagsfettId(expenseId);
  if (!id) return null;
  return await env.DB.prepare(
    `SELECT e.id, e.group_id, e.paid_by_id, u.name AS paid_by_name, e.amount_cents, e.currency,
            e.description, e.date, e.split_method, e.created_at, e.updated_at
       FROM ff_expenses e
       JOIN ff_group_members gm ON gm.group_id = e.group_id AND gm.user_id = ?
       JOIN ff_users u ON u.id = e.paid_by_id
      WHERE e.id = ? AND e.deleted_at IS NULL`
  ).bind(userId, id).first<FredagsfettExpenseRow>();
}

function fredagsfettSimplifyDebts(balances: Array<{ user_id: string; name: string; amount_cents: number }>) {
  const debtors = balances
    .filter(row => row.amount_cents < 0)
    .map(row => ({ ...row, amount_cents: Math.abs(row.amount_cents) }))
    .sort((a, b) => b.amount_cents - a.amount_cents);
  const creditors = balances
    .filter(row => row.amount_cents > 0)
    .map(row => ({ ...row }))
    .sort((a, b) => b.amount_cents - a.amount_cents);
  const result: Array<{ from_user_id: string; from_name: string; to_user_id: string; to_name: string; amount_cents: number }> = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const amount = Math.min(debtors[i].amount_cents, creditors[j].amount_cents);
    if (amount > 0) {
      result.push({
        from_user_id: debtors[i].user_id,
        from_name: debtors[i].name,
        to_user_id: creditors[j].user_id,
        to_name: creditors[j].name,
        amount_cents: amount,
      });
    }
    debtors[i].amount_cents -= amount;
    creditors[j].amount_cents -= amount;
    if (debtors[i].amount_cents <= 0) i++;
    if (creditors[j].amount_cents <= 0) j++;
  }
  return result;
}

function buildFredagsfettExpenseShares(
  amountCents: number,
  splitMethod: string,
  body: { participants?: string[]; shares?: Array<{ user_id?: string; amount?: number | string; percent?: number | string; shares?: number | string }> },
  members: FredagsfettMemberRow[]
): Array<{ user_id: string; amount_cents: number }> {
  const memberIds = new Set(members.map(member => member.id));
  const requestedParticipants = (body.participants ?? []).map(normalizeFredagsfettId).filter((id): id is string => !!id && memberIds.has(id));
  const participants = requestedParticipants.length ? requestedParticipants : members.map(member => member.id);
  if (!participants.length) return [];

  if (splitMethod === 'AMOUNTS') {
    const rows = (body.shares ?? [])
      .map(share => ({ user_id: normalizeFredagsfettId(share.user_id), amount_cents: parseFredagsfettMoney(share.amount) }))
      .filter((share): share is { user_id: string; amount_cents: number } => !!share.user_id && memberIds.has(share.user_id) && !!share.amount_cents);
    const total = rows.reduce((sum, row) => sum + row.amount_cents, 0);
    return total === amountCents ? rows : [];
  }

  if (splitMethod === 'PERCENT') {
    const rows = (body.shares ?? [])
      .map(share => ({ user_id: normalizeFredagsfettId(share.user_id), percent: Number(String(share.percent ?? '').replace(',', '.')) }))
      .filter((share): share is { user_id: string; percent: number } => !!share.user_id && memberIds.has(share.user_id) && Number.isFinite(share.percent) && share.percent > 0);
    const percentTotal = rows.reduce((sum, row) => sum + row.percent, 0);
    if (Math.abs(percentTotal - 100) > 0.01) return [];
    let remaining = amountCents;
    return rows.map((row, index) => {
      const amount = index === rows.length - 1 ? remaining : Math.round(amountCents * (row.percent / 100));
      remaining -= amount;
      return { user_id: row.user_id, amount_cents: amount };
    });
  }

  if (splitMethod === 'SHARES') {
    const rows = (body.shares ?? [])
      .map(share => ({ user_id: normalizeFredagsfettId(share.user_id), shares: Number(String(share.shares ?? '').replace(',', '.')) }))
      .filter((share): share is { user_id: string; shares: number } => !!share.user_id && memberIds.has(share.user_id) && Number.isFinite(share.shares) && share.shares > 0);
    const shareTotal = rows.reduce((sum, row) => sum + row.shares, 0);
    if (!shareTotal) return [];
    let remaining = amountCents;
    return rows.map((row, index) => {
      const amount = index === rows.length - 1 ? remaining : Math.round(amountCents * (row.shares / shareTotal));
      remaining -= amount;
      return { user_id: row.user_id, amount_cents: amount };
    });
  }

  return distributeFredagsfettEqual(amountCents, participants);
}

function distributeFredagsfettEqual(amountCents: number, userIds: string[]): Array<{ user_id: string; amount_cents: number }> {
  const uniqueIds = Array.from(new Set(userIds.map(normalizeFredagsfettId).filter((id): id is string => !!id)));
  if (!uniqueIds.length) return [];
  const base = Math.floor(amountCents / uniqueIds.length);
  let remainder = amountCents - base * uniqueIds.length;
  return uniqueIds.map(userId => {
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;
    return { user_id: userId, amount_cents: base + extra };
  });
}

function normalizeFredagsfettMonth(value: string | null | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}-01T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return value;
}

function addMonthsToFredagsfettMonth(month: string, offset: number): string {
  const [year, monthNumber] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + offset, 1));
  return date.toISOString().slice(0, 7);
}

function currentFredagsfettMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

function currentFredagsfettDate(): string {
  return new Date().toISOString().slice(0, 10);
}

async function fredagsfettEnsureAvailabilityTimeColumns(env: Env): Promise<void> {
  const info = await env.DB.prepare(`PRAGMA table_info(ff_availability)`).all<{ name: string }>();
  const columns = new Set((info.results ?? []).map(column => column.name));
  const additions: Array<[string, string]> = [
    ['start_time', `ALTER TABLE ff_availability ADD COLUMN start_time TEXT`],
    ['end_time', `ALTER TABLE ff_availability ADD COLUMN end_time TEXT`],
    ['time_note', `ALTER TABLE ff_availability ADD COLUMN time_note TEXT`],
  ];
  for (const [column, sql] of additions) {
    if (columns.has(column)) continue;
    try {
      await env.DB.prepare(sql).run();
      columns.add(column);
    } catch (error) {
      if (!String(error).toLowerCase().includes('duplicate column')) throw error;
    }
  }
}

function normalizeFredagsfettDate(value: string | null | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  return value;
}

function normalizeFredagsfettTime(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const time = value.trim();
  if (!time) return null;
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  return time;
}

function fredagsfettWeekdayDefaultTimes(date: string): { start_time: string | null; end_time: string | null } {
  // date is YYYY-MM-DD; compute UTC weekday (matches D1 storage, which is date-only).
  const weekday = new Date(date + 'T00:00:00Z').getUTCDay(); // 0=Sun..6=Sat
  if (weekday === 5) return { start_time: '18:00', end_time: null };
  if (weekday === 6) return { start_time: '17:00', end_time: null };
  if (weekday === 0) return { start_time: '12:00', end_time: null };
  return { start_time: null, end_time: null };
}

function normalizeFredagsfettAvailabilityStatus(value: string | null | undefined): FredagsfettAvailabilityRow['status'] | null {
  if (value === 'AVAILABLE' || value === 'MAYBE' || value === 'UNAVAILABLE') return value;
  return null;
}

function fredagsfettAvailabilityLabel(status: FredagsfettAvailabilityRow['status']): string {
  if (status === 'AVAILABLE') return 'Tillgänglig';
  if (status === 'MAYBE') return 'Kanske';
  return 'Inte tillgänglig';
}

function normalizeFredagsfettShortText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim().replace(/\s+/g, ' ');
  if (!text) return null;
  return text.slice(0, maxLength);
}

function normalizeFredagsfettTimeNote(value: unknown): string | null {
  return normalizeFredagsfettShortText(value, 160);
}

function normalizeFredagsfettId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const id = value.trim();
  return /^[a-zA-Z0-9_-]{1,80}$/.test(id) ? id : null;
}

function normalizeFredagsfettCurrency(value: unknown): string {
  if (typeof value !== 'string') return 'SEK';
  const currency = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(currency) ? currency : 'SEK';
}

function normalizeFredagsfettSplitMethod(value: unknown): 'EQUAL' | 'AMOUNTS' | 'PERCENT' | 'SHARES' {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (raw === 'amount' || raw === 'amounts') return 'AMOUNTS';
  if (raw === 'percent') return 'PERCENT';
  if (raw === 'shares') return 'SHARES';
  return 'EQUAL';
}

function parseFredagsfettMoney(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const n = typeof value === 'number' ? value : Number(value.replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

function formatFredagsfettKr(amountCents: number): string {
  return `${(amountCents / 100).toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr`;
}

async function fredagsfettLog(env: Env, groupId: string, actorId: string | null, type: string, entityType: string | null, entityId: string | null, message: string): Promise<void> {
  await fredagsfettLogStatement(env, groupId, actorId, type, entityType, entityId, message).run();
}

function fredagsfettLogStatement(env: Env, groupId: string, actorId: string | null, type: string, entityType: string | null, entityId: string | null, message: string) {
  return env.DB.prepare(
    `INSERT INTO ff_activity_log (id, group_id, user_id, type, entity_type, entity_id, body, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`
  ).bind(crypto.randomUUID(), groupId, actorId, type, entityType, entityId, message);
}

function csvFredagsfett(value: unknown): string {
  const text = String(value ?? '');
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

async function requireFredagsfettUser(request: Request, env: Env): Promise<{ cfg: FredagsfettConfig; payload: FredagsfettSessionPayload; device: FredagsfettDeviceRow; user: FredagsfettUserRow }> {
  const cfg = fredagsfettConfig(env);
  if (!cfg.ok) throw new HttpError(500, 'Fredagsfett är inte konfigurerat.');
  const cookie = getCookie(request, FREDAGSFETT_SESSION_COOKIE);
  if (!cookie) throw new HttpError(401, 'Session saknas.');
  const session = await fredagsfettSessionFromCookie(env, cookie, cfg.value.sessionSecret);
  if (!session?.user) throw new HttpError(401, 'Sessionen är ogiltig eller saknar registrerat namn.');
  await fredagsfettTouchDevice(env, session.device.id);
  return { cfg: cfg.value, payload: session.payload, device: session.device, user: session.user };
}

async function requireFredagsfettAdmin(request: Request, env: Env): Promise<{ cfg: FredagsfettConfig; payload: FredagsfettSessionPayload; device: FredagsfettDeviceRow; user: FredagsfettUserRow }> {
  const session = await requireFredagsfettUser(request, env);
  await fredagsfettRequireAdminUnlock(request, session.cfg.sessionSecret);
  return session;
}

async function requireFredagsfettAdminUser(request: Request, env: Env): Promise<{ cfg: FredagsfettConfig; payload: FredagsfettSessionPayload; device: FredagsfettDeviceRow; user: FredagsfettUserRow }> {
  const session = await requireFredagsfettUser(request, env);
  if (!session.user.is_admin) {
    throw new HttpError(403, 'not_admin');
  }
  return session;
}

function fredagsfettConfig(env: Env): { ok: true; value: FredagsfettConfig } | { ok: false; response: Response } {
  const configuredPassword = env.FF_PASSWORD?.trim();
  const passwordCandidates = Array.from(new Set([
    configuredPassword,
    DEFAULT_FREDAGSFETT_PASSWORD,
  ].filter((value): value is string => Boolean(value))));
  const sessionSecret = env.FF_SESSION_SECRET?.trim();
  const hashSalt = env.FF_DEVICE_HASH_SALT?.trim();
  if (!passwordCandidates.length || !sessionSecret || !hashSalt) {
    return { ok: false, response: json({ error: 'Fredagsfett är inte konfigurerat.' }, 500) };
  }
  return {
    ok: true,
    value: {
      passwordCandidates,
      sessionSecret,
      hashSalt,
      adminNames: new Set((env.FF_ADMIN_NAMES ?? '').split(',').map(n => n.trim().toLocaleLowerCase('sv-SE')).filter(Boolean)),
    },
  };
}

async function fredagsfettFingerprint(request: Request, cfg: FredagsfettConfig): Promise<{ ipHash: string; userAgentHash: string }> {
  const ip = request.headers.get('CF-Connecting-IP')
    ?? request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim()
    ?? 'unknown';
  const userAgent = request.headers.get('User-Agent') ?? 'unknown';
  return {
    ipHash: await hashFredagsfettFingerprint(cfg.hashSalt, ip),
    userAgentHash: await hashFredagsfettFingerprint(cfg.hashSalt, userAgent),
  };
}

async function hashFredagsfettFingerprint(salt: string, value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${value}`));
  return toHex(new Uint8Array(bytes));
}

async function fredagsfettAuthThrottle(env: Env, ipHash: string): Promise<{ throttled: boolean; windowStart: string; nextAllowedAt: string }> {
  const windowMs = FREDAGSFETT_AUTH_WINDOW_SECONDS * 1000;
  const startedAtMs = Math.floor(Date.now() / windowMs) * windowMs;
  const windowStart = new Date(startedAtMs).toISOString();
  const nextAllowedAt = new Date(startedAtMs + windowMs).toISOString();
  await env.DB.prepare(`DELETE FROM ff_auth_attempts WHERE last_attempt_at < datetime('now', '-1 day')`).run().catch(() => {});
  const row = await env.DB.prepare(
    `SELECT attempts FROM ff_auth_attempts WHERE ip_hash = ? AND window_start = ?`
  ).bind(ipHash, windowStart).first<{ attempts: number }>();
  return { throttled: Number(row?.attempts ?? 0) >= FREDAGSFETT_AUTH_MAX_ATTEMPTS, windowStart, nextAllowedAt };
}

async function fredagsfettRecordAuthAttempt(env: Env, ipHash: string, windowStart: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO ff_auth_attempts (ip_hash, window_start, attempts, last_attempt_at)
     VALUES (?, ?, 1, datetime('now'))
     ON CONFLICT(ip_hash, window_start) DO UPDATE SET
       attempts = attempts + 1,
       last_attempt_at = datetime('now')`
  ).bind(ipHash, windowStart).run();
}

async function fredagsfettFindOrCreateDevice(env: Env, ipHash: string, userAgentHash: string): Promise<FredagsfettDeviceRow> {
  const existing = await env.DB.prepare(
    `SELECT id, user_id, ip_hash, user_agent_hash, revoked_at
       FROM ff_devices
      WHERE ip_hash = ? AND user_agent_hash = ? AND revoked_at IS NULL`
  ).bind(ipHash, userAgentHash).first<FredagsfettDeviceRow>();
  if (existing) {
    await fredagsfettTouchDevice(env, existing.id);
    return existing;
  }

  const revoked = await env.DB.prepare(
    `SELECT id, user_id, ip_hash, user_agent_hash, revoked_at
       FROM ff_devices
      WHERE ip_hash = ? AND user_agent_hash = ?
      ORDER BY created_at DESC
      LIMIT 1`
  ).bind(ipHash, userAgentHash).first<FredagsfettDeviceRow>();
  if (revoked) {
    await env.DB.prepare(
      `UPDATE ff_devices SET revoked_at = NULL, last_seen_at = datetime('now') WHERE id = ?`
    ).bind(revoked.id).run();
    return { ...revoked, revoked_at: null };
  }

  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO ff_devices (id, ip_hash, user_agent_hash, created_at, last_seen_at)
     VALUES (?, ?, ?, datetime('now'), datetime('now'))`
  ).bind(id, ipHash, userAgentHash).run();
  return { id, user_id: null, ip_hash: ipHash, user_agent_hash: userAgentHash, revoked_at: null };
}

async function fredagsfettTouchDevice(env: Env, deviceId: string): Promise<void> {
  await env.DB.prepare(`UPDATE ff_devices SET last_seen_at = datetime('now') WHERE id = ?`).bind(deviceId).run().catch(() => {});
}

async function fredagsfettLoadUser(env: Env, userId: string): Promise<FredagsfettUserRow | null> {
  return await env.DB.prepare(
    `SELECT id, name, is_admin, deleted_at FROM ff_users WHERE id = ? AND deleted_at IS NULL`
  ).bind(userId).first<FredagsfettUserRow>() ?? null;
}

async function fredagsfettSessionFromCookie(env: Env, token: string, secret: string): Promise<{ payload: FredagsfettSessionPayload; device: FredagsfettDeviceRow; user: FredagsfettUserRow | null } | null> {
  const payload = await verifyFredagsfettSessionToken(token, secret);
  if (!payload) return null;
  const device = await env.DB.prepare(
    `SELECT id, user_id, ip_hash, user_agent_hash, revoked_at FROM ff_devices WHERE id = ? AND revoked_at IS NULL`
  ).bind(payload.deviceId).first<FredagsfettDeviceRow>();
  if (!device) return null;
  const userId = device.user_id ?? payload.userId;
  const user = userId ? await fredagsfettLoadUser(env, userId) : null;
  return { payload, device, user };
}

function fredagsfettUserPayload(user: FredagsfettUserRow): { id: string; name: string; is_admin: boolean } {
  return { id: user.id, name: user.name, is_admin: !!user.is_admin };
}

function normalizeFredagsfettName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.replace(/\s+/g, ' ').trim();
  if (name.length < 2 || name.length > 80) return null;
  return name;
}

function fredagsfettSessionExpiry(): number {
  return Math.floor(Date.now() / 1000) + FREDAGSFETT_SESSION_MAX_AGE_SECONDS;
}

function fredagsfettAdminSessionExpiry(): number {
  return Math.floor(Date.now() / 1000) + FREDAGSFETT_ADMIN_SESSION_MAX_AGE_SECONDS;
}

function fredagsfettAdminPasswordCandidates(env: Env): string[] {
  return Array.from(new Set([
    env.FF_ADMIN_PASSWORD?.trim(),
    DEFAULT_FREDAGSFETT_ADMIN_PASSWORD,
  ].filter((value): value is string => Boolean(value))));
}

async function signFredagsfettSession(payload: FredagsfettSessionPayload, secret: string): Promise<string> {
  const encodedPayload = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await hmacSha256Base64Url(secret, encodedPayload);
  return `${encodedPayload}.${signature}`;
}

async function signFredagsfettAdminSession(payload: FredagsfettAdminPayload, secret: string): Promise<string> {
  const encodedPayload = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await hmacSha256Base64Url(secret, encodedPayload);
  return `${encodedPayload}.${signature}`;
}

async function verifyFredagsfettSessionToken(token: string, secret: string): Promise<FredagsfettSessionPayload | null> {
  const [encodedPayload, signature] = token.split('.');
  if (!encodedPayload || !signature) return null;
  const expected = await hmacSha256Base64Url(secret, encodedPayload);
  if (!constantTimeStringEqual(signature, expected)) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(encodedPayload))) as FredagsfettSessionPayload;
    if (payload.v !== 1 || !payload.deviceId || typeof payload.exp !== 'number') return null;
    if (payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

async function verifyFredagsfettAdminSessionToken(token: string, secret: string): Promise<FredagsfettAdminPayload | null> {
  const [encodedPayload, signature] = token.split('.');
  if (!encodedPayload || !signature) return null;
  const expected = await hmacSha256Base64Url(secret, encodedPayload);
  if (!constantTimeStringEqual(signature, expected)) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(encodedPayload))) as FredagsfettAdminPayload;
    if (payload.v !== 1 || payload.scope !== 'fredagsfett-admin' || typeof payload.exp !== 'number') return null;
    if (payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

async function fredagsfettHasAdminUnlock(request: Request, secret: string): Promise<boolean> {
  const cookie = getCookie(request, FREDAGSFETT_ADMIN_COOKIE);
  if (!cookie) return false;
  return !!await verifyFredagsfettAdminSessionToken(cookie, secret);
}

async function fredagsfettRequireAdminUnlock(request: Request, secret: string): Promise<void> {
  if (!await fredagsfettHasAdminUnlock(request, secret)) {
    throw new HttpError(403, 'Adminlås kräver lösenord.');
  }
}

async function hmacSha256Base64Url(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return base64UrlEncode(new Uint8Array(sig));
}

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function constantTimeStringEqual(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  const len = Math.max(aBytes.length, bBytes.length);
  let diff = aBytes.length ^ bBytes.length;
  for (let i = 0; i < len; i++) diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
  return diff === 0;
}

function fredagsfettPasswordMatches(input: string, candidates: string[]): boolean {
  let matched = false;
  for (const candidate of candidates) {
    matched = constantTimeStringEqual(input, candidate) || matched;
  }
  return matched;
}

function fredagsfettSessionCookie(token: string): string {
  return `${FREDAGSFETT_SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${FREDAGSFETT_SESSION_MAX_AGE_SECONDS}`;
}

function clearFredagsfettSessionCookie(): string {
  return `${FREDAGSFETT_SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

function fredagsfettAdminSessionCookie(token: string): string {
  return `${FREDAGSFETT_ADMIN_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${FREDAGSFETT_ADMIN_SESSION_MAX_AGE_SECONDS}`;
}

function clearFredagsfettAdminSessionCookie(): string {
  return `${FREDAGSFETT_ADMIN_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

function fredagsfettJson(data: unknown, status = 200, cookie?: string): Response {
  const headers = new Headers({ 'Content-Type': 'application/json', ...cors() });
  if (cookie) headers.append('Set-Cookie', cookie);
  return new Response(JSON.stringify(data), { status, headers });
}

// Group chat — lightweight message board. ──────────────────────────────────

async function fredagsfettChatList(request: Request, env: Env): Promise<Response> {
  await requireFredagsfettUser(request, env);
  const url = new URL(request.url);
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 80));
  const since = url.searchParams.get('since') || '';
  const sinceClause = since ? 'AND c.created_at > ?' : '';
  const bindings: unknown[] = ['fredagsfett'];
  if (since) bindings.push(since);
  bindings.push(limit);
  const rows = await env.DB.prepare(
    `SELECT c.id, c.user_id, u.name AS user_name, u.is_admin AS user_is_admin,
            c.body, c.created_at
       FROM ff_chat_messages c
       JOIN ff_users u ON u.id = c.user_id
      WHERE c.group_id = ? AND c.deleted_at IS NULL ${sinceClause}
      ORDER BY c.created_at DESC
      LIMIT ?`
  ).bind(...bindings).all<{ id: string; user_id: string; user_name: string; user_is_admin: number; body: string; created_at: string }>();
  // Return ascending so the client can append naturally.
  const messages = (rows.results ?? []).map(r => ({ ...r, user_is_admin: !!r.user_is_admin })).reverse();
  return json({ messages });
}

async function fredagsfettChatCreate(request: Request, env: Env): Promise<Response> {
  const session = await requireFredagsfettUser(request, env);
  let body: { body?: string };
  try { body = await request.json(); }
  catch { return json({ error: 'Ogiltig JSON.' }, 400); }
  const text = normalizeFredagsfettShortText(body.body, 2000);
  if (!text) return json({ error: 'Skriv något att skicka.' }, 400);
  const id = `ffc-${crypto.randomUUID()}`;
  await env.DB.prepare(
    `INSERT INTO ff_chat_messages (id, group_id, user_id, body, created_at)
     VALUES (?, 'fredagsfett', ?, ?, datetime('now'))`
  ).bind(id, session.user.id, text).run();
  return json({ success: true, message_id: id });
}

// ─── Dispatcher ──────────────────────────────────────────────────────────────

export const onRequest: PagesFunction<Env> = async (ctx) => {
  const { request, params, env } = ctx;
  const method = request.method.toUpperCase();
  if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });
  const segments = Array.isArray(params.route)
    ? (params.route as string[])
    : (params.route ? [params.route as string] : []);
  const [id = '', sub = '', action = ''] = segments;

  try {
    if (id === 'auth'     && method === 'POST') return fredagsfettAuth(request, env);
    if (id === 'session'  && method === 'GET')  return fredagsfettSession(request, env);
    if (id === 'register' && method === 'POST') return fredagsfettRegister(request, env);
    if (id === 'logout'   && method === 'POST') return fredagsfettLogout(request, env);
    if (id === 'availability' && !sub && method === 'GET') return fredagsfettAvailabilityList(request, env);
    if (id === 'availability' && !sub && method === 'POST') return fredagsfettAvailabilityUpsert(request, env);
    if (id === 'availability' && !sub && method === 'DELETE') return fredagsfettAvailabilityDelete(request, env);
    if (id === 'events' && !sub && method === 'GET')  return fredagsfettEventsList(request, env);
    if (id === 'events' && !sub && method === 'POST') return fredagsfettEventsCreate(request, env);
    if (id === 'events' && sub && !action && method === 'PATCH')  return fredagsfettEventsUpdate(request, env, sub);
    if (id === 'events' && sub && !action && method === 'DELETE') return fredagsfettEventsCancel(request, env, sub);
    if (id === 'events' && sub && action === 'comments' && method === 'GET')  return fredagsfettEventCommentsList(request, env, sub);
    if (id === 'events' && sub && action === 'comments' && method === 'POST') return fredagsfettEventCommentsCreate(request, env, sub);
    if (id === 'events' && sub && action === 'items' && method === 'GET')  return fredagsfettEventItemsList(request, env, sub);
    if (id === 'events' && sub && action === 'items' && method === 'POST') return fredagsfettEventItemsCreate(request, env, sub);
    if (id === 'items' && sub && !action && method === 'PATCH')  return fredagsfettEventItemsUpdate(request, env, sub);
    if (id === 'items' && sub && !action && method === 'DELETE') return fredagsfettEventItemsDelete(request, env, sub);
    if (id === 'events' && sub && action === 'photos' && method === 'GET')  return fredagsfettEventPhotosList(request, env, sub);
    if (id === 'events' && sub && action === 'photos' && method === 'POST') return fredagsfettEventPhotosCreate(request, env, sub);
    if (id === 'photos' && sub && !action && method === 'GET')    return fredagsfettEventPhotoDownload(request, env, sub);
    if (id === 'photos' && sub && !action && method === 'DELETE') return fredagsfettEventPhotoDelete(request, env, sub);
    if (id === 'activity' && !sub && method === 'GET') return fredagsfettActivityList(request, env);
    if (id === 'chat' && !sub && method === 'GET')  return fredagsfettChatList(request, env);
    if (id === 'chat' && !sub && method === 'POST') return fredagsfettChatCreate(request, env);
    if (id === 'ical-url' && !sub && method === 'GET') return fredagsfettIcalUrl(request, env);
    if (id === 'ical' && sub && !action && method === 'GET') return fredagsfettIcalFeed(request, env, sub);
    if (id === 'sp1wise' && !sub && method === 'GET') return fredagsfettSp1wise(request, env);
    if (id === 'sp1wise' && sub === 'groups' && !action && method === 'GET') return fredagsfettSp1wiseGroups(request, env);
    if (id === 'sp1wise' && sub === 'groups' && !action && method === 'POST') return fredagsfettSp1wiseCreateGroup(request, env);
    if (id === 'sp1wise' && sub === 'expenses' && !action && method === 'POST') return fredagsfettSp1wiseCreateExpense(request, env);
    if (id === 'sp1wise' && sub === 'expenses' && action && method === 'PATCH') return fredagsfettSp1wiseUpdateExpense(request, env, action);
    if (id === 'sp1wise' && sub === 'expenses' && action && method === 'DELETE') return fredagsfettSp1wiseDeleteExpense(request, env, action);
    if (id === 'sp1wise' && sub === 'settlements' && !action && method === 'POST') return fredagsfettSp1wiseCreateSettlement(request, env);
    if (id === 'sp1wise' && sub === 'comments' && !action && method === 'POST') return fredagsfettSp1wiseCreateComment(request, env);
    if (id === 'sp1wise' && sub === 'export' && !action && method === 'GET') return fredagsfettSp1wiseExport(request, env);
    if (id === 'admin' && sub === 'auth' && !action && method === 'POST') return fredagsfettAdminAuth(request, env);
    if (id === 'admin' && sub === 'status' && !action && method === 'GET') return fredagsfettAdminStatus(request, env);
    if (id === 'admin' && sub === 'logout' && !action && method === 'POST') return fredagsfettAdminLogout(request, env);
    if (id === 'admin' && sub === 'users' && !action && method === 'GET') return fredagsfettAdminUsers(request, env);
    if (id === 'admin' && sub === 'users' && action && method === 'PATCH') return fredagsfettAdminUpdateUser(request, env, action);
    if (id === 'admin' && sub === 'users' && action && method === 'DELETE') return fredagsfettAdminDeleteUser(request, env, action);
    if (id === 'admin' && sub === 'devices' && action && method === 'DELETE') return fredagsfettAdminRevokeDevice(request, env, action);
    if (id === 'admin' && sub === 'cleanup' && !action && method === 'POST') return fredagsfettAdminCleanup(request, env);
    return json({ error: 'not found' }, 404);
  } catch (err) {
    if (err instanceof AuthError) return json({ error: 'Unauthorized' }, 401);
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    console.error(err);
    return json({ error: 'internal error' }, 500);
  }
};
