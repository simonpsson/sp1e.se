/**
 * sp1e.se API — Cloudflare Pages Function (catch-all /api/*)
 *
 * Password hashing: PBKDF2-SHA256 (100 000 iterations) via Web Crypto.
 * bcrypt is unavailable in Workers without an npm build step.
 * Generate AUTH_PASSWORD_HASH with: node scripts/hash-password.js "password"
 */

export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  AUTH_PASSWORD_HASH: string;
}

type Row = Record<string, unknown>;

const SAFE_TABLES = new Set(['notes', 'snippets', 'bookmarks', 'files']);

// ─── Entry point ──────────────────────────────────────────────────────────────

export const onRequest: PagesFunction<Env> = async (ctx) => {
  const { request, params, env } = ctx;
  const route  = ((params.route as string[]) ?? []).join('/');
  const method = request.method.toUpperCase();
  const url    = new URL(request.url);

  if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });

  const [resource = '', id = '', sub = ''] = route.split('/');

  try {
    // ── Unprotected ──────────────────────────────────────────────────────────
    if (resource === 'health' && !id && method === 'GET') return json({ status: 'ok' });

    if (resource === 'auth') {
      if (id === 'login'  && method === 'POST') return handleLogin(request, env);
      if (id === 'logout' && method === 'POST') return handleLogout(request, env);
      if (id === 'check'  && method === 'GET')  return handleCheck(request, env);
      return json({ error: 'not found' }, 404);
    }

    // ── Public: all public items (no auth) ──────────────────────────────────
    if (resource === 'public' && id === 'items' && method === 'GET') {
      return getPublicItems(env);
    }

    // ── Public GET for notes / snippets (is_public check inside) ────────────
    if ((resource === 'notes' || resource === 'snippets') && id && method === 'GET') {
      return getNoteOrSnippet(resource, id, request, env);
    }

    // ── Public GET for files (metadata + download) ───────────────────────────
    if (resource === 'files' && id && id !== 'upload') {
      if (!sub && method === 'GET')              return getPublicItem('files',     id, request, env);
      if (sub === 'download' && method === 'GET') return downloadFile(id, request, env);
    }

    // ── Public GET for bookmarks ─────────────────────────────────────────────
    if (resource === 'bookmarks' && id && id !== 'fetch-meta' && method === 'GET') {
      return getPublicItem('bookmarks', id, request, env);
    }

    // ── Protected (all routes below require a valid session) ─────────────────
    await requireAuth(request, env);

    if (resource === 'search' && method === 'GET') return searchItems(url, env);
    if (resource === 'tags'   && !id && method === 'GET') return getTags(env);
    if (resource === 'items'  && !id && method === 'GET') return getItemsByTags(url, env);
    if (resource === 'export' && !id && method === 'GET') return exportAll(env);

    if (resource === 'categories') {
      if (!id && method === 'GET') return getCategories(env);
      if (id  && method === 'GET') return getCategory(id, url, env);
    }

    if (resource === 'recent' && !id && method === 'GET') return getRecent(env);

    if (resource === 'notes') {
      if (!id && method === 'POST')                          return createItem('notes',    request, env, NOTE_FIELDS);
      if (id  && method === 'DELETE')                        return deleteItem('notes',    id, env);
      if (id  && (method === 'PATCH' || method === 'PUT'))   return updateItem('notes',    id, request, env, NOTE_FIELDS);
    }

    if (resource === 'snippets') {
      if (!id && method === 'POST')                          return createItem('snippets', request, env, SNIPPET_FIELDS);
      if (id  && method === 'DELETE')                        return deleteItem('snippets', id, env);
      if (id  && (method === 'PATCH' || method === 'PUT'))   return updateItem('snippets', id, request, env, SNIPPET_FIELDS);
    }

    if (resource === 'bookmarks') {
      if (id === 'fetch-meta'     && method === 'POST') return fetchBookmarkMeta(request);
      if (!id                     && method === 'POST') return createItem('bookmarks', request, env, BOOKMARK_FIELDS);
      if (id                      && method === 'DELETE') return deleteItem('bookmarks', id, env);
      if (id && (method === 'PATCH' || method === 'PUT')) return updateItem('bookmarks', id, request, env, BOOKMARK_FIELDS);
    }

    if (resource === 'files') {
      if (id === 'upload' && method === 'POST')   return uploadFile(request, env);
      if (id && !sub && method === 'DELETE')      return deleteFile(id, env);
    }

    return json({ error: 'not found' }, 404);

  } catch (err) {
    if (err instanceof AuthError) return json({ error: 'Unauthorized' }, 401);
    console.error(err);
    return json({ error: 'internal error' }, 500);
  }
};

