// 通过 GitHub Contents API 把仓库发布到 github.com/DogOfFurina114514/WMessage
// 用途：沙箱内 git 无法建立 TLS（Windows 凭据限制），改用 REST API 逐文件上传
// 用法：node tools/gh-publish.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OWNER = 'DogOfFurina114514';
const REPO = 'WMessage';
const TOKEN = readFileSync(join(dirname(ROOT), 'wmessage-token.txt'), 'utf8').trim();
const COMMIT_MSG = 'feat: WMessage 上线 - Cloudflare 后端 + GitHub Pages 前端 + Electron 桌面端 + PWA';

// 排除：版本库/依赖/本地密钥/构建产物
const EXCLUDE_DIRS = new Set(['.git', 'node_modules', '.wrangler', 'dist']);
const EXCLUDE_FILES = new Set(['.dev.vars']);

function listFiles(dir, base = '') {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const rel = base ? `${base}/${name}` : name;
    const st = statSync(full);
    if (st.isDirectory()) {
      if (EXCLUDE_DIRS.has(name)) continue;
      out.push(...listFiles(full, rel));
    } else if (!EXCLUDE_FILES.has(name)) {
      out.push(rel);
    }
  }
  return out;
}

async function api(method, path, body) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'wmessage-deploy',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* 非 JSON */ }
  return { status: res.status, ok: res.ok, data };
}

function enc(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

async function main() {
  // 1) 校验 token 与账号
  const me = await api('GET', '/user');
  if (!me.ok) {
    console.error(`❌ Token 无效: HTTP ${me.status} ${me.data?.message || ''}`);
    process.exit(1);
  }
  console.log(`✅ Token 有效，账号: ${me.data.login}`);

  // 2) 检查目标仓库
  const repo = await api('GET', `/repos/${OWNER}/${REPO}`);
  if (!repo.ok) {
    console.error(`❌ 仓库 ${OWNER}/${REPO} 不存在（HTTP ${repo.status}: ${repo.data?.message || ''}）`);
    console.error('→ 请先在 https://github.com/new 创建空仓库 WMessage(不要勾任何初始化文件),然后重跑本脚本。');
    process.exit(1);
  }
  console.log(`✅ 仓库已存在: ${repo.data.full_name} | 默认分支 ${repo.data.default_branch}`);

  // 3) 扫描文件
  const files = listFiles(ROOT).sort();
  console.log(`📦 待上传 ${files.length} 个文件…`);

  // 4) 逐个上传(已存在则用其 sha 更新)
  let uploaded = 0;
  const failed = [];
  for (const file of files) {
    const abs = join(ROOT, file.split('/').join(sep));
    const content = readFileSync(abs).toString('base64');
    let sha = null;
    const existing = await api('GET', `/repos/${OWNER}/${REPO}/contents/${enc(file)}`);
    if (existing.ok) sha = existing.data.sha;
    const body = { message: COMMIT_MSG, content, branch: repo.data.default_branch };
    if (sha) body.sha = sha;
    const res = await api('PUT', `/repos/${OWNER}/${REPO}/contents/${enc(file)}`, body);
    if (res.ok) {
      uploaded++;
      console.log(`  ✓ ${file}`);
    } else {
      failed.push(`${file} (HTTP ${res.status}: ${res.data?.message || ''})`);
      console.error(`  ✗ ${file} → HTTP ${res.status} ${res.data?.message || ''}`);
    }
  }

  console.log(`\n✅ 完成:成功 ${uploaded}/${files.length}${failed.length ? `,失败 ${failed.length}` : ''}`);
  if (failed.length) {
    console.log('失败列表:');
    for (const f of failed) console.log('  -', f);
    process.exit(1);
  }
  console.log(`线上地址: https://github.com/${OWNER}/${REPO}`);
  console.log(`Pages 地址: https://${OWNER.toLowerCase()}.github.io/${REPO}/`);
}

main().catch((e) => {
  console.error('❌ 发布失败:', e.message);
  process.exit(1);
});
