// WMessage 前端主逻辑
import {
  getApiBase, getToken, setToken, getUser, setUser, clearAuth,
  getUnread, bumpUnread, resetUnread, getNotify, setNotify,
  getSound, getFolders, getEnterSend, getAnim,
} from './store.js';
import * as api from './supabase.js';
import { EMOJIS, emojiSrc, splitEmoji } from './emoji.js';
import { $, el, icon, toast, modal, confirmDialog, avatarEl, formatTime, formatListTime, formatDay, dayKey, lightbox } from './ui.js';

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
  mobileView: 'chats',
  accountEmail: '',
  folder: 'all',
  replyTo: null,
  chatQuery: '',
};

/* ==================== 平台检测与主题 ====================
   桌面客户端 → theme-desktop；手机/PWA → theme-mobile；桌面浏览器 → theme-web */
function detectPlatform() {
  // 桌面壳严格判定：Electron preload 注入，或 WebView2（且来源必须是内置 app.local）
  const isWebView2 = !!(window.chrome && window.chrome.webview) && location.hostname === 'app.local';
  const isElectron = !!(window.desktop && window.desktop.isDesktop) || isWebView2;
  const isMobile = !isElectron && (
    matchMedia('(max-width: 820px)').matches ||
    /Mobi|Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)
  );
  const theme = isElectron ? 'desktop' : isMobile ? 'mobile' : 'web';
  document.documentElement.classList.add('theme-' + theme);
  state.isMobile = isMobile;
  state.isElectron = isElectron;
}
detectPlatform();

// 桌面窗口调用：Electron 或 WebView2 桥接；action: close/expand/drag/resize
function desktopCall(action, payload) {
  if (window.desktop && window.desktop.isDesktop) {
    if (action === 'close' && window.desktop.closeWindow) return window.desktop.closeWindow();
    if (action === 'expand' && window.desktop.expandWindow) return window.desktop.expandWindow();
  }
  if (window.chrome && window.chrome.webview) {
    try { window.chrome.webview.postMessage(Object.assign({ action }, payload || {})); } catch { /* 忽略 */ }
  }
}

// 桌面端：窗口标题随界面变化（登录/注册/主界面）
function setDesktopTitle(text) {
  desktopCall('title', { text });
}

// 移动端：回到会话列表视图（关闭联系人页/设置页）
function setMobileView(view) {
  state.mobileView = view;
  if (!state.isMobile) return;
  document.body.classList.remove('mtab-contacts');
  const bar = $('#tabBar');
  if (bar) bar.querySelectorAll('.tab-item').forEach((b) => b.classList.toggle('active', b.dataset.tab === 'chats'));
}

function setChatOpen(open) {
  if (state.isMobile) document.body.classList.toggle('chat-open', open);
}


/* ==================== 启动 ==================== */

async function boot() {
  if ('serviceWorker' in navigator) {
    // 前端有更新时（新 Service Worker 接管）自动刷新一次，避免停留在旧版本
    let swDone = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (swDone) return;
      swDone = true;
      location.reload();
    });
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
  const token = getToken();
  if (token && getUser()) {
    try {
      const { user } = await api.me();
      state.user = user;
      state.accountEmail = user.email || '';
      setUser(user);
      enterApp();
      return;
    } catch (e) {
      if (e.status === 401) {
        // 会话可能只是过期：先尝试续期，仍失败才判定为未登录
        let okRefresh = false;
        try { okRefresh = await api.refreshSession(); } catch (e2) { okRefresh = false; }
        if (okRefresh) {
          try {
            const again = await api.me();
            state.user = again.user;
            setUser(again.user);
            enterApp();
            return;
          } catch (e3) { /* 继续往下清除 */ }
        }
        clearAuth();
        location.replace('./login.html');
        return;
      }
      // 其他失败（网络/界面异常）不回跳登录页，否则用户会看到"登录成功却又回到登录页"
      toast('加载失败：' + (e.message || e), 'error');
      $app.innerHTML = '<div class="auth"><div class="auth-card" style="text-align:center">' +
        '<h1 style="margin:0 0 10px;font-size:20px">加载失败</h1>' +
        '<p style="color:var(--muted);font-size:13px;line-height:1.9">' + (e.message || e) + '</p>' +
        '<button class="btn btn-primary" style="margin-top:16px" id="retryBtn">重新加载</button></div></div>';
      const retry = $('#retryBtn');
      if (retry) retry.addEventListener('click', () => location.reload());
      return;
    }
  }
  // 未登录：跳转到独立登录页
  location.replace('./login.html');
}


/* ==================== 主界面 ==================== */

