/**
 * 口径一致性核验：看板展示的「工作内容」是否覆盖了评分引擎用来加分的模块。
 *
 * 背景（v2.0 起这条规则变了）：
 *   v1.x 时看板与引擎共用同一套 8 类词表，本脚本逐条比对两边命中的模块数组必须完全相同。
 *   v2.0 起看板改用更细的展示词表（13 项，含 SSC / 企业文化 / 考勤 / 社保公积金…），
 *   而评分引擎的「多模块（≥3 类）+5」仍用原来的 8 类——**故意不扩表**，
 *   否则几乎所有岗位都能凑满 3 类而白拿加分，分数整体虚高、推荐排序失真。
 *
 * 因此现在的不变式是「覆盖」而不是「相等」：
 *   引擎判定某个岗位命中某类模块 ⇒ 看板上必须能显示出与之对应的标签（允许拆成多项）。
 *   例如引擎的「薪酬」可能在看板上显示为「薪酬 / 社保公积金 / 考勤」中的任意一项。
 * 这样既不会漏掉评分依据，又允许展示更细。
 *
 * 分歧即非零退出（早先只打印、永远 exit 0，被当成通过＝假绿）。
 *
 * 用法: node verify-parity.mjs
 */
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
/* 项目根 == 仓库根：脚本所在目录就是看板产物目录 */
const KANBAN = process.env.KANBAN_DIR || __dir;
const SRC_HTML = path.join(KANBAN, '看板.html');
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
const KANBAN_MODULES = [...ctx.MODULES];

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
const ENGINE_LABELS = engCtx.MODULES.map((m) => m.label);

/* ---------- 3. 引擎模块 → 看板标签 的覆盖映射 ----------
   拆分类（引擎的一个模块在看板上被拆成多项）要列全，否则会误报「漏掉」。 */
const COVER = {
  '规划': ['人力规划'],
  '招聘': ['招聘'],
  '培训': ['培训'],
  '薪酬': ['薪酬', '社保公积金', '考勤'],   // 引擎的「薪酬」把社保/公积金/考勤都算在内
  '绩效': ['绩效'],
  '员关': ['员工关系', '企业文化'],          // 引擎的「员关」把员工活动/企业文化算在内
  '行政': ['行政'],
  'BP': ['HRBP'],
};

/* 映射自身自检：引擎每个模块都要有覆盖项，且覆盖项必须真的存在于看板词表 */
{
  const missing = ENGINE_LABELS.filter((l) => !COVER[l]);
  const bad = [];
  for (const l of Object.keys(COVER)) for (const k of COVER[l]) if (!KANBAN_MODULES.includes(k)) bad.push(`${l}→${k}`);
  if (missing.length) { console.log(`❌ 引擎模块缺少覆盖映射：${missing.join('、')}`); process.exit(1); }
  if (bad.length) { console.log(`❌ 映射指向了看板不存在的标签：${bad.join('、')}`); process.exit(1); }
}

/* ---------- 4. 逐条比对（全量已抓岗位，覆盖面最大） ---------- */
const jobs = [];
for (const f of ['data/scored-zhilian.json', 'data/scored-51job.json']) {
  for (const j of JSON.parse(fs.readFileSync(f, 'utf8'))) jobs.push({ t: j.title, jd: j.jobDescFull || j.jd || '' });
}

let same = 0, covered = 0, empty = 0;
const lost = [];
for (const j of jobs) {
  const page = kanbanModsOf(j.jd);
  const eng2 = engineModsOf(j.jd);
  if (!page.length && !eng2.length) empty++;
  if (JSON.stringify(page) === JSON.stringify(eng2)) same++;
  let ok = true;
  for (const label of eng2) {
    const cand = COVER[label] || [];
    if (!cand.some((k) => page.includes(k))) { ok = false; lost.push({ t: j.t, label, page, jd: (j.jd || '').slice(0, 100) }); }
  }
  if (ok) covered++;
}
console.log(`比对岗位 ${jobs.length} 条`);
console.log(`  引擎判定的模块在看板上均有对应标签：${covered}/${jobs.length}`);
console.log(`  两边命中完全相同的：${same} 条（看板词表更细，大部分会有额外标签，属预期）`);
console.log(`  双方均无模块：${empty} 条`);
for (const s of lost.slice(0, 8)) {
  console.log(`\n❌ ${s.t}\n   引擎模块「${s.label}」在看板上找不到对应标签\n   看板 ${JSON.stringify(s.page)}\n   JD: ${s.jd}`);
}
const fail = lost.length;
console.log(fail === 0
  ? `\n✅ 评分引擎认定的工作模块，看板全部能展示（看板词表 ${KANBAN_MODULES.length} 项 ⊇ 引擎 ${ENGINE_LABELS.length} 类的覆盖）`
  : `\n❌ 存在 ${fail} 处覆盖缺口`);
process.exit(fail === 0 ? 0 : 1);
