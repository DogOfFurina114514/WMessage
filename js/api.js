// REST API 客户端
import { getApiBase, getToken } from './store.js';

async function request(method, path, body) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = getToken();
  if (token) headers['Authorization'] = 'Bearer ' + token;

  let res;
  try {
    res = await fetch(getApiBase() + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('无法连接服务器，请检查 API 地址');
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    /* 非 JSON 响应 */
  }
  if (!data || data.ok === false) {
    const err = new Error((data && data.message) || `请求失败 (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data.data;
}

export const register = (u) => request('POST', '/api/auth/register', u);
export const login = (u) => request('POST', '/api/auth/login', u);
export const me = () => request('GET', '/api/me');
export const getRooms = () => request('GET', '/api/rooms');
export const getChannels = () => request('GET', '/api/channels');
export const createRoom = (name, description) => request('POST', '/api/rooms', { name, description });
export const joinRoom = (id) => request('POST', `/api/rooms/${encodeURIComponent(id)}/join`);
export const leaveRoom = (id) => request('POST', `/api/rooms/${encodeURIComponent(id)}/leave`);

export function getMessages(roomId, { beforeTs, beforeId, limit = 50 } = {}) {
  const q = new URLSearchParams({ limit: String(limit) });
  if (beforeTs) q.set('beforeTs', String(beforeTs));
  if (beforeId) q.set('beforeId', beforeId);
  return request('GET', `/api/rooms/${encodeURIComponent(roomId)}/messages?${q}`);
}

export const searchUsers = (q) => request('GET', `/api/users?q=${encodeURIComponent(q)}`);
export const startDm = (uid) => request('POST', `/api/users/${encodeURIComponent(uid)}/dm`);
export const health = () => request('GET', '/api/health');

export async function upload(file) {
  const fd = new FormData();
  fd.append('file', file);
  let res;
  try {
    res = await fetch(getApiBase() + '/api/upload', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + getToken() },
      body: fd,
    });
  } catch {
    throw new Error('无法连接服务器，请检查 API 地址');
  }
  const data = await res.json().catch(() => null);
  if (!data || data.ok === false) throw new Error((data && data.message) || '上传失败');
  return data.data.url;
}
