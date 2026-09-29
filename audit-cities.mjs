/**
 * 城市分布审查：看清岗位落在哪些城市、判定为"非广东省内"的到底是谁。
 * 断言部分保证地域过滤的两个方向都没错杀/漏放。
 */
import fs from 'node:fs';

const GD = ['广州', '深圳', '佛山', '东莞', '珠海', '中山', '惠州', '江门', '肇庆', '汕头', '湛江', '茂名',
  '韶关', '梅州', '汕尾', '河源', '阳江', '清远', '潮州', '揭阳', '云浮'];

const all = [];
for (const f of ['data/scored-zhilian.json', 'data/scored-51job.json']) {
  if (!fs.existsSync(f)) { console.log(`❌ 缺少 ${f}，先跑 node score-engine.mjs`); process.exit(1); }
  all.push(...JSON.parse(fs.readFileSync(f, 'utf8')));
}

// 展示按"引擎最终采信的工作地"归并：city 是平台原始值（前程可能是总部所在地）
const cityOf = (r) => (r.cityResolved || '').trim() || (r.city || '(空)').trim();
const byCity = new Map();
for (const r of all) {
  const c = cityOf(r);
  if (!byCity.has(c)) byCity.set(c, { n: 0, rec: 0, sample: [] });
  const e = byCity.get(c);
  e.n++;
  if (r.verdict !== '不推荐') e.rec++;
  if (e.sample.length < 2) e.sample.push(`${r.title}|${r.company}`);
}
console.log(`总收录 ${all.length} 条，城市 ${byCity.size} 个\n城市分布（按总数）:`);
for (const [c, e] of [...byCity.entries()].sort((a, b) => b[1].n - a[1].n)) {
  console.log(`  ${c.padEnd(8)} 共 ${String(e.n).padStart(4)}  推荐档 ${String(e.rec).padStart(3)}   ${e.sample[0]}`);
}

const notGd = all.filter((r) => (r.negatives || []).some((n) => n.includes('非广东省内')));
console.log(`\n判定为「非广东省内」的 ${notGd.length} 条（抽样）:`);
for (const r of notGd.slice(0, 8)) console.log(`  city=${r.city} | ${r.title} | ${r.company}`);
const noCity = all.filter((r) => (r.negatives || []).some((n) => n.includes('工作地点未标明')));
console.log(`判定为「工作地点未标明」的 ${noCity.length} 条`);

// ===== 硬断言 =====
let fail = 0;
// 1) 推荐档（无过滤项）必须全部解析出广东城市——这是最容易出错的方向（误杀/漏放）
const rec = all.filter((r) => !(r.negatives || []).length);
const recBad = rec.filter((r) => !GD.includes(String(r.cityResolved || '').trim()));
console.log(`\n${recBad.length ? '❌' : '✅'} 推荐档 cityResolved 非广东城市：${recBad.length} 条（推荐档共 ${rec.length}）`);
for (const r of recBad.slice(0, 8)) console.log(`   city=${r.city} cityResolved=${JSON.stringify(r.cityResolved)} | ${r.title}`);
if (recBad.length) fail++;

// 2) 反向：判了「非广东省内」的，其 city 与 cityResolved 都不该是广东城市（避免误杀）
const wrongKill = notGd.filter((r) => GD.includes(String(r.cityResolved || '').trim()));
console.log(`${wrongKill.length ? '❌' : '✅'} 误杀（判非广东但 cityResolved 是广东）：${wrongKill.length} 条`);
for (const r of wrongKill.slice(0, 8)) console.log(`   city=${r.city} cityResolved=${JSON.stringify(r.cityResolved)} | ${r.title}`);
if (wrongKill.length) fail++;

// 3) 字段必须存在，否则上面两条断言会因为空值而"假绿"
const noField = all.filter((r) => !('cityResolved' in r));
console.log(`${noField.length ? '❌' : '✅'} 缺少 cityResolved 字段：${noField.length} 条`);
if (noField.length) fail++;

console.log(`\n${fail ? `❗ ${fail} 项异常` : '🎉 地域自检通过'}`);
process.exit(fail ? 1 : 0);
