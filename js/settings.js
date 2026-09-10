// WMessage 设置窗口（独立页面：由主界面"设置"打开）
import { getToken, getUser, setUser, clearAuth, getNotify, setNotify } from './store.js';
import * as api from './supabase.js';
import { $, el, icon, toast, modal, confirmDialog, avatarEl } from './ui.js';
import { EMOJIS, emojiSrc, splitEmoji } from './emoji.js';

const state = { user: null, section: 'profile', isElectron: false };

/* ==================== 平台与壳通信 ==================== */
function detectPlatform() {
  const isWebView2 = !!(window.chrome && window.chrome.webview) && location.hostname === 'app.local';
  state.isElectron = isOwnDesktop(isWebView2);
  document.documentElement.classList.add(state.isElectron ? 'theme-desktop' : 'theme-web');
}
function isOwnDesktop(isWebView2) {
  return isWebView2 || !!(window.desktop && window.desktop.isDesktop);
}
function desktopCall(action, payload) {
  if (window.chrome && window.chrome.webview) {
    try { window.chrome.webview.postMessage(Object.assign({ action }, payload || {})); } catch { /* 忽略 */ }
  }
}

/* ==================== 文本渲染（内置表情） ==================== */
function richText(text) {
  const frag = document.createDocumentFragment();
  for (const part of splitEmoji(text)) {
    if (part.emoji) frag.append(el('img', { class: 'emoji-inline', src: emojiSrc(part.emoji), alt: part.emoji, draggable: 'false' }));
    else if (part.text) frag.append(document.createTextNode(part.text));
  }
  return frag;
}

/* ==================== 分区 ==================== */
const SECTIONS = [
  { id: 'profile', icon: 'i-members', label: '编辑资料' },
  { id: 'notify', icon: 'i-bell', label: '通知和声音' },
  { id: 'security', icon: 'i-info', label: '隐私与安全' },
  { id: 'data', icon: 'i-info', label: '数据与存储' },
  { id: 'about', icon: 'i-info', label: '关于' },
];

function render() {
  const list = $('#setList');
  const pane = $('#setPane');
  const head = $('#setHead');
  const s = SECTIONS.find((x) => x.id === state.section) || SECTIONS[0];
  head.textContent = s.label;

  // 左侧资料块
  const prof = $('#setProfile');
  const u = state.user || {};
  prof.innerHTML = '';
  prof.append(
    avatarEl(u.nickname, u.avatarColor, 48),
    el('div', { class: 'sp-info' },
      el('div', { class: 'sp-name' }, richText(u.nickname || '')),
      el('div', { class: 'sp-sub' }, '@' + (u.username || ''))));

  // 分区列表
  list.innerHTML = '';
  for (const item of SECTIONS) {
    list.append(el('button', {
      type: 'button',
      class: 'set-item' + (item.id === state.section ? ' active' : ''),
      onClick: () => { state.section = item.id; render(); },
    }, icon(item.icon), ' ' + item.label));
  }

  pane.innerHTML = '';
  if (state.section === 'profile') renderProfile(pane);
  else if (state.section === 'notify') renderNotify(pane);
  else if (state.section === 'security') renderSecurity(pane);
  else if (state.section === 'data') renderData(pane);
  else renderAbout(pane);
}

function field(label, value, opts = {}) {
  const wrap = el('div', { class: 'set-field' }, el('label', null, label));
  const input = el('input', {
    type: opts.type || 'text',
    value: value == null ? '' : value,
    placeholder: opts.placeholder || '',
    maxlength: opts.maxlength || 40,
  });
  if (opts.readonly) input.setAttribute('readonly', 'readonly');
  wrap.append(input);
  if (opts.hint) wrap.append(el('div', { class: 'set-hint' }, opts.hint));
  return { wrap, input };
}

function renderProfile(pane) {
  const u = state.user || {};
  const nick = field('昵称', u.nickname || '', { placeholder: '显示名称' });
  pane.append(el('div', { class: 'set-group' },
    el('div', { class: 'set-group-title' }, '账号'),
    nick.wrap,
    field('用户名', u.username || '', { readonly: true, hint: '用户名用于登录，注册后不可修改' }).wrap,
    field('邮箱', u.email || '', { readonly: true, hint: '邮箱用于登录与找回账号' }).wrap));

  const colors = ['#4f7cff', '#8b5cf6', '#34d399', '#f59e0b', '#ef4444', '#ec4899', '#14b8a6', '#6366f1'];
  let picked = u.avatarColor || colors[0];
  const swatches = el('div', { class: 'set-colors' });
  for (const c of colors) {
    const dot = el('button', { type: 'button', class: 'set-color' + (c === picked ? ' active' : ''), style: 'background:' + c });
    dot.addEventListener('click', () => {
      picked = c;
      swatches.querySelectorAll('.set-color').forEach((n) => n.classList.toggle('active', n === dot));
    });
    swatches.append(dot);
  }
  pane.append(el('div', { class: 'set-group' }, el('div', { class: 'set-group-title' }, '头像颜色'), swatches));

  const save = el('button', { type: 'button', class: 'btn btn-primary set-save' }, '保存');
  save.addEventListener('click', async () => {
    save.disabled = true;
    try {
      const { user } = await api.updateProfile({ nickname: nick.input.value, avatarColor: picked });
      if (user) { state.user = user; setUser(user); }
      toast('资料已保存');
      render();
    } catch (e) {
      toast(e.message || '保存失败', 'error');
    } finally {
      save.disabled = false;
    }
  });
  pane.append(save);
}

