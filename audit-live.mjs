/** 全量数据自检：把各类硬过滤在真实数据上逐条复核 */
import fs from 'node:fs';

const GD = ['广州', '深圳', '佛山', '东莞', '珠海', '中山', '惠州', '江门', '肇庆', '汕头', '湛江', '茂名', '韶关', '梅州', '汕尾', '河源', '阳江', '清远', '潮州', '揭阳', '云浮'];
const rows = [];
// 本地优先用 .tmp-live/（真实抓取的大样本），云端该目录不存在则回退 data/。
// 之前硬编码 .tmp-live/ 导致这个自检无法进云端流水线（.tmp-* 被 .gitignore 排除）。
const pick = (f) => [`.tmp-live/${f}`, `data/${f}`].find((p) => fs.existsSync(p));
const src = ['scored-zhilian.json', 'scored-51job.json'].map((f) => [f, pick(f)]);
if (src.some(([, p]) => !p)) {
  console.log(`⚠ 找不到引擎产物，先跑 node score-engine.mjs`);
  process.exit(1);
}
console.log(`数据来源：${src[0][1].startsWith('.tmp-live') ? '.tmp-live/（本地大样本）' : 'data/（当前收录）'}\n`);
for (const [f, p] of src) {
  const label = f.includes('zhilian') ? '智联' : '前程';
  for (const x of JSON.parse(fs.readFileSync(p, 'utf8'))) rows.push({ ...x, _p: label });
}
console.log(`总样本 ${rows.length} 条\n`);

let bad = 0;
const chk = (cond, msg, list) => {
  if (cond) { console.log(`  ✅ ${msg}`); return; }
  bad++;
  console.log(`  ❌ ${msg}（${list.length} 条）`);
  for (const r of list.slice(0, 6)) console.log(`       ${r._p} ${r.score}分 ${r.title} @ ${r.company} | ${(r.negatives || []).join('；')}`);
};

const noNeg = rows.filter((r) => !(r.negatives || []).length);

console.log('【A. 推荐档（无过滤项）的资格复核】');
chk(!noNeg.some((r) => r.effectiveExp !== null && r.effectiveExp >= 2 && !r.freshOk),
  '推荐档内不存在「经验下限≥2年且无应届豁免」', noNeg.filter((r) => r.effectiveExp >= 2 && !r.freshOk));
chk(!noNeg.some((r) => /实习生|实习岗|27届|28届|2027届|2028届|在校生/.test(r.title || '')),
  '推荐档内标题不含实习/在读届别', noNeg.filter((r) => /实习生|实习岗|27届|28届|2027届|2028届|在校生/.test(r.title || '')));
chk(!noNeg.some((r) => !r.cityResolved || !GD.includes(r.cityResolved)),
  '推荐档内 cityResolved 均为广东省内城市（用引擎的解析结果，不再自己模糊匹配）',
  noNeg.filter((r) => !r.cityResolved || !GD.includes(r.cityResolved)));
chk(!noNeg.some((r) => String(r.salaryText || '').match(/^[1-5](\.\d)?-[1-5](\.\d)?千/)),
  '推荐档内无低于 6k 的薪资', noNeg.filter((r) => String(r.salaryText || '').match(/^[1-5](\.\d)?-[1-5](\.\d)?千/)));
chk(!noNeg.some((r) => !(r.jobDescFull || '').trim()),
  '推荐档内全部带有岗位描述（JD）', noNeg.filter((r) => !(r.jobDescFull || '').trim()));
chk(!noNeg.some((r) => /20-99人/.test(r.companySize || '')),
  '推荐档内无 20-99人 小公司', noNeg.filter((r) => /20-99人/.test(r.companySize || '')));
chk(!noNeg.some((r) => (r.schedule || {}).rest === '单休'),
  '推荐档内无双休以外的单休', noNeg.filter((r) => (r.schedule || {}).rest === '单休'));

console.log('\n【B. 评分与判定的一致性】');
const tier = (x) => (x >= 90 ? '强烈推荐' : x >= 75 ? '推荐' : x >= 65 ? '可考虑' : '备选');
chk(!rows.some((r) => !(r.negatives || []).length && r.verdict !== tier(r.score)),
  '无过滤项时 verdict 与分数档位一致', rows.filter((r) => !(r.negatives || []).length && r.verdict !== tier(r.score)));
chk(!rows.some((r) => (r.negatives || []).length && r.verdict !== '不推荐'),
  '只要有过滤项就判为不推荐', rows.filter((r) => (r.negatives || []).length && r.verdict !== '不推荐'));
chk(!rows.some((r) => r.score > 100 || r.score < 0), '分数均在 0–100', rows.filter((r) => r.score > 100 || r.score < 0));
chk(!rows.some((r) => (r.bonuses || []).reduce((s, b) => s + b.v, 0) > 70),
  '加分总额不超过封顶 70', rows.filter((r) => (r.bonuses || []).reduce((s, b) => s + b.v, 0) > 70));

console.log('\n【C. 字段完整性】');
chk(!rows.some((r) => !r.title || !r.company), '标题与公司名齐全', rows.filter((r) => !r.title || !r.company));
chk(!rows.some((r) => !r.url), '岗位链接齐全', rows.filter((r) => !r.url));
chk(!noNeg.some((r) => !r.publishTime), '推荐档全部有发布时间', noNeg.filter((r) => !r.publishTime));
chk(!rows.some((r) => typeof r.daysAgo !== 'number' || Number.isNaN(r.daysAgo)), '发布距今天数可算', rows.filter((r) => typeof r.daysAgo !== 'number' || Number.isNaN(r.daysAgo)));

console.log('\n【D. 过滤项文案核查（是否残留旧口径）】');
const allNeg = [...new Set(rows.flatMap((r) => r.negatives || []))];
console.log('  出现过的过滤项文案：');
for (const n of allNeg.sort()) console.log(`    · ${n.replace(/（[^）]*）/g, '（…）')}`);
chk(!allNeg.some((n) => /经验要求>1年|经验要求≥1年/.test(n)), '无旧经验门槛文案残留', []);

console.log(`\n${bad === 0 ? '🎉 全部自检通过' : `⚠️ ${bad} 项异常`}`);
process.exit(bad === 0 ? 0 : 1);