function appTemplate() {
  return `
  <div class="app">
    <!-- 网页端主题：上升气泡背景（仅 theme-web 显示） -->
    <div class="t-bubbles"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>
    <aside class="sidebar" id="sidebar">
      <!-- 移动端顶栏（Telegram Android：标题 + 搜索） -->
      <div class="m-topbar">
        <div class="m-title" id="mTitle">WMessage</div>
        <button class="icon-btn" id="mSearchToggle" title="搜索"><svg class="ic"><use href="#i-search"></use></svg></button>
      </div>
      <div class="side-head">
        <button class="icon-btn" id="sideMenuBtn" title="菜单"><svg class="ic"><use href="#i-menu"></use></svg></button>
        <div class="search-box">
          <svg class="ic search-ic"><use href="#i-search"></use></svg>
          <input id="searchInput" placeholder="搜索" autocomplete="off">
          <div class="search-pop" id="searchPop" hidden></div>
        </div>
      </div>
      <div class="side-menu" id="sideMenu" hidden>
        <button type="button" data-act="new"><svg class="ic"><use href="#i-chat"></use></svg> 新建频道</button>
        <button type="button" data-act="discover"><svg class="ic"><use href="#i-compass"></use></svg> 发现频道</button>
        <button type="button" data-act="settings"><svg class="ic"><use href="#i-gear"></use></svg> 设置</button>
        <button type="button" data-act="logout" class="danger"><svg class="ic"><use href="#i-logout"></use></svg> 退出登录</button>
      </div>
      <div class="room-list" id="roomList"></div>
      <button class="fab" id="fabBtn" type="button" title="新建"><svg class="ic"><use href="#i-edit"></use></svg></button>
      <div class="fab-pop" id="fabPop" hidden>
        <button class="btn-ghost" id="newChannelBtn"><svg class="ic ic-sm"><use href="#i-chat"></use></svg> 新建频道</button>
        <button class="btn-ghost" id="discoverBtn"><svg class="ic ic-sm"><use href="#i-compass"></use></svg> 发现频道</button>
      </div>
      <div class="side-user" id="userChip" title="点击退出登录"></div>
    </aside>
    <div class="backdrop" id="backdrop" hidden></div>

    <main class="main">
      <header class="main-header">
        <button class="icon-btn back" id="backBtn"><svg class="ic"><use href="#i-menu"></use></svg></button>
        <div class="head-avatar" id="headAvatar" hidden></div>
        <div class="room-title-wrap">
          <div class="room-title" id="roomTitle">WMessage</div>
          <div class="room-sub" id="roomSub">选择一个会话开始聊天</div>
        </div>
        <div class="header-actions">
          <button class="icon-btn" id="chatSearchBtn" title="在聊天中搜索" hidden><svg class="ic"><use href="#i-search"></use></svg></button>
          <button class="icon-btn" id="membersBtn" title="成员列表" hidden><svg class="ic"><use href="#i-members"></use></svg></button>
          <button class="icon-btn" id="moreBtn" title="更多" hidden><svg class="ic"><use href="#i-more"></use></svg></button>
          <div class="more-pop" id="morePop" hidden></div>
        </div>
        <div class="chat-search" id="chatSearch" hidden>
          <svg class="ic search-ic"><use href="#i-search"></use></svg>
          <input id="chatSearchInput" placeholder="在此聊天中搜索" autocomplete="off">
          <span class="cs-count" id="chatSearchCount"></span>
          <button class="icon-btn" id="chatSearchClose" title="关闭"><svg class="ic"><use href="#i-close"></use></svg></button>
        </div>
      </header>
      <div class="messages-area">
        <button class="load-more" id="loadMore" hidden>加载更早的消息</button>
        <div class="messages" id="messages"></div>
      </div>
      <div class="typing" id="typing"></div>
      <footer class="composer">
        <div class="input-wrap">
          <button class="icon-btn" id="attachBtn" title="发送图片" type="button" hidden><svg class="ic"><use href="#i-image"></use></svg></button>
          <div class="input-area" id="input" contenteditable="plaintext-only" data-placeholder="写消息…" spellcheck="false"></div>
          <button class="icon-btn" id="emojiBtn" title="表情" type="button"><svg class="ic"><use href="#i-smile"></use></svg></button>
        </div>
        <button class="btn btn-primary send-mini" id="sendBtn" type="button"><svg class="ic send-ic"><use href="#i-send"></use></svg><span class="send-label">发送</span></button>
        <input type="file" id="fileInput" accept="image/*" hidden>
      </footer>
      <div class="emoji-panel" id="emojiPanel"></div>
    </main>

    <aside class="members" id="members">
      <div class="members-head">
        <span>成员 <span class="sub" id="membersSub"></span></span>
        <button class="icon-btn" id="membersClose"><svg class="ic"><use href="#i-close"></use></svg></button>
      </div>
      <div class="members-list" id="membersList"></div>
    </aside>

    <!-- 移动端：设置页（Telegram Android：整屏列表 + 子页） -->
    <div class="mobile-views">
      <section class="mview" id="mContacts">
        <div class="mview-head">
          <button class="icon-btn" id="mContactsBack"><svg class="ic"><use href="#i-back"></use></svg></button>
          <div class="mview-title">联系人</div>
          <div class="mview-actions">
            <button class="icon-btn" id="mDiscoverBtn" title="发现频道"><svg class="ic"><use href="#i-compass"></use></svg></button>
          </div>
        </div>
        <div class="search-box">
          <input id="mSearchInput" placeholder="搜索用户，发起私聊…" autocomplete="off">
          <div class="search-pop" id="mSearchPop" hidden></div>
        </div>
        <div class="mlist" id="mDmList"></div>
      </section>
    </div>

    <!-- 移动端底部导航（最新版 Telegram Android：底部栏，无抽屉） -->
    <nav class="tabbar" id="tabBar">
      <button type="button" class="tab-item active" data-tab="chats">
        <svg class="ic"><use href="#i-chat"></use></svg><span>会话</span>
      </button>
      <button type="button" class="tab-item" data-tab="settings">
        <svg class="ic"><use href="#i-gear"></use></svg><span>设置</span>
      </button>
    </nav>
  </div>`;
}

// 未选中会话时：桌面端只显示会话列表，窗口横向收缩并锁定宽度（Telegram 式）
function setListOnly(on) {
  const list = !!on && state.isElectron;
  document.body.classList.toggle('list-only', list);
  if (!state.isElectron) return;
  setDesktopTitle('WMessage');
  // 等样式生效后再量宽度（否则会量到布局动画中被挤压的值）
  const send = () => {
    const side = $('#sidebar');
    const w = side ? Math.round(side.getBoundingClientRect().width) : 360;
    desktopCall('layout', { mode: list ? 'list' : 'chat', w });
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => requestAnimationFrame(send));
  else setTimeout(send, 32);
}

function enterApp() {
  // 桌面客户端：登录成功后切成系统窗口（尺寸由 setListOnly 统一驱动）
  setDesktopTitle('WMessage');
  desktopCall('expand');
  $app.innerHTML = appTemplate();
  state.rooms = [];
  state.cache.clear();
  bindAppEvents();
  renderUserChip();
  renderNotifyBtn();
  bindShellMessages();
  if (state.isMobile) { bindLongPress($('#roomList')); bindLongPress($('#messages')); }
  pushUnreadToShell();
  if (state.isMobile) {
    setMobileView('chats');
    renderMobilePanel();
  }
  // 界面动画偏好
  if (state.isElectron) document.body.classList.toggle('no-anim', !getAnim());
  // 图片存储始终可用
  state.uploadEnabled = true;
  const attach = $('#attachBtn');
  if (attach) attach.hidden = false;
  loadRooms();
  // 桌面端：刚进入主界面时未选中会话 → 只显示列表
  setListOnly(true);
}

