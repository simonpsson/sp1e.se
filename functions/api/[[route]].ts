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
      return getArtworks(env);
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

    // ── Artworks (list/get public; write ops require auth) ───────────────────
    if (resource === 'artworks') {
      if (!id && method === 'GET')                        return listArtworks(url, env);
      if (id === 'fetch-redon'  && method === 'GET')      { await requireAuth(request, env); return fetchRedon(env); }
      if (id === 'import'       && method === 'POST')     { await requireAuth(request, env); return importArtworks(request, env); }
      if (id && sub === 'favorite' && method === 'PUT')   { await requireAuth(request, env); return toggleFavorite(id, env); }
      if (id && !sub && method === 'GET')                 return getArtwork(id, env);
      if (id && !sub && method === 'DELETE')              { await requireAuth(request, env); return deleteArtwork(id, env); }
      return json({ error: 'not found' }, 404);
    }

    // ── DAX import (one-shot, idempotent) ────────────────────────────────────
    if (resource === 'import-dax' && !id && method === 'GET') {
      await requireAuth(request, env);
      return importDaxMeasures(env);
    }

    // ── Game (Mosquito) — own session cookie, no site auth ───────────────────
    if (resource === 'game') {
      if (id === 'create-character' && method === 'POST') return gameCreateCharacter(request, env);
      if (id === 'player'           && method === 'GET')  return gameGetPlayer(request, env);
      if (id === 'status'           && method === 'GET')  return gameGetStatus(request, env);
      if (id === 'drug-prices'      && method === 'GET')  return gameGetDrugPrices();
      if (id === 'npcs'             && method === 'GET')  return gameGetNpcs(env);
      if (id === 'simulate'         && method === 'GET')  return gameSimulate(env);
      if (id === 'hall-of-fame'     && method === 'GET')  return gameHallOfFame(env);
      if (id === 'new-round'        && method === 'POST') return gameNewRound(env);
      if (id === 'action') {
        if (sub === 'robbery'          && method === 'POST') return gameActionRobbery(request, env);
        if (sub === 'train'            && method === 'POST') return gameActionTrain(request, env);
        if (sub === 'drug-deal'        && method === 'POST') return gameActionDrugDeal(request, env);
        if (sub === 'assault'          && method === 'POST') return gameActionAssault(request, env);
        if (sub === 'prison-escape'    && method === 'POST') return gameActionPrisonEscape(request, env);
        if (sub === 'hospital'         && method === 'POST') return gameActionHospital(request, env);
        if (sub === 'bank'             && method === 'POST') return gameActionBank(request, env);
        if (sub === 'buy-property'     && method === 'POST') return gameActionBuyProperty(request, env);
        if (sub === 'collect-income'   && method === 'POST') return gameActionCollectIncome(request, env);
        if (sub === 'choose-profession'&& method === 'POST') return gameActionChooseProfession(request, env);
        if (sub === 'buy-vehicle'      && method === 'POST') return gameActionBuyVehicle(request, env);
        if (sub === 'race'             && method === 'POST') return gameActionRace(request, env);
      }
      return json({ error: 'not found' }, 404);
    }

    // ── Spotify ───────────────────────────────────────────────────────────────
    if (resource === 'spotify') {
      if (id === 'auth-url'    && method === 'GET')  return handleSpotifyAuthUrl(request, env);
      if (id === 'exchange'    && method === 'POST') return handleSpotifyExchange(request, env);
      if (id === 'now-playing' && method === 'GET') {
        if (!checkNowPlayingRateLimit(request)) return json({ error: 'rate limit exceeded' }, 429);
        return handleSpotifyNowPlaying(env);
      }
      if (id === 'play'        && method === 'PUT')  return handleSpotifyControl('play', request, env);
      if (id === 'pause'       && method === 'PUT')  return handleSpotifyControl('pause', request, env);
      if (id === 'next'        && method === 'POST') return handleSpotifyControl('next', request, env);
      if (id === 'previous'    && method === 'POST') return handleSpotifyControl('previous', request, env);
      if (id === 'disconnect'  && method === 'POST') return handleSpotifyDisconnect(request, env);
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
      if (id === 'bulk' && method === 'POST')                      { await requireAuth(request, env); return bulkCreateSnippets(request, env); }
      if (!id && method === 'POST')                                return createItem('snippets', request, env, SNIPPET_FIELDS);
      if (id  && method === 'DELETE')                              return deleteItem('snippets', id, env);
      if (id  && (method === 'PATCH' || method === 'PUT'))         return updateItem('snippets', id, request, env, SNIPPET_FIELDS);
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

    const ph     = activeIds.map(() => '?').join(',');
    const want   = typeFilter
      ? typeFilter.split(',').filter(t => ['note','snippet','file','bookmark'].includes(t))
      : ['note', 'snippet', 'file', 'bookmark'];
    const search = url.searchParams.get('search')?.trim() ?? '';
    const sLike  = search ? `%${search}%` : null;

    const [notes, snippets, files, bookmarks] = await Promise.all([
      want.includes('note')
        ? env.DB.prepare(`SELECT *, 'note' AS type FROM notes WHERE subcategory_id IN (${ph})${sLike ? ' AND (title LIKE ? OR content LIKE ?)' : ''} ORDER BY updated_at DESC`)
                .bind(...activeIds, ...(sLike ? [sLike, sLike] : [])).all<Row>()
        : { results: [] as Row[] },
      want.includes('snippet')
        ? env.DB.prepare(`SELECT *, 'snippet' AS type FROM snippets WHERE subcategory_id IN (${ph})${sLike ? ' AND (title LIKE ? OR code LIKE ?)' : ''} ORDER BY updated_at DESC`)
                .bind(...activeIds, ...(sLike ? [sLike, sLike] : [])).all<Row>()
        : { results: [] as Row[] },
      want.includes('file')
        ? env.DB.prepare(`SELECT *, 'file' AS type FROM files WHERE subcategory_id IN (${ph})${sLike ? ' AND filename LIKE ?' : ''} ORDER BY created_at DESC`)
                .bind(...activeIds, ...(sLike ? [sLike] : [])).all<Row>()
        : { results: [] as Row[] },
      want.includes('bookmark')
        ? env.DB.prepare(`SELECT *, 'bookmark' AS type FROM bookmarks WHERE subcategory_id IN (${ph})${sLike ? ' AND (title LIKE ? OR url LIKE ?)' : ''} ORDER BY created_at DESC`)
                .bind(...activeIds, ...(sLike ? [sLike, sLike] : [])).all<Row>()
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
let artCache: { items: Row[]; expires: number } | null = null;

const ART_SEARCHES: Array<{ q: string; limit: number }> = [
  { q: 'impressionism',         limit: 20 },
  { q: 'Hilma af Klint',        limit: 20 },
  { q: 'Gustav Klimt',          limit: 20 },
  { q: 'Odilon Redon',          limit: 20 },
  { q: 'Claude Monet',          limit: 20 },
  { q: 'symbolism painting',    limit: 10 },
  { q: 'art nouveau painting',  limit: 10 },
  { q: 'post-impressionism',    limit: 10 },
];

async function fetchArtSearch(q: string, limit: number): Promise<Row[]> {
  const res = await fetch('https://api.artic.edu/api/v1/artworks/search', {
    method: 'POST',
    headers: {
      'Content-Type':    'application/json',
      'Accept':          'application/json',
      'User-Agent':      'sp1e.se/1.0 (gallery)',
      'AIC-User-Agent':  'sp1e.se/1.0 (gallery)',
    },
    body: JSON.stringify({
      q,
      query: { bool: { must: [
        { term:   { is_public_domain: true } },
        { exists: { field: 'image_id'      } },
      ]}},
      fields: ['id', 'title', 'artist_title', 'date_display', 'image_id', 'style_titles'],
      limit,
    }),
  });
  if (!res.ok) {
    console.error(`[gallery] AIC "${q}" ${res.status}`);
    return [];
  }
  const body = await res.json() as { data?: Row[] };
  return (body.data ?? []).filter(r => r.image_id);
}

async function getArtworks(env: Env): Promise<Response> {
  const now = Date.now();

  // AIC items are cached for 2 hours (external API calls are expensive).
  let aicItems: Row[];
  if (artCache && now < artCache.expires) {
    aicItems = artCache.items;
  } else {
    // Fetch all searches in parallel; ignore individual failures.
    const results = await Promise.all(
      ART_SEARCHES.map(({ q, limit }) => fetchArtSearch(q, limit).catch(() => [] as Row[]))
    );
    // Deduplicate by id.
    const seen = new Set<unknown>();
    aicItems = [];
    for (const batch of results) {
      for (const row of batch) {
        if (!seen.has(row.id)) { seen.add(row.id); aicItems.push(row); }
      }
    }
    artCache = { items: aicItems, expires: now + 2 * 60 * 60 * 1000 };
  }

  // D1 artworks: fetch up to 20 public artworks (fresh each request — fast local query).
  let d1Items: Row[] = [];
  try {
    const r = await env.DB.prepare(
      `SELECT id, title, artist, date_display, image_url FROM artworks
       WHERE is_public = 1 AND image_url IS NOT NULL
       ORDER BY RANDOM() LIMIT 20`
    ).all<Row>();
    d1Items = r.results.map(a => ({
      id:           a.id,
      title:        a.title,
      artist_title: a.artist,
      date_display: a.date_display,
      image_id:     null,
      image_url:    a.image_url,
    }));
  } catch { /* D1 unavailable or empty — degrade gracefully */ }

  // Combine AIC + D1, then shuffle.
  const items = [...aicItems, ...d1Items];
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }

  return json({ data: items });
}

// ─── Game (Mosquito) ─────────────────────────────────────────────────────────

const GAME_COOKIE = 'game_session';

// ── helpers ──────────────────────────────────────────────────────────────────

function getGameCookie(request: Request): string | null {
  const cookie = request.headers.get('Cookie') ?? '';
  const match  = cookie.match(/(?:^|;\s*)game_session=([^;]+)/);
  return match ? match[1] : null;
}

function setGameCookie(playerId: string): string {
  return `${GAME_COOKIE}=${playerId}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${60 * 60 * 24 * 30}`;
}

async function requireGamePlayer(request: Request, env: Env): Promise<Row> {
  const pid = getGameCookie(request);
  if (!pid) throw new GameError('No active character. Create one first.', 401);
  const player = await env.DB.prepare('SELECT * FROM game_players WHERE id = ?').bind(pid).first<Row>();
  if (!player) throw new GameError('Character not found.', 404);

  // Round isolation: if the active round changed, the old-round session is dead.
  // Read-only endpoints (gameGetPlayer) bypass this by not calling requireGamePlayer.
  const round = await getActiveRound(env);
  if (round && (player.round_id as string) !== (round.id as string)) {
    throw new GameError('Rundan har avslutats. Starta en ny karaktär för nästa runda.', 409);
  }

  // Auto-clear expired prison / hospital so players can't get permanently stuck.
  const now = Date.now();
  const clearPrison   = player.in_prison   && player.prison_until   && new Date(player.prison_until   as string).getTime() <= now;
  const clearHospital = player.in_hospital && player.hospital_until && new Date(player.hospital_until as string).getTime() <= now;
  if (clearPrison || clearHospital) {
    const setParts: string[] = [];
    if (clearPrison)   setParts.push('in_prison = 0, prison_until = NULL');
    if (clearHospital) setParts.push('in_hospital = 0, hospital_until = NULL');
    await env.DB.prepare(`UPDATE game_players SET ${setParts.join(', ')} WHERE id = ?`).bind(pid).run();
    // Return fresh copy so callers see the cleared flags.
    return (await env.DB.prepare('SELECT * FROM game_players WHERE id = ?').bind(pid).first<Row>())!;
  }

  return player;
}

function gameJson(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors() },
  });
}

class GameError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

/** Recalculate energy based on time elapsed since last_regen. */
function calcEnergy(player: Row): number {
  const max       = (player.energy_max as number) ?? 100;
  const stored    = (player.energy as number) ?? 0;
  if (stored >= max) return max;
  const lastRegen = new Date((player.energy_last_regen as string) ?? new Date().toISOString());
  const elapsed   = (Date.now() - lastRegen.getTime()) / 1000 / 60; // minutes
  const regained  = Math.floor(elapsed / 3); // 1 energy per 3 minutes
  return Math.min(max, stored + regained);
}

/** Update stored energy + reset regen clock. */
async function updateEnergy(env: Env, playerId: string, currentEnergy: number, cost: number): Promise<number> {
  const newEnergy = currentEnergy - cost;
  await env.DB.prepare(
    `UPDATE game_players SET energy = ?, energy_last_regen = datetime('now') WHERE id = ?`
  ).bind(newEnergy, playerId).run();
  return newEnergy;
}

function getActiveRound(env: Env): Promise<Row | null> {
  return env.DB.prepare(`SELECT * FROM game_rounds WHERE is_active = 1 ORDER BY round_number DESC LIMIT 1`).first<Row>();
}

function rand(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** XP required to advance FROM level N to N+1 = N * 1000. */
function levelFromXp(xp: number): number {
  let lvl = 1, needed = 0;
  while (lvl < 50) { needed += lvl * 1000; if (xp < needed) break; lvl++; }
  return lvl;
}

const ROBBERY_LEVEL_REQS: Record<string, number> = {
  shoplift: 1, pickpocket: 1, car_breakin: 3, gas_station: 5,
  house: 8, jewelry: 10, bank: 15, casino: 20, federal_reserve: 30,
};

function profBonus(profession: string, key: string): number {
  const map: Record<string, Record<string, number>> = {
    rånare:   { robbery_cash: 0.30, prison_time: -0.20 },
    langare:  { drug_profit: 0.25 },
    torped:   { assault_damage: 0.30, hp_max: 0.20 },
    hallick:  { property_income: 0.40 },
    bedragare:{ all_stats: 0.20, xp_gain: 0.15 },
  };
  return map[profession]?.[key] ?? 0;
}

async function logAction(
  env: Env, playerId: string, actionType: string,
  description: string, cashChange: number, respectChange: number, xpChange: number, success: boolean
): Promise<void> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO game_action_log (id, player_id, action_type, description, cash_change, respect_change, xp_change, success)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, playerId, actionType, description, cashChange, respectChange, xpChange, success ? 1 : 0).run();
}

// ── ROBBERY config ────────────────────────────────────────────────────────────

const ROBBERY_TARGETS: Record<string, {
  label: string; minCash: number; maxCash: number; energy: number;
  baseChance: number; prisonChance: number; respect: number; xp: number;
}> = {
  shoplift:       { label: 'Snattar godis',         minCash: 50,     maxCash: 200,     energy: 5,  baseChance: 90, prisonChance: 5,  respect: 1,  xp: 10  },
  pickpocket:     { label: 'Ficktjuvar en turist',   minCash: 100,    maxCash: 400,     energy: 5,  baseChance: 85, prisonChance: 8,  respect: 2,  xp: 15  },
  car_breakin:    { label: 'Bryter sig in i en bil', minCash: 200,    maxCash: 800,     energy: 8,  baseChance: 75, prisonChance: 12, respect: 3,  xp: 25  },
  gas_station:    { label: 'Rånar en bensinmack',    minCash: 500,    maxCash: 2000,    energy: 10, baseChance: 65, prisonChance: 20, respect: 5,  xp: 40  },
  house:          { label: 'Bryter sig in i ett hus',minCash: 1000,   maxCash: 4000,    energy: 12, baseChance: 55, prisonChance: 25, respect: 8,  xp: 60  },
  jewelry:        { label: 'Rånar en juvelbutik',    minCash: 3000,   maxCash: 10000,   energy: 15, baseChance: 40, prisonChance: 35, respect: 15, xp: 100 },
  bank:           { label: 'Rånar en bank',          minCash: 10000,  maxCash: 50000,   energy: 20, baseChance: 25, prisonChance: 45, respect: 30, xp: 200 },
  casino:         { label: 'Rånar ett kasino',       minCash: 50000,  maxCash: 200000,  energy: 25, baseChance: 15, prisonChance: 55, respect: 60, xp: 400 },
  federal_reserve:{ label: 'Rånar riksbanken',       minCash: 200000, maxCash: 1000000, energy: 30, baseChance: 5,  prisonChance: 70, respect: 200,xp: 1000},
};

