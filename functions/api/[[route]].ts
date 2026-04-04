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

  const [resource = '', id = '', sub = '', action = ''] = route.split('/');

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

    // ── Game (Mosquito) — requires site auth + game session cookie ───────────
    if (resource === 'game') {
      await requireAuth(request, env);
      if (id === 'create-character' && method === 'POST') return gameCreateCharacter(request, env);
      if (id === 'player'           && method === 'GET')  return gameGetPlayer(request, env);
      if (id === 'status'           && method === 'GET')  return gameGetStatus(request, env);
      if (id === 'drug-prices'      && method === 'GET')  return gameGetDrugPrices();
      if (id === 'npcs'             && method === 'GET')  return gameGetNpcs(env);
      if (id === 'simulate'         && method === 'GET')  return gameSimulate(env);
      if (id === 'hall-of-fame'     && method === 'GET')  return gameHallOfFame(env);
      if (id === 'new-round'        && method === 'POST') return gameNewRound(request, env);
      if (id === 'casino' && sub === 'blackjack' && action === 'state' && method === 'GET') {
        return gameGetBlackjackState(request, env);
      }
      if (id === 'casino' && sub === 'holdem' && action === 'state' && method === 'GET') {
        return gameGetHoldemState(request, env);
      }
      if (id === 'admin-auth'       && method === 'POST') return gameAdminAuth(request, env);
      if (id === 'admin-status'     && method === 'GET')  return gameAdminStatus(request, env);
      if (id === 'admin-logout'     && method === 'POST') return gameAdminLogout(request, env);
      if (id === 'admin'            && method === 'POST') return gameAdminCommand(request, env);
      if (id === 'action') {
        if (sub === 'blackjack') {
          if (action === 'start'  && method === 'POST') return gameActionBlackjackStart(request, env);
          if (action === 'hit'    && method === 'POST') return gameActionBlackjackHit(request, env);
          if (action === 'stand'  && method === 'POST') return gameActionBlackjackStand(request, env);
          if (action === 'double' && method === 'POST') return gameActionBlackjackDouble(request, env);
        }
        if (sub === 'holdem') {
          if (action === 'start' && method === 'POST') return gameActionHoldemStart(request, env);
          if (action === 'act'   && method === 'POST') return gameActionHoldemAct(request, env);
          if (action === 'next'  && method === 'POST') return gameActionHoldemNextHand(request, env);
          if (action === 'leave' && method === 'POST') return gameActionHoldemLeave(request, env);
        }
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
const GAME_ADMIN_COOKIE = 'game_admin_session';
const GAME_ADMIN_SESSION_TTL_MS = 2 * 60 * 60 * 1000;

// ── helpers ──────────────────────────────────────────────────────────────────

function getGameCookie(request: Request): string | null {
  const cookie = request.headers.get('Cookie') ?? '';
  const match  = cookie.match(/(?:^|;\s*)game_session=([^;]+)/);
  return match ? match[1] : null;
}

function setGameCookie(playerId: string): string {
  return `${GAME_COOKIE}=${playerId}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${60 * 60 * 24 * 30}`;
}

function getGameAdminCookie(request: Request): string | null {
  const cookie = request.headers.get('Cookie') ?? '';
  const match = cookie.match(/(?:^|;\s*)game_admin_session=([^;]+)/);
  return match ? match[1] : null;
}

function setGameAdminCookie(token: string, expires: Date): string {
  return `${GAME_ADMIN_COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Expires=${expires.toUTCString()}`;
}

function clearGameAdminCookie(): string {
  return `${GAME_ADMIN_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}

async function syncGamePlayerState(env: Env, player: Row): Promise<Row> {
  const now = Date.now();
  const prisonUntil = player.prison_until ? new Date(player.prison_until as string).getTime() : null;
  const hospitalUntil = player.hospital_until ? new Date(player.hospital_until as string).getTime() : null;
  const profession = String(player.profession ?? 'none').replace(/^changed:/, '') || 'none';
  const baseHpMax = Number(player.hp_max ?? 100);
  const maxHp = profession === 'torped' ? Math.max(baseHpMax, Math.round(baseHpMax * 1.2)) : baseHpMax;
  const shouldClampHp = Number(player.hp ?? maxHp) > maxHp;

  const shouldClearPrison =
    !!player.in_prison && (!prisonUntil || prisonUntil <= now);
  const shouldClearHospital =
    !!player.in_hospital && (!hospitalUntil || hospitalUntil <= now);

  if (!shouldClearPrison && !shouldClearHospital && !shouldClampHp) {
    return player;
  }

  const nextPlayer = {
    ...player,
    hp: shouldClampHp ? maxHp : player.hp,
    in_prison: shouldClearPrison ? 0 : player.in_prison,
    prison_until: shouldClearPrison ? null : player.prison_until,
    in_hospital: shouldClearHospital ? 0 : player.in_hospital,
    hospital_until: shouldClearHospital ? null : player.hospital_until,
  };

  await env.DB.prepare(
    `UPDATE game_players
     SET hp = ?, in_prison = ?, prison_until = ?, in_hospital = ?, hospital_until = ?
     WHERE id = ?`
  ).bind(
    nextPlayer.hp,
    nextPlayer.in_prison,
    nextPlayer.prison_until,
    nextPlayer.in_hospital,
    nextPlayer.hospital_until,
    player.id as string
  ).run();

  return nextPlayer;
}

async function requireGamePlayer(request: Request, env: Env): Promise<Row> {
  const pid = getGameCookie(request);
  if (!pid) throw new GameError('Ingen aktiv karaktär. Skapa en först.', 401);
  const round = await ensureActiveRound(env, { createIfMissing: false });
  const player = await env.DB.prepare('SELECT * FROM game_players WHERE id = ?').bind(pid).first<Row>();
  if (!player) throw new GameError('Karaktären hittades inte.', 404);
  if ((player.round_id as string) !== (round.id as string)) {
    throw new GameError('Rundan har avslutats. Starta en ny karaktär för nästa runda.', 409);
  }
  return syncGamePlayerState(env, player);
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
  const max       = Number(player.energy_max ?? 100);
  const stored    = Number(player.energy ?? 0);
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

async function nextRoundNumber(env: Env): Promise<number> {
  const row = await env.DB.prepare(`SELECT MAX(round_number) as n FROM game_rounds`).first<{ n: number | string | null }>();
  return Number(row?.n ?? 0) + 1;
}

async function createGameRound(env: Env, roundNumber: number): Promise<Row> {
  const id = `round-${String(roundNumber).padStart(3, '0')}`;
  const startDate = new Date();
  const endDate = new Date(startDate.getTime() + 30 * 24 * 60 * 60 * 1000);
  await env.DB.prepare(
    `INSERT INTO game_rounds (id, round_number, start_date, end_date, is_active)
     VALUES (?, ?, ?, ?, 1)`
  ).bind(id, roundNumber, startDate.toISOString(), endDate.toISOString()).run();
  const round = await env.DB.prepare(`SELECT * FROM game_rounds WHERE id = ?`).bind(id).first<Row>();
  if (!round) throw new GameError('Could not initialize game round.', 500);
  return round;
}

async function ensureActiveRound(env: Env, options: { createIfMissing?: boolean } = {}): Promise<Row> {
  const createIfMissing = options.createIfMissing !== false;
  let round = await getActiveRound(env);
  if (round) {
    const ended = new Date(round.end_date as string).getTime() <= Date.now();
    if (!ended) return round;
    await endRound(env, round);
    if (!createIfMissing) throw new GameError('Rundan har avslutats. Starta nästa runda för att fortsätta.', 409);
    round = null;
  }

  if (!createIfMissing) {
    throw new GameError('Ingen aktiv runda. Starta nästa runda för att fortsätta.', 409);
  }

  return createGameRound(env, await nextRoundNumber(env));
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

function xpFloorForLevel(level: number): number {
  const target = Math.max(1, Math.min(50, Math.floor(level)));
  let xp = 0;
  for (let lvl = 1; lvl < target; lvl++) xp += lvl * 1000;
  return xp;
}

function parseIntegerSpec(raw: string): number | null {
  if (!/^[+-]?\d+$/.test(raw.trim())) return null;
  return Number.parseInt(raw, 10);
}

function resolveNumericCommand(
  current: number,
  spec: string,
  opts: { min?: number; max?: number; allowMaxKeyword?: boolean } = {}
): number | null {
  const trimmed = spec.trim().toLowerCase();
  if (!trimmed) return null;
  if (opts.allowMaxKeyword && trimmed === 'max' && typeof opts.max === 'number') {
    return opts.max;
  }

  const parsed = parseIntegerSpec(trimmed);
  if (parsed === null) return null;
  let next = /^[+-]/.test(trimmed) ? current + parsed : parsed;
  if (typeof opts.min === 'number') next = Math.max(opts.min, next);
  if (typeof opts.max === 'number') next = Math.min(opts.max, next);
  return next;
}

function tokenizeCommand(input: string): string[] {
  const parts: string[] = [];
  for (const match of input.matchAll(/"([^"]+)"|'([^']+)'|(\S+)/g)) {
    parts.push(match[1] ?? match[2] ?? match[3] ?? '');
  }
  return parts;
}

function normalizeProfessionInput(raw: string): string | null {
  const key = raw.trim().toLowerCase();
  const map: Record<string, string> = {
    none: 'none',
    ranare: 'rånare',
    rånare: 'rånare',
    langare: 'langare',
    torped: 'torped',
    hallick: 'hallick',
    bedragare: 'bedragare',
  };
  return map[key] ?? null;
}

function normalizeSideInput(raw: string): string | null {
  const key = raw.trim().toLowerCase();
  const map: Record<string, string> = {
    east: 'eastside',
    eastside: 'eastside',
    west: 'westside',
    westside: 'westside',
  };
  return map[key] ?? null;
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

function activeProfession(value: Row | string | null | undefined): string {
  const raw = typeof value === 'string'
    ? value
    : String(value?.profession ?? 'none');
  return raw.replace(/^changed:/, '') || 'none';
}

function effectiveStat(player: Row, stat: 'strength' | 'intelligence' | 'charisma' | 'stealth'): number {
  const base = Number(player[stat] ?? 10);
  const multiplier = 1 + profBonus(activeProfession(player), 'all_stats');
  return Math.min(100, Math.round(base * multiplier));
}

function effectiveHpMax(player: Row): number {
  const base = Number(player.hp_max ?? 100);
  const multiplier = 1 + profBonus(activeProfession(player), 'hp_max');
  return Math.max(base, Math.round(base * multiplier));
}

function effectivePlayerView(player: Row): Row {
  const hpMax = effectiveHpMax(player);
  const hp = Math.max(0, Math.min(Number(player.hp ?? hpMax), hpMax));
  return {
    ...player,
    hp,
    hp_max: hpMax,
    strength: effectiveStat(player, 'strength'),
    intelligence: effectiveStat(player, 'intelligence'),
    charisma: effectiveStat(player, 'charisma'),
    stealth: effectiveStat(player, 'stealth'),
  };
}

function xpWithBonus(player: Row, baseXp: number): number {
  return Math.max(0, Math.round(baseXp * (1 + profBonus(activeProfession(player), 'xp_gain'))));
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

async function loadGamePlayerById(env: Env, playerId: string): Promise<Row> {
  const row = await env.DB.prepare(`SELECT * FROM game_players WHERE id = ?`).bind(playerId).first<Row>();
  if (!row) throw new GameError('Character not found.', 404);
  return syncGamePlayerState(env, row);
}

async function ensureGameAdminTables(env: Env): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS game_admin_sessions (
         token TEXT PRIMARY KEY,
         expires_at TEXT NOT NULL,
         created_at TEXT DEFAULT (datetime('now'))
       )`
    ),
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS game_admin_audit (
         id TEXT PRIMARY KEY,
         player_id TEXT,
         player_name TEXT,
         command TEXT NOT NULL,
         outcome TEXT NOT NULL,
         details TEXT,
         created_at TEXT DEFAULT (datetime('now'))
       )`
    ),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_game_admin_sessions_expires ON game_admin_sessions (expires_at)`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_game_admin_audit_created ON game_admin_audit (created_at DESC)`),
  ]);
}

async function getGameAdminSession(request: Request, env: Env): Promise<{ token: string; expires_at: string } | null> {
  await ensureGameAdminTables(env);
  await env.DB.prepare(`DELETE FROM game_admin_sessions WHERE expires_at <= datetime('now')`).run().catch(() => {});
  const token = getGameAdminCookie(request);
  if (!token) return null;
  const row = await env.DB
    .prepare(`SELECT token, expires_at FROM game_admin_sessions WHERE token = ? AND expires_at > datetime('now')`)
    .bind(token)
    .first<{ token: string; expires_at: string }>();
  return row ?? null;
}

async function requireGameAdmin(request: Request, env: Env): Promise<{ token: string; expires_at: string }> {
  const session = await getGameAdminSession(request, env);
  if (!session) throw new GameError('Admin unlock required.', 403);
  return session;
}

async function logGameAdminAudit(
  env: Env,
  payload: { player?: Row | null; command: string; outcome: 'ok' | 'error' | 'auth' | 'logout'; details: string }
): Promise<void> {
  await ensureGameAdminTables(env);
  await env.DB.prepare(
    `INSERT INTO game_admin_audit (id, player_id, player_name, command, outcome, details)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(
    crypto.randomUUID(),
    payload.player?.id ? String(payload.player.id) : null,
    payload.player?.name ? String(payload.player.name) : null,
    payload.command,
    payload.outcome,
    payload.details
  ).run().catch(() => {});
}

function adminHelp(): { message: string; commands: string[] } {
  return {
    message: 'Admin console ready. Commands mutate the current character only.',
    commands: [
      'help',
      'me',
      'cash <n|+n|-n>',
      'bank <n|+n|-n>',
      'respect <n|+n|-n>',
      'xp <n|+n|-n>',
      'level <n>',
      'hp <n|+n|-n|max>',
      'energy <n|+n|-n|max>',
      'stat <strength|intelligence|charisma|stealth|all> <n|+n|-n>',
      'profession <none|ranare|langare|torped|hallick|bedragare>',
      'side <east|west>',
      'prison <minutes|off>',
      'hospital <minutes|off>',
      'free',
      'vehicle <volvo240|golf_gti|bmw_m3|skyline_r34|lambo>',
      'property <stash_house|nightclub|drug_lab|garage|safehouse> [level]',
      'clearlog',
      'rich',
      'maxout',
      'legend',
      'chaos',
    ],
  };
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
  try {
    const round = await ensureActiveRound(env);
    const currentPid = getGameCookie(request);

    if (currentPid) {
      const existingSessionPlayer = await env.DB
        .prepare('SELECT * FROM game_players WHERE id = ? AND round_id = ?')
        .bind(currentPid, round.id as string)
        .first<Row>();

      if (existingSessionPlayer) {
        const player = await syncGamePlayerState(env, existingSessionPlayer);
        return new Response(JSON.stringify({ player, existing: true }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Set-Cookie': setGameCookie(currentPid),
            ...cors(),
          },
        });
      }
    }

    let body: { name?: string; side?: string };
    try {
      body = await request.json<{ name?: string; side?: string }>();
    } catch {
      return gameJson({ error: 'Ogiltig förfrågan.' }, 400);
    }

    const name = (body.name ?? '').trim().slice(0, 24);
    const side = body.side === 'westside' ? 'westside' : 'eastside';
    if (!name || name.length < 2)
      return gameJson({ error: 'Namnet måste vara 2–24 tecken.' }, 400);

    if (!/^[\w\s\u00C0-\u024F]+$/u.test(name))
      return gameJson({ error: 'Namnet innehåller otillåtna tecken.' }, 400);

    const existing = await env.DB.prepare(
      `SELECT id FROM game_players WHERE name = ? AND round_id = ?`
    ).bind(name, round.id as string).first();
    if (existing) {
      const roundPopulation = await env.DB
        .prepare('SELECT COUNT(*) AS total FROM game_players WHERE round_id = ?')
        .bind(round.id as string)
        .first<{ total: number | string }>();

      if (Number(roundPopulation?.total ?? 0) <= 1) {
        const existingPlayer = await env.DB
          .prepare('SELECT * FROM game_players WHERE id = ?')
          .bind(existing.id as string)
          .first<Row>();

        if (existingPlayer) {
          const player = await syncGamePlayerState(env, existingPlayer);
          return new Response(JSON.stringify({ player, existing: true }), {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              'Set-Cookie': setGameCookie(existing.id as string),
              ...cors(),
            },
          });
        }
      }

      return gameJson({ error: 'Det namnet är upptaget. Välj ett annat.' }, 409);
    }

    const pid = crypto.randomUUID();
    try {
      await env.DB.prepare(`INSERT INTO game_players (id, round_id, name, side) VALUES (?, ?, ?, ?)`)
        .bind(pid, round.id as string, name, side).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('UNIQUE')) return gameJson({ error: 'Det namnet är upptaget. Välj ett annat.' }, 409);
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
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('no such table')) {
      return gameJson({ error: 'Speldatabasen är inte initierad. Kör game-schema.sql och game-seed.sql.' }, 500);
    }
    throw e;
  }
}