/* ==================== 移动端面板（联系人/设置 tab） ==================== */
function renderMobilePanel() {
  const u = state.user;
  if (!u) return;
  const prof = $('#mProfile');
  if (prof) {
    prof.innerHTML = '';
    prof.append(
      avatarEl(u.nickname, u.avatarColor, 54),
      el('div', null,
        el('div', { class: 'mprofile-name' }, u.nickname),
        el('div', { class: 'mprofile-sub' }, '@' + u.username))
    );
  }
  const ver = $('#mVersion');
  if (ver) ver.textContent = String(window.APP_CONFIG.supabaseUrl || '').replace(/^https?:\/\//, '');
  renderMobileDmList();
}

function renderMobileDmList() {
  const list = $('#mDmList');
  if (!list) return;
  list.innerHTML = '';
  const dms = state.rooms.filter((r) => r.type === 'dm').sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0));
  if (!dms.length) {
    list.append(el('div', { class: 'empty-list' }, '还没有私聊，', el('br'), '搜索用户或从频道成员列表发起'));
    return;
  }
  list.append(el('div', { class: 'side-section' }, '私聊'));
  for (const r of dms) list.append(roomItem(r));
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
      el('div', { class: 'chip-name' }, richText(u.nickname)),
      el('div', { class: 'chip-sub' }, '@' + u.username)),
    el('div', { class: 'chip-out' }, '退出')
  );
}

function renderRooms() {
  const list = $('#roomList');
  if (!list) return;
  list.innerHTML = '';
  renderFolderTabs();
  if (!state.rooms.length) {
    list.append(el('div', { class: 'empty-list' }, '还没有会话', el('br'), '点右下角按钮新建或发现频道', el('br'), '也可以搜索用户发起私聊'));
    return;
  }
  const sort = (a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0) || (b.joinedAt || 0) - (a.joinedAt || 0);
  // 文件夹分页：全部 / 未读 / 已置顶；（置顶始终排最前）
  let pool = state.rooms.slice();
  if (state.folder === 'unread') {
    const unread = getUnread();
    pool = pool.filter((r) => (unread[r.id] || 0) > 0);
  } else if (state.folder === 'pinned') {
    pool = pool.filter((r) => r.pinned);
  }
  const pinned = pool.filter((r) => r.pinned).sort(sort);
  const rest = pool.filter((r) => !r.pinned);
  const channels = rest.filter((r) => r.type === 'channel').sort(sort);
  const dms = rest.filter((r) => r.type === 'dm').sort(sort);

  if (!pool.length) {
    list.append(el('div', { class: 'empty-list' }, '没有未读消息'));
    if (state.isMobile) renderMobileDmList();
    return;
  }

  const section = (title, rooms) => {
    if (!rooms.length) return null;
    const wrap = el('div');
    if (title) wrap.append(el('div', { class: 'side-section' }, title));
    for (const r of rooms) wrap.append(roomItem(r));
    return wrap;
  };
  const p = section('已置顶', pinned);
  const ch = section('频道', channels);
  const dm = section('私聊', dms);
  if (p) list.append(p);
  if (ch) list.append(ch);
  if (dm) list.append(dm);
  if (state.isMobile) renderMobileDmList();
}

// 侧栏文件夹分页（全部 / 未读 / 已置顶）
function renderFolderTabs() {
  const host = $('#sidebar');
  if (!host) return;
  if (!getFolders()) {
    const ex = document.getElementById('folderTabs');
    if (ex) ex.remove();
    return;
  }
  let bar = document.getElementById('folderTabs');
  if (!bar) {
    bar = el('div', { class: 'folders', id: 'folderTabs' });
    const head = host.querySelector('.side-head');
    if (head && head.nextSibling) host.insertBefore(bar, head.nextSibling);
    else host.prepend(bar);
  }
  const unread = getUnread();
  const unreadCount = state.rooms.reduce((n, r) => n + ((unread[r.id] || 0) > 0 ? 1 : 0), 0);
  const tabs = [
    { id: 'all', label: '全部' },
    { id: 'unread', label: unreadCount ? '未读 ' + unreadCount : '未读' },
    { id: 'pinned', label: '已置顶' },
  ];
  bar.innerHTML = '';
  for (const t of tabs) {
    const b = el('button', {
      type: 'button',
      class: 'folder-tab' + (state.folder === t.id ? ' active' : ''),
      onClick: () => { state.folder = t.id; renderRooms(); },
    }, t.label);
    bar.append(b);
  }
}

function roomItem(r) {
  const unread = getUnread()[r.id] || 0;
  const preview = r.lastMessage
    ? (r.lastMessageType === 'image' ? '[图片]' : r.lastMessage)
    : (r.type === 'channel' ? '点击进入频道' : '点击开始聊天');
  const item = el('div', {
    class: 'room-item'
      + (state.activeRoom && state.activeRoom.id === r.id ? ' active' : '')
      + (r.muted ? ' muted' : '')
      + (unread && !r.muted ? ' unread' : ''),
    dataset: { roomId: r.id },
  },
    roomAvatar(r),
    el('div', { class: 'room-info' },
      el('div', { class: 'room-name' },
        r.pinned ? icon('i-pin', 'ic ic-sm pin-ic') : null,
        richText(roomDisplayName(r))),
      el('div', { class: 'room-preview' }, richText(preview))),
    el('div', { class: 'room-meta' },
      el('div', { class: 'room-time' }, formatListTime(r.lastMessageAt)),
      r.muted ? icon('i-bell-off', 'ic ic-sm mute-ic') : null,
      unread ? el('div', { class: 'badge' }, unread > 99 ? '99+' : unread) : null)
  );
  item.addEventListener('click', () => openRoom(r));
  item.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    openRoomMenu(r, e.clientX, e.clientY);
  });
  return item;
}

/* ==================== 会话右键菜单（置顶 / 静音 / 清空） ==================== */