// Prison sentences in minutes per robbery
const PRISON_SENTENCES: Record<string, number> = {
  shoplift: 5, pickpocket: 8, car_breakin: 12, gas_station: 20,
  house: 25, jewelry: 40, bank: 60, casino: 90, federal_reserve: 120,
};

// ── Flavor text ───────────────────────────────────────────────────────────────

function pickRandom<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }

const ROBBERY_FLAVOR_SUCCESS: Record<string, string[]> = {
  shoplift:       ['Du stoppade ner en Snickers i fickan. Ingen märkte något.',
                   'Kassörskan tittade bort precis lagom. Smooth.',
                   'En hel korg frukt under jackan. Proffsigt.'],
  pickpocket:     ['Du slog till mot en japansk turist. Snyggt drag.',
                   'Tre sekunder och 400 kr. Du är bäst.',
                   'Gamlingen märkte inget. Hans plånbok nu.'],
  car_breakin:    ['Bildörren öppnades med ett litet verktyg. Som att bre smör.',
                   'En BMW låg olåst. Tack för gåvan.',
                   'Handsfacekit och lite kontanter. Inte illa.'],
  gas_station:    ['Du hotade tonåringen bakom kassan med en banan. Det funkade.',
                   'Kassetten drogs ur kameran. Professionellt.',
                   '"Det här är ett rån." "Jaså?" "Ja." Kassainhålltet ditt.'],
  house:          ['Villaägaren var på jobbet. Du var inte.',
                   'Säkerhetssystemet var från 1998. Du var inte.',
                   'Smyckena i lådorna. Smart folk gömmer ingenting.'],
  jewelry:        ['Glasmontern krossades på 4 sekunder. Nytt rekord.',
                   'Diamantringen slank ner i fickan. Glittrigt.',
                   'Butiksägaren låg på golvet och grät. Du sprang.'],
  bank:           ['Du gick in, sa "det här är ett rån", och gick ut med en väska full.',
                   'Banktjänstemännen var hjälpsamma. Väldigt hjälpsamma.',
                   'Valvet stod öppet för lunchservice. Perfekt timing.'],
  casino:         ['Säkerhetsvakten var upptagen med att äta. Du var inte.',
                   'Chipsen byttes mot kontanter i bakdörren.',
                   'VIP-rummet tömt på 90 sekunder. Nytt PB.'],
  federal_reserve:['Sveriges riksbank. Du gick in. Du gick ut. Historien är skriven.',
                   'Nationalbanken. Säkerheten var bra. Din planering bättre.',
                   'Du rånade riksbanken. Nu är du legend.'],
};

const ROBBERY_FLAVOR_FAIL: Record<string, string[]> = {
  shoplift:       ['Kassörskan såg dig. "Jag ringer polansen!" Gripen.',
                   'Du snubblade och tappade allt. Pinsamt.',
                   'Butiksvakten var exakt bakom dig. Typiskt.'],
  pickpocket:     ['Turisten kände handen. Skrek på svenska. Gripen.',
                   'Fel ficka. Där låg bara en gammal kvitto.',
                   'Polis i civilt. Naturligtvis.'],
  car_breakin:    ['Larmet gick. Alla hörde det utom du.',
                   'Grannarna filmade. Lade ut på Facebook.',
                   'Bilen hade dubbellås. Din dag.'],
  gas_station:    ['Polisen tankade precis där. Fel timing.',
                   'Vakten tryckte på larmet med foten.',
                   'Du sprang fel håll. In i stängslet.'],
  house:          ['Husägaren var hemmasjuk. Med sin dobermann.',
                   'Du loggade på grannens WiFi av misstag. Spårad.',
                   'Polispatrullen körde förbi i precis rätt ögonblick.'],
  jewelry:        ['Tränglasset aktiverades. Tre lager stål.',
                   'Smyckena satt fast. Du satt fast.',
                   'Larm direkt till polisen. 3 minuter. Du sprang inte tillräckligt fort.'],
  bank:           ['Larmet gick. Tre polisbilar. Du sprang in i en glasdörr. Gripen.',
                   'Kassan var tom — det var lönedag. Tur att du åkte fast ändå.',
                   'Undercover-detektiven i kön. Typiskt.'],
  casino:         ['Kasinoets säkerhet är i en annan liga. Du fick reda på det.',
                   'Sju kameror. Sju bilder på ditt ansikte.',
                   'Vakterna var fler än gästerna ikväll.'],
  federal_reserve:['SÄPO, militären och hundar. Du klarade inte ens entrén.',
                   'Riksbankens säkerhet är nationell hemlighet. Du förstår varför nu.',
                   'Det gick inte. Gripen. Länge.'],
};

const ASSAULT_WIN_LINES = [
  'Du drog till med en vänsterkrok.',
  '{name} stumlade bakåt.',
  '{name} somnade. Du plockade cash.',
];
const ASSAULT_LOSE_LINES = [
  'Du sprang mot {name}.',
  'Du snubblade på en ölburk.',
  '{name} skrattade. Pinsamt.',
];

// ── Drug prices ───────────────────────────────────────────────────────────────

const DRUG_BASE_PRICES: Record<string, number> = {
  marijuana: 50, cocaine: 300, heroin: 500, ecstasy: 200, meth: 400,
};
const DRUG_NAMES = Object.keys(DRUG_BASE_PRICES);

function getDrugPrice(drug: string): number {
  const idx   = DRUG_NAMES.indexOf(drug);
  const base  = DRUG_BASE_PRICES[drug] ?? 0;
  const cycle = Date.now() / (1000 * 60 * 30);
  const mult  = Math.sin(cycle + idx) * 0.5 + 1; // 0.5–1.5
  return Math.max(1, Math.round(base * mult));
}

function getDrugTrend(drug: string): string {
  const idx   = DRUG_NAMES.indexOf(drug);
  const cycle = Date.now() / (1000 * 60 * 30);
  const now   = Math.sin(cycle + idx);
  const soon  = Math.sin(cycle + idx + 0.05);
  if (soon > now + 0.05) return '\u2191 rising';
  if (soon < now - 0.05) return '\u2193 falling';
  return '\u2192 stable';
}

// ── Route handlers ────────────────────────────────────────────────────────────

async function gameCreateCharacter(request: Request, env: Env): Promise<Response> {
  const round = await getActiveRound(env);
  if (!round) return gameJson({ error: 'No active round. Contact admin.' }, 503);

  const body = await request.json<{ name?: string; side?: string }>().catch(() => ({} as { name?: string; side?: string }));
  const name = (body.name ?? '').trim().slice(0, 24);
  const side = body.side === 'westside' ? 'westside' : 'eastside';

  if (!name || name.length < 2)
    return gameJson({ error: 'Name must be 2–24 characters.' }, 400);
  if (!/^[\w\s\u00C0-\u024F]+$/u.test(name))
    return gameJson({ error: 'Name contains invalid characters.' }, 400);

  // Pre-check to return a clean 409 rather than a raw unique-constraint DB error.
  const existing = await env.DB.prepare(
    `SELECT id FROM game_players WHERE name = ? AND round_id = ?`
  ).bind(name, round.id as string).first();
  if (existing) return gameJson({ error: 'That name is taken. Pick another.' }, 409);

  const pid = crypto.randomUUID();
  try {
    await env.DB.prepare(`INSERT INTO game_players (id, round_id, name, side) VALUES (?, ?, ?, ?)`)
      .bind(pid, round.id as string, name, side).run();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('UNIQUE')) return gameJson({ error: 'That name is taken. Pick another.' }, 409);
    throw e;
  }

  const player = await env.DB.prepare('SELECT * FROM game_players WHERE id = ?').bind(pid).first<Row>();
  return new Response(JSON.stringify({ player }), {
    status: 201,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': setGameCookie(pid),
      ...cors(),
    },
  });
}

async function gameGetPlayer(request: Request, env: Env): Promise<Response> {
  let player: Row;
  try { player = await requireGamePlayer(request, env); }
  catch (e) { return gameJson({ error: (e as GameError).message }, (e as GameError).status ?? 401); }

  const pid     = player.id as string;
  const energy  = calcEnergy(player);

  // Fetch inventory, actions, and properties in parallel
  const [invRes, logRes, propRes] = await Promise.all([
    env.DB.prepare('SELECT * FROM game_inventory WHERE player_id = ?').bind(pid).all<Row>(),
    env.DB.prepare('SELECT * FROM game_action_log WHERE player_id = ? ORDER BY created_at DESC LIMIT 20').bind(pid).all<Row>(),
    env.DB.prepare('SELECT * FROM game_properties WHERE player_id = ?').bind(pid).all<Row>(),
  ]);

  // Prison/hospital time remaining
  const now          = Date.now();
  const prisonUntil  = player.prison_until  ? new Date(player.prison_until  as string).getTime() : null;
  const hospitalUntil= player.hospital_until? new Date(player.hospital_until as string).getTime() : null;

  return gameJson({
    player: { ...player, energy },
    prison_seconds_left:  prisonUntil   ? Math.max(0, Math.floor((prisonUntil   - now) / 1000)) : 0,
    hospital_seconds_left:hospitalUntil ? Math.max(0, Math.floor((hospitalUntil - now) / 1000)) : 0,
    inventory:  invRes.results,
    log:        logRes.results,
    properties: propRes.results,
  });
}

async function gameGetNpcs(env: Env): Promise<Response> {
  const round = await getActiveRound(env);
  if (!round) return gameJson({ npcs: [] });
  const res = await env.DB.prepare(
    `SELECT id, name, level, respect, strength, cash, side, personality, is_alive, hp
     FROM game_npcs WHERE round_id = ? AND is_alive = 1 ORDER BY level DESC LIMIT 30`
  ).bind(round.id as string).all<Row>();
  return gameJson({ npcs: res.results });
}

// ── NPC simulation ────────────────────────────────────────────────────────────

async function gameSimulate(env: Env): Promise<Response> {
  const round = await getActiveRound(env);
  if (!round) return gameJson({ activity: [] });

  // End round if expired
  const endDate = new Date(round.end_date as string).getTime();
  if (Date.now() > endDate) {
    await endRound(env, round);
    return gameJson({ round_ended: true, activity: [] });
  }

  // Pick up to 3 random alive NPCs
  const res = await env.DB.prepare(
    `SELECT * FROM game_npcs WHERE round_id = ? AND is_alive = 1 ORDER BY RANDOM() LIMIT 3`
  ).bind(round.id as string).all<Row>();

  const activity: string[] = [];
  const stmts: D1PreparedStatement[] = [];

  for (const npc of res.results) {
    const lvl  = (npc.level    as number) || 1;
    const roll = Math.random();

    if (roll < 0.50) {
      // Robbery — target scales with NPC level
      const target =
        lvl >= 20 ? 'casino'      :
        lvl >= 15 ? 'bank'        :
        lvl >= 10 ? 'jewelry'     :
        lvl >= 8  ? 'house'       :
        lvl >= 5  ? 'gas_station' :
        lvl >= 3  ? 'car_breakin' : 'pickpocket';
      const cfg = ROBBERY_TARGETS[target];
      if (cfg && Math.random() < 0.65) {
        const cash    = Math.round(rand(cfg.minCash, cfg.maxCash) * 0.70);
        const respect = Math.ceil(cfg.respect * 0.70);
        const newResp = (npc.respect as number) + respect;
        const newLvl  = Math.min(50, Math.floor(Math.sqrt(newResp / 5)) + 1);
        stmts.push(
          env.DB.prepare(`UPDATE game_npcs SET cash = cash + ?, respect = ?, level = ? WHERE id = ?`)
            .bind(cash, newResp, newLvl, npc.id as string)
        );
        activity.push(`${npc.name as string} rånade ${cfg.label} och tjänade ${svNum(cash)} kr.`);
      }
    } else if (roll < 0.70) {
      // Training — silent
      const inc    = rand(1, 2);
      const newStr = Math.min(100, (npc.strength as number) + inc);
      stmts.push(
        env.DB.prepare(`UPDATE game_npcs SET strength = ? WHERE id = ?`).bind(newStr, npc.id as string)
      );
    } else if (roll < 0.85) {
      // Drug deal
      const earnings = Math.round(lvl * rand(200, 600) * 0.70);
      const respect  = Math.ceil(earnings / 400);
      stmts.push(
        env.DB.prepare(`UPDATE game_npcs SET cash = cash + ?, respect = respect + ? WHERE id = ?`)
          .bind(earnings, respect, npc.id as string)
      );
      const drugList = ['marijuana', 'kokain', 'heroin', 'ecstasy'];
      const drug = drugList[Math.floor(Math.random() * drugList.length)];
      activity.push(`${npc.name as string} sålde ${drug} och tjänade ${svNum(earnings)} kr.`);
    } else {
      // Assault another NPC
      const victims = res.results.filter(n => n.id !== npc.id && n.is_alive);
      if (victims.length) {
        const victim  = victims[Math.floor(Math.random() * victims.length)];
        const stolen  = Math.round(((victim.cash as number) || 0) * rand(10, 25) / 100);
        if (stolen > 0) {
          stmts.push(
            env.DB.prepare(`UPDATE game_npcs SET cash = cash + ?, respect = respect + 5 WHERE id = ?`).bind(stolen, npc.id as string),
            env.DB.prepare(`UPDATE game_npcs SET cash = cash - ? WHERE id = ?`).bind(stolen, victim.id as string)
          );
          activity.push(`${npc.name as string} slog ner ${victim.name as string} och stal ${svNum(stolen)} kr.`);
        }
      }
    }
  }

  if (stmts.length) {
    // D1 batch limit is 100; split just in case
    for (let i = 0; i < stmts.length; i += 100) {
      await env.DB.batch(stmts.slice(i, i + 100));
    }
  }

  return gameJson({ activity });
}

function svNum(n: number): string {
  return n.toLocaleString('sv-SE');
}

// ── Round management ──────────────────────────────────────────────────────────

