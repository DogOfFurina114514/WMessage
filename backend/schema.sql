-- WMessage D1 数据库初始化脚本
-- 执行：wrangler d1 execute wmessage-db --remote --file=schema.sql

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,          -- PBKDF2-SHA256(150000)
  salt          TEXT NOT NULL,          -- base64url 随机盐
  nickname      TEXT NOT NULL,
  avatar_color  TEXT NOT NULL,
  created_at    INTEGER NOT NULL        -- 毫秒时间戳
);

-- 会话：channel = 公开频道, dm = 两人私聊
CREATE TABLE IF NOT EXISTS rooms (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL DEFAULT 'channel',
  name        TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  created_by  TEXT,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS members (
  room_id   TEXT NOT NULL,
  user_id   TEXT NOT NULL,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (room_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id         TEXT PRIMARY KEY,
  room_id    TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  type       TEXT NOT NULL DEFAULT 'text',   -- text | image
  content    TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_room ON messages (room_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_members_user ON members (user_id);