async function gameGetPlayer(request: Request, env: Env): Promise<Response> {
  let player: Row;
  try { player = await requireGamePlayer(request, env); }
  catch (e) { return gameJson({ error: (e as GameError).message }, (e as GameError).status ?? 401); }

  const pid     = player.id as string;
  const energy  = calcEnergy(player);
  const viewPlayer = effectivePlayerView(player);

  // Fetch inventory, actions, and properties in parallel
  const [invRes, logRes, propRes] = await Promise.all([
    env.DB.prepare('SELECT * FROM game_inventory WHERE player_id = ?').bind(pid).all<Row>(),
    env.DB.prepare('SELECT * FROM game_action_log WHERE player_id = ? ORDER BY created_at DESC LIMIT 20').bind(pid).all<Row>(),
    env.DB.prepare('SELECT * FROM game_properties WHERE player_id = ?').bind(pid).all<Row>(),
  ]);
  const viewProperties = propRes.results.map(prop => ({
    ...prop,
    income_per_hour: propertyIncomeForPlayer(
      player,
      String(prop.property_type ?? ''),
      Number(prop.level ?? 1),
      Number(prop.income_per_hour ?? 0)
    ),
  }));

  // Prison/hospital time remaining
  const now          = Date.now();
  const prisonUntil  = player.prison_until  ? new Date(player.prison_until  as string).getTime() : null;
  const hospitalUntil= player.hospital_until? new Date(player.hospital_until as string).getTime() : null;

  return gameJson({
    player: { ...viewPlayer, energy },
    prison_seconds_left:  prisonUntil   ? Math.max(0, Math.floor((prisonUntil   - now) / 1000)) : 0,
    hospital_seconds_left:hospitalUntil ? Math.max(0, Math.floor((hospitalUntil - now) / 1000)) : 0,
    inventory:  invRes.results,
    log:        logRes.results,
    properties: viewProperties,
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

function npcBehaviorWeights(personality: string): { robbery: number; training: number; drug: number; assault: number } {
  switch (String(personality || '').toLowerCase()) {
    case 'aggressive':
      return { robbery: 0.42, training: 0.12, drug: 0.14, assault: 0.32 };
    case 'trader':
      return { robbery: 0.24, training: 0.14, drug: 0.44, assault: 0.18 };
    case 'defensive':
      return { robbery: 0.25, training: 0.40, drug: 0.15, assault: 0.20 };
    case 'passive':
      return { robbery: 0.18, training: 0.50, drug: 0.22, assault: 0.10 };
    default:
      return { robbery: 0.32, training: 0.20, drug: 0.23, assault: 0.25 };
  }
}

function npcTrainingLine(npc: Row): string {
  const name = String(npc.name ?? 'Någon');
  switch (String(npc.personality || '').toLowerCase()) {
    case 'aggressive':
      return `${name} pumpade järn i skymundan och såg hungrigare ut än vanligt.`;
    case 'trader':
      return `${name} låg lågt, räknade risker och slipade nästa drag.`;
    case 'defensive':
      return `${name} höll låg profil och vässade formen i bakgränden.`;
    default:
      return `${name} höll sig undan men byggde upp sig i skuggorna.`;
  }
}

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
  const events: Record<string, unknown>[] = [];
  const stmts: D1PreparedStatement[] = [];
  const pushEvent = (npc: Row, type: string, description: string) => {
    const createdAt = new Date().toISOString();
    activity.push(description);
    events.push({
      id: crypto.randomUUID(),
      created_at: createdAt,
      actor: npc.name as string,
      actor_id: npc.id as string,
      side: (npc.side as string) || '',
      personality: (npc.personality as string) || '',
      type,
      description,
    });
  };

  for (const npc of res.results) {
    const lvl  = (npc.level    as number) || 1;
    const roll = Math.random();
    const weights = npcBehaviorWeights(String(npc.personality ?? ''));

    if (roll < weights.robbery) {
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
        pushEvent(npc, 'robbery', `${npc.name as string} rånade ${cfg.label} och tjänade ${svNum(cash)} kr.`);
      }
    } else if (roll < weights.robbery + weights.training) {
      // Training
      const inc    = rand(1, 2);
      const newStr = Math.min(100, (npc.strength as number) + inc);
      stmts.push(
        env.DB.prepare(`UPDATE game_npcs SET strength = ? WHERE id = ?`).bind(newStr, npc.id as string)
      );
      pushEvent(npc, 'training', npcTrainingLine(npc));
    } else if (roll < weights.robbery + weights.training + weights.drug) {
      // Drug deal
      const earnings = Math.round(lvl * rand(200, 600) * 0.70);
      const respect  = Math.ceil(earnings / 400);
      stmts.push(
        env.DB.prepare(`UPDATE game_npcs SET cash = cash + ?, respect = respect + ? WHERE id = ?`)
          .bind(earnings, respect, npc.id as string)
      );
      const drugList = ['marijuana', 'kokain', 'heroin', 'ecstasy'];
      const drug = drugList[Math.floor(Math.random() * drugList.length)];
      pushEvent(npc, 'drug', `${npc.name as string} sålde ${drug} och tjänade ${svNum(earnings)} kr.`);
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
          pushEvent(npc, 'assault', `${npc.name as string} slog ner ${victim.name as string} och stal ${svNum(stolen)} kr.`);
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

  return gameJson({ activity, events });
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

async function gameNewRound(request: Request, env: Env): Promise<Response> {
  const active = await getActiveRound(env);
  if (active) {
    const secondsLeft = Math.max(0, Math.floor((new Date(active.end_date as string).getTime() - Date.now()) / 1000));
    if (secondsLeft > 0) {
      return gameJson({ error: `Runda ${active.round_number} är fortfarande aktiv.` }, 400);
    }
    await endRound(env, active);
  }

  const round = await createGameRound(env, await nextRoundNumber(env));
  const staleGameCookie = getGameCookie(request);
  const headers = new Headers({ 'Content-Type': 'application/json', ...cors() });
  if (staleGameCookie) headers.append('Set-Cookie', `${GAME_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`);
  return new Response(JSON.stringify({
    round_id: round.id,
    round_number: round.round_number,
    message: `Runda ${round.round_number} har börjat!`,
  }), { status: 200, headers });
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
  if (!round) return gameJson({ round_ended: true, top10: [], player_count: 0, self_rank: null, self: null });

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

  let self: Record<string, unknown> | null = null;
  let selfRank: number | null = null;
  const currentPid = getGameCookie(request);
  if (currentPid) {
    const selfRow = await env.DB.prepare(
      `SELECT name, level, respect, side, profession
       FROM game_players WHERE id = ? AND round_id = ? AND is_alive = 1
       LIMIT 1`
    ).bind(currentPid, round.id as string).first<Row>();

    if (selfRow) {
      const ahead = await env.DB.prepare(
        `SELECT COUNT(*) as cnt
         FROM game_players
         WHERE round_id = ? AND is_alive = 1 AND respect > ?`
      ).bind(round.id as string, selfRow.respect as number).first<{ cnt: number | string }>();

      selfRank = Number(ahead?.cnt ?? 0) + 1;
      self = {
        name: selfRow.name,
        level: selfRow.level,
        respect: selfRow.respect,
        side: selfRow.side,
        profession: selfRow.profession,
      };
    }
  }

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
    self_rank:    selfRank,
    self,
  });
}

function gameGetDrugPrices(): Response {
  const prices: Record<string, { price: number; trend: string }> = {};
  for (const drug of DRUG_NAMES) {
    prices[drug] = { price: getDrugPrice(drug), trend: getDrugTrend(drug) };
  }
  return gameJson({ prices });
}

async function gameGetBlackjackState(request: Request, env: Env): Promise<Response> {
  let player: Row;
  try { player = await requireGamePlayer(request, env); }
  catch (e) { return gameJson({ error: (e as GameError).message }, (e as GameError).status ?? 401); }

  try {
    const hand = await getBlackjackHandForPlayer(env, player);
    return gameJson(buildBlackjackState(hand, player));
  } catch (e) {
    return gameJson({ error: (e as GameError).message }, (e as GameError).status ?? 500);
  }
}

function settleBlackjack(hand: BlackjackRuntimeHand): Exclude<BlackjackOutcome, null> {
  const playerStats = blackjackTotals(hand.playerCards);
  const dealerStats = blackjackTotals(hand.dealerCards);
  if (playerStats.busted) return 'bust';
  if (dealerStats.busted) return 'win';
  if (playerStats.total > dealerStats.total) return 'win';
  if (playerStats.total < dealerStats.total) return 'lose';
  return 'push';
}

async function requireActiveBlackjackHand(env: Env, player: Row): Promise<BlackjackRuntimeHand> {
  const hand = await getBlackjackHandForPlayer(env, player);
  if (!hand) throw new GameError('Ingen blackjack-hand pågår.', 400);
  if (hand.state !== 'player_turn') throw new GameError('Den här handen är redan avgjord. Starta en ny.', 409);
  return hand;
}

async function gameActionBlackjackStart(request: Request, env: Env): Promise<Response> {
  let player: Row;
  try { player = await requireGamePlayer(request, env); }
  catch (e) { return gameJson({ error: (e as GameError).message }, (e as GameError).status ?? 401); }

  try {
    if (player.in_prison) return gameJson({ error: 'Kasinoet släpper inte in folk från kåken.' }, 400);
    if (player.in_hospital) return gameJson({ error: 'Du är fortfarande på sjukhuset.' }, 400);

    const body = await request.json<{ bet?: number }>().catch(() => ({} as { bet?: number }));
    const bet = Math.floor(Number(body.bet ?? 0));
    if (bet < BLACKJACK_MIN_BET) {
      return gameJson({ error: `Minsta insats är ${BLACKJACK_MIN_BET} kr.` }, 400);
    }
    if (bet > BLACKJACK_MAX_BET) {
      return gameJson({ error: `Maxinsats är ${BLACKJACK_MAX_BET} kr per hand.` }, 400);
    }

    const cash = Number(player.cash ?? 0);
    if (cash < bet) return gameJson({ error: `Du har bara ${fmtCurrency(cash)} kr i fickan.` }, 400);

    const existing = await getBlackjackHandForPlayer(env, player);
    if (existing && existing.state !== 'finished') {
      return gameJson({ error: 'En hand pågår redan.', ...buildBlackjackState(existing, player) }, 409);
    }

    try {
      await env.DB.prepare(`DELETE FROM game_blackjack_hands WHERE player_id = ?`).bind(player.id as string).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('no such table')) {
        return gameJson({ error: 'Blackjack-tabellen saknas. Kör game-migration-blackjack.sql mot D1.' }, 500);
      }
      throw e;
    }
    await env.DB.prepare(`UPDATE game_players SET cash = cash - ?, last_action = datetime('now') WHERE id = ?`)
      .bind(bet, player.id as string).run();

    const deck = shuffleBlackjackDeck(buildBlackjackDeck());
    const hand: BlackjackRuntimeHand = {
      id: crypto.randomUUID(),
      playerId: String(player.id),
      roundId: String(player.round_id),
      bet,
      deck,
      playerCards: [drawBlackjackCard(deck), drawBlackjackCard(deck)],
      dealerCards: [drawBlackjackCard(deck), drawBlackjackCard(deck)],
      state: 'player_turn',
      result: null,
      message: 'Kort utdelade. Din tur.',
      doubled: false,
    };

    await saveBlackjackHand(env, hand);

    const playerStats = blackjackTotals(hand.playerCards);
    const dealerStats = blackjackTotals(hand.dealerCards);
    if (playerStats.blackjack || dealerStats.blackjack) {
      let outcome: Exclude<BlackjackOutcome, null>;
      if (playerStats.blackjack && dealerStats.blackjack) outcome = 'push';
      else if (playerStats.blackjack) outcome = 'blackjack';
      else outcome = 'dealer_blackjack';
      return finalizeBlackjackHand(env, player, hand, outcome);
    }

    const freshPlayer = await loadGamePlayerById(env, player.id as string);
    return gameJson(buildBlackjackState(hand, freshPlayer));
  } catch (e) {
    return gameJson({ error: (e as GameError).message }, (e as GameError).status ?? 500);
  }
}

async function gameActionBlackjackHit(request: Request, env: Env): Promise<Response> {
  let player: Row;
  try { player = await requireGamePlayer(request, env); }
  catch (e) { return gameJson({ error: (e as GameError).message }, (e as GameError).status ?? 401); }

  try {
    let hand: BlackjackRuntimeHand;
    try { hand = await requireActiveBlackjackHand(env, player); }
    catch (e) { return gameJson({ error: (e as GameError).message }, (e as GameError).status ?? 400); }

    hand.playerCards.push(drawBlackjackCard(hand.deck));
    const playerStats = blackjackTotals(hand.playerCards);
    if (playerStats.busted) {
      return finalizeBlackjackHand(env, player, hand, 'bust');
    }

    hand.message = 'Du tog ett kort. Din tur fortsätter.';
    await saveBlackjackHand(env, hand);
    const freshPlayer = await loadGamePlayerById(env, player.id as string);
    return gameJson(buildBlackjackState(hand, freshPlayer));
  } catch (e) {
    return gameJson({ error: (e as GameError).message }, (e as GameError).status ?? 500);
  }
}

async function gameActionBlackjackStand(request: Request, env: Env): Promise<Response> {
  let player: Row;
  try { player = await requireGamePlayer(request, env); }
  catch (e) { return gameJson({ error: (e as GameError).message }, (e as GameError).status ?? 401); }

  try {
    let hand: BlackjackRuntimeHand;
    try { hand = await requireActiveBlackjackHand(env, player); }
    catch (e) { return gameJson({ error: (e as GameError).message }, (e as GameError).status ?? 400); }

    finishDealerHand(hand);
    return finalizeBlackjackHand(env, player, hand, settleBlackjack(hand));
  } catch (e) {
    return gameJson({ error: (e as GameError).message }, (e as GameError).status ?? 500);
  }
}

async function gameActionBlackjackDouble(request: Request, env: Env): Promise<Response> {
  let player: Row;
  try { player = await requireGamePlayer(request, env); }
  catch (e) { return gameJson({ error: (e as GameError).message }, (e as GameError).status ?? 401); }

  try {
    let hand: BlackjackRuntimeHand;
    try { hand = await requireActiveBlackjackHand(env, player); }
    catch (e) { return gameJson({ error: (e as GameError).message }, (e as GameError).status ?? 400); }

    if (hand.doubled || hand.playerCards.length !== 2) {
      return gameJson({ error: 'Du kan bara dubbla direkt efter given.' }, 400);
    }
    if (Number(player.cash ?? 0) < hand.bet) {
      return gameJson({ error: 'Du har inte råd att dubbla den här handen.' }, 400);
    }

    await env.DB.prepare(`UPDATE game_players SET cash = cash - ?, last_action = datetime('now') WHERE id = ?`)
      .bind(hand.bet, player.id as string).run();

    hand.bet *= 2;
    hand.doubled = true;
    hand.playerCards.push(drawBlackjackCard(hand.deck));
    const playerStats = blackjackTotals(hand.playerCards);
    if (playerStats.busted) {
      return finalizeBlackjackHand(env, player, hand, 'bust');
    }

    finishDealerHand(hand);
    return finalizeBlackjackHand(env, player, hand, settleBlackjack(hand));
  } catch (e) {
    return gameJson({ error: (e as GameError).message }, (e as GameError).status ?? 500);
  }
}

async function gameActionRobbery(request: Request, env: Env): Promise<Response> {
  let player: Row;
  try { player = await requireGamePlayer(request, env); }
  catch (e) { return gameJson({ error: (e as GameError).message }, (e as GameError).status ?? 401); }

  const body   = await request.json<{ target?: string }>().catch(() => ({} as { target?: string }));
  const target = body.target ?? '';
  const cfg    = ROBBERY_TARGETS[target];
  if (!cfg) return gameJson({ error: 'Okänt brottsmål.' }, 400);

  if (player.in_prison)   return gameJson({ error: 'Du sitter i fängelse.' }, 400);
  if (player.in_hospital) return gameJson({ error: 'Du är på sjukhus.' }, 400);
  if (!player.is_alive)   return gameJson({ error: 'Du är eliminerad.' }, 400);

  const pid          = player.id as string;
  const stealth      = effectiveStat(player, 'stealth');
  const intelligence = effectiveStat(player, 'intelligence');
  const level        = (player.level        as number) ?? 1;
  const profession   = activeProfession(player);

  const levelReq = ROBBERY_LEVEL_REQS[target] ?? 1;
  if (level < levelReq)
    return gameJson({ error: `Kräver level ${levelReq}. Du är level ${level}.` }, 400);
  const energy = calcEnergy(player);
  if (energy < cfg.energy)
    return gameJson({ error: `Inte tillräckligt med energi. Behöver ${cfg.energy}, har ${energy}.` }, 400);

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
    xpGained      = xpWithBonus(player, cfg.xp);
    const flavorOk = pickRandom(ROBBERY_FLAVOR_SUCCESS[target] ?? [cfg.label + '.']);
    message       = `\u2713 ${flavorOk} +${cashGained.toLocaleString('sv')} kr.`;
  } else {
    // Missed; chance of getting caught
    const caughtRoll = Math.random() * 100;
    caught = caughtRoll < cfg.prisonChance;
    xpGained = xpWithBonus(player, Math.floor(cfg.xp * 0.2));
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
    return gameJson({ error: 'Ogiltigt stat. Välj: strength, intelligence, charisma eller stealth.' }, 400);

  const COST = 10;
  const energy = calcEnergy(player);
  if (energy < COST) return gameJson({ error: `Inte tillräckligt med energi. Behöver ${COST}, har ${energy}.` }, 400);

  const increase  = rand(1, 3);
  const newVal    = Math.min(100, ((player[stat] as number) ?? 10) + increase);
  const xpGained  = xpWithBonus(player, 20);
  const currentXp = (player.xp as number) + xpGained;
  const newLevel  = levelFromXp(currentXp);

  await updateEnergy(env, player.id as string, energy, COST);
  await env.DB.prepare(
    `UPDATE game_players SET ${stat} = ?, xp = ?, level = ?, last_action = datetime('now') WHERE id = ?`
  ).bind(newVal, currentXp, newLevel, player.id as string).run();

  const statSv: Record<string, string> = { strength: 'Styrka', intelligence: 'Intelligens', charisma: 'Karisma', stealth: 'Smygande' };
  const msg = `${statSv[stat] ?? stat} tränad. +${increase} (nu ${newVal}).`;
  await logAction(env, player.id as string, 'training', msg, 0, 0, xpGained, true);

  return gameJson({ stat, increase, new_value: newVal, xp_gained: xpGained, new_level: newLevel, message: msg });
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

  if (!['buy', 'sell'].includes(action)) return gameJson({ error: 'Ogiltig åtgärd.' }, 400);
  if (!DRUG_NAMES.includes(drug))        return gameJson({ error: `Okänd drog "${drug}".` }, 400);
  if (quantity < 1 || quantity > 100)    return gameJson({ error: 'Antal måste vara 1–100.' }, 400);

  const pid          = player.id as string;
  const playerLevel  = (player.level        as number) ?? 1;
  if (playerLevel < 5) return gameJson({ error: 'Droghandel l\u00e5ses upp vid level 5.' }, 400);

  const profession   = activeProfession(player);
  const intelligence = effectiveStat(player, 'intelligence');
  const charisma     = effectiveStat(player, 'charisma');
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
    if (energy < COST) return gameJson({ error: `Inte tillräckligt med energi. Behöver ${COST}.` }, 400);

    const unitPrice = Math.round(midPrice * (1 + buyMarkup));
    const total     = unitPrice * quantity;
    const cash      = (player.cash as number) ?? 0;
    if (cash < total) return gameJson({ error: `Inte tillräckligt med kontanter. Behöver ${total} kr.` }, 400);

    // Upsert inventory — store actual buy price so sell side can reference it
    const existing = await env.DB.prepare(
      `SELECT id, quantity, buy_price FROM game_inventory WHERE player_id = ? AND item_type = 'drug' AND item_name = ?`
    ).bind(pid, drug).first<Row>();

    if (existing) {
      const existingQty = Number(existing.quantity ?? 0);
      const existingBuyPrice = Number(existing.buy_price ?? unitPrice);
      const newQty = existingQty + quantity;
      const avgBuyPrice = Math.round(((existingQty * existingBuyPrice) + (quantity * unitPrice)) / Math.max(1, newQty));
      await env.DB.prepare(
        `UPDATE game_inventory SET quantity = quantity + ?, buy_price = ? WHERE id = ?`
      ).bind(quantity, avgBuyPrice, existing.id as string).run();
    } else {
      await env.DB.prepare(
        `INSERT INTO game_inventory (id, player_id, item_type, item_name, quantity, buy_price)
         VALUES (?, ?, 'drug', ?, ?, ?)`
      ).bind(crypto.randomUUID(), pid, drug, quantity, unitPrice).run();
    }

    const xpGained = xpWithBonus(player, 5);
    const currentXp = (player.xp as number) + xpGained;
    const newLevel = levelFromXp(currentXp);
    await updateEnergy(env, pid, energy, COST);
    await env.DB.prepare(
      `UPDATE game_players SET cash = cash - ?, xp = ?, level = ?, last_action = datetime('now') WHERE id = ?`
    ).bind(total, currentXp, newLevel, pid).run();

    const msg = `K\u00f6per ${quantity}x ${drug} \u00e0 ${unitPrice} kr/st.`;
    await logAction(env, pid, 'drug_deal', msg, -total, 0, xpGained, true);
    return gameJson({ bought: quantity, unit_price: unitPrice, total_cost: total, new_cash: cash - total, xp_gained: xpGained, new_level: newLevel,
                      message: `Köper ${quantity}x ${drug} för ${total.toLocaleString('sv')} kr.` });

  } else {
    // sell — no energy cost
    const existing = await env.DB.prepare(
      `SELECT id, quantity FROM game_inventory WHERE player_id = ? AND item_type = 'drug' AND item_name = ?`
    ).bind(pid, drug).first<Row>();
    if (!existing || (existing.quantity as number) < quantity)
      return gameJson({ error: `Du har inte ${quantity}x ${drug}.` }, 400);

    // Sell price uses current market minus markdown.
    // Holding pays off: if mid has risen above buy_price, seller profits.
    const unitPrice = Math.round(midPrice * (1 - sellMarkdown));
    const total     = unitPrice * quantity;
    const respectGained = Math.max(1, Math.floor(quantity * 0.5));
    const xpGained     = xpWithBonus(player, Math.max(5, quantity * 2));

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

  const profession = activeProfession(player);
  const COST  = 15;
  const energy = calcEnergy(player);
  if (energy < COST) return gameJson({ error: `Inte tillräckligt med energi. Behöver ${COST}.` }, 400);

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

  const attackerStr = effectiveStat(player, 'strength');
  const targetStr   = isNpc ? ((target.strength as number) ?? 10) : effectiveStat(target, 'strength');
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

    const xpGained = xpWithBonus(player, 50);
    const currentXp = (player.xp as number) + xpGained;
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

  await logAction(env, pid, 'assault', message, cashStolen, respectGained, success ? xpWithBonus(player, 50) : 0, success);

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
  const stealth      = effectiveStat(player, 'stealth');
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
    return gameJson({
      success: true,
      method: 'bribe',
      cost: bribeCost,
      seconds_left: 0,
      message: `Mutade vakten. Frihet kostar ${bribeCost} kr.`,
    });
  }

  // Escape attempt
  const roll    = Math.random() * 100;
  const success = roll < escapeChance;
  if (success) {
    const xpGained = xpWithBonus(player, 30);
    const currentXp = (player.xp as number) + xpGained;
    const newLevel = levelFromXp(currentXp);
    await env.DB.prepare(
      `UPDATE game_players
       SET in_prison = 0, prison_until = NULL, respect = respect + 5, xp = ?, level = ?, last_action = datetime('now')
       WHERE id = ?`
    ).bind(currentXp, newLevel, pid).run();
    await logAction(env, pid, 'prison', 'R\u00f6mde fr\u00e5n f\u00e4ngelset.', 0, 5, xpGained, true);
    return gameJson({
      success: true,
      method: 'escape',
      xp_gained: xpGained,
      new_level: newLevel,
      seconds_left: 0,
      message: 'Du lyckades rymma! +5 respect.',
    });
  } else {
    // Add 10 min penalty
    const newRelease = new Date(Math.max(prisonUntil, Date.now()) + 10 * 60 * 1000).toISOString();
    const secondsLeft = Math.max(0, Math.floor((new Date(newRelease).getTime() - Date.now()) / 1000));
    await env.DB.prepare(
      `UPDATE game_players SET prison_until = ? WHERE id = ?`
    ).bind(newRelease, pid).run();
    await logAction(env, pid, 'prison', 'R\u00f6mningsf\u00f6rs\u00f6k misslyckades. +10 min.', 0, 0, 0, false);
    return gameJson({
      success: false,
      method: 'escape',
      message: 'Misslyckades. +10 min till domen.',
      bribe_cost: Math.max(500, secondsLeft * 10),
      seconds_left: secondsLeft,
    });
  }
}

