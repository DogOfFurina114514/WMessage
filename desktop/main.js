// WMessage 桌面端 —— Electron 主进程
// 默认加载 GitHub Pages 上的前端页面；可用环境变量 WMESSAGE_URL 或 --url= 参数覆盖
const { app, BrowserWindow, shell } = require('electron');
const path = require('path');

const DEFAULT_URL = 'https://dogoffurina114514.github.io/WMessage/';
const argUrl = process.argv.find((a) => a.startsWith('--url='));
const APP_URL = (argUrl ? argUrl.slice(6) : process.env.WMESSAGE_URL) || DEFAULT_URL;

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 400,
    minHeight: 560,
    title: 'WMessage',
    backgroundColor: '#0b0e1a',
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.loadURL(APP_URL);

  // 外部链接交给系统浏览器，禁止在新窗口打开
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // 加载失败（如未配置 URL）时给出提示
  win.webContents.on('did-fail-load', (e, code, desc, validatedURL) => {
    if (validatedURL === 'about:blank') return;
    const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><style>
      body{background:#0b0e1a;color:#e9ecf7;font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0}
      .card{max-width:520px;text-align:center;line-height:1.8;padding:24px}
      h1{font-size:22px} p{color:#8f97b8;font-size:14px} code{background:#1a2038;padding:2px 8px;border-radius:6px;color:#8b5cf6}
    </style></head><body><div class="card"><h1>无法加载页面</h1>
      <p>请先用 <code>npm start -- --url=https://dogoffurina114514.github.io/WMessage/</code><br>
      或设置环境变量 <code>WMESSAGE_URL</code> 指定正确的前端地址。</p>
      <p style="font-size:12px;color:#6a7291">${String(desc || code || '')}</p>
    </div></body></html>`;
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
