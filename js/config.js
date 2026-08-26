// WMessage 前端配置
// 后端 API 地址：Cloudflare Worker（已部署，见 backend/）
// 登录页右下角的「⚙ API 设置」也可以临时修改（保存在浏览器本地，优先于这里）
window.APP_CONFIG = {
  apiBase: 'https://wmessage-backend.wu-20111229.workers.dev',
  appName: 'WMessage',
};