async function gameActionHospital(request: Request, env: Env): Promise<Response> {
  let player: Row;
  try { player = await requireGamePlayer(request, env); }
  catch (e) { return gameJson({ error: (e as GameError).message }, (e as GameError).status ?? 401); }

  const body = await request.json<{ action?: string; stat?: string }>().catch(() => ({}));
  const action = body.action ?? 'heal';
  const pid    = player.id as string;
  const hpMax  = effectiveHpMax(player);
  const hp     = Math.max(0, Math.min(Number(player.hp ?? hpMax), hpMax));
  const cash   = (player.cash   as number) ?? 0;

  if (action === 'wait') {
    if (!player.in_hospital) {
      return gameJson({ released: true, seconds_left: 0, message: 'Du är redo att lämna sjukhuset.' });
    }
    const hospitalUntil = player.hospital_until ? new Date(player.hospital_until as string).getTime() : null;
    const secondsLeft = hospitalUntil ? Math.max(0, Math.floor((hospitalUntil - Date.now()) / 1000)) : 0;
    return gameJson({
      waiting: true,
      released: secondsLeft === 0,
      seconds_left: secondsLeft,
      message: secondsLeft > 0 ? `Du återhämtar dig. ${secondsLeft} sek kvar.` : 'Du är redo att lämna sjukhuset.',
    });
  }

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
      return gameJson({ error: 'Ogiltigt stat för boost.' }, 400);
    const BOOST_COST = 5000;
    if (cash < BOOST_COST) return gameJson({ error: `Boost kostar ${BOOST_COST} kr.` }, 400);
    const newVal = Math.min(100, ((player[stat] as number) ?? 10) + 1);
    await env.DB.prepare(
      `UPDATE game_players SET ${stat} = ?, cash = cash - ?, last_action = datetime('now') WHERE id = ?`
    ).bind(newVal, BOOST_COST, pid).run();
    await logAction(env, pid, 'hospital', `K\u00f6pte stat-boost: ${stat} +1.`, -BOOST_COST, 0, 0, true);
    return gameJson({ boosted: stat, new_value: newVal, cost: BOOST_COST, new_cash: cash - BOOST_COST });
  }

  return gameJson({ error: 'Ogiltig sjukhusåtgärd.' }, 400);
}

