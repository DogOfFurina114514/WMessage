// WMessage 管理面板逻辑
// 注意：仅通过直接输入网址访问（https://…/WMessage/admin），站点内无任何入口链接
const ADMIN_USER = 'DogOfFurina';
const ADMIN_PASS = 'Wu201112290311';
const SESSION_KEY = 'wmessage_admin_session';
const API_KEY = 'wmessage_api_base';
const MAX_ATTEMPTS = 5;
const LOCK_MS = 60 * 1000; // 5 次失败锁定 1 分钟

function getApiBase() {
  const custom = (localStorage.getItem(API_KEY) || '').replace(/\/+$/, '');
  if (custom) return custom;
  return String(window.APP_CONFIG.apiBase || '').replace(/\/+$/, '');
}

const $ = (sel) => document.querySelector(sel);

/* ---------------- 登录 ---------------- */
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
}

function bindLogin() {
  $('#adminForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const errEl = $('#adminError');
    const u = $('#adminUser').value.trim();
    const p = $('#adminPass').value;

    let lockUntil = parseInt(localStorage.getItem('wmessage_admin_lock') || '0', 10);
    if (Date.now() < lockUntil) {
      errEl.textContent = `尝试次数过多，请 ${Math.ceil((lockUntil - Date.now()) / 1000)} 秒后再试`;
      return;
    }

    if (u === ADMIN_USER && p === ADMIN_PASS) {
      localStorage.removeItem('wmessage_admin_lock');
      sessionStorage.setItem(SESSION_KEY, '1');
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
