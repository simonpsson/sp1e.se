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
  SPOTIFY_CLIENT_ID: string;
  SPOTIFY_CLIENT_SECRET: string;
  SPOTIFY_REDIRECT_URI: string;
}

type Row = Record<string, unknown>;

const SAFE_TABLES = new Set(['notes', 'snippets', 'bookmarks', 'files']);

// Reject the checked-in emergency hash so misconfigured deployments fail loudly.
const KNOWN_FALLBACK_HASH = 'pbkdf2:100000:26e4335528b9f68528debae265f5e48f:cf80806a2013a029e1b07a79ce51be94be9fec26a5e1506a08320f950ce86476';

const DEFAULT_CATEGORIES = [
  { id: 'power-bi',   name: 'Power BI',   icon: '⚡', sortOrder: 1 },
  { id: 'sql',        name: 'SQL',        icon: '🗄️', sortOrder: 2 },
  { id: 'python',     name: 'Python',     icon: '🐍', sortOrder: 3 },
  { id: 'databricks', name: 'Databricks', icon: '🧱', sortOrder: 4 },
  { id: 'dokument',   name: 'Dokument',   icon: '📄', sortOrder: 5 },
  { id: 'bilder',     name: 'Bilder',     icon: '🖼️', sortOrder: 6 },
  { id: 'bokmarken',  name: 'Bokmärken',  icon: '🔗', sortOrder: 7 },
] as const;

