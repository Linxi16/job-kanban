/**
 * 过滤项逐类审查：每类给出命中次数 + 抽样标题，便于人工确认每条过滤都站得住。
 *
 * 为什么要在这个脚本里断言（而不是只打印）：
 * 原先它只 console.log、永远 exit 0，被 test-all 当成"通过"，是典型假绿。
 * 现在把最关键的正确性写成硬断言，发现问题就非零退出，才能真正当回归用。
 */
import fs from 'node:fs';

const rows = [];
for (const f of ['data/scored-zhilian.json', 'data/scored-51job.json']) {
  if (!fs.existsSync(f)) { console.log(`❌ 缺少 ${f}，先跑 node score-engine.mjs`); process.exit(1); }
  for (const r of JSON.parse(fs.readFileSync(f, 'utf8'))) rows.push({ ...r, _plat: f.includes('zhilian') ? '智联' : '前程' });
}

const nrm = (n) => String(n).replace(/（[^）]*）/g, '（…）').replace(/\([^)]*\)/g, '(…)').replace(/：.*$/, '：…');
const groups = new Map();
for (const r of rows) {
  for (const n of r.negatives || []) {
    const k = nrm(n);
    if (!groups.has(k)) groups.set(k, { n: 0, byPlat: {}, samples: [] });
    const g = groups.get(k);
    g.n++;
    g.byPlat[r._plat] = (g.byPlat[r._plat] || 0) + 1;
    if (g.samples.length < 4) g.samples.push(`${r.title}／${r.company}`.slice(0, 56));
  }
}
const sorted = [...groups.entries()].sort((a, b) => b[1].n - a[1].n);
console.log(`过滤项种类：${sorted.length} 类，命中总数 ${[...groups.values()].reduce((a, g) => a + g.n, 0)} 次\n`);
for (const [k, g] of sorted) {
  console.log(`【${String(g.n).padStart(4)} 次】${k}  (智联${g.byPlat['智联'] || 0}/前程${g.byPlat['前程'] || 0})`);
  for (const s of g.samples) console.log(`          · ${s}`);
}

// ===== 硬断言 =====
let fail = 0;
// 1) 核心正确性：任何岗位都不能"被判不推荐"却"无任何过滤项"（verdictOf 逻辑前提）
const bad = rows.filter((r) => r.verdict === '不推荐' && !(r.negatives || []).length);
console.log(`\n${bad.length ? '❌' : '✅'} 判「不推荐」却无过滤项：${bad.length} 条`);
for (const r of bad.slice(0, 10)) console.log(`   ${r.title} | ${r.company} | ${r.score}分`);
if (bad.length) fail++;

// 2) 反向一致性：有过滤项必然判不推荐
const bad2 = rows.filter((r) => (r.negatives || []).length && r.verdict !== '不推荐');
console.log(`${bad2.length ? '❌' : '✅'} 有过滤项却未判「不推荐」：${bad2.length} 条`);
for (const r of bad2.slice(0, 10)) console.log(`   ${r.title} | ${r.company} | ${r.score}分 | ${r.negatives.join('；')}`);
if (bad2.length) fail++;

// 3) 过滤项文案不得残留已废弃的旧口径
const stale = [...new Set(rows.flatMap((r) => r.negatives || []))].filter((n) => /经验要求>1年|经验要求≥1年/.test(n));
console.log(`${stale.length ? '❌' : '✅'} 旧经验门槛文案残留：${stale.length} 类`);
if (stale.length) fail++;

console.log(`\n${fail ? `❗ ${fail} 项异常` : '🎉 过滤项自检通过'}`);
process.exit(fail ? 1 : 0);
