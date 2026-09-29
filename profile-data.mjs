// 智联数据画像：确认字段可用性，指导评分引擎
import fs from 'fs';

const list = JSON.parse(fs.readFileSync('data/zhilian-list.json', 'utf8'));
console.log(`=== 智联数据画像：${list.length} 条 ===\n`);

const has = (x) => x !== null && x !== undefined && x !== '';
const rate = (k) => list.filter((x) => has(x[k])).length;

// 1) 关键字段填充率
console.log('--- 字段填充率 ---');
for (const k of ['name', 'salaryReal', 'salary60', 'publishTime', 'companySize', 'industryName', 'education', 'workingExp', 'workType', 'cityDistrict', 'workCity', 'positionURL', 'number', 'jobSummary', 'welfareLabel', 'jobSkillTags', 'companyName', 'companyStage', 'companyType', 'jobStatus', 'updateTime', 'skillTags']) {
  if (!(k in list[0])) continue;
  const r = rate(k);
  const ex = list.find((x) => has(x[k]));
  let s = '';
  if (ex) {
    const v = ex[k];
    s = Array.isArray(v) ? `[${v.slice(0, 3).map((y) => (typeof y === 'object' ? JSON.stringify(y).slice(0, 40) : y)).join(', ')}]` : String(typeof v === 'object' ? JSON.stringify(v) : v).slice(0, 60);
  }
  console.log(`  ${String(r).padStart(3)}/${list.length}  ${k.padEnd(16)} ${s}`);
}

// 2) 经验要求分布（过滤项：>1年 直接不推荐）
console.log('\n--- 工作年限分布 ---');
const exp = {};
for (const x of list) { const k = x.workingExp || '(空)'; exp[k] = (exp[k] || 0) + 1; }
Object.entries(exp).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${String(v).padStart(3)}  ${k}`));

// 3) 公司规模分布（过滤项：20-99人）
console.log('\n--- 公司规模分布 ---');
const size = {};
for (const x of list) { const k = x.companySize || '(空)'; size[k] = (size[k] || 0) + 1; }
Object.entries(size).sort((a, b) => b[1] - a[1]).slice(0, 15).forEach(([k, v]) => console.log(`  ${String(v).padStart(3)}  ${k}`));

// 4) 发布时间范围
console.log('\n--- 发布时间 ---');
const times = list.map((x) => x.publishTime).filter(has).sort();
console.log(`  最早: ${times[0]}`);
console.log(`  最晚: ${times[times.length - 1]}`);
console.log(`  有发布时间: ${times.length}/${list.length}`);

// 5) 薪资分布
console.log('\n--- 薪资样例 ---');
const sal = {};
for (const x of list) { const k = x.salary60 || x.salaryReal || '(空)'; sal[k] = (sal[k] || 0) + 1; }
Object.entries(sal).sort((a, b) => b[1] - a[1]).slice(0, 12).forEach(([k, v]) => console.log(`  ${String(v).padStart(3)}  ${k}`));

// 6) 岗位名称前 30（看是否含招聘专员/管理岗）
console.log('\n--- 岗位名称样例（前30）---');
[...new Set(list.map((x) => x.name))].slice(0, 30).forEach((n) => console.log(`  ${n}`));

// 7) jobSkillTags 样例（判断"多模块"）
console.log('\n--- jobSkillTags 样例 ---');
list.filter((x) => Array.isArray(x.jobSkillTags) && x.jobSkillTags.length).slice(0, 10)
  .forEach((x) => console.log(`  ${x.name} → [${x.jobSkillTags.map((t) => t.name || t).join(', ')}]`));

// 8) jobSummary 填充情况（是否含 JD 片段）
console.log('\n--- jobSummary 样例 ---');
list.filter((x) => has(x.jobSummary)).slice(0, 3).forEach((x) => console.log(`  ${x.name}: ${String(x.jobSummary).slice(0, 200)}`));
console.log(`  jobSummary 非空: ${rate('jobSummary')}/${list.length}`);

console.log('\n--- 详情文件 ---');
for (const f of ['data/zhilian-detail.json', 'data/51job-list.json']) {
  if (fs.existsSync(f)) {
    const d = JSON.parse(fs.readFileSync(f, 'utf8'));
    console.log(`  ✅ ${f}: ${Array.isArray(d) ? d.length : '?'} 条`);
  } else console.log(`  ⬜ ${f}: 尚未生成`);
}