const DEFAULT_SUBCATEGORIES = [
  { id: 'power-bi-dax',         categoryId: 'power-bi',   name: 'DAX',           sortOrder: 1 },
  { id: 'power-bi-power-query', categoryId: 'power-bi',   name: 'Power Query',   sortOrder: 2 },
  { id: 'power-bi-filer',       categoryId: 'power-bi',   name: 'Filer',         sortOrder: 3 },
  { id: 'power-bi-ovrigt',      categoryId: 'power-bi',   name: 'Övrigt',        sortOrder: 4 },
  { id: 'sql-queries',          categoryId: 'sql',        name: 'Queries',       sortOrder: 1 },
  { id: 'sql-snippets',         categoryId: 'sql',        name: 'Snippets',      sortOrder: 2 },
  { id: 'sql-ovrigt',           categoryId: 'sql',        name: 'Övrigt',        sortOrder: 3 },
  { id: 'python-scripts',       categoryId: 'python',     name: 'Scripts',       sortOrder: 1 },
  { id: 'python-notebooks',     categoryId: 'python',     name: 'Notebooks',     sortOrder: 2 },
  { id: 'python-pyspark',       categoryId: 'python',     name: 'PySpark',       sortOrder: 3 },
  { id: 'python-ovrigt',        categoryId: 'python',     name: 'Övrigt',        sortOrder: 4 },
  { id: 'databricks-notebooks', categoryId: 'databricks', name: 'Notebooks',     sortOrder: 1 },
  { id: 'databricks-config',    categoryId: 'databricks', name: 'Konfiguration', sortOrder: 2 },
  { id: 'databricks-ovrigt',    categoryId: 'databricks', name: 'Övrigt',        sortOrder: 3 },
  { id: 'dokument-rapporter',   categoryId: 'dokument',   name: 'Rapporter',     sortOrder: 1 },
  { id: 'dokument-anteckningar', categoryId: 'dokument',  name: 'Anteckningar',  sortOrder: 2 },
  { id: 'dokument-mallar',      categoryId: 'dokument',   name: 'Mallar',        sortOrder: 3 },
  { id: 'dokument-ovrigt',      categoryId: 'dokument',   name: 'Övrigt',        sortOrder: 4 },
  { id: 'bilder-screenshots',   categoryId: 'bilder',     name: 'Screenshots',   sortOrder: 1 },
  { id: 'bilder-diagram',       categoryId: 'bilder',     name: 'Diagram',       sortOrder: 2 },
  { id: 'bilder-ovrigt',        categoryId: 'bilder',     name: 'Övrigt',        sortOrder: 3 },
  { id: 'bokmarken-verktyg',    categoryId: 'bokmarken',  name: 'Verktyg',       sortOrder: 1 },
  { id: 'bokmarken-artiklar',   categoryId: 'bokmarken',  name: 'Artiklar',      sortOrder: 2 },
  { id: 'bokmarken-referens',   categoryId: 'bokmarken',  name: 'Referens',      sortOrder: 3 },
  { id: 'bokmarken-ovrigt',     categoryId: 'bokmarken',  name: 'Övrigt',        sortOrder: 4 },
] as const;

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

    if (resource === 'auth' && id === 'debug' && method === 'GET') {
      const raw    = env.AUTH_PASSWORD_HASH ?? '';
      const config = inspectPasswordHash(raw);

      // D1 health: verify sessions table exists
      let d1Status = 'unknown';
      try {
        await env.DB.prepare('SELECT 1 FROM sessions LIMIT 1').first();
        d1Status = 'sessions table ok';
      } catch (e: unknown) {
        d1Status = `error: ${e instanceof Error ? e.message : String(e)}`;
      }

      return json({
        hashExists:        raw.length > 0,
        hashLength:        raw.length,
        normalizedLen:     config.value.length,
        hasWhitespace:     raw !== raw.trim() || /[\n\r\t ]/.test(raw),
        hasVarPrefix:      config.hasVarPrefix,
        hasWrappingQuotes: config.hasWrappingQuotes,
        formatValid:       config.isValid,
        isKnownFallback:   config.isKnownFallback,
        hashUsable:        config.isUsable,
        d1:                d1Status,
        envKeys:           Object.keys(env),
      });
    }

    if (resource === 'auth') {
      if (id === 'login'  && method === 'POST') return handleLogin(request, env);
      if (id === 'logout' && method === 'POST') return handleLogout(request, env);
      if (id === 'check'  && method === 'GET')  return handleCheck(request, env);
      return json({ error: 'not found' }, 404);
    }

    // ── Public: art gallery proxy (no auth, 1-hour cache) ───────────────────
    if (resource === 'art' && !id && method === 'GET') {
      return getArtworks();
    }

    // ── Public: all public items (no auth) ──────────────────────────────────
    if (resource === 'gallery' && id === 'impressionism' && method === 'GET') {
      return getImpressionistGallery();
    }

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

    // ── Spotify OAuth ─────────────────────────────────────────────────────────
    if (resource === 'spotify') {
      if (id === 'login'        && method === 'GET')  return handleSpotifyLogin(request, env);
      if (id === 'callback'     && method === 'GET')  return handleSpotifyCallback(request, env, url);
      if (id === 'token'        && method === 'GET')  return handleSpotifyToken(request, env);
      if (id === 'now-playing'  && method === 'GET') {
        if (!checkNowPlayingRateLimit(request)) return json({ error: 'rate limit exceeded' }, 429);
        return handleSpotifyNowPlaying(env);
      }
      if (id === 'disconnect'   && method === 'POST') return handleSpotifyDisconnect(request, env);
      return json({ error: 'not found' }, 404);
    }

    // ── Protected (all routes below require a valid session) ─────────────────
    await requireAuth(request, env);

    if (resource === 'search' && method === 'GET') return searchItems(url, env);
    if (resource === 'seed'   && !id && method === 'GET') return seedDefaults(env);
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
  try {
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
  } catch (err) {
    return dbError('Failed to load categories', err);
  }
}

async function getCategory(catId: string, url: URL, env: Env): Promise<Response> {
  try {
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
  } catch (err) {
    return dbError('Failed to load category', err);
  }
}

async function getRecent(env: Env): Promise<Response> {
  try {
    const r = await env.DB.prepare(`
      SELECT 'note'     AS type, n.id, n.title,             n.created_at, NULL        AS extra, c.name AS category_name
      FROM notes n
      LEFT JOIN subcategories sc ON sc.id = n.subcategory_id
      LEFT JOIN categories c ON c.id = sc.category_id
      UNION ALL
      SELECT 'snippet'  AS type, s.id, s.title,             s.created_at, s.language  AS extra, c.name AS category_name
      FROM snippets s
      LEFT JOIN subcategories sc ON sc.id = s.subcategory_id
      LEFT JOIN categories c ON c.id = sc.category_id
      UNION ALL
      SELECT 'file'     AS type, f.id, f.filename AS title, f.created_at, f.mime_type AS extra, c.name AS category_name
      FROM files f
      LEFT JOIN subcategories sc ON sc.id = f.subcategory_id
      LEFT JOIN categories c ON c.id = sc.category_id
      UNION ALL
      SELECT 'bookmark' AS type, b.id, b.title,             b.created_at, b.url       AS extra, c.name AS category_name
      FROM bookmarks b
      LEFT JOIN subcategories sc ON sc.id = b.subcategory_id
      LEFT JOIN categories c ON c.id = sc.category_id
      ORDER BY created_at DESC
      LIMIT 10
    `).all<Row>();
    return json({ items: r.results });
  } catch (err) {
    return dbError('Failed to load recent items', err);
  }
}

