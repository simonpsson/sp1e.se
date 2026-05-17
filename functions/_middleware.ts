interface Env {
  DB: D1Database;
  FF_SESSION_SECRET?: string;
}

type FredagsfettSessionPayload = {
  v: 1;
  deviceId: string;
  userId: string | null;
  exp: number;
};

const FREDAGSFETT_SESSION_COOKIE = 'ff_session';

export const onRequest: PagesFunction<Env> = async ({ request, env, next }) => {
  const url = new URL(request.url);
  const path = url.pathname;
  const isFredagsfettPage = path === '/fredagsfett' || path.startsWith('/fredagsfett/');
  const isFredagsfettApi = path === '/api/fredagsfett' || path.startsWith('/api/fredagsfett/');

  if (!isFredagsfettPage && !isFredagsfettApi) return next();
  if (path === '/fredagsfett' || path === '/fredagsfett/' || path === '/fredagsfett/index.html') return next();
  if (path === '/api/fredagsfett/auth' || path === '/api/fredagsfett/session') return next();
  // Static assets (CSS / JS / SVG / fonts) in /fredagsfett/ are not protected —
  // they have no user data in them and the Service Worker needs them cacheable
  // even on first install before the user logs in.
  if (/\.(css|js|svg|png|jpg|jpeg|gif|webp|woff2?|ttf)$/i.test(path)) return next();
  // iCal feed is authenticated by the signed token in the URL, not a cookie —
  // calendar clients (Google / Apple) don't send cookies.
  if (path.startsWith('/api/fredagsfett/ical/')) return next();
  // QoL #29 — public RSVP share links use an HMAC token in the URL, not a cookie.
  if (path.startsWith('/api/fredagsfett/rsvp-public/')) return next();
  if (path.startsWith('/fredagsfett/rsvp/')) return next();

  const session = await verifyFredagsfettMiddlewareSession(request, env);
  if (session) return next();

  if (isFredagsfettApi) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const loginUrl = new URL('/fredagsfett', request.url);
  loginUrl.searchParams.set('next', path);
  return Response.redirect(loginUrl.toString(), 302);
};

async function verifyFredagsfettMiddlewareSession(request: Request, env: Env): Promise<FredagsfettSessionPayload | null> {
  const secret = env.FF_SESSION_SECRET?.trim();
  if (!secret) return null;
  const token = getMiddlewareCookie(request, FREDAGSFETT_SESSION_COOKIE);
  if (!token) return null;
  const payload = await verifyFredagsfettMiddlewareToken(token, secret);
  if (!payload) return null;
  const device = await env.DB.prepare(
    `SELECT id FROM ff_devices WHERE id = ? AND revoked_at IS NULL`
  ).bind(payload.deviceId).first<{ id: string }>();
  return device ? payload : null;
}

async function verifyFredagsfettMiddlewareToken(token: string, secret: string): Promise<FredagsfettSessionPayload | null> {
  const [encodedPayload, signature] = token.split('.');
  if (!encodedPayload || !signature) return null;
  const expected = await middlewareHmacSha256Base64Url(secret, encodedPayload);
  if (!middlewareConstantTimeStringEqual(signature, expected)) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(middlewareBase64UrlDecode(encodedPayload))) as FredagsfettSessionPayload;
    if (payload.v !== 1 || !payload.deviceId || typeof payload.exp !== 'number') return null;
    if (payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function getMiddlewareCookie(request: Request, name: string): string | null {
  const header = request.headers.get('Cookie') ?? '';
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq !== -1 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

async function middlewareHmacSha256Base64Url(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return middlewareBase64UrlEncode(new Uint8Array(sig));
}

function middlewareBase64UrlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function middlewareBase64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function middlewareConstantTimeStringEqual(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  const len = Math.max(aBytes.length, bBytes.length);
  let diff = aBytes.length ^ bBytes.length;
  for (let i = 0; i < len; i++) diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
  return diff === 0;
}
