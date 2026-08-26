// WMessage 前端主逻辑
import {
  getApiBase, getToken, setToken, getUser, setUser, clearAuth,
  getUnread, bumpUnread, resetUnread, getNotify, setNotify,
} from './store.js';
import * as api from './api.js';
import { ChatSocket } from './ws.js';
import { EMOJIS } from './emoji.js';
import { $, el, toast, modal, avatarEl, formatTime, formatListTime, formatDay, dayKey, lightbox } from './ui.js';

const $app = $('#app');

const state = {
  user: null,
  rooms: [],
  activeRoom: null,
  roomInfo: null,
  members: [],
  online: [],
  cache: new Map(),   // roomId -> { list: [], hasMore: false, loading: false }
  ws: null,
  uploadEnabled: false,
  emojiOpen: false,
  typingSentAt: 0,
  typingTimer: null,
  typingClearTimer: null,
  pending: new Map(), // clientId -> msg
};

/* ==================== 启动 ==================== */

async function boot() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
  const token = getToken();
  if (token && getUser()) {
    try {
      const { user } = await api.me();
      state.user = user;
      setUser(user);
      enterApp();
      return;
    } catch (e) {
      if (e.status === 401) clearAuth();
      else toast(e.message, 'error');
    }
  }
  showAuth();
}

/* ==================== 登录 / 注册 ==================== */

function showAuth() {
  state.ws && state.ws.close();
  state.ws = null;
  state.activeRoom = null;
  $app.innerHTML = `
    <div class="auth">
      <div class="orb a"></div><div class="orb b"></div>
      <div class="auth-card">
        <div class="auth-brand">
          <img src="./logo.svg" alt="WMessage">
          <h1>WMessage</h1>
          <p>Cloudflare × GitHub Pages 即时通讯</p>
        </div>
        <div class="auth-tabs">
          <button type="button" class="tab active" data-mode="login">登 录</button>
          <button type="button" class="tab" data-mode="register">注 册</button>
        </div>
        <form id="authForm" autocomplete="on">
          <div class="field">
            <label>用户名</label>
            <input id="authUsername" autocomplete="username" placeholder="3-20 位字母、数字或下划线" required>
          </div>
          <div class="field" id="nickField" hidden>
            <label>昵称</label>
            <input id="authNickname" autocomplete="nickname" placeholder="显示名称（可选，默认同用户名）" maxlength="20">
          </div>
          <div class="field">
            <label>密码</label>
            <input id="authPassword" type="password" autocomplete="current-password" placeholder="至少 6 位" required>
          </div>
          <div class="auth-error" id="authError"></div>
          <button class="btn btn-primary" id="authSubmit" type="submit">登 录</button>
        </form>
        <div class="auth-foot">
          <span id="authTip">还没有账号？点击「注册」创建</span>
        </div>
      </div>
    </div>`;

  let mode = 'login';
  const tabs = $app.querySelectorAll('.tab');
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      mode = tab.dataset.mode;
      tabs.forEach((t) => t.classList.toggle('active', t === tab));
      $('#nickField').hidden = mode !== 'register';
      $('#authSubmit').textContent = mode === 'login' ? '登 录' : '注 册';
      $('#authTip').textContent = mode === 'login' ? '还没有账号？点击「注册」创建' : '已有账号？点击「登录」';
      $('#authError').textContent = '';
    });
  });

  $('#authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = $('#authUsername').value.trim();
    const password = $('#authPassword').value;
    const nickname = $('#authNickname').value.trim();
    const btn = $('#authSubmit');
    btn.disabled = true;
    $('#authError').textContent = '';
    try {
      const data = mode === 'login'
        ? await api.login({ username, password })
        : await api.register({ username, password, nickname });
      setToken(data.token);
      setUser(data.user);
      state.user = data.user;
      enterApp();
    } catch (err) {
      $('#authError').textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });
}

/* ==================== 主界面 ==================== */

