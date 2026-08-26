# WMessage 桌面端（Electron）

一个简单可靠的 Electron 外壳：加载 GitHub Pages 上的 WMessage 前端页面。

## 运行

```bash
npm install
npm start
```

默认加载 `main.js` 中的 `DEFAULT_URL`（已指向 `https://dogoffurina114514.github.io/WMessage/`）。
也可以用参数或环境变量覆盖（优先于默认值）：

```bash
npm start -- --url=https://dogoffurina114514.github.io/WMessage/
# 或
$env:WMESSAGE_URL="https://dogoffurina114514.github.io/WMessage/"; npm start
```

## 打包安装包

```bash
npm run dist
```

输出在 `dist/` 目录：
- Windows：NSIS 安装程序（.exe）
- macOS：dmg（需在 macOS 上打包）
- Linux：AppImage

## 说明

- `icon.png` 来自 `tools/make-icons.mjs` 生成的 512px 图标（可重新生成后复制）
- 主窗口启用了渲染进程沙箱与上下文隔离，浏览器中的新窗口会转交系统浏览器打开
- 网页内的桌面通知会调用 Electron 的系统通知能力
