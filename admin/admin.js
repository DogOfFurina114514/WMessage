// WMessage 管理面板逻辑
// 注意：仅通过直接输入网址访问（https://…/WMessage/admin），站点内无任何入口链接
// 安全模型：密码为单向加密存储（PBKDF2-SHA256 + 随机盐 + 150000 次迭代），此处仅存 salt/hash 密文；
//           输入时通过 Web Crypto 实时验算，比较过程使用恒定时间算法。
const ADMIN_USER = 'DogOfFurina';
const ADMIN_HASH = {
  salt: 'IpWaffJmUK6yp9BoaQAziQ',
  hash: 'nedyWZ+Ddv43CCnTYTzY2MFQVaQRotnF0JaOuLQHK3k=',
  iterations: 150000,
};
const SESSION_KEY = 'wmessage_admin_session';
const API_KEY = 'wmessage_api_base';
const MAX_ATTEMPTS = 5;
const LOCK_MS = 60 * 1000; // 5 次失败锁定 1 分钟
const VERIFY_DEBOUNCE = 400; // 实时验算防抖（ms）

function getApiBase() {
  const custom = (localStorage.getItem(API_KEY) || '').replace(/\/+$/, '');
  if (custom) return custom;
  return String(window.APP_CONFIG.apiBase || '').replace(/\/+$/, '');
}

const $ = (sel) => document.querySelector(sel);

/* ---------------- 单向密码验算（PBKDF2） ---------------- */
function bytesToB64(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function constEq(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function verifyPassword(password) {
  try {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: enc.encode(ADMIN_HASH.salt), iterations: ADMIN_HASH.iterations, hash: 'SHA-256' },
      key,
      256
    );
    return constEq(bytesToB64(new Uint8Array(bits)), ADMIN_HASH.hash);
  } catch {
    return false;
  }
}

/* ---------------- 登录与实时验算 ---------------- */
let lastVerify = { value: '', ok: false };

function setHint(state, text) {
  const hint = $('#passHint');
  if (!hint) return;
  hint.className = 'auth-hint' + (state ? ' ' + state : '');
  hint.textContent = text || '';
}

function showLogin() {
  $('#loginView').hidden = false;
  $('#panelView').hidden = true;
}

async function enterPanel() {
  $('#loginView').hidden = true;
  $('#panelView').hidden = false;
  $('#adminName').textContent = ADMIN_USER;
  $('#apiBase').value = getApiBase();
  checkHealth();
}

function doLogout() {
  sessionStorage.removeItem(SESSION_KEY);
  showLogin();
  $('#adminUser').value = '';
  $('#adminPass').value = '';
  $('#adminError').textContent = '';
  setHint('', '');
  lastVerify = { value: '', ok: false };
}

function bindLogin() {
  // 实时验算：输入防抖 400ms 后计算密码哈希并比对
  let verifyTimer = null;
  $('#adminPass').addEventListener('input', () => {
    clearTimeout(verifyTimer);
    const pwd = $('#adminPass').value;
    if (!pwd) {
      setHint('', '');
      lastVerify = { value: '', ok: false };
      return;
    }
    setHint('', '验算中…');
    verifyTimer = setTimeout(async () => {
      const ok = await verifyPassword(pwd);
      lastVerify = { value: pwd, ok };
      setHint(ok ? 'ok' : 'bad', ok ? '✔ 密码正确，点击「登录」进入面板' : '✘ 密码错误');
    }, VERIFY_DEBOUNCE);
  });

  $('#adminForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = $('#adminError');
    const u = $('#adminUser').value.trim();
    const pwd = $('#adminPass').value;

    let lockUntil = parseInt(localStorage.getItem('wmessage_admin_lock') || '0', 10);
    if (Date.now() < lockUntil) {
      errEl.textContent = `尝试次数过多，请 ${Math.ceil((lockUntil - Date.now()) / 1000)} 秒后再试`;
      return;
    }

    // 信任实时验算缓存；否则（如直接回车）现算
    let passOk = lastVerify.value === pwd ? lastVerify.ok : await verifyPassword(pwd);
    lastVerify = { value: pwd, ok: passOk };

    if (u === ADMIN_USER && passOk) {
      localStorage.removeItem('wmessage_admin_lock');
      sessionStorage.setItem(SESSION_KEY, '1');
      errEl.textContent = '';
      enterPanel();
      return;
    }

    let fails = parseInt(localStorage.getItem('wmessage_admin_fails') || '0', 10) + 1;
    localStorage.setItem('wmessage_admin_fails', String(fails));
    if (fails >= MAX_ATTEMPTS) {
      localStorage.setItem('wmessage_admin_lock', String(Date.now() + LOCK_MS));
      localStorage.setItem('wmessage_admin_fails', '0');
      errEl.textContent = '尝试次数过多，已锁定 1 分钟';
    } else {
      errEl.textContent = `账号或密码错误（剩余 ${MAX_ATTEMPTS - fails} 次）`;
    }
  });

  $('#logoutBtn').addEventListener('click', doLogout);
}

/* ---------------- 系统状态 ---------------- */
async function checkHealth() {
  const box = $('#healthBox');
  box.textContent = '检测中…';
  box.className = 'admin-muted';
  const base = getApiBase();
  try {
    const res = await fetch(base + '/api/health', { signal: AbortSignal.timeout(12000) });
    const data = await res.json();
    if (res.ok && data.ok) {
      box.innerHTML = `<span class="ok">✔ 服务正常</span> · 服务器时间 ${new Date(data.data.time).toLocaleString()} · ${data.data.upload ? '图片上传已启用' : '图片上传未启用(R2 未配置)'}`;
    } else {
      box.textContent = `接口异常: HTTP ${res.status}`;
    }
  } catch {
    box.textContent = `无法连接 API: ${base}（可能是网络受限或地址不正确）`;
  }
}

/* ---------------- API 地址管理 ---------------- */
function bindApiManage() {
  $('#saveApiBtn').addEventListener('click', async () => {
    const v = $('#apiBase').value.trim().replace(/\/+$/, '');
    if (!v) return;
    localStorage.setItem(API_KEY, v);
    $('#healthBox').textContent = '已保存，验证连接中…';
    checkHealth();
  });
  $('#apiBase').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('#saveApiBtn').click();
  });
}

/* ---------------- 启动 ---------------- */
bindLogin();
bindApiManage();
if (sessionStorage.getItem(SESSION_KEY) === '1') {
  enterPanel();
} else {
  showLogin();
}
