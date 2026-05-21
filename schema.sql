-- Run with: wrangler d1 execute brandme-db --file=schema.sql
-- Migration v1

CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  niche       TEXT,
  photo_key   TEXT,
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  title       TEXT,
  topic       TEXT,
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL REFERENCES sessions(id),
  role        TEXT NOT NULL CHECK(role IN ('user','assistant')),
  content     TEXT NOT NULL,
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS scenes (
  id           TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL REFERENCES sessions(id),
  position     INTEGER NOT NULL,
  title        TEXT,
  narration    TEXT,
  image_prompt TEXT,
  duration     INTEGER DEFAULT 10,
  mood         TEXT,
  image_key    TEXT,
  created_at   TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS assets (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  session_id  TEXT REFERENCES sessions(id),
  type        TEXT NOT NULL CHECK(type IN ('photo','scene_image','video')),
  r2_key      TEXT NOT NULL UNIQUE,
  size        INTEGER,
  created_at  TEXT DEFAULT (datetime('now'))
);