function appTemplate() {
  return `
  <div class="app">
    <aside class="sidebar" id="sidebar">
      <div class="side-head">
        <div class="brand"><img src="./logo.svg" alt=""><span>WMessage</span></div>
        <div class="side-actions">
          <button class="icon-btn" id="notifyBtn" title="桌面通知">🔔</button>
        </div>
      </div>
      <div class="search-box">
        <input id="searchInput" placeholder="搜索用户，发起私聊…" autocomplete="off">
        <div class="search-pop" id="searchPop" hidden></div>
      </div>
      <div class="room-list" id="roomList"></div>
      <div class="side-actions-row">
        <button class="btn btn-ghost" id="newChannelBtn">＋ 新建频道</button>
        <button class="btn btn-ghost" id="discoverBtn">🌐 发现</button>
      </div>
      <div class="side-user" id="userChip" title="点击退出登录"></div>
    </aside>
    <div class="backdrop" id="backdrop" hidden></div>

    <main class="main">
      <header class="main-header">
        <button class="icon-btn back" id="backBtn">☰</button>
        <div class="room-title-wrap">
          <div class="room-title" id="roomTitle">WMessage</div>
          <div class="room-sub" id="roomSub">选择一个会话开始聊天</div>
        </div>
        <div class="header-actions">
          <button class="icon-btn" id="membersBtn" title="成员列表">👥</button>
          <button class="icon-btn" id="moreBtn" title="更多">⋮</button>
          <div class="more-pop" id="morePop" hidden></div>
        </div>
      </header>
      <div class="messages-area">
        <button class="load-more" id="loadMore" hidden>加载更早的消息</button>
        <div class="messages" id="messages"></div>
      </div>
      <div class="typing" id="typing"></div>
      <footer class="composer">
        <textarea id="input" rows="1" placeholder="输入消息，Enter 发送，Shift+Enter 换行"></textarea>
        <button class="icon-btn" id="emojiBtn" title="表情" type="button">😀</button>
        <button class="icon-btn" id="attachBtn" title="发送图片" type="button" hidden>🖼️</button>
        <button class="btn btn-primary send-mini" id="sendBtn" type="button">发送</button>
        <input type="file" id="fileInput" accept="image/*" hidden>
      </footer>
      <div class="emoji-panel" id="emojiPanel"></div>
    </main>

    <aside class="members" id="members">
      <div class="members-head">
        <span>成员 <span class="sub" id="membersSub"></span></span>
        <button class="icon-btn" id="membersClose">✕</button>
      </div>
      <div class="members-list" id="membersList"></div>
    </aside>
  </div>`;
}

function enterApp() {
  $app.innerHTML = appTemplate();
  state.rooms = [];
  state.cache.clear();
  bindAppEvents();
  renderUserChip();
  renderNotifyBtn();
  // 探测能力
  api.health().then((h) => {
    state.uploadEnabled = !!h.upload;
    const btn = $('#attachBtn');
    if (btn) btn.hidden = !state.uploadEnabled;
  }).catch(() => {});
  loadRooms();
}

async function loadRooms() {
  try {
    const { rooms } = await api.getRooms();
    state.rooms = rooms;
    renderRooms();
    if (!state.activeRoom) {
      const first = state.rooms.find((r) => r.type === 'channel') || state.rooms[0];
      if (first) openRoom(first);
      else showEmpty('创建一个频道，或搜索用户开始私聊吧');
    }
  } catch (e) {
    if (e.status === 401) return logout('登录已失效，请重新登录');
    toast(e.message, 'error');
  }
}

/* ==================== 侧边栏 ==================== */

function roomDisplayName(r) {
  if (r.type === 'dm') return r.partner ? r.partner.nickname : '私聊';
  return r.name || '未命名频道';
}

function roomAvatar(r) {
  if (r.type === 'dm' && r.partner) {
    return avatarEl(r.partner.nickname, r.partner.avatarColor, 42);
  }
  return el('div', { class: 'room-avatar', style: 'background:linear-gradient(135deg,#4f7cff,#8b5cf6)' }, '#');
}

function renderUserChip() {
  const u = state.user;
  if (!u) return;
  const chip = $('#userChip');
  chip.innerHTML = '';
  chip.append(
    avatarEl(u.nickname, u.avatarColor, 38),
    el('div', { class: 'chip-info' },
      el('div', { class: 'chip-name' }, u.nickname),
      el('div', { class: 'chip-sub' }, '@' + u.username)),
    el('div', { class: 'chip-out' }, '退出')
  );
}

function renderRooms() {
  const list = $('#roomList');
  if (!list) return;
  list.innerHTML = '';
  if (!state.rooms.length) {
    list.append(el('div', { class: 'empty-list' }, '还没有会话，<br>下方「新建频道」或「发现」加入频道，<br>也可以搜索用户发起私聊。'));
    return;
  }
  const sort = (a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0) || (b.joinedAt || 0) - (a.joinedAt || 0);
  const channels = state.rooms.filter((r) => r.type === 'channel').sort(sort);
  const dms = state.rooms.filter((r) => r.type === 'dm').sort(sort);

  const section = (title, rooms) => {
    if (!rooms.length) return null;
    const wrap = el('div');
    wrap.append(el('div', { class: 'side-section' }, title));
    for (const r of rooms) wrap.append(roomItem(r));
    return wrap;
  };
  const ch = section('频道', channels);
  const dm = section('私聊', dms);
  if (ch) list.append(ch);
  if (dm) list.append(dm);
}