function openRoomMenu(room, x, y) {
  closeCtxMenu();
  const menu = el('div', { class: 'ctx-menu', id: 'ctxMenu' });
  const add = (label, iconId, fn, danger) => {
    const b = el('button', { type: 'button', class: danger ? 'danger' : '' }, icon(iconId), ' ' + label);
    b.addEventListener('click', async () => {
      closeCtxMenu();
      await fn();
    });
    menu.append(b);
  };
  add(room.pinned ? '取消置顶' : '置顶会话', 'i-pin', async () => {
    await api.setMemberFlag(room.id, { pinned: !room.pinned });
    room.pinned = !room.pinned;
    toast(room.pinned ? '已置顶' : '已取消置顶');
    renderRooms();
  });
  add(room.muted ? '取消静音' : '静音通知', room.muted ? 'i-bell' : 'i-bell-off', async () => {
    await api.setMemberFlag(room.id, { muted: !room.muted });
    room.muted = !room.muted;
    toast(room.muted ? '已静音' : '已取消静音');
    renderRooms();
  });
  add('清空聊天记录', 'i-trash', async () => {
    const ok = await confirmDialog({
      title: '清空聊天记录',
      text: '将清空「' + roomDisplayName(room) + '」的聊天记录（仅对你隐藏，其他成员不受影响）。',
      okLabel: '清空',
      cancelLabel: '取消',
    });
    if (!ok) return;
    await api.setMemberFlag(room.id, { cleared_at: new Date().toISOString() });
    room.clearedAt = Date.now();
    room.lastMessage = null;
    room.lastMessageAt = null;
    if (state.activeRoom && state.activeRoom.id === room.id) {
      roomCache(room.id).list = [];
      renderAllMessages(room.id);
    }
    renderRooms();
    toast('已清空聊天记录');
  });
  document.body.append(menu);
  placeMenu(menu, x, y);
}

/* ==================== 取消选中会话 ==================== */

function closeRoom() {
  if (!state.activeRoom) return;
  if (state.unsubRoom) {
    state.unsubRoom();
    state.unsubRoom = null;
  }
  state.activeRoom = null;
  state.roomInfo = null;
  state.members = [];
  state.online = [];
  state.replyTo = null;
  renderReplyBar();
  toggleChatSearch(false);
  closeCtxMenu();

  // 消息区与底部状态复位
  const msgs = $('#messages');
  if (msgs) msgs.innerHTML = '';
  const loadMore = $('#loadMore');
  if (loadMore) loadMore.hidden = true;
  const typing = $('#typing');
  if (typing) typing.textContent = '';
  const morePop = $('#morePop');
  if (morePop) morePop.hidden = true;
  const emojiPanel = $('#emojiPanel');
  if (emojiPanel) emojiPanel.classList.remove('open');
  state.emojiOpen = false;
  showEmpty('选择一个会话开始聊天');

  // 头部复位
  const title = $('#roomTitle');
  if (title) title.textContent = 'WMessage';
  const sub = $('#roomSub');
  if (sub) sub.textContent = '选择一个会话开始聊天';
  const av = $('#headAvatar');
  if (av) av.hidden = true;
  const memBtn = $('#membersBtn');
  if (memBtn) memBtn.hidden = true;
  const moreBtn = $('#moreBtn');
  if (moreBtn) moreBtn.hidden = true;
  const csBtn = $('#chatSearchBtn');
  if (csBtn) csBtn.hidden = true;
  const members = $('#members');
  if (members) members.classList.remove('show');

  if (state.isMobile) setChatOpen(false);
  renderRooms();
  setListOnly(true);       // 桌面端：收回成只显示会话列表
}

/* ==================== 打开会话 ==================== */

async function openRoom(room) {
  if (!room) return;
  // 点击已选中的会话 = 取消选中（桌面端收回成仅列表）
  if (state.activeRoom && state.activeRoom.id === room.id) {
    closeRoom();
    return;
  }
  if (state.unsubRoom) {
    state.unsubRoom();
    state.unsubRoom = null;
  }
  state.activeRoom = room;
  state.roomInfo = null;
  state.members = [];
  state.online = [];
  // 切换会话时重置搜索与回复状态
  state.replyTo = null;
  renderReplyBar();
  toggleChatSearch(false);
  setListOnly(false);
  resetUnread(room.id);
  renderRooms();
  pushUnreadToShell();
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
  api.getMembers(room.id).then((members) => {
    state.members = members || [];
    renderMembers();
    renderHeader();
  }).catch(() => {});
  if (state.isMobile) setChatOpen(true);
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
  state.ws = null;
  state.unsubRoom = api.subscribeRoom(roomId, (msg) => onIncomingMessage(msg));
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
    sub.textContent = '私聊';
  } else {
    sub.textContent = `${state.members.length} 名成员`;
  }
  const more = $('#moreBtn');
  if (more) {
    more.hidden = room.type !== 'channel';
    more.style.visibility = 'visible';
  }
  const mem = $('#membersBtn');
  if (mem) mem.hidden = false;
  const csBtn = $('#chatSearchBtn');
  if (csBtn) csBtn.hidden = false;

  // 头部头像（Telegram 风格：会话头像常驻标题左侧）
  const slot = $('#headAvatar');
  if (slot) {
    const label = room.type === 'dm' && room.partner ? room.partner.nickname : roomDisplayName(room);
    const color = room.type === 'dm' && room.partner && room.partner.avatarColor
      ? room.partner.avatarColor
      : (room.type === 'dm' ? '#4f7cff' : '#5288c1');
    slot.hidden = false;
    slot.textContent = String(label || '?').trim().charAt(0).toUpperCase() || '?';
    slot.style.background = color;
  }
}

