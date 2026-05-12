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
  start_time TEXT,
  end_time   TEXT,
  time_note  TEXT,
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
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at   TEXT
);

CREATE INDEX IF NOT EXISTS idx_ff_expenses_group_date ON ff_expenses (group_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_ff_expenses_paid_by ON ff_expenses (paid_by_id);

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