function roomItem(r) {
  const unread = getUnread()[r.id] || 0;
  const preview = r.lastMessage
    ? (r.lastMessageType === 'image' ? '[图片]' : r.lastMessage)
    : (r.type === 'channel' ? '点击进入频道' : '点击开始聊天');
  const item = el('div', {
    class: 'room-item' + (state.activeRoom && state.activeRoom.id === r.id ? ' active' : ''),
    dataset: { roomId: r.id },
  },
    roomAvatar(r),
    el('div', { class: 'room-info' },
      el('div', { class: 'room-name' }, roomDisplayName(r)),
      el('div', { class: 'room-preview' }, preview)),
    el('div', { class: 'room-meta' },
      el('div', { class: 'room-time' }, formatListTime(r.lastMessageAt)),
      unread ? el('div', { class: 'badge' }, unread > 99 ? '99+' : unread) : null)
  );
  item.addEventListener('click', () => openRoom(r));
  return item;
}

/* ==================== 打开会话 ==================== */

async function openRoom(room) {
  if (!room || (state.activeRoom && state.activeRoom.id === room.id)) return;
  if (state.ws) {
    state.ws.close();
    state.ws = null;
  }
  state.activeRoom = room;
  state.roomInfo = null;
  state.members = [];
  state.online = [];
  resetUnread(room.id);
  renderRooms();
  renderHeader();
  renderMembers();
  $('#messages').innerHTML = '';
  $('#loadMore').hidden = true;
  $('#typing').textContent = '';
  $('#morePop').hidden = true;
  showEmpty('加载中…');

  const c = roomCache(room.id);
  try {
    const data = await api.getMessages(room.id, { limit: 50 });
    c.list = data.messages;
    c.hasMore = data.messages.length === 50;
    renderAllMessages(room.id);
  } catch (e) {
    if (e.status === 401) return logout('登录已失效，请重新登录');
    toast(e.message, 'error');
  }
  connectRoom(room.id);
}

function roomCache(roomId) {
  let c = state.cache.get(roomId);
  if (!c) {
    c = { list: [], hasMore: false, loading: false };
    state.cache.set(roomId, c);
  }
  return c;
}

function connectRoom(roomId) {
  const socket = new ChatSocket(roomId, {
    onEvent: handleWsEvent,
    onSessionExpired: () => logout('登录已失效，请重新登录'),
  });
  state.ws = socket;
  socket.connect();
}

function handleWsEvent(m) {
  switch (m.type) {
    case 'hello': {
      state.roomInfo = m.room;
      state.members = m.members || [];
      state.online = m.online || [];
      renderHeader();
      renderMembers();
      break;
    }
    case 'message':
      onIncomingMessage(m.message);
      break;
    case 'presence': {
      const u = m.user || {};
      if (m.action === 'join') {
        if (!state.members.find((x) => x.id === u.id)) state.members.push(u);
        if (!state.online.includes(u.id)) state.online.push(u.id);
        systemLine(`${u.nickname || '有人'} 加入了会话`);
      } else {
        state.online = state.online.filter((id) => id !== u.id);
        systemLine(`${u.nickname || '有人'} 离开了会话`);
      }
      renderHeader();
      renderMembers();
      break;
    }
    case 'typing':
      showTyping(m.isTyping ? m.nickname : '');
      break;
    case 'error':
      toast(m.message || '发生错误', 'error');
      break;
  }
}

/* ==================== 头部 / 成员 ==================== */

function renderHeader() {
  const room = state.activeRoom;
  const title = $('#roomTitle');
  const sub = $('#roomSub');
  if (!room || !title) return;
  title.textContent = roomDisplayName(room);
  if (room.type === 'dm') {
    sub.textContent = `私聊 · ${state.online.length} 在线`;
  } else {
    sub.textContent = `${state.members.length} 名成员 · ${state.online.length} 在线`;
  }
  const more = $('#moreBtn');
  if (more) more.style.visibility = room.type === 'channel' ? 'visible' : 'hidden';
}