function renderMembers() {
  const list = $('#membersList');
  if (!list) return;
  list.innerHTML = '';
  $('#membersSub').textContent = `${state.members.length} 人`;
  if (!state.members.length) {
    list.append(el('div', { class: 'empty-list' }, '暂无成员'));
    return;
  }
  for (const u of state.members) {
    const item = el('div', { class: 'member-item' },
      avatarEl(u.nickname, u.avatarColor, 34),
      el('div', { class: 'm-info' },
        el('div', { class: 'm-name' }, richText(u.nickname)),
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
    el('div', null,
      el('div', { class: 'big' }, icon('i-chat')),
      el('div', null, text))));
}

function imgSrc(path) {
  return path.startsWith('http') ? path : getApiBase() + path;
}

// 文本 → DOM：把内置表情替换为图片，其余按纯文本插入（安全，不使用 innerHTML）
function richText(text) {
  const frag = document.createDocumentFragment();
  for (const part of splitEmoji(text)) {
    if (part.emoji) {
      frag.append(el('img', { class: 'emoji-inline', src: emojiSrc(part.emoji), alt: part.emoji, draggable: 'false' }));
    } else if (part.text) {
      frag.append(document.createTextNode(part.text));
    }
  }
  return frag;
}

function buildMessageNode(msg, prevMsg) {
  const own = state.user && msg.userId === state.user.id;
  const grouped = !!(prevMsg && prevMsg.userId === msg.userId && prevMsg.type !== 'system' &&
    dayKey(prevMsg.createdAt) === dayKey(msg.createdAt) && msg.createdAt - prevMsg.createdAt < 5 * 60 * 1000);
  const wrap = el('div', {
    class: 'msg' + (own ? ' own' : '') + (grouped ? ' grouped' : '') + (msg.pending ? ' pending' : ''),
    dataset: { mid: msg.id, cid: msg.clientId || '' },
  });
  if (!grouped && !own) wrap.append(avatarEl(msg.nickname, msg.avatarColor, 36));
  const body = el('div', { class: 'msg-body' });
  // 引用块（回复）
  const replyBlock = msg.reply
    ? el('div', { class: 'reply-quote', onClick: () => jumpToMessage(msg.reply.id) },
        el('div', { class: 'rq-name' }, richText(msg.reply.nickname || '')),
        el('div', { class: 'rq-text' }, msg.reply.type === 'image' ? '[图片]' : richText(msg.reply.content || '')))
    : null;
  if (msg.type === 'image') {
    const img = el('img', { class: 'msg-img', src: imgSrc(msg.content), alt: '图片', loading: 'lazy' });
    img.addEventListener('click', () => lightbox(imgSrc(msg.content)));
    const bubble = el('div', { class: 'bubble media' }, img, el('span', { class: 'bubble-time' }, formatTime(msg.createdAt)));
    if (replyBlock) body.append(el('div', { class: 'bubble wrap-quote' }, replyBlock));
    body.append(bubble);
  } else {
    const bubble = el('div', { class: 'bubble' });
    if (!own && state.activeRoom && state.activeRoom.type === 'channel' && !grouped) {
      bubble.append(el('div', { class: 'bubble-name' }, richText(msg.nickname || '')));
    }
    if (replyBlock) bubble.append(el('div', { class: 'bubble-quote' }, replyBlock));
    bubble.append(el('div', { class: 'bubble-text' }, richText(msg.content)));
    bubble.append(el('span', { class: 'bubble-time' }, formatTime(msg.createdAt)));
    body.append(bubble);
  }
  wrap.append(body);
  wrap.addEventListener('contextmenu', (e) => {
    if (e.target.closest('.msg-img')) return;   // 图片右键留给浏览器/图片查看
    e.preventDefault();
    openMessageMenu(msg, own, e.clientX, e.clientY);
  });
  return wrap;
}

// 消息右键菜单：回复 / 转发 / 复制 / 删除（Telegram 式）
function openMessageMenu(msg, own, x, y) {
  closeCtxMenu();
  const menu = el('div', { class: 'ctx-menu', id: 'ctxMenu' });
  const add = (label, iconId, fn, danger) => {
    const b = el('button', { type: 'button', class: danger ? 'danger' : '' }, icon(iconId), ' ' + label);
    b.addEventListener('click', () => { closeCtxMenu(); fn(); });
    menu.append(b);
  };
  add('回复', 'i-reply', () => startReply(msg));
  add('转发', 'i-forward', () => openForwardModal(msg));
  add('复制文本', 'i-copy', () => {
    navigator.clipboard?.writeText(msg.content || '')
      .then(() => toast('已复制'), () => toast('复制失败', 'error'));
  });
  if (own) add('删除消息', 'i-trash', () => confirmDeleteMessage(msg), true);
  document.body.append(menu);
  placeMenu(menu, x, y);
}

function placeMenu(menu, x, y) {
  const rect = menu.getBoundingClientRect();
  menu.style.left = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8)) + 'px';
  menu.style.top = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8)) + 'px';
  setTimeout(() => {
    const off = (ev) => {
      if (!menu.contains(ev.target)) { closeCtxMenu(); document.removeEventListener('mousedown', off); }
    };
    document.addEventListener('mousedown', off);
  }, 0);
}

function closeCtxMenu() {
  const m = document.getElementById('ctxMenu');
  if (m) m.remove();
}

function startReply(msg) {
  state.replyTo = msg;
  renderReplyBar();
  const host = $('#input');
  if (host) host.focus();
}

function renderReplyBar() {
  const foot = document.querySelector('.composer');
  if (!foot) return;
  let bar = document.getElementById('replyBar');
  if (!state.replyTo) {
    if (bar) bar.remove();
    return;
  }
  if (!bar) {
    bar = el('div', { class: 'reply-bar', id: 'replyBar' });
    foot.parentNode.insertBefore(bar, foot);
  }
  bar.innerHTML = '';
  bar.append(
    el('div', { class: 'rb-info' },
      el('div', { class: 'rb-name' }, '回复 ' + (state.replyTo.nickname || '')),
      el('div', { class: 'rb-text' }, state.replyTo.type === 'image' ? '[图片]' : richText((state.replyTo.content || '').slice(0, 80)))),
    el('button', { type: 'button', class: 'icon-btn', title: '取消回复', onClick: () => { state.replyTo = null; renderReplyBar(); } },
      icon('i-close')));
}

async function confirmDeleteMessage(msg) {
  const ok = await confirmDialog({ title: '删除消息', text: '确定删除这条消息吗？删除后对其他成员同样不可见。', okLabel: '删除', cancelLabel: '取消' });
  if (!ok) return;
  try {
    await api.deleteMessage(msg.id);
    const c = roomCache(msg.roomId);
    c.list = c.list.filter((m) => m.id !== msg.id);
    const node = document.querySelector('.msg[data-mid="' + CSS.escape(msg.id) + '"]');
    if (node) node.remove();
    toast('已删除');
  } catch (e) {
    toast(e.message || '删除失败', 'error');
  }
}

function jumpToMessage(id) {
  const node = document.querySelector('.msg[data-mid="' + CSS.escape(id) + '"]');
  if (!node) return toast('原消息不在当前视图');
  node.scrollIntoView({ block: 'center', behavior: 'smooth' });
  node.classList.add('flash');
  setTimeout(() => node.classList.remove('flash'), 1200);
}

/* ==================== 聊天内搜索 ==================== */

function toggleChatSearch(force) {
  const bar = $('#chatSearch');
  if (!bar) return;
  const show = force === undefined ? bar.hidden : !!force;
  bar.hidden = !show;
  const inp = $('#chatSearchInput');
  if (show && inp) { inp.value = ''; inp.focus(); }
  applyChatSearch('');
}

