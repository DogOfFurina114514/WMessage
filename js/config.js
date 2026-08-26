// WMessage 前端配置 —— 部署前把 apiBase 改成你部署好的 Cloudflare Worker 地址
// 登录页右下角的「⚙ API 设置」也可以临时修改（保存在浏览器本地，优先于这里）
window.APP_CONFIG = {
  apiBase: 'https://wmessage-backend.YOUR-SUBDOMAIN.workers.dev', // TODO: 替换为你的 Worker 地址
  appName: 'WMessage',
};