async function endRound(env: Env, round: Row): Promise<boolean> {
  const roundId  = round.id  as string;
  const roundNum = round.round_number as number;

  // Idempotent — check if already archived
  const already = await env.DB.prepare(`SELECT id FROM game_leaderboard WHERE round_id = ? LIMIT 1`)
    .bind(roundId).first();
  if (already) return false;

  const top = await env.DB.prepare(
    `SELECT name, respect, level, cash, profession, side
     FROM game_players WHERE round_id = ? AND is_alive = 1
     ORDER BY respect DESC LIMIT 10`
  ).bind(roundId).all<Row>();

  const stmts = top.results.map((p, i) => {
    const prof = ((p.profession as string) || '').replace('changed:', '') || null;
    return env.DB.prepare(
      `INSERT OR IGNORE INTO game_leaderboard
         (id, round_id, round_number, player_name, final_respect, final_level, final_cash, profession, side, rank)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(crypto.randomUUID(), roundId, roundNum, p.name, p.respect, p.level, p.cash, prof, p.side, i + 1);
  });
  stmts.push(env.DB.prepare(`UPDATE game_rounds SET is_active = 0 WHERE id = ?`).bind(roundId));
  if (stmts.length) await env.DB.batch(stmts);
  return true;
}

async function gameNewRound(env: Env): Promise<Response> {
  // Deactivate any existing active round that has expired
  await env.DB.prepare(
    `UPDATE game_rounds SET is_active = 0 WHERE is_active = 1 AND end_date < date('now')`
  ).run();

  const cur = await env.DB.prepare(`SELECT MAX(round_number) as n FROM game_rounds`).first<{ n: number }>();
  const next = (cur?.n ?? 0) + 1;
  const id   = `round-${String(next).padStart(3, '0')}`;
  await env.DB.prepare(
    `INSERT OR IGNORE INTO game_rounds (id, round_number, start_date, end_date, is_active)
     VALUES (?, ?, date('now'), date('now', '+30 days'), 1)`
  ).bind(id, next).run();
  return gameJson({ round_id: id, round_number: next, message: `Runda ${next} har börjat!` });
}

async function gameHallOfFame(env: Env): Promise<Response> {
  const res = await env.DB.prepare(
    `SELECT round_number, player_name, final_respect, final_level, final_cash, profession, side, rank, created_at
     FROM game_leaderboard ORDER BY round_number DESC, rank ASC LIMIT 100`
  ).all<Row>();

  // Group by round_number
  const rounds: Record<number, Row[]> = {};
  for (const row of res.results) {
    const rn = row.round_number as number;
    if (!rounds[rn]) rounds[rn] = [];
    rounds[rn].push(row);
  }
  return gameJson({ hall_of_fame: rounds });
}

// ── Also integrate round-end check into getStatus ────────────────────────────

async function gameGetStatus(request: Request, env: Env): Promise<Response> {
  const round = await getActiveRound(env);
  if (!round) return gameJson({ round_ended: true, top10: [], player_count: 0 });

  const endDate    = new Date(round.end_date as string).getTime();
  const secondsLeft = Math.max(0, Math.floor((endDate - Date.now()) / 1000));
  const roundEnded  = secondsLeft === 0;

  if (roundEnded) await endRound(env, round);

  const [topRes, countRes] = await Promise.all([
    env.DB.prepare(
      `SELECT name, level, respect, side, profession
       FROM game_players WHERE round_id = ? AND is_alive = 1
       ORDER BY respect DESC LIMIT 10`
    ).bind(round.id as string).all<Row>(),
    env.DB.prepare(
      `SELECT COUNT(*) as cnt FROM game_players WHERE round_id = ? AND is_alive = 1`
    ).bind(round.id as string).first<{ cnt: number }>(),
  ]);

  return gameJson({
    round_ended: roundEnded,
    round: {
      number:       round.round_number,
      start:        round.start_date,
      end:          round.end_date,
      seconds_left: secondsLeft,
    },
    top10:        topRes.results,
    player_count: countRes?.cnt ?? 0,
  });
}

function gameGetDrugPrices(): Response {
  const prices: Record<string, { price: number; trend: string }> = {};
  for (const drug of DRUG_NAMES) {
    prices[drug] = { price: getDrugPrice(drug), trend: getDrugTrend(drug) };
  }
  return gameJson({ prices });
}

async function gameActionRobbery(request: Request, env: Env): Promise<Response> {
  let player: Row;
  try { player = await requireGamePlayer(request, env); }
  catch (e) { return gameJson({ error: (e as GameError).message }, (e as GameError).status ?? 401); }

  const body   = await request.json<{ target?: string }>().catch(() => ({} as { target?: string }));
  const target = body.target ?? '';
  const cfg    = ROBBERY_TARGETS[target];
  if (!cfg) return gameJson({ error: `Unknown target "${target}".` }, 400);

  if (player.in_prison)   return gameJson({ error: 'Du sitter i fängelse.' }, 400);
  if (player.in_hospital) return gameJson({ error: 'Du är på sjukhus.' }, 400);
  if (!player.is_alive)   return gameJson({ error: 'Du är eliminerad.' }, 400);

  const pid          = player.id as string;
  const stealth      = (player.stealth      as number) ?? 10;
  const intelligence = (player.intelligence as number) ?? 10;
  const level        = (player.level        as number) ?? 1;
  const profession   = (player.profession   as string) ?? 'none';

  const levelReq = ROBBERY_LEVEL_REQS[target] ?? 1;
  if (level < levelReq)
    return gameJson({ error: `Kräver level ${levelReq}. Du är level ${level}.` }, 400);

  const energy = calcEnergy(player);
  if (energy < cfg.energy)
    return gameJson({ error: `Not enough energy. Need ${cfg.energy}, have ${energy}.` }, 400);

  const successChance = Math.min(95, cfg.baseChance + stealth * 0.5 + intelligence * 0.3 + level * 2);
  const roll          = Math.random() * 100;
  const success       = roll < successChance;

  let cashGained     = 0;
  let respectGained  = 0;
  let xpGained       = 0;
  let caught         = false;
  let message        = '';
  let prisonMinutes  = 0;

  if (success) {
    cashGained    = rand(cfg.minCash, cfg.maxCash);
    cashGained    = Math.round(cashGained * (1 + profBonus(profession, 'robbery_cash')));
    respectGained = cfg.respect;
    xpGained      = Math.round(cfg.xp * (1 + profBonus(profession, 'xp_gain')));
    const flavorOk = pickRandom(ROBBERY_FLAVOR_SUCCESS[target] ?? [cfg.label + '.']);
    message       = `\u2713 ${flavorOk} +${cashGained.toLocaleString('sv')} kr.`;
  } else {
    // Missed; chance of getting caught
    const caughtRoll = Math.random() * 100;
    caught = caughtRoll < cfg.prisonChance;
    xpGained = Math.floor(cfg.xp * 0.2 * (1 + profBonus(profession, 'xp_gain')));
    const flavorBad = pickRandom(ROBBERY_FLAVOR_FAIL[target] ?? [cfg.label + ' misslyckades.']);
    if (caught) {
      let mins = PRISON_SENTENCES[target] ?? 10;
      mins = Math.max(1, Math.round(mins * (1 + profBonus(profession, 'prison_time'))));
      prisonMinutes = mins;
      message = `\u2717 ${flavorBad} ${prisonMinutes} min i f\u00e4ngelse.`;
    } else {
      message = `\u2717 ${flavorBad} Du lyckades fly.`;
    }
  }

  // Compute new XP + level
  const currentXp  = (player.xp   as number) + xpGained;
  const currentCash = (player.cash as number) + cashGained;
  const newLevel    = levelFromXp(currentXp);

  const newEnergy   = await updateEnergy(env, pid, energy, cfg.energy);

  if (caught) {
    const prisonUntil = new Date(Date.now() + prisonMinutes * 60 * 1000).toISOString();
    await env.DB.prepare(
      `UPDATE game_players SET cash = ?, respect = respect + ?, xp = ?, level = ?,
       in_prison = 1, prison_until = ?, last_action = datetime('now') WHERE id = ?`
    ).bind(currentCash, respectGained, currentXp, newLevel, prisonUntil, pid).run();
  } else {
    await env.DB.prepare(
      `UPDATE game_players SET cash = ?, respect = respect + ?, xp = ?, level = ?,
       last_action = datetime('now') WHERE id = ?`
    ).bind(currentCash, respectGained, currentXp, newLevel, pid).run();
  }

  await logAction(env, pid, 'robbery', message, cashGained, respectGained, xpGained, success);

  return gameJson({
    success, caught, message,
    cash_gained: cashGained, respect_gained: respectGained, xp_gained: xpGained,
    new_cash: currentCash, new_level: newLevel, energy_left: newEnergy,
  });
}

async function gameActionTrain(request: Request, env: Env): Promise<Response> {
  let player: Row;
  try { player = await requireGamePlayer(request, env); }
  catch (e) { return gameJson({ error: (e as GameError).message }, (e as GameError).status ?? 401); }

  if (player.in_prison)   return gameJson({ error: 'Du sitter i fängelse.' }, 400);
  if (player.in_hospital) return gameJson({ error: 'Du är på sjukhus.' }, 400);

  const body = await request.json<{ stat?: string }>().catch(() => ({} as { stat?: string }));
  const stat = body.stat ?? '';
  if (!['strength', 'intelligence', 'charisma', 'stealth'].includes(stat))
    return gameJson({ error: 'Invalid stat. Choose: strength, intelligence, charisma, stealth.' }, 400);

  const COST = 10;
  const energy = calcEnergy(player);
  if (energy < COST) return gameJson({ error: `Not enough energy. Need ${COST}, have ${energy}.` }, 400);

  const increase  = rand(1, 3);
  const newVal    = Math.min(100, ((player[stat] as number) ?? 10) + increase);
  const xpGained  = 20;
  const currentXp = (player.xp as number) + xpGained;
  const newLevel  = levelFromXp(currentXp);

  await updateEnergy(env, player.id as string, energy, COST);
  await env.DB.prepare(
    `UPDATE game_players SET ${stat} = ?, xp = ?, level = ?, last_action = datetime('now') WHERE id = ?`
  ).bind(newVal, currentXp, newLevel, player.id as string).run();

  const msg = `Tränar ${stat}. +${increase} (nu ${newVal}).`;
  await logAction(env, player.id as string, 'training', msg, 0, 0, xpGained, true);

  return gameJson({ stat, increase, new_value: newVal, xp_gained: xpGained, new_level: newLevel });
}

async function gameActionDrugDeal(request: Request, env: Env): Promise<Response> {
  let player: Row;
  try { player = await requireGamePlayer(request, env); }
  catch (e) { return gameJson({ error: (e as GameError).message }, (e as GameError).status ?? 401); }

  if (player.in_prison)   return gameJson({ error: 'Du sitter i fängelse.' }, 400);
  if (player.in_hospital) return gameJson({ error: 'Du är på sjukhus.' }, 400);

  const body     = await request.json<{ action?: string; drug?: string; quantity?: number }>().catch(() => ({} as { action?: string; drug?: string; quantity?: number }));
  const action   = body.action ?? '';
  const drug     = (body.drug ?? '').toLowerCase();
  const quantity = Math.max(1, Math.floor(body.quantity ?? 1));

  if (!['buy', 'sell'].includes(action)) return gameJson({ error: 'action must be "buy" or "sell".' }, 400);
  if (!DRUG_NAMES.includes(drug))        return gameJson({ error: `Unknown drug "${drug}".` }, 400);
  if (quantity < 1 || quantity > 100)    return gameJson({ error: 'Quantity must be 1–100.' }, 400);

  const pid          = player.id as string;
  const playerLevel  = (player.level        as number) ?? 1;
  if (playerLevel < 5) return gameJson({ error: 'Droghandel l\u00e5ses upp vid level 5.' }, 400);

  const profession   = (player.profession   as string) ?? 'none';
  const intelligence = (player.intelligence as number) ?? 10;
  const charisma     = (player.charisma     as number) ?? 10;
  const midPrice     = getDrugPrice(drug);

  // Market spread model: there is always a bid/ask gap so that buying then
  // immediately re-selling is never profitable.  Stats compress the spread.
  //   buy  = mid * (1 + buyMarkup)   where buyMarkup starts at 0.15 and falls toward 0
  //   sell = mid * (1 - sellMarkdown) where sellMarkdown starts at 0.15 and falls toward 0
  // At maximum stats (int=100 or cha=100) the markup/markdown floor is 0.02 (2 %), so
  // even a perfect dealer cannot profit from an instantaneous round-trip.
  const buyMarkup    = Math.max(0.02, 0.15 - intelligence * 0.001 - profBonus(profession, 'drug_profit') * 0.3);
  const sellMarkdown = Math.max(0.02, 0.15 - charisma     * 0.001 - profBonus(profession, 'drug_profit') * 0.3);

  if (action === 'buy') {
    const COST    = 5;
    const energy  = calcEnergy(player);
    if (energy < COST) return gameJson({ error: `Not enough energy. Need ${COST}.` }, 400);

    const unitPrice = Math.round(midPrice * (1 + buyMarkup));
    const total     = unitPrice * quantity;
    const cash      = (player.cash as number) ?? 0;
    if (cash < total) return gameJson({ error: `Not enough cash. Need ${total}, have ${cash}.` }, 400);

    // Upsert inventory — store actual buy price so sell side can reference it
    const existing = await env.DB.prepare(
      `SELECT id, quantity FROM game_inventory WHERE player_id = ? AND item_type = 'drug' AND item_name = ?`
    ).bind(pid, drug).first<Row>();

    if (existing) {
      await env.DB.prepare(
        `UPDATE game_inventory SET quantity = quantity + ?, buy_price = ? WHERE id = ?`
      ).bind(quantity, unitPrice, existing.id as string).run();
    } else {
      await env.DB.prepare(
        `INSERT INTO game_inventory (id, player_id, item_type, item_name, quantity, buy_price)
         VALUES (?, ?, 'drug', ?, ?, ?)`
      ).bind(crypto.randomUUID(), pid, drug, quantity, unitPrice).run();
    }

    await updateEnergy(env, pid, energy, COST);
    await env.DB.prepare(
      `UPDATE game_players SET cash = cash - ?, last_action = datetime('now') WHERE id = ?`
    ).bind(total, pid).run();

    const msg = `K\u00f6per ${quantity}x ${drug} \u00e0 ${unitPrice} kr/st.`;
    await logAction(env, pid, 'drug_deal', msg, -total, 0, 5, true);
    return gameJson({ bought: quantity, unit_price: unitPrice, total_cost: total, new_cash: cash - total,
                      message: `Köper ${quantity}x ${drug} för ${total.toLocaleString('sv')} kr.` });

  } else {
    // sell — no energy cost
    const existing = await env.DB.prepare(
      `SELECT id, quantity FROM game_inventory WHERE player_id = ? AND item_type = 'drug' AND item_name = ?`
    ).bind(pid, drug).first<Row>();
    if (!existing || (existing.quantity as number) < quantity)
      return gameJson({ error: `You don't have ${quantity}x ${drug}.` }, 400);

    // Sell price uses current market minus markdown.
    // Holding pays off: if mid has risen above buy_price, seller profits.
    const unitPrice = Math.round(midPrice * (1 - sellMarkdown));
    const total     = unitPrice * quantity;
    const respectGained = Math.max(1, Math.floor(quantity * 0.5));
    const xpGained     = Math.max(5, quantity * 2);

    const newQty = (existing.quantity as number) - quantity;
    if (newQty === 0) {
      await env.DB.prepare(`DELETE FROM game_inventory WHERE id = ?`).bind(existing.id as string).run();
    } else {
      await env.DB.prepare(`UPDATE game_inventory SET quantity = ? WHERE id = ?`).bind(newQty, existing.id as string).run();
    }

    const currentXp = (player.xp as number) + xpGained;
    const newLevel  = levelFromXp(currentXp);
    await env.DB.prepare(
      `UPDATE game_players SET cash = cash + ?, respect = respect + ?, xp = ?, level = ?,
       last_action = datetime('now') WHERE id = ?`
    ).bind(total, respectGained, currentXp, newLevel, pid).run();

    const msg = `S\u00e4ljer ${quantity}x ${drug} \u00e0 ${unitPrice} kr/st.`;
    await logAction(env, pid, 'drug_deal', msg, total, respectGained, xpGained, true);
    return gameJson({ sold: quantity, unit_price: unitPrice, total_earned: total, respect_gained: respectGained,
                      xp_gained: xpGained, new_level: newLevel, success: true,
                      message: `Säljer ${quantity}x ${drug} för ${total.toLocaleString('sv')} kr.` });
  }
}

async function gameActionAssault(request: Request, env: Env): Promise<Response> {
  let player: Row;
  try { player = await requireGamePlayer(request, env); }
  catch (e) { return gameJson({ error: (e as GameError).message }, (e as GameError).status ?? 401); }

  if (player.in_prison)   return gameJson({ error: 'Du sitter i fängelse.' }, 400);
  if (player.in_hospital) return gameJson({ error: 'Du är på sjukhus.' }, 400);
  if (!player.is_alive)   return gameJson({ error: 'Du är eliminerad.' }, 400);

  const body      = await request.json<{ target_id?: string }>().catch(() => ({} as { target_id?: string }));
  const targetId  = (body.target_id ?? '').trim();
  if (!targetId)  return gameJson({ error: 'target_id required.' }, 400);

  const isNpc       = targetId.startsWith('npc-');
  const assaultReq  = isNpc ? 8 : 15;
  const playerLevel = (player.level as number) ?? 1;
  if (playerLevel < assaultReq)
    return gameJson({ error: `Strid mot ${isNpc ? 'NPC' : 'spelare'} l\u00e5ses upp vid level ${assaultReq}.` }, 400);

  const profession = (player.profession as string) ?? 'none';
  const COST  = 15;
  const energy = calcEnergy(player);
  if (energy < COST) return gameJson({ error: `Not enough energy. Need ${COST}.` }, 400);

  const pid = player.id as string;

  // Check 24h cooldown
  const cooldown = await env.DB.prepare(
    `SELECT attacked_at FROM game_assault_cooldowns WHERE attacker_id = ? AND target_id = ?`
  ).bind(pid, targetId).first<{ attacked_at: string }>();
  if (cooldown) {
    const since = Date.now() - new Date(cooldown.attacked_at).getTime();
    if (since < 24 * 60 * 60 * 1000) {
      const hoursLeft = Math.ceil((24 * 60 * 60 * 1000 - since) / 3600000);
      return gameJson({ error: `Can't attack same target for ${hoursLeft} more hour(s).` }, 400);
    }
  }

  // Fetch target (NPC or player)
  let target: Row | null = null;
  if (isNpc) {
    target = await env.DB.prepare(`SELECT * FROM game_npcs WHERE id = ?`).bind(targetId).first<Row>();
  } else {
    target = await env.DB.prepare(`SELECT * FROM game_players WHERE id = ?`).bind(targetId).first<Row>();
  }
  if (!target) return gameJson({ error: 'Target not found.' }, 404);
  if (target.is_alive === 0) return gameJson({ error: 'Target is already down.' }, 400);

  // Get weapon bonus
  const weaponRow = await env.DB.prepare(
    `SELECT properties FROM game_inventory WHERE player_id = ? AND item_type = 'weapon' ORDER BY buy_price DESC LIMIT 1`
  ).bind(pid).first<Row>();
  let weaponDmg = 0;
  if (weaponRow?.properties) {
    try { const p = JSON.parse(weaponRow.properties as string); weaponDmg = p.damage ?? 0; } catch {}
  }

  const attackerStr = (player.strength  as number) ?? 10;
  const targetStr   = (target.strength  as number) ?? 10;
  const dmgMult     = 1 + profBonus(profession, 'assault_damage');
  const attackPower = Math.round((attackerStr + weaponDmg + rand(1, 20)) * dmgMult);
  const defensePower= targetStr + rand(1, 15);

  const success = attackPower > defensePower;
  let damageDelt   = 0;
  let damageTaken  = 0;
  let cashStolen   = 0;
  let respectGained= 0;
  let message      = '';

  let combatLines: string[] = [];
  if (success) {
    damageDelt    = rand(10, 40);
    cashStolen    = Math.floor(((target.cash as number) ?? 0) * (rand(10, 30) / 100));
    respectGained = Math.max(1, Math.floor(cashStolen / 200));
    message       = `\u2713 Slog ner ${target.name as string}. Stal ${cashStolen.toLocaleString('sv')} kr.`;
    combatLines   = ASSAULT_WIN_LINES.map(l => l.replace(/\{name\}/g, target.name as string));
    combatLines.push(`Du stal ${cashStolen.toLocaleString('sv')} kr.`);

    // Reduce target HP
    const targetHp = Math.max(0, ((isNpc ? (target.hp ?? 50) : target.hp) as number) - damageDelt);
    const knocked  = targetHp === 0;

    if (isNpc) {
      await env.DB.prepare(`UPDATE game_npcs SET hp = ?, is_alive = ?, cash = cash - ? WHERE id = ?`)
        .bind(targetHp, knocked ? 0 : 1, cashStolen, targetId).run();
    } else {
      const hospitalUntil = knocked ? new Date(Date.now() + 60 * 60 * 1000).toISOString() : null;
      await env.DB.prepare(
        `UPDATE game_players SET hp = ?, in_hospital = ?, hospital_until = ?, cash = cash - ? WHERE id = ?`
      ).bind(targetHp, knocked ? 1 : 0, hospitalUntil, cashStolen, targetId).run();
    }

    const currentXp = (player.xp as number) + 50;
    const newLevel  = levelFromXp(currentXp);
    await env.DB.prepare(
      `UPDATE game_players SET cash = cash + ?, respect = respect + ?, xp = ?, level = ?, last_action = datetime('now') WHERE id = ?`
    ).bind(cashStolen, respectGained, currentXp, newLevel, pid).run();
  } else {
    damageTaken = rand(5, 25);
    message     = `\u2717 Attacken mot ${target.name as string} misslyckades. Du fick stryk.`;
    combatLines = ASSAULT_LOSE_LINES.map(l => l.replace(/\{name\}/g, target.name as string));
    combatLines.push(`Du fick ${damageTaken} skada.`);
    const newHp = Math.max(0, (player.hp as number) - damageTaken);
    const hospitalized = newHp === 0;
    const hospitalUntil = hospitalized ? new Date(Date.now() + 30 * 60 * 1000).toISOString() : null;
    await env.DB.prepare(
      `UPDATE game_players SET hp = ?, in_hospital = ?, hospital_until = ?, last_action = datetime('now') WHERE id = ?`
    ).bind(newHp, hospitalized ? 1 : 0, hospitalUntil, pid).run();
  }

  await updateEnergy(env, pid, energy, COST);

  // Upsert cooldown
  await env.DB.prepare(
    `INSERT OR REPLACE INTO game_assault_cooldowns (attacker_id, target_id, attacked_at)
     VALUES (?, ?, datetime('now'))`
  ).bind(pid, targetId).run();

  await logAction(env, pid, 'assault', message, cashStolen, respectGained, success ? 50 : 0, success);

  return gameJson({ success, message, combat_lines: combatLines, damage_dealt: damageDelt, damage_taken: damageTaken, cash_stolen: cashStolen });
}

async function gameActionPrisonEscape(request: Request, env: Env): Promise<Response> {
  let player: Row;
  try { player = await requireGamePlayer(request, env); }
  catch (e) { return gameJson({ error: (e as GameError).message }, (e as GameError).status ?? 401); }

  if (!player.in_prison) return gameJson({ error: 'Du sitter inte i fängelse.' }, 400);

  const prisonUntil  = new Date((player.prison_until as string)).getTime();
  const remaining    = Math.max(0, prisonUntil - Date.now());
  const bribeCost    = Math.max(500, Math.floor(remaining / 1000) * 10); // $10 per remaining second, min $500
  const stealth      = (player.stealth as number) ?? 10;
  const escapeChance = Math.min(80, 20 + stealth * 0.6);

  const body   = await request.json<{ method?: string }>().catch(() => ({ method: 'escape' }));
  const method = body.method ?? 'escape';

  const pid  = player.id as string;
  const cash = (player.cash as number) ?? 0;

  if (method === 'bribe') {
    if (cash < bribeCost)
      return gameJson({ error: `Mutan kostar ${bribeCost} kr. Du har ${cash} kr.` }, 400);
    await env.DB.prepare(
      `UPDATE game_players SET in_prison = 0, prison_until = NULL, cash = cash - ?,
       last_action = datetime('now') WHERE id = ?`
    ).bind(bribeCost, pid).run();
    await logAction(env, pid, 'prison', `Mutade sig ut ur f\u00e4ngelset f\u00f6r ${bribeCost} kr.`, -bribeCost, 0, 0, true);
    return gameJson({ success: true, method: 'bribe', cost: bribeCost, message: `Mutade vakten. Frihet k\u00f6star ${bribeCost} kr.` });
  }

  // Escape attempt
  const roll    = Math.random() * 100;
  const success = roll < escapeChance;
  if (success) {
    await env.DB.prepare(
      `UPDATE game_players SET in_prison = 0, prison_until = NULL, last_action = datetime('now') WHERE id = ?`
    ).bind(pid).run();
    await logAction(env, pid, 'prison', 'R\u00f6mde fr\u00e5n f\u00e4ngelset.', 0, 5, 30, true);
    return gameJson({ success: true, method: 'escape', message: 'Du lyckades r\u00f6mma! +5 respect.' });
  } else {
    // Add 10 min penalty
    const newRelease = new Date(Math.max(prisonUntil, Date.now()) + 10 * 60 * 1000).toISOString();
    await env.DB.prepare(
      `UPDATE game_players SET prison_until = ? WHERE id = ?`
    ).bind(newRelease, pid).run();
    await logAction(env, pid, 'prison', 'R\u00f6mningsf\u00f6rs\u00f6k misslyckades. +10 min.', 0, 0, 0, false);
    return gameJson({ success: false, method: 'escape', message: 'Misslyckades. +10 min till domen.', bribe_cost: bribeCost });
  }
}

async function gameActionHospital(request: Request, env: Env): Promise<Response> {
  let player: Row;
  try { player = await requireGamePlayer(request, env); }
  catch (e) { return gameJson({ error: (e as GameError).message }, (e as GameError).status ?? 401); }

  const body = await request.json<{ action?: string; stat?: string }>().catch(() => ({}));
  const action = body.action ?? 'heal';
  const pid    = player.id as string;
  const hp     = (player.hp     as number) ?? 100;
  const hpMax  = (player.hp_max as number) ?? 100;
  const cash   = (player.cash   as number) ?? 0;

  if (action === 'heal') {
    if (hp >= hpMax) return gameJson({ message: 'Du har fullt HP.', hp, hp_max: hpMax });
    const missing  = hpMax - hp;
    const healCost = Math.max(100, missing * 10); // $10/HP, min $100
    if (cash < healCost) return gameJson({ error: `L\u00e4kning kostar ${healCost} kr. Du har ${cash} kr.` }, 400);

    await env.DB.prepare(
      `UPDATE game_players SET hp = ?, in_hospital = 0, hospital_until = NULL,
       cash = cash - ?, last_action = datetime('now') WHERE id = ?`
    ).bind(hpMax, healCost, pid).run();

    await logAction(env, pid, 'hospital', `Helades till full h\u00e4lsa f\u00f6r ${healCost} kr.`, -healCost, 0, 0, true);
    return gameJson({ healed: true, cost: healCost, new_hp: hpMax, new_cash: cash - healCost });
  }

  if (action === 'boost') {
    const stat = body.stat ?? '';
    if (!['strength', 'intelligence', 'charisma', 'stealth'].includes(stat))
      return gameJson({ error: 'stat must be strength/intelligence/charisma/stealth.' }, 400);
    const BOOST_COST = 5000;
    if (cash < BOOST_COST) return gameJson({ error: `Boost kostar ${BOOST_COST} kr.` }, 400);
    const newVal = Math.min(100, ((player[stat] as number) ?? 10) + 1);
    await env.DB.prepare(
      `UPDATE game_players SET ${stat} = ?, cash = cash - ?, last_action = datetime('now') WHERE id = ?`
    ).bind(newVal, BOOST_COST, pid).run();
    await logAction(env, pid, 'hospital', `K\u00f6pte stat-boost: ${stat} +1.`, -BOOST_COST, 0, 0, true);
    return gameJson({ boosted: stat, new_value: newVal, cost: BOOST_COST, new_cash: cash - BOOST_COST });
  }

  return gameJson({ error: 'action must be "heal" or "boost".' }, 400);
}

async function gameActionBank(request: Request, env: Env): Promise<Response> {
  let player: Row;
  try { player = await requireGamePlayer(request, env); }
  catch (e) { return gameJson({ error: (e as GameError).message }, (e as GameError).status ?? 401); }

  const body   = await request.json<{ action?: string; amount?: number }>().catch(() => ({} as { action?: string; amount?: number }));
  const action = body.action ?? '';
  const amount = Math.floor(body.amount ?? 0);
  if (amount <= 0) return gameJson({ error: 'amount must be positive.' }, 400);
  if (!['deposit', 'withdraw'].includes(action)) return gameJson({ error: 'action must be "deposit" or "withdraw".' }, 400);

  const pid  = player.id as string;
  const cash = (player.cash as number) ?? 0;
  const bank = (player.bank as number) ?? 0;
  const FEE  = 0.05; // 5% deposit fee

  if (action === 'deposit') {
    if (cash < amount) return gameJson({ error: `Du har bara ${cash} kr.` }, 400);
    const fee        = Math.floor(amount * FEE);
    const deposited  = amount - fee;
    await env.DB.prepare(
      `UPDATE game_players SET cash = cash - ?, bank = bank + ?, last_action = datetime('now') WHERE id = ?`
    ).bind(amount, deposited, pid).run();
    await logAction(env, pid, 'bank', `Satte in ${amount} kr (avgift ${fee} kr).`, -amount, 0, 0, true);
    return gameJson({ deposited, fee, new_cash: cash - amount, new_bank: bank + deposited });
  }

  // withdraw
  if (bank < amount) return gameJson({ error: `Du har bara ${bank} kr i banken.` }, 400);
  await env.DB.prepare(
    `UPDATE game_players SET cash = cash + ?, bank = bank - ?, last_action = datetime('now') WHERE id = ?`
  ).bind(amount, amount, pid).run();
  await logAction(env, pid, 'bank', `Tog ut ${amount} kr fr\u00e5n banken.`, amount, 0, 0, true);
  return gameJson({ withdrawn: amount, new_cash: cash + amount, new_bank: bank - amount });
}

// ─── Property configs ─────────────────────────────────────────────────────────

const PROPERTY_CONFIGS: Record<string, { label: string; baseCost: number; baseIncome: number }> = {
  stash_house: { label: 'Stash House', baseCost: 5000,  baseIncome: 100  },
  nightclub:   { label: 'Nattklubb',   baseCost: 25000, baseIncome: 500  },
  drug_lab:    { label: 'Droglab',     baseCost: 50000, baseIncome: 1000 },
  garage:      { label: 'Garage',      baseCost: 15000, baseIncome: 50   },
  safehouse:   { label: 'Safehouse',   baseCost: 10000, baseIncome: 75   },
};

function propertyCostAtLevel(type: string, level: number): number {
  return Math.round((PROPERTY_CONFIGS[type]?.baseCost ?? 0) * Math.pow(2, level - 1));
}
function propertyIncomeAtLevel(type: string, level: number): number {
  return (PROPERTY_CONFIGS[type]?.baseIncome ?? 0) * level;
}
function maxProperties(playerLevel: number): number { return 3 + Math.floor(playerLevel / 5); }

async function gameActionBuyProperty(request: Request, env: Env): Promise<Response> {
  let player: Row;
  try { player = await requireGamePlayer(request, env); }
  catch (e) { return gameJson({ error: (e as GameError).message }, (e as GameError).status ?? 401); }

  const playerLevel = (player.level as number) ?? 1;
  if (playerLevel < 10) return gameJson({ error: 'Fastigheter l\u00e5ses upp vid level 10.' }, 400);

  const body = await request.json<{ type?: string; upgrade_id?: string }>().catch(() => ({} as { type?: string; upgrade_id?: string }));
  const pid  = player.id as string;
  const cash = (player.cash as number) ?? 0;
  const profession = (player.profession as string) ?? 'none';

  // Upgrade path
  if (body.upgrade_id) {
    const prop = await env.DB.prepare(`SELECT * FROM game_properties WHERE id = ? AND player_id = ?`)
      .bind(body.upgrade_id, pid).first<Row>();
    if (!prop) return gameJson({ error: 'Property not found.' }, 404);
    const currentLevel = (prop.level as number) ?? 1;
    if (currentLevel >= 5) return gameJson({ error: 'Already at max level.' }, 400);
    const cost = propertyCostAtLevel(prop.property_type as string, currentLevel + 1);
    if (cash < cost) return gameJson({ error: `Upgrade costs ${cost} kr. Du har ${cash} kr.` }, 400);
    const newLevel   = currentLevel + 1;
    const newIncome  = Math.round(propertyIncomeAtLevel(prop.property_type as string, newLevel) * (1 + profBonus(profession, 'property_income')));
    await env.DB.batch([
      env.DB.prepare(`UPDATE game_properties SET level = ?, income_per_hour = ? WHERE id = ?`).bind(newLevel, newIncome, body.upgrade_id),
      env.DB.prepare(`UPDATE game_players SET cash = cash - ?, last_action = datetime('now') WHERE id = ?`).bind(cost, pid),
    ]);
    return gameJson({ upgraded: prop.property_type, new_level: newLevel, new_income: newIncome, cost, new_cash: cash - cost });
  }

  const type = (body.type ?? '').toLowerCase();
  if (!PROPERTY_CONFIGS[type]) return gameJson({ error: `Unknown property type "${type}".` }, 400);

  const maxProps = maxProperties(playerLevel);
  const owned = await env.DB.prepare(`SELECT COUNT(*) as cnt FROM game_properties WHERE player_id = ?`).bind(pid).first<{ cnt: number }>();
  if ((owned?.cnt ?? 0) >= maxProps)
    return gameJson({ error: `Max ${maxProps} fastigheter vid din level.` }, 400);

  const cost   = propertyCostAtLevel(type, 1);
  if (cash < cost) return gameJson({ error: `Kostar ${cost} kr. Du har ${cash} kr.` }, 400);

  const income = Math.round(propertyIncomeAtLevel(type, 1) * (1 + profBonus(profession, 'property_income')));
  const propId = crypto.randomUUID();
  const cfg    = PROPERTY_CONFIGS[type];
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO game_properties (id, player_id, property_type, property_name, level, income_per_hour)
       VALUES (?, ?, ?, ?, 1, ?)`
    ).bind(propId, pid, type, cfg.label, income),
    env.DB.prepare(`UPDATE game_players SET cash = cash - ?, last_action = datetime('now') WHERE id = ?`).bind(cost, pid),
  ]);

  await logAction(env, pid, 'property', `K\u00f6pte ${cfg.label} f\u00f6r ${cost} kr.`, -cost, 0, 50, true);
  return gameJson({ bought: type, income_per_hour: income, cost, new_cash: cash - cost });
}

async function gameActionCollectIncome(request: Request, env: Env): Promise<Response> {
  let player: Row;
  try { player = await requireGamePlayer(request, env); }
  catch (e) { return gameJson({ error: (e as GameError).message }, (e as GameError).status ?? 401); }

  const pid  = player.id as string;
  const res  = await env.DB.prepare(`SELECT * FROM game_properties WHERE player_id = ?`).bind(pid).all<Row>();
  if (!res.results.length) return gameJson({ error: 'Inga fastigheter \u00e4gda.' }, 400);

  let total = 0;
  const now = Date.now();
  const stmts = res.results.map(prop => {
    const lastCollected = new Date((prop.last_collected as string) ?? new Date().toISOString()).getTime();
    const hours         = Math.max(0, (now - lastCollected) / 3600000);
    const income        = Math.round((prop.income_per_hour as number) * hours);
    total += income;
    return env.DB.prepare(`UPDATE game_properties SET last_collected = datetime('now') WHERE id = ?`)
      .bind(prop.id as string);
  });

  if (total === 0) return gameJson({ message: 'Ingen inkomst att h\u00e4mta \u00e4nnu.', collected: 0 });

  stmts.push(
    env.DB.prepare(`UPDATE game_players SET cash = cash + ?, last_action = datetime('now') WHERE id = ?`).bind(total, pid)
  );
  await env.DB.batch(stmts);
  await logAction(env, pid, 'property', `Samlade in ${total} kr fr\u00e5n fastigheter.`, total, 0, 20, true);
  return gameJson({ collected: total, properties: res.results.length });
}

async function gameActionChooseProfession(request: Request, env: Env): Promise<Response> {
  let player: Row;
  try { player = await requireGamePlayer(request, env); }
  catch (e) { return gameJson({ error: (e as GameError).message }, (e as GameError).status ?? 401); }

  const playerLevel = (player.level    as number) ?? 1;
  const current     = (player.profession as string) ?? 'none';

  if (playerLevel < 3) return gameJson({ error: 'Yrke l\u00e5ses upp vid level 3.' }, 400);
  if (current !== 'none' && playerLevel < 10)
    return gameJson({ error: 'Du kan byta yrke en g\u00e5ng vid level 10.' }, 400);
  if (current !== 'none' && playerLevel >= 10) {
    // Check already changed once (using a flag stored in profession with prefix 'changed:')
    if (current.startsWith('changed:'))
      return gameJson({ error: 'Du har redan bytt yrke. Ingen \u00e5terv\u00e4ndo.' }, 400);
  }

  const body = await request.json<{ profession?: string }>().catch(() => ({} as { profession?: string }));
  const prof = (body.profession ?? '').toLowerCase();
  const valid = ['r\u00e5nare', 'langare', 'torped', 'hallick', 'bedragare'];
  if (!valid.includes(prof)) return gameJson({ error: `Ogiltigt yrke. V\u00e4lj: ${valid.join(', ')}.` }, 400);

  const stored = current !== 'none' ? `changed:${prof}` : prof;
  const pid    = player.id as string;
  await env.DB.prepare(`UPDATE game_players SET profession = ?, last_action = datetime('now') WHERE id = ?`)
    .bind(stored, pid).run();

  await logAction(env, pid, 'profession', `Valde yrke: ${prof}.`, 0, 0, 0, true);
  return gameJson({ profession: prof, message: `Du \u00e4r nu ${prof}.` });
}

// ── Vehicles & Race ───────────────────────────────────────────────────────────

const VEHICLE_CONFIGS: Record<string, { name: string; cost: number; bonus: number }> = {
  volvo240:   { name: 'Stulen Volvo 240',       cost: 2000,   bonus: 10 },
  golf_gti:   { name: 'Trimmad Golf GTI',       cost: 8000,   bonus: 25 },
  bmw_m3:     { name: 'BMW M3 E46',             cost: 25000,  bonus: 45 },
  skyline_r34:{ name: 'Nissan Skyline R34',     cost: 60000,  bonus: 70 },
  lambo:      { name: 'Lamborghini Gallardo',   cost: 200000, bonus: 90 },
};

const RACE_TIERS: Record<number, { fee: number; prize: number; xp: number; difficulty: number }> = {
  1: { fee: 1000,  prize: 3000,  xp: 50,  difficulty: 30 },
  2: { fee: 5000,  prize: 15000, xp: 150, difficulty: 50 },
  3: { fee: 25000, prize: 75000, xp: 400, difficulty: 70 },
};

const RACE_NARRATIVES = [
  ['Motorerna vrider... 3... 2... 1... GÅ!', 'Du håller bra fart in mot Slussen...', 'Du skär förbi på insidan och tar ledningen!'],
  ['Motorerna vrider... 3... 2... 1... GÅ!', 'Du ligger tätt bakom vid Gamla Stan...', 'Sista kurvan — du drar ifrån!'],
  ['Motorerna vrider... 3... 2... 1... GÅ!', 'Ni går jämna hela banan...', 'Målgångsfoto — du vann med näsan!'],
];
const RACE_LOSE_NARRATIVES = [
  ['Motorerna vrider... 3... 2... 1... GÅ!', 'Du tappar fart i kurvan vid Slussen...', 'Rivalen drar ifrån. Inga ursäkter.'],
  ['Motorerna vrider... 3... 2... 1... GÅ!', 'Växellådan strular lite...', 'Du kom på andraplats. Pengar borta.'],
];

async function gameActionBuyVehicle(request: Request, env: Env): Promise<Response> {
  let player: Row;
  try { player = await requireGamePlayer(request, env); }
  catch (e) { return gameJson({ error: (e as GameError).message }, (e as GameError).status ?? 401); }

  const body      = await request.json<{ vehicle_id?: string }>().catch(() => ({} as { vehicle_id?: string }));
  const vehicleId = (body.vehicle_id ?? '').trim();
  const cfg       = VEHICLE_CONFIGS[vehicleId];
  if (!cfg) return gameJson({ error: `Okänt fordon "${vehicleId}".` }, 400);

  const playerLevel = (player.level as number) ?? 1;
  if (playerLevel < 5) return gameJson({ error: 'Fordon låses upp vid level 5.' }, 400);

  const pid = player.id as string;
  const existing = await env.DB.prepare(
    `SELECT id FROM game_inventory WHERE player_id = ? AND item_name = ? AND item_type = 'vehicle'`
  ).bind(pid, vehicleId).first();
  if (existing) return gameJson({ error: 'Du äger redan det fordonet.' }, 400);

  if ((player.cash as number) < cfg.cost)
    return gameJson({ error: `Inte tillräckligt med pengar. Behöver ${cfg.cost.toLocaleString('sv')} kr.` }, 400);

  const iid = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(`UPDATE game_players SET cash = cash - ?, last_action = datetime('now') WHERE id = ?`)
      .bind(cfg.cost, pid),
    env.DB.prepare(`INSERT INTO game_inventory (id, player_id, item_name, item_type, quantity, buy_price) VALUES (?,?,?,?,?,?)`)
      .bind(iid, pid, vehicleId, 'vehicle', 1, cfg.cost),
  ]);

  await logAction(env, pid, 'buy_vehicle', `Köpte ${cfg.name} för ${cfg.cost.toLocaleString('sv')} kr.`, -cfg.cost, 0, 0, true);
  return gameJson({ message: `${cfg.name} är nu din. Skön bil.` });
}

async function gameActionRace(request: Request, env: Env): Promise<Response> {
  let player: Row;
  try { player = await requireGamePlayer(request, env); }
  catch (e) { return gameJson({ error: (e as GameError).message }, (e as GameError).status ?? 401); }

  if (player.in_prison)   return gameJson({ error: 'Du sitter i fängelse.' }, 400);
  if (player.in_hospital) return gameJson({ error: 'Du är på sjukhus.' }, 400);

  const playerLevel = (player.level as number) ?? 1;
  if (playerLevel < 10) return gameJson({ error: 'Streetrace låses upp vid level 10.' }, 400);

  const body = await request.json<{ tier?: number }>().catch(() => ({} as { tier?: number }));
  const tier = Number(body.tier ?? 1);
  const cfg  = RACE_TIERS[tier];
  if (!cfg) return gameJson({ error: 'Ogiltig tier (1-3).' }, 400);

  const pid  = player.id as string;
  const cash = (player.cash as number) ?? 0;
  if (cash < cfg.fee) return gameJson({ error: `Inte tillräckligt. Insats: ${cfg.fee.toLocaleString('sv')} kr.` }, 400);

  const energy = calcEnergy(player);
  if (energy < 10) return gameJson({ error: 'Inte tillräckligt energi (behöver 10).' }, 400);

  // Find best vehicle
  const vehicleRow = await env.DB.prepare(
    `SELECT item_name FROM game_inventory WHERE player_id = ? AND item_type = 'vehicle' ORDER BY buy_price DESC LIMIT 1`
  ).bind(pid).first<{ item_name: string }>();
  const vehicleBonus = vehicleRow ? (VEHICLE_CONFIGS[vehicleRow.item_name]?.bonus ?? 0) : 0;

  const stealth   = (player.stealth as number) ?? 10;
  const winChance = Math.min(90, 30 + vehicleBonus * 0.5 + stealth * 0.3 + playerLevel - cfg.difficulty);
  const won       = Math.random() * 100 < winChance;

  const cashDelta  = won ? cfg.prize : -cfg.fee;
  const newCash    = cash + cashDelta;
  const xpGained   = won ? cfg.xp : Math.floor(cfg.xp * 0.2);
  const currentXp  = (player.xp as number) + xpGained;
  const newLevel   = levelFromXp(currentXp);
  const respectGained = won ? Math.floor(cfg.prize / 500) : 0;

  const newEnergy  = await updateEnergy(env, pid, energy, 10);
  await env.DB.prepare(
    `UPDATE game_players SET cash = ?, xp = ?, level = ?, respect = respect + ?, last_action = datetime('now') WHERE id = ?`
  ).bind(newCash, currentXp, newLevel, respectGained, pid).run();

  const narrative = won
    ? [...pickRandom(RACE_NARRATIVES), `Vinst! +${cfg.prize.toLocaleString('sv')} kr.`]
    : [...pickRandom(RACE_LOSE_NARRATIVES), `Förlust. -${cfg.fee.toLocaleString('sv')} kr.`];
  const message = won
    ? `\u2713 Du vann! +${cfg.prize.toLocaleString('sv')} kr.`
    : `\u2717 Du f\u00f6rlorade. -${cfg.fee.toLocaleString('sv')} kr.`;

  await logAction(env, pid, 'race', message, cashDelta, respectGained, xpGained, won);
  return gameJson({ success: won, message, narrative, cash_delta: cashDelta, xp_gained: xpGained, energy_left: newEnergy });
}

// ─── DAX measures data (inlined — Cloudflare Pages does not bundle _ helpers) ──

interface DaxMeasure { title: string; language: string; code: string; description: string | null; subcategory_id: string; tags: string[]; }

const DAX_MEASURES: DaxMeasure[] = [
  {
    title: "Grundläggande Intäkter", language: "dax",
    description: "Grundläggande intäktsmått: Total Revenue, AOV, Gross Margin, EBITDA, kostnader",
    subcategory_id: "pb-revenue", tags: ["dax","revenue","kpi","hemfrid"],
    code: `// === GRUNDLÄGGANDE INTÄKTER ===

Total Revenue = SUM(FactSales[Revenue])

Total Revenue incl VAT = [Total Revenue] * 1.25

RUT Amount = SUM(FactSales[RUT_Amount])

Net Revenue After RUT = [Total Revenue] - [RUT Amount]

Average Order Value = DIVIDE([Total Revenue], [Total Orders])

Average Order Value incl VAT = [Average Order Value] * 1.25

Median Order Value = MEDIAN(FactSales[Revenue])

Revenue per Working Day =
DIVIDE(
    [Total Revenue],
    DISTINCTCOUNT(FactSales[WorkDate])
)

Revenue per Customer =
DIVIDE(
    [Total Revenue],
    [Unique Customers]
)

Gross Margin = DIVIDE([Total Revenue] - [Total Cost], [Total Revenue])

Gross Margin Amount = [Total Revenue] - [Total Cost]

Total Cost = SUM(FactSales[Cost])

Cost per Order = DIVIDE([Total Cost], [Total Orders])

EBITDA = [Gross Margin Amount] - [Total Operating Expenses]

Total Operating Expenses = SUM(FactExpenses[Amount])`,
  },
  {
    title: "Intäkter Per Tjänstetyp", language: "dax",
    description: "Intäktsuppdelning per tjänst: Hemstäd, Kontorsstäd, Flyttstäd, Fönsterputs, etc.",
    subcategory_id: "pb-revenue", tags: ["dax","revenue","kpi","hemfrid"],
    code: `// === INTÄKTER PER TJÄNSTETYP ===

Revenue Hemstäd = CALCULATE([Total Revenue], DimService[ServiceType] = "Hemstäd")

Revenue Kontorsstäd = CALCULATE([Total Revenue], DimService[ServiceType] = "Kontorsstäd")

Revenue Flyttstäd = CALCULATE([Total Revenue], DimService[ServiceType] = "Flyttstäd")

Revenue Fönsterputs = CALCULATE([Total Revenue], DimService[ServiceType] = "Fönsterputs")

Revenue Storstäd = CALCULATE([Total Revenue], DimService[ServiceType] = "Storstäd")

Revenue Trappstäd = CALCULATE([Total Revenue], DimService[ServiceType] = "Trappstäd")

Share of Revenue by Service =
DIVIDE(
    [Total Revenue],
    CALCULATE([Total Revenue], REMOVEFILTERS(DimService))
)

Most Popular Service =
FIRSTNONBLANK(
    TOPN(1, VALUES(DimService[ServiceType]), [Total Orders], DESC),
    1
)`,
  },
  {
    title: "Tidsintelligens — YoY / MoM / YTD", language: "dax",
    description: "Tidsintelligens: Year-over-Year, Month-over-Month, YTD, Rolling averages, CAGR",
    subcategory_id: "pb-revenue", tags: ["dax","revenue","kpi","hemfrid"],
    code: `// === TIDSINTELLIGENS — YoY / MoM / YTD ===

Revenue PY = CALCULATE([Total Revenue], DATEADD(DimDate[Date], -1, YEAR))

Revenue YoY Change = [Total Revenue] - [Revenue PY]

Revenue YoY % = DIVIDE([Revenue YoY Change], [Revenue PY])

Revenue PM = CALCULATE([Total Revenue], DATEADD(DimDate[Date], -1, MONTH))

Revenue MoM Change = [Total Revenue] - [Revenue PM]

Revenue MoM % = DIVIDE([Revenue MoM Change], [Revenue PM])

Revenue YTD = TOTALYTD([Total Revenue], DimDate[Date])

Revenue YTD PY = CALCULATE([Revenue YTD], DATEADD(DimDate[Date], -1, YEAR))

Revenue YTD Growth % = DIVIDE([Revenue YTD] - [Revenue YTD PY], [Revenue YTD PY])

Revenue Rolling 3M =
CALCULATE(
    [Total Revenue],
    DATESINPERIOD(DimDate[Date], MAX(DimDate[Date]), -3, MONTH)
)

Revenue Rolling 12M =
CALCULATE(
    [Total Revenue],
    DATESINPERIOD(DimDate[Date], MAX(DimDate[Date]), -12, MONTH)
)

Revenue Rolling 3M PY =
CALCULATE(
    [Revenue Rolling 3M],
    DATEADD(DimDate[Date], -1, YEAR)
)

Revenue CAGR =
VAR StartValue = CALCULATE([Total Revenue], FIRSTDATE(DimDate[Date]))
VAR EndValue = CALCULATE([Total Revenue], LASTDATE(DimDate[Date]))
VAR Years = DATEDIFF(MIN(DimDate[Date]), MAX(DimDate[Date]), YEAR)
RETURN
IF(
    Years > 0 && StartValue > 0,
    POWER(DIVIDE(EndValue, StartValue), DIVIDE(1, Years)) - 1,
    BLANK()
)

Revenue MTD = TOTALMTD([Total Revenue], DimDate[Date])

Revenue QTD = TOTALQTD([Total Revenue], DimDate[Date])

Revenue Same Weekday PY =
CALCULATE(
    [Total Revenue],
    DATEADD(DimDate[Date], -364, DAY)
)`,
  },
  {
    title: "Orders & Bookings", language: "dax",
    description: "Ordermått: completion/cancellation rate, recurring orders, first-time vs repeat, lead time",
    subcategory_id: "pb-orders", tags: ["dax","orders","bookings","hemfrid"],
    code: `// === ORDERS & BOOKINGS ===

Total Orders = COUNTROWS(FactSales)

Total Completed Orders = CALCULATE(COUNTROWS(FactSales), FactSales[Status] = "Completed")

Total Cancelled Orders = CALCULATE(COUNTROWS(FactSales), FactSales[Status] = "Cancelled")

Cancellation Rate = DIVIDE([Total Cancelled Orders], [Total Orders])

Completion Rate = DIVIDE([Total Completed Orders], [Total Orders])

Orders PY = CALCULATE([Total Orders], DATEADD(DimDate[Date], -1, YEAR))

Orders YoY % = DIVIDE([Total Orders] - [Orders PY], [Orders PY])

Orders per Day = DIVIDE([Total Orders], DISTINCTCOUNT(DimDate[Date]))

Orders per Week = [Orders per Day] * 7

Peak Day Orders =
MAXX(
    SUMMARIZE(FactSales, DimDate[Date], "DayOrders", [Total Orders]),
    [DayOrders]
)

Average Orders per Customer =
DIVIDE([Total Orders], [Unique Customers])

First Time Orders =
CALCULATE(
    COUNTROWS(FactSales),
    FILTER(
        FactSales,
        FactSales[OrderDate] = CALCULATE(
            MIN(FactSales[OrderDate]),
            ALLEXCEPT(FactSales, FactSales[CustomerID])
        )
    )
)

Repeat Orders = [Total Orders] - [First Time Orders]

Repeat Order Rate = DIVIDE([Repeat Orders], [Total Orders])

Recurring Subscription Orders =
CALCULATE(COUNTROWS(FactSales), FactSales[IsRecurring] = TRUE())

Recurring Revenue = CALCULATE([Total Revenue], FactSales[IsRecurring] = TRUE())

Recurring Revenue Share = DIVIDE([Recurring Revenue], [Total Revenue])

Average Lead Time Days =
AVERAGEX(
    FactSales,
    DATEDIFF(FactSales[BookingDate], FactSales[ServiceDate], DAY)
)`,
  },
  {
    title: "Kundanalys — Grundläggande", language: "dax",
    description: "Kundmått: new/returning, retention, churn, CLV, cross-sell, top 10%",
    subcategory_id: "pb-customers", tags: ["dax","customers","retention","hemfrid"],
    code: `// === KUNDANALYS — GRUNDLÄGGANDE ===

Unique Customers = DISTINCTCOUNT(FactSales[CustomerID])

New Customers =
CALCULATE(
    DISTINCTCOUNT(FactSales[CustomerID]),
    FILTER(
        VALUES(FactSales[CustomerID]),
        CALCULATE(
            MIN(FactSales[OrderDate]),
            ALLEXCEPT(FactSales, FactSales[CustomerID])
        ) >= MIN(DimDate[Date])
        && CALCULATE(
            MIN(FactSales[OrderDate]),
            ALLEXCEPT(FactSales, FactSales[CustomerID])
        ) <= MAX(DimDate[Date])
    )
)

Returning Customers = [Unique Customers] - [New Customers]

New Customer Rate = DIVIDE([New Customers], [Unique Customers])

Returning Customer Rate = DIVIDE([Returning Customers], [Unique Customers])

Customer Retention Rate =
VAR CustomersStart = CALCULATE(
    DISTINCTCOUNT(FactSales[CustomerID]),
    DATEADD(DimDate[Date], -1, YEAR)
)
VAR CustomersRetained = CALCULATE(
    DISTINCTCOUNT(FactSales[CustomerID]),
    FILTER(
        VALUES(FactSales[CustomerID]),
        CALCULATE(MIN(FactSales[OrderDate]), ALLEXCEPT(FactSales, FactSales[CustomerID]))
        < MIN(DimDate[Date])
    )
)
RETURN DIVIDE(CustomersRetained, CustomersStart)

Customer Churn Rate = 1 - [Customer Retention Rate]

Customer Lifetime Value =
[Average Order Value] * [Average Orders per Customer] * [Gross Margin]

Revenue from New Customers =
CALCULATE(
    [Total Revenue],
    FILTER(
        FactSales,
        FactSales[OrderDate] = CALCULATE(
            MIN(FactSales[OrderDate]),
            ALLEXCEPT(FactSales, FactSales[CustomerID])
        )
    )
)

Revenue from Returning Customers = [Total Revenue] - [Revenue from New Customers]

Customers with Multiple Services =
CALCULATE(
    DISTINCTCOUNT(FactSales[CustomerID]),
    FILTER(
        SUMMARIZE(FactSales, FactSales[CustomerID], "ServiceCount", DISTINCTCOUNT(FactSales[ServiceTypeID])),
        [ServiceCount] > 1
    )
)

Cross-Sell Rate = DIVIDE([Customers with Multiple Services], [Unique Customers])

Average Customer Tenure Days =
AVERAGEX(
    VALUES(FactSales[CustomerID]),
    DATEDIFF(
        CALCULATE(MIN(FactSales[OrderDate]), ALLEXCEPT(FactSales, FactSales[CustomerID])),
        TODAY(),
        DAY
    )
)

Top 10% Customer Revenue =
CALCULATE(
    [Total Revenue],
    TOPN(
        DIVIDE(DISTINCTCOUNT(FactSales[CustomerID]), 10),
        VALUES(FactSales[CustomerID]),
        CALCULATE([Total Revenue]),
        DESC
    )
)

Top 10% Revenue Share = DIVIDE([Top 10% Customer Revenue], [Total Revenue])`,
  },
  {
    title: "Kundsegmentering & Riskanalys", language: "dax",
    description: "Segmentering: At Risk, Lost, VIP/Loyal/Active/New, NPS, churn risk",
    subcategory_id: "pb-customers", tags: ["dax","customers","retention","hemfrid"],
    code: `// === KUNDSEGMENTERING & RISKANALYS ===

Days Since Last Order =
DATEDIFF(MAX(FactSales[OrderDate]), TODAY(), DAY)

At Risk Customers =
CALCULATE(
    DISTINCTCOUNT(FactSales[CustomerID]),
    FILTER(
        VALUES(FactSales[CustomerID]),
        CALCULATE(DATEDIFF(MAX(FactSales[OrderDate]), TODAY(), DAY)) > 90
        && CALCULATE(DATEDIFF(MAX(FactSales[OrderDate]), TODAY(), DAY)) <= 180
    )
)

Lost Customers =
CALCULATE(
    DISTINCTCOUNT(FactSales[CustomerID]),
    FILTER(
        VALUES(FactSales[CustomerID]),
        CALCULATE(DATEDIFF(MAX(FactSales[OrderDate]), TODAY(), DAY)) > 180
    )
)

Customer Segment =
SWITCH(
    TRUE(),
    [Days Since Last Order] <= 30 && [Total Orders] >= 6, "VIP",
    [Days Since Last Order] <= 60 && [Total Orders] >= 3, "Loyal",
    [Days Since Last Order] <= 30, "Active",
    [Days Since Last Order] <= 90, "At Risk",
    [Days Since Last Order] <= 180, "Dormant",
    "Lost"
)

NPS Score =
VAR Promoters = CALCULATE(COUNTROWS(FactSurveys), FactSurveys[Score] >= 9)
VAR Detractors = CALCULATE(COUNTROWS(FactSurveys), FactSurveys[Score] <= 6)
VAR TotalResponses = COUNTROWS(FactSurveys)
RETURN
DIVIDE(Promoters - Detractors, TotalResponses) * 100

Average Satisfaction Score = AVERAGE(FactSurveys[Score])

Complaint Rate = DIVIDE(
    CALCULATE(COUNTROWS(FactComplaints)),
    [Total Orders]
)`,
  },
  {
    title: "Workforce & Operations", language: "dax",
    description: "Personal och drift: revenue per anställd, utilization, sjukfrånvaro, on-time rate",
    subcategory_id: "pb-workforce", tags: ["dax","workforce","operations","hemfrid"],
    code: `// === WORKFORCE & OPERATIONS ===

Total Employees = DISTINCTCOUNT(DimEmployee[EmployeeID])

Active Employees =
CALCULATE(
    DISTINCTCOUNT(DimEmployee[EmployeeID]),
    DimEmployee[IsActive] = TRUE()
)

Revenue per Employee = DIVIDE([Total Revenue], [Active Employees])

Orders per Employee = DIVIDE([Total Orders], [Active Employees])

Average Hours per Order = AVERAGEX(FactSales, FactSales[ServiceHours])

Total Service Hours = SUM(FactSales[ServiceHours])

Revenue per Service Hour = DIVIDE([Total Revenue], [Total Service Hours])

Cost per Service Hour = DIVIDE([Total Cost], [Total Service Hours])

Utilization Rate =
DIVIDE(
    [Total Service Hours],
    [Active Employees] * 8 * DISTINCTCOUNT(DimDate[WorkingDay])
)

Average Employee Rating = AVERAGE(FactSurveys[EmployeeRating])

Employee Turnover Rate =
VAR TerminatedCount = CALCULATE(
    DISTINCTCOUNT(DimEmployee[EmployeeID]),
    DimEmployee[TerminationDate] <> BLANK()
)
VAR AvgHeadcount = DIVIDE([Active Employees] + TerminatedCount + [Active Employees], 2)
RETURN DIVIDE(TerminatedCount, AvgHeadcount)

Sick Leave Rate =
DIVIDE(
    SUM(FactAttendance[SickDays]),
    SUM(FactAttendance[WorkingDays])
)

Average Travel Time Minutes = AVERAGE(FactSales[TravelTimeMinutes])

On Time Completion Rate =
DIVIDE(
    CALCULATE(COUNTROWS(FactSales), FactSales[CompletedOnTime] = TRUE()),
    [Total Completed Orders]
)

Rescheduled Orders =
CALCULATE(COUNTROWS(FactSales), FactSales[WasRescheduled] = TRUE())

Reschedule Rate = DIVIDE([Rescheduled Orders], [Total Orders])

Overtime Hours = CALCULATE(SUM(FactAttendance[Hours]), FactAttendance[IsOvertime] = TRUE())

Overtime Rate = DIVIDE([Overtime Hours], [Total Service Hours])

Team Capacity =
[Active Employees] * 8 * DISTINCTCOUNT(DimDate[WorkingDay])

Capacity Utilization Gap = [Team Capacity] - [Total Service Hours]

Orders per Team =
DIVIDE([Total Orders], DISTINCTCOUNT(DimEmployee[TeamID]))`,
  },
  {
    title: "Geografisk Analys", language: "dax",
    description: "Regionmått: marknadsandel, revenue per capita, regional ranking, growth by area",
    subcategory_id: "pb-geo", tags: ["dax","geographic","region","hemfrid"],
    code: `// === GEOGRAFISK ANALYS ===

Revenue by Region =
CALCULATE([Total Revenue], VALUES(DimRegion[Region]))

Unique Customers by Region =
CALCULATE([Unique Customers], VALUES(DimRegion[Region]))

Revenue per Capita by Region =
DIVIDE([Total Revenue], SUM(DimRegion[Population]))

Market Penetration =
DIVIDE(
    [Unique Customers],
    SUM(DimRegion[TotalHouseholds])
) * 100

Region Revenue Share =
DIVIDE(
    [Total Revenue],
    CALCULATE([Total Revenue], REMOVEFILTERS(DimRegion))
)

Region Revenue Rank =
RANKX(ALL(DimRegion[Region]), [Total Revenue],, DESC, DENSE)

Fastest Growing Region =
FIRSTNONBLANK(
    TOPN(1, VALUES(DimRegion[Region]), [Revenue YoY %], DESC),
    1
)

Average Distance to Customer km = AVERAGE(FactSales[DistanceKm])

Revenue per km2 =
DIVIDE([Total Revenue], SUM(DimRegion[AreaKm2]))

New Markets Revenue =
CALCULATE(
    [Total Revenue],
    FILTER(
        DimRegion,
        DimRegion[LaunchDate] >= DATE(YEAR(TODAY()), 1, 1)
    )
)`,
  },
  {
    title: "RUT-specifika Measures", language: "dax",
    description: "RUT-avdrag: RUT-andel, utrymme kvar, kunder nära tak (75 000 kr)",
    subcategory_id: "pb-rut", tags: ["dax","rut","rut-avdrag","hemfrid"],
    code: `// === RUT-SPECIFIKA MEASURES ===

Total RUT Deduction = SUM(FactSales[RUT_Amount])

RUT per Customer = DIVIDE([Total RUT Deduction], [Unique Customers])

RUT per Order = DIVIDE([Total RUT Deduction], [Total Orders])

RUT Share of Revenue = DIVIDE([Total RUT Deduction], [Total Revenue])

Customer Price After RUT = [Average Order Value] - [RUT per Order]

RUT Eligible Revenue =
CALCULATE([Total Revenue], FactSales[IsRUTEligible] = TRUE())

RUT Utilization Rate =
DIVIDE([RUT Eligible Revenue], [Total Revenue])

Average RUT Percentage =
AVERAGEX(FactSales, DIVIDE(FactSales[RUT_Amount], FactSales[Revenue]))

RUT YoY Change = [Total RUT Deduction] - CALCULATE([Total RUT Deduction], DATEADD(DimDate[Date], -1, YEAR))

RUT YoY % =
DIVIDE(
    [RUT YoY Change],
    CALCULATE([Total RUT Deduction], DATEADD(DimDate[Date], -1, YEAR))
)

Max RUT per Customer per Year = 75000

RUT Headroom per Customer =
[Max RUT per Customer per Year] - [RUT per Customer]

Customers Near RUT Cap =
CALCULATE(
    DISTINCTCOUNT(FactSales[CustomerID]),
    FILTER(
        SUMMARIZE(FactSales, FactSales[CustomerID], "YearlyRUT", SUM(FactSales[RUT_Amount])),
        [YearlyRUT] >= 60000
    )
)`,
  },
  {
    title: "Säsong & Trendanalys", language: "dax",
    description: "Säsongsmönster: seasonality index, holiday impact, summer dip, trend direction",
    subcategory_id: "pb-seasonal", tags: ["dax","seasonal","trend","hemfrid"],
    code: `// === SÄSONG & TRENDANALYS ===

Revenue by Weekday =
CALCULATE([Total Revenue], VALUES(DimDate[DayOfWeekName]))

Most Profitable Weekday =
FIRSTNONBLANK(
    TOPN(1, VALUES(DimDate[DayOfWeekName]), [Total Revenue], DESC),
    1
)

Seasonality Index =
DIVIDE(
    [Total Revenue],
    [Revenue Rolling 12M] / 12
)

Revenue by Quarter =
CALCULATE([Total Revenue], VALUES(DimDate[Quarter]))

Summer Dip Impact =
VAR SummerRevenue = CALCULATE([Total Revenue], DimDate[Month] IN {6, 7, 8})
VAR AvgQuarterRevenue = [Revenue Rolling 12M] / 4
RETURN DIVIDE(SummerRevenue - AvgQuarterRevenue, AvgQuarterRevenue)

Peak Month Revenue =
MAXX(
    SUMMARIZE(FactSales, DimDate[YearMonth], "MonthRev", [Total Revenue]),
    [MonthRev]
)

Holiday Impact =
CALCULATE(
    [Total Revenue],
    DimDate[IsHoliday] = TRUE()
)

Pre-Holiday Surge =
CALCULATE(
    [Total Revenue],
    FILTER(
        DimDate,
        DimDate[DaysToNextHoliday] >= 1 && DimDate[DaysToNextHoliday] <= 7
    )
)

Week Number Revenue =
CALCULATE([Total Revenue], VALUES(DimDate[WeekNumber]))

Moving Average 4 Weeks =
CALCULATE(
    [Total Revenue],
    DATESINPERIOD(DimDate[Date], MAX(DimDate[Date]), -28, DAY)
) / 4

Trend Direction =
VAR CurrentMonth = [Total Revenue]
VAR PreviousMonth = [Revenue PM]
VAR TwoMonthsAgo = CALCULATE([Total Revenue], DATEADD(DimDate[Date], -2, MONTH))
RETURN
SWITCH(
    TRUE(),
    CurrentMonth > PreviousMonth && PreviousMonth > TwoMonthsAgo, "\u2191 Accelerating",
    CurrentMonth > PreviousMonth, "\u2191 Growing",
    CurrentMonth < PreviousMonth && PreviousMonth < TwoMonthsAgo, "\u2193 Declining",
    CurrentMonth < PreviousMonth, "\u2193 Slowing",
    "\u2192 Stable"
)`,
  },
  {
    title: "Marketing & Acquisition", language: "dax",
    description: "Marknadsföring: CAC, Marketing ROI, conversion rate, payback period, channel performance",
    subcategory_id: "pb-marketing", tags: ["dax","marketing","acquisition","hemfrid"],
    code: `// === MARKETING & ACQUISITION ===

Customer Acquisition Cost =
DIVIDE(
    SUM(FactMarketingSpend[Amount]),
    [New Customers]
)

Marketing ROI =
DIVIDE(
    [Revenue from New Customers] - SUM(FactMarketingSpend[Amount]),
    SUM(FactMarketingSpend[Amount])
)

Cost per Lead = DIVIDE(SUM(FactMarketingSpend[Amount]), SUM(FactLeads[LeadCount]))

Lead Conversion Rate = DIVIDE([New Customers], SUM(FactLeads[LeadCount]))

Revenue per Marketing Krona =
DIVIDE([Total Revenue], SUM(FactMarketingSpend[Amount]))

Channel Revenue Share =
DIVIDE(
    [Total Revenue],
    CALCULATE([Total Revenue], REMOVEFILTERS(DimChannel))
)

Best Performing Channel =
FIRSTNONBLANK(
    TOPN(1, VALUES(DimChannel[ChannelName]), [Total Revenue], DESC),
    1
)

Referral Revenue =
CALCULATE([Total Revenue], DimChannel[ChannelName] = "Referral")

Referral Rate =
DIVIDE(
    CALCULATE([New Customers], DimChannel[ChannelName] = "Referral"),
    [New Customers]
)

Website Conversion Rate =
DIVIDE([Total Orders], SUM(FactWebTraffic[Sessions]))

Organic vs Paid Revenue Ratio =
DIVIDE(
    CALCULATE([Total Revenue], DimChannel[IsPaid] = FALSE()),
    CALCULATE([Total Revenue], DimChannel[IsPaid] = TRUE())
)

Payback Period Months =
DIVIDE(
    [Customer Acquisition Cost],
    [Revenue per Customer] / 12 * [Gross Margin]
)`,
  },
  {
    title: "Kvalitet & Klagomål", language: "dax",
    description: "Kvalitetsmått: redo rate, klagomålshantering, resolution time, service quality score",
    subcategory_id: "pb-quality", tags: ["dax","quality","complaints","hemfrid"],
    code: `// === KVALITET & KLAGOMÅL ===

Total Complaints = COUNTROWS(FactComplaints)

Complaints per 100 Orders = DIVIDE([Total Complaints], [Total Orders]) * 100

Complaint Resolution Rate =
DIVIDE(
    CALCULATE(COUNTROWS(FactComplaints), FactComplaints[IsResolved] = TRUE()),
    [Total Complaints]
)

Average Resolution Time Hours =
AVERAGEX(
    FactComplaints,
    DATEDIFF(FactComplaints[CreatedDate], FactComplaints[ResolvedDate], HOUR)
)

Redo Rate =
DIVIDE(
    CALCULATE(COUNTROWS(FactSales), FactSales[IsRedo] = TRUE()),
    [Total Completed Orders]
)

Cost of Quality Issues =
CALCULATE(
    SUM(FactSales[Cost]),
    FactSales[IsRedo] = TRUE()
)

Complaint Trend =
VAR CurrentPeriod = [Total Complaints]
VAR PreviousPeriod = CALCULATE([Total Complaints], DATEADD(DimDate[Date], -1, MONTH))
RETURN DIVIDE(CurrentPeriod - PreviousPeriod, PreviousPeriod)

Most Common Complaint Category =
FIRSTNONBLANK(
    TOPN(1, VALUES(FactComplaints[Category]), COUNTROWS(FactComplaints), DESC),
    1
)

Service Quality Score =
(1 - [Redo Rate]) * 0.4 +
(1 - [Complaint Rate]) * 0.3 +
[On Time Completion Rate] * 0.3`,
  },
  {
    title: "Forecasting & Targets", language: "dax",
    description: "Prognos: target achievement, run rate, projected year-end, gap to target",
    subcategory_id: "pb-forecast", tags: ["dax","forecast","targets","hemfrid"],
    code: `// === FORECASTING & TARGETS ===

Revenue Target = SUM(FactTargets[TargetRevenue])

Revenue vs Target = [Total Revenue] - [Revenue Target]

Revenue vs Target % = DIVIDE([Revenue vs Target], [Revenue Target])

Target Achievement = DIVIDE([Total Revenue], [Revenue Target])

Target Achievement Status =
SWITCH(
    TRUE(),
    [Target Achievement] >= 1.1, "\uD83D\uDFE2 Exceeding (+10%)",
    [Target Achievement] >= 1, "\uD83D\uDFE2 On Target",
    [Target Achievement] >= 0.9, "\uD83D\uDFE1 Close (-10%)",
    "\uD83D\uDD34 Behind"
)

Orders Target = SUM(FactTargets[TargetOrders])

Orders vs Target % = DIVIDE([Total Orders] - [Orders Target], [Orders Target])

Run Rate Annual =
[Total Revenue] / DATEDIFF(MIN(DimDate[Date]), MAX(DimDate[Date]), DAY) * 365

Projected Year End Revenue =
[Revenue YTD] + ([Revenue Rolling 3M] / 3) * (12 - MONTH(MAX(DimDate[Date])))

Days to Target =
VAR DailyRate = [Revenue per Working Day]
VAR Remaining = [Revenue Target] - [Total Revenue]
RETURN IF(DailyRate > 0, DIVIDE(Remaining, DailyRate), BLANK())

Gap to Target = MAX(0, [Revenue Target] - [Total Revenue])

Required Daily Revenue to Hit Target =
DIVIDE(
    [Gap to Target],
    CALCULATE(
        DISTINCTCOUNT(DimDate[Date]),
        DimDate[Date] > TODAY() && DimDate[Date] <= EOMONTH(TODAY(), 0)
    )
)`,
  },
  {
    title: "Comparative & Ranking", language: "dax",
    description: "Jämförelser: RANKX, percentiler, Pareto 80/20, index vs average, best month ever",
    subcategory_id: "pb-ranking", tags: ["dax","ranking","comparative","hemfrid"],
    code: `// === COMPARATIVE & RANKING ===

Revenue Rank by Service =
RANKX(ALL(DimService[ServiceType]), [Total Revenue],, DESC, DENSE)

Revenue Rank by Region =
RANKX(ALL(DimRegion[Region]), [Total Revenue],, DESC, DENSE)

Revenue Rank by Employee =
RANKX(ALL(DimEmployee[EmployeeName]), [Total Revenue],, DESC, DENSE)

Percentile Rank =
DIVIDE(
    COUNTROWS(
        FILTER(
            ALL(DimRegion[Region]),
            CALCULATE([Total Revenue]) < [Total Revenue]
        )
    ),
    COUNTROWS(ALL(DimRegion[Region]))
)

Above Average Flag =
IF(
    [Total Revenue] > CALCULATE([Total Revenue], ALL()) / DISTINCTCOUNT(DimRegion[Region]),
    "Above Average",
    "Below Average"
)

Pareto 80/20 Flag =
VAR CurrentRank = [Revenue Rank by Service]
VAR TotalItems = COUNTROWS(ALL(DimService[ServiceType]))
RETURN IF(CurrentRank <= TotalItems * 0.2, "Top 20%", "Bottom 80%")

Index vs Company Average =
DIVIDE(
    [Revenue per Employee],
    CALCULATE([Revenue per Employee], ALL())
) * 100

Best Month Ever =
MAXX(
    SUMMARIZE(ALL(DimDate), DimDate[YearMonth], "Rev", [Total Revenue]),
    [Rev]
)

Current Month vs Best Ever =
DIVIDE([Total Revenue], [Best Month Ever])`,
  },
  {
    title: "Helper & Utility Measures", language: "dax",
    description: "Hjälpmått: data freshness, formatting, conditional formatting values, KPI-pilar",
    subcategory_id: "pb-utility", tags: ["dax","utility","helper","hemfrid"],
    code: `// === HELPER & UTILITY MEASURES ===

Latest Data Date = MAX(FactSales[OrderDate])

Days Since Last Refresh = DATEDIFF([Latest Data Date], TODAY(), DAY)

Data Freshness Alert =
IF([Days Since Last Refresh] > 2, "\u26A0\uFE0F Data is " & [Days Since Last Refresh] & " days old", "\u2705 Data is current")

Selected Period Label =
FORMAT(MIN(DimDate[Date]), "YYYY-MM-DD") & " to " & FORMAT(MAX(DimDate[Date]), "YYYY-MM-DD")

Is Current Year = IF(YEAR(MAX(DimDate[Date])) = YEAR(TODAY()), TRUE(), FALSE())

Is Current Month = IF(YEAR(MAX(DimDate[Date])) = YEAR(TODAY()) && MONTH(MAX(DimDate[Date])) = MONTH(TODAY()), TRUE(), FALSE())

Formatted Revenue = FORMAT([Total Revenue], "#,##0 kr")

Formatted Percentage = FORMAT([Revenue YoY %], "+0.0%;-0.0%;0.0%")

Dynamic Title Revenue =
"Revenue: " & FORMAT([Total Revenue], "#,##0 kr") &
" (" & FORMAT([Revenue YoY %], "+0.0%;-0.0%") & " YoY)"

Conditional Formatting Value =
SWITCH(
    TRUE(),
    [Revenue YoY %] >= 0.1, 3,
    [Revenue YoY %] >= 0, 2,
    [Revenue YoY %] >= -0.1, 1,
    0
)

KPI Arrow =
SWITCH(
    TRUE(),
    [Revenue MoM %] > 0.05, "\u25B2",
    [Revenue MoM %] > 0, "\u25B3",
    [Revenue MoM %] > -0.05, "\u25BD",
    "\u25BC"
)

Blank Row Handler =
IF(ISBLANK([Total Revenue]), 0, [Total Revenue])`,
  },
];

// ─── DAX import ───────────────────────────────────────────────────────────────

async function importDaxMeasures(env: Env): Promise<Response> {
  const measures = DAX_MEASURES;
  if (!measures.length) {
    return json({
      error: 'dax-measures.json is empty. Run: node scripts/parse-dax-measures.js, then redeploy.',
    }, 400);
  }

  let imported = 0;
  let skipped  = 0;
  const BATCH  = 100;

  for (let i = 0; i < measures.length; i += BATCH) {
    const chunk = measures.slice(i, i + BATCH);
    const stmts = chunk.map(s => {
      const id   = crypto.randomUUID();
      const tags = JSON.stringify(Array.isArray(s.tags) ? s.tags : []);
      return env.DB.prepare(`
        INSERT OR IGNORE INTO snippets (id, title, language, code, description, subcategory_id, tags, is_public)
        SELECT ?, ?, ?, ?, ?, ?, ?, 0
        WHERE NOT EXISTS (
          SELECT 1 FROM snippets WHERE title = ? AND subcategory_id IS ?
        )
      `).bind(
        id, s.title, s.language, s.code, s.description ?? null, s.subcategory_id, tags,
        s.title, s.subcategory_id
      );
    });

    const results = await env.DB.batch(stmts);
    for (const r of results) {
      if ((r.meta?.changes ?? 0) > 0) imported++;
      else skipped++;
    }
  }

  return json({ imported, skipped, total: measures.length });
}

// ─── Bulk snippet import ──────────────────────────────────────────────────────

interface BulkSnippet {
  title:          string;
  language:       string;
  code:           string;
  description?:   string;
  subcategory_id?: string | null;
  tags?:          string[];
}

async function bulkCreateSnippets(request: Request, env: Env): Promise<Response> {
  let body: { snippets?: unknown };
  try { body = await request.json() as { snippets?: unknown }; }
  catch { return json({ error: 'Invalid JSON' }, 400); }

  const raw = body.snippets;
  if (!Array.isArray(raw) || raw.length === 0) {
    return json({ error: '`snippets` array required' }, 400);
  }

  const snippets = raw as BulkSnippet[];
  let imported = 0;
  let skipped  = 0;

  // Batch in groups of 100 (D1 batch limit).
  const BATCH = 100;
  for (let i = 0; i < snippets.length; i += BATCH) {
    const chunk = snippets.slice(i, i + BATCH);
    const stmts = chunk.map(s => {
      const id   = crypto.randomUUID();
      const tags = JSON.stringify(Array.isArray(s.tags) ? s.tags : []);
      return env.DB.prepare(`
        INSERT OR IGNORE INTO snippets (id, title, language, code, description, subcategory_id, tags, is_public)
        SELECT ?, ?, ?, ?, ?, ?, ?, 0
        WHERE NOT EXISTS (
          SELECT 1 FROM snippets WHERE title = ? AND subcategory_id IS ?
        )
      `).bind(
        id, s.title, s.language, s.code ?? '', s.description ?? null, s.subcategory_id ?? null, tags,
        s.title, s.subcategory_id ?? null
      );
    });

    const results = await env.DB.batch(stmts);
    for (const r of results) {
      if ((r.meta?.changes ?? 0) > 0) imported++;
      else skipped++;
    }
  }

  return json({ imported, skipped, total: snippets.length });
}

// ─── Artworks CRUD ────────────────────────────────────────────────────────────

async function listArtworks(url: URL, env: Env): Promise<Response> {
  const artist  = url.searchParams.get('artist')    ?? '';
  const school  = url.searchParams.get('school')    ?? '';
  const search  = url.searchParams.get('search')    ?? '';
  const sort    = url.searchParams.get('sort')      ?? 'added_at';
  const order   = url.searchParams.get('order')     ?? 'desc';
  const limit   = Math.min(Math.max(1, parseInt(url.searchParams.get('limit')  ?? '50')), 200);
  const offset  = Math.max(0,          parseInt(url.searchParams.get('offset') ?? '0'));
  const favOnly = url.searchParams.get('favorites') === '1';

  const VALID_SORTS: Record<string, string> = {
    title: 'title', artist: 'artist', date_display: 'date_display', added_at: 'added_at',
  };
  const sortCol = VALID_SORTS[sort] ?? 'added_at';
  const sortDir = order === 'asc' ? 'ASC' : 'DESC';

  const conditions: string[] = [];
  const params: unknown[]    = [];
  if (artist)  { conditions.push('artist = ?');        params.push(artist); }
  if (school)  { conditions.push('school = ?');        params.push(school); }
  if (search)  { conditions.push('title LIKE ?');      params.push(`%${search}%`); }
  if (favOnly) { conditions.push('is_favorite = 1'); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const [rows, countRow, schools, artists] = await Promise.all([
    env.DB.prepare(`SELECT * FROM artworks ${where} ORDER BY ${sortCol} ${sortDir} LIMIT ? OFFSET ?`)
      .bind(...params, limit, offset).all<Row>(),
    env.DB.prepare(`SELECT COUNT(*) as cnt FROM artworks ${where}`)
      .bind(...params).first<{ cnt: number }>(),
    env.DB.prepare('SELECT DISTINCT school FROM artworks WHERE school IS NOT NULL ORDER BY school')
      .all<{ school: string }>(),
    env.DB.prepare('SELECT DISTINCT artist FROM artworks WHERE artist IS NOT NULL ORDER BY artist')
      .all<{ artist: string }>(),
  ]);

  return json({
    items:   rows.results,
    total:   countRow?.cnt ?? 0,
    limit,
    offset,
    schools: schools.results.map(r => r.school),
    artists: artists.results.map(r => r.artist),
  });
}

async function getArtwork(id: string, env: Env): Promise<Response> {
  const row = await env.DB.prepare('SELECT * FROM artworks WHERE id = ?').bind(id).first<Row>();
  if (!row) return json({ error: 'not found' }, 404);
  return json(row);
}

async function deleteArtwork(id: string, env: Env): Promise<Response> {
  await env.DB.prepare('DELETE FROM artworks WHERE id = ?').bind(id).run();
  return json({ success: true });
}

async function toggleFavorite(id: string, env: Env): Promise<Response> {
  await env.DB.prepare(
    'UPDATE artworks SET is_favorite = CASE WHEN is_favorite = 1 THEN 0 ELSE 1 END WHERE id = ?'
  ).bind(id).run();
  const row = await env.DB.prepare('SELECT is_favorite FROM artworks WHERE id = ?')
    .bind(id).first<{ is_favorite: number }>();
  return json({ is_favorite: row?.is_favorite ?? 0 });
}

async function importArtworks(request: Request, env: Env): Promise<Response> {
  let items: unknown[];
  try { items = await request.json() as unknown[]; }
  catch { return json({ error: 'invalid JSON' }, 400); }
  if (!Array.isArray(items)) return json({ error: 'expected array' }, 400);

  const stmts = items.map((item: unknown) => {
    const w = item as Record<string, unknown>;
    return env.DB.prepare(
      `INSERT OR IGNORE INTO artworks
         (id, title, artist, date_display, medium, dimensions, school, image_url,
          thumbnail_url, source_museum, source_id, source_url, description, tags)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      w.id, w.title, w.artist,
      w.date_display ?? null, w.medium ?? null, w.dimensions ?? null, w.school ?? null,
      w.image_url ?? null, w.thumbnail_url ?? null, w.source_museum ?? null,
      w.source_id ?? null, w.source_url ?? null, w.description ?? null,
      Array.isArray(w.tags) ? JSON.stringify(w.tags) : (w.tags ?? null)
    );
  });

  let imported = 0;
  for (let i = 0; i < stmts.length; i += 100) {
    await env.DB.batch(stmts.slice(i, i + 100));
    imported += Math.min(100, stmts.length - i);
  }
  return json({ imported });
}