// ─── Category handlers ────────────────────────────────────────────────────────

async function getCategories(env: Env): Promise<Response> {
  const [cats, subs, counts] = await Promise.all([
    env.DB.prepare('SELECT * FROM categories ORDER BY sort_order').all<Row>(),
    env.DB.prepare('SELECT * FROM subcategories ORDER BY category_id, sort_order').all<Row>(),
    env.DB.prepare(`
      SELECT sc.category_id, COUNT(*) AS cnt
      FROM (
        SELECT subcategory_id FROM notes     WHERE subcategory_id IS NOT NULL
        UNION ALL
        SELECT subcategory_id FROM files     WHERE subcategory_id IS NOT NULL
        UNION ALL
        SELECT subcategory_id FROM snippets  WHERE subcategory_id IS NOT NULL
        UNION ALL
        SELECT subcategory_id FROM bookmarks WHERE subcategory_id IS NOT NULL
      ) AS all_items
      JOIN subcategories sc ON sc.id = all_items.subcategory_id
      GROUP BY sc.category_id
    `).all<{ category_id: string; cnt: number }>(),
  ]);

  const cntMap = new Map(counts.results.map(r => [r.category_id, r.cnt]));

  const subMap = new Map<string, Row[]>();
  for (const s of subs.results) {
    const cid = s.category_id as string;
    if (!subMap.has(cid)) subMap.set(cid, []);
    subMap.get(cid)!.push(s);
  }

  return json({
    categories: cats.results.map(c => ({
      ...c,
      subcategories: subMap.get(c.id as string) ?? [],
      item_count:    cntMap.get(c.id as string)  ?? 0,
    })),
  });
}

async function getCategory(catId: string, url: URL, env: Env): Promise<Response> {
  const subcatFilter = url.searchParams.get('subcategory');
  const typeFilter   = url.searchParams.get('type');    // note|snippet|file|bookmark

  const [cat, subs] = await Promise.all([
    env.DB.prepare('SELECT * FROM categories WHERE id = ?').bind(catId).first<Row>(),
    env.DB.prepare('SELECT * FROM subcategories WHERE category_id = ? ORDER BY sort_order')
          .bind(catId).all<Row>(),
  ]);

  if (!cat) return json({ error: 'not found' }, 404);

  const allSubcatIds = subs.results.map(s => s.id as string);
  const activeIds    = subcatFilter ? [subcatFilter] : allSubcatIds;

  if (activeIds.length === 0) {
    return json({ category: cat, subcategories: subs.results, items: [] });
  }

  const ph   = activeIds.map(() => '?').join(',');
  const want = typeFilter ? [typeFilter] : ['note', 'snippet', 'file', 'bookmark'];

  const [notes, snippets, files, bookmarks] = await Promise.all([
    want.includes('note')
      ? env.DB.prepare(`SELECT *, 'note' AS type FROM notes WHERE subcategory_id IN (${ph}) ORDER BY created_at DESC`)
              .bind(...activeIds).all<Row>()
      : { results: [] as Row[] },
    want.includes('snippet')
      ? env.DB.prepare(`SELECT *, 'snippet' AS type FROM snippets WHERE subcategory_id IN (${ph}) ORDER BY created_at DESC`)
              .bind(...activeIds).all<Row>()
      : { results: [] as Row[] },
    want.includes('file')
      ? env.DB.prepare(`SELECT *, 'file' AS type FROM files WHERE subcategory_id IN (${ph}) ORDER BY created_at DESC`)
              .bind(...activeIds).all<Row>()
      : { results: [] as Row[] },
    want.includes('bookmark')
      ? env.DB.prepare(`SELECT *, 'bookmark' AS type FROM bookmarks WHERE subcategory_id IN (${ph}) ORDER BY created_at DESC`)
              .bind(...activeIds).all<Row>()
      : { results: [] as Row[] },
  ]);

  const items = [
    ...notes.results,
    ...snippets.results,
    ...files.results,
    ...bookmarks.results,
  ].sort((a, b) =>
    (b.created_at as string).localeCompare(a.created_at as string)
  );

  return json({ category: cat, subcategories: subs.results, items });
}