function renderNotify(pane) {
  const on = getNotify(state.isElectron);
  const row = el('div', { class: 'set-row' },
    el('div', { class: 'set-row-main' },
      el('div', { class: 'set-row-title' }, '消息通知'),
      el('div', { class: 'set-row-sub' }, state.isElectron
        ? '通过 Windows 系统通知提醒新消息，点击通知可直达会话'
        : '通过浏览器通知提醒新消息')),
    el('button', {
      type: 'button',
      class: 'switch' + (on ? ' on' : ''),
      title: on ? '点击静音' : '点击开启',
      onClick: () => { setNotify(!on); render(); toast(!on ? '已开启通知' : '已静音通知'); },
    }, el('span', { class: 'knob' })));
  pane.append(el('div', { class: 'set-group' }, row,
    el('div', { class: 'set-row' },
      el('div', { class: 'set-row-main' },
        el('div', { class: 'set-row-title' }, '单个会话静音'),
        el('div', { class: 'set-row-sub' }, '在会话列表右键即可单独静音某个会话')))));
  if (!state.isElectron) {
    pane.append(el('div', { class: 'set-note' }, '浏览器通知需要授权。若系统已禁止通知，请在浏览器设置中允许本站通知。'));
  }
}

function renderSecurity(pane) {
  const cur = field('当前密码', '', { type: 'password', placeholder: '输入当前密码' });
  const nxt = field('新密码', '', { type: 'password', placeholder: '至少 6 位' });
  pane.append(el('div', { class: 'set-group' },
    el('div', { class: 'set-group-title' }, '修改密码'),
    cur.wrap, nxt.wrap));
  const btn = el('button', { type: 'button', class: 'btn btn-primary set-save' }, '修改密码');
  btn.addEventListener('click', async () => {
    if ((nxt.input.value || '').length < 6) return toast('新密码至少 6 位', 'error');
    btn.disabled = true;
    try {
      await api.changePassword({ current: cur.input.value, next: nxt.input.value });
      cur.input.value = '';
      nxt.input.value = '';
      toast('密码已修改');
    } catch (e) {
      toast(e.message || '修改失败', 'error');
    } finally {
      btn.disabled = false;
    }
  });
  pane.append(btn);
  pane.append(el('div', { class: 'set-note' }, '修改密码后，其他设备上的登录状态可能失效，需要重新登录。'));
}

function renderData(pane) {
  const clear = el('div', { class: 'set-row set-row-btn' },
    el('div', { class: 'set-row-main' },
      el('div', { class: 'set-row-title' }, '清除本地登录记录'),
      el('div', { class: 'set-row-sub' }, '清除本机保存的登录状态与上次登录账号')),
    el('span', { class: 'set-row-arrow' }, '›'));
  clear.addEventListener('click', async () => {
    const ok = await confirmDialog({ title: '清除登录记录', text: '将退出登录并清除本机保存的账号信息，确定继续吗？', okLabel: '清除', cancelLabel: '取消' });
    if (!ok) return;
    try { localStorage.removeItem('wmessage_last_account'); } catch { /* 忽略 */ }
    clearAuth();
    toast('已清除登录记录');
    setTimeout(() => { location.href = './login.html'; }, 600);
  });
  pane.append(el('div', { class: 'set-group' }, clear,
    el('div', { class: 'set-row' },
      el('div', { class: 'set-row-main' },
        el('div', { class: 'set-row-title' }, '消息记录'),
        el('div', { class: 'set-row-sub' }, '聊天记录保存在账号中，换设备登录后自动同步')))));
}

function renderAbout(pane) {
  pane.append(el('div', { class: 'set-group' },
    el('div', { class: 'set-row' },
      el('div', { class: 'set-row-main' },
        el('div', { class: 'set-row-title' }, 'WMessage'),
        el('div', { class: 'set-row-sub' }, '轻快 · 私密 · 安全'))),
    el('div', { class: 'set-row' },
      el('div', { class: 'set-row-main' },
        el('div', { class: 'set-row-title' }, '版本'),
        el('div', { class: 'set-row-sub' }, '1.0.0')))));
}

/* ==================== 事件 ==================== */
function bind() {
  const out = $('#setLogout');
  if (out) {
    out.addEventListener('click', async () => {
      const ok = await confirmDialog({ title: '退出登录', text: '确定要退出当前账号吗？', okLabel: '退出登录', cancelLabel: '取消' });
      if (!ok) return;
      clearAuth();
      location.href = './login.html';
    });
  }
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (state.isElectron) desktopCall('close');
      else window.close();
    }
  });
  // 主题色条随窗口变化
  window.addEventListener('resize', () => { /* 布局自适应，无需处理 */ });
}

/* ==================== 启动 ==================== */
(async function boot() {
  detectPlatform();
  if (!getToken() || !getUser()) {
    location.replace('./login.html');
    return;
  }
  try {
    const { user } = await api.me();
    state.user = user;
    setUser(user);
  } catch (e) {
    location.replace('./login.html');
    return;
  }
  bind();
  render();
})();
