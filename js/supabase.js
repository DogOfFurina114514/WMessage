// WMessage 数据层（认证 / 查询 / 实时 / 存储）
// 接口签名与原数据层保持一致，供主逻辑无缝切换
// 依赖 index.html 中加载的 supabase-js（window.supabase）
import { getUser } from './store.js';

if (!window.supabase) throw new Error('supabase-js 未加载（检查 index.html CDN 引用）');
const sb = window.supabase.createClient(
  window.APP_CONFIG.supabaseUrl,
  window.APP_CONFIG.supabaseKey,
  { auth: { persistSession: true, autoRefreshToken: true } }
);

const AVATAR_COLORS = ['#4f7cff', '#8b5cf6', '#34d399', '#f59e0b', '#ef4444', '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16'];
function pickColor(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function toUser(row) {
  return row ? { id: row.id, username: row.username, nickname: row.nickname, email: row.email || '', avatarColor: row.avatar_color, createdAt: row.created_at } : null;
}
function toMsg(row) {
  const u = row.users || {};
  const rep = row.reply || null;
  return {
    id: row.id,
    clientId: row.client_id || '',
    roomId: row.room_id,
    userId: row.user_id,
    type: row.type,
    content: row.content,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
    username: u.username || '',
    nickname: u.nickname || '',
    avatarColor: u.avatar_color || '#4f7cff',
    replyTo: row.reply_to || '',
    reply: rep ? {
      id: rep.id,
      type: rep.type,
      content: rep.content,
      nickname: (rep.users && rep.users.nickname) || '',
    } : null,
  };
}

const MSG_SELECT = 'id,room_id,user_id,client_id,type,content,created_at,reply_to,users(nickname,avatar_color,username),reply:reply_to(id,type,content,users(nickname))';

function authErr(error) {
  const m = (error || {}).message || '操作失败';
  const err = new Error(/Invalid login credentials/i.test(m) ? '用户名或密码错误' : m);
  err.status = /invalid/i.test(m) ? 401 : 400;
  return err;
}

function uid() {
  return (sb.auth.getUser() && (sb.auth.getUser().then((r) => r.data.user, () => null))).then ? null : null;
}

async function currentUserId() {
  const { data } = await sb.auth.getUser();
  if (!data.user) throw Object.assign(new Error('登录已失效,请重新登录'), { status: 401 });
  return data.user.id;
}

/* ==================== 认证（用户名/邮箱 + 密码；用户名与邮箱独立） ==================== */
export async function login({ account, password }) {
  let email = String(account || '').trim();
  if (!email.includes('@')) {
    // 用户名登录：由服务端函数解析出注册邮箱（未登录状态可调用）
    const found = await sb.rpc('email_for_login', { account: email });
    const resolved = typeof found.data === 'string' ? found.data : '';
    if (found.error || !resolved) throw new Error('该用户名或邮箱不存在,请核对后重试');
    email = resolved;
  }
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) {
    const m = error.message || '';
    if (/Invalid login credentials/i.test(m)) throw new Error('邮箱或密码错误');
    if (/Email not confirmed/i.test(m)) {
      const err = new Error('邮箱尚未验证，请先完成邮箱验证');
      err.code = 'EMAIL_NOT_CONFIRMED';
      throw err;
    }
    throw authErr(error);
  }
  const { data: row, error: e2 } = await sb.from('users').select('*').eq('id', data.user.id).single();
  if (e2 || !row) throw new Error('账号资料不存在,请重新注册');
  return { user: toUser(row), token: data.session ? data.session.access_token : '' };
}

// 邮箱验证成功后的回跳地址（官方验证页处理完毕后重定向到此页）
const EMAIL_REDIRECT = 'https://dogoffurina114514.github.io/WMessage/auth.html';

// 重发验证邮件（signup 类型）
export async function resendVerification(email) {
  // 不同版本的客户端读取的字段名不同（emailRedirectTo / redirectTo），两个都带上，
  // 否则回跳地址会被忽略、验证后跳到站点根目录
  const { error } = await sb.auth.resend({
    type: 'signup',
    email,
    options: { emailRedirectTo: EMAIL_REDIRECT, redirectTo: EMAIL_REDIRECT },
  });
  if (error) {
    if (/rate limit/i.test(error.message)) throw new Error('发送太频繁，请稍后再试');
    throw new Error(error.message || '重发失败');
  }
  return true;
}