async function gameActionBank(request: Request, env: Env): Promise<Response> {
  let player: Row;
  try { player = await requireGamePlayer(request, env); }
  catch (e) { return gameJson({ error: (e as GameError).message }, (e as GameError).status ?? 401); }

  const body   = await request.json<{ action?: string; amount?: number }>().catch(() => ({} as { action?: string; amount?: number }));
  const action = body.action ?? '';
  const amount = Math.floor(body.amount ?? 0);
  if (amount <= 0) return gameJson({ error: 'Beloppet måste vara positivt.' }, 400);
  if (!['deposit', 'withdraw'].includes(action)) return gameJson({ error: 'Ogiltig bankåtgärd.' }, 400);

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
function propertyIncomeForPlayer(player: Row, type: string, level: number, fallback = 0): number {
  const baseIncome = propertyIncomeAtLevel(type, level) || fallback;
  return Math.round(baseIncome * (1 + profBonus(activeProfession(player), 'property_income')));
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
    const newIncome  = propertyIncomeForPlayer(player, prop.property_type as string, newLevel, Number(prop.income_per_hour ?? 0));
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

  const income = propertyIncomeForPlayer(player, type, 1, PROPERTY_CONFIGS[type].baseIncome);
  const propId = crypto.randomUUID();
  const cfg    = PROPERTY_CONFIGS[type];
  const xpGained = xpWithBonus(player, 50);
  const currentXp = (player.xp as number) + xpGained;
  const newLevel = levelFromXp(currentXp);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO game_properties (id, player_id, property_type, property_name, level, income_per_hour)
       VALUES (?, ?, ?, ?, 1, ?)`
    ).bind(propId, pid, type, cfg.label, income),
    env.DB.prepare(`UPDATE game_players SET cash = cash - ?, xp = ?, level = ?, last_action = datetime('now') WHERE id = ?`)
      .bind(cost, currentXp, newLevel, pid),
  ]);

  await logAction(env, pid, 'property', `K\u00f6pte ${cfg.label} f\u00f6r ${cost} kr.`, -cost, 0, xpGained, true);
  return gameJson({ bought: type, income_per_hour: income, cost, new_cash: cash - cost, xp_gained: xpGained, new_level: newLevel });
}

async function gameActionCollectIncome(request: Request, env: Env): Promise<Response> {
  let player: Row;
  try { player = await requireGamePlayer(request, env); }
  catch (e) { return gameJson({ error: (e as GameError).message }, (e as GameError).status ?? 401); }

  const body = await request.json<{ property_id?: string }>().catch(() => ({} as { property_id?: string }));
  const pid  = player.id as string;
  const propertyId = (body.property_id ?? '').trim();
  const res  = propertyId
    ? await env.DB.prepare(`SELECT * FROM game_properties WHERE player_id = ? AND id = ?`).bind(pid, propertyId).all<Row>()
    : await env.DB.prepare(`SELECT * FROM game_properties WHERE player_id = ?`).bind(pid).all<Row>();
  if (!res.results.length) {
    return gameJson({ error: propertyId ? 'Fastigheten hittades inte.' : 'Inga fastigheter \u00e4gda.' }, 400);
  }

  let total = 0;
  const now = Date.now();
  const stmts = res.results.map(prop => {
    const lastCollected = new Date((prop.last_collected as string) ?? new Date().toISOString()).getTime();
    const hours         = Math.max(0, (now - lastCollected) / 3600000);
    const hourlyIncome  = propertyIncomeForPlayer(
      player,
      String(prop.property_type ?? ''),
      Number(prop.level ?? 1),
      Number(prop.income_per_hour ?? 0)
    );
    const income        = Math.round(hourlyIncome * hours);
    total += income;
    return env.DB.prepare(`UPDATE game_properties SET last_collected = datetime('now') WHERE id = ? AND last_collected = ?`)
      .bind(prop.id as string, prop.last_collected as string);
  });

  if (total === 0) return gameJson({ message: 'Ingen inkomst att h\u00e4mta \u00e4nnu.', collected: 0 });

  stmts.push(
    env.DB.prepare(`UPDATE game_players SET cash = cash + ?, last_action = datetime('now') WHERE id = ?`)
      .bind(total, pid)
  );
  await env.DB.batch(stmts);
  const propertyLabel = propertyId
    ? (res.results[0].property_name as string) || (res.results[0].property_type as string) || 'fastigheten'
    : 'fastigheter';
  const message = propertyId
    ? `Samlade in ${total} kr fr\u00e5n ${propertyLabel}.`
    : `Samlade in ${total} kr fr\u00e5n fastigheter.`;
  await logAction(env, pid, 'property', message, total, 0, 0, true);
  return gameJson({ collected: total, properties: res.results.length, property_id: propertyId || null, xp_gained: 0, message });
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
  if (activeProfession(current) === prof) return gameJson({ error: 'Du har redan det yrket.' }, 400);

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

const BLACKJACK_MIN_BET = 100;
const BLACKJACK_MAX_BET = 5000;
const BLACKJACK_SUITS = ['S', 'H', 'D', 'C'] as const;
const BLACKJACK_RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const;
const HOLDEM_SMALL_BLIND = 50;
const HOLDEM_BIG_BLIND = 100;
const HOLDEM_MIN_BUYIN = 2000;
const HOLDEM_MAX_BUYIN = 10000;
const HOLDEM_MAX_AGGRESSIVE_ACTIONS = 4;
const HOLDEM_NPC_COUNT = 3;
const HOLDEM_ARCHETYPES = ['tight', 'loose', 'aggressive', 'passive', 'gambler', 'shark'] as const;

type BlackjackPhase = 'player_turn' | 'finished';
type BlackjackOutcome = 'blackjack' | 'win' | 'lose' | 'push' | 'bust' | 'dealer_blackjack' | null;
type HoldemStreet = 'preflop' | 'flop' | 'turn' | 'river' | 'hand_over' | 'table_over';
type HoldemActionKind = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'all-in';
type HoldemSeatKind = 'player' | 'npc';
type HoldemArchetype = typeof HOLDEM_ARCHETYPES[number];
type HoldemResult = 'win' | 'lose' | 'split' | 'table_clear' | 'busted' | null;

interface BlackjackRuntimeHand {
  id: string;
  playerId: string;
  roundId: string;
  bet: number;
  deck: string[];
  playerCards: string[];
  dealerCards: string[];
  state: BlackjackPhase;
  result: BlackjackOutcome;
  message: string | null;
  doubled: boolean;
}

interface HoldemSeatState {
  seat: number;
  id: string;
  kind: HoldemSeatKind;
  playerId: string | null;
  npcId: string | null;
  name: string;
  side: string | null;
  personality: string | null;
  archetype: HoldemArchetype;
  stack: number;
  hole: string[];
  folded: boolean;
  allIn: boolean;
  streetBet: number;
  totalBet: number;
  acted: boolean;
  lastAction: string | null;
}

interface HoldemRuntimeTable {
  id: string;
  playerId: string;
  roundId: string;
  buyIn: number;
  smallBlind: number;
  bigBlind: number;
  button: number;
  playerSeat: number;
  handNumber: number;
  street: HoldemStreet;
  actionIndex: number | null;
  currentBet: number;
  minRaise: number;
  aggressiveActions: number;
  raiseLocked: number[];
  community: string[];
  deck: string[];
  message: string | null;
  result: HoldemResult;
  seats: HoldemSeatState[];
  handStartStacks: number[];
}

interface HoldemHandValue {
  category: number;
  tiebreak: number[];
  label: string;
  name: string;
  cards: string[];
}

function buildBlackjackDeck(): string[] {
  const deck: string[] = [];
  for (const suit of BLACKJACK_SUITS) {
    for (const rank of BLACKJACK_RANKS) deck.push(`${rank}${suit}`);
  }
  return deck;
}

function shuffleBlackjackDeck(cards: string[]): string[] {
  const deck = [...cards];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function drawBlackjackCard(deck: string[]): string {
  const card = deck.pop();
  if (!card) throw new GameError('Kortleken är tom.', 500);
  return card;
}

function blackjackRank(card: string): string {
  return card.slice(0, -1);
}

function blackjackSuit(card: string): string {
  return card.slice(-1);
}

function blackjackCardValue(card: string): number {
  const rank = blackjackRank(card);
  if (rank === 'A') return 11;
  if (rank === 'K' || rank === 'Q' || rank === 'J') return 10;
  return Number(rank);
}

function blackjackTotals(cards: string[]): { total: number; soft: boolean; blackjack: boolean; busted: boolean } {
  let total = 0;
  let aces = 0;
  for (const card of cards) {
    const rank = blackjackRank(card);
    if (rank === 'A') aces += 1;
    total += blackjackCardValue(card);
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return {
    total,
    soft: aces > 0,
    blackjack: cards.length === 2 && total === 21,
    busted: total > 21,
  };
}

function parseBlackjackCards(raw: unknown, field: string): string[] {
  if (typeof raw !== 'string' || !raw.trim()) throw new GameError(`Blackjack state missing ${field}.`, 500);
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.some(card => typeof card !== 'string')) {
      throw new Error('invalid card array');
    }
    return parsed as string[];
  } catch {
    throw new GameError(`Blackjack state for ${field} is invalid.`, 500);
  }
}

function blackjackCardView(card: string, hidden = false): Record<string, unknown> {
  if (hidden) {
    return { hidden: true, code: null, label: '•', rank: null, suit: null, color: 'hidden' };
  }
  const suit = blackjackSuit(card);
  const symbol = suit === 'H' ? '♥' : suit === 'D' ? '♦' : suit === 'S' ? '♠' : '♣';
  return {
    hidden: false,
    code: card,
    label: `${blackjackRank(card)}${symbol}`,
    rank: blackjackRank(card),
    suit: symbol,
    color: suit === 'H' || suit === 'D' ? 'red' : 'black',
  };
}

function rowToBlackjackHand(row: Row): BlackjackRuntimeHand {
  return {
    id: String(row.id),
    playerId: String(row.player_id),
    roundId: String(row.round_id),
    bet: Number(row.bet ?? 0),
    deck: parseBlackjackCards(row.deck_state, 'deck_state'),
    playerCards: parseBlackjackCards(row.player_hand, 'player_hand'),
    dealerCards: parseBlackjackCards(row.dealer_hand, 'dealer_hand'),
    state: String(row.state ?? 'player_turn') === 'finished' ? 'finished' : 'player_turn',
    result: (row.result as BlackjackOutcome) ?? null,
    message: row.message ? String(row.message) : null,
    doubled: Number(row.doubled ?? 0) === 1,
  };
}

async function getBlackjackHandForPlayer(env: Env, player: Row): Promise<BlackjackRuntimeHand | null> {
  try {
    const row = await env.DB.prepare(
      `SELECT * FROM game_blackjack_hands WHERE player_id = ? AND round_id = ? LIMIT 1`
    ).bind(player.id as string, player.round_id as string).first<Row>();
    return row ? rowToBlackjackHand(row) : null;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('no such table')) {
      throw new GameError('Blackjack-tabellen saknas. Kör game-migration-blackjack.sql mot D1.', 500);
    }
    throw e;
  }
}

async function saveBlackjackHand(env: Env, hand: BlackjackRuntimeHand): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT INTO game_blackjack_hands
         (id, player_id, round_id, bet, deck_state, player_hand, dealer_hand, state, result, message, doubled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
       ON CONFLICT(player_id) DO UPDATE SET
         round_id = excluded.round_id,
         bet = excluded.bet,
         deck_state = excluded.deck_state,
         player_hand = excluded.player_hand,
         dealer_hand = excluded.dealer_hand,
         state = excluded.state,
         result = excluded.result,
         message = excluded.message,
         doubled = excluded.doubled,
         updated_at = datetime('now')`
    ).bind(
      hand.id,
      hand.playerId,
      hand.roundId,
      hand.bet,
      JSON.stringify(hand.deck),
      JSON.stringify(hand.playerCards),
      JSON.stringify(hand.dealerCards),
      hand.state,
      hand.result,
      hand.message,
      hand.doubled ? 1 : 0
    ).run();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('no such table')) {
      throw new GameError('Blackjack-tabellen saknas. Kör game-migration-blackjack.sql mot D1.', 500);
    }
    throw e;
  }
}

function blackjackPayout(outcome: Exclude<BlackjackOutcome, null>, bet: number): number {
  if (outcome === 'blackjack') return Math.round(bet * 2.5);
  if (outcome === 'win') return bet * 2;
  if (outcome === 'push') return bet;
  return 0;
}

function blackjackNet(outcome: Exclude<BlackjackOutcome, null>, bet: number): number {
  if (outcome === 'blackjack') return Math.round(bet * 1.5);
  if (outcome === 'win') return bet;
  if (outcome === 'push') return 0;
  return -bet;
}

function blackjackResultMessage(outcome: Exclude<BlackjackOutcome, null>, bet: number, doubled: boolean): string {
  const net = blackjackNet(outcome, bet);
  const amount = fmtCurrency(Math.abs(net));
  if (outcome === 'blackjack') return `Blackjack. Bordet hostade upp ${amount} kr.`;
  if (outcome === 'win') return doubled
    ? `Dubblade ner och tog hem ${amount} kr vid bordet.`
    : `Tog hem ${amount} kr vid blackjackbordet.`;
  if (outcome === 'push') return `Push vid bordet. Fick tillbaka ${fmtCurrency(bet)} kr.`;
  if (outcome === 'bust') return doubled
    ? `Dubblade ner, sprack och brände ${amount} kr.`
    : `Sprack vid blackjackbordet och tappade ${amount} kr.`;
  if (outcome === 'dealer_blackjack') return `Dealern visade blackjack. ${amount} kr försvann.`;
  return `Förlorade ${amount} kr vid blackjackbordet.`;
}

function finishDealerHand(hand: BlackjackRuntimeHand): void {
  while (blackjackTotals(hand.dealerCards).total < 17) {
    hand.dealerCards.push(drawBlackjackCard(hand.deck));
  }
}

function buildBlackjackState(hand: BlackjackRuntimeHand | null, player: Row): Record<string, unknown> {
  if (!hand) {
    return {
      idle: true,
      min_bet: BLACKJACK_MIN_BET,
      max_bet: BLACKJACK_MAX_BET,
      player_cash: Number(player.cash ?? 0),
    };
  }

  const playerStats = blackjackTotals(hand.playerCards);
  const dealerStats = blackjackTotals(hand.dealerCards);
  const dealerHidden = hand.state !== 'finished';
  return {
    idle: false,
    min_bet: BLACKJACK_MIN_BET,
    max_bet: BLACKJACK_MAX_BET,
    player_cash: Number(player.cash ?? 0),
    hand: {
      id: hand.id,
      bet: hand.bet,
      state: hand.state,
      result: hand.result,
      message: hand.message,
      doubled: hand.doubled,
      finished: hand.state === 'finished',
      can_hit: hand.state === 'player_turn',
      can_stand: hand.state === 'player_turn',
      can_double: hand.state === 'player_turn'
        && !hand.doubled
        && hand.playerCards.length === 2
        && Number(player.cash ?? 0) >= hand.bet,
      player_cards: hand.playerCards.map(card => blackjackCardView(card)),
      dealer_cards: hand.dealerCards.map((card, index) => blackjackCardView(card, dealerHidden && index === 1)),
      player_total: playerStats.total,
      player_soft: playerStats.soft,
      dealer_total: dealerHidden ? null : dealerStats.total,
      dealer_visible_total: dealerHidden ? blackjackTotals(hand.dealerCards.slice(0, 1)).total : dealerStats.total,
    },
  };
}

async function finalizeBlackjackHand(
  env: Env,
  player: Row,
  hand: BlackjackRuntimeHand,
  outcome: Exclude<BlackjackOutcome, null>
): Promise<Response> {
  hand.state = 'finished';
  hand.result = outcome;
  hand.message = blackjackResultMessage(outcome, hand.bet, hand.doubled);
  await saveBlackjackHand(env, hand);

  const payout = blackjackPayout(outcome, hand.bet);
  if (payout > 0) {
    await env.DB.prepare(`UPDATE game_players SET cash = cash + ?, last_action = datetime('now') WHERE id = ?`)
      .bind(payout, player.id as string).run();
  } else {
    await env.DB.prepare(`UPDATE game_players SET last_action = datetime('now') WHERE id = ?`)
      .bind(player.id as string).run();
  }

  await logAction(
    env,
    player.id as string,
    'casino',
    hand.message,
    blackjackNet(outcome, hand.bet),
    0,
    0,
    outcome === 'blackjack' || outcome === 'win' || outcome === 'push'
  );

  const freshPlayer = await loadGamePlayerById(env, player.id as string);
  return gameJson(buildBlackjackState(hand, freshPlayer));
}

function fmtCurrency(amount: number): string {
  return amount.toLocaleString('sv-SE');
}

function normalizeHoldemBuyIn(value: unknown): number {
  const amount = Math.floor(Number(value ?? 0));
  if (!Number.isFinite(amount)) return 0;
  return Math.max(HOLDEM_MIN_BUYIN, Math.min(HOLDEM_MAX_BUYIN, amount));
}

function holdemBetUnit(street: HoldemStreet): number {
  return street === 'turn' || street === 'river' ? HOLDEM_BIG_BLIND * 2 : HOLDEM_BIG_BLIND;
}

function holdemCanSeatAct(seat: HoldemSeatState): boolean {
  return !seat.folded && !seat.allIn && seat.stack > 0 && seat.hole.length === 2;
}

function holdemLiveSeats(table: HoldemRuntimeTable): HoldemSeatState[] {
  return table.seats.filter(seat => !seat.folded && seat.hole.length === 2);
}

function holdemActionableSeats(table: HoldemRuntimeTable): HoldemSeatState[] {
  return table.seats.filter(holdemCanSeatAct);
}

function holdemTotalPot(table: HoldemRuntimeTable): number {
  return table.seats.reduce((sum, seat) => sum + Number(seat.totalBet ?? 0), 0);
}

function holdemToCall(table: HoldemRuntimeTable, seat: HoldemSeatState): number {
  return Math.max(0, table.currentBet - seat.streetBet);
}

function holdemNextSeat(
  table: HoldemRuntimeTable,
  fromIndex: number,
  predicate: (seat: HoldemSeatState) => boolean
): number | null {
  for (let step = 1; step <= table.seats.length; step += 1) {
    const idx = (fromIndex + step) % table.seats.length;
    if (predicate(table.seats[idx])) return idx;
  }
  return null;
}

function holdemBlindPositions(table: HoldemRuntimeTable): { sb: number; bb: number } {
  const active = table.seats.filter(seat => seat.stack > 0);
  if (active.length <= 1) return { sb: table.button, bb: table.button };
  if (active.length === 2) {
    const bb = holdemNextSeat(table, table.button, seat => seat.stack > 0);
    return { sb: table.button, bb: bb ?? table.button };
  }
  const sb = holdemNextSeat(table, table.button, seat => seat.stack > 0) ?? table.button;
  const bb = holdemNextSeat(table, sb, seat => seat.stack > 0) ?? sb;
  return { sb, bb };
}

function holdemActionStartIndex(table: HoldemRuntimeTable): number | null {
  const { bb } = holdemBlindPositions(table);
  if (table.street === 'preflop') {
    return holdemNextSeat(table, bb, holdemCanSeatAct);
  }
  return holdemNextSeat(table, table.button, holdemCanSeatAct);
}

function holdemApplyContribution(seat: HoldemSeatState, amount: number): number {
  const applied = Math.max(0, Math.min(seat.stack, Math.floor(amount)));
  seat.stack -= applied;
  seat.streetBet += applied;
  seat.totalBet += applied;
  if (seat.stack === 0) seat.allIn = true;
  return applied;
}