function renderMembers() {
  const list = $('#membersList');
  if (!list) return;
  list.innerHTML = '';
  $('#membersSub').textContent = `${state.members.length} 人 · ${state.online.length} 在线`;
  if (!state.members.length) {
    list.append(el('div', { class: 'empty-list' }, '暂无成员'));
    return;
  }
  for (const u of state.members) {
    const item = el('div', { class: 'member-item' },
      avatarEl(u.nickname, u.avatarColor, 34),
      el('div', { class: 'm-info' },
        el('div', { class: 'm-name' }, u.nickname),
        el('div', { class: 'm-username' }, '@' + u.username)),
      el('div', { class: 'online-dot' + (state.online.includes(u.id) ? ' on' : '') })
    );
    if (u.id !== state.user.id) {
      item.title = '点击发起私聊';
      item.addEventListener('click', () => startDmAndOpen(u));
    }
    list.append(item);
  }
}

/* ==================== 消息渲染 ==================== */

function showEmpty(text) {
  const msgs = $('#messages');
  if (!msgs) return;
  msgs.innerHTML = '';
  msgs.append(el('div', { class: 'empty' },
    el('div', null, el('div', { class: 'big' }, '💬'), el('div', null, text))));
}

function imgSrc(path) {
  return path.startsWith('http') ? path : getApiBase() + path;
}

function buildMessageNode(msg, prevMsg) {
  const own = state.user && msg.userId === state.user.id;
  const grouped = !!(prevMsg && prevMsg.userId === msg.userId && prevMsg.type !== 'system' &&
    dayKey(prevMsg.createdAt) === dayKey(msg.createdAt) && msg.createdAt - prevMsg.createdAt < 5 * 60 * 1000);
  const wrap = el('div', {
    class: 'msg' + (own ? ' own' : '') + (grouped ? ' grouped' : '') + (msg.pending ? ' pending' : ''),
    dataset: { mid: msg.id, cid: msg.clientId || '' },
  });
  if (!grouped) wrap.append(avatarEl(msg.nickname, msg.avatarColor, 36));
  const body = el('div', { class: 'msg-body' });
  if (!grouped) {
    body.append(el('div', { class: 'msg-meta' },
      el('span', { class: 'name' }, own ? '我' : (msg.nickname || '')),
      el('span', { class: 'time' }, formatTime(msg.createdAt))));
  }
  if (msg.type === 'image') {
    const img = el('img', { class: 'msg-img', src: imgSrc(msg.content), alt: '图片', loading: 'lazy' });
    img.addEventListener('click', () => lightbox(imgSrc(msg.content)));
    body.append(img);
  } else {
    body.append(el('div', { class: 'bubble' }, msg.content));
  }
  wrap.append(body);
  return wrap;
}

function daySepEl(ts) {
  return el('div', { class: 'day-sep' }, formatDay(ts));
}

function renderAllMessages(roomId) {
  const msgs = $('#messages');
  if (!msgs || state.activeRoom?.id !== roomId) return;
  const c = roomCache(roomId);
  msgs.innerHTML = '';
  if (!c.list.length) {
    showEmpty('暂无消息，打个招呼吧');
    return;
  }
  const frag = document.createDocumentFragment();
  let prev = null;
  let lastDay = '';
  for (const m of c.list) {
    const day = dayKey(m.createdAt);
    if (day !== lastDay) {
      frag.append(daySepEl(m.createdAt));
      lastDay = day;
    }
    frag.append(buildMessageNode(m, prev));
    prev = m;
  }
  msgs.append(frag);
  updateLoadMore();
  scrollBottom(true);
}

function updateLoadMore() {
  const btn = $('#loadMore');
  const c = state.activeRoom ? roomCache(state.activeRoom.id) : null;
  if (btn) btn.hidden = !(c && c.hasMore && c.list.length);
}

function appendMessageNode(msg) {
  const room = state.activeRoom;
  if (!room) return;
  const msgs = $('#messages');
  if (!msgs || room.id !== msg.roomId) return;
  if (msgs.querySelector('.empty')) msgs.innerHTML = '';
  const c = roomCache(room.id);
  const prev = c.list.length >= 2 ? c.list[c.list.length - 2] : null;
  const stick = nearBottom() || (state.user && msg.userId === state.user.id);
  const nodes = [];
  if (prev && dayKey(prev.createdAt) !== dayKey(msg.createdAt)) nodes.push(daySepEl(msg.createdAt));
  nodes.push(buildMessageNode(msg, prev));
  msgs.append(...nodes);
  if (stick) scrollBottom();
  updateLoadMore();
}

