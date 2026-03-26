-- sp1e.se D1 schema
-- Apply with: npx wrangler d1 execute sp1e-db --file=schema.sql
-- For local dev: npx wrangler d1 execute sp1e-db --local --file=schema.sql

-- ─── Auth ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires_at);

-- ─── Notes ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notes (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  content    TEXT NOT NULL DEFAULT '',       -- Markdown
  tags       TEXT NOT NULL DEFAULT '[]',     -- JSON array of strings
  category   TEXT,
  is_public  INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_notes_updated  ON notes (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_notes_public   ON notes (is_public);
CREATE INDEX IF NOT EXISTS idx_notes_category ON notes (category);

-- ─── Files ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS files (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,                  -- Display name (defaults to filename)
  r2_key     TEXT NOT NULL UNIQUE,           -- Key in R2 bucket
  filename   TEXT NOT NULL,                  -- Original filename
  mime_type  TEXT NOT NULL DEFAULT 'application/octet-stream',
  size       INTEGER NOT NULL DEFAULT 0,     -- Bytes
  tags       TEXT NOT NULL DEFAULT '[]',     -- JSON array of strings
  is_public  INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_files_created ON files (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_files_public  ON files (is_public);

-- ─── Snippets ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS snippets (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  language    TEXT NOT NULL,                 -- e.g. 'sql', 'python', 'dax'
  code        TEXT NOT NULL DEFAULT '',
  description TEXT,
  tags        TEXT NOT NULL DEFAULT '[]',    -- JSON array of strings
  is_public   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_snippets_language ON snippets (language);
CREATE INDEX IF NOT EXISTS idx_snippets_updated  ON snippets (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_snippets_public   ON snippets (is_public);

-- ─── Bookmarks ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS bookmarks (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  url         TEXT NOT NULL,
  description TEXT,
  favicon_url TEXT,
  tags        TEXT NOT NULL DEFAULT '[]',    -- JSON array of strings
  is_public   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_bookmarks_created ON bookmarks (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bookmarks_public  ON bookmarks (is_public);
