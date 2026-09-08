# WMessage 前端仓库（公开）

「WMessage」—— 基于 **Supabase** 的即时通讯软件,本仓库只包含**三端前端**:

- **网页端** —— GitHub Pages 部署,`dogoffurinagi.fucku.top` 同款玻璃拟态风格
- **手机端** —— 响应式布局,Material Design 3 + Telegram 式聊天界面 + 悬浮底栏(PWA 可安装)
- **电脑端** —— Electron 嵌套页面,WinUI3 / Fluent Design 风格

> **后端为私有仓库**:`DogOfFurina114514/WMessageBackend`(Supabase 迁移、RLS 策略、配置),请勿在本仓库存放后端代码与任何密钥。

**线上地址**:https://dogoffurina114514.github.io/WMessage/
**控制面板**:`/control/signin.html`(隐藏入口,仅手动输入访问)

## 目录结构

```
WMessage/                       ← 仓库根 = GitHub Pages 站点根
├── index.html                  # 入口(相对路径,适配 /WMessage/ 子路径)
├── 404.html                    # 自定义 404
├── .nojekyll / .gitattributes
├── css/
│   ├── styles.css              # 基础布局/几何(变量化)
│   ├── theme-web.css           # 网页端主题(玻璃拟态+气泡动画)
│   ├── theme-mobile.css        # 手机端主题(MD3 + Telegram 布局 + 悬浮底栏)
│   └── theme-desktop.css       # 电脑端主题(Fluent / WinUI 风格)
├── js/
│   ├── config.js               # SUPABASE URL / PUBLISHABLE KEY(公开安全)
│   ├── supabase.js             # 数据层:认证/查询/实时/存储
│   ├── store.js                # 本地状态存储
│   ├── ui.js / emoji.js        # UI 工具 / 表情
│   └── main.js                 # 主逻辑(三端自适应)
├── control/                    # 管理面板(隐藏,仅手输访问)
├── desktop/                    # Electron 桌面端
├── tools/                      # 图标生成/发布助手(无密钥)
├── manifest.webmanifest / sw.js / logo.svg / icons/
```

## 部署

- **前端**:推送到本仓库 main 分支 → Settings → Pages → Deploy from branch(main / root)
- **后端**:私有仓库 `WMessageBackend` 内 `supabase/migrations/` → Supabase 项目(结构变更走 `supabase db push` 或 SQL Editor)

## 主题说明

运行前端时自动检测平台并加载对应主题(CSS 变量体系,见 `css/theme-*.css`)。Electron 检测 `window.desktop.isDesktop`;手机检测 UA/视口宽度;其余为网页端主题。改动颜色/圆角只需覆盖对应主题文件的 CSS 变量。

## 常见问题

| 问题 | 解决 |
|---|---|
| 登录提示无法连接 | 检查 `js/config.js` 的 Project URL 是否与 Supabase 项目一致 |
| 消息不实时 | 确认 Realtime 已发布(见私有仓库迁移文件) |
| 图片发不了 | Supabase Storage 桶 `wmessage-images` 是否创建(迁移已含) |