function holdemResetStreet(table: HoldemRuntimeTable, street: HoldemStreet): void {
  table.street = street;
  table.currentBet = 0;
  table.minRaise = holdemBetUnit(street);
  table.aggressiveActions = 0;
  table.raiseLocked = [];
  for (const seat of table.seats) {
    seat.streetBet = 0;
    seat.acted = !holdemCanSeatAct(seat);
  }
  table.actionIndex = holdemActionStartIndex(table);
}

function holdemRankValue(rank: string): number {
  if (rank === 'A') return 14;
  if (rank === 'K') return 13;
  if (rank === 'Q') return 12;
  if (rank === 'J') return 11;
  return Number(rank);
}

function holdemStraightHigh(values: number[]): number {
  const uniq = [...new Set(values)].sort((a, b) => b - a);
  if (uniq.includes(14)) uniq.push(1);
  for (let i = 0; i <= uniq.length - 5; i += 1) {
    const window = uniq.slice(i, i + 5);
    if (window[0] - window[4] === 4 && new Set(window).size === 5) {
      return window[0] === 1 ? 5 : window[0];
    }
  }
  return 0;
}

function evaluateHoldemFive(cards: string[]): HoldemHandValue {
  const ranks = cards.map(card => holdemRankValue(blackjackRank(card))).sort((a, b) => b - a);
  const suits = cards.map(card => blackjackSuit(card));
  const flush = suits.every(suit => suit === suits[0]);
  const straightHigh = holdemStraightHigh(ranks);
  const counts = new Map<number, number>();
  for (const rank of ranks) counts.set(rank, (counts.get(rank) ?? 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return b[0] - a[0];
  });

  if (flush && straightHigh) {
    const royal = straightHigh === 14;
    return { category: royal ? 9 : 8, tiebreak: [straightHigh], label: royal ? 'royal_flush' : 'straight_flush', name: royal ? 'Royal flush' : 'Straight flush', cards };
  }
  if (groups[0][1] === 4) return { category: 7, tiebreak: [groups[0][0], groups[1][0]], label: 'four_kind', name: 'Fyrtal', cards };
  if (groups[0][1] === 3 && groups[1][1] === 2) return { category: 6, tiebreak: [groups[0][0], groups[1][0]], label: 'full_house', name: 'Kåk', cards };
  if (flush) return { category: 5, tiebreak: [...ranks], label: 'flush', name: 'Färg', cards };
  if (straightHigh) return { category: 4, tiebreak: [straightHigh], label: 'straight', name: 'Stege', cards };
  if (groups[0][1] === 3) {
    const kickers = groups.slice(1).map(group => group[0]).sort((a, b) => b - a);
    return { category: 3, tiebreak: [groups[0][0], ...kickers], label: 'three_kind', name: 'Triss', cards };
  }
  if (groups[0][1] === 2 && groups[1][1] === 2) {
    const pairs = groups.filter(group => group[1] === 2).map(group => group[0]).sort((a, b) => b - a);
    const kicker = groups.find(group => group[1] === 1)?.[0] ?? 0;
    return { category: 2, tiebreak: [pairs[0], pairs[1], kicker], label: 'two_pair', name: 'Tvåpar', cards };
  }
  if (groups[0][1] === 2) {
    const kickers = groups.filter(group => group[1] === 1).map(group => group[0]).sort((a, b) => b - a);
    return { category: 1, tiebreak: [groups[0][0], ...kickers], label: 'one_pair', name: 'Par', cards };
  }
  return { category: 0, tiebreak: [...ranks], label: 'high_card', name: 'Högt kort', cards };
}

function compareHoldemHands(a: HoldemHandValue, b: HoldemHandValue): number {
  if (a.category !== b.category) return a.category > b.category ? 1 : -1;
  const len = Math.max(a.tiebreak.length, b.tiebreak.length);
  for (let i = 0; i < len; i += 1) {
    const av = a.tiebreak[i] ?? 0;
    const bv = b.tiebreak[i] ?? 0;
    if (av !== bv) return av > bv ? 1 : -1;
  }
  return 0;
}

function bestHoldemHand(cards: string[]): HoldemHandValue {
  if (cards.length < 5) throw new GameError('För få kort för att utvärdera handen.', 500);
  let best: HoldemHandValue | null = null;
  for (let a = 0; a < cards.length - 4; a += 1) {
    for (let b = a + 1; b < cards.length - 3; b += 1) {
      for (let c = b + 1; c < cards.length - 2; c += 1) {
        for (let d = c + 1; d < cards.length - 1; d += 1) {
          for (let e = d + 1; e < cards.length; e += 1) {
            const candidate = evaluateHoldemFive([cards[a], cards[b], cards[c], cards[d], cards[e]]);
            if (!best || compareHoldemHands(candidate, best) > 0) best = candidate;
          }
        }
      }
    }
  }
  if (!best) throw new GameError('Kunde inte utvärdera pokerhanden.', 500);
  return best;
}

function holdemHasFlushDraw(cards: string[]): boolean {
  const counts = new Map<string, number>();
  for (const card of cards) {
    const suit = blackjackSuit(card);
    counts.set(suit, (counts.get(suit) ?? 0) + 1);
  }
  return [...counts.values()].some(count => count >= 4);
}

function holdemHasStraightDraw(cards: string[]): 'open' | 'gutshot' | null {
  const values = [...new Set(cards.map(card => holdemRankValue(blackjackRank(card))))];
  if (values.includes(14)) values.push(1);
  for (let start = 1; start <= 10; start += 1) {
    const needed = [start, start + 1, start + 2, start + 3, start + 4];
    const hits = needed.filter(value => values.includes(value));
    if (hits.length >= 4) {
      const missing = needed.filter(value => !values.includes(value));
      if (missing.length === 1) return missing[0] === start || missing[0] === start + 4 ? 'open' : 'gutshot';
    }
  }
  return null;
}

function holdemPreflopStrength(hole: string[]): number {
  const values = hole.map(card => holdemRankValue(blackjackRank(card))).sort((a, b) => b - a);
  const suited = blackjackSuit(hole[0]) === blackjackSuit(hole[1]);
  const pair = values[0] === values[1];
  const gap = Math.abs(values[0] - values[1]);
  let score = (values[0] + values[1]) / 40;
  if (pair) score = 0.45 + values[0] / 20;
  if (suited) score += 0.05;
  if (gap === 0) score += 0.12;
  else if (gap === 1) score += 0.06;
  else if (gap === 2) score += 0.03;
  if (values[0] >= 13 && values[1] >= 10) score += 0.06;
  if (values[0] === 14) score += 0.03;
  return Math.max(0.05, Math.min(0.99, score));
}

function holdemStrengthScore(seat: HoldemSeatState, table: HoldemRuntimeTable): number {
  const cards = [...seat.hole, ...table.community];
  if (table.community.length === 0) return holdemPreflopStrength(seat.hole);
  const best = bestHoldemHand(cards);
  const baseMap: Record<string, number> = {
    high_card: 0.18,
    one_pair: 0.40,
    two_pair: 0.58,
    three_kind: 0.68,
    straight: 0.78,
    flush: 0.82,
    full_house: 0.9,
    four_kind: 0.96,
    straight_flush: 0.985,
    royal_flush: 0.995,
  };
  let score = baseMap[best.label] ?? 0.15;
  if (best.label === 'high_card') score += (best.tiebreak[0] ?? 0) / 100;
  else if (best.label === 'one_pair') score += (best.tiebreak[0] ?? 0) / 80;
  if (holdemHasFlushDraw(cards)) score += 0.05;
  const straightDraw = holdemHasStraightDraw(cards);
  if (straightDraw === 'open') score += 0.05;
  else if (straightDraw === 'gutshot') score += 0.025;
  return Math.max(0.05, Math.min(0.995, score));
}

function holdemArchetypeFromNpc(npc: Row, seat: number): HoldemArchetype {
  const personality = String(npc.personality ?? '').toLowerCase();
  if (personality === 'aggressive') return seat % 2 === 0 ? 'aggressive' : 'gambler';
  if (personality === 'trader') return seat % 2 === 0 ? 'shark' : 'tight';
  if (personality === 'defensive') return seat % 2 === 0 ? 'tight' : 'passive';
  if (personality === 'passive') return seat % 2 === 0 ? 'passive' : 'loose';
  return HOLDEM_ARCHETYPES[seat % HOLDEM_ARCHETYPES.length];
}

async function pickHoldemOpponents(env: Env, roundId: string, count: number): Promise<Row[]> {
  const res = await env.DB.prepare(
    `SELECT id, name, side, personality
       FROM game_npcs
      WHERE round_id = ? AND is_alive = 1
      ORDER BY RANDOM()
      LIMIT ?`
  ).bind(roundId, count).all<Row>();
  return res.results;
}

function holdemSeatOrderForPayout(table: HoldemRuntimeTable, indexes: number[]): number[] {
  const ordered: number[] = [];
  let cursor = table.button;
  for (let step = 0; step < table.seats.length; step += 1) {
    cursor = (cursor + 1) % table.seats.length;
    if (indexes.includes(cursor)) ordered.push(cursor);
  }
  return ordered;
}

function holdemBuildSeatView(
  seat: HoldemSeatState,
  table: HoldemRuntimeTable,
  reveal: boolean,
  isCurrent: boolean,
  isSb: boolean,
  isBb: boolean
): Record<string, unknown> {
  const hole = seat.hole.map(card => blackjackCardView(card, seat.kind !== 'player' && !reveal));
  return {
    seat: seat.seat,
    id: seat.id,
    kind: seat.kind,
    name: seat.name,
    side: seat.side,
    personality: seat.personality,
    archetype: seat.archetype,
    stack: seat.stack,
    folded: seat.folded,
    all_in: seat.allIn,
    last_action: seat.lastAction,
    committed: seat.totalBet,
    hole_cards: hole,
    is_player: seat.kind === 'player',
    is_turn: isCurrent,
    dealer: table.button === seat.seat,
    small_blind: isSb,
    big_blind: isBb,
  };
}

function holdemTableCanContinue(table: HoldemRuntimeTable): boolean {
  const active = table.seats.filter(seat => seat.stack > 0);
  return active.length >= 2 && table.seats[table.playerSeat].stack > 0;
}

function buildHoldemState(table: HoldemRuntimeTable | null, player: Row): Record<string, unknown> {
  if (!table) {
    return {
      idle: true,
      player_cash: Number(player.cash ?? 0),
      min_buy_in: HOLDEM_MIN_BUYIN,
      max_buy_in: HOLDEM_MAX_BUYIN,
      small_blind: HOLDEM_SMALL_BLIND,
      big_blind: HOLDEM_BIG_BLIND,
    };
  }

  const playerSeat = table.seats[table.playerSeat];
  const toCall = holdemToCall(table, playerSeat);
  const unit = holdemBetUnit(table.street);
  const raiseLocked = table.raiseLocked.includes(playerSeat.seat);
  const canAct = table.actionIndex === playerSeat.seat && holdemCanSeatAct(playerSeat)
    && (table.street === 'preflop' || table.street === 'flop' || table.street === 'turn' || table.street === 'river');
  const canBet = canAct && table.currentBet === 0 && playerSeat.stack >= unit && table.aggressiveActions < HOLDEM_MAX_AGGRESSIVE_ACTIONS;
  const canRaise = canAct
    && table.currentBet > 0
    && !raiseLocked
    && table.aggressiveActions < HOLDEM_MAX_AGGRESSIVE_ACTIONS
    && playerSeat.stack >= toCall + unit;
  const canAllIn = canAct && playerSeat.stack > 0 && (!raiseLocked || playerSeat.stack <= toCall);
  const revealOpponents = table.street === 'hand_over' || table.street === 'table_over';
  const { sb, bb } = holdemBlindPositions(table);

  return {
    idle: false,
    player_cash: Number(player.cash ?? 0),
    min_buy_in: HOLDEM_MIN_BUYIN,
    max_buy_in: HOLDEM_MAX_BUYIN,
    small_blind: table.smallBlind,
    big_blind: table.bigBlind,
    table: {
      id: table.id,
      buy_in: table.buyIn,
      street: table.street,
      hand_number: table.handNumber,
      pot: holdemTotalPot(table),
      current_bet: table.currentBet,
      call_amount: toCall,
      bet_amount: unit,
      raise_amount: toCall + unit,
      player_stack: playerSeat.stack,
      action_on_player: canAct,
      can_fold: canAct,
      can_check: canAct && toCall === 0,
      can_call: canAct && toCall > 0,
      can_bet: canBet,
      can_raise: canRaise,
      can_all_in: canAllIn,
      can_next_hand: table.street === 'hand_over' && holdemTableCanContinue(table),
      can_leave: table.street === 'hand_over' || table.street === 'table_over',
      raise_locked: raiseLocked,
      message: table.message,
      result: table.result,
      community_cards: table.community.map(card => blackjackCardView(card)),
      seats: table.seats.map((seat, index) => holdemBuildSeatView(seat, table, revealOpponents, table.actionIndex === seat.seat, sb === index, bb === index)),
    },
  };
}

function holdemRoundClosed(table: HoldemRuntimeTable): boolean {
  const live = holdemLiveSeats(table);
  if (live.length <= 1) return true;
  const actionable = holdemActionableSeats(table);
  if (!actionable.length) return true;
  return actionable.every(seat => seat.acted && seat.streetBet === table.currentBet);
}

function holdemResetResponses(table: HoldemRuntimeTable, actorSeat: number, onlyUnderCurrentBet = false): void {
  for (const seat of table.seats) {
    if (!holdemCanSeatAct(seat) || seat.seat === actorSeat) continue;
    if (onlyUnderCurrentBet && seat.streetBet >= table.currentBet) continue;
    seat.acted = false;
  }
}

function holdemPostBlind(table: HoldemRuntimeTable, seatIndex: number, amount: number, label: string): void {
  const seat = table.seats[seatIndex];
  const posted = holdemApplyContribution(seat, amount);
  seat.lastAction = posted < amount ? `All-in ${label}` : label;
  seat.acted = !holdemCanSeatAct(seat);
}

function holdemInitHand(table: HoldemRuntimeTable): void {
  const available = table.seats.filter(seat => seat.stack > 0);
  if (available.length < 2 || table.seats[table.playerSeat].stack <= 0) {
    table.street = 'table_over';
    table.actionIndex = null;
    table.message = table.seats[table.playerSeat].stack <= 0
      ? 'Du är pank vid pokerbordet.'
      : 'Bordet är tomt. Plocka markerna och lämna lokalen.';
    table.result = table.seats[table.playerSeat].stack <= 0 ? 'busted' : 'table_clear';
    return;
  }

  table.button = holdemNextSeat(table, table.button, seat => seat.stack > 0) ?? table.button;
  table.handNumber += 1;
  table.deck = shuffleBlackjackDeck(buildBlackjackDeck());
  table.community = [];
  table.message = `Hand ${table.handNumber}. Mörkarna ligger inne.`;
  table.result = null;
  table.handStartStacks = table.seats.map(seat => seat.stack);
  table.raiseLocked = [];

  for (const seat of table.seats) {
    seat.hole = [];
    seat.folded = seat.stack <= 0;
    seat.allIn = false;
    seat.streetBet = 0;
    seat.totalBet = 0;
    seat.acted = seat.stack <= 0;
    seat.lastAction = null;
  }

  for (let round = 0; round < 2; round += 1) {
    for (let idx = 0; idx < table.seats.length; idx += 1) {
      const seat = table.seats[idx];
      if (seat.stack > 0) seat.hole.push(drawBlackjackCard(table.deck));
    }
  }

  table.street = 'preflop';
  table.currentBet = table.bigBlind;
  table.minRaise = holdemBetUnit('preflop');
  table.aggressiveActions = 0;
  const { sb, bb } = holdemBlindPositions(table);
  holdemPostBlind(table, sb, table.smallBlind, 'Lilla mörken');
  holdemPostBlind(table, bb, table.bigBlind, 'Stora mörken');
  table.actionIndex = holdemActionStartIndex(table);
}

