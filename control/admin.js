// WMessage 控制面板主页逻辑
// 门控：未登录（无会话标记）时立即跳回登录页，不渲染任何面板内容，
//       直接输入 control/index.html 也只能看到空页面并被打回 signin.html。
const SESSION_KEY = 'wmessage_admin_session';

// 后端服务 URL（来自前端配置），系统状态用于探测其连通性
function getApiBase() {
  return String(window.APP_CONFIG.supabaseUrl || '').replace(/\/+$/, '');
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
          <h2>后端状态</h2>
          <div id="healthBox" class="admin-muted">检测中…</div>
        </section>
        <section class="admin-card">
          <h2>说明</h2>
          <p class="admin-tip">后端为私有服务；本面板仅展示当前配置的服务连通状态。</p>
        </section>
        <section class="admin-card">
          <h2>使用说明</h2>
          <ul class="admin-tip">
            <li>登录入口：<code>https://dogoffurina114514.github.io/WMessage/control/signin.html</code></li>
            <li>面板主页需登录后进入，直接访问 <code>control/index.html</code> 会被拦截回登录页。</li>
            <li>账号密码为单向加密存储，仅在登录时验算。</li>
          </ul>
        </section>
      </main>
    </div>`;

  checkHealth();

  $('#logoutBtn').addEventListener('click', () => {
    sessionStorage.removeItem(SESSION_KEY);
    location.replace('./signin.html');
  });
}

/* ---------------- 系统状态（后端连通性） ---------------- */
async function checkHealth() {
  const box = $('#healthBox');
  if (!box) return;
  box.textContent = '检测中…';
  box.className = 'admin-muted';
  const base = getApiBase();
  try {
    const res = await fetch(base, { signal: AbortSignal.timeout(12000) });
    box.innerHTML = res.ok
      ? `<span class="ok">✔ 服务可访问</span> · ${base}`
      : `服务地址返回 HTTP ${res.status}（${base}）`;
  } catch {
    box.textContent = `无法连接后端服务: ${base}（网络受限或地址不正确）`;
  }
}