function patchPendingNode(msg) {
  const msgs = $('#messages');
  if (!msgs) return;
  const old = msgs.querySelector(`[data-cid="${CSS.escape(msg.clientId)}"]`);
  if (old) {
    const c = roomCache(msg.roomId);
    const idx = c.list.findIndex((x) => x.clientId === msg.clientId);
    const prev = idx > 0 ? c.list[idx - 1] : null;
    const node = buildMessageNode(msg, prev);
    old.replaceWith(node);
  }
}

function nearBottom() {
  const msgs = $('#messages');
  if (!msgs) return true;
  return msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 120;
}

function scrollBottom(force = false) {
  const msgs = $('#messages');
  if (!msgs) return;
  if (force || nearBottom()) msgs.scrollTop = msgs.scrollHeight;
}

function systemLine(text) {
  const room = state.activeRoom;
  if (!room) return;
  const msgs = $('#messages');
  if (!msgs || msgs.querySelector('.empty')) return;
  const stick = nearBottom();
  msgs.append(el('div', { class: 'msg-sys' }, text));
  if (stick) msgs.scrollTop = msgs.scrollHeight;
}

async function loadOlder() {
  const room = state.activeRoom;
  if (!room || !state.ws) return;
  const c = roomCache(room.id);
  if (c.loading || !c.hasMore || !c.list.length) return;
  c.loading = true;
  const first = c.list[0];
  try {
    const data = await api.getMessages(room.id, { beforeTs: first.createdAt, beforeId: first.id, limit: 50 });
    if (!data.messages.length) {
      c.hasMore = false;
    } else {
      const msgs = $('#messages');
      const oldHeight = msgs.scrollHeight;
      const frag = document.createDocumentFragment();
      let prev = null;
      let lastDay = '';
      // 只对新一段消息渲染（与旧消息的交界处自动衔接）
      for (const m of data.messages) {
        const day = dayKey(m.createdAt);
        if (day !== lastDay) {
          frag.append(daySepEl(m.createdAt));
          lastDay = day;
        }
        frag.append(buildMessageNode(m, prev));
        prev = m;
      }
      msgs.prepend(frag);
      msgs.scrollTop += msgs.scrollHeight - oldHeight;
      c.list = data.messages.concat(c.list);
      c.hasMore = data.messages.length === 50;
    }
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    c.loading = false;
    updateLoadMore();
  }
}

/* ==================== 收发消息 ==================== */

function onIncomingMessage(msg) {
  if (!msg || !msg.roomId) return;
  const c = roomCache(msg.roomId);
  const pendingMsg = msg.clientId ? state.pending.get(msg.clientId) : null;

  if (pendingMsg) {
    state.pending.delete(msg.clientId);
    Object.assign(pendingMsg, { id: msg.id, createdAt: msg.createdAt, pending: false });
    if (state.activeRoom && state.activeRoom.id === msg.roomId) patchPendingNode(pendingMsg);
  } else if (!c.list.some((m) => m.id === msg.id)) {
    c.list.push(msg);
    if (state.activeRoom && state.activeRoom.id === msg.roomId) appendMessageNode(msg);
  }

  updateSidebarPreview(msg);
  const isOwn = state.user && msg.userId === state.user.id;
  const isActive = state.activeRoom && state.activeRoom.id === msg.roomId;
  if (!isOwn && (!isActive || document.hidden)) {
    bumpUnread(msg.roomId);
    notify(msg);
    const item = document.querySelector(`.room-item[data-room-id="${CSS.escape(msg.roomId)}"]`);
    if (item) {
      const old = item.querySelector('.badge');
      const n = getUnread()[msg.roomId] || 0;
      if (old) old.textContent = n > 99 ? '99+' : n;
      else item.querySelector('.room-meta').append(el('div', { class: 'badge' }, n > 99 ? '99+' : n));
    }
  }
}

function updateSidebarPreview(msg) {
  const room = state.rooms.find((r) => r.id === msg.roomId);
  if (!room) return;
  room.lastMessage = msg.content;
  room.lastMessageType = msg.type;
  room.lastMessageAt = msg.createdAt;
  room.lastSender = msg.nickname;
  renderRooms();
}