export async function register({ username, email, password, nickname }) {
  const uname = String(username || '').trim();
  const mail = String(email || '').trim().toLowerCase();
  const nick = String(nickname || '').trim() || uname;
  if (!/^[^@\s]{2,20}$/.test(uname)) throw new Error('用户名需为 2-20 个字符（不含 @ 与空格）');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) throw new Error('请输入有效的邮箱地址');
  // 注册前查重：未登录状态由服务端函数判定（不泄露账号数据）
  const chk = await sb.rpc('signup_conflict', { uname, mail });
  if (chk.data === 'username') throw new Error('该用户名已被使用');
  if (chk.data === 'email') throw new Error('该邮箱已被注册');
  // 用户名/昵称随注册请求写入，由数据库在创建账号时同步建好资料行
  const { data, error } = await sb.auth.signUp({
    email: mail,
    password,
    options: {
      emailRedirectTo: EMAIL_REDIRECT,
      data: { username: uname, nickname: nick.slice(0, 40), avatar_color: pickColor(nick) },
    },
  });
  if (error) {
    const m = error.message || '';
    if (/already been registered/i.test(m)) throw new Error('该邮箱已被注册');
    if (/already exists|duplicate key/i.test(m)) throw new Error('该用户名或邮箱已被注册');
    throw authErr(error);
  }
  const user = data.user;
  if (!user) throw new Error('注册失败，请稍后重试');
  const profile = { id: user.id, username: uname, email: mail, nickname: nick.slice(0, 40), avatar_color: pickColor(nick) };
  return {
    user: toUser(profile),
    token: data.session ? data.session.access_token : '',
    needVerify: !data.session,
  };
}

export async function me() {
  const id = await currentUserId();
  const { data: row } = await sb.from('users').select('*').eq('id', id).single();
  if (!row) throw Object.assign(new Error('登录已失效'), { status: 401 });
  return { user: toUser(row) };
}

// 更新个人资料（昵称 / 头像颜色）
export async function updateProfile({ nickname, avatarColor }) {
  const id = await currentUserId();
  const patch = {};
  if (typeof nickname === 'string' && nickname.trim()) patch.nickname = nickname.trim().slice(0, 40);
  if (typeof avatarColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(avatarColor)) patch.avatar_color = avatarColor;
  if (!Object.keys(patch).length) return { user: null };
  const { data, error } = await sb.from('users').update(patch).eq('id', id).select('*').single();
  if (error) throw new Error(error.message || '保存失败');
  return { user: toUser(data) };
}

// 修改密码（先校验当前密码，再更新）
export async function changePassword({ current, next }) {
  const { data } = await sb.auth.getUser();
  const email = data && data.user ? data.user.email : '';
  if (!email) throw new Error('登录已失效，请重新登录');
  const check = await sb.auth.signInWithPassword({ email, password: current });
  if (check.error) throw new Error('当前密码不正确');
  const { error } = await sb.auth.updateUser({ password: next });
  if (error) throw new Error(error.message || '修改失败');
  return true;
}

// 退出登录：结束服务端会话（清除刷新令牌），避免"退出后又自动登录"
export async function signOut() {
  try { await sb.auth.signOut(); } catch { /* 忽略网络错误 */ }
}

// 会话过期时尝试续期（返回是否成功），用于页面切换时避免误判为未登录
export async function refreshSession() {
  try {
    const { data } = await sb.auth.refreshSession();
    return !!(data && data.session);
  } catch {
    return false;
  }
}

