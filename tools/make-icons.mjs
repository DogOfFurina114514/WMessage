// 生成 PWA 图标（纯 Node 实现：SDF 绘制 + 手写 PNG 编码，零依赖）
// 用法：node tools/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'icons'); // 输出到仓库根/icons（GitHub Pages 站点根）
mkdirSync(OUT, { recursive: true });

// ---------- PNG 编码 ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePNG(width, height, rgba) {
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0; // filter: none
    rgba.copy(raw, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- SDF 绘制 ----------
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
}

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1), 0, 1);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function triSDF(px, py, a, b, c) {
  const cross = (x1, y1, x2, y2) => x1 * y2 - x2 * y1;
  const s1 = cross(b[0] - a[0], b[1] - a[1], px - a[0], py - a[1]);
  const s2 = cross(c[0] - b[0], c[1] - b[1], px - b[0], py - b[1]);
  const s3 = cross(a[0] - c[0], a[1] - c[1], px - c[0], py - c[1]);
  const inside = (s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0);
  const d = Math.min(
    segDist(px, py, a[0], a[1], b[0], b[1]),
    segDist(px, py, b[0], b[1], c[0], c[1]),
    segDist(px, py, c[0], c[1], a[0], a[1])
  );
  return inside ? -d : d;
}

const C1 = [79, 124, 255];   // #4f7cff
const C2 = [168, 85, 247];   // #a855f7
function gradient(x, y, n) {
  const t = (x + y) / (2 * n);
  return [
    C1[0] + (C2[0] - C1[0]) * t,
    C1[1] + (C2[1] - C1[1]) * t,
    C1[2] + (C2[2] - C1[2]) * t,
  ];
}

function renderIcon(size) {
  const N = size;
  const aa = Math.max(1, N / 320);
  const buf = Buffer.alloc(N * N * 4);

  // 背景圆角方块（全出血，内容控制在 80% 安全区内 → 可用于 maskable）
  // 白色聊天气泡
  const cx = 0.5 * N;
  const cy = 0.5 * N;      // 气泡中心
  const hw = 0.27 * N;
  const hh = 0.185 * N;
  const br = 0.09 * N;
  // 尾巴三角（左下）
  const tA = [0.245 * N, 0.60 * N];
  const tB = [0.43 * N, 0.645 * N];
  const tC = [0.21 * N, 0.85 * N];
  // 三个点
  const dots = [
    [cx - 0.125 * N, cy, 0.042 * N],
    [cx, cy, 0.042 * N],
    [cx + 0.125 * N, cy, 0.042 * N],
  ];

  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const bgMask = clamp(0.5 - sdRoundRect(px, py, 0.5 * N, 0.5 * N, 0.5 * N, 0.5 * N, 0.19 * N) / aa, 0, 1);
      if (bgMask <= 0) continue; // 透明
      let [r, g, b] = gradient(px, py, N);
      const bubbleD = Math.min(sdRoundRect(px, py, cx, cy, hw, hh, br), triSDF(px, py, tA, tB, tC));
      const bubbleM = clamp(0.5 - bubbleD / aa, 0, 1);
      r = r * (1 - bubbleM) + 255 * bubbleM;
      g = g * (1 - bubbleM) + 255 * bubbleM;
      b = b * (1 - bubbleM) + 255 * bubbleM;
      for (const [dx, dy, dr] of dots) {
        const dotM = clamp(0.5 - (Math.hypot(px - dx, py - dy) - dr) / aa, 0, 1);
        const [dr2, dg2, db2] = gradient(dx, dy, N);
        r = r * (1 - dotM) + dr2 * dotM;
        g = g * (1 - dotM) + dg2 * dotM;
        b = b * (1 - dotM) + db2 * dotM;
      }
      const o = (y * N + x) * 4;
      buf[o] = Math.round(r);
      buf[o + 1] = Math.round(g);
      buf[o + 2] = Math.round(b);
      buf[o + 3] = Math.round(255 * bgMask);
    }
  }
  return encodePNG(N, N, buf);
}

const targets = [
  ['icon-512.png', 512],
  ['icon-192.png', 192],
  ['icon-180.png', 180], // apple-touch-icon
  ['favicon-32.png', 32],
];

for (const [name, size] of targets) {
  const png = renderIcon(size);
  writeFileSync(join(OUT, name), png);
  console.log(`✓ ${name} (${png.length} bytes)`);
}
console.log('图标已输出到仓库根 icons/（GitHub Pages 站点根）');
