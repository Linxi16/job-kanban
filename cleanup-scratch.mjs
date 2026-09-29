import fs from 'fs';
const pats = [/^\.tmp-/, /^build-dashboard\.new\.mjs$/, /^_probe.*\.mjs$/];
const all = fs.readdirSync('.');
const hit = all.filter((f) => pats.some((r) => r.test(f)));
let freed = 0;
for (const f of hit) {
  const st = fs.statSync(f);
  if (st.isDirectory()) { console.log('（目录，跳过）', f); continue; }
  freed += st.size;
  fs.unlinkSync(f);
  console.log(`🗑  ${f}  ${(st.size / 1024).toFixed(0)} KB`);
}
console.log(`\n共删除 ${hit.length} 项，释放 ${(freed / 1024 / 1024).toFixed(1)} MB`);
console.log('\n当前目录（顶层）:');
for (const f of fs.readdirSync('.')) console.log('  ' + f);
