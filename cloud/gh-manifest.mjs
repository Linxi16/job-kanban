/**
 * 生成待推送清单：对比远端文件树与本地文件（按 git blob SHA 比对内容）。
 * 只做只读比对，不写仓库；上传由 cloud/gh-upload.mjs 负责。
 *
 * 用法: GH_TOKEN=xxx node --use-system-ca cloud/gh-manifest.mjs --json
 *       GH_TOKEN=xxx node --use-system-ca cloud/gh-manifest.mjs --diff
 *
 * 推送范围在 cloud/gh-push-list.mjs 里定义（单一事实来源，
 * 同时被 verify-workflow.mjs import 用于断言云端不会缺文件）。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PUSH } from './gh-push-list.mjs';

const TOKEN = process.env.GH_TOKEN;
const OWNER = 'Linxi16', REPO = 'job-kanban', BRANCH = 'main';
const H = { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'dsh', 'X-GitHub-Api-Version': '2022-11-28' };
// 仓库根目录（本文件在 cloud/ 下）
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_JSON = path.join(ROOT, '.tmp-push-manifest.json');

const gitSha = (buf) => crypto.createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');

// 远端现状
let remote = new Map();
let baseSha = null;
try {
  const ref = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`, { headers: H }).then((r) => r.json());
  baseSha = ref.object.sha;
  const tree = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/git/trees/${baseSha}?recursive=1`, { headers: H }).then((r) => r.json());
  for (const t of tree.tree || []) if (t.type === 'blob') remote.set(t.path, t.sha);
} catch (e) {
  console.log('取远端失败:', e.message);
}
console.log(`远端 commit ${String(baseSha).slice(0, 8)} | 远端文件 ${remote.size} 个\n`);

const upload = [], same = [], missingLocal = [];
for (const rel of PUSH) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) { missingLocal.push(rel); continue; }
  const sha = gitSha(fs.readFileSync(abs));
  if (remote.get(rel) === sha) same.push(rel);
  else upload.push({ rel, note: remote.has(rel) ? '内容变更' : '新增' });
}

console.log('=== 需要上传 ===');
for (const u of upload) console.log(`  [${u.note}] ${u.rel}`);
console.log(`\n=== 内容未变（跳过）${same.length} 个 ===`);
for (const s of same) console.log('  = ' + s);
if (missingLocal.length) {
  console.log(`\n=== ⚠ 本地缺失 ${missingLocal.length} 个（清单里列了但文件不存在）===`);
  for (const m of missingLocal) console.log('  ? ' + m);
}
const keep = [...remote.keys()].filter((p) => !PUSH.includes(p));
if (keep.length) {
  console.log(`\n=== 远端保留但不在清单内 ${keep.length} 个（不会被删除）===`);
  for (const k of keep) console.log('  · ' + k);
}

if (process.argv.includes('--json')) {
  fs.writeFileSync(OUT_JSON, JSON.stringify(upload.map((u) => u.rel), null, 1), 'utf8');
  console.log(`\n✅ 已写出 .tmp-push-manifest.json（${upload.length} 个文件）`);
}