function sendMessage(type, content) {
  const room = state.activeRoom;
  if (!room) return;
  if (type === 'text' && !content.trim()) return;
  if (!state.ws || !state.ws.isOpen()) {
    toast('正在连接服务器…');
    return;
  }
  const clientId = crypto.randomUUID();
  const text = type === 'text' ? content.trim().slice(0, 4000) : content;
  const msg = {
    id: clientId, clientId, roomId: room.id,
    userId: state.user.id, username: state.user.username,
    nickname: state.user.nickname, avatarColor: state.user.avatarColor,
    type, content: text, createdAt: Date.now(), pending: true,
  };
  state.pending.set(clientId, msg);
  const c = roomCache(room.id);
  c.list.push(msg);
  appendMessageNode(msg);
  updateSidebarPreview(msg);
  state.ws.send({ type: 'send', clientId, contentType: type === 'image' ? 'image' : 'text', content: text });
}

function showTyping(nickname) {
  const t = $('#typing');
  if (!t) return;
  t.textContent = nickname ? `${nickname} 正在输入…` : '';
  clearTimeout(state.typingClearTimer);
  if (nickname) {
    state.typingClearTimer = setTimeout(() => { t.textContent = ''; }, 3000);
  }
}

function onTypingInput() {
  if (!state.ws || !state.ws.isOpen() || !state.activeRoom) return;
  const now = Date.now();
  if (now - state.typingSentAt > 2500) {
    state.typingSentAt = now;
    state.ws.send({ type: 'typing', isTyping: true });
  }
  clearTimeout(state.typingTimer);
  state.typingTimer = setTimeout(() => {
    if (state.ws) state.ws.send({ type: 'typing', isTyping: false });
  }, 2000);
}

/* ==================== 表情 ==================== */

function toggleEmojiPanel() {
  const p = $('#emojiPanel');
  if (!p) return;
  if (state.emojiOpen) {
    p.classList.remove('open');
    state.emojiOpen = false;
    return;
  }
  if (!p.children.length) {
    const grid = el('div', { class: 'emoji-grid' });
    for (const e of EMOJIS) {
      grid.append(el('button', { type: 'button', class: 'emoji-btn', onClick: () => insertEmoji(e) }, e));
    }
    p.append(grid);
  }
  p.classList.add('open');
  state.emojiOpen = true;
}

function insertEmoji(emoji) {
  const ta = $('#input');
  if (!ta) return;
  const s = ta.selectionStart ?? ta.value.length;
  const e = ta.selectionEnd ?? s;
  ta.value = ta.value.slice(0, s) + emoji + ta.value.slice(e);
  ta.selectionStart = ta.selectionEnd = s + emoji.length;
  ta.focus();
  autosize(ta);
}

function autosize(ta) {
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
}

/* ==================== 图片 ==================== */

async function uploadFile(file) {
  if (!file) return;
  if (!state.uploadEnabled) return toast('服务器未启用图片上传', 'error');
  if (file.size > 8 * 1024 * 1024) return toast('图片不能超过 8MB', 'error');
  const btn = $('#attachBtn');
  btn.disabled = true;
  try {
    const url = await api.upload(file);
    sendMessage('image', url);
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

/* ==================== 搜索用户 / 私聊 / 频道 ==================== */

let searchTimer = null;

function bindSearch() {
  const input = $('#searchInput');
  const pop = $('#searchPop');
  input.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = input.value.trim();
    if (!q) {
      pop.hidden = true;
      return;
    }
    searchTimer = setTimeout(async () => {
      try {
        const { users } = await api.searchUsers(q);
        pop.innerHTML = '';
        if (!users.length) {
          pop.append(el('div', { class: 'search-empty' }, '没有找到用户'));
        }
        for (const u of users) {
          const item = el('div', { class: 'search-item' },
            avatarEl(u.nickname, u.avatarColor, 32),
            el('div', null,
              el('div', { class: 'room-name' }, u.nickname),
              el('div', { class: 'sub' }, '@' + u.username)));
          item.addEventListener('click', () => {
            pop.hidden = true;
            input.value = '';
            startDmAndOpen(u);
          });
          pop.append(item);
        }
        pop.hidden = false;
      } catch (e) {
        toast(e.message, 'error');
      }
    }, 250);
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-box')) pop.hidden = true;
  });
}

async function startDmAndOpen(user) {
  try {
    const { room } = await api.startDm(user.id);
    state.rooms = state.rooms.filter((r) => r.id !== room.id);
    state.rooms.push({ ...room, partner: user });
    renderRooms();
    openRoom(state.rooms[state.rooms.length - 1]);
  } catch (e) {
    toast(e.message, 'error');
  }
}

