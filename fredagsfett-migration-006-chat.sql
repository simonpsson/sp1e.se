-- Fredagsfett v6: group chat (lightweight message board for the group).
-- Run after fredagsfett-migration-005-event-extras.sql.
--
-- Remote:
--   npx wrangler d1 execute sp1e-db --remote --file=fredagsfett-migration-006-chat.sql
-- Local:
--   npx wrangler d1 execute sp1e-db --local --file=fredagsfett-migration-006-chat.sql

CREATE TABLE IF NOT EXISTS ff_chat_messages (
  id         TEXT PRIMARY KEY,
  group_id   TEXT NOT NULL REFERENCES ff_groups(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES ff_users(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_ff_chat_messages_group_created ON ff_chat_messages (group_id, created_at DESC);
