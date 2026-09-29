/**
 * 生成待推送清单：对比远端文件树与本地文件（按 git blob SHA 比对内容）。
 * 只做只读比对，不写仓库；上传由 cloud/gh-upload.mjs 负责。
 *
 * 默认只比对 CODE（人写的代码/配置/模板/文档）。
 * 数据/看板产物（DATA）默认排除 —— 它们由云端每次运行重新生成，
 * 本地副本必然越来越旧，混进来就会把云端新数据悄悄覆盖成旧的（无任何报错）。
 * 确需本地推数据时显式加 --with-data。
 *
 * 用法: GH_TOKEN=xxx node --use-system-ca cloud/gh-manifest.mjs [--json] [--with-data]
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { CODE, DATA, PUSH } from './gh-push-list.mjs';

const WITH_DATA = process.argv.includes('--with-data');
// 实际参与比对的清单
const SCOPE = WITH_DATA ? PUSH : CODE;

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
console.log(`远端 commit ${String(baseSha).slice(0, 8)} | 远端文件 ${remote.size} 个`);
console.log(`比对范围: ${WITH_DATA ? 'CODE + DATA（--with-data）' : 'CODE（默认，不含云端产物）'} = ${SCOPE.length} 个\n`);

const upload = [], same = [], missingLocal = [];
for (const rel of SCOPE) {
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
// 默认模式下明确报告被跳过的数据文件，避免"为什么数据没更新"的困惑
if (!WITH_DATA) {
  const dataDiff = DATA.filter((rel) => {
    const abs = path.join(ROOT, rel);
    return fs.existsSync(abs) && remote.get(rel) !== gitSha(fs.readFileSync(abs));
  });
  console.log('');
  console.log('=== 数据/看板产物 ' + DATA.length + ' 个已跳过（其中本地与云端不同 ' + dataDiff.length + ' 个）===');
  console.log('  这些由云端每次运行重新生成；本地推会把云端新数据覆盖成旧的。');
  for (const d of dataDiff) console.log('  ⤫ ' + d);
  if (dataDiff.length) console.log('  确需本地推数据：加 --with-data');
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