async function seedDefaults(env: Env): Promise<Response> {
  try {
    const categoryValues = DEFAULT_CATEGORIES.flatMap(({ id, name, icon, sortOrder }) => [id, name, icon, sortOrder]);
    const subcategoryValues = DEFAULT_SUBCATEGORIES.flatMap(({ id, categoryId, name, sortOrder }) => [id, categoryId, name, sortOrder]);

    await env.DB.batch([
      env.DB.prepare(`
        INSERT OR IGNORE INTO categories (id, name, icon, sort_order)
        VALUES ${DEFAULT_CATEGORIES.map(() => '(?, ?, ?, ?)').join(', ')}
      `).bind(...categoryValues),
      env.DB.prepare(`
        INSERT OR IGNORE INTO subcategories (id, category_id, name, sort_order)
        VALUES ${DEFAULT_SUBCATEGORIES.map(() => '(?, ?, ?, ?)').join(', ')}
      `).bind(...subcategoryValues),
    ]);

    return json({
      seeded: true,
      categories: DEFAULT_CATEGORIES.length,
      subcategories: DEFAULT_SUBCATEGORIES.length,
    });
  } catch (err) {
    return dbError('Failed to seed default categories', err);
  }
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

// Stream a file from R2 (or D1 base64 fallback) to the client.
async function downloadFile(id: string, request: Request, env: Env): Promise<Response> {
  const row = await env.DB
    .prepare('SELECT r2_key, filename, mime_type, is_public, data FROM files WHERE id = ?')
    .bind(id)
    .first<{ r2_key: string; filename: string; mime_type: string; is_public: number; data: string | null }>();
  if (!row) return json({ error: 'not found' }, 404);
  if (!row.is_public) await requireAuth(request, env);

  const headers = new Headers();
  headers.set('Content-Type', row.mime_type || 'application/octet-stream');
  headers.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(row.filename)}`);
  headers.set('Cache-Control', 'private, max-age=3600');

  // Serve from D1 base64 fallback if R2 was unavailable at upload time.
  if (row.data) {
    const binary = atob(row.data);
    const bytes  = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Response(bytes.buffer, { headers });
  }

  const obj = await env.FILES.get(row.r2_key);
  if (!obj) return json({ error: 'file not found in storage' }, 404);
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

async function getImpressionistGallery(): Promise<Response> {
  const res = await fetch('https://api.artic.edu/api/v1/artworks/search', {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      q: 'impressionism',
      query: {
        bool: {
          must: [
            { term: { is_public_domain: true } },
            { exists: { field: 'image_id' } },
            { term: { classification_title: 'painting' } },
          ],
        },
      },
      fields: ['id', 'title', 'artist_title', 'date_display', 'image_id', 'thumbnail'],
      limit: 50,
    }),
  });

  if (!res.ok) {
    return json({ error: 'gallery upstream failed' }, 502);
  }

  const data = await res.json() as { data?: Row[] };
  const items = (data.data ?? []).filter((item) => item.image_id);

  return new Response(JSON.stringify({ items }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
      ...cors(),
    },
  });
}

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

  // Buffer the file so we can fall back to D1 base64 if R2 is unavailable.
  const arrayBuffer = await file.arrayBuffer();
  let base64Data: string | null = null;

  try {
    await env.FILES.put(r2Key, arrayBuffer, {
      httpMetadata: { contentType: file.type || 'application/octet-stream' },
    });
  } catch {
    // R2 unavailable — fall back to D1 base64 for small files (≤1 MB).
    if (file.size > 1 * 1024 * 1024) {
      return json({ error: 'R2 storage unavailable and file exceeds 1 MB D1 fallback limit' }, 503);
    }
    const bytes = new Uint8Array(arrayBuffer);
    let bin = '';
    for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
    base64Data = btoa(bin);
  }

  await env.DB.prepare(
    `INSERT INTO files (id, filename, r2_key, size, mime_type, subcategory_id, tags, is_public, data, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, file.name, r2Key, file.size, file.type || 'application/octet-stream',
    subcategoryId, tagsRaw, isPublic, base64Data, now).run();

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

// ─── Art gallery proxy ────────────────────────────────────────────────────────

// In-memory cache: reused across requests within the same Worker instance.
let artCache: { data: unknown; expires: number } | null = null;

async function getArtworks(): Promise<Response> {
  const now = Date.now();
  if (artCache && now < artCache.expires) {
    return json(artCache.data);
  }

  const res = await fetch('https://api.artic.edu/api/v1/artworks/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': 'sp1e.se/1.0 (gallery)',
      'AIC-User-Agent': 'sp1e.se/1.0 (gallery)',
    },
    body: JSON.stringify({
      q: 'impressionism',
      query: { bool: { must: [
        { term:   { is_public_domain: true } },
        { exists: { field: 'image_id'       } },
      ]}},
      fields: ['id', 'title', 'artist_title', 'date_display', 'image_id'],
      limit: 50,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    console.error(`[gallery] AIC ${res.status}:`, errText.slice(0, 300));
    return json({ error: 'upstream error', status: res.status }, 502);
  }

  const data = await res.json();
  artCache = { data, expires: now + 60 * 60 * 1000 }; // cache 1 hour
  return json(data);
}

// ─── Spotify rate limiter (in-memory, resets on redeploy) ────────────────────
// Limits /api/spotify/now-playing to 60 req/min per IP.
const _rlMap = new Map<string, { count: number; resetAt: number }>();

function checkNowPlayingRateLimit(request: Request): boolean {
  const ip  = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const now = Date.now();
  const rl  = _rlMap.get(ip);
  if (!rl || now > rl.resetAt) {
    _rlMap.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (rl.count >= 60) return false;
  rl.count++;
  return true;
}

// ─── Spotify OAuth ────────────────────────────────────────────────────────────

// Requires site auth; redirects to Spotify authorization page.
async function handleSpotifyLogin(request: Request, env: Env): Promise<Response> {
  await requireAuth(request, env);

  const state = crypto.randomUUID();
  const params = new URLSearchParams({
    client_id:     env.SPOTIFY_CLIENT_ID,
    response_type: 'code',
    redirect_uri:  env.SPOTIFY_REDIRECT_URI,
    state,
    scope: 'user-read-currently-playing user-read-playback-state',
  });

  const stateCookie = `spotify_oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/api/spotify/callback; Max-Age=600`;
  return new Response(null, {
    status: 302,
    headers: {
      'Location':   `https://accounts.spotify.com/authorize?${params}`,
      'Set-Cookie': stateCookie,
    },
  });
}

// No site auth — cross-site redirect from Spotify. Verifies state cookie.
async function handleSpotifyCallback(request: Request, env: Env, url: URL): Promise<Response> {
  const code  = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  if (error) return new Response(null, { status: 302, headers: { 'Location': '/?spotify=denied' } });
  if (!code || !state) return json({ error: 'missing code or state' }, 400);

  const cookieState = getCookie(request, 'spotify_oauth_state');
  if (!cookieState || cookieState !== state) {
    return json({ error: 'state mismatch — possible CSRF' }, 403);
  }

  // Exchange authorization code for tokens.
  const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
    method:  'POST',
    headers: {
      'Content-Type':  'application/x-www-form-urlencoded',
      'Authorization': `Basic ${spotifyBasicAuth(env)}`,
    },
    body: new URLSearchParams({
      grant_type:   'authorization_code',
      code,
      redirect_uri: env.SPOTIFY_REDIRECT_URI,
    }),
  });

  if (!tokenRes.ok) {
    const text = await tokenRes.text().catch(() => '');
    console.error('[spotify] token exchange failed:', text);
    return new Response(null, { status: 302, headers: { 'Location': '/?spotify=error' } });
  }

  const tokens = await tokenRes.json() as {
    access_token: string; refresh_token: string; expires_in: number;
  };

  const expiresAt = Math.floor(Date.now() / 1000) + tokens.expires_in;
  const now       = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO spotify_tokens (id, access_token, refresh_token, expires_at, updated_at)
     VALUES ('main', ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       access_token = excluded.access_token,
       refresh_token = excluded.refresh_token,
       expires_at = excluded.expires_at,
       updated_at = excluded.updated_at`
  ).bind(tokens.access_token, tokens.refresh_token, expiresAt, now).run();

  const resHeaders = new Headers({ 'Location': '/?spotify=linked' });
  resHeaders.append('Set-Cookie', 'spotify_oauth_state=; HttpOnly; Secure; SameSite=Lax; Path=/api/spotify/callback; Max-Age=0');
  resHeaders.append('Set-Cookie', 'spotify_linked=1; Secure; SameSite=Strict; Path=/; Max-Age=31536000');
  return new Response(null, { status: 302, headers: resHeaders });
}

// Protected — returns a valid access token (refreshes if expired).
async function handleSpotifyToken(request: Request, env: Env): Promise<Response> {
  await requireAuth(request, env);
  const token = await getValidSpotifyToken(env);
  if (!token) return json({ error: 'not linked' }, 404);
  return json({ access_token: token });
}

// Public — returns what is currently playing on Spotify.
async function handleSpotifyNowPlaying(env: Env): Promise<Response> {
  const token = await getValidSpotifyToken(env);
  if (!token) return json({ is_playing: false });

  const res = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
    headers: { 'Authorization': `Bearer ${token}` },
  });

  if (res.status === 204 || res.status === 404) return json({ is_playing: false });
  if (!res.ok) return json({ is_playing: false });

  const data = await res.json() as {
    is_playing: boolean;
    progress_ms?: number;
    item?: {
      name: string;
      duration_ms: number;
      external_urls: { spotify: string };
      artists: Array<{ name: string }>;
      album: { name: string; images: Array<{ url: string }> };
    };
  };

  if (!data.is_playing || !data.item) return json({ is_playing: false });

  return json({
    is_playing:    true,
    track_name:    data.item.name,
    artist_name:   data.item.artists.map(a => a.name).join(', '),
    album_name:    data.item.album.name,
    album_art_url: data.item.album.images[0]?.url ?? null,
    duration_ms:   data.item.duration_ms,
    progress_ms:   data.progress_ms ?? 0,
    track_url:     data.item.external_urls.spotify,
  });
}

// Protected — removes stored tokens and clears the linked cookie.
async function handleSpotifyDisconnect(request: Request, env: Env): Promise<Response> {
  await requireAuth(request, env);
  await env.DB.prepare(`DELETE FROM spotify_tokens WHERE id = 'main'`).run().catch(() => {});
  const discHeaders = new Headers({
    'Content-Type': 'application/json',
    ...cors(),
  });
  discHeaders.append('Set-Cookie', 'spotify_linked=; Secure; SameSite=Strict; Path=/; Max-Age=0');
  return new Response(JSON.stringify({ success: true }), { status: 200, headers: discHeaders });
}

// ─── Spotify helpers ──────────────────────────────────────────────────────────

async function getValidSpotifyToken(env: Env): Promise<string | null> {
  const row = await env.DB
    .prepare(`SELECT access_token, refresh_token, expires_at FROM spotify_tokens WHERE id = 'main'`)
    .first<{ access_token: string; refresh_token: string; expires_at: number }>();
  if (!row) return null;

  // Refresh if expiring within 60 seconds.
  if (row.expires_at < Math.floor(Date.now() / 1000) + 60) {
    return refreshSpotifyToken(env, row.refresh_token);
  }
  return row.access_token;
}

async function refreshSpotifyToken(env: Env, refreshToken: string): Promise<string | null> {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type':  'application/x-www-form-urlencoded',
      'Authorization': `Basic ${spotifyBasicAuth(env)}`,
    },
    body: new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    console.error('[spotify] refresh failed:', res.status);
    return null;
  }

  const tokens = await res.json() as {
    access_token: string; refresh_token?: string; expires_in: number;
  };

  const expiresAt = Math.floor(Date.now() / 1000) + tokens.expires_in;
  const now       = new Date().toISOString();

  await env.DB.prepare(
    `UPDATE spotify_tokens SET
       access_token = ?,
       refresh_token = COALESCE(?, refresh_token),
       expires_at = ?,
       updated_at = ?
     WHERE id = 'main'`
  ).bind(tokens.access_token, tokens.refresh_token ?? null, expiresAt, now).run();

  return tokens.access_token;
}

function spotifyBasicAuth(env: Env): string {
  return btoa(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`);
}

// ─── Auth handlers ────────────────────────────────────────────────────────────

async function handleLogin(request: Request, env: Env): Promise<Response> {
  let body: { password?: string };
  try { body = await request.json(); }
  catch { return json({ error: 'invalid JSON' }, 400); }

  if (!body.password || typeof body.password !== 'string') {
    return json({ error: 'password required' }, 400);
  }
  const hashConfig = inspectPasswordHash(env.AUTH_PASSWORD_HASH);
  if (!hashConfig.isUsable) {
    console.error('AUTH_PASSWORD_HASH is missing or invalid');
    return json({ error: 'auth not configured' }, 500);
  }

  const valid = await verifyPassword(body.password, hashConfig.value);
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
    const parsed = parsePasswordHash(stored);
    if (!parsed) return false;
    const km = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
    );
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: fromHex(parsed.saltHex), iterations: parsed.iterations, hash: 'SHA-256' }, km, 256
    );
    return constantTimeEqual(toHex(new Uint8Array(bits)), parsed.hashHex);
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