/* ==================== 会话 ==================== */
export async function getRooms() {
  const id = await currentUserId();
  const { data: mem, error } = await sb
    .from('members')
    .select('joined_at, pinned, muted, cleared_at, rooms(id,type,name,description,created_by,created_at)')
    .eq('user_id', id);
  if (error) throw new Error(error.message);
  const rooms = [];
  for (const m of mem || []) {
    const r = m.rooms;
    if (!r) continue;
    let latestQ = sb
      .from('messages')
      .select('id,type,content,created_at,users(nickname)')
      .eq('room_id', r.id)
      .order('created_at', { ascending: false })
      .limit(1);
    if (m.cleared_at) latestQ = latestQ.gt('created_at', m.cleared_at);
    const latest = await latestQ.maybeSingle();
    let partner = null;
    if (r.type === 'dm') {
      const pm = await sb.from('members').select('user_id').eq('room_id', r.id).neq('user_id', id).limit(1).maybeSingle();
      if (pm && pm.data) {
        const pu = await sb.from('users').select('id,username,nickname,avatar_color').eq('id', pm.data.user_id).single();
        partner = pu.data ? { id: pu.data.id, username: pu.data.username, nickname: pu.data.nickname, avatarColor: pu.data.avatar_color } : null;
      }
    }
    rooms.push({
      id: r.id,
      type: r.type,
      name: r.name || '',
      description: r.description || '',
      joinedAt: m.joined_at ? new Date(m.joined_at).getTime() : 0,
      lastMessage: latest.data ? latest.data.content : null,
      lastMessageType: latest.data ? latest.data.type : null,
      lastMessageAt: latest.data ? new Date(latest.data.created_at).getTime() : null,
      lastSender: latest.data && latest.data.users ? latest.data.users.nickname : null,
      partner,
      pinned: !!m.pinned,
      muted: !!m.muted,
      clearedAt: m.cleared_at ? new Date(m.cleared_at).getTime() : 0,
    });
  }
  return { rooms };
}

export async function getChannels() {
  const id = await currentUserId();
  const { data, error } = await sb.from('rooms').select('id,name,description,created_at').eq('type', 'channel').order('created_at');
  if (error) throw new Error(error.message);
  const channels = [];
  for (const c of data || []) {
    const cnt = await sb.from('members').select('user_id', { count: 'exact', head: true }).eq('room_id', c.id);
    const joined = await sb.from('members').select('user_id').eq('room_id', c.id).eq('user_id', id).maybeSingle();
    channels.push({
      id: c.id, name: c.name, description: c.description || '',
      createdAt: c.created_at, memberCount: cnt.count || 0, joined: !!(joined.data),
    });
  }
  return { channels };
}

export async function createRoom(name, description) {
  const id = await currentUserId();
  const room = { id: crypto.randomUUID(), type: 'channel', name, description: description || '', created_by: id, created_at: new Date().toISOString() };
  const ins = await sb.from('rooms').insert(room).select('*').single();
  if (ins.error) throw new Error(ins.error.message);
  await sb.from('members').insert({ room_id: room.id, user_id: id });
  return { room: { id: room.id, type: 'channel', name: room.name, description: room.description } };
}

export async function joinRoom(roomId) {
  const id = await currentUserId();
  const j = await sb.from('members').insert({ room_id: roomId, user_id: id });
  if (j.error) throw new Error(j.error.message);
  return {};
}

export async function leaveRoom(roomId) {
  const id = await currentUserId();
  const d = await sb.from('members').delete().eq('room_id', roomId).eq('user_id', id);
  if (d.error) throw new Error(d.error.message);
  return {};
}