// 在当前会话内过滤消息：仅保留命中项并计数
function applyChatSearch(q) {
  state.chatQuery = q || '';
  const msgs = $('#messages');
  const counter = $('#chatSearchCount');
  if (!msgs) return;
  const nodes = msgs.querySelectorAll('.msg');
  if (!state.chatQuery) {
    nodes.forEach((n) => { n.hidden = false; n.classList.remove('hit'); });
    if (counter) counter.textContent = '';
    return;
  }
  const needle = state.chatQuery.toLowerCase();
  let hits = 0;
  nodes.forEach((n) => {
    const body = n.querySelector('.bubble-text');
    const text = body ? body.textContent : '';
    const hit = text.toLowerCase().includes(needle);
    n.hidden = !hit;
    n.classList.toggle('hit', hit);
    if (hit) hits++;
  });
  if (counter) counter.textContent = hits ? hits + ' 条' : '无结果';
}

// 转发：选择目标会话后发送
function openForwardModal(msg) {
  const body = el('div', { class: 'modal-list' });
  const rooms = state.rooms.filter((r) => r.id !== msg.roomId);
  if (!rooms.length) {
    body.append(el('div', { class: 'empty-list' }, '暂无可转发的其他会话'));
  }
  const m = modal({ title: '转发到', body });
  for (const r of rooms) {
    const row = el('div', { class: 'modal-row' },
      avatarEl(r.type === 'dm' && r.partner ? r.partner.nickname : r.name, r.type === 'dm' && r.partner ? r.partner.avatarColor : '#5288c1', 34),
      el('div', { class: 'grow' },
        el('div', { class: 'name' }, richText(roomDisplayName(r))),
        el('div', { class: 'desc' }, r.type === 'dm' ? '私聊' : '频道')));
    row.addEventListener('click', async () => {
      m.close();
      try {
        const sent = await api.sendMessage({
          roomId: r.id, userId: state.user.id, clientId: 'f' + Date.now() + Math.random().toString(36).slice(2, 6),
          type: 'text', content: (msg.type === 'image' ? '[图片] ' : '') + (msg.content || ''),
        });
        toast('已转发到 ' + roomDisplayName(r));
        if (state.activeRoom && state.activeRoom.id === sent.roomId) {
          roomCache(sent.roomId).list.push(sent);
          appendMessageNode(sent);
        }
      } catch (e) {
        toast(e.message || '转发失败', 'error');
      }
    });
    body.append(row);
  }
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
  if (!room) return;
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
    const room = state.rooms.find((r) => r.id === msg.roomId);
    if (!room || !room.muted) notify(msg);
    pushUnreadToShell();
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
  api.sendMessage(msg).catch((e) => {
    toast(e.message || '发送失败', 'error');
    const p = state.pending.get(clientId);
    if (p) {
      const idx = c.list.findIndex((x) => x.id === clientId);
      if (idx >= 0) c.list.splice(idx, 1);
      state.pending.delete(clientId);
      if (state.activeRoom && state.activeRoom.id === room.id) renderAllMessages(room.id);
    }
  });
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
      grid.append(el('button', { type: 'button', class: 'emoji-btn', title: e, onClick: () => insertEmoji(e) },
        el('img', { class: 'emoji-img', src: emojiSrc(e), alt: e, loading: 'lazy', draggable: 'false' })));
    }
    p.append(grid);
  }
  p.classList.add('open');
  state.emojiOpen = true;
}

/* ==================== 输入区（富文本：内置表情以图片显示） ==================== */

// 读取输入区纯文本（表情图片还原为字符）
function inputText() {
  const host = $('#input');
  if (!host) return '';
  let out = '';
  const walk = (n) => {
    for (const c of n.childNodes) {
      if (c.nodeType === 3) out += c.nodeValue;
      else if (c.nodeName === 'IMG') out += c.getAttribute('data-emoji') || c.getAttribute('alt') || '';
      else if (c.nodeName === 'BR') out += '\n';
      else walk(c);
    }
  };
  walk(host);
  return out;
}

// 清空 / 回填输入区
function setInputText(text) {
  const host = $('#input');
  if (!host) return;
  host.innerHTML = '';
  if (text) host.append(richText(text));
  autosizeInput();
}

// 在光标处插入表情图片（保持光标位置）
function insertEmoji(emoji) {
  const host = $('#input');
  if (!host) return;
  host.focus();
  const sel = window.getSelection();
  let range = null;
  if (sel && sel.rangeCount && host.contains(sel.anchorNode)) range = sel.getRangeAt(0);
  if (!range) {
    range = document.createRange();
    range.selectNodeContents(host);
    range.collapse(false);
  }
  range.deleteContents();
  const img = el('img', { class: 'emoji-inline', src: emojiSrc(emoji), alt: emoji, draggable: 'false' });
  img.setAttribute('data-emoji', emoji);
  range.insertNode(img);
  range.setStartAfter(img);
  range.collapse(true);
  if (sel) { sel.removeAllRanges(); sel.addRange(range); }
  autosizeInput();
}