function dbError(error: string, err: unknown, status = 500): Response {
  return json({ error, details: errorMessage(err) }, status);
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

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try { return JSON.stringify(err); }
  catch { return String(err); }
}

function inspectPasswordHash(raw: string | undefined): {
  value: string;
  hasVarPrefix: boolean;
  hasWrappingQuotes: boolean;
  isValid: boolean;
  isKnownFallback: boolean;
  isUsable: boolean;
} {
  const { value, hasVarPrefix, hasWrappingQuotes } = normalizePasswordHash(raw);
  const parsed = parsePasswordHash(value);
  const canonical = parsed
    ? `pbkdf2:${parsed.iterations}:${parsed.saltHex}:${parsed.hashHex}`
    : value;

  return {
    value: canonical,
    hasVarPrefix,
    hasWrappingQuotes,
    isValid: !!parsed,
    isKnownFallback: canonical === KNOWN_FALLBACK_HASH,
    isUsable: !!parsed && canonical !== KNOWN_FALLBACK_HASH,
  };
}

function normalizePasswordHash(raw: string | undefined): {
  value: string;
  hasVarPrefix: boolean;
  hasWrappingQuotes: boolean;
} {
  let value = raw?.trim() ?? '';
  let hasVarPrefix = false;
  let hasWrappingQuotes = false;

  for (;;) {
    let changed = false;
    const strippedPrefix = value.replace(/^AUTH_PASSWORD_HASH\s*=\s*/, '');
    if (strippedPrefix !== value) {
      hasVarPrefix = true;
      value = strippedPrefix.trim();
      changed = true;
    }

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      hasWrappingQuotes = true;
      value = value.slice(1, -1).trim();
      changed = true;
    }

    if (!changed) break;
  }

  return { value, hasVarPrefix, hasWrappingQuotes };
}

function parsePasswordHash(stored: string): {
  iterations: number;
  saltHex: string;
  hashHex: string;
} | null {
  const parts = stored.split(':').map(p => p.trim());
  if (parts.length !== 4) return null;

  const [algo, iterStr, saltHexRaw, hashHexRaw] = parts;
  if (algo.toLowerCase() !== 'pbkdf2') return null;

  const iterations = parseInt(iterStr, 10);
  if (!Number.isInteger(iterations) || iterations < 1) return null;

  const saltHex = saltHexRaw.toLowerCase();
  const hashHex = hashHexRaw.toLowerCase();
  if (!isHexString(saltHex) || !isHexString(hashHex)) return null;

  return { iterations, saltHex, hashHex };
}

function isHexString(value: string): boolean {
  return value.length > 0 && value.length % 2 === 0 && /^[0-9a-f]+$/i.test(value);
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
