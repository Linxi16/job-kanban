/**
 * 口径一致性核验：看板（templates/dashboard.js）的模块判定逻辑
 * 与评分引擎（score-engine.mjs）的 moduleHay + MODULES 是否完全同源。
 *
 * 为什么需要它：这两个地方各自维护了一份"职责段切分 + 模块关键词"的实现
 * （看板是浏览器端 JS，引擎是 Node ESM），改了一处忘了另一处，
 * 就会出现"看板显示的模块"和"引擎用来加分的模块"不一致——岗位评分看着对、
 * 展示却对不上。本脚本对全部岗位逐条比对命中的模块数组。
 *
 * 原先它只打印、永远 exit 0（被当成通过=假绿），现在分歧即非零退出。
 *
 * 用法: node verify-parity.mjs
 */
import fs from 'node:fs';
import vm from 'node:vm';

const SRC_HTML = '岗位看板/看板.html';
for (const f of [SRC_HTML, 'score-engine.mjs', 'data/scored-zhilian.json', 'data/scored-51job.json']) {
  if (!fs.existsSync(f)) { console.log(`❌ 缺少 ${f}，先跑 node build-dashboard.mjs`); process.exit(1); }
}

/* ---------- 1. 从看板产物里抽取函数定义并求值 ---------- */
const html = fs.readFileSync(SRC_HTML, 'utf8');
const grab = (re) => { const m = re.exec(html); if (!m) throw new Error('抽取失败: ' + re); return m[0]; };
const src = [
  grab(/var MODULES = \[[\s\S]*?\];/),
  grab(/var SEC_DUTY = [\s\S]*?;\n/),
  grab(/var SEC_ASK  = [\s\S]*?;\n/),
  grab(/var MOD_PAT = \{[\s\S]*?\n\};/),
  grab(/var SEC_BREAK = [\s\S]*?;\n/),
  grab(/function modHay\(j\)\{[\s\S]*?\n\}/),
  grab(/function modsOf\(j\)\{[\s\S]*?\n\}/),
].join('\n');
const ctx = { console, Math, JSON, RegExp, String, Number, Object, Array, parseInt, parseFloat };
vm.createContext(ctx);
vm.runInContext(src + '\nthis.modsOf = modsOf; this.MODULES = MODULES;', ctx);
const kanbanModsOf = (jd) => ctx.modsOf({ jd });

/* ---------- 2. 复刻评分引擎的 moduleHay + MODULES ---------- */
const eng = fs.readFileSync('score-engine.mjs', 'utf8');
const cut = (re, text) => { const m = re.exec(text); if (!m) throw new Error('引擎抽取失败: ' + re); return m[0]; };
const engSrc = [
  cut(/const SEC_DUTY = .*\n/, eng),
  cut(/const SEC_ASK  = .*\n/, eng),
  cut(/const SEC_BREAK = .*\n/, eng),
  cut(/const MODULES = \[[\s\S]*?\n\];/, eng),
  cut(/function moduleHay\(jd\) \{[\s\S]*?\n\}/, eng),
].join('\n');
const engCtx = { console, Math, JSON, RegExp, String, Number, Object, Array, parseInt, parseFloat };
vm.createContext(engCtx);
vm.runInContext(engSrc + '\nthis.moduleHay = moduleHay; this.MODULES = MODULES;', engCtx);
const engineModsOf = (jd) => {
  const hay = engCtx.moduleHay(jd);
  return hay ? engCtx.MODULES.filter((m) => m.re.test(hay)).map((m) => m.label) : [];
};

/* ---------- 3. 逐条比对（全量已抓岗位，覆盖面最大） ---------- */
const jobs = [];
for (const f of ['data/scored-zhilian.json', 'data/scored-51job.json']) {
  for (const j of JSON.parse(fs.readFileSync(f, 'utf8'))) jobs.push({ t: j.title, jd: j.jobDescFull || j.jd || '' });
}

let same = 0, diff = 0, empty = 0;
const samples = [];
for (const j of jobs) {
  const a = kanbanModsOf(j.jd);
  const b = engineModsOf(j.jd);
  if (!a.length && !b.length) empty++;
  if (JSON.stringify(a) === JSON.stringify(b)) same++;
  else { diff++; if (samples.length < 8) samples.push({ t: j.t, kanban: a, engine: b, jd: (j.jd || '').slice(0, 120) }); }
}
console.log(`比对岗位 ${jobs.length} 条：一致 ${same}，不一致 ${diff}，双方均无模块 ${empty}`);
for (const s of samples) {
  console.log(`\n❌ ${s.t}\n   看板 ${JSON.stringify(s.kanban)}\n   引擎 ${JSON.stringify(s.engine)}\n   JD: ${s.jd}`);
}
console.log(diff === 0 ? '\n✅ 看板与评分引擎的模块口径完全一致' : `\n❌ 存在 ${diff} 条口径分歧`);
process.exit(diff === 0 ? 0 : 1);
