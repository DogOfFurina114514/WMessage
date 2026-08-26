// WMessage 控制面板主页逻辑
// 门控：未登录（无会话标记）时立即跳回登录页，不渲染任何面板内容，
//       直接输入 control/index.html 也只能看到空页面并被打回 signin.html。
const SESSION_KEY = 'wmessage_admin_session';
const API_KEY = 'wmessage_api_base';

function getApiBase() {
  const custom = (localStorage.getItem(API_KEY) || '').replace(/\/+$/, '');
  if (custom) return custom;
  return String(window.APP_CONFIG.apiBase || '').replace(/\/+$/, '');
}

const $ = (sel) => document.querySelector(sel);

/* ---------------- 登录门控 ---------------- */
if (sessionStorage.getItem(SESSION_KEY) !== '1') {
  location.replace('./signin.html');
} else {
  document.body.innerHTML = `
    <div class="admin-shell">
      <header class="admin-head">
        <div class="admin-title">WMessage 控制面板</div>
        <div class="admin-user">
          <span>管理员</span>
          <button class="btn btn-ghost" id="logoutBtn" type="button">退出</button>
        </div>
      </header>
      <main class="admin-main">
        <section class="admin-card">
          <h2>系统状态</h2>
          <div id="healthBox" class="admin-muted">检测中…</div>
        </section>
        <section class="admin-card">
          <h2>API 服务地址</h2>
          <div class="api-row">
            <input id="apiBase" placeholder="https://xxx.workers.dev">
            <button class="btn btn-primary api-btn" id="saveApiBtn" type="button">保存</button>
          </div>
          <p class="admin-tip">修改后保存到浏览器本地，立即生效；主程序与手机端需用同一浏览器访问。</p>
        </section>
        <section class="admin-card">
          <h2>使用说明</h2>
          <ul class="admin-tip">
            <li>登录入口：<code>https://dogoffurina114514.github.io/WMessage/control/signin.html</code></li>
            <li>面板主页需登录后进入，直接访问 <code>control/index.html</code> 会被拦截回登录页。</li>
            <li>账号密码为单向加密存储，仅在登录时验算（PBKDF2-SHA256，15 万次迭代）。</li>
          </ul>
        </section>
      </main>
    </div>`;

  $('#apiBase').value = getApiBase();
  checkHealth();

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
  $('#logoutBtn').addEventListener('click', () => {
    sessionStorage.removeItem(SESSION_KEY);
    location.replace('./signin.html');
  });
}

/* ---------------- 系统状态 ---------------- */
async function checkHealth() {
  const box = $('#healthBox');
  if (!box) return;
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