function holdemAdvanceStreet(table: HoldemRuntimeTable): void {
  if (table.street === 'preflop') {
    table.community.push(drawBlackjackCard(table.deck), drawBlackjackCard(table.deck), drawBlackjackCard(table.deck));
    holdemResetStreet(table, 'flop');
    table.message = 'Floppen ligger ute.';
    return;
  }
  if (table.street === 'flop') {
    table.community.push(drawBlackjackCard(table.deck));
    holdemResetStreet(table, 'turn');
    table.message = 'Turnen slog ner i filten.';
    return;
  }
  if (table.street === 'turn') {
    table.community.push(drawBlackjackCard(table.deck));
    holdemResetStreet(table, 'river');
    table.message = 'Rivern är öppen. Nu kostar tvekan.';
  }
}

function holdemPickWinners(table: HoldemRuntimeTable, indexes: number[]): { winners: number[]; best: HoldemHandValue } {
  let best = bestHoldemHand([...table.seats[indexes[0]].hole, ...table.community]);
  const winners = [indexes[0]];
  for (let i = 1; i < indexes.length; i += 1) {
    const idx = indexes[i];
    const value = bestHoldemHand([...table.seats[idx].hole, ...table.community]);
    const cmp = compareHoldemHands(value, best);
    if (cmp > 0) {
      best = value;
      winners.length = 0;
      winners.push(idx);
    } else if (cmp === 0) {
      winners.push(idx);
    }
  }
  return { winners, best };
}

function holdemResolvePots(table: HoldemRuntimeTable): { winners: number[]; best: HoldemHandValue | null; payouts: Map<number, number> } {
  const payouts = new Map<number, number>();
  const levels = [...new Set(table.seats.map(seat => seat.totalBet).filter(total => total > 0))].sort((a, b) => a - b);
  let previous = 0;
  let best: HoldemHandValue | null = null;
  const allWinners = new Set<number>();

  for (const level of levels) {
    const diff = level - previous;
    previous = level;
    const contributors = table.seats.map((seat, index) => ({ seat, index })).filter(entry => entry.seat.totalBet >= level);
    const potAmount = diff * contributors.length;
    const eligible = contributors.filter(entry => !entry.seat.folded && entry.seat.hole.length === 2).map(entry => entry.index);
    if (!potAmount || !eligible.length) continue;
    const result = holdemPickWinners(table, eligible);
    const split = Math.floor(potAmount / result.winners.length);
    let remainder = potAmount - split * result.winners.length;
    for (const idx of result.winners) {
      payouts.set(idx, (payouts.get(idx) ?? 0) + split);
      allWinners.add(idx);
    }
    for (const idx of holdemSeatOrderForPayout(table, result.winners)) {
      if (remainder <= 0) break;
      payouts.set(idx, (payouts.get(idx) ?? 0) + 1);
      remainder -= 1;
    }
    best = !best || compareHoldemHands(result.best, best) >= 0 ? result.best : best;
  }

  for (const [idx, amount] of payouts) table.seats[idx].stack += amount;
  return { winners: [...allWinners], best, payouts };
}

function holdemFinalizeHand(table: HoldemRuntimeTable): { net: number; message: string; outcome: HoldemResult } {
  let message = table.message || 'Handen är klar.';
  let outcome: HoldemResult = 'lose';
  const live = holdemLiveSeats(table);
  const playerStart = table.handStartStacks[table.playerSeat] ?? table.buyIn;

  if (live.length === 1) {
    const winner = live[0];
    const pot = holdemTotalPot(table);
    winner.stack += pot;
    message = winner.seat === table.playerSeat
      ? `Alla vek sig. Du skrapade hem ${fmtCurrency(pot)} kr i potten.`
      : `${winner.name} tog hem potten utan showdown.`;
    outcome = winner.seat === table.playerSeat ? 'win' : 'lose';
  } else {
    const result = holdemResolvePots(table);
    const playerWon = result.payouts.get(table.playerSeat) ?? 0;
    const winnerNames = result.winners.map(idx => table.seats[idx].name).join(', ');
    if (result.winners.includes(table.playerSeat)) {
      outcome = result.winners.length > 1 ? 'split' : 'win';
      message = result.winners.length > 1
        ? `Delad pott med ${winnerNames}. Din del: ${fmtCurrency(playerWon)} kr med ${result.best?.name ?? 'hand'}.`
        : `Showdown vunnen. Du tog ${fmtCurrency(playerWon)} kr med ${result.best?.name ?? 'hand'}.`;
    } else {
      outcome = 'lose';
      message = `${winnerNames} tog potten med ${result.best?.name ?? 'starkare hand'}.`;
    }
  }

  for (const seat of table.seats) {
    seat.streetBet = 0;
    seat.totalBet = 0;
    seat.acted = true;
    seat.lastAction = seat.folded ? 'Fold' : seat.lastAction;
  }

  table.actionIndex = null;
  table.currentBet = 0;
  table.aggressiveActions = 0;
  table.raiseLocked = [];
  table.result = outcome;
  if (!holdemTableCanContinue(table)) {
    table.street = 'table_over';
    if (table.seats[table.playerSeat].stack <= 0) {
      table.result = 'busted';
      message = `${message} Du är tom på marker.`;
    } else {
      table.result = 'table_clear';
      message = `${message} Bordet är ditt nu.`;
    }
  } else {
    table.street = 'hand_over';
  }
  table.message = message;
  return { net: table.seats[table.playerSeat].stack - playerStart, message, outcome: table.result };
}

function holdemNpcDecision(table: HoldemRuntimeTable, seatIndex: number): HoldemActionKind {
  const seat = table.seats[seatIndex];
  const strength = holdemStrengthScore(seat, table);
  const toCall = holdemToCall(table, seat);
  const unit = holdemBetUnit(table.street);
  const potOdds = toCall > 0 ? toCall / Math.max(1, holdemTotalPot(table) + toCall) : 0;
  const archetype = seat.archetype;
  const tightness = archetype === 'tight' || archetype === 'shark' ? 0.08 : archetype === 'loose' || archetype === 'gambler' ? -0.06 : 0;
  const aggression = archetype === 'aggressive' || archetype === 'gambler' ? 0.08 : archetype === 'passive' ? -0.05 : 0;

  if (toCall > 0) {
    if (seat.stack <= toCall) return strength > 0.38 - tightness ? 'all-in' : 'fold';
    if (strength < 0.24 + potOdds * 0.55 + tightness && Math.random() > 0.12) return 'fold';
    if (!table.raiseLocked.includes(seat.seat) && table.aggressiveActions < HOLDEM_MAX_AGGRESSIVE_ACTIONS && seat.stack >= toCall + unit) {
      if (strength > 0.72 - aggression || (strength > 0.55 && Math.random() < 0.16 + aggression)) return 'raise';
    }
    if (strength > 0.9 && seat.stack <= toCall + unit * 2) return 'all-in';
    return 'call';
  }

  if (table.aggressiveActions < HOLDEM_MAX_AGGRESSIVE_ACTIONS && seat.stack >= unit) {
    const bluff = archetype === 'gambler' ? 0.16 : archetype === 'aggressive' ? 0.1 : 0.04;
    if (strength > 0.6 - aggression || (Math.random() < bluff && table.street !== 'river')) return 'bet';
  }
  if (strength > 0.95 && seat.stack <= unit * 2) return 'all-in';
  return 'check';
}

function holdemApplyAction(table: HoldemRuntimeTable, seatIndex: number, action: HoldemActionKind): void {
  const seat = table.seats[seatIndex];
  if (!holdemCanSeatAct(seat)) throw new GameError('Den platsen kan inte agera nu.', 409);
  const toCall = holdemToCall(table, seat);
  const unit = holdemBetUnit(table.street);
  const locked = table.raiseLocked.includes(seat.seat);
  let increased = false;
  let fullRaise = false;

  switch (action) {
    case 'fold':
      seat.folded = true;
      seat.acted = true;
      seat.lastAction = 'Fold';
      break;
    case 'check':
      if (toCall > 0) throw new GameError('Du måste syna, höja eller lägga dig.', 400);
      seat.acted = true;
      seat.lastAction = 'Check';
      break;
    case 'call': {
      if (toCall <= 0) throw new GameError('Det finns inget att syna.', 400);
      const paid = holdemApplyContribution(seat, toCall);
      seat.acted = true;
      seat.lastAction = paid < toCall ? 'All-in' : 'Call';
      break;
    }
    case 'bet':
      if (toCall > 0 || table.currentBet > 0) throw new GameError('Insatsen är redan öppen. Höj i stället.', 400);
      if (table.aggressiveActions >= HOLDEM_MAX_AGGRESSIVE_ACTIONS) throw new GameError('Insatsrundan är redan capad.', 400);
      if (seat.stack < unit) throw new GameError('Du har inte nog för en full limit-insats. Kör all-in i stället.', 400);
      holdemApplyContribution(seat, unit);
      table.currentBet = seat.streetBet;
      table.aggressiveActions = 1;
      seat.acted = true;
      seat.lastAction = 'Bet';
      increased = true;
      fullRaise = true;
      break;
    case 'raise':
      if (toCall <= 0) throw new GameError('Det finns inget att höja över.', 400);
      if (locked) throw new GameError('Actionen är inte återöppnad för höjning. Du får syna eller lägga dig.', 400);
      if (table.aggressiveActions >= HOLDEM_MAX_AGGRESSIVE_ACTIONS) throw new GameError('Rundan är redan capad.', 400);
      if (seat.stack < toCall + unit) throw new GameError('Du har inte nog för en full limit-höjning. Kör all-in i stället.', 400);
      holdemApplyContribution(seat, toCall + unit);
      table.currentBet = seat.streetBet;
      table.aggressiveActions += 1;
      seat.acted = true;
      seat.lastAction = 'Raise';
      increased = true;
      fullRaise = true;
      break;
    case 'all-in': {
      if (seat.stack <= 0) throw new GameError('Du har inga marker kvar.', 400);
      if (locked && seat.stack > toCall) throw new GameError('Actionen är inte återöppnad. Du kan inte ställa in över synen här.', 400);
      const before = seat.streetBet;
      const paid = holdemApplyContribution(seat, seat.stack);
      seat.acted = true;
      seat.lastAction = 'All-in';
      if (before + paid > table.currentBet) {
        const diff = before + paid - table.currentBet;
        table.currentBet = before + paid;
        increased = true;
        if (diff >= table.minRaise) {
          table.aggressiveActions += 1;
          fullRaise = true;
        } else {
          for (const other of table.seats) {
            if (other.seat !== seat.seat && other.acted && holdemCanSeatAct(other) && !table.raiseLocked.includes(other.seat)) {
              table.raiseLocked.push(other.seat);
            }
          }
        }
      }
      break;
    }
    default:
      throw new GameError('Ogiltig pokeraction.', 400);
  }

  if (holdemLiveSeats(table).length <= 1) {
    table.actionIndex = null;
    return;
  }
  if (increased) {
    if (fullRaise) table.raiseLocked = [];
    holdemResetResponses(table, seat.seat, true);
  }
  table.actionIndex = holdemNextSeat(table, seat.seat, holdemCanSeatAct);
}

function holdemAdvanceToPlayer(table: HoldemRuntimeTable): { net: number; message: string; outcome: HoldemResult } | null {
  while (true) {
    if (holdemLiveSeats(table).length <= 1) return holdemFinalizeHand(table);
    if (holdemRoundClosed(table)) {
      if (table.street === 'river') return holdemFinalizeHand(table);
      holdemAdvanceStreet(table);
      if (holdemLiveSeats(table).length <= 1) return holdemFinalizeHand(table);
      continue;
    }
    if (table.actionIndex === null) {
      table.actionIndex = holdemActionStartIndex(table);
      if (table.actionIndex === null) return holdemFinalizeHand(table);
    }
    const seat = table.seats[table.actionIndex];
    if (seat.kind === 'player') return null;
    holdemApplyAction(table, table.actionIndex, holdemNpcDecision(table, table.actionIndex));
  }
}

function parseHoldemSeat(raw: unknown, index: number): HoldemSeatState {
  if (!raw || typeof raw !== 'object') throw new GameError(`Pokerstate för plats ${index + 1} är trasig.`, 500);
  const seat = raw as Record<string, unknown>;
  const archetype = HOLDEM_ARCHETYPES.includes(String(seat.archetype ?? '') as HoldemArchetype)
    ? String(seat.archetype) as HoldemArchetype
    : HOLDEM_ARCHETYPES[index % HOLDEM_ARCHETYPES.length];
  return {
    seat: Number(seat.seat ?? index),
    id: String(seat.id ?? `seat-${index}`),
    kind: String(seat.kind ?? 'npc') === 'player' ? 'player' : 'npc',
    playerId: seat.playerId == null ? null : String(seat.playerId),
    npcId: seat.npcId == null ? null : String(seat.npcId),
    name: String(seat.name ?? `Stol ${index + 1}`),
    side: seat.side == null ? null : String(seat.side),
    personality: seat.personality == null ? null : String(seat.personality),
    archetype,
    stack: Math.max(0, Math.floor(Number(seat.stack ?? 0))),
    hole: Array.isArray(seat.hole) ? seat.hole.filter(card => typeof card === 'string').map(String) : [],
    folded: !!seat.folded,
    allIn: !!seat.allIn,
    streetBet: Math.max(0, Math.floor(Number(seat.streetBet ?? 0))),
    totalBet: Math.max(0, Math.floor(Number(seat.totalBet ?? 0))),
    acted: !!seat.acted,
    lastAction: seat.lastAction == null ? null : String(seat.lastAction),
  };
}

function rowToHoldemTable(row: Row): HoldemRuntimeTable {
  if (typeof row.state_json !== 'string' || !row.state_json.trim()) {
    throw new GameError('Pokerbordets state saknas.', 500);
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(row.state_json) as Record<string, unknown>;
  } catch {
    throw new GameError('Pokerbordets state kunde inte läsas.', 500);
  }
  const streetRaw = String(parsed.street ?? 'preflop');
  const street: HoldemStreet = ['preflop', 'flop', 'turn', 'river', 'hand_over', 'table_over'].includes(streetRaw)
    ? streetRaw as HoldemStreet
    : 'preflop';
  const resultRaw = parsed.result == null ? null : String(parsed.result);
  const result: HoldemResult = resultRaw === 'win' || resultRaw === 'lose' || resultRaw === 'split' || resultRaw === 'table_clear' || resultRaw === 'busted'
    ? resultRaw
    : null;
  const seats = Array.isArray(parsed.seats) ? parsed.seats.map(parseHoldemSeat) : [];
  if (!seats.length) throw new GameError('Pokerbordet saknar spelare.', 500);
  const handStartStacks = Array.isArray(parsed.handStartStacks)
    ? parsed.handStartStacks.map(value => Math.max(0, Math.floor(Number(value ?? 0))))
    : seats.map(seat => seat.stack);
  return {
    id: String(row.id),
    playerId: String(row.player_id),
    roundId: String(row.round_id),
    buyIn: Math.max(HOLDEM_MIN_BUYIN, Math.floor(Number(row.buy_in ?? parsed.buyIn ?? HOLDEM_MIN_BUYIN))),
    smallBlind: Math.max(1, Math.floor(Number(row.small_blind ?? parsed.smallBlind ?? HOLDEM_SMALL_BLIND))),
    bigBlind: Math.max(1, Math.floor(Number(row.big_blind ?? parsed.bigBlind ?? HOLDEM_BIG_BLIND))),
    button: Math.max(0, Math.floor(Number(parsed.button ?? 0))),
    playerSeat: Math.max(0, Math.floor(Number(parsed.playerSeat ?? 0))),
    handNumber: Math.max(0, Math.floor(Number(parsed.handNumber ?? 0))),
    street,
    actionIndex: parsed.actionIndex == null ? null : Math.max(0, Math.floor(Number(parsed.actionIndex))),
    currentBet: Math.max(0, Math.floor(Number(parsed.currentBet ?? 0))),
    minRaise: Math.max(0, Math.floor(Number(parsed.minRaise ?? HOLDEM_BIG_BLIND))),
    aggressiveActions: Math.max(0, Math.floor(Number(parsed.aggressiveActions ?? 0))),
    raiseLocked: Array.isArray(parsed.raiseLocked) ? parsed.raiseLocked.map(value => Math.max(0, Math.floor(Number(value ?? 0)))) : [],
    community: Array.isArray(parsed.community) ? parsed.community.filter(card => typeof card === 'string').map(String) : [],
    deck: Array.isArray(parsed.deck) ? parsed.deck.filter(card => typeof card === 'string').map(String) : [],
    message: parsed.message == null ? null : String(parsed.message),
    result,
    seats,
    handStartStacks,
  };
}