function openNewChannelModal() {
  const nameInput = el('input', { placeholder: '例如：产品讨论区', maxlength: '30' });
  const descInput = el('input', { placeholder: '频道简介（可选）', maxlength: '120' });
  modal({
    title: '新建频道',
    body: el('div', null,
      el('div', { class: 'field' }, el('label', null, '频道名称'), nameInput),
      el('div', { class: 'field' }, el('label', null, '简介'), descInput)),
    actions: [
      { label: '取消' },
      {
        label: '创建', primary: true,
        onClick: async () => {
          try {
            const { room } = await api.createRoom(nameInput.value, descInput.value);
            state.rooms.unshift(room);
            renderRooms();
            openRoom(room);
          } catch (e) {
            toast(e.message, 'error');
          }
        },
      },
    ],
  });
}

async function openDiscoverModal() {
  const wrap = el('div', { class: 'modal-list' });
  const m = modal({ title: '发现频道', body: wrap, actions: [{ label: '关闭' }] });
  try {
    const { channels } = await api.getChannels();
    if (!channels.length) {
      wrap.append(el('div', { class: 'search-empty' }, '还没有公开频道，创建一个吧'));
    }
    for (const ch of channels) {
      const joined = !!ch.joined;
      const row = el('div', { class: 'modal-row' },
        el('div', { class: 'room-avatar', style: 'background:linear-gradient(135deg,#4f7cff,#8b5cf6);width:36px;height:36px;font-size:15px' }, '#'),
        el('div', { class: 'grow' },
          el('div', { class: 'name' }, ch.name),
          el('div', { class: 'desc' }, ch.description || '暂无简介')),
        el('div', { class: 'mem' }, `${ch.memberCount} 人`),
        el('button', {
          type: 'button', class: 'btn btn-ghost', style: 'flex:none',
          disabled: joined, textContent: joined ? '已加入' : '加入',
          onClick: async () => {
            try {
              await api.joinRoom(ch.id);
              m.close();
              toast(`已加入 ${ch.name}`);
              await loadRooms();
              const room = state.rooms.find((r) => r.id === ch.id);
              if (room) openRoom(room);
            } catch (e) {
              toast(e.message, 'error');
            }
          },
        }));
      wrap.append(row);
    }
  } catch (e) {
    wrap.append(el('div', { class: 'search-empty' }, e.message));
  }
}

function confirmLeaveChannel() {
  const room = state.activeRoom;
  if (!room || room.type !== 'channel') return;
  modal({
    title: '退出频道',
    body: el('div', { style: 'color:var(--muted);font-size:14px;line-height:1.7' },
      `确定退出「${roomDisplayName(room)}」吗？退出后将不再收到该频道的消息。`),
    actions: [
      { label: '取消' },
      {
        label: '退出', primary: true,
        onClick: async () => {
          try {
            await api.leaveRoom(room.id);
            state.rooms = state.rooms.filter((r) => r.id !== room.id);
            renderRooms();
            toast('已退出频道');
            const first = state.rooms.find((r) => r.type === 'channel') || state.rooms[0];
            if (first) openRoom(first);
            else {
              state.ws && state.ws.close();
              state.ws = null;
              state.activeRoom = null;
              renderHeader();
              showEmpty('创建一个频道，或搜索用户开始私聊吧');
            }
          } catch (e) {
            toast(e.message, 'error');
          }
        },
      },
    ],
  });
}

/* ==================== 通知 / 更多菜单 ==================== */

function renderNotifyBtn() {
  const btn = $('#notifyBtn');
  if (!btn) return;
  btn.classList.toggle('active', getNotify());
}

function toggleNotify() {
  if (!('Notification' in window)) return toast('当前环境不支持桌面通知');
  if (getNotify()) {
    setNotify(false);
    renderNotifyBtn();
    toast('已关闭桌面通知');
    return;
  }
  if (Notification.permission === 'default') {
    Notification.requestPermission().then((p) => {
      if (p === 'granted') {
        setNotify(true);
        renderNotifyBtn();
        toast('已开启桌面通知');
      } else {
        toast('未授权通知');
      }
    });
  } else if (Notification.permission === 'granted') {
    setNotify(true);
    renderNotifyBtn();
    toast('已开启桌面通知');
  } else {
    toast('通知被浏览器禁用，请在浏览器设置中开启', 'error');
  }
}

