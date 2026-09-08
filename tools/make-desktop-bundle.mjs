// 桌面端专用 bundle 生成器
// 从网页版 js/main.js 生成桌面内置版本：加载后强制桌面模式（关闭按钮/拖拽/尺寸上报等全部启用）
// 用法：node tools/make-desktop-bundle.mjs
// 输出：F:\WMessage\www\js\main.js（若未指定输出目录，则输出到桌面 www 同伴目录）
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, '..', 'js', 'main.js');
const OUT = process.env.WM_DESKTOP_WWW
  ? resolve(process.env.WM_DESKTOP_WWW, 'js', 'main.js')
  : resolve(__dirname, '..', '..', 'WMessage', 'www', 'js', 'main.js');

let src = readFileSync(SRC, 'utf8');

// 在平台检测之后强制桌面模式（桌面端专用）
const anchor = 'detectPlatform();\n';
if (!src.includes(anchor)) {
  console.error('❌ 未找到 platform 检测锚点');
  process.exit(1);
}
const desktopBanner =
  '/* ============ 桌面端专用入口（由 tools/make-desktop-bundle.mjs 生成，勿手改） ============\n' +
  '   桌面内置窗口强制桌面模式：关闭按钮/拖拽/尺寸上报/标题/展开 全部启用 */\n' +
  'state.isElectron = true;\n' +
  'state.isMobile = false;\n' +
  'document.documentElement.classList.add("theme-desktop");\n';

src = src.replace(anchor, anchor + '\n' + desktopBanner);

writeFileSync(OUT, src);
console.log('✅ 桌面 bundle 已生成：' + OUT);
console.log('   含桌面强制标记:', src.includes('state.isElectron = true;') ? '✅' : '❌');
