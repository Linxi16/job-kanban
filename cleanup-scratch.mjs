/**
 * 本地清场：删掉已正式化文件的旧副本、一次性探针、回归夹具目录、备份文件。
 *
 * 保护规则（务必保留）：
 *   1. cloud/ 与 templates/ 下的文件一律不碰 —— 目录规则 /^\.tmp/ 也匹配不到它们，
 *      但早期版本的模式 /^probe.*\.mjs$/ 曾把 cloud/ 里的 gh-upload.mjs 也算成临时件。
 *   2. data/ 下的一律不碰 —— 只删 data/zhilian-detail.json 这一个具名废弃文件。
 *
 * 用法:
 *   node cleanup-scratch.mjs          列出将删除的内容（dry-run，默认）
 *   node cleanup-scratch.mjs --yes    真正删除
 */
import fs from 'node:fs';
import path from 'node:path';

const DRY = !process.argv.includes('--yes');

// 未加 / 锚定，所以任何目录下的同名文件都会被匹配到 —— 因此必须排除 cloud/ 与 templates/
const FILE_PATS = [
  /^\.tmp-.*/,            // 临时脚本 + .tmp-push-manifest.json（含已正式化的旧副本）
  /^probe-.*\.mjs$/,      // 一次性接口探针
  /\.bak$/,               // 手工备份
];
// 回归夹具目录（--make 生成，每次重跑会重建）
const DIR_PATS = [/^\.tmp-[^/]+$/];
// 必须保留的目录：这些地方的 .mjs 是正式文件，不是临时件
const KEEP_DIRS = new Set(['cloud', 'templates', 'node_modules', '.git', '岗位看板', 'dist', 'data']);
// 具名要删的废弃文件（本地/远端都已停用）
const NAMED = [
  'check-jd-coverage.mjs',   // 孤儿：读已废弃的 data/zhilian-detail.json
  'zhilian-spider.mjs',      // 旧爬虫：用户未授权抓取，已由 cloud/fetch-all.mjs 取代
  '51job-spider.mjs',
  'data/zhilian-detail.json',
];

const sizeOf = (p) => {
  const st = fs.statSync(p);
  if (!st.isDirectory()) return st.size;
  return fs.readdirSync(p).reduce((s, f) => s + sizeOf(path.join(p, f)), 0);
};

const rootFiles = fs.readdirSync('.', { withFileTypes: true });
const delFiles = rootFiles
  .filter((e) => e.isFile() && FILE_PATS.some((r) => r.test(e.name)))
  .map((e) => e.name);
// 防呆：任何来自受保护目录的匹配都必须剔除
const unsafe = delFiles.filter((f) => KEEP_DIRS.has(path.dirname(f)));
if (unsafe.length) { console.log(`❌ 防呆触发，拒绝删除：${unsafe}`); process.exit(1); }
const delDirs = rootFiles
  .filter((e) => e.isDirectory() && DIR_PATS.some((r) => r.test(e.name)))
  .map((e) => e.name);
const named = NAMED.filter((f) => fs.existsSync(f));

let freed = 0, n = 0;
console.log(`临时文件 ${delFiles.length} · 夹具目录 ${delDirs.length} · 具名废弃 ${named.length}${DRY ? '（dry-run，加 --yes 才真删）' : ''}\n`);
for (const f of [...named, ...delFiles]) {
  const s = sizeOf(f); freed += s; n++;
  if (!DRY) fs.unlinkSync(f);
  console.log(`  ${DRY ? '·' : '🗑'} ${f}  ${(s / 1024).toFixed(0)} KB`);
}
for (const d of delDirs) {
  const s = sizeOf(d); freed += s; n++;
  if (!DRY) fs.rmSync(d, { recursive: true, force: true });
  console.log(`  ${DRY ? '·' : '🗑'} ${d}/  ${(s / 1024 / 1024).toFixed(1)} MB`);
}
console.log(`\n共 ${n} 项，${(freed / 1024 / 1024).toFixed(2)} MB${DRY ? '（未删除）' : ' 已删除'}`);