async function getHoldemTableForPlayer(env: Env, player: Row): Promise<HoldemRuntimeTable | null> {
  try {
    const row = await env.DB.prepare(
      `SELECT * FROM game_holdem_tables WHERE player_id = ? AND round_id = ? LIMIT 1`
    ).bind(player.id as string, player.round_id as string).first<Row>();
    return row ? rowToHoldemTable(row) : null;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('no such table')) {
      throw new GameError('Hold’em-tabellen saknas. Kör game-migration-holdem.sql mot D1.', 500);
    }
    throw e;
  }
}

async function saveHoldemTable(env: Env, table: HoldemRuntimeTable): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT INTO game_holdem_tables
         (id, player_id, round_id, buy_in, small_blind, big_blind, status, state_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
       ON CONFLICT(player_id) DO UPDATE SET
         round_id = excluded.round_id,
         buy_in = excluded.buy_in,
         small_blind = excluded.small_blind,
         big_blind = excluded.big_blind,
         status = excluded.status,
         state_json = excluded.state_json,
         updated_at = datetime('now')`
    ).bind(
      table.id,
      table.playerId,
      table.roundId,
      table.buyIn,
      table.smallBlind,
      table.bigBlind,
      table.street === 'table_over' ? 'finished' : 'active',
      JSON.stringify(table)
    ).run();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('no such table')) {
      throw new GameError('Hold’em-tabellen saknas. Kör game-migration-holdem.sql mot D1.', 500);
    }
    throw e;
  }
}

async function deleteHoldemTable(env: Env, playerId: string): Promise<void> {
  try {
    await env.DB.prepare(`DELETE FROM game_holdem_tables WHERE player_id = ?`).bind(playerId).run();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('no such table')) {
      throw new GameError('Hold’em-tabellen saknas. Kör game-migration-holdem.sql mot D1.', 500);
    }
    throw e;
  }
}

async function createHoldemTable(env: Env, player: Row, buyIn: number): Promise<HoldemRuntimeTable> {
  const opponents = await pickHoldemOpponents(env, String(player.round_id), HOLDEM_NPC_COUNT);
  if (!opponents.length) {
    throw new GameError('Pokerhörnan är mörk. Inga motspelare sitter inne än. Kör game-seed.sql först.', 500);
  }
  const seats: HoldemSeatState[] = [
    {
      seat: 0,
      id: String(player.id),
      kind: 'player',
      playerId: String(player.id),
      npcId: null,
      name: String(player.name),
      side: player.side == null ? null : String(player.side),
      personality: null,
      archetype: 'tight',
      stack: buyIn,
      hole: [],
      folded: false,
      allIn: false,
      streetBet: 0,
      totalBet: 0,
      acted: false,
      lastAction: null,
    },
    ...opponents.map((npc, index) => ({
      seat: index + 1,
      id: String(npc.id ?? `npc-${index + 1}`),
      kind: 'npc' as const,
      playerId: null,
      npcId: String(npc.id ?? `npc-${index + 1}`),
      name: String(npc.name ?? `Skugga ${index + 1}`),
      side: npc.side == null ? null : String(npc.side),
      personality: npc.personality == null ? null : String(npc.personality),
      archetype: holdemArchetypeFromNpc(npc, index + 1),
      stack: buyIn,
      hole: [],
      folded: false,
      allIn: false,
      streetBet: 0,
      totalBet: 0,
      acted: false,
      lastAction: null,
    })),
  ];

  const table: HoldemRuntimeTable = {
    id: crypto.randomUUID(),
    playerId: String(player.id),
    roundId: String(player.round_id),
    buyIn,
    smallBlind: HOLDEM_SMALL_BLIND,
    bigBlind: HOLDEM_BIG_BLIND,
    button: seats.length - 1,
    playerSeat: 0,
    handNumber: 0,
    street: 'hand_over',
    actionIndex: null,
    currentBet: 0,
    minRaise: HOLDEM_BIG_BLIND,
    aggressiveActions: 0,
    raiseLocked: [],
    community: [],
    deck: [],
    message: 'Du glider in i pokerhörnan och köper marker.',
    result: null,
    seats,
    handStartStacks: seats.map(seat => seat.stack),
  };

  holdemInitHand(table);
  holdemAdvanceToPlayer(table);
  return table;
}

async function gameGetHoldemState(request: Request, env: Env): Promise<Response> {
  let player: Row;
  try { player = await requireGamePlayer(request, env); }
  catch (e) { return gameJson({ error: (e as GameError).message }, (e as GameError).status ?? 401); }

  try {
    const table = await getHoldemTableForPlayer(env, player);
    return gameJson(buildHoldemState(table, player));
  } catch (e) {
    return gameJson({ error: (e as GameError).message }, (e as GameError).status ?? 500);
  }
}

async function gameActionHoldemStart(request: Request, env: Env): Promise<Response> {
  let player: Row;
  try { player = await requireGamePlayer(request, env); }
  catch (e) { return gameJson({ error: (e as GameError).message }, (e as GameError).status ?? 401); }

  try {
    if (player.in_prison) return gameJson({ error: 'Pokerbordet släpper inte in dig från kåken.' }, 400);
    if (player.in_hospital) return gameJson({ error: 'Du är fortfarande på sjukhuset.' }, 400);

    const body = await request.json<{ buy_in?: number }>().catch(() => ({} as { buy_in?: number }));
    const requested = Math.floor(Number(body.buy_in ?? 0));
    if (!Number.isFinite(requested) || requested < HOLDEM_MIN_BUYIN) {
      return gameJson({ error: `Minsta buy-in är ${fmtCurrency(HOLDEM_MIN_BUYIN)} kr.` }, 400);
    }
    if (requested > HOLDEM_MAX_BUYIN) {
      return gameJson({ error: `Max buy-in är ${fmtCurrency(HOLDEM_MAX_BUYIN)} kr.` }, 400);
    }
    const buyIn = normalizeHoldemBuyIn(requested);
    const cash = Number(player.cash ?? 0);
    if (cash < buyIn) {
      return gameJson({ error: `Du har bara ${fmtCurrency(cash)} kr. Köp in dig billigare.` }, 400);
    }

    const existing = await getHoldemTableForPlayer(env, player);
    if (existing) {
      return gameJson({ error: 'Du sitter redan vid ett bord. Spela klart eller lämna bordet först.', ...buildHoldemState(existing, player) }, 409);
    }

    await env.DB.prepare(`DELETE FROM game_holdem_tables WHERE player_id = ? AND round_id != ?`)
      .bind(player.id as string, player.round_id as string).run();
    await env.DB.prepare(`UPDATE game_players SET cash = cash - ?, last_action = datetime('now') WHERE id = ?`)
      .bind(buyIn, player.id as string).run();

    const table = await createHoldemTable(env, player, buyIn);
    await saveHoldemTable(env, table);
    await logAction(env, player.id as string, 'casino', `Köpte in dig i Texas Hold'em med ${fmtCurrency(buyIn)} kr i marker.`, -buyIn, 0, 0, true);

    const freshPlayer = await loadGamePlayerById(env, player.id as string);
    return gameJson(buildHoldemState(table, freshPlayer));
  } catch (e) {
    return gameJson({ error: (e as GameError).message }, (e as GameError).status ?? 500);
  }
}

async function gameActionHoldemAct(request: Request, env: Env): Promise<Response> {
  let player: Row;
  try { player = await requireGamePlayer(request, env); }
  catch (e) { return gameJson({ error: (e as GameError).message }, (e as GameError).status ?? 401); }

  let table: HoldemRuntimeTable | null = null;
  try {
    if (player.in_prison) return gameJson({ error: 'Du sitter i fängelse. Bordet är stängt för dig.' }, 400);
    if (player.in_hospital) return gameJson({ error: 'Du är på sjukhus. Inget pokerface i dropp just nu.' }, 400);

    table = await getHoldemTableForPlayer(env, player);
    if (!table) return gameJson({ error: 'Du sitter inte vid något Hold’em-bord.' }, 400);
    if (table.street === 'hand_over' || table.street === 'table_over') {
      return gameJson({ error: 'Handen är redan avgjord. Starta nästa hand eller lämna bordet.', ...buildHoldemState(table, player) }, 409);
    }
    if (table.actionIndex !== table.playerSeat) {
      return gameJson({ error: 'Det är inte din tur ännu.', ...buildHoldemState(table, player) }, 409);
    }

    const body = await request.json<{ action?: string }>().catch(() => ({} as { action?: string }));
    const action = String(body.action ?? '').toLowerCase() as HoldemActionKind;
    if (!['fold', 'check', 'call', 'bet', 'raise', 'all-in'].includes(action)) {
      return gameJson({ error: 'Ogiltig pokeraction.', ...buildHoldemState(table, player) }, 400);
    }

    holdemApplyAction(table, table.playerSeat, action);
    const resolved = holdemAdvanceToPlayer(table);
    await saveHoldemTable(env, table);

    if (resolved) {
      await logAction(
        env,
        player.id as string,
        'casino',
        resolved.message,
        0,
        0,
        0,
        resolved.outcome === 'win' || resolved.outcome === 'split' || resolved.outcome === 'table_clear'
      );
    }

    const freshPlayer = await loadGamePlayerById(env, player.id as string);
    return gameJson(buildHoldemState(table, freshPlayer));
  } catch (e) {
    if (table) return gameJson({ error: (e as GameError).message, ...buildHoldemState(table, player) }, (e as GameError).status ?? 500);
    return gameJson({ error: (e as GameError).message }, (e as GameError).status ?? 500);
  }
}

async function gameActionHoldemNextHand(request: Request, env: Env): Promise<Response> {
  let player: Row;
  try { player = await requireGamePlayer(request, env); }
  catch (e) { return gameJson({ error: (e as GameError).message }, (e as GameError).status ?? 401); }

  try {
    const table = await getHoldemTableForPlayer(env, player);
    if (!table) return gameJson({ error: 'Du sitter inte vid något Hold’em-bord.' }, 400);
    if (table.street !== 'hand_over') {
      return gameJson({ error: table.street === 'table_over' ? 'Bordet är över. Lämna bordet och köp in igen.' : 'Nuvarande hand är inte färdig än.', ...buildHoldemState(table, player) }, 409);
    }
    if (!holdemTableCanContinue(table)) {
      table.street = 'table_over';
      table.message = table.seats[table.playerSeat].stack <= 0
        ? 'Du är rökt vid pokerbordet. Lämna bordet och bygg upp kassan igen.'
        : 'Bordet dog ut. Plocka markerna och stick.';
      table.result = table.seats[table.playerSeat].stack <= 0 ? 'busted' : 'table_clear';
      await saveHoldemTable(env, table);
      return gameJson({ error: 'Bordet kan inte fortsätta. Lämna bordet först.', ...buildHoldemState(table, player) }, 409);
    }

    holdemInitHand(table);
    holdemAdvanceToPlayer(table);
    await saveHoldemTable(env, table);
    const freshPlayer = await loadGamePlayerById(env, player.id as string);
    return gameJson(buildHoldemState(table, freshPlayer));
  } catch (e) {
    return gameJson({ error: (e as GameError).message }, (e as GameError).status ?? 500);
  }
}

async function gameActionHoldemLeave(request: Request, env: Env): Promise<Response> {
  let player: Row;
  try { player = await requireGamePlayer(request, env); }
  catch (e) { return gameJson({ error: (e as GameError).message }, (e as GameError).status ?? 401); }

  try {
    const table = await getHoldemTableForPlayer(env, player);
    if (!table) return gameJson(buildHoldemState(null, player));
    if (!(table.street === 'hand_over' || table.street === 'table_over')) {
      return gameJson({ error: 'Du kan bara lämna bordet mellan händerna.', ...buildHoldemState(table, player) }, 409);
    }

    const stack = Math.max(0, Math.floor(Number(table.seats[table.playerSeat]?.stack ?? 0)));
    const net = stack - table.buyIn;
    if (stack > 0) {
      await env.DB.prepare(`UPDATE game_players SET cash = cash + ?, last_action = datetime('now') WHERE id = ?`)
        .bind(stack, player.id as string).run();
    } else {
      await env.DB.prepare(`UPDATE game_players SET last_action = datetime('now') WHERE id = ?`)
        .bind(player.id as string).run();
    }
    await deleteHoldemTable(env, player.id as string);

    const description = net > 0
      ? `Lämnade Texas Hold'em-bordet med ${fmtCurrency(stack)} kr i marker. Nettot blev +${fmtCurrency(net)} kr.`
      : net < 0
        ? `Lämnade Texas Hold'em-bordet med ${fmtCurrency(stack)} kr. Blödde ${fmtCurrency(Math.abs(net))} kr på kvällen.`
        : `Lämnade Texas Hold'em-bordet jämnt på ${fmtCurrency(stack)} kr.`;
    await logAction(env, player.id as string, 'casino', description, stack, 0, 0, stack > 0);

    const freshPlayer = await loadGamePlayerById(env, player.id as string);
    return gameJson({ message: description, ...buildHoldemState(null, freshPlayer) });
  } catch (e) {
    return gameJson({ error: (e as GameError).message }, (e as GameError).status ?? 500);
  }
}

async function gameAdminAuth(request: Request, env: Env): Promise<Response> {
  await ensureGameAdminTables(env);
  const body = await request.json<{ password?: string }>().catch(() => ({} as { password?: string }));
  if (!body.password || typeof body.password !== 'string') {
    return gameJson({ error: 'password required.' }, 400);
  }
  const hashConfig = inspectPasswordHash(env.AUTH_PASSWORD_HASH);
  if (!hashConfig.isUsable) {
    return gameJson({ error: 'Admin auth not configured.' }, 500);
  }
  const valid = await verifyPassword(body.password, hashConfig.value);
  if (!valid) {
    await sleep(150 + Math.random() * 150);
    await logGameAdminAudit(env, { command: 'unlock', outcome: 'error', details: 'Wrong admin password.' });
    return gameJson({ error: 'Wrong password.' }, 401);
  }

  const token = crypto.randomUUID();
  const expires = new Date(Date.now() + GAME_ADMIN_SESSION_TTL_MS);
  await env.DB.prepare(`INSERT INTO game_admin_sessions (token, expires_at) VALUES (?, ?)`)
    .bind(token, expires.toISOString())
    .run();
  await logGameAdminAudit(env, { command: 'unlock', outcome: 'auth', details: 'Admin console unlocked.' });

  return new Response(JSON.stringify({ authenticated: true, expires_at: expires.toISOString() }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': setGameAdminCookie(token, expires),
      ...cors(),
    },
  });
}

async function gameAdminStatus(request: Request, env: Env): Promise<Response> {
  const session = await getGameAdminSession(request, env);
  return gameJson({
    authenticated: !!session,
    expires_at: session?.expires_at ?? null,
  });
}

async function gameAdminLogout(request: Request, env: Env): Promise<Response> {
  await ensureGameAdminTables(env);
  const token = getGameAdminCookie(request);
  if (token) {
    await env.DB.prepare(`DELETE FROM game_admin_sessions WHERE token = ?`).bind(token).run().catch(() => {});
  }
  await logGameAdminAudit(env, { command: 'logout', outcome: 'logout', details: 'Admin console locked.' });
  return new Response(JSON.stringify({ authenticated: false }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': clearGameAdminCookie(),
      ...cors(),
    },
  });
}