async function getRecent(env: Env): Promise<Response> {
  const r = await env.DB.prepare(`
    SELECT 'note'     AS type, id, title,    created_at, NULL     AS extra FROM notes
    UNION ALL
    SELECT 'snippet'  AS type, id, title,    created_at, language AS extra FROM snippets
    UNION ALL
    SELECT 'file'     AS type, id, filename  AS title, created_at, mime_type AS extra FROM files
    UNION ALL
    SELECT 'bookmark' AS type, id, title,    created_at, url      AS extra FROM bookmarks
    ORDER BY created_at DESC
    LIMIT 10
  `).all<Row>();
  return json({ items: r.results });
}

async function searchItems(url: URL, env: Env): Promise<Response> {
  const q = (url.searchParams.get('q') ?? '').trim();
  if (!q) return json({ results: [] });
  const like = `%${q}%`;

  const [notes, snippets, files, bookmarks] = await Promise.all([
    env.DB.prepare(`
      SELECT 'note' AS type, id, title,
        CASE WHEN title LIKE ? THEN 0 ELSE 1 END AS rel,
        substr(content, 1, 200) AS preview, created_at, subcategory_id
      FROM notes WHERE title LIKE ? OR content LIKE ?
      ORDER BY rel, created_at DESC LIMIT 8
    `).bind(like, like, like).all<Row>(),
    env.DB.prepare(`
      SELECT 'snippet' AS type, id, title,
        CASE WHEN title LIKE ? THEN 0 ELSE 1 END AS rel,
        substr(COALESCE(description, code), 1, 200) AS preview, created_at, subcategory_id
      FROM snippets WHERE title LIKE ? OR code LIKE ? OR description LIKE ?
      ORDER BY rel, created_at DESC LIMIT 8
    `).bind(like, like, like, like).all<Row>(),
    env.DB.prepare(`
      SELECT 'file' AS type, id, filename AS title,
        CASE WHEN filename LIKE ? THEN 0 ELSE 1 END AS rel,
        mime_type AS preview, created_at, subcategory_id
      FROM files WHERE filename LIKE ?
      ORDER BY rel, created_at DESC LIMIT 8
    `).bind(like, like).all<Row>(),
    env.DB.prepare(`
      SELECT 'bookmark' AS type, id, title,
        CASE WHEN title LIKE ? THEN 0 ELSE 1 END AS rel,
        COALESCE(description, url) AS preview, created_at, subcategory_id
      FROM bookmarks WHERE title LIKE ? OR url LIKE ? OR description LIKE ?
      ORDER BY rel, created_at DESC LIMIT 8
    `).bind(like, like, like, like).all<Row>(),
  ]);

  const all: Row[] = [
    ...notes.results, ...snippets.results, ...files.results, ...bookmarks.results,
  ];

  // Resolve subcategory breadcrumbs
  const subcatIds = [...new Set(all.map(r => r.subcategory_id as string).filter(Boolean))];
  let subcatMap = new Map<string, { name: string; category_id: string; cat_name: string }>();
  if (subcatIds.length) {
    const ph = subcatIds.map(() => '?').join(',');
    const subs = await env.DB.prepare(
      `SELECT sc.id, sc.name, sc.category_id, c.name AS cat_name
       FROM subcategories sc JOIN categories c ON c.id = sc.category_id
       WHERE sc.id IN (${ph})`
    ).bind(...subcatIds).all<{ id: string; name: string; category_id: string; cat_name: string }>();
    subcatMap = new Map(subs.results.map(s => [s.id, s]));
  }

  const results = all
    .sort((a, b) =>
      (a.rel as number) - (b.rel as number) ||
      (b.created_at as string).localeCompare(a.created_at as string)
    )
    .slice(0, 20)
    .map(r => ({
      ...r,
      breadcrumb: r.subcategory_id ? (subcatMap.get(r.subcategory_id as string) ?? null) : null,
    }));

  return json({ results });
}

