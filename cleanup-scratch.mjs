/**
 * 本地清场：删掉临时脚本、回归夹具目录、文件备份。
 * 这些产物已被 .gitignore 排除，但混在工作目录里会干扰阅读与"哪些是正式文件"的判断。
 *
 * 用法:
 *   node cleanup-scratch.mjs          只列出将删除的内容（dry-run，默认）
 *   node cleanup-scratch.mjs --yes    真正删除
 */
import fs from 'node:fs';

const DRY = !process.argv.includes('--yes');

// 注意本项目实际命名：探针是无下划线的 probe-*.mjs，临时件是 .tmp-*
const FILE_PATS = [
  /^\.tmp-.*/,            // 含 .tmp-manifest.mjs / .tmp-all-tests.mjs 等
  /^probe-.*\.mjs$/,      // 一次性接口探针
  /^zhilian-.*\.mjs$/,    // 已被 cloud/fetch-all.mjs 取代的旧爬虫
  /\.bak$/,               // 含 build-dashboard.mjs.corrupt.bak / score-engine.mjs.bak
];
// 回归用例的夹具目录（--make 生成，内有 list/scored/dashboard 三个文件）
const DIR_PATS = [/^\.tmp-[^/]+$/];

const entries = fs.readdirSync('.', { withFileTypes: true });
const files = [], dirs = [];
for (const e of entries) {
  if (e.isDirectory()) { if (DIR_PATS.some((r) => r.test(e.name))) dirs.push(e.name); }
  else if (FILE_PATS.some((r) => r.test(e.name))) files.push(e.name);
}
// 两个旧爬虫是显式保留的（不作为规则，避免误删仍在用的东西）
files.push('51job-spider.mjs', 'zhilian-spider.mjs');
// 去重
const uniqFiles = [...new Set(files.filter((f) => fs.existsSync(f)))];

let freed = 0;
const sizeOf = (p) => {
  const st = fs.statSync(p);
  if (!st.isDirectory()) return st.size;
  return fs.readdirSync(p).reduce((s, f) => s + sizeOf(`${p}/${f}`), 0);
};

console.log(`临时文件 ${uniqFiles.length} 个 / 夹具目录 ${dirs.length} 个${DRY ? '（dry-run，加 --yes 才真删）' : ''}\n`);
for (const f of uniqFiles) {
  const n = sizeOf(f); freed += n;
  if (!DRY) fs.unlinkSync(f);
  console.log(`  ${DRY ? '·' : '🗑'} ${f}  ${(n / 1024).toFixed(0)} KB`);
}
for (const d of dirs) {
  const n = sizeOf(d); freed += n;
  if (!DRY) fs.rmSync(d, { recursive: true, force: true });
  console.log(`  ${DRY ? '·' : '🗑'} ${d}/  ${(n / 1024).toFixed(0)} KB`);
}
console.log(`\n共 ${uniqFiles.length + dirs.length} 项，${(freed / 1024 / 1024).toFixed(2)} MB${DRY ? '（未删除）' : ' 已删除'}`);
