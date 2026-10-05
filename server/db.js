const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name  TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  avatar        TEXT NOT NULL DEFAULT '🐻',
  lang          TEXT NOT NULL DEFAULT 'tr',
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS journals (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  emoji       TEXT NOT NULL DEFAULT '📔',
  color       TEXT NOT NULL DEFAULT 'peach',
  kind        TEXT NOT NULL CHECK (kind IN ('personal', 'shared')),
  owner_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invite_code TEXT UNIQUE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Exactly one personal journal per person.
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_personal ON journals(owner_id) WHERE kind = 'personal';

CREATE TABLE IF NOT EXISTS journal_members (
  journal_id INTEGER NOT NULL REFERENCES journals(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (journal_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_members_user ON journal_members(user_id);

CREATE TABLE IF NOT EXISTS entries (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  journal_id INTEGER NOT NULL REFERENCES journals(id) ON DELETE CASCADE,
  date       TEXT NOT NULL,              -- YYYY-MM-DD, any year 0001-9999
  time       TEXT,                       -- HH:MM, optional
  title      TEXT NOT NULL DEFAULT '',
  body       TEXT NOT NULL DEFAULT '',
  mood       TEXT NOT NULL DEFAULT '',
  place      TEXT NOT NULL DEFAULT '',
  author_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_entries_journal_date ON entries(journal_id, date);
`;

function openDb(file) {
  if (!file) {
    const dir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
    fs.mkdirSync(dir, { recursive: true });
    file = path.join(dir, 'gunce.db');
  }
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.exec(SCHEMA);
  return db;
}

module.exports = { openDb };
