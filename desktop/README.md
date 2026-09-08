# WMessage 桌面端（Electron 便携版）

一个便携式 Electron 外壳：加载 GitHub Pages 上的 WMessage 前端页面。

## 打包（便携版单文件 exe）

```bash
cd desktop
npm install
npm run dist
```

输出在 `dist/` 目录：**`WMessage.exe`**（单个 exe，无安装过程）。

## 使用（便携设计）

**双击 `WMessage.exe` 直接运行**，无需安装。exe 所在目录即"安装目录"，只放主程序文件，运行时自动创建：

```
你的目录/
├── WMessage.exe     ← 主程序（双击启动）
├── data/            ← 应用数据（登录会话、本地存储）
├── cache/           ← 缓存
└── temp/            ← 临时文件
```

- **数据全部存在 exe 旁边**：把整个文件夹拷到 U 盘/别的电脑，登录状态随之带走
- 删除文件夹 = 彻底卸载（不留系统残留）
- 目录权限不足（如 Program Files）时会创建失败，请放在可写目录（如桌面、F:\）

## 自定义地址

默认加载 https://dogoffurina114514.github.io/WMessage/

```bash
npm start -- --url=https://你的地址/
# 或
$env:WMESSAGE_URL="https://你的地址/"; npm start
```

## 说明

- `icon.png` 来自 `tools/make-icons.mjs` 生成（与网站 logo 同几何）
- 主窗口启用渲染进程沙箱与上下文隔离
- 网页内桌面通知走系统通知
