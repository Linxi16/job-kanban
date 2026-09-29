// 一键全套回归：所有用例先 --make 生成夹具 → 引擎批算 → --check 断言，再跑静态校验与审计。
//
// 本地：node test-all.mjs
// 云端：工作流直接调用这一步（.github/workflows/update.yml），因此这里的用例
//       就是发布前的最后一道闸门 —— 判定逻辑改坏了必须在发布前失败。
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

// 沙箱禁止管道 stdio（EPERM），只能继承父进程标准流
const run = (cmd, args, env) => {
  try {
    execFileSync(cmd, args, { env: { ...process.env, ...env }, stdio: 'inherit' });
    return { ok: true };
  } catch (e) {
    return { ok: false, msg: String(e.message || '').split('\n')[0] };
  }
};
const say = (ok, label) => console.log(`${ok ? '✅' : '❌'} ${label}`);

// 两阶段用例：--make 写夹具 → score-engine 批算 → --check 断言
const suites = [
  { name: '硬过滤（实习/方向/地域/薪资/日薪·时薪）', script: 'test-hard-filter.mjs', dirs: ['.tmp-hard-filter'] },
  { name: '应届生判定', script: 'test-fresh-bug.mjs', dirs: ['.tmp-fresh-test', '.tmp-fresh-real'] },
];
// 纯函数单测：不需要夹具，直接跑
const units = [{ name: '经验年限解析', script: 'test-exp-parse.mjs' }];
// 静态校验（读 data/ 或模板，不需要夹具）
const verifiers = ['verify-dashboard.mjs', 'verify-dist.mjs', 'verify-workflow.mjs', 'verify-parity.mjs', 'audit-live.mjs'];
// 数据审计（读 data/scored-*.json，发现问题即非零退出）
const audits = ['audit-negatives.mjs', 'audit-cities.mjs'];

let allOk = true;

// 前置：审计与静态校验都依赖引擎产物，缺了就先说清楚，避免一堆 ENOENT 噪音
const need = ['data/scored-zhilian.json', 'data/scored-51job.json', 'data/dashboard-data.json'];
const lack = need.filter((f) => !fs.existsSync(f));
if (lack.length) {
  console.log(`❌ 缺少引擎产物：${lack.join('、')}\n   先跑: node score-engine.mjs（或 node build-dashboard.mjs）`);
  process.exit(1);
}

for (const s of suites) {
  const m = run('node', [s.script, '--make']);
  if (!m.ok) { say(false, `${s.name}：--make 失败 (${m.msg})`); allOk = false; continue; }
  for (const d of s.dirs) {
    const e = run('node', ['score-engine.mjs'], { DATA_DIR: d });
    if (!e.ok) { say(false, `${s.name}：引擎在 ${d} 失败 (${e.msg})`); allOk = false; }
  }
  const c = run('node', [s.script, '--check']);
  say(c.ok, s.name);
  if (!c.ok) allOk = false;
}
for (const u of units) {
  const r = run('node', [u.script]);
  say(r.ok, `${u.name}（${u.script}）`);
  if (!r.ok) allOk = false;
}
for (const v of verifiers) {
  const r = run('node', [v]);
  say(r.ok, v);
  if (!r.ok) allOk = false;
}
for (const a of audits) {
  if (!fs.existsSync(a)) { console.log(`⚠ ${a} 不存在，跳过`); continue; }
  const r = run('node', [a]);
  say(r.ok, a);
  if (!r.ok) allOk = false;
}

console.log('\n' + (allOk ? '🎉 全套回归通过' : '❗ 有失败项，见上'));
process.exit(allOk ? 0 : 1);
