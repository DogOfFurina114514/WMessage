// WMessage 桌面端 —— 主进程
// 默认加载前端页面；可用环境变量 WMESSAGE_URL 或 --url= 参数覆盖
const { app, BrowserWindow, shell, ipcMain } = require('electron');
const path = require('path');
const fs = require('node:fs');

const DEFAULT_URL = 'https://dogoffurina114514.github.io/WMessage/';
const argUrl = process.argv.find((a) => a.startsWith('--url='));
const APP_URL = (argUrl ? argUrl.slice(6) : process.env.WMESSAGE_URL) || DEFAULT_URL;

// 便携版目录约定：安装目录只放主程序文件；
//   data/   ← 应用数据（登录会话、本地存储）
//   cache/  ← 缓存
//   temp/   ← 临时文件
// 判定：electron-builder portable 注入 PORTABLE_EXECUTABLE_DIR；
//       手动组装版本 exe 名为 WMessage.exe（dev 时 exe 为 electron，不误判）
const portableBase = process.env.PORTABLE_EXECUTABLE_DIR ||
  (/^wmessage\./i.test(path.basename(process.execPath || '')) ? path.dirname(process.execPath) : null);
if (portableBase) {
  const mk = (p) => { try { fs.mkdirSync(p, { recursive: true }); } catch { /* 只读目录时忽略 */ } };
  const data = path.join(portableBase, 'data');
  const cache = path.join(portableBase, 'cache');
  const temp = path.join(portableBase, 'temp');
  mk(data); mk(cache); mk(temp);
  app.setPath('userData', data);
  app.setPath('sessionData', data);
  app.setPath('cache', cache);
  app.setPath('temp', temp);
}

let win = null;

function createWindow() {
  // 无边框小窗口(登录页)；登录后由前端触发展开
  win = new BrowserWindow({
    width: 420,
    height: 640,
    minWidth: 360,
    minHeight: 520,
    title: 'WMessage',
    backgroundColor: '#0b0e1a',
    autoHideMenuBar: true,
    frame: false, // 不使用系统标题栏
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

  win.webContents.on('did-fail-load', (e, code, desc, validatedURL) => {
    if (validatedURL === 'about:blank') return;
    const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><style>
      body{background:#0b0e1a;color:#e9ecf7;font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0}
      .card{max-width:520px;text-align:center;line-height:1.8;padding:24px}
      h1{font-size:22px} p{color:#8f97b8;font-size:14px} code{background:#1a2038;padding:2px 8px;border-radius:6px;color:#8b5cf6}
    </style></head><body><div class="card"><h1>无法加载页面</h1>
      <p>请用 <code>npm start -- --url=https://你的页面地址</code> 指定正确的前端地址。</p>
    </div></body></html>`;
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  });
}

// 窗口控制(前端 Preload 调用)
ipcMain.handle('window:close', () => {
  if (win) win.close();
});
ipcMain.handle('window:expand', () => {
  if (win) {
    win.setMinimumSize(380, 560);
    win.setSize(1200, 800);
    win.center();
  }
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