function notify(msg) {
  if (!getNotify() || !('Notification' in window) || Notification.permission !== 'granted') return;
  if (document.visibilityState === 'visible' && state.activeRoom && state.activeRoom.id === msg.roomId) return;
  const body = msg.type === 'image' ? '[图片]' : (msg.content || '').slice(0, 120);
  try {
    const n = new Notification(msg.nickname || '新消息', {
      body,
      icon: './icons/icon-192.png',
      tag: 'wmessage-' + msg.roomId,
      data: { roomId: msg.roomId },
    });
    n.onclick = () => {
      window.focus();
      const room = state.rooms.find((r) => r.id === msg.roomId);
      if (room) openRoom(room);
    };
  } catch {
    /* 某些环境不支持 */
  }
}

function toggleMoreMenu() {
  const pop = $('#morePop');
  if (!pop) return;
  if (!pop.hidden) {
    pop.hidden = true;
    return;
  }
  pop.innerHTML = '';
  const room = state.activeRoom;
  if (room && room.type === 'channel') {
    pop.append(el('button', { type: 'button', class: 'danger', onClick: () => { pop.hidden = true; confirmLeaveChannel(); } }, '退出该频道'));
    pop.append(el('button', { type: 'button', onClick: () => { pop.hidden = true; navigator.clipboard?.writeText(room.id).then(() => toast('会话 ID 已复制')); } }, '复制会话 ID'));
  } else {
    pop.append(el('button', { type: 'button', onClick: () => { pop.hidden = true; } }, '私聊无需其他操作'));
  }
  pop.hidden = false;
}

/* ==================== 事件绑定 ==================== */

function bindAppEvents() {
  // 侧边栏
  $('#notifyBtn').addEventListener('click', toggleNotify);
  $('#userChip').addEventListener('click', () => logout());
  $('#newChannelBtn').addEventListener('click', openNewChannelModal);
  $('#discoverBtn').addEventListener('click', openDiscoverModal);
  bindSearch();

  // 移动端侧边栏
  $('#backBtn').addEventListener('click', () => {
    $('#sidebar').classList.add('open');
    $('#backdrop').hidden = false;
  });
  const closeSidebar = () => {
    $('#sidebar').classList.remove('open');
    $('#backdrop').hidden = true;
  };
  $('#backdrop').addEventListener('click', closeSidebar);

  // 成员面板
  $('#membersBtn').addEventListener('click', () => $('#members').classList.toggle('show'));
  $('#membersClose').addEventListener('click', () => $('#members').classList.remove('show'));

  // 更多菜单
  $('#moreBtn').addEventListener('click', toggleMoreMenu);
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.header-actions')) {
      const pop = $('#morePop');
      if (pop) pop.hidden = true;
    }
    if (!e.target.closest('#emojiPanel') && !e.target.closest('#emojiBtn')) {
      const p = $('#emojiPanel');
      if (p && state.emojiOpen) {
        p.classList.remove('open');
        state.emojiOpen = false;
      }
    }
  });

  // 输入区
  const input = $('#input');
  input.addEventListener('input', () => {
    autosize(input);
    onTypingInput();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      doSend();
    }
  });
  input.addEventListener('paste', (e) => {
    const files = e.clipboardData && e.clipboardData.files;
    if (files && files.length && files[0].type.startsWith('image/')) {
      e.preventDefault();
      uploadFile(files[0]);
    }
  });

  $('#sendBtn').addEventListener('click', doSend);
  $('#emojiBtn').addEventListener('click', toggleEmojiPanel);
  $('#attachBtn').addEventListener('click', () => $('#fileInput').click());
  $('#fileInput').addEventListener('change', (e) => {
    uploadFile(e.target.files[0]);
    e.target.value = '';
  });

  // 加载更早消息
  $('#loadMore').addEventListener('click', loadOlder);

  // 点击侧边栏会话项时更新高亮（用了事件委托）
  $('#roomList').addEventListener('click', (e) => {
    const item = e.target.closest('.room-item');
    if (item && window.innerWidth <= 860) {
      $('#sidebar').classList.remove('open');
      $('#backdrop').hidden = true;
    }
  });
}

function doSend() {
  const input = $('#input');
  const text = input.value;
  if (!text.trim()) return;
  input.value = '';
  autosize(input);
  sendMessage('text', text);
  input.focus();
}

/* ==================== 退出 ==================== */

function logout(reason = '') {
  if (!reason && !confirm('确定退出登录吗？')) return;
  clearAuth();
  if (state.ws) {
    state.ws.close();
    state.ws = null;
  }
  state.rooms = [];
  state.cache.clear();
  state.activeRoom = null;
  state.user = null;
  showAuth();
  if (reason) toast(reason, 'error');
}

/* ==================== 启动 ==================== */
boot();
