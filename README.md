# WMessage（前端部署仓库）

基于 **Cloudflare + GitHub Pages** 的即时通讯软件:

- 🌐 **网页版** —— 静态前端部署到 GitHub Pages,零服务器成本
- 📱 **手机版** —— 响应式 UI + PWA,可安装到手机主屏(也支持 Capacitor 打包原生 App)
- 💻 **电脑版** —— Electron 嵌套网页,打包 Windows / macOS / Linux 安装程序

| 层 | 技术 |
|---|---|
| 前端 | 原生 HTML/CSS/JS(零构建,仓库根目录即 Pages 站点根)+ PWA |
| 后端 | Cloudflare Workers(REST API)+ Durable Objects(WebSocket 实时房间) |
| 存储 | D1(用户/会话/消息持久化)+ R2(图片,可选) |
| 桌面 | Electron 加载前端页面 |
| 手机 | PWA(可安装)+ 可选 Capacitor 原生打包 |

```
┌────────────┐   HTTPS    ┌──────────────────┐   HTTPS / WSS   ┌──────────────────────┐
│  浏览器     │ ─────────▶ │ GitHub Pages     │ ──────────────▶ │ Cloudflare Worker    │
│  Electron  │            │ /WMessage/ 站点根 │                 │ REST API             │
│  手机 PWA  │            └──────────────────┘                 │ Durable Object 实时  │
└────────────┘                                                │ D1 持久化 / R2 图片  │
                                                              └──────────────────────┘
```

**生产地址**:`https://dogoffurina114514.github.io/WMessage/`
**仓库**:`https://github.com/DogOfFurina114514/WMessage`

## 功能

- 账号注册/登录(PBKDF2 密码哈希 + HMAC 签名 Token,30 天有效期)
- 实时消息收发(WebSocket + Durable Objects,毫秒级)
- **频道**(公开聊天室,可创建/发现/加入/退出)与**私聊**(1 对 1)
- 消息历史(向下无限加载)+ 未读角标 + 最后消息预览
- 在线状态、成员列表、正在输入提示、加入/离开系统提示
- 图片消息(粘贴/上传,基于 R2,可选启用)
- 桌面通知、表情面板、移动端手势(侧滑栏/成员面板)
- PWA:可安装、可离线打开界面、全屏独立窗口

---

## 快速开始

### 第一步:部署 Cloudflare 后端

```bash
npm install -g wrangler
wrangler login

# 1) 创建数据库
wrangler d1 create wmessage-db
#    → 把输出的 database_id 填入 backend/wrangler.toml

# 2) 安装依赖并初始化表结构
cd backend
npm install
wrangler d1 execute wmessage-db --remote --file=schema.sql

# 3) 配置签名密钥(输入一段随机字符串,如 openssl rand -base64 32)
wrangler secret put AUTH_SECRET

# 4) 部署!
wrangler deploy
```

部署完成后你会得到一个地址 `https://wmessage-backend.你的子域.workers.dev`,记为 **API 地址**。

> 📷 **可选:启用图片上传**
> ```bash
> wrangler r2 bucket create wmessage-images
> ```
> 然后取消 `backend/wrangler.toml` 中 `[[r2_buckets]]` 的注释,再次 `wrangler deploy`。

### 第二步:前端上线(GitHub Pages)

本仓库**已经按 GitHub Pages 规范组织**:静态文件(index.html、css/、js/、icons/、sw.js、manifest.webmanifest、.nojekyll 等)全部位于**仓库根目录**,站点根即 Pages 发布根,无需任何构建。

```bash
# 编辑 js/config.js,把 apiBase 改成第一步的 API 地址(登录页 ⚙ 设置也可临时改)

git add .
git commit -m "feat: WMessage 前端上线"
git remote add origin https://github.com/DogOfFurina114514/WMessage.git
git branch -M main
git push -u origin main
```

然后在仓库 **Settings → Pages → Source: Deploy from a branch → main / root**,保存。
几分钟后访问:**`https://dogoffurina114514.github.io/WMessage/`** ✅

> 本仓库的 `.nojekyll` 文件确保 GitHub Pages 不会用 Jekyll 处理站点;所有资源引用均为相对路径,适配 `/WMessage/` 子路径部署。

### 第三步:电脑版(Electron)

```bash
cd desktop
npm install
npm start                     # 默认已指向 https://dogoffurina114514.github.io/WMessage/
npm run dist                  # 打包安装包 → dist/
```