async function getPublicItems(env: Env): Promise<Response> {
  const [notes, snippets, files, bookmarks] = await Promise.all([
    env.DB.prepare(`
      SELECT 'note' AS type, n.id, n.title, n.created_at, n.tags, n.updated_at,
             sc.name AS subcategory_name, c.id AS category_id,
             c.name AS category_name, c.icon AS category_icon
      FROM notes n
      LEFT JOIN subcategories sc ON sc.id = n.subcategory_id
      LEFT JOIN categories c ON c.id = sc.category_id
      WHERE n.is_public = 1 ORDER BY n.created_at DESC
    `).all<Row>(),
    env.DB.prepare(`
      SELECT 'snippet' AS type, s.id, s.title, s.created_at, s.tags, s.language,
             sc.name AS subcategory_name, c.id AS category_id,
             c.name AS category_name, c.icon AS category_icon
      FROM snippets s
      LEFT JOIN subcategories sc ON sc.id = s.subcategory_id
      LEFT JOIN categories c ON c.id = sc.category_id
      WHERE s.is_public = 1 ORDER BY s.created_at DESC
    `).all<Row>(),
    env.DB.prepare(`
      SELECT 'file' AS type, f.id, f.filename AS title, f.created_at, f.tags,
             f.mime_type, f.size, f.r2_key,
             sc.name AS subcategory_name, c.id AS category_id,
             c.name AS category_name, c.icon AS category_icon
      FROM files f
      LEFT JOIN subcategories sc ON sc.id = f.subcategory_id
      LEFT JOIN categories c ON c.id = sc.category_id
      WHERE f.is_public = 1 ORDER BY f.created_at DESC
    `).all<Row>(),
    env.DB.prepare(`
      SELECT 'bookmark' AS type, b.id, b.title, b.url, b.favicon_url,
             b.description, b.created_at, b.tags,
             sc.name AS subcategory_name, c.id AS category_id,
             c.name AS category_name, c.icon AS category_icon
      FROM bookmarks b
      LEFT JOIN subcategories sc ON sc.id = b.subcategory_id
      LEFT JOIN categories c ON c.id = sc.category_id
      WHERE b.is_public = 1 ORDER BY b.created_at DESC
    `).all<Row>(),
  ]);

  const items = [
    ...notes.results, ...snippets.results, ...files.results, ...bookmarks.results,
  ].sort((a, b) => (b.created_at as string).localeCompare(a.created_at as string));

  return json({ items });
}

async function getTags(env: Env): Promise<Response> {
  const result = await env.DB.prepare(`
    SELECT value AS tag, COUNT(*) AS cnt
    FROM (
      SELECT je.value FROM notes     n, json_each(n.tags)     je WHERE n.tags     IS NOT NULL AND n.tags     != '[]'
      UNION ALL
      SELECT je.value FROM snippets  s, json_each(s.tags)     je WHERE s.tags     IS NOT NULL AND s.tags     != '[]'
      UNION ALL
      SELECT je.value FROM files     f, json_each(f.tags)     je WHERE f.tags     IS NOT NULL AND f.tags     != '[]'
      UNION ALL
      SELECT je.value FROM bookmarks b, json_each(b.tags)     je WHERE b.tags     IS NOT NULL AND b.tags     != '[]'
    )
    GROUP BY value ORDER BY cnt DESC, value ASC
  `).all<{ tag: string; cnt: number }>();
  return json({ tags: result.results });
}

async function getItemsByTags(url: URL, env: Env): Promise<Response> {
  const tagsParam = url.searchParams.get('tags') ?? '';
  const tags = tagsParam.split(',').map(t => t.trim()).filter(Boolean);
  if (!tags.length) return json({ items: [] });

  const ph = tags.map(() => '?').join(',');
  const n  = tags.length;

  // AND logic: item must contain ALL requested tags
  const tagFilter = (col: string) =>
    `(SELECT COUNT(DISTINCT je.value) FROM json_each(${col}) je WHERE je.value IN (${ph})) = ?`;

  const [notes, snippets, files, bookmarks] = await Promise.all([
    env.DB.prepare(`
      SELECT 'note' AS type, n.id, n.title, n.created_at, n.tags, n.updated_at, n.is_public,
             sc.name AS subcategory_name, c.id AS category_id, c.name AS category_name, c.icon AS category_icon
      FROM notes n
      LEFT JOIN subcategories sc ON sc.id = n.subcategory_id
      LEFT JOIN categories c ON c.id = sc.category_id
      WHERE ${tagFilter('n.tags')}
      ORDER BY n.created_at DESC
    `).bind(...tags, n).all<Row>(),
    env.DB.prepare(`
      SELECT 'snippet' AS type, s.id, s.title, s.created_at, s.tags, s.language, s.is_public,
             sc.name AS subcategory_name, c.id AS category_id, c.name AS category_name, c.icon AS category_icon
      FROM snippets s
      LEFT JOIN subcategories sc ON sc.id = s.subcategory_id
      LEFT JOIN categories c ON c.id = sc.category_id
      WHERE ${tagFilter('s.tags')}
      ORDER BY s.created_at DESC
    `).bind(...tags, n).all<Row>(),
    env.DB.prepare(`
      SELECT 'file' AS type, f.id, f.filename AS title, f.created_at, f.tags, f.mime_type, f.is_public,
             sc.name AS subcategory_name, c.id AS category_id, c.name AS category_name, c.icon AS category_icon
      FROM files f
      LEFT JOIN subcategories sc ON sc.id = f.subcategory_id
      LEFT JOIN categories c ON c.id = sc.category_id
      WHERE ${tagFilter('f.tags')}
      ORDER BY f.created_at DESC
    `).bind(...tags, n).all<Row>(),
    env.DB.prepare(`
      SELECT 'bookmark' AS type, b.id, b.title, b.url, b.created_at, b.tags, b.is_public,
             sc.name AS subcategory_name, c.id AS category_id, c.name AS category_name, c.icon AS category_icon
      FROM bookmarks b
      LEFT JOIN subcategories sc ON sc.id = b.subcategory_id
      LEFT JOIN categories c ON c.id = sc.category_id
      WHERE ${tagFilter('b.tags')}
      ORDER BY b.created_at DESC
    `).bind(...tags, n).all<Row>(),
  ]);

  const items = [
    ...notes.results, ...snippets.results, ...files.results, ...bookmarks.results,
  ].sort((a, b) => (b.created_at as string).localeCompare(a.created_at as string));

  return json({ items });
}

async function exportAll(env: Env): Promise<Response> {
  const [notes, snippets, bookmarks, files] = await Promise.all([
    env.DB.prepare(`
      SELECT n.*, c.name AS category_name, sc.name AS subcategory_name
      FROM notes n
      LEFT JOIN subcategories sc ON sc.id = n.subcategory_id
      LEFT JOIN categories c    ON c.id  = sc.category_id
      ORDER BY c.name NULLS LAST, n.title
    `).all<Row>(),
    env.DB.prepare(`
      SELECT s.*, c.name AS category_name, sc.name AS subcategory_name
      FROM snippets s
      LEFT JOIN subcategories sc ON sc.id = s.subcategory_id
      LEFT JOIN categories c    ON c.id  = sc.category_id
      ORDER BY c.name NULLS LAST, s.title
    `).all<Row>(),
    env.DB.prepare(`SELECT * FROM bookmarks ORDER BY created_at DESC`).all<Row>(),
    env.DB.prepare(`
      SELECT f.id, f.filename, f.mime_type, f.size, f.r2_key, f.is_public, f.created_at,
             c.name AS category_name, sc.name AS subcategory_name
      FROM files f
      LEFT JOIN subcategories sc ON sc.id = f.subcategory_id
      LEFT JOIN categories c    ON c.id  = sc.category_id
      ORDER BY c.name NULLS LAST, f.filename
    `).all<Row>(),
  ]);
  return json({
    exported_at: new Date().toISOString(),
    notes:       notes.results,
    snippets:    snippets.results,
    bookmarks:   bookmarks.results,
    files:       files.results,
  });
}

async function getItem(table: string, id: string, env: Env): Promise<Response> {
  if (!SAFE_TABLES.has(table)) return json({ error: 'not found' }, 404);
  const row = await env.DB.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(id).first<Row>();
  if (!row) return json({ error: 'not found' }, 404);
  return json(row);
}

// Returns note or snippet with subcategory_name + category_id joined in.
// Enforces auth only when is_public = 0.
async function getNoteOrSnippet(
  table: string, id: string, request: Request, env: Env
): Promise<Response> {
  if (!SAFE_TABLES.has(table)) return json({ error: 'not found' }, 404);
  const row = await env.DB.prepare(`
    SELECT t.*, sc.name AS subcategory_name, sc.category_id
    FROM ${table} t
    LEFT JOIN subcategories sc ON sc.id = t.subcategory_id
    WHERE t.id = ?
  `).bind(id).first<Row>();
  if (!row) return json({ error: 'not found' }, 404);
  if (!row.is_public) await requireAuth(request, env);
  return json(row);
}

// Generic public-aware GET — enforces auth only when is_public = 0.
async function getPublicItem(table: string, id: string, request: Request, env: Env): Promise<Response> {
  if (!SAFE_TABLES.has(table)) return json({ error: 'not found' }, 404);
  const row = await env.DB.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(id).first<Row>();
  if (!row) return json({ error: 'not found' }, 404);
  if (!row.is_public) await requireAuth(request, env);
  return json(row);
}

// Stream a file from R2 to the client.
async function downloadFile(id: string, request: Request, env: Env): Promise<Response> {
  const row = await env.DB
    .prepare('SELECT r2_key, filename, mime_type, is_public FROM files WHERE id = ?')
    .bind(id)
    .first<{ r2_key: string; filename: string; mime_type: string; is_public: number }>();
  if (!row) return json({ error: 'not found' }, 404);
  if (!row.is_public) await requireAuth(request, env);

  const obj = await env.FILES.get(row.r2_key);
  if (!obj) return json({ error: 'file not found in storage' }, 404);

  const headers = new Headers();
  headers.set('Content-Type', row.mime_type || 'application/octet-stream');
  headers.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(row.filename)}`);
  headers.set('Cache-Control', 'private, max-age=3600');
  return new Response(obj.body, { headers });
}

// Fetch page title + favicon from an external URL (best-effort).
async function fetchBookmarkMeta(request: Request): Promise<Response> {
  let body: { url?: string };
  try { body = await request.json(); }
  catch { return json({ title: '', favicon_url: '' }); }
  if (!body.url || typeof body.url !== 'string') return json({ title: '', favicon_url: '' });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(body.url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; sp1e-meta/1.0)', 'Accept': 'text/html,*/*' },
      signal: controller.signal,
      redirect: 'follow',
    });
    clearTimeout(timer);

    const ct = res.headers.get('Content-Type') ?? '';
    if (!ct.includes('text/html')) return json({ title: '', favicon_url: '' });

    const html = await res.text();

    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch
      ? titleMatch[1].replace(/&amp;/g,'&').replace(/&#39;/g,"'").replace(/&quot;/g,'"')
          .replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/\s+/g,' ').trim()
      : '';

    let favicon_url = '';
    const iconRe = /<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]+href=["']([^"']+)["']|<link[^>]+href=["']([^"']+)["'][^>]+rel=["'][^"']*icon[^"']*["']/i;
    const iconMatch = html.match(iconRe);
    const rawIcon = iconMatch?.[1] ?? iconMatch?.[2] ?? '';
    if (rawIcon) {
      try { favicon_url = new URL(rawIcon, body.url).toString(); } catch {}
    }
    if (!favicon_url) {
      try { const u = new URL(body.url); favicon_url = `${u.protocol}//${u.host}/favicon.ico`; } catch {}
    }

    return json({ title, favicon_url });
  } catch {
    clearTimeout(timer);
    return json({ title: '', favicon_url: '' });
  }
}