// ─── Redon import ─────────────────────────────────────────────────────────────

interface ArtworkRecord {
  id: string; title: string; artist: string;
  date_display: string | null; medium: string | null; dimensions: string | null;
  school: string | null; image_url: string | null; thumbnail_url: string | null;
  source_museum: string; source_id: string; source_url: string | null;
  description: string | null; tags: string;
}

async function fetchRedon(env: Env): Promise<Response> {
  const [articRes, metRes, clevRes] = await Promise.allSettled([
    fetchARTICRedon(),
    fetchMetRedon(),
    fetchClevelandRedon(),
  ]);

  const artic     = articRes.status === 'fulfilled' ? articRes.value     : [];
  const met       = metRes.status   === 'fulfilled' ? metRes.value       : [];
  const cleveland = clevRes.status  === 'fulfilled' ? clevRes.value      : [];
  const all       = [...artic, ...met, ...cleveland];

  for (let i = 0; i < all.length; i += 100) {
    const batch = all.slice(i, i + 100).map(w =>
      env.DB.prepare(
        `INSERT OR IGNORE INTO artworks
           (id, title, artist, date_display, medium, dimensions, school, image_url,
            thumbnail_url, source_museum, source_id, source_url, description, tags)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        w.id, w.title, w.artist, w.date_display, w.medium, w.dimensions, w.school,
        w.image_url, w.thumbnail_url, w.source_museum, w.source_id, w.source_url,
        w.description, w.tags
      )
    );
    await env.DB.batch(batch);
  }

  return json({
    imported: { artic: artic.length, met: met.length, cleveland: cleveland.length, total: all.length },
    errors: {
      artic:     articRes.status === 'rejected' ? String((articRes as PromiseRejectedResult).reason) : null,
      met:       metRes.status   === 'rejected' ? String((metRes   as PromiseRejectedResult).reason) : null,
      cleveland: clevRes.status  === 'rejected' ? String((clevRes  as PromiseRejectedResult).reason) : null,
    },
  });
}

async function fetchARTICRedon(): Promise<ArtworkRecord[]> {
  const works: ArtworkRecord[] = [];
  for (const from of [0, 100]) {
    const res = await fetch('https://api.artic.edu/api/v1/artworks/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        q: 'Odilon Redon',
        query: { bool: { must: [
          { term: { artist_title: 'Odilon Redon' } },
          { exists: { field: 'image_id' } },
        ]}},
        fields: ['id','title','artist_title','date_display','medium_display','dimensions','image_id','description'],
        limit: 100, from,
      }),
    });
    if (!res.ok) continue;
    const data = await res.json() as { data?: Array<Record<string, unknown>> };
    for (const item of data.data ?? []) {
      if (!item.image_id) continue;
      const imgId = item.image_id as string;
      works.push({
        id:            `artic-${item.id}`,
        title:         String(item.title ?? ''),
        artist:        'Odilon Redon',
        date_display:  String(item.date_display ?? '') || null,
        medium:        String(item.medium_display ?? '') || null,
        dimensions:    String(item.dimensions ?? '') || null,
        school:        'Symbolism',
        image_url:     `https://www.artic.edu/iiif/2/${imgId}/full/1200,/0/default.jpg`,
        thumbnail_url: `https://www.artic.edu/iiif/2/${imgId}/full/400,/0/default.jpg`,
        source_museum: 'Art Institute of Chicago',
        source_id:     String(item.id),
        source_url:    `https://www.artic.edu/artworks/${item.id}`,
        description:   String(item.description ?? '') || null,
        tags:          '["redon","symbolism","french","artic"]',
      });
    }
  }
  return works;
}

