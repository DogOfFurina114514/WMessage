// WMessage 桌面端 —— 预加载脚本（安全隔离，仅暴露少量元信息）
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  platform: process.platform,
  appVersion: '1.0.0',
  isDesktop: true,
});