async function gameAdminCommand(request: Request, env: Env): Promise<Response> {
  let player: Row;
  try { player = await requireGamePlayer(request, env); }
  catch (e) { return gameJson({ error: (e as GameError).message }, (e as GameError).status ?? 401); }
  try { await requireGameAdmin(request, env); }
  catch (e) { return gameJson({ error: (e as GameError).message }, (e as GameError).status ?? 403); }

  const body = await request.json<{ command?: string }>().catch(() => ({} as { command?: string }));
  const command = String(body.command ?? '').trim();
  if (!command) return gameJson({ error: 'command required.' }, 400);

  const args = tokenizeCommand(command);
  const cmd = (args[0] ?? '').toLowerCase();
  const pid = player.id as string;
  const ok = async (message: string, extra: Record<string, unknown> = {}) => {
    const fresh = effectivePlayerView(await loadGamePlayerById(env, pid));
    await logGameAdminAudit(env, { player: fresh, command, outcome: 'ok', details: message });
    return gameJson({ ok: true, message, player: fresh, ...extra });
  };
  const err = async (message: string, status = 400) => {
    await logGameAdminAudit(env, { player, command, outcome: 'error', details: message });
    return gameJson({ error: message }, status);
  };

  if (cmd === 'help') {
    const payload = adminHelp();
    await logGameAdminAudit(env, { player, command, outcome: 'ok', details: payload.message });
    return gameJson({ ok: true, ...payload, player: effectivePlayerView(player) });
  }
  if (cmd === 'me') {
    return ok(`Du är ${player.name} på level ${player.level}.`);
  }

  if (cmd === 'cash' || cmd === 'bank' || cmd === 'respect' || cmd === 'xp') {
    const field = cmd as 'cash' | 'bank' | 'respect' | 'xp';
    const current = Number(player[field] ?? 0);
    const next = resolveNumericCommand(current, args[1] ?? '', { min: 0, max: 99_999_999 });
    if (next === null) return err(`Usage: ${field} <n|+n|-n>`);

    if (field === 'xp') {
      const nextLevel = levelFromXp(next);
      await env.DB.prepare(`UPDATE game_players SET xp = ?, level = ?, last_action = datetime('now') WHERE id = ?`)
        .bind(next, nextLevel, pid).run();
      await logAction(env, pid, 'admin', `Admin satte XP till ${next} (${command}).`, 0, 0, next - current, true);
      return ok(`XP uppdaterad till ${next}. Ny level: ${nextLevel}.`);
    }

    await env.DB.prepare(`UPDATE game_players SET ${field} = ?, last_action = datetime('now') WHERE id = ?`)
      .bind(next, pid).run();
    const cashDelta = field === 'cash' ? next - current : 0;
    const respectDelta = field === 'respect' ? next - current : 0;
    await logAction(env, pid, 'admin', `Admin satte ${field} till ${next} (${command}).`, cashDelta, respectDelta, 0, true);
    return ok(`${field.toUpperCase()} satt till ${next}.`);
  }

  if (cmd === 'level') {
    const target = resolveNumericCommand(Number(player.level ?? 1), args[1] ?? '', { min: 1, max: 50 });
    if (target === null) return err('Usage: level <n>');
    const xp = xpFloorForLevel(target);
    await env.DB.prepare(`UPDATE game_players SET level = ?, xp = ?, last_action = datetime('now') WHERE id = ?`)
      .bind(target, xp, pid).run();
    await logAction(env, pid, 'admin', `Admin satte level till ${target}.`, 0, 0, xp - Number(player.xp ?? 0), true);
    return ok(`Level satt till ${target}.`);
  }

  if (cmd === 'hp' || cmd === 'energy') {
    const field = cmd === 'hp' ? 'hp' : 'energy';
    const maxField = cmd === 'hp' ? 'hp_max' : 'energy_max';
    const current = Number(player[field] ?? 0);
    const hardMax = cmd === 'hp' ? effectiveHpMax(player) : Number(player[maxField] ?? 100);
    const next = resolveNumericCommand(current, args[1] ?? '', { min: 0, max: hardMax, allowMaxKeyword: true });
    if (next === null) return err(`Usage: ${field} <n|+n|-n|max>`);

    if (field === 'energy') {
      await env.DB.prepare(`UPDATE game_players SET energy = ?, energy_last_regen = datetime('now'), last_action = datetime('now') WHERE id = ?`)
        .bind(next, pid).run();
    } else {
      await env.DB.prepare(`UPDATE game_players SET hp = ?, last_action = datetime('now') WHERE id = ?`)
        .bind(next, pid).run();
    }
    await logAction(env, pid, 'admin', `Admin satte ${field} till ${next}.`, 0, 0, 0, true);
    return ok(`${field.toUpperCase()} satt till ${next}.`);
  }

  if (cmd === 'stat') {
    const target = (args[1] ?? '').toLowerCase();
    const spec = args[2] ?? '';
    const valid = ['strength', 'intelligence', 'charisma', 'stealth'] as const;
    if (!target || !spec) return err('Usage: stat <strength|intelligence|charisma|stealth|all> <n|+n|-n>');

    const columns = target === 'all' ? [...valid] : valid.filter(v => v === target);
    if (!columns.length) return err('Ogiltig stat.');

    const nextValues = columns.map(column => {
      const current = Number(player[column] ?? 10);
      const next = resolveNumericCommand(current, spec, { min: 1, max: 100 });
      return { column, current, next };
    });
    if (nextValues.some(entry => entry.next === null)) {
      return err('Ogiltigt stat-värde.');
    }

    const setSql = nextValues.map(entry => `${entry.column} = ?`).join(', ');
    const binds = nextValues.map(entry => entry.next as number);
    await env.DB.prepare(`UPDATE game_players SET ${setSql}, last_action = datetime('now') WHERE id = ?`)
      .bind(...binds, pid).run();
    await logAction(env, pid, 'admin', `Admin uppdaterade ${target} via "${command}".`, 0, 0, 0, true);
    return ok(`Stat uppdaterad: ${target}.`);
  }

  if (cmd === 'profession') {
    const profession = normalizeProfessionInput(args[1] ?? '');
    if (!profession) return err('Usage: profession <none|ranare|langare|torped|hallick|bedragare>');
    await env.DB.prepare(`UPDATE game_players SET profession = ?, last_action = datetime('now') WHERE id = ?`)
      .bind(profession, pid).run();
    await logAction(env, pid, 'admin', `Admin satte yrke till ${profession}.`, 0, 0, 0, true);
    return ok(`Yrke satt till ${profession}.`);
  }

  if (cmd === 'side') {
    const side = normalizeSideInput(args[1] ?? '');
    if (!side) return err('Usage: side <east|west>');
    await env.DB.prepare(`UPDATE game_players SET side = ?, last_action = datetime('now') WHERE id = ?`)
      .bind(side, pid).run();
    await logAction(env, pid, 'admin', `Admin bytte sida till ${side}.`, 0, 0, 0, true);
    return ok(`Sida satt till ${side}.`);
  }

  if (cmd === 'prison' || cmd === 'hospital') {
    const target = cmd;
    const arg = (args[1] ?? '').toLowerCase();
    if (!arg) return err(`Usage: ${target} <minutes|off>`);

    if (['off', 'clear', '0'].includes(arg)) {
      const clearSql = target === 'prison'
        ? `UPDATE game_players SET in_prison = 0, prison_until = NULL, last_action = datetime('now') WHERE id = ?`
        : `UPDATE game_players SET in_hospital = 0, hospital_until = NULL, last_action = datetime('now') WHERE id = ?`;
      await env.DB.prepare(clearSql).bind(pid).run();
      await logAction(env, pid, 'admin', `Admin rensade ${target}.`, 0, 0, 0, true);
      return ok(`${target} rensad.`);
    }

    const minutes = parseIntegerSpec(arg);
    if (minutes === null || minutes < 1 || minutes > 1440) {
      return err(`Usage: ${target} <minutes|off>`);
    }
    const until = new Date(Date.now() + minutes * 60 * 1000).toISOString();
    if (target === 'prison') {
      await env.DB.prepare(
        `UPDATE game_players SET in_prison = 1, prison_until = ?, last_action = datetime('now') WHERE id = ?`
      ).bind(until, pid).run();
    } else {
      await env.DB.prepare(
        `UPDATE game_players SET in_hospital = 1, hospital_until = ?, hp = ?, last_action = datetime('now') WHERE id = ?`
      ).bind(until, Math.max(1, Number(player.hp ?? 1)), pid).run();
    }
    await logAction(env, pid, 'admin', `Admin satte ${target} i ${minutes} min.`, 0, 0, 0, true);
    return ok(`${target} satt i ${minutes} minuter.`);
  }

  if (cmd === 'free') {
    const hpMax = effectiveHpMax(player);
    const energyMax = Number(player.energy_max ?? 100);
    await env.DB.prepare(
      `UPDATE game_players
       SET in_prison = 0,
           prison_until = NULL,
           in_hospital = 0,
           hospital_until = NULL,
           is_alive = 1,
           hp = ?,
           energy = ?,
           energy_last_regen = datetime('now'),
           last_action = datetime('now')
       WHERE id = ?`
    ).bind(hpMax, energyMax, pid).run();
    await logAction(env, pid, 'admin', 'Admin körde free och nollställde statusflaggor.', 0, 0, 0, true);
    return ok('Fängelse/sjukhus rensat. HP och energi återställda.');
  }

  if (cmd === 'vehicle') {
    const vehicleId = (args[1] ?? '').trim();
    const cfg = VEHICLE_CONFIGS[vehicleId];
    if (!cfg) return err('Usage: vehicle <volvo240|golf_gti|bmw_m3|skyline_r34|lambo>');

    const existing = await env.DB.prepare(
      `SELECT id FROM game_inventory WHERE player_id = ? AND item_type = 'vehicle' AND item_name = ? LIMIT 1`
    ).bind(pid, vehicleId).first();
    if (existing) return err('Du äger redan det fordonet.');

    await env.DB.prepare(
      `INSERT INTO game_inventory (id, player_id, item_type, item_name, quantity, buy_price)
       VALUES (?, ?, 'vehicle', ?, 1, ?)`
    ).bind(crypto.randomUUID(), pid, vehicleId, cfg.cost).run();
    await logAction(env, pid, 'admin', `Admin gav fordonet ${cfg.name}.`, 0, 0, 0, true);
    return ok(`${cfg.name} tillagd i garaget.`);
  }

  if (cmd === 'property') {
    const type = (args[1] ?? '').trim().toLowerCase();
    const cfg = PROPERTY_CONFIGS[type];
    if (!cfg) return err('Usage: property <stash_house|nightclub|drug_lab|garage|safehouse> [level]');
    const level = Math.max(1, Math.min(5, parseIntegerSpec(args[2] ?? '1') ?? 1));
    const income = propertyIncomeForPlayer(player, type, level, cfg.baseIncome);
    await env.DB.prepare(
      `INSERT INTO game_properties (id, player_id, property_type, property_name, level, income_per_hour, last_collected)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
    ).bind(crypto.randomUUID(), pid, type, cfg.label, level, income).run();
    await logAction(env, pid, 'admin', `Admin gav fastigheten ${cfg.label} Lv${level}.`, 0, 0, 0, true);
    return ok(`${cfg.label} Lv${level} tillagd.`);
  }

  if (cmd === 'clearlog') {
    await env.DB.prepare(`DELETE FROM game_action_log WHERE player_id = ?`).bind(pid).run();
    return ok('Aktivitetsloggen rensad.');
  }

  if (cmd === 'rich') {
    const cashBoost = 1_000_000;
    const bankBoost = 500_000;
    await env.DB.prepare(
      `UPDATE game_players SET cash = cash + ?, bank = bank + ?, last_action = datetime('now') WHERE id = ?`
    ).bind(cashBoost, bankBoost, pid).run();
    await logAction(env, pid, 'admin', 'Pengaregn. Admin tryckte rich.', cashBoost, 0, 0, true);
    return ok(`Rich aktiverad. +${cashBoost} cash och +${bankBoost} bank.`);
  }

  if (cmd === 'maxout') {
    const hpMax = effectiveHpMax(player);
    const energyMax = Number(player.energy_max ?? 100);
    await env.DB.prepare(
      `UPDATE game_players
       SET strength = 100, intelligence = 100, charisma = 100, stealth = 100,
           hp = ?, energy = ?, energy_last_regen = datetime('now'),
           last_action = datetime('now')
       WHERE id = ?`
    ).bind(hpMax, energyMax, pid).run();
    await logAction(env, pid, 'admin', 'Admin maxade alla stats.', 0, 0, 0, true);
    return ok('Alla stats maxade. HP och energi fyllda.');
  }

  if (cmd === 'legend') {
    const targetLevel = 30;
    const xp = xpFloorForLevel(targetLevel);
    const hpMax = effectiveHpMax(player);
    const energyMax = Number(player.energy_max ?? 100);
    await env.DB.prepare(
      `UPDATE game_players
       SET level = ?, xp = ?, cash = 1000000, bank = 500000, respect = 10000,
           strength = 100, intelligence = 100, charisma = 100, stealth = 100,
           hp = ?, energy = ?, energy_last_regen = datetime('now'),
           in_prison = 0, prison_until = NULL, in_hospital = 0, hospital_until = NULL,
           is_alive = 1, last_action = datetime('now')
       WHERE id = ?`
    ).bind(targetLevel, xp, hpMax, energyMax, pid).run();
    await logAction(env, pid, 'admin', 'Legend-läge aktiverat.', 1_000_000 - Number(player.cash ?? 0), 10_000 - Number(player.respect ?? 0), xp - Number(player.xp ?? 0), true);
    return ok('Legend-läge aktiverat. Nu är du ett vandrande patch note.');
  }

  if (cmd === 'chaos') {
    const cashDelta = rand(-50_000, 150_000);
    const respectDelta = rand(-150, 300);
    const hpMax = effectiveHpMax(player);
    const hp = rand(10, hpMax);
    const energy = rand(10, Number(player.energy_max ?? 100));
    await env.DB.prepare(
      `UPDATE game_players
       SET cash = MAX(0, cash + ?),
           respect = MAX(0, respect + ?),
           hp = ?, energy = ?, energy_last_regen = datetime('now'),
           last_action = datetime('now')
       WHERE id = ?`
    ).bind(cashDelta, respectDelta, hp, energy, pid).run();
    const message = `Chaos slog till: ${cashDelta >= 0 ? '+' : ''}${cashDelta} cash, ${respectDelta >= 0 ? '+' : ''}${respectDelta} respect, HP ${hp}, energi ${energy}.`;
    await logAction(env, pid, 'admin', message, cashDelta, respectDelta, 0, true);
    return ok(message);
  }

  return err('Unknown command. Run "help" for available commands.');
}

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

  const stealth   = effectiveStat(player, 'stealth');
  const winChance = Math.min(90, 30 + vehicleBonus * 0.5 + stealth * 0.3 + playerLevel - cfg.difficulty);
  const won       = Math.random() * 100 < winChance;

  const cashDelta  = won ? cfg.prize : -cfg.fee;
  const newCash    = cash + cashDelta;
  const xpGained   = xpWithBonus(player, won ? cfg.xp : Math.floor(cfg.xp * 0.2));
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
  return gameJson({ success: won, message, narrative, cash_delta: cashDelta, xp_gained: xpGained, new_level: newLevel, energy_left: newEnergy });
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
      error: 'inlined DAX_MEASURES is empty. Redeploy a build that includes the inlined data block in functions/api/[[route]].ts.',
    }, 400);
  }

  const requiredSubcategoryIds = [...new Set(
    measures.map(m => m.subcategory_id).filter(Boolean)
  )];

  const placeholders = requiredSubcategoryIds.map(() => '?').join(', ');
  const existing = await env.DB.prepare(`
    SELECT id
    FROM subcategories
    WHERE id IN (${placeholders})
  `).bind(...requiredSubcategoryIds).all<{ id: string }>();

  const existingIds = new Set(existing.results.map(row => row.id));
  const missingSubcategories = requiredSubcategoryIds.filter(id => !existingIds.has(id));

  if (missingSubcategories.length) {
    return json({
      error: 'missing dax subcategories',
      missing_subcategories: missingSubcategories,
      hint: 'Run: npx wrangler d1 execute sp1e-db --remote --file=seed-dax-categories.sql',
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
