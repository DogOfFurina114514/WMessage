// WebSocket 客户端：自动重连 + 心跳
import { getApiBase, getToken } from './store.js';

export class ChatSocket {
  constructor(roomId, handlers = {}) {
    this.roomId = roomId;
    this.handlers = handlers; // { onEvent, onClose, onSessionExpired }
    this.ws = null;
    this.retry = 0;
    this.closed = false;
    this.alive = true;
    this.pingTimer = null;
  }

  connect() {
    if (this.closed) return;
    const u = new URL(getApiBase());
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
    u.pathname = '/ws';
    u.search = `?room=${encodeURIComponent(this.roomId)}`;
    let ws;
    try {
      ws = new WebSocket(u);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.retry = 0;
      this.alive = true;
      this.send({ type: 'auth', token: getToken(), roomId: this.roomId });
      clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => {
        if (!this.alive) {
          this.alive = true;
          try { ws.close(); } catch { /* ignore */ }
          return;
        }
        this.alive = false;
        this.send({ type: 'ping' });
      }, 20000);
    };

    ws.onmessage = (e) => {
      let m;
      try {
        m = JSON.parse(e.data);
      } catch {
        return;
      }
      if (m.type === 'pong') {
        this.alive = true;
        return;
      }
      if (m.type === 'error' && (m.code === 'BAD_TOKEN' || m.code === 'AUTH_REQUIRED')) {
        this.closed = true;
        try { ws.close(); } catch { /* ignore */ }
        if (this.handlers.onSessionExpired) this.handlers.onSessionExpired();
        return;
      }
      if (this.handlers.onEvent) this.handlers.onEvent(m);
    };

    ws.onclose = () => {
      clearInterval(this.pingTimer);
      if (this.handlers.onClose) this.handlers.onClose();
      this.scheduleReconnect();
    };

    ws.onerror = () => {
      try { ws.close(); } catch { /* ignore */ }
    };
  }

  scheduleReconnect() {
    if (this.closed) return;
    const delay = Math.min(8000, 500 * 2 ** this.retry);
    this.retry++;
    setTimeout(() => this.connect(), delay);
  }

  send(obj) {
    if (this.ws && this.ws.readyState === 1) {
      try {
        this.ws.send(JSON.stringify(obj));
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  isOpen() {
    return !!(this.ws && this.ws.readyState === 1);
  }

  close() {
    this.closed = true;
    clearInterval(this.pingTimer);
    try {
      if (this.ws) this.ws.close();
    } catch {
      /* ignore */
    }
  }
}