// ─── Generic CRUD ─────────────────────────────────────────────────────────────

type FieldDef = [name: string, required: boolean, transform?: (v: unknown) => unknown];

const NOTE_FIELDS: FieldDef[] = [
  ['title',          true],
  ['content',        false],
  ['subcategory_id', false],
  ['tags',           false, v => JSON.stringify(Array.isArray(v) ? v : [])],
  ['is_public',      false, v => (v ? 1 : 0)],
  ['is_pinned',      false, v => (v ? 1 : 0)],
];

const SNIPPET_FIELDS: FieldDef[] = [
  ['title',          true],
  ['language',       true],
  ['code',           false],
  ['description',    false],
  ['subcategory_id', false],
  ['tags',           false, v => JSON.stringify(Array.isArray(v) ? v : [])],
  ['is_public',      false, v => (v ? 1 : 0)],
];

const BOOKMARK_FIELDS: FieldDef[] = [
  ['title',          true],
  ['url',            true],
  ['description',    false],
  ['subcategory_id', false],
  ['tags',           false, v => JSON.stringify(Array.isArray(v) ? v : [])],
  ['favicon_url',    false],
  ['is_public',      false, v => (v ? 1 : 0)],
];

async function createItem(
  table: string, request: Request, env: Env, fields: FieldDef[]
): Promise<Response> {
  if (!SAFE_TABLES.has(table)) return json({ error: 'not found' }, 404);

  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return json({ error: 'invalid JSON' }, 400); }

  for (const [name, required] of fields) {
    if (required && !body[name]) return json({ error: `${name} is required` }, 400);
  }

  const id  = crypto.randomUUID();
  const now = new Date().toISOString();
  const hasUpdatedAt = table === 'notes' || table === 'snippets';

  const cols = ['id', ...fields.map(([n]) => n), 'created_at', ...(hasUpdatedAt ? ['updated_at'] : [])];
  const vals: unknown[] = [id];

  for (const [name, , transform] of fields) {
    const v = body[name] ?? null;
    vals.push(transform ? transform(v ?? []) : v);
  }
  vals.push(now);
  if (hasUpdatedAt) vals.push(now);

  await env.DB
    .prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
    .bind(...vals)
    .run();

  return json({ id, success: true }, 201);
}

async function updateItem(
  table: string, id: string, request: Request, env: Env, fields: FieldDef[]
): Promise<Response> {
  if (!SAFE_TABLES.has(table)) return json({ error: 'not found' }, 404);

  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return json({ error: 'invalid JSON' }, 400); }

  const sets: string[]    = [];
  const vals: unknown[] = [];

  for (const [name, , transform] of fields) {
    if (!(name in body)) continue;
    sets.push(`${name} = ?`);
    const v = body[name];
    vals.push(transform ? transform(v) : v);
  }

  if (sets.length === 0) return json({ error: 'nothing to update' }, 400);

  if (table === 'notes' || table === 'snippets') {
    sets.push('updated_at = ?');
    vals.push(new Date().toISOString());
  }
  vals.push(id);

  await env.DB
    .prepare(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...vals)
    .run();

  return json({ success: true });
}

async function deleteItem(table: string, id: string, env: Env): Promise<Response> {
  if (!SAFE_TABLES.has(table)) return json({ error: 'not found' }, 404);
  await env.DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(id).run();
  return json({ success: true });
}

// ─── File upload ──────────────────────────────────────────────────────────────

