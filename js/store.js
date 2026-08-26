// 本地状态存储（localStorage）
const K = {
  token: 'wmessage_token',
  user: 'wmessage_user',
  api: 'wmessage_api_base',
  unread: 'wmessage_unread',
  notify: 'wmessage_notify',
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
  return String(window.APP_CONFIG.apiBase || 'https://example.workers.dev').replace(/\/+$/, '');
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

export const getNotify = () => read(K.notify, false);
export const setNotify = (v) => write(K.notify, v);
