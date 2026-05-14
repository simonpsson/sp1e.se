-- sp1e.se — D1 schema
-- Run once:  npx wrangler d1 execute sp1e-db --remote --file=schema.sql
-- Local dev: npx wrangler d1 execute sp1e-db --local  --file=schema.sql

-- ─── Sessions (auth) ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires_at);

-- ─── Categories ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS categories (
  id         TEXT    PRIMARY KEY,
  name       TEXT    NOT NULL,
  icon       TEXT    NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- ─── Subcategories ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS subcategories (
  id          TEXT    PRIMARY KEY,
  category_id TEXT    NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  name        TEXT    NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_subcategories_category ON subcategories (category_id);

-- ─── Notes ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notes (
  id             TEXT    PRIMARY KEY,
  title          TEXT    NOT NULL,
  content        TEXT    NOT NULL DEFAULT '',   -- Markdown
  subcategory_id TEXT    REFERENCES subcategories(id) ON DELETE SET NULL,
  tags           TEXT    NOT NULL DEFAULT '[]', -- JSON array
  is_public      INTEGER NOT NULL DEFAULT 0,
  is_pinned      INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_notes_subcategory ON notes (subcategory_id);
CREATE INDEX IF NOT EXISTS idx_notes_updated     ON notes (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_notes_pinned      ON notes (is_pinned);

-- ─── Files ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS files (
  id             TEXT    PRIMARY KEY,
  filename       TEXT    NOT NULL,
  r2_key         TEXT    NOT NULL UNIQUE,
  size           INTEGER NOT NULL DEFAULT 0,
  mime_type      TEXT    NOT NULL DEFAULT 'application/octet-stream',
  subcategory_id TEXT    REFERENCES subcategories(id) ON DELETE SET NULL,
  tags           TEXT    NOT NULL DEFAULT '[]', -- JSON array
  is_public      INTEGER NOT NULL DEFAULT 0,
  data           TEXT,                          -- base64 fallback when R2 unavailable (files ≤1 MB)
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);
-- Migration for existing deployments:
-- ALTER TABLE files ADD COLUMN data TEXT;

CREATE INDEX IF NOT EXISTS idx_files_subcategory ON files (subcategory_id);
CREATE INDEX IF NOT EXISTS idx_files_created     ON files (created_at DESC);

-- ─── Snippets ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS snippets (
  id             TEXT PRIMARY KEY,
  title          TEXT NOT NULL,
  language       TEXT NOT NULL,
  code           TEXT NOT NULL DEFAULT '',
  description    TEXT,
  subcategory_id TEXT REFERENCES subcategories(id) ON DELETE SET NULL,
  tags           TEXT NOT NULL DEFAULT '[]',    -- JSON array
  is_public      INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_snippets_subcategory ON snippets (subcategory_id);
CREATE INDEX IF NOT EXISTS idx_snippets_language    ON snippets (language);
CREATE INDEX IF NOT EXISTS idx_snippets_updated     ON snippets (updated_at DESC);

-- ─── Bookmarks ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS bookmarks (
  id             TEXT PRIMARY KEY,
  title          TEXT NOT NULL,
  url            TEXT NOT NULL,
  description    TEXT,
  subcategory_id TEXT REFERENCES subcategories(id) ON DELETE SET NULL,
  tags           TEXT NOT NULL DEFAULT '[]',    -- JSON array
  favicon_url    TEXT,
  is_public      INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_bookmarks_subcategory ON bookmarks (subcategory_id);
CREATE INDEX IF NOT EXISTS idx_bookmarks_created     ON bookmarks (created_at DESC);

-- ─── Seed: categories ────────────────────────────────────────────────────────

INSERT OR IGNORE INTO categories (id, name, icon, sort_order) VALUES
  ('power-bi',    'Power BI',   '⚡',  1),
  ('sql',         'SQL',        '🗄️',  2),
  ('python',      'Python',     '🐍',  3),
  ('databricks',  'Databricks', '🧱',  4),
  ('dokument',    'Dokument',   '📄',  5),
  ('bilder',      'Bilder',     '🖼️',  6),
  ('bokmarken',   'Bokmärken',  '🔗',  7),
  ('konst',       'Konst',      '🎨',  8);

-- ─── Seed: subcategories ─────────────────────────────────────────────────────

INSERT OR IGNORE INTO subcategories (id, category_id, name, sort_order) VALUES
  -- Power BI
  ('power-bi-dax',          'power-bi',   'DAX',           1),
  ('power-bi-power-query',  'power-bi',   'Power Query',   2),
  ('power-bi-filer',        'power-bi',   'Filer',         3),
  ('power-bi-ovrigt',       'power-bi',   'Övrigt',        4),
  -- SQL
  ('sql-queries',           'sql',        'Queries',       1),
  ('sql-snippets',          'sql',        'Snippets',      2),
  ('sql-ovrigt',            'sql',        'Övrigt',        3),
  -- Python
  ('python-scripts',        'python',     'Scripts',       1),
  ('python-notebooks',      'python',     'Notebooks',     2),
  ('python-pyspark',        'python',     'PySpark',       3),
  ('python-ovrigt',         'python',     'Övrigt',        4),
  -- Databricks
  ('databricks-notebooks',  'databricks', 'Notebooks',     1),
  ('databricks-config',     'databricks', 'Konfiguration', 2),
  ('databricks-ovrigt',     'databricks', 'Övrigt',        3),
  -- Dokument
  ('dokument-rapporter',    'dokument',   'Rapporter',     1),
  ('dokument-anteckningar', 'dokument',   'Anteckningar',  2),
  ('dokument-mallar',       'dokument',   'Mallar',        3),
  ('dokument-ovrigt',       'dokument',   'Övrigt',        4),
  -- Bilder
  ('bilder-screenshots',    'bilder',     'Screenshots',   1),
  ('bilder-diagram',        'bilder',     'Diagram',       2),
  ('bilder-ovrigt',         'bilder',     'Övrigt',        3),
  -- Bokmärken
  ('bokmarken-verktyg',     'bokmarken',  'Verktyg',       1),
  ('bokmarken-artiklar',    'bokmarken',  'Artiklar',      2),
  ('bokmarken-referens',    'bokmarken',  'Referens',      3),
  ('bokmarken-ovrigt',      'bokmarken',  'Övrigt',        4),
  -- Konst
  ('konst-galleri',         'konst',      'Galleri',       1),
  ('konst-favoriter',       'konst',      'Favoriter',     2),
  ('konst-artister',        'konst',      'Konstnärer',    3);

-- ─── Artworks ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS artworks (
  id            TEXT    PRIMARY KEY,
  title         TEXT    NOT NULL,
  artist        TEXT    NOT NULL,
  date_display  TEXT,
  medium        TEXT,
  dimensions    TEXT,
  school        TEXT,
  image_url     TEXT,
  thumbnail_url TEXT,
  source_museum TEXT,
  source_id     TEXT,
  source_url    TEXT,
  description   TEXT,
  is_public     INTEGER NOT NULL DEFAULT 0,
  is_favorite   INTEGER NOT NULL DEFAULT 0,
  tags          TEXT,
  added_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_artworks_artist   ON artworks (artist);
CREATE INDEX IF NOT EXISTS idx_artworks_school   ON artworks (school);
CREATE INDEX IF NOT EXISTS idx_artworks_favorite ON artworks (is_favorite);
CREATE INDEX IF NOT EXISTS idx_artworks_added    ON artworks (added_at DESC);

-- ─── Spotify tokens ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS spotify_tokens (
  id            TEXT    PRIMARY KEY DEFAULT 'main',
  access_token  TEXT,
  refresh_token TEXT,
  expires_at    INTEGER,
  updated_at    TEXT    DEFAULT (datetime('now'))
);

-- Fredagsfett v1 schema: auth, devices, calendar and SP1Wise foundations.

CREATE TABLE IF NOT EXISTS ff_users (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  is_admin   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_ff_users_deleted ON ff_users (deleted_at);
CREATE INDEX IF NOT EXISTS idx_ff_users_admin ON ff_users (is_admin);

CREATE TABLE IF NOT EXISTS ff_devices (
  id              TEXT PRIMARY KEY,
  user_id         TEXT REFERENCES ff_users(id) ON DELETE SET NULL,
  ip_hash         TEXT NOT NULL,
  user_agent_hash TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at    TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at      TEXT,
  UNIQUE(ip_hash, user_agent_hash)
);

CREATE INDEX IF NOT EXISTS idx_ff_devices_user ON ff_devices (user_id);
CREATE INDEX IF NOT EXISTS idx_ff_devices_fingerprint ON ff_devices (ip_hash, user_agent_hash);
CREATE INDEX IF NOT EXISTS idx_ff_devices_revoked ON ff_devices (revoked_at);

CREATE TABLE IF NOT EXISTS ff_auth_attempts (
  ip_hash         TEXT NOT NULL,
  window_start    TEXT NOT NULL,
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (ip_hash, window_start)
);

CREATE TABLE IF NOT EXISTS ff_groups (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ff_group_members (
  group_id   TEXT NOT NULL REFERENCES ff_groups(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES ff_users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'member',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (group_id, user_id)
);

INSERT OR IGNORE INTO ff_groups (id, name) VALUES ('fredagsfett', 'Fredagsfett');

CREATE TABLE IF NOT EXISTS ff_availability (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES ff_users(id) ON DELETE CASCADE,
  date       TEXT NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('AVAILABLE', 'MAYBE', 'UNAVAILABLE')),
  note       TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_ff_availability_date ON ff_availability (date);
CREATE INDEX IF NOT EXISTS idx_ff_availability_user ON ff_availability (user_id);

CREATE TABLE IF NOT EXISTS ff_expenses (
  id           TEXT PRIMARY KEY,
  group_id     TEXT NOT NULL REFERENCES ff_groups(id) ON DELETE CASCADE,
  paid_by_id   TEXT NOT NULL REFERENCES ff_users(id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency     TEXT NOT NULL DEFAULT 'SEK',
  description  TEXT NOT NULL,
  date         TEXT NOT NULL,
  split_method TEXT NOT NULL CHECK (split_method IN ('EQUAL', 'AMOUNTS', 'PERCENT', 'SHARES')),
  event_id     TEXT REFERENCES ff_events(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at   TEXT
);

CREATE INDEX IF NOT EXISTS idx_ff_expenses_group_date ON ff_expenses (group_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_ff_expenses_paid_by ON ff_expenses (paid_by_id);
CREATE INDEX IF NOT EXISTS idx_ff_expenses_event ON ff_expenses (event_id);

CREATE TABLE IF NOT EXISTS ff_expense_shares (
  id           TEXT PRIMARY KEY,
  expense_id   TEXT NOT NULL REFERENCES ff_expenses(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES ff_users(id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  UNIQUE(expense_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_ff_expense_shares_user ON ff_expense_shares (user_id);

CREATE TABLE IF NOT EXISTS ff_settlements (
  id            TEXT PRIMARY KEY,
  group_id      TEXT NOT NULL REFERENCES ff_groups(id) ON DELETE CASCADE,
  from_user_id  TEXT NOT NULL REFERENCES ff_users(id) ON DELETE CASCADE,
  to_user_id    TEXT NOT NULL REFERENCES ff_users(id) ON DELETE CASCADE,
  amount_cents  INTEGER NOT NULL CHECK (amount_cents > 0),
  currency      TEXT NOT NULL DEFAULT 'SEK',
  date          TEXT NOT NULL,
  note          TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ff_settlements_group_date ON ff_settlements (group_id, date DESC);

CREATE TABLE IF NOT EXISTS ff_comments (
  id         TEXT PRIMARY KEY,
  expense_id TEXT NOT NULL REFERENCES ff_expenses(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES ff_users(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_ff_comments_expense ON ff_comments (expense_id, created_at);

CREATE TABLE IF NOT EXISTS ff_activity_log (
  id          TEXT PRIMARY KEY,
  group_id    TEXT REFERENCES ff_groups(id) ON DELETE SET NULL,
  user_id     TEXT REFERENCES ff_users(id) ON DELETE SET NULL,
  type        TEXT NOT NULL,
  entity_type TEXT,
  entity_id   TEXT,
  body        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ff_activity_group_created ON ff_activity_log (group_id, created_at DESC);

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
  spotify_url         TEXT,
  UNIQUE(group_id, date)
);

CREATE INDEX IF NOT EXISTS idx_ff_events_group_date ON ff_events (group_id, date);
CREATE INDEX IF NOT EXISTS idx_ff_events_status ON ff_events (status);

CREATE TABLE IF NOT EXISTS ff_event_comments (
  id          TEXT PRIMARY KEY,
  event_id    TEXT NOT NULL REFERENCES ff_events(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES ff_users(id) ON DELETE CASCADE,
  body        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_ff_event_comments_event ON ff_event_comments (event_id, created_at);

CREATE TABLE IF NOT EXISTS ff_event_items (
  id          TEXT PRIMARY KEY,
  event_id    TEXT NOT NULL REFERENCES ff_events(id) ON DELETE CASCADE,
  label       TEXT NOT NULL,
  claimed_by  TEXT REFERENCES ff_users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ff_event_items_event ON ff_event_items (event_id);

CREATE TABLE IF NOT EXISTS ff_event_photos (
  id            TEXT PRIMARY KEY,
  event_id      TEXT NOT NULL REFERENCES ff_events(id) ON DELETE CASCADE,
  uploader_id   TEXT REFERENCES ff_users(id) ON DELETE SET NULL,
  r2_key        TEXT,
  data          TEXT,
  content_type  TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ff_event_photos_event ON ff_event_photos (event_id, created_at);

CREATE TABLE IF NOT EXISTS ff_chat_messages (
  id         TEXT PRIMARY KEY,
  group_id   TEXT NOT NULL REFERENCES ff_groups(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES ff_users(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_ff_chat_messages_group_created ON ff_chat_messages (group_id, created_at DESC);
