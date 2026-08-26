// WMessage 后端 —— Cloudflare Worker 主入口
// REST API + WebSocket 升级路由，会话实时逻辑转发给 Durable Object
import { hashPassword, randomSalt, verifyPassword, createToken, verifyToken, makeTokenPayload } from './auth.js';
import { ChatRoom } from './chat-room.js';

export { ChatRoom };

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
const NICKNAME_RE = /^.{1,20}$/u;
const PAGE_LIMIT_MAX = 100;
const AVATAR_COLORS = ['#4f7cff', '#8b5cf6', '#34d399', '#f59e0b', '#ef4444', '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16'];
const WELCOME_CHANNEL_ID = 'channel_welcome';
const WELCOME_CHANNEL_NAME = '公共聊天室';

function pickAvatarColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function publicUser(u) {
  return { id: u.id, username: u.username, nickname: u.nickname, avatarColor: u.avatar_color, createdAt: u.created_at };
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}
function ok(data, headers) {
  return json({ ok: true, data }, 200, headers);
}
function fail(status, message, code = 'ERROR', headers) {
  return json({ ok: false, code, message }, status, headers);
}

async function readJson(request) {
  try {
    const text = await request.text();
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

// CORS：未配置 ALLOWED_ORIGINS 时允许所有来源；配置后仅放行列表内的 Origin
function corsFor(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (allowed.length === 0) return { 'Access-Control-Allow-Origin': '*' };
  if (origin && allowed.includes(origin)) return { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' };
  return null;
}

async function requireUser(request, env) {
  const header = request.headers.get('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const payload = await verifyToken(token, env.AUTH_SECRET);
  if (!payload) return null;
  return env.DB.prepare('SELECT id, username, nickname, avatar_color, created_at FROM users WHERE id = ?')
    .bind(payload.uid)
    .first();
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    const cv = corsFor(request, env);
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          ...(cv || { 'Access-Control-Allow-Origin': '*' }),
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Max-Age': '86400',
        },
      });
    }
    if (cv === null) return fail(403, '请求来源不被允许', 'CORS', { 'Access-Control-Allow-Origin': '' });
    const H = cv;

    try {
      // ---------- WebSocket：转发给该会话的 Durable Object ----------
      if (path === '/ws' && request.method === 'GET') {
        const roomId = url.searchParams.get('room');
        if (!roomId || roomId.length > 128) return fail(400, '缺少会话参数');
        const stub = env.CHAT_ROOM.get(env.CHAT_ROOM.idFromName(roomId));
        return stub.fetch(request);
      }

      // ---------- 健康检查 ----------
      if (path === '/api/health' && request.method === 'GET') {
        return ok({ name: 'wmessage', time: Date.now(), upload: !!env.R2 }, H);
      }

      // ---------- 注册 ----------
      if (path === '/api/auth/register' && request.method === 'POST') {
        if (!env.AUTH_SECRET) return fail(500, '服务器未配置 AUTH_SECRET', 'NO_SECRET', H);
        const body = await readJson(request);
        const username = String(body.username || '').trim();
        const password = String(body.password || '');
        const nickname = String(body.nickname || '').trim() || username;
        if (!USERNAME_RE.test(username)) return fail(400, '用户名需为 3-20 位字母、数字或下划线');
        if (password.length < 6 || password.length > 128) return fail(400, '密码长度需为 6-128 位');
        if (!NICKNAME_RE.test(nickname)) return fail(400, '昵称不能超过 20 个字符');
        const exists = await env.DB.prepare('SELECT 1 AS x FROM users WHERE username = ?').bind(username).first();
        if (exists) return fail(409, '该用户名已被注册', 'USERNAME_TAKEN', H);

        const salt = randomSalt();
        const hash = await hashPassword(password, salt);
        const user = { id: crypto.randomUUID(), username, nickname, avatar_color: pickAvatarColor(nickname), created_at: Date.now() };
        await env.DB.prepare(
          'INSERT INTO users (id, username, nickname, password_hash, salt, avatar_color, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).bind(user.id, user.username, user.nickname, hash, salt, user.avatar_color, user.created_at).run();
        await ensureWelcomeChannel(env, user.id);

        const token = await createToken(makeTokenPayload(user.id), env.AUTH_SECRET);
        return ok({ token, user: publicUser(user) }, H);
      }

      // ---------- 登录 ----------
      if (path === '/api/auth/login' && request.method === 'POST') {
        if (!env.AUTH_SECRET) return fail(500, '服务器未配置 AUTH_SECRET', 'NO_SECRET', H);
        const body = await readJson(request);
        const username = String(body.username || '').trim();
        const password = String(body.password || '');
        const user = await env.DB.prepare('SELECT * FROM users WHERE username = ?').bind(username).first();
        if (!user || !(await verifyPassword(password, user.salt, user.password_hash))) {
          return fail(401, '用户名或密码错误', 'BAD_CREDENTIALS', H);
        }
        const token = await createToken(makeTokenPayload(user.id), env.AUTH_SECRET);
        return ok({ token, user: publicUser(user) }, H);
      }

      // ---------- 当前用户 ----------
      if (path === '/api/me' && request.method === 'GET') {
        const user = await requireUser(request, env);
        if (!user) return fail(401, '登录已失效', 'UNAUTHORIZED', H);
        return ok({ user: publicUser(user) }, H);
      }

      // ---------- 我的会话列表 ----------
      if (path === '/api/rooms' && request.method === 'GET') {
        const user = await requireUser(request, env);
        if (!user) return fail(401, '登录已失效', 'UNAUTHORIZED', H);
        const res = await env.DB.prepare(
          `SELECT r.id, r.type, r.name, r.description,
             (SELECT m.content FROM messages m WHERE m.room_id = r.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS lastMessage,
             (SELECT m.type FROM messages m WHERE m.room_id = r.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS lastMessageType,
             (SELECT u.nickname FROM messages m JOIN users u ON u.id = m.user_id WHERE m.room_id = r.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS lastSender,
             (SELECT m.created_at FROM messages m WHERE m.room_id = r.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS lastMessageAt,
             (SELECT mem.joined_at FROM members mem WHERE mem.room_id = r.id AND mem.user_id = ?) AS joinedAt
           FROM rooms r JOIN members my ON my.room_id = r.id
           WHERE my.user_id = ?`
        ).bind(user.id, user.id).all();
        const rooms = res.results;
        for (const r of rooms) {
          if (r.type === 'dm') {
            const partner = await env.DB.prepare(
              `SELECT u.id, u.username, u.nickname, u.avatar_color AS avatarColor
               FROM members m JOIN users u ON u.id = m.user_id
               WHERE m.room_id = ? AND m.user_id != ? LIMIT 1`
            ).bind(r.id, user.id).first();
            r.partner = partner || null;
          }
        }
        return ok({ rooms }, H);
      }

      // ---------- 频道发现 ----------
      if (path === '/api/channels' && request.method === 'GET') {
        const user = await requireUser(request, env);
        if (!user) return fail(401, '登录已失效', 'UNAUTHORIZED', H);
        const res = await env.DB.prepare(
          `SELECT r.id, r.name, r.description, r.created_at AS createdAt,
             (SELECT COUNT(*) FROM members m WHERE m.room_id = r.id) AS memberCount,
             EXISTS(SELECT 1 FROM members m2 WHERE m2.room_id = r.id AND m2.user_id = ?) AS joined
           FROM rooms r WHERE r.type = 'channel' ORDER BY memberCount DESC LIMIT 100`
        ).bind(user.id).all();
        return ok({ channels: res.results }, H);
      }

      // ---------- 创建频道 ----------
      if (path === '/api/rooms' && request.method === 'POST') {
        const user = await requireUser(request, env);
        if (!user) return fail(401, '登录已失效', 'UNAUTHORIZED', H);
        const body = await readJson(request);
        const name = String(body.name || '').trim().slice(0, 30);
        const description = String(body.description || '').trim().slice(0, 120);
        if (!name) return fail(400, '频道名称不能为空');
        const room = { id: crypto.randomUUID(), type: 'channel', name, description, created_by: user.id, created_at: Date.now() };
        await env.DB.batch([
          env.DB.prepare('INSERT INTO rooms (id, type, name, description, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(
            room.id, room.type, room.name, room.description, room.created_by, room.created_at
          ),
          env.DB.prepare('INSERT OR IGNORE INTO members (room_id, user_id, joined_at) VALUES (?, ?, ?)').bind(
            room.id, user.id, room.created_at
          ),
        ]);
        return ok({ room }, H);
      }

      // ---------- 房间子路由：join / leave / messages / 详情 ----------
      const roomMatch = path.match(/^\/api\/rooms\/([^/]+)(?:\/(join|leave|messages))?$/);
      if (roomMatch) {
        const roomId = decodeURIComponent(roomMatch[1]);
        const action = roomMatch[2];
        const user = await requireUser(request, env);
        if (!user) return fail(401, '登录已失效', 'UNAUTHORIZED', H);
        const room = await env.DB.prepare('SELECT * FROM rooms WHERE id = ?').bind(roomId).first();
        if (!room) return fail(404, '会话不存在', 'NOT_FOUND', H);

        if (action === 'join' && request.method === 'POST') {
          if (room.type !== 'channel') return fail(400, '仅频道支持加入');
          await env.DB.prepare('INSERT OR IGNORE INTO members (room_id, user_id, joined_at) VALUES (?, ?, ?)').bind(room.id, user.id, Date.now()).run();
          return ok({ room }, H);
        }
        if (action === 'leave' && request.method === 'POST') {
          if (room.type !== 'channel') return fail(400, '私聊不支持退出');
          await env.DB.prepare('DELETE FROM members WHERE room_id = ? AND user_id = ?').bind(room.id, user.id).run();
          return ok({}, H);
        }
        if (action === 'messages' && request.method === 'GET') {
          if (room.type === 'dm') {
            const mem = await env.DB.prepare('SELECT 1 AS x FROM members WHERE room_id = ? AND user_id = ?').bind(room.id, user.id).first();
            if (!mem) return fail(403, '无权访问该会话', 'FORBIDDEN', H);
          }
          const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 1), PAGE_LIMIT_MAX);
          const beforeTs = parseInt(url.searchParams.get('beforeTs') || '', 10);
          const beforeId = String(url.searchParams.get('beforeId') || '');
          let where = 'WHERE m.room_id = ?';
          const binds = [room.id];
          if (beforeTs > 0 && beforeId) {
            where += ' AND (m.created_at < ? OR (m.created_at = ? AND m.id < ?))';
            binds.push(beforeTs, beforeTs, beforeId);
          }
          binds.push(limit);
          const res = await env.DB.prepare(
            `SELECT m.id, m.room_id AS roomId, m.user_id AS userId, m.type, m.content, m.created_at AS createdAt,
                    u.username, u.nickname, u.avatar_color AS avatarColor
             FROM messages m JOIN users u ON u.id = m.user_id ${where}
             ORDER BY m.created_at DESC, m.id DESC LIMIT ?`
          ).bind(...binds).all();
          return ok({ messages: res.results.reverse() }, H);
        }
        if (!action && request.method === 'GET') {
          if (room.type === 'dm') {
            const mem = await env.DB.prepare('SELECT 1 AS x FROM members WHERE room_id = ? AND user_id = ?').bind(room.id, user.id).first();
            if (!mem) return fail(403, '无权访问该会话', 'FORBIDDEN', H);
          }
          const members = await env.DB.prepare(
            `SELECT u.id, u.username, u.nickname, u.avatar_color AS avatarColor
             FROM members m JOIN users u ON u.id = m.user_id WHERE m.room_id = ? ORDER BY m.joined_at ASC LIMIT 300`
          ).bind(room.id).all();
          return ok({ room: { id: room.id, name: room.name, type: room.type, description: room.description }, members: members.results }, H);
        }
      }

      // ---------- 用户搜索 ----------
      if (path === '/api/users' && request.method === 'GET') {
        const user = await requireUser(request, env);
        if (!user) return fail(401, '登录已失效', 'UNAUTHORIZED', H);
        const q = (url.searchParams.get('q') || '').trim().slice(0, 40);
        if (!q) return ok({ users: [] }, H);
        const res = await env.DB.prepare(
          'SELECT id, username, nickname, avatar_color AS avatarColor FROM users WHERE id != ? AND (username LIKE ? OR nickname LIKE ?) ORDER BY username LIMIT 20'
        ).bind(user.id, `%${q}%`, `%${q}%`).all();
        return ok({ users: res.results }, H);
      }

      // ---------- 发起私聊（两人会话，确定性 ID）----------
      const dmMatch = path.match(/^\/api\/users\/([^/]+)\/dm$/);
      if (dmMatch && request.method === 'POST') {
        const user = await requireUser(request, env);
        if (!user) return fail(401, '登录已失效', 'UNAUTHORIZED', H);
        const targetId = decodeURIComponent(dmMatch[1]);
        if (targetId === user.id) return fail(400, '不能和自己私聊');
        const target = await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(targetId).first();
        if (!target) return fail(404, '用户不存在', 'NOT_FOUND', H);
        const roomId = 'dm_' + [user.id, targetId].sort().join('_');
        let room = await env.DB.prepare('SELECT id, type FROM rooms WHERE id = ?').bind(roomId).first();
        if (!room) {
          await env.DB.prepare('INSERT INTO rooms (id, type, name, description, created_at) VALUES (?, ?, ?, ?, ?)')
            .bind(roomId, 'dm', '', '', Date.now()).run();
        }
        await env.DB.batch([
          env.DB.prepare('INSERT OR IGNORE INTO members (room_id, user_id, joined_at) VALUES (?, ?, ?)').bind(roomId, user.id, Date.now()),
          env.DB.prepare('INSERT OR IGNORE INTO members (room_id, user_id, joined_at) VALUES (?, ?, ?)').bind(roomId, targetId, Date.now()),
        ]);
        return ok({ room: { id: roomId, type: 'dm' } }, H);
      }

      // ---------- 图片上传（可选 R2）----------
      if (path === '/api/upload' && request.method === 'POST') {
        const user = await requireUser(request, env);
        if (!user) return fail(401, '登录已失效', 'UNAUTHORIZED', H);
        if (!env.R2) return fail(501, '服务器未启用图片上传（未配置 R2）', 'NO_R2', H);
        const form = await request.formData().catch(() => null);
        const file = form && form.get('file');
        if (!file || typeof file.size !== 'number') return fail(400, '缺少图片文件');
        if (!(file.type || '').startsWith('image/')) return fail(400, '仅支持图片文件');
        if (file.size > 8 * 1024 * 1024) return fail(413, '图片不能超过 8MB', 'TOO_LARGE', H);
        const key = `img_${user.id}_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
        await env.R2.put(key, file.stream(), { httpMetadata: { contentType: file.type } });
        return ok({ url: `/api/image/${key}` }, H);
      }

      // ---------- 读取图片 ----------
      if (path.startsWith('/api/image/') && request.method === 'GET') {
        if (!env.R2) return fail(404, '资源不存在', 'NOT_FOUND', H);
        const key = path.slice('/api/image/'.length);
        if (!key || key.includes('..') || key.includes('/')) return fail(400, '非法路径');
        const obj = await env.R2.get(key);
        if (!obj) return fail(404, '资源不存在', 'NOT_FOUND', H);
        return new Response(obj.body, {
          headers: {
            'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream',
            'Cache-Control': 'public, max-age=31536000, immutable',
            ...H,
          },
        });
      }
    } catch (err) {
      console.error('unhandled error', err);
      return fail(500, '服务器内部错误', 'INTERNAL', H);
    }
    return fail(404, '接口不存在', 'NOT_FOUND', H);
  },
};

// 首次注册时确保存在「公共聊天室」并自动加入
async function ensureWelcomeChannel(env, userId) {
  const exists = await env.DB.prepare('SELECT 1 AS x FROM rooms WHERE id = ?').bind(WELCOME_CHANNEL_ID).first();
  if (!exists) {
    await env.DB.prepare('INSERT INTO rooms (id, type, name, description, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(WELCOME_CHANNEL_ID, 'channel', WELCOME_CHANNEL_NAME, '欢迎来到 WMessage，在这里发出你的第一条消息吧！', Date.now()).run();
  }
  await env.DB.prepare('INSERT OR IGNORE INTO members (room_id, user_id, joined_at) VALUES (?, ?, ?)')
    .bind(WELCOME_CHANNEL_ID, userId, Date.now()).run();
}
