// 会话 Durable Object：每个聊天会话一个实例（idFromName(roomId)）
// 负责：WebSocket 连接管理、实时广播、在线状态、消息持久化（写入 D1）
import { verifyToken } from './auth.js';

const TEXT_MAX = 4000;
const MIN_SEND_INTERVAL = 280; // ms，简单限流

export class ChatRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    // ws.id -> { userId, roomId, nickname, username, avatarColor, lastSentAt }
    this.sessions = new Map();
  }

  // 收到 WebSocket 升级请求：接受连接（真正的鉴权在第一条 auth 消息里完成）
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname !== '/ws') return new Response('Not found', { status: 404 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.state.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const meta = this.sessions.get(ws.id);
    if (!meta) {
      // 第一条消息必须是 auth
      if (msg.type === 'auth') {
        await this.handleAuth(ws, msg);
      } else {
        this.send(ws, { type: 'error', code: 'AUTH_REQUIRED', message: '请先完成登录' });
        ws.close(4001, 'unauthorized');
      }
      return;
    }
    if (msg.type === 'send') {
      await this.handleSend(ws, meta, msg);
    } else if (msg.type === 'typing') {
      this.broadcast({ type: 'typing', userId: meta.userId, nickname: meta.nickname, isTyping: !!msg.isTyping }, ws.id);
    } else if (msg.type === 'ping') {
      this.send(ws, { type: 'pong', t: Date.now() });
    }
  }

  async handleAuth(ws, msg) {
    const payload = await verifyToken(msg.token, this.env.AUTH_SECRET);
    if (!payload) {
      this.send(ws, { type: 'error', code: 'BAD_TOKEN', message: '登录已失效，请重新登录' });
      ws.close(4001, 'unauthorized');
      return;
    }
    const roomId = String(msg.roomId || '');
    const room = await this.env.DB.prepare('SELECT id, name, type, description FROM rooms WHERE id = ?').bind(roomId).first();
    if (!room) {
      this.send(ws, { type: 'error', code: 'ROOM_NOT_FOUND', message: '会话不存在' });
      ws.close(4004, 'room not found');
      return;
    }
    if (room.type === 'dm') {
      const mem = await this.env.DB.prepare('SELECT 1 AS x FROM members WHERE room_id = ? AND user_id = ?').bind(roomId, payload.uid).first();
      if (!mem) {
        this.send(ws, { type: 'error', code: 'FORBIDDEN', message: '无权访问该会话' });
        ws.close(4003, 'forbidden');
        return;
      }
    }
    const user = await this.env.DB.prepare('SELECT id, username, nickname, avatar_color FROM users WHERE id = ?').bind(payload.uid).first();
    if (!user) {
      this.send(ws, { type: 'error', code: 'BAD_TOKEN', message: '账号不存在' });
      ws.close(4001, 'unauthorized');
      return;
    }

    const meta = {
      userId: user.id,
      roomId,
      nickname: user.nickname,
      username: user.username,
      avatarColor: user.avatar_color,
      lastSentAt: 0,
    };
    this.sessions.set(ws.id, meta);

    // 发送初始快照：房间信息 + 成员列表 + 在线列表
    const mres = await this.env.DB.prepare(
      `SELECT u.id, u.username, u.nickname, u.avatar_color AS avatarColor
       FROM members m JOIN users u ON u.id = m.user_id
       WHERE m.room_id = ? ORDER BY m.joined_at ASC LIMIT 300`
    ).bind(roomId).all();
    const online = [...new Set([...this.sessions.values()].map((s) => s.userId))];
    this.send(ws, {
      type: 'hello',
      room: { id: room.id, name: room.name, type: room.type, description: room.description },
      members: mres.results,
      online,
    });

    // 通知其他人有人加入
    this.broadcast(
      {
        type: 'presence',
        action: 'join',
        user: { id: user.id, username: user.username, nickname: user.nickname, avatarColor: user.avatar_color },
      },
      ws.id
    );
  }

  async handleSend(ws, meta, msg) {
    const now = Date.now();
    if (now - meta.lastSentAt < MIN_SEND_INTERVAL) {
      this.send(ws, { type: 'error', message: '发送太快了，请稍候' });
      return;
    }
    meta.lastSentAt = now;

    const contentType = msg.contentType === 'image' ? 'image' : 'text';
    const content = String(msg.content || '').slice(0, TEXT_MAX);
    if (contentType === 'text' && !content.trim()) return;

    const id = crypto.randomUUID();
    const message = {
      id,
      clientId: String(msg.clientId || ''),
      roomId: meta.roomId,
      userId: meta.userId,
      username: meta.username,
      nickname: meta.nickname,
      avatarColor: meta.avatarColor,
      type: contentType,
      content,
      createdAt: now,
    };

    // 先广播（低延迟），再持久化
    this.broadcast({ type: 'message', message });
    try {
      await this.env.DB.prepare(
        'INSERT INTO messages (id, room_id, user_id, type, content, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(id, meta.roomId, meta.userId, contentType, content, now).run();
    } catch (err) {
      console.error('persist message failed', err);
    }
  }

  webSocketClose(ws) {
    this.closeSession(ws);
  }

  webSocketError(ws) {
    this.closeSession(ws);
  }

  closeSession(ws) {
    const meta = this.sessions.get(ws.id);
    if (!meta) return;
    this.sessions.delete(ws.id);
    const stillOnline = [...this.sessions.values()].some((s) => s.userId === meta.userId);
    if (!stillOnline) {
      this.broadcast({
        type: 'presence',
        action: 'leave',
        user: { id: meta.userId, nickname: meta.nickname, avatarColor: meta.avatarColor },
      });
    }
  }

  broadcast(payload, exceptWsId) {
    const text = JSON.stringify(payload);
    for (const ws of this.state.getWebSockets()) {
      if (ws.id === exceptWsId) continue;
      try {
        ws.send(text);
      } catch {
        // 忽略已断开的连接
      }
    }
  }

  send(ws, payload) {
    try {
      ws.send(JSON.stringify(payload));
    } catch {
      // ignore
    }
  }
}
