/**
 * 通过 GitHub REST API 上传项目文件（不依赖 git CLI）
 *
 * 用法：GH_TOKEN=xxx node cloud/gh-upload.mjs [--manifest 文件清单.json]
 * 说明：
 *  - 用 Git Data API：建 blob → 建 tree → 建 commit → 更新 ref
 *  - 二进制安全（base64），文件名/路径支持中文
 *  - 已存在的同名 blob 会被新内容覆盖（每次全量重建 tree）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const TOKEN = process.env.GH_TOKEN;
const OWNER = process.env.GH_OWNER || 'Linxi16';
const REPO = process.env.GH_REPO || 'job-kanban';
const BRANCH = process.env.GH_BRANCH || 'main';

if (!TOKEN) { console.log('❌ 需要 GH_TOKEN'); process.exit(1); }

const H = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'dsh-job-kanban',
};

async function gh(method, p, body) {
  const r = await fetch('https://api.github.com' + p, {
    method,
    headers: { ...H, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(120000),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${method} ${p} → HTTP ${r.status}: ${JSON.stringify(j?.message || j)}`);
  return j;
}

// ---------- 1. 仓库 ----------
let repo;
try {
  repo = await gh('GET', `/repos/${OWNER}/${REPO}`);
  console.log(`仓库已存在：${repo.full_name}（${repo.private ? '私有' : '公开'}）`);
} catch {
  repo = await gh('POST', '/user/repos', {
    name: REPO,
    private: true,
    description: '岗位看板：自动抓取 + 评分 + 云端更新',
    auto_init: true,
  });
  console.log(`✅ 仓库已创建：${repo.full_name}（私有）`);
}

// ---------- 2. 收集文件 ----------
const manifestPath = process.argv[process.argv.indexOf('--manifest') + 1];
const rel = manifestPath && fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : null;

const files = [];
if (rel) {
  for (const r of rel) {
    const abs = path.join(ROOT, r);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) files.push({ abs, repoPath: r.split(path.sep).join('/') });
  }
} else {
  console.log('❌ 需要 --manifest'); process.exit(1);
}

let total = 0;
for (const f of files) total += fs.statSync(f.abs).size;
console.log(`待上传 ${files.length} 个文件，合计 ${(total / 1024 / 1024).toFixed(2)} MB`);

// ---------- 3. 取当前 ref ----------
let baseSha = null;
try {
  const ref = await gh('GET', `/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`);
  baseSha = ref.object.sha;
  console.log('当前分支最新 commit:', baseSha.slice(0, 8));
} catch {
  console.log('分支为空，将创建首个 commit');
}

// ---------- 4. 建 blob ----------
const tree = [];
let i = 0;
for (const f of files) {
  i++;
  const buf = fs.readFileSync(f.abs);
  const blob = await gh('POST', `/repos/${OWNER}/${REPO}/git/blobs`, {
    content: buf.toString('base64'),
    encoding: 'base64',
  });
  tree.push({ path: f.repoPath, mode: '100644', type: 'blob', sha: blob.sha });
  process.stdout.write(`\r  上传 ${i}/${files.length}  ${f.repoPath}                    `);
}
console.log('');

// ---------- 5. 建 tree + commit（必须带 base_tree，否则会覆盖整棵树）----------
let baseTreeSha = null;
if (baseSha) {
  const baseCommit = await gh('GET', `/repos/${OWNER}/${REPO}/git/commits/${baseSha}`);
  baseTreeSha = baseCommit.tree.sha;
  const keep = await gh('GET', `/repos/${OWNER}/${REPO}/git/trees/${baseTreeSha}?recursive=1`);
  if (keep.truncated) {
    console.log('⚠️ 警告：仓库文件树过大被截断，请改用 git CLI 上传');
    process.exit(1);
  }
  const keepCount = (keep.tree || []).filter((t) => t.type === 'blob').length;
  console.log(`现有文件 ${keepCount} 个，将在其基础上覆盖/新增 ${tree.length} 个`);
}
const newTree = await gh('POST', `/repos/${OWNER}/${REPO}/git/trees`, baseTreeSha
  ? { base_tree: baseTreeSha, tree }
  : { tree });
const commit = await gh('POST', `/repos/${OWNER}/${REPO}/git/commits`, {
  message: `更新岗位看板：${new Date().toISOString().slice(0, 19).replace('T', ' ')}`,
  tree: newTree.sha,
  parents: baseSha ? [baseSha] : [],
});
console.log('新 commit:', commit.sha.slice(0, 8));

if (baseSha) {
  await gh('PATCH', `/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`, { sha: commit.sha, force: true });
} else {
  await gh('POST', `/repos/${OWNER}/${REPO}/git/refs`, { ref: `refs/heads/${BRANCH}`, sha: commit.sha });
}
console.log(`✅ 已推送到 ${OWNER}/${REPO}@${BRANCH}`);
console.log(`   仓库地址: https://github.com/${OWNER}/${REPO}`);