### 第四步:手机版(PWA)

用手机浏览器打开 `https://dogoffurina114514.github.io/WMessage/` 后:

- **iPhone(Safari)**:分享按钮 → 添加到主屏幕
- **Android(Chrome/Edge)**:菜单 → 安装应用 / 添加到主屏幕

安装后是全屏独立 App,支持离线打开界面与桌面推送。

> 想要应用商店的原生 App?前端是标准 Web 应用,可以用 [Capacitor](https://capacitorjs.com) 把它包成 Android/iOS 项目:`npm i @capacitor/core @capacitor/cli` → `npx cap init` → `npx cap add android`,把 `webDir` 指向仓库根目录即可。

---

## 本地开发

```bash
cd backend
cp .dev.vars.example .dev.vars   # 填入本地 AUTH_SECRET
npm install
npm run dev                      # 本地运行在 http://127.0.0.1:8787
```

本地数据库初始化(可选,用本地 D1 文件):

```bash
npx wrangler d1 execute wmessage-db --local --file=schema.sql
```

前端直接用静态服务器打开(如 `npm run serve` 或 VS Code Live Server),
然后在登录页 ⚙ API 设置里填 `http://127.0.0.1:8787` 即可联调。

---

## 目录结构(符合 GitHub Pages 规范:站点文件在仓库根)

```
WMessage/                    ← 仓库根 = Pages 站点根
├── index.html               # 入口(相对路径引用,适配 /WMessage/ 子路径)
├── .nojekyll                # 禁用 Jekyll 处理
├── manifest.webmanifest     # PWA 清单(start_url = "./", scope = "./")
├── sw.js                    # Service Worker(PWA 离线缓存)
├── logo.svg
├── css/styles.css           # 全局样式
├── js/                      # config/store/api/ws/ui/emoji/main
├── icons/                   # 由 tools/make-icons.mjs 生成
├── README.md                # 本文件
├── backend/                 # Cloudflare Worker 后端
│   ├── src/index.js         # REST API 路由 + WS 转发
│   ├── src/chat-room.js     # Durable Object(每会话一个实例,实时广播)
│   ├── src/auth.js          # PBKDF2 + HMAC Token
│   ├── schema.sql           # D1 表结构
│   └── wrangler.toml        # CF 配置(D1/DO/R2)
├── desktop/                 # Electron 桌面端(main.js + preload.js)
└── tools/
    ├── make-icons.mjs       # 零依赖生成 PWA 图标
    ├── unit-smoke.mjs       # 零依赖逻辑冒烟测试(无需 wrangler,10 秒跑完 33 项断言)
    └── smoke.mjs            # 本地 wrangler dev 环境下的端到端冒烟测试
```

## 本地自查(无需部署)

```bash
npm run smoke   # 用内存 DB 驱动真实代码:注册/登录/频道/私聊/WS 实时/限流/权限,共 33 项断言
```

部署前建议先跑一遍,全部 ✓ 即可放心上线。若本机装了 wrangler,还可以 `cd backend && npm run dev` 后执行 `node tools/smoke.mjs` 做更贴近生产环境的端到端测试。

## 安全说明

- `AUTH_SECRET` 是敏感机密,只能通过 `wrangler secret put` 设置,**不要提交到 git**
- 生产环境建议在 `wrangler.toml` 的 `[vars]` 里配置 `ALLOWED_ORIGINS = "https://dogoffurina114514.github.io"` 收紧 CORS 来源
- 免费额度参考:Workers 10 万请求/天,D1 500 万读/天,WebSocket 连接数与时长有免费上限
- 若 `workers.dev` 域名在部分地区不可达,可在 Cloudflare 控制台给 Worker 绑定自定义域名

## 常见问题

| 问题 | 解决 |
|---|---|
| 提示「无法连接服务器」 | 检查 API 地址(登录页 ⚙ 设置)是否正确、Worker 是否已部署 |
| 能登录但发不出消息 | 确认 `wrangler deploy` 的最新版已生效;D1 表是否创建(执行 schema.sql) |
| 图片按钮不可用 | 未启用 R2,参考上面「可选:启用图片上传」 |
| 手机通知不弹 | 首次开启需在浏览器里授权通知;iOS 需先添加到主屏幕并允许通知 |
| 修改软件图标 | 编辑 `tools/make-icons.mjs` 后执行 `npm run icons` 重新生成 |