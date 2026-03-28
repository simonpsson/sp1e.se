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
  ('bokmarken',   'Bokmärken',  '🔗',  7);

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
  ('bokmarken-ovrigt',      'bokmarken',  'Övrigt',        4);
