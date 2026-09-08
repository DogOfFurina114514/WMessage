// WMessage 桌面端 —— 预加载脚本（安全隔离，仅暴露窗口控制元信息）
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  platform: process.platform,
  appVersion: '1.0.0',
  isDesktop: true,
  // 无边框窗口控制：登录页关闭 / 登录后展开
  closeWindow: () => ipcRenderer.invoke('window:close'),
  expandWindow: () => ipcRenderer.invoke('window:expand'),
});
