// 本地状态存储（localStorage）
const K = {
  token: 'wmessage_token',
  user: 'wmessage_user',
  api: 'wmessage_api_base',
  unread: 'wmessage_unread',
  notify: 'wmessage_notify',
  last: 'wmessage_last_account',
  sound: 'wmessage_sound',
  folders: 'wmessage_folders',
  enterSend: 'wmessage_enter_send',
  anim: 'wmessage_anim',
};

function read(key, def) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? def : JSON.parse(v);
  } catch {
    return def;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 忽略 */
  }
}

export function getApiBase() {
  const custom = (localStorage.getItem(K.api) || '').replace(/\/+$/, '');
  if (custom) return custom;
  return String(window.APP_CONFIG.apiBase || 'https://example.com').replace(/\/+$/, '');
}

export function setApiBase(v) {
  localStorage.setItem(K.api, v.trim().replace(/\/+$/, ''));
}

export const getToken = () => read(K.token, '');
export const setToken = (t) => write(K.token, t);
export const getUser = () => read(K.user, null);
export const setUser = (u) => write(K.user, u);
export function clearAuth() {
  localStorage.removeItem(K.token);
  localStorage.removeItem(K.user);
}

export const getUnread = () => read(K.unread, {});
export function bumpUnread(roomId) {
  const u = getUnread();
  u[roomId] = (u[roomId] || 0) + 1;
  write(K.unread, u);
}
export function resetUnread(roomId) {
  const u = getUnread();
  if (u[roomId]) {
    delete u[roomId];
    write(K.unread, u);
  }
}

export const getNotify = (d = false) => read(K.notify, d);
export const setNotify = (v) => write(K.notify, v);

/* 登录记录：记住上次登录的账号，支持一键登录 / 清除记录 */
export const getLastAccount = () => read(K.last, null);
export const setLastAccount = (v) => write(K.last, v);
export function clearLastAccount() {
  localStorage.removeItem(K.last);
}

/* 客户端偏好（设置项） */
export const getSound = (d = true) => read(K.sound, d);
export const setSound = (v) => write(K.sound, v);
export const getFolders = (d = true) => read(K.folders, d);
export const setFolders = (v) => write(K.folders, v);
export const getEnterSend = (d = true) => read(K.enterSend, d);
export const setEnterSend = (v) => write(K.enterSend, v);
export const getAnim = (d = true) => read(K.anim, d);
export const setAnim = (v) => write(K.anim, v);

// 本地缓存占用估算（KB）
export function localCacheSize() {
  let n = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      const v = localStorage.getItem(k) || '';
      n += k.length + v.length;
    }
  } catch { /* 忽略 */ }
  return Math.round(n / 1024);
}

// 清理本地缓存（保留登录态与偏好）
export function clearLocalCache() {
  const keep = [K.token, K.user, K.notify, K.last, K.sound, K.folders, K.enterSend, K.anim];
  try {
    const drop = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (keep.indexOf(k) < 0) drop.push(k);
    }
    drop.forEach((k) => localStorage.removeItem(k));
  } catch { /* 忽略 */ }
}
