/**
 * sp1e.se — API Worker (Cloudflare Pages Function, catch-all /api/*)
 *
 * Password hashing: PBKDF2-SHA256 via Web Crypto.
 * bcrypt is not available in Workers without an npm build step.
 * PBKDF2 with 100 000 iterations is equally appropriate for a single-user app.
 *
 * Hash format stored in AUTH_PASSWORD_HASH:
 *   pbkdf2:100000:<saltHex>:<hashHex>
 *
 * Generate it with:  node scripts/hash-password.js "your-password"
 */

export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  AUTH_PASSWORD_HASH: string;
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export const onRequest: PagesFunction<Env> = async (ctx) => {
  const { request, params } = ctx;
  const route  = ((params.route as string[]) ?? []).join('/');
  const method = request.method.toUpperCase();

  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors() });
  }

  try {
    // ── Health ──────────────────────────────────────────────────────────────
    if (route === 'health' && method === 'GET') {
      return json({ status: 'ok' });
    }

    // ── Auth ────────────────────────────────────────────────────────────────
    if (route === 'auth/login'  && method === 'POST') return handleLogin(request, ctx.env);
    if (route === 'auth/logout' && method === 'POST') return handleLogout(request, ctx.env);
    if (route === 'auth/check'  && method === 'GET')  return handleCheck(request, ctx.env);

    return json({ error: 'not found' }, 404);

  } catch (err) {
    if (err instanceof AuthError) return json({ error: 'Unauthorized' }, 401);
    console.error(err);
    return json({ error: 'internal error' }, 500);
  }
};

// ─── Auth handlers ────────────────────────────────────────────────────────────

async function handleLogin(request: Request, env: Env): Promise<Response> {
  let body: { password?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  if (!body.password || typeof body.password !== 'string') {
    return json({ error: 'password required' }, 400);
  }

  if (!env.AUTH_PASSWORD_HASH) {
    console.error('AUTH_PASSWORD_HASH env var not set');
    return json({ error: 'Auth not configured' }, 500);
  }

  const valid = await verifyPassword(body.password, env.AUTH_PASSWORD_HASH);

  if (!valid) {
    // Constant delay to prevent timing-based enumeration
    await sleep(200 + Math.random() * 200);
    return json({ error: 'Wrong password' }, 401);
  }

  // Create session
  const token     = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  await env.DB
    .prepare('INSERT INTO sessions (token, expires_at) VALUES (?, ?)')
    .bind(token, expiresAt.toISOString())
    .run();

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': sessionCookie(token, expiresAt),
      ...cors(),
    },
  });
}

async function handleLogout(request: Request, env: Env): Promise<Response> {
  const token = getCookie(request, 'session');

  if (token) {
    await env.DB
      .prepare('DELETE FROM sessions WHERE token = ?')
      .bind(token)
      .run()
      .catch(() => { /* ignore — best-effort delete */ });
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': clearCookie(),
      ...cors(),
    },
  });
}

async function handleCheck(request: Request, env: Env): Promise<Response> {
  const token = getCookie(request, 'session');
  if (!token) return json({ authenticated: false });

  const session = await env.DB
    .prepare(`SELECT token FROM sessions WHERE token = ? AND expires_at > datetime('now')`)
    .bind(token)
    .first();

  return json({ authenticated: !!session });
}

// ─── requireAuth — use this in all protected routes ───────────────────────────
//
//   const session = await requireAuth(request, env);
//   // throws 401 AuthError if not authenticated

export async function requireAuth(request: Request, env: Env): Promise<{ token: string }> {
  const token = getCookie(request, 'session');
  if (!token) throw new AuthError();

  const row = await env.DB
    .prepare(`SELECT token FROM sessions WHERE token = ? AND expires_at > datetime('now')`)
    .bind(token)
    .first<{ token: string }>();

  if (!row) throw new AuthError();
  return { token: row.token };
}

class AuthError extends Error {
  constructor() { super('Unauthorized'); }
}

// ─── PBKDF2 password verification ────────────────────────────────────────────
//
// Hash format: "pbkdf2:<iterations>:<saltHex>:<hashHex>"

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const parts = stored.split(':');
    if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;

    const [, iterStr, saltHex, storedHash] = parts;
    const iterations = parseInt(iterStr, 10);
    if (!iterations || iterations < 1) return false;

    const salt        = fromHex(saltHex);
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      'PBKDF2',
      false,
      ['deriveBits'],
    );
    const bits     = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
      keyMaterial,
      256,
    );
    const computed = toHex(new Uint8Array(bits));

    return constantTimeEqual(computed, storedHash);
  } catch {
    return false;
  }
}

// ─── Cookie helpers ───────────────────────────────────────────────────────────

function getCookie(request: Request, name: string): string | null {
  const header = request.headers.get('Cookie') ?? '';
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

function sessionCookie(token: string, expires: Date): string {
  return [
    `session=${token}`,
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
    'Path=/',
    `Expires=${expires.toUTCString()}`,
  ].join('; ');
}

function clearCookie(): string {
  return 'session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0';
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors() },
  });
}

function cors(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array {
  const matches = hex.match(/.{2}/g);
  if (!matches) return new Uint8Array(0);
  return new Uint8Array(matches.map(b => parseInt(b, 16)));
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
