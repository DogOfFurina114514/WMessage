// 本地端到端冒烟测试：注册 → 建频道 → WebSocket 鉴权 → 发消息 → 查历史
// 用法：先启动 wrangler dev（本地 8787），再执行 node tools/smoke.mjs
const BASE = process.env.BASE || 'http://127.0.0.1:8787';
const uniq = Date.now() % 1e7;

function fail(msg) {
  console.error('❌ SMOKE FAILED:', msg);
  process.exit(1);
}

async function api(method, path, body, token, raw = false) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  console.log(`  ${method} ${path} → ${res.status} ${text.slice(0, 140)}`);
  if (raw) return { status: res.status, text };
  const j = JSON.parse(text);
  if (!j.ok) throw new Error(`${method} ${path}: ${j.message}`);
  return j.data;
}

function openWs(roomId, token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:8787/ws?room=${roomId}`);
    const timer = setTimeout(() => { console.error('WS 超时'); process.exit(1); }, 15000);
    const inbox = [];
    const waiters = [];
    ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token, roomId }));
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.type === 'hello') {
        clearTimeout(timer);
        console.log('  WS hello ✓ members:', m.members.length, 'online:', m.online.length);
        resolve({
          ws,
          next: () =>
            new Promise((res2) => {
              if (inbox.length) res2(inbox.shift());
              else waiters.push(res2);
            }),
        });
      } else {
        const w = waiters.shift();
        if (w) w(m);
        else inbox.push(m);
      }
    };
    ws.onerror = (e) => { clearTimeout(timer); reject(e); };
  });
}

async function main() {
  const username = 'smoke' + uniq;
  console.log('1️⃣ 注册用户', username);
  const reg = await api('POST', '/api/auth/register', { username, password: 'secret123', nickname: '冒烟测试' });
  const token = reg.token;
  console.log('2️⃣ 登录');
  await api('POST', '/api/auth/login', { username, password: 'secret123' }, token);
  console.log('3️⃣ 当前用户');
  const me = await api('GET', '/api/me', null, token);
  if (!me.user) fail('me 返回异常');
  console.log('4️⃣ 创建频道');
  const created = await api('POST', '/api/rooms', { name: '冒烟频道', description: 'smoke' }, token);
  const roomId = created.room.id;
  console.log('5️⃣ 会话列表');
  const rooms = await api('GET', '/api/rooms', null, token);
  if (!rooms.rooms.some((r) => r.id === roomId)) fail('会话列表缺少新频道');
  if (!rooms.rooms.some((r) => r.id === 'channel_welcome')) fail('注册后应自动加入公共聊天室');
  console.log('6️⃣ 频道发现');
  const chs = await api('GET', '/api/channels', null, token);
  if (!chs.channels.some((c) => c.id === 'channel_welcome')) fail('发现列表缺少公共聊天室');
  console.log('7️⃣ 用户搜索');
  const found = await api('GET', '/api/users?q=smoke', null, token);
  if (!found.users.length) fail('搜索不到自己以外用户');
  console.log('8️⃣ WebSocket 实时收发');
  const { ws, next } = await openWs(roomId, token);
  ws.send(JSON.stringify({ type: 'send', clientId: 'c1', contentType: 'text', content: '你好，WMessage！' }));
  const echo = await next();
  if (echo.type !== 'message' || echo.message.content !== '你好，WMessage！') fail('WS 消息回显异常: ' + JSON.stringify(echo));
  if (echo.message.clientId !== 'c1' || echo.message.nickname !== '冒烟测试') fail('WS 消息元数据异常');
  console.log('9️⃣ 历史消息');
  const hist = await api('GET', `/api/rooms/${roomId}/messages`, null, token);
  if (!hist.messages.some((m) => m.content === '你好，WMessage！')) fail('历史消息缺失');
  console.log('🔟 无效 token 检查');
  const bad = await api('GET', '/api/me', null, 'bad.token.here').catch((e) => e);
  if (!bad || bad.status !== 401) fail('无效 token 应返回 401');
  ws.close();
  console.log('✅ SMOKE OK —— 全链路正常');
  process.exit(0);
}

main().catch((e) => fail(e.stack || e.message));
