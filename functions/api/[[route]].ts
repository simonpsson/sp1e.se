/**
 * sp1e.se API — Cloudflare Pages Function (catch-all)
 * Handles all requests matching /api/*
 *
 * Local dev: npx wrangler pages dev . --d1=DB --r2=FILES
 */

export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  PASSWORD_HASH?: string;
}

// ─── Routing ──────────────────────────────────────────────────────────────────

export const onRequest: PagesFunction<Env> = async (ctx) => {
  const { request, params } = ctx;

  const segments = (params.route as string[] | undefined) ?? [];
  const route    = segments.join('/');           // e.g. "health", "notes", "notes/abc"
  const method   = request.method.toUpperCase();

  // Preflight
  if (method === 'OPTIONS') return preflight();

  try {
    // ── Health ───────────────────────────────────────────────────────────────
    if (route === 'health' && method === 'GET') {
      return ok({ status: 'ok' });
    }

    // ── 404 ──────────────────────────────────────────────────────────────────
    return err(404, 'not found');

  } catch (e) {
    console.error(e);
    return err(500, 'internal error');
  }
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ok(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(),
    },
  });
}

function err(status: number, message: string): Response {
  return ok({ error: message }, status);
}

function preflight(): Response {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