async function uploadFile(request: Request, env: Env): Promise<Response> {
  let formData: FormData;
  try { formData = await request.formData(); }
  catch { return json({ error: 'expected multipart form data' }, 400); }

  const file = formData.get('file') as File | null;
  if (!file) return json({ error: 'file is required' }, 400);
  if (file.size > 25 * 1024 * 1024) return json({ error: 'File exceeds 25 MB limit' }, 413);

  const id            = crypto.randomUUID();
  const ext           = file.name.includes('.') ? '.' + file.name.split('.').pop() : '';
  const r2Key         = `${id}${ext}`;
  const subcategoryId = (formData.get('subcategory_id') as string) || null;
  const tagsRaw       = (formData.get('tags') as string) || '[]';
  const isPublic      = formData.get('is_public') === '1' ? 1 : 0;
  const now           = new Date().toISOString();

  await env.FILES.put(r2Key, file.stream(), {
    httpMetadata: { contentType: file.type || 'application/octet-stream' },
  });

  await env.DB.prepare(
    `INSERT INTO files (id, filename, r2_key, size, mime_type, subcategory_id, tags, is_public, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, file.name, r2Key, file.size, file.type || 'application/octet-stream',
    subcategoryId, tagsRaw, isPublic, now).run();

  return json({ id, success: true }, 201);
}

async function deleteFile(id: string, env: Env): Promise<Response> {
  const row = await env.DB
    .prepare('SELECT r2_key FROM files WHERE id = ?')
    .bind(id)
    .first<{ r2_key: string }>();

  if (row?.r2_key) {
    await env.FILES.delete(row.r2_key).catch(() => { /* ignore R2 errors */ });
  }
  await env.DB.prepare('DELETE FROM files WHERE id = ?').bind(id).run();
  return json({ success: true });
}

// ─── Auth handlers ────────────────────────────────────────────────────────────

async function handleLogin(request: Request, env: Env): Promise<Response> {
  let body: { password?: string };
  try { body = await request.json(); }
  catch { return json({ error: 'invalid JSON' }, 400); }

  if (!body.password || typeof body.password !== 'string') {
    return json({ error: 'password required' }, 400);
  }
  if (!env.AUTH_PASSWORD_HASH) {
    console.error('AUTH_PASSWORD_HASH not set');
    return json({ error: 'auth not configured' }, 500);
  }

  const valid = await verifyPassword(body.password, env.AUTH_PASSWORD_HASH);
  if (!valid) {
    await sleep(200 + Math.random() * 200);
    return json({ error: 'Wrong password' }, 401);
  }

  const token     = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await env.DB
    .prepare('INSERT INTO sessions (token, expires_at) VALUES (?, ?)')
    .bind(token, expiresAt.toISOString())
    .run();

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': sessionCookie(token, expiresAt), ...cors() },
  });
}

async function handleLogout(request: Request, env: Env): Promise<Response> {
  const token = getCookie(request, 'session');
  if (token) {
    await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run().catch(() => {});
  }
  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': clearCookie(), ...cors() },
  });
}

async function handleCheck(request: Request, env: Env): Promise<Response> {
  const token = getCookie(request, 'session');
  if (!token) return json({ authenticated: false });
  const session = await env.DB
    .prepare(`SELECT token FROM sessions WHERE token = ? AND expires_at > datetime('now')`)
    .bind(token).first();
  return json({ authenticated: !!session });
}

export async function requireAuth(request: Request, env: Env): Promise<void> {
  const token = getCookie(request, 'session');
  if (!token) throw new AuthError();
  const row = await env.DB
    .prepare(`SELECT token FROM sessions WHERE token = ? AND expires_at > datetime('now')`)
    .bind(token).first();
  if (!row) throw new AuthError();
}

class AuthError extends Error {
  constructor() { super('Unauthorized'); }
}

// ─── PBKDF2 ───────────────────────────────────────────────────────────────────

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const parts = stored.trim().split(':');
    if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
    const [, iterStr, saltHex, storedHash] = parts.map(p => p.trim());
    const iterations = parseInt(iterStr, 10);
    if (!iterations) return false;
    const km = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
    );
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: fromHex(saltHex), iterations, hash: 'SHA-256' }, km, 256
    );
    return constantTimeEqual(toHex(new Uint8Array(bits)), storedHash);
  } catch { return false; }
}

// ─── Cookie helpers ───────────────────────────────────────────────────────────

function getCookie(request: Request, name: string): string | null {
  const header = request.headers.get('Cookie') ?? '';
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq !== -1 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

function sessionCookie(token: string, expires: Date): string {
  return `session=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Expires=${expires.toUTCString()}`;
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
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function toHex(b: Uint8Array): string {
  return Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array {
  return new Uint8Array((hex.match(/.{2}/g) ?? []).map(b => parseInt(b, 16)));
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