function autosizeInput() {
  const host = $('#input');
  if (!host) return;
  host.style.height = 'auto';
  host.style.height = Math.min(host.scrollHeight, 132) + 'px';
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

function bindSearch(inputSel = '#searchInput', popSel = '#searchPop') {
  const input = $(inputSel);
  const pop = $(popSel);
  if (!input || !pop) return;
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
              el('div', { class: 'room-name' }, richText(u.nickname)),
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
    if (state.isMobile) setMobileView('chats');
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
              if (state.unsubRoom) {
                state.unsubRoom();
                state.unsubRoom = null;
              }
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
  const on = notifyEnabled();
  const btn = $('#notifyBtn');
  if (btn) {
    // 开启/关闭用不同图标 + 不同颜色区分（铃铛 / 划线铃铛）
    const use = btn.querySelector('use');
    if (use) use.setAttribute('href', on ? '#i-bell' : '#i-bell-off');
    btn.classList.toggle('notify-on', on);
    btn.classList.toggle('notify-off', !on);
    btn.title = state.isElectron
      ? (on ? '通知已开启（点击静音）' : '通知已静音（点击开启）')
      : (on ? '桌面通知已开启' : '桌面通知已关闭');
  }
  const mIcon = $('#mNotifyBtn use');
  if (mIcon) mIcon.setAttribute('href', on ? '#i-bell' : '#i-bell-off');
  const st = $('#mNotifyState');
  if (st) {
    st.textContent = on ? '已开启' : '已静音';
    st.classList.toggle('on', on);
    st.classList.toggle('off', !on);
  }
}

// 桌面端由外壳发系统通知，不需要浏览器授权；网页端沿用 Notification 权限
function notifyEnabled() {
  return getNotify(state.isElectron);
}

function toggleNotify() {
  // 桌面端：原生应用语义，不需要"通知权限"，只是开启/静音
  if (state.isElectron) {
    const on = !notifyEnabled();
    setNotify(on);
    renderNotifyBtn();
    toast(on ? '已开启通知' : '已静音通知');
    return;
  }
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
  if (!notifyEnabled()) return;
  if (document.visibilityState === 'visible' && state.activeRoom && state.activeRoom.id === msg.roomId) return;
  const title = msg.nickname || '新消息';
  const body = msg.type === 'image' ? '[图片]' : (msg.content || '').slice(0, 120);
  if (getSound()) playPing();
  // 安卓端：走系统通知栏（点击通知回到对应会话）
  if (isAndroidApp()) {
    androidNotify(title, body, msg.roomId);
    return;
  }
  // 桌面端：交给外壳发 Windows 通知（点击通知可直接打开该会话）
  if (state.isElectron) {
    desktopCall('notify', { title, body, roomId: msg.roomId });
    return;
  }
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const n = new Notification(title, {
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

// 新消息提示音（Web Audio 合成，无需音频文件）
let _audioCtx = null;
function playPing() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!_audioCtx) _audioCtx = new AC();
    const ctx = _audioCtx;
    if (ctx.state === 'suspended') ctx.resume();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.exponentialRampToValueAtTime(1320, now + 0.08);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.14, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(now); osc.stop(now + 0.34);
  } catch { /* 静默失败 */ }
}
// 未读总数同步到系统托盘提示
function pushUnreadToShell() {
  if (!state.isElectron) return;
  const all = getUnread();
  let n = 0;
  for (const k in all) n += all[k] || 0;
  desktopCall('unread', { n });
}

// 接收外壳消息（如点击系统通知后打开对应会话）
function bindShellMessages() {
  if (!(window.chrome && window.chrome.webview && window.chrome.webview.addEventListener)) return;
  window.chrome.webview.addEventListener('message', (ev) => {
    const d = (ev && ev.data) || {};
    if (d.action === 'openRoom' && d.roomId) {
      const room = state.rooms.find((r) => r.id === d.roomId);
      if (room) openRoom(room);
    }
  });
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
  // 侧栏汉堡菜单（Telegram 式）
  const menuBtn = $('#sideMenuBtn');
  const menu = $('#sideMenu');
  if (menuBtn && menu) {
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.hidden = !menu.hidden;
    });
    menu.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      menu.hidden = true;
      const act = btn.dataset.act;
      if (act === 'new') openNewChannelModal();
      else if (act === 'discover') openDiscoverModal();
      else if (act === 'settings') openSettingsWindow();
      else if (act === 'logout') logout();
    });
    document.addEventListener('click', (e) => {
      if (!menu.hidden && !menu.contains(e.target)) menu.hidden = true;
    });
  }

  // 设置页

  $('#userChip').addEventListener('click', () => logout());
  $('#newChannelBtn').addEventListener('click', () => { $('#fabPop').hidden = true; openNewChannelModal(); });
  $('#discoverBtn').addEventListener('click', () => { $('#fabPop').hidden = true; openDiscoverModal(); });
  bindSearch('#searchInput', '#searchPop');

  // 悬浮"新建"按钮（Telegram 右下角铅笔）
  const fab = $('#fabBtn');
  const fabPop = $('#fabPop');
  if (fab && fabPop) {
    fab.addEventListener('click', (e) => {
      e.stopPropagation();
      fabPop.hidden = !fabPop.hidden;
    });
    document.addEventListener('click', (e) => {
      if (!fabPop.hidden && !fabPop.contains(e.target)) fabPop.hidden = true;
    });
  }

  // 移动端：底部导航（会话 / 设置）
  const tabBar = $('#tabBar');
  if (tabBar) {
    tabBar.addEventListener('click', (e) => {
      const btn = e.target.closest('.tab-item');
      if (btn) setMobileTab(btn.dataset.tab);
    });
  }
  const mContactsBack = $('#mContactsBack');
  if (mContactsBack) mContactsBack.addEventListener('click', closeMobileContacts);
  const mSearchToggle = $('#mSearchToggle');
  if (mSearchToggle) {
    mSearchToggle.addEventListener('click', () => {
      const inp = $('#searchInput');
      if (inp) { inp.focus(); inp.select && inp.select(); }
    });
  }
  bindSearch('#mSearchInput', '#mSearchPop');
  const mDiscover = $('#mDiscoverBtn');
  if (mDiscover) mDiscover.addEventListener('click', openDiscoverModal);
  const mNotify = $('#mNotifyBtn');
  if (mNotify) mNotify.addEventListener('click', toggleNotify);
  const mLogout = $('#mLogoutBtn');
  if (mLogout) mLogout.addEventListener('click', () => logout());

  // 返回按钮：移动端=退出聊天回列表；桌面/窄窗=打开侧栏
  $('#backBtn').addEventListener('click', () => {
    if (state.isMobile && document.body.classList.contains('chat-open')) {
      setChatOpen(false);
      return;
    }
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

  // 聊天内搜索
  const csBtn = $('#chatSearchBtn');
  if (csBtn) csBtn.addEventListener('click', () => toggleChatSearch());
  const csInput = $('#chatSearchInput');
  if (csInput) {
    csInput.addEventListener('input', () => applyChatSearch(csInput.value.trim()));
    csInput.addEventListener('keydown', (e) => { if (e.key === 'Escape') toggleChatSearch(false); });
  }
  const csClose = $('#chatSearchClose');
  if (csClose) csClose.addEventListener('click', () => toggleChatSearch(false));

  // 输入区（富文本编辑区：表情以图片内嵌）
  const input = $('#input');
  input.addEventListener('input', autosizeInput);
  input.addEventListener('keydown', (e) => {
    // Enter 发送 / Ctrl+Enter 发送，可在设置-高级中切换
    const withMod = e.ctrlKey || e.metaKey;
    const wantSend = getEnterSend() ? (e.key === 'Enter' && !e.shiftKey) : (e.key === 'Enter' && withMod);
    if (wantSend) {
      e.preventDefault();
      doSend();
      return;
    }
    if (!getEnterSend() && e.key === 'Enter' && !withMod) {
      e.preventDefault();
      document.execCommand('insertLineBreak');
    }
  });
  input.addEventListener('paste', (e) => {
    const files = e.clipboardData && e.clipboardData.files;
    if (files && files.length && files[0].type.startsWith('image/')) {
      e.preventDefault();
      uploadFile(files[0]);
      return;
    }
    // 纯文本粘贴，避免带入外部样式
    const text = e.clipboardData && e.clipboardData.getData('text/plain');
    if (text != null) {
      e.preventDefault();
      document.execCommand('insertText', false, text);
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
  const text = inputText();
  if (!text.trim()) return;
  setInputText('');
  const reply = state.replyTo;
  state.replyTo = null;
  renderReplyBar();
  sendMessage('text', text, reply);
  const host = $('#input');
  if (host) host.focus();
}

/* ==================== 设置（独立窗口） ==================== */

// 在独立窗口中打开设置（桌面端由外壳创建原生窗口，网页端为浏览器弹窗）
function openSettingsWindow() {
  if (state.isElectron) {
    desktopCall('openSettings');
    return;
  }
  const w = Math.min(980, Math.round(window.screen.availWidth * 0.7));
  const h = Math.min(700, Math.round(window.screen.availHeight * 0.8));
  const left = Math.round((window.screen.availWidth - w) / 2);
  const top = Math.round((window.screen.availHeight - h) / 2);
  const win = window.open('./settings.html', 'wmessage-settings',
    'width=' + w + ',height=' + h + ',left=' + left + ',top=' + top + ',resizable=yes,scrollbars=no');
  if (win) win.focus();
  else toast('设置窗口被浏览器拦截，请允许弹出窗口', 'error');
}
/* ==================== 移动端：底部导航 ==================== */

// 底部导航：会话 / 设置（设置打开独立设置页，与 Telegram 的底部标签一致）
function setMobileTab(tab) {
  state.mobileTab = tab;
  const bar = $('#tabBar');
  if (bar) bar.querySelectorAll('.tab-item').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  if (tab === 'settings') { location.href = './settings.html'; return; }
  document.body.classList.remove('mtab-contacts');
}

function openMobileContacts() {
  document.body.classList.add('mtab-contacts');
  renderMobileDmList();
}

function closeMobileContacts() {
  document.body.classList.remove('mtab-contacts');
}
/* ==================== 移动端长按 ==================== */

// 安卓端长按 = 右键：长按会话/消息弹出操作菜单
function bindLongPress(host) {
  let timer = null;
  let moved = false;
  host.addEventListener('touchstart', (e) => {
    const roomEl = e.target.closest('.room-item');
    const msgEl = e.target.closest('.msg');
    if (!roomEl && !msgEl) return;
    moved = false;
    const t = e.touches[0];
    timer = setTimeout(() => {
      if (moved) return;
      const x = t.clientX;
      const y = t.clientY;
      if (msgEl) {
        const mid = msgEl.dataset.mid;
        const c = state.activeRoom ? roomCache(state.activeRoom.id) : null;
        const msg = c && c.list.find((m) => m.id === mid);
        if (msg) {
          const own = state.user && msg.userId === state.user.id;
          openMessageMenu(msg, own, x, y);
        }
      } else if (roomEl) {
        const room = state.rooms.find((r) => r.id === roomEl.dataset.roomId);
        if (room) openRoomMenu(room, x, y);
      }
      if (navigator.vibrate) { try { navigator.vibrate(18); } catch { /* 忽略 */ } }
    }, 480);
  }, { passive: true });
  const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
  host.addEventListener('touchmove', () => { moved = true; cancel(); }, { passive: true });
  host.addEventListener('touchend', cancel, { passive: true });
  host.addEventListener('touchcancel', cancel, { passive: true });
}

/* ==================== 安卓原生桥 ==================== */

function isAndroidApp() {
  return !!(window.wmessageNative && window.wmessageNative.notify);
}

// 安卓端通知走系统通知栏（与桌面端的系统通知一致）
function androidNotify(title, body, roomId) {
  try { window.wmessageNative.notify(title, body, roomId || ''); } catch { /* 忽略 */ }
}

// 安卓返回键：返回 'handled' 表示页面已处理，否则由系统退出
window.wmessageAndroidBack = function () {
  const anyMenu = document.getElementById('ctxMenu');
  if (anyMenu) { closeCtxMenu(); return 'handled'; }
  if ($('#emojiPanel') && $('#emojiPanel').classList.contains('open')) { toggleEmojiPanel(); return 'handled'; }
  if ($('#chatSearch') && !$('#chatSearch').hidden) { toggleChatSearch(false); return 'handled'; }
  if (state.replyTo) { state.replyTo = null; renderReplyBar(); return 'handled'; }
  if (state.isMobile && document.body.classList.contains('mtab-settings')) {
    if (state.mSettingSection) { state.mSettingSection = null; renderMobileSettings(); return 'handled'; }
    setMobileTab('chats');
    return 'handled';
  }
  if (state.isMobile && document.body.classList.contains('mtab-contacts')) { setMobileTab('chats'); return 'handled'; }
  if (state.activeRoom) { closeRoom(); return 'handled'; }
  return 'pass';
};

// 从通知进入：打开对应会话
window.wmessageAndroidOpenRoom = function (roomId) {
  const room = state.rooms.find((r) => r.id === roomId);
  if (room) openRoom(room);
};

/* ==================== 退出 ==================== */

async function logout(reason = '') {
  if (!reason) {
    // 自绘确认框：任何异常都不能阻塞退出
    let ok = true;
    try {
      ok = await confirmDialog({
        title: '退出登录',
        text: '确定要退出当前账号吗？',
        okLabel: '退出登录',
        cancelLabel: '取消',
      });
    } catch (e) { ok = true; }
    if (!ok) return;
  }
  // 不等待服务端登出（网络慢时会表现为按钮没反应），本地立即清除并回登录页
  try { api.signOut(); } catch (e) { /* 忽略 */ }
  clearAuth();
  if (state.unsubRoom) {
    state.unsubRoom();
    state.unsubRoom = null;
  }
  state.rooms = [];
  state.cache.clear();
  state.activeRoom = null;
  state.user = null;
  // 退出后回到独立登录页
  location.replace('./login.html');
  if (reason) toast(reason, 'error');
}

/* ==================== 启动 ==================== */
boot();