async function fetchMetRedon(): Promise<ArtworkRecord[]> {
  const searchRes = await fetch(
    'https://collectionapi.metmuseum.org/public/collection/v1/search?q=odilon+redon&hasImages=true'
  );
  if (!searchRes.ok) return [];
  const searchData = await searchRes.json() as { objectIDs?: number[] };
  const ids = (searchData.objectIDs ?? []).slice(0, 200);

  const works: ArtworkRecord[] = [];
  for (let i = 0; i < ids.length; i += 10) {
    const batch = await Promise.allSettled(
      ids.slice(i, i + 10).map(id =>
        fetch(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`)
          .then(r => r.ok ? r.json() : null)
      )
    );
    for (const result of batch) {
      if (result.status !== 'fulfilled' || !result.value) continue;
      const obj = result.value as Record<string, unknown>;
      if (!obj.isPublicDomain || !obj.primaryImage) continue;
      const constituents = (obj.constituents ?? []) as Array<{ name: string }>;
      const isRedon = constituents.some(c => c.name === 'Odilon Redon') ||
                      String(obj.artistDisplayName ?? '').includes('Redon');
      if (!isRedon) continue;
      works.push({
        id:            `met-${obj.objectID}`,
        title:         String(obj.title ?? ''),
        artist:        'Odilon Redon',
        date_display:  String(obj.objectDate ?? '') || null,
        medium:        String(obj.medium ?? '') || null,
        dimensions:    String(obj.dimensions ?? '') || null,
        school:        'Symbolism',
        image_url:     String(obj.primaryImage),
        thumbnail_url: String(obj.primaryImageSmall ?? obj.primaryImage),
        source_museum: 'Metropolitan Museum of Art',
        source_id:     String(obj.objectID),
        source_url:    String(obj.objectURL ?? '') || null,
        description:   null,
        tags:          '["redon","symbolism","french","met"]',
      });
    }
  }
  return works;
}

async function fetchClevelandRedon(): Promise<ArtworkRecord[]> {
  const res = await fetch(
    'https://openaccess-api.clevelandart.org/api/artworks/?artists=Odilon+Redon&has_image=1&limit=100'
  );
  if (!res.ok) return [];
  const data = await res.json() as {
    data?: Array<{
      id: number; title: string; creation_date: string; technique: string;
      measurements: string; url: string;
      images?: { web?: { url: string }; print?: { url: string } };
    }>;
  };
  return (data.data ?? [])
    .filter(item => item.images?.web?.url)
    .map(item => ({
      id:            `cma-${item.id}`,
      title:         item.title ?? '',
      artist:        'Odilon Redon',
      date_display:  item.creation_date ?? null,
      medium:        item.technique ?? null,
      dimensions:    item.measurements ?? null,
      school:        'Symbolism',
      image_url:     item.images?.print?.url ?? item.images?.web?.url ?? null,
      thumbnail_url: item.images?.web?.url ?? null,
      source_museum: 'Cleveland Museum of Art',
      source_id:     String(item.id),
      source_url:    item.url ?? null,
      description:   null,
      tags:          '["redon","symbolism","french","cleveland"]',
    }));
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

// ─── Spotify ──────────────────────────────────────────────────────────────────

// Hardcoded redirect URI — must match the Spotify Developer Dashboard exactly.
// Uses the root page (always served by nginx) so Spotify's redirect lands safely.
// index.html detects ?code=&state= on load and exchanges via AJAX POST.
const SPOTIFY_REDIRECT = 'https://sp1e.se/';

// In-memory cache for now-playing (10s).
let nowPlayingCache: { data: unknown; expires: number } | null = null;

// Returns the Spotify authorize URL as JSON. Sets state cookie (Lax so it's sent on return).
// spotify-setup.html fetches this, then navigates to accounts.spotify.com.
async function handleSpotifyAuthUrl(request: Request, env: Env): Promise<Response> {
  await requireAuth(request, env);
  const state = crypto.randomUUID();
  const params = new URLSearchParams({
    client_id:     env.SPOTIFY_CLIENT_ID,
    response_type: 'code',
    redirect_uri:  SPOTIFY_REDIRECT,
    state,
    scope: 'user-read-currently-playing user-read-playback-state user-modify-playback-state',
  });
  const h = new Headers({ 'Content-Type': 'application/json', ...cors() });
  h.set('Set-Cookie', `spotify_oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`);
  return new Response(
    JSON.stringify({ url: `https://accounts.spotify.com/authorize?${params}` }),
    { status: 200, headers: h }
  );
}

// Called via POST from spotify-setup.html. Requires site auth + verifies state cookie.
async function handleSpotifyExchange(request: Request, env: Env): Promise<Response> {
  await requireAuth(request, env);

  let body: { code?: string; state?: string };
  try { body = await request.json() as typeof body; }
  catch { return json({ success: false, error: 'invalid_json' }, 400); }

  const { code, state } = body;
  if (!code || !state) return json({ success: false, error: 'missing_params' }, 400);

  const cookieState = getCookie(request, 'spotify_oauth_state');
  if (!cookieState || cookieState !== state) {
    return json({ success: false, error: 'state_mismatch' }, 403);
  }

  const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
    method:  'POST',
    headers: {
      'Content-Type':  'application/x-www-form-urlencoded',
      'Authorization': `Basic ${spotifyBasicAuth(env)}`,
    },
    body: new URLSearchParams({
      grant_type:   'authorization_code',
      code,
      redirect_uri: SPOTIFY_REDIRECT,
    }),
  });

  if (!tokenRes.ok) {
    const text = await tokenRes.text().catch(() => '');
    console.error('[spotify] exchange failed:', tokenRes.status, text);
    return json({ success: false, error: 'token_exchange_failed' });
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
       access_token  = excluded.access_token,
       refresh_token = excluded.refresh_token,
       expires_at    = excluded.expires_at,
       updated_at    = excluded.updated_at`
  ).bind(tokens.access_token, tokens.refresh_token, expiresAt, now).run();

  const h = new Headers({ 'Content-Type': 'application/json', ...cors() });
  h.append('Set-Cookie', 'spotify_oauth_state=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0');
  h.append('Set-Cookie', 'spotify_linked=1; Secure; SameSite=Strict; Path=/; Max-Age=31536000');
  return new Response(JSON.stringify({ success: true }), { status: 200, headers: h });
}

// Public — returns currently playing, or last played as fallback. 10s in-memory cache.
async function handleSpotifyNowPlaying(env: Env): Promise<Response> {
  const now = Date.now();
  if (nowPlayingCache && now < nowPlayingCache.expires) {
    return new Response(JSON.stringify(nowPlayingCache.data), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...cors() },
    });
  }

  const token = await getValidSpotifyToken(env);
  if (!token) {
    const data = { is_playing: false };
    nowPlayingCache = { data, expires: now + 10_000 };
    return json(data);
  }

  const res = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
    headers: { 'Authorization': `Bearer ${token}` },
  });

  let data: Record<string, unknown>;

  if (res.status === 204 || res.status === 404 || !res.ok) {
    data = await getRecentlyPlayed(token);
  } else {
    const raw = await res.json() as {
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
    if (!raw.is_playing || !raw.item) {
      data = await getRecentlyPlayed(token);
    } else {
      data = {
        is_playing:    true,
        track_name:    raw.item.name,
        artist_name:   raw.item.artists.map(a => a.name).join(', '),
        album_name:    raw.item.album.name,
        album_art_url: raw.item.album.images[0]?.url ?? null,
        duration_ms:   raw.item.duration_ms,
        progress_ms:   raw.progress_ms ?? 0,
        track_url:     raw.item.external_urls.spotify,
      };
    }
  }

  nowPlayingCache = { data, expires: now + 10_000 };
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...cors() },
  });
}

async function getRecentlyPlayed(token: string): Promise<Record<string, unknown>> {
  try {
    const res = await fetch('https://api.spotify.com/v1/me/player/recently-played?limit=1', {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) return { is_playing: false };
    const data = await res.json() as {
      items?: Array<{
        track: {
          name: string;
          duration_ms: number;
          external_urls: { spotify: string };
          artists: Array<{ name: string }>;
          album: { name: string; images: Array<{ url: string }> };
        };
      }>;
    };
    const item = data.items?.[0]?.track;
    if (!item) return { is_playing: false };
    return {
      is_playing:    false,
      track_name:    item.name,
      artist_name:   item.artists.map(a => a.name).join(', '),
      album_name:    item.album.name,
      album_art_url: item.album.images[0]?.url ?? null,
      duration_ms:   item.duration_ms,
      progress_ms:   0,
      track_url:     item.external_urls.spotify,
    };
  } catch {
    return { is_playing: false };
  }
}

// Protected — play/pause/next/previous on active Spotify device.
async function handleSpotifyControl(
  action: 'play' | 'pause' | 'next' | 'previous',
  request: Request,
  env: Env
): Promise<Response> {
  await requireAuth(request, env);
  const token = await getValidSpotifyToken(env);
  if (!token) return json({ error: 'not linked' }, 404);

  const endpoints: Record<string, { url: string; method: string }> = {
    play:     { url: 'https://api.spotify.com/v1/me/player/play',     method: 'PUT' },
    pause:    { url: 'https://api.spotify.com/v1/me/player/pause',    method: 'PUT' },
    next:     { url: 'https://api.spotify.com/v1/me/player/next',     method: 'POST' },
    previous: { url: 'https://api.spotify.com/v1/me/player/previous', method: 'POST' },
  };

  const { url: endpoint, method: m } = endpoints[action];
  const res = await fetch(endpoint, {
    method: m,
    headers: { 'Authorization': `Bearer ${token}` },
  });

  // Invalidate cache so the next poll reflects the change immediately.
  nowPlayingCache = null;

  if (res.status === 204 || res.ok) return json({ success: true });
  return json({ success: false }, res.status);
}

// Protected — removes stored tokens and clears the linked cookie.
async function handleSpotifyDisconnect(request: Request, env: Env): Promise<Response> {
  await requireAuth(request, env);
  await env.DB.prepare(`DELETE FROM spotify_tokens WHERE id = 'main'`).run().catch(() => {});
  const h = new Headers({ 'Content-Type': 'application/json', ...cors() });
  h.append('Set-Cookie', 'spotify_linked=; Secure; SameSite=Strict; Path=/; Max-Age=0');
  return new Response(JSON.stringify({ success: true }), { status: 200, headers: h });
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
