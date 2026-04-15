CREATE TABLE IF NOT EXISTS game_talents (
  id TEXT PRIMARY KEY,
  tree TEXT NOT NULL,
  tier INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  talent_type TEXT NOT NULL,
  effects TEXT NOT NULL,
  prerequisites TEXT,
  max_rank INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS game_player_talents (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  talent_id TEXT NOT NULL,
  current_rank INTEGER DEFAULT 1,
  unlocked_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (player_id) REFERENCES game_players(id),
  FOREIGN KEY (talent_id) REFERENCES game_talents(id),
  UNIQUE(player_id, talent_id)
);