export async function getMessages(roomId, { beforeTs, beforeId, limit = 50, afterTs } = {}) {
  let q = sb
    .from('messages')
    .select(MSG_SELECT)
    .eq('room_id', roomId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (beforeTs) q = q.lt('created_at', new Date(beforeTs).toISOString());
  if (afterTs) q = q.gt('created_at', new Date(afterTs).toISOString());
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return { messages: (data || []).reverse().map(toMsg) };
}

// 删除自己的消息
export async function deleteMessage(id) {
  const uid = await currentUserId();
  const { error } = await sb.from('messages').delete().eq('id', id).eq('user_id', uid);
  if (error) throw new Error(error.message || '删除失败');
  return true;
}

// 会话偏好：置顶 / 静音 / 清空聊天记录（清空=只对自己隐藏此前消息）
export async function setMemberFlag(roomId, patch) {
  const uid = await currentUserId();
  const { error } = await sb.from('members').update(patch).eq('room_id', roomId).eq('user_id', uid);
  if (error) throw new Error(error.message || '操作失败');
  return true;
}

export async function searchUsers(q) {
  const id = await currentUserId();
  const { data, error } = await sb
    .from('users')
    .select('id,username,nickname,avatar_color')
    .neq('id', id)
    .or(`username.ilike.%${q}%,nickname.ilike.%${q}%`)
    .limit(20);
  if (error) throw new Error(error.message);
  return { users: (data || []).map((u) => ({ id: u.id, username: u.username, nickname: u.nickname, avatarColor: u.avatar_color })) };
}

export async function startDm(targetId) {
  const id = await currentUserId();
  const roomId = 'dm_' + [id, targetId].sort().join('_');
  const exist = await sb.from('rooms').select('id').eq('id', roomId).maybeSingle();
  if (!exist.data) {
    const ins = await sb.from('rooms').insert({ id: roomId, type: 'dm', created_by: id }).select('id,type').single();
    if (ins.error) throw new Error(ins.error.message);
  }
  await sb.from('members').insert([{ room_id: roomId, user_id: id }, { room_id: roomId, user_id: targetId }]).select();
  return { room: { id: roomId, type: 'dm' } };
}

export async function getMembers(roomId) {
  const { data, error } = await sb.from('members').select('user_id,users(id,username,nickname,avatar_color)').eq('room_id', roomId);
  if (error) throw new Error(error.message);
  return (data || []).map((m) => (m.users ? { id: m.users.id, username: m.users.username, nickname: m.users.nickname, avatarColor: m.users.avatar_color } : null)).filter(Boolean);
}

/* ==================== 消息发送 ==================== */
export async function sendMessage(msg) {
  const ins = await sb
    .from('messages')
    .insert({
      room_id: msg.roomId,
      user_id: msg.userId,
      client_id: msg.clientId,
      type: msg.type,
      content: msg.content,
      reply_to: msg.replyTo || null,
    })
    .select(MSG_SELECT)
    .single();
  if (ins.error) throw new Error(ins.error.message);
  return toMsg(ins.data);
}

/* ==================== Realtime 订阅 ==================== */
export function subscribeRoom(roomId, onMessage) {
  const channel = sb
    .channel('room:' + roomId)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `room_id=eq.${roomId}` }, async (payload) => {
      const row = payload.new;
      if (!row.user_id || !row.id) return;
      let reply = null;
      if (row.reply_to) {
        const rq = await sb.from('messages').select('id,type,content,users(nickname)').eq('id', row.reply_to).maybeSingle();
        if (rq.data) reply = { id: rq.data.id, type: rq.data.type, content: rq.data.content, nickname: (rq.data.users && rq.data.users.nickname) || '' };
      }
      let msg;
      if (row.user_id === (getUser() || {}).id) {
        msg = toMsg({ ...row, reply, users: { nickname: (getUser() || {}).nickname, avatar_color: (getUser() || {}).avatarColor, username: (getUser() || {}).username } });
      } else {
        const u = await sb.from('users').select('nickname,avatar_color,username').eq('id', row.user_id).single();
        msg = toMsg({ ...row, reply, users: u.data || {} });
      }
      onMessage(msg);
    })
    .subscribe();
  return () => sb.removeChannel(channel);
}

// 订阅本人的成员偏好变化（多端同步置顶/静音）
export function subscribeMembers(userId, onChange) {
  const channel = sb
    .channel('mem:' + userId)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'members', filter: `user_id=eq.${userId}` }, (payload) => onChange(payload.new))
    .subscribe();
  return () => sb.removeChannel(channel);
}

/* ==================== 图片（Storage） ==================== */
export async function upload(file) {
  const id = await currentUserId();
  const path = `imgs/${id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}${file.name ? '' : '.png'}`;
  const { error } = await sb.storage.from('wmessage-images').upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw new Error(error.message || '上传失败');
  const { data } = sb.storage.from('wmessage-images').getPublicUrl(path);
  return data.publicUrl;
}

/* ==================== 会话(旧版兼容占位) ==================== */
export function getToken() {
  return '';
}
