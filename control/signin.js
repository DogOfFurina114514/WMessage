// WMessage 控制面板登录页逻辑
// 账号与密码均为单向加密存储（PBKDF2-SHA256 + 随机盐 + 150000 次迭代），源码中无任何明文。
// 点击登录时才验算：按钮禁用 → “登录中…” → 显示“登录成功”或“账号或密码错误”。
const ACCOUNT_HASH = { salt: 'TAox23sk6HCGVUDMlV4YsA', hash: 'QMYAvEQJDikehORMIAj6+QKV0G1usVj5+E81erfeXsQ=' };
const PASSWORD_HASH = { salt: 'TQcGMSpxuo2UtDnFngS21g', hash: 'moNZmXkJ3pMcOgKW+dvPmcia3i2fFdE1hAeoX/Yl89E=' };
const ITERATIONS = 150000;
const SESSION_KEY = 'wmessage_admin_session';
const MAX_ATTEMPTS = 5;
const LOCK_MS = 60 * 1000;

const $ = (sel) => document.querySelector(sel);

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

async function verify(input, cfg) {
  try {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(input), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: enc.encode(cfg.salt), iterations: ITERATIONS, hash: 'SHA-256' },
      key,
      256
    );
    return constEq(bytesToB64(new Uint8Array(bits)), cfg.hash);
  } catch {
    return false;
  }
}

function setMsg(text, ok) {
  const el = $('#msg');
  el.textContent = text || '';
  el.className = 'auth-error' + (ok ? ' auth-ok' : '');
}

$('#signinForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#submitBtn');
  if (btn.disabled) return;

  const lockUntil = parseInt(localStorage.getItem('wmessage_admin_lock') || '0', 10);
  if (Date.now() < lockUntil) {
    setMsg(`尝试次数过多，请 ${Math.ceil((lockUntil - Date.now()) / 1000)} 秒后再试`, false);
    return;
  }

  btn.disabled = true;
  btn.textContent = '登录中…';
  setMsg('', false);

  const user = $('#userInput').value.trim();
  const pass = $('#passInput').value;
  const [okUser, okPass] = await Promise.all([verify(user, ACCOUNT_HASH), verify(pass, PASSWORD_HASH)]);

  if (okUser && okPass) {
    setMsg('登录成功', true);
    localStorage.removeItem('wmessage_admin_lock');
    localStorage.removeItem('wmessage_admin_fails');
    sessionStorage.setItem(SESSION_KEY, '1');
    setTimeout(() => location.replace('./index.html'), 600);
    return;
  }

  let fails = parseInt(localStorage.getItem('wmessage_admin_fails') || '0', 10) + 1;
  localStorage.setItem('wmessage_admin_fails', String(fails));
  if (fails >= MAX_ATTEMPTS) {
    localStorage.setItem('wmessage_admin_lock', String(Date.now() + LOCK_MS));
    localStorage.setItem('wmessage_admin_fails', '0');
    setMsg('尝试次数过多，已锁定 1 分钟', false);
  } else {
    setMsg('账号或密码错误', false);
  }
  btn.disabled = false;
  btn.textContent = '登 录';
});
