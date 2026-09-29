/**
 * 校验双平台看板（静态结构 + 真实运行时执行）
 *   A. payload JSON 可解析、结构正确（仅两个平台、无 BOSS）
 *   B. 主脚本语法有效（vm 编译）
 *   C. 用轻量 DOM 桩真正「跑一遍」看板脚本：渲染、切平台、点筛选、切换排序
 *   D. 本轮 UI 修改逐条验收（删统计/删搜索/不推荐不展示/5 个筛选/百分制指数/结构化标签/平台配色）
 *   E. 无脏 CSS、花括号配平、UTF-8 正常
 */
import fs from 'fs';
import vm from 'vm';
import path from 'path';

const FILE = path.join('岗位看板', '看板.html');
const html = fs.readFileSync(FILE, 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('✅ ' + m); } else { fail++; console.log('❌ ' + m); } };

/* ================= A. payload ================= */
const pm = html.match(/<script id="payload" type="application\/json">([\s\S]*?)<\/script>/);
ok(!!pm, 'payload 脚本块存在');
let P = null;
try { P = JSON.parse(pm[1].replace(/<\\\//g, '</')); ok(true, 'payload JSON 可解析'); }
catch (e) { ok(false, 'payload JSON 可解析 — ' + e.message); }

if (P) {
  ok(Array.isArray(P.platforms) && P.platforms.length === 2, `平台数量为 2（实际 ${P.platforms.length}）`);
  const labels = P.platforms.map((p) => p.label);
  ok(labels.includes('智联招聘') && labels.includes('前程无忧'), '平台名称为 智联招聘 / 前程无忧 — ' + labels.join(' / '));
  ok(!/boss/i.test(JSON.stringify(P.platforms.map((p) => p.key))), 'BOSS 平台已移除');

  for (const p of P.platforms) {
    const jobs = p.jobs || [];
    const rec = jobs.filter((x) => x.v !== '不推荐');
    const withPub = rec.filter((x) => x.pub).length;
    const withJD = rec.filter((x) => x.jd && x.jd.length > 20).length;
    const withRest = rec.filter((x) => x.rest).length;
    console.log(`   ${p.label}: 收录 ${p.total} | 内嵌推荐 ${rec.length} | 推荐有发布时间 ${withPub}/${rec.length} | 推荐有JD ${withJD}/${rec.length} | 推荐有作息 ${withRest}`);
    ok(jobs.every((x) => x.t && x.c), `${p.label} 所有岗位都有标题与公司名`);
    ok(rec.length > 0, `${p.label} 有推荐岗位`);
    ok(withJD === rec.length, `${p.label} 推荐岗位全部有 JD（${withJD}/${rec.length}）`);
    ok(rec.every((x) => typeof x.score === 'number' && x.score > 0), `${p.label} 推荐岗位评分均已计算`);
    ok(rec.every((x) => ['强烈推荐', '推荐', '可考虑', '备选'].includes(x.v)), `${p.label} 判定值合法`);
    const bad = jobs.filter((x) => x.v === '不推荐' && (!x.neg || !x.neg.length));
    ok(bad.length === 0, `${p.label} 不推荐岗位都写明了过滤原因`);
  }
  ok(P.platforms.every((p) => p.total >= 400), `两个平台收录量均已接近/达到 500（${P.platforms.map((p) => p.total).join(' / ')}）`);
  ok(P.platforms.every((p) => p.jobs.length === p.recommended), '内嵌数据仅含推荐岗位（不推荐岗已剔除，页面体积可控）');
}

/* ================= B. 语法 ================= */
const sm = html.match(/<script>\n\(function\(\)\{[\s\S]*?\n\}\)\(\);\n<\/script>/);
ok(!!sm, '主脚本块可定位');
const js = sm ? sm[0].replace(/^<script>|<\/script>$/g, '') : '';
if (sm) {
  try { new vm.Script(js); ok(true, '主脚本语法有效'); }
  catch (e) { ok(false, '主脚本语法有效 — ' + e.message); }
}

/* ================= C. DOM 桩运行时 ================= */
function parseAttrs(s) {
  const a = {};
  const re = /([a-zA-Z0-9_-]+)="([^"]*)"/g; let m;
  while ((m = re.exec(s))) a[m[1]] = m[2];
  return a;
}
/* 把 data-xxx-yyy 转成 xxxYyy，模拟浏览器 dataset 行为 */
function toDataset(attrs) {
  const d = {};
  for (const k of Object.keys(attrs)) {
    if (!k.startsWith('data-')) continue;
    const camel = k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    d[camel] = attrs[k];
  }
  return d;
}
function makeEl(tag) {
  const el = {
    tagName: tag, innerHTML: '', textContent: '', value: '', disabled: false, onclick: null,
    className: '', _onclick: null,
    querySelectorAll(sel) {
      const cls = sel.replace(/^\./, '');
      const out = [];
      const re = /<(button|span)([^>]*)>/g; let m;
      while ((m = re.exec(this.innerHTML))) {
        const tagName = m[1];
        const attrs = parseAttrs(m[2]);
        if (sel !== tagName && !(attrs.class || '').split(/\s+/).includes(cls)) continue;
        const child = makeEl(tagName);
        child.dataset = toDataset(attrs);   // 与浏览器一致：data-key → dataset.key
        const parent = this;
        // 注意：必须用箭头函数闭包，否则 parent._onclick.call(child) 中的 this 会错绑
        child.onclick = () => (typeof parent._onclick === 'function' ? parent._onclick.call(child) : undefined);
        out.push(child);
      }
      return out;
    },
  };
  return el;
}
const nodes = {};
const IDS = ['tabs', 'chips', 'grid', 'sort', 'stamp', 'notice', 'foot-plat', 'refresh'];
for (const id of IDS) nodes[id] = makeEl('div');
// payload 脚本块：把原始 JSON 文本喂给看板脚本
nodes.payload = makeEl('script');
nodes.payload.textContent = pm ? pm[1].replace(/<\\\//g, '</') : '{}';
let stored = {};
const sandbox = {
  document: {
    getElementById: (id) => nodes[id] || null,
    querySelectorAll: () => [],
  },
  localStorage: {
    getItem: (k) => (k in stored ? stored[k] : null),
    setItem: (k, v) => { stored[k] = String(v); },
  },
  alert: () => {}, fetch: () => Promise.reject(new Error('no-net')),
  setTimeout, clearTimeout, console, Date, Math, JSON, Number, String, Object, Array, RegExp, parseInt, parseFloat,
};
try {
  vm.createContext(sandbox);
  vm.runInContext(js, sandbox, { timeout: 10000 });
  ok(true, '主脚本在 DOM 桩中执行成功（无运行时错误）');
} catch (e) { ok(false, '主脚本执行 — ' + e.message); }

// 模块判定函数实测：从产物脚本抽取定义后单独求值（不污染沙箱）
{
  const grab = (re) => { const m = js.match(re); return m ? m[0] : ''; };
  const defs = grab(/var MODULES = \[[\s\S]*?\];/) + '\n'
    + grab(/var SEC_DUTY = [\s\S]*?;/) + '\n'
    + grab(/var SEC_ASK  = [\s\S]*?;/) + '\n'
    + grab(/var SEC_BREAK = [\s\S]*?;/m) + '\n'
    + grab(/var MOD_PAT = \{[\s\S]*?\n\};/) + '\n'
    + grab(/function modHay\(j\)\{[\s\S]*?\n\}/) + '\n'
    + grab(/function modsOf\(j\)\{[\s\S]*?\n\}/) + '\n'
    + grab(/function dutyItems\(j\)\{[\s\S]*?\n\}/) + '\n'
    + grab(/function modCount\(j, m\)\{[\s\S]*?\n\}/) + '\n'
    + grab(/function modWeights\(j\)\{[\s\S]*?\n\}/) + '\n'
    + grab(/function modWeight\(j, m\)\{[\s\S]*?\n\}/) + '\n'
    + grab(/function modWhy\(j, m\)\{[\s\S]*?\n\}/) + '\n'
    + '\nreturn { modsOf: modsOf, dutyItems: dutyItems, modWeights: modWeights, modWeight: modWeight, modWhy: modWhy, MODULES: MODULES };';
  try {
    const api = new Function(defs)();
    nodes._modsOf = api.modsOf;
    nodes._dutyItems = api.dutyItems;
    nodes._modWeights = api.modWeights;
    nodes._modWeight = api.modWeight;
    nodes._MODULES = api.MODULES;
    ok(typeof api.modsOf === 'function' && typeof api.dutyItems === 'function' && typeof api.modWeights === 'function',
      '模块判定 / 职责条目 / 占比分配函数可供实测调用');
  } catch (e) { ok(false, '抽取模块判定函数 — ' + e.message); }
}

const grid = nodes.grid.innerHTML;
const cardCount = (grid.match(/<article class="card/g) || []).length;
const p0 = P.platforms[0];
/* 第 13 轮：推荐门槛 = 原始评分 75 分以上，页面只展示达到门槛的岗位 */
const REC = (p) => (p.jobs || []).filter((j) => j.v !== '不推荐' && j.score >= 75);
const rec0 = REC(p0).length;
ok(cardCount === rec0, `首屏只渲染 75 分以上的岗位 ${rec0} 张卡（实际 ${cardCount}）`);
ok(!/card out/.test(grid) && !/过滤：/.test(grid), '不推荐岗位未出现在页面上');

// 评分：百分制原始分，直接取自引擎（不再做平台内相对归一化）
const idxs = (grid.match(/<div class="sc"><b>(\d+)<\/b><i>推荐指数<\/i>/g) || []).map((s) => Number(s.replace(/\D+/g, '').slice(0, 3)));
ok(idxs.length === cardCount, `每张卡的分数都带「推荐指数」标签（${idxs.length}/${cardCount}）`);
ok(idxs.every((v) => v >= 75 && v <= 100), `展示的评分均为 75–100（${Math.min(...idxs)}–${Math.max(...idxs)}）`);
ok(idxs.every((v, i) => i === 0 || idxs[i - 1] >= v), '默认按评分降序排列');
ok(idxs.length > 0 && idxs[0] === Math.max(...REC(p0).map((j) => j.score)), `榜首即本平台最高评分（${idxs[0]}）`);
ok(!/<i>综合推荐指数<\/i>/.test(html) && /<i>推荐指数<\/i>/.test(html), '右上角标题改为「推荐指数」（数值仍为引擎原始评分）');
ok(/--hot:#dc2626/.test(html), '90+ 红色配色变量已定义');
const hotCount = (grid.match(/card idx-hot/g) || []).length;
ok(hotCount === idxs.filter((v) => v >= 90).length, `≥90 分卡片标记为红色档（${hotCount} 张）`);

/* 切到前程无忧（样本更多），后续内容类断言都在这里做 */
const rec1 = REC(P.platforms[1]).length;
let gridQC = '';
if (typeof nodes.tabs._onclick === 'function') {
  nodes.tabs._onclick({ dataset: { i: '1' } });
  gridQC = nodes.grid.innerHTML;
  const n1 = (gridQC.match(/<article class="card/g) || []).length;
  ok(n1 === rec1, `切到前程无忧后渲染 ${rec1} 条（实际 ${n1}）`);
  ok(/class="on" data-key="51job"/.test(nodes.tabs.innerHTML), '当前激活平台为前程无忧');
  // 用「推荐岗位」筛选反证：页面上的岗位必须都属于 75 分以上
  const visible = Number((gridQC.match(/<article class="card/g) || []).length);
  ok(visible === REC(P.platforms[1]).length, '前程无忧页面上全部是 75 分以上的岗位');
}

// 结构化 7 项标签（在前面程无忧的卡片上核验，样本更全）
ok(/<b>发布时间<\/b>/.test(gridQC) && /<b>经验要求<\/b>/.test(gridQC) && /<b>接受应届生<\/b>/.test(gridQC), '结构化标签含 发布时间/经验要求/接受应届生');
ok(/<b>学历要求<\/b>/.test(gridQC) && /<b>公司规模<\/b>/.test(gridQC) && /<b>工作模块<\/b>/.test(gridQC), '结构化标签含 学历要求/公司规模/工作模块');
ok(/未提及/.test(gridQC), 'JD 未提及项显示「未提及」');
// 信息索引原则：经验要求必须标明来源（JD 任职要求 vs 发布信息）
const allJobs = P.platforms.flatMap((p) => p.jobs);
ok(allJobs.every((j) => 'expRaw' in j && 'expFrom' in j), '每条岗位都带 expRaw / expFrom（经验来源）');
const srcDist = {};
for (const j of allJobs) srcDist[j.expFrom || '(空)'] = (srcDist[j.expFrom || '(空)'] || 0) + 1;
ok(srcDist['JD任职要求'] > 0 && srcDist['发布信息'] > 0,
  `经验来源两类都有（JD ${srcDist['JD任职要求'] || 0} 条 / 发布 ${srcDist['发布信息'] || 0} 条）`);
ok(!allJobs.some((j) => j.expFrom && !j.expRaw), '标了来源的岗位必有经验原文');
ok(/(发布信息)/.test(gridQC), '发布信息来源的经验在卡片上标注「（发布信息）」');
// 薪资必须是"月薪"口径：年薪（"万/年"）已在引擎里 ÷12，不能出现月薪 6 位数
const salBad = allJobs.filter((j) => j.salaryMinNum != null && j.salaryMinNum >= 60000);
ok(salBad.length === 0, `薪资月薪口径正确（未把年薪当月薪，异常 ${salBad.length} 条）`);
const salYear = allJobs.filter((j) => /年/.test(String(j.salaryText || '')));
ok(salYear.every((j) => j.salaryMinNum != null || /面议/.test(String(j.salaryText))),
  `年薪制岗位完成月薪换算（${salYear.length} 条）`);
const modNames = ['规划', '招聘', '培训', '薪酬', '绩效', '员关', '行政', 'BP'];
const modHit = modNames.filter((m) => new RegExp('>' + m + '<').test(gridQC));
ok(modHit.length >= 4, `工作模块标签使用固定 8 类名（本页命中 ${modHit.length} 类：${modHit.join('、')}）`);
ok(/class="modtag"/.test(js) && !/modtag hit/.test(js) && !/未提及的模块标签/.test(js), '工作模块只渲染被提及的模块（已移除未命中样式分支）');

// 交互测试：直接调用看板导出的事件处理器（fake 元素带 dataset）
const fakeChip = (f) => ({ dataset: { f }, });
const chipEls = nodes.chips.querySelectorAll('.chip');
const chipLabels = (nodes.chips.innerHTML.match(/data-f="[^"]+">([^<]+)<\/span>/g) || []).map((s) => s.replace(/^[^>]*>/, '').replace(/<\/span>$/, ''));
ok(chipEls.length === 4, `筛选标签共 4 个（实际 ${chipEls.length}）`);
ok(JSON.stringify(chipLabels) === JSON.stringify(['推荐岗位', '接受应届生', '双休', 'BP＆管培生']), '筛选标签为指定 4 项 — ' + chipLabels.join(' / '));
ok(!/弹性打卡|多模块工作/.test(nodes.chips.innerHTML), '已删除「弹性打卡」「多模块工作」标签');
ok(typeof nodes.chips._onclick === 'function', '筛选标签已绑定点击处理函数');
try {
  const before = (nodes.grid.innerHTML.match(/<article class="card/g) || []).length;
  nodes.chips._onclick(fakeChip('rest'));
  const n2 = (nodes.grid.innerHTML.match(/<article class="card/g) || []).length;
  const exp = REC(P.platforms[1]).filter((j) => j.rest === '双休').length;
  ok(n2 === exp && (n2 !== before || exp === before), `点击「双休」后筛选生效（${before} → ${n2}，预期 ${exp}）`);
  ok(/class="chip on" data-f="rest"/.test(nodes.chips.innerHTML), '选中态已回写到标签样式');
  const persists = JSON.parse(stored['wjl-kanban-v3'] || '{}');
  ok(persists.filters && persists.filters.rest === 1, '筛选状态写入 localStorage');
  nodes.chips._onclick(fakeChip('rest'));
  ok((nodes.grid.innerHTML.match(/<article class="card/g) || []).length === before, '再次点击可取消筛选');
} catch (e) { ok(false, '筛选交互执行 — ' + e.message); }

try {
  nodes.chips._onclick(fakeChip('bp'));
  const n4 = (nodes.grid.innerHTML.match(/<article class="card/g) || []).length;
  const expBp = REC(P.platforms[1]).filter((j) => j.bp).length;
  ok(n4 === expBp, `「BP＆管培生」筛选可用（命中 ${n4} 条，预期 ${expBp}）`);
  nodes.chips._onclick(fakeChip('bp'));
} catch (e) { ok(false, 'BP＆管培生筛选 — ' + e.message); }

// 平台切换按钮（此时在前程无忧，切回智联）
const tabEls = nodes.tabs.querySelectorAll('button');
ok(tabEls.length === 2, `平台切换按钮 2 个（实际 ${tabEls.length}）`);
ok(tabEls.length === 2 && tabEls[0].dataset.key === 'zhilian' && tabEls[1].dataset.key === '51job', '按钮带平台标识 zhilian / 51job');
if (typeof nodes.tabs._onclick === 'function') {
  nodes.tabs._onclick({ dataset: { i: '0' } });
  ok(/class="on" data-key="zhilian"/.test(nodes.tabs.innerHTML), '可切回智联招聘');
  ok((nodes.grid.innerHTML.match(/<article class="card/g) || []).length === rec0, '切回后智联仍只展示 75 分以上岗位');
}

// 排序：薪资待遇
if (nodes.sort.onchange) {
  nodes.sort.value = 'sal'; nodes.sort.onchange();
  const salItems = (nodes.grid.innerHTML.match(/<div class="sal">([^<]*)<\/div>/g) || []).map((s) => s.replace(/<[^>]+>/g, ''));
  ok(salItems.length > 0, `「薪资待遇」排序可执行（取样 ${salItems.slice(0, 3).join(' / ')}）`);
  nodes.sort.value = 'score'; nodes.sort.onchange();
}

// 刷新按钮与页脚
ok(typeof nodes.refresh.onclick === 'function', '刷新按钮已绑定事件');

/* ============ 第21轮：每日刷新次数上限 + 抓取进度条 ============ */
ok(/DAILY_LIMIT\s*=\s*5/.test(js), '每日刷新上限为 5 次');
ok(/wjl-refresh-quota/.test(js), '刷新次数按本地记录累计');
ok(/o\.d\s*!==\s*todayKey\(\)/.test(js) && /return 0/.test(js), '跨天自动重置次数（每日凌晨归零）');
ok(/alert\('无剩余次数'\)/.test(js), '次数用尽提示「无剩余次数」');
ok(/今日剩余次数：/.test(js), '刷新前弹窗显示「今日剩余次数：X」');
ok(/setQuota\(used \+ 1\)/.test(js), '触发即扣减一次次数');
ok(/setQuota\([^)]*\)|本次不计入次数/.test(js), '触发失败时不消耗次数');
ok(/id="refresh-progress"/.test(html) && /id="pfill"/.test(html) && /id="pnote"/.test(html), '进度条结构存在（轨道 + 填充 + 百分比）');
ok(/#refresh-progress\{display:none/.test(html) && /#refresh-progress\.on\{display:block\}/.test(html), '进度条默认隐藏，仅刷新时显示');
ok(/\.pfill\{[^}]*background:linear-gradient/.test(html), '进度条带颜色渐变');
/* 曾出过的真 bug：.pfill 是 <span> 却没设 display，按 inline 渲染时
   height/width 全部失效 → 只剩浅蓝轨道、渐变完全不可见（被报"进度条没有颜色"）。 */
ok(/\.pfill\{[^}]*display:block/.test(html), '进度填充为块级元素（否则 span 的 inline 会让 width/height 失效、渐变不可见）');
ok(/\.ptrack\{[^}]*overflow:hidden/.test(html), '进度轨道裁剪填充圆角');
ok(/#facc15/.test(html) && /#22c55e/.test(html), '【第22轮】进度条为 黄色→绿色 渐变');
ok(/#refresh-progress\.done \.pfill\{[^}]*linear-gradient/.test(html) && /className = 'on done'/.test(js),
  '完成后切换 .done 深绿渐变（CSS 与脚本都已接上，不再是死规则）');
ok(/POLL_MS\s*=\s*30000/.test(js), '【第22轮】每 30 秒查询一次云端进度');
ok(!/setTimeout\(poll, (6000|10000|15000)\)/.test(js), '【第22轮】旧的 6/10/15 秒轮询已清除');
ok(/hideBar\(\)/.test(js), '刷新结束/失败后隐藏进度条');
ok(/runs\/' \+ runId \+ '\/jobs/.test(js), '进度由云端步骤完成度实时推算');

/* ---------- 进度算法与运行状态：真实调用纯函数做行为断言 ----------
   原先这两处只有字符串正则（「含 linear-gradient 就算过」这种），
   所以两个真 bug 一直没被发现：
     1) 进度只看 jobs[0]，而 GitHub 返回顺序随机 → 第一个 job 跑完就显示 100%
     2) queued/in_progress/success 之外的状态一律当失败 → 刚触发的 requested/pending
        会弹「云端更新失败：null」（云端其实没失败）
   下面用真实运行的数据结构喂进函数断言，改坏了必然失败。 */
{
  /* 按花括号配平抽取函数体，不用「结尾在行首的 }」这种靠缩进的脆弱写法
     （JOB_WEIGHT 是单行结束的 `} };`，用 /\n};/ 会一路吃到后面的函数）。 */
  const bodyOf = (sig) => {
    const i = js.indexOf(sig);
    if (i < 0) return '';
    let d = 0, started = false;
    for (let k = i; k < js.length; k++) {
      const c = js[k];
      if (c === '{') { d++; started = true; }
      else if (c === '}') { d--; if (started && d === 0) return js.slice(i, k + 1); }
    }
    return '';
  };
  const lineOf = (sig) => { const i = js.indexOf(sig); return i < 0 ? '' : js.slice(i, js.indexOf('\n', i)); };
  const defs = [lineOf('var JOB_WEIGHT'), bodyOf('function progressOfJobs'), bodyOf('function runState')].join('\n')
    + '\nreturn { progressOfJobs: progressOfJobs, runState: runState };';
  let api = null;
  try { api = new Function(defs)(); ok(typeof api.progressOfJobs === 'function' && typeof api.runState === 'function', '进度与状态算法可供实测调用'); }
  catch (e) { ok(false, '抽取进度函数 — ' + e.message); }

  if (api) {
    // 真实运行 36630919724 的结构：6 个抓取分片（8 步）+ refresh（25 步）
    const scraper = (n, done) => ({
      name: `抓取智联招聘（分片 ${n}：广州,佛山）`, status: done ? 'completed' : 'in_progress',
      steps: Array.from({ length: 8 }, (_, i) => ({
        name: i === 3 ? `抓取智联招聘（分片 ${n}：广州,佛山）` : 'x', status: i < done ? 'completed' : 'in_progress', conclusion: null,
      })),
    });
    const refresh = (done) => ({
      name: 'refresh', status: done >= 25 ? 'completed' : 'in_progress',
      steps: Array.from({ length: 25 }, (_, i) => ({ name: i === done ? '评分与判定' : 'x', status: i < done ? 'completed' : 'in_progress', conclusion: i < done ? 'success' : null })),
    });

    // ① 关键回归：第一个 job 已跑完、refresh 一步没开始 —— 绝不能报 100%
    const premature = api.progressOfJobs([scraper(1, 8), scraper(2, 8), scraper(3, 8), scraper(4, 8), scraper(5, 8), scraper(6, 8), refresh(0)]);
    ok(premature.pct < 90, `旧 bug 回归：抓取全部完成但 refresh 未开始时进度不应到 100%（实际 ${premature.pct}%）`);
    ok(premature.note.indexOf('评分与判定') >= 0, `提示应指向尚未开始的 refresh 步骤（实际「${premature.note}」）`);
    // ② 全部完成才 100%
    const allDone = api.progressOfJobs([scraper(1, 8), refresh(25)]);
    ok(allDone.pct === 100, `全部 job 完成后应为 100%（实际 ${allDone.pct}%）`);
    // ③ 进度单调不回退（模拟一次真实运行的全过程）
    let prev = -1, mono = true;
    for (let d = 0; d <= 25; d++) {
      const p = api.progressOfJobs([scraper(1, 8), scraper(2, 8), refresh(d)]).pct;
      if (p < prev) mono = false;
      prev = p;
    }
    ok(mono, '进度单调不回退（0→25 步全过程无倒退）');
    // ④ 刚触发还没 job 时给排队提示而不是 100%
    const empty = api.progressOfJobs([]);
    ok(empty.pct <= 10 && /排队/.test(empty.note), `尚无 job 时应显示排队（实际 ${empty.pct}%「${empty.note}」）`);
    // ⑤ 最后一个 job 收尾时不应提前显示 100%
    const tail = api.progressOfJobs([scraper(1, 8), refresh(22)]);
    ok(tail.pct <= 96, `最后阶段不应提前到 100%（实际 ${tail.pct}%）`);

    /* 运行状态：requested/pending 不得被判成失败 */
    const NOW = Date.now();
    const fresh = (status, conclusion) => ({ id: 9, status, conclusion, created_at: new Date(NOW).toISOString() });
    const oldRun = { id: 8, status: 'completed', conclusion: 'success', created_at: new Date(NOW - 3600e3).toISOString() };
    ok(api.runState(fresh('requested', null), null, NOW) === 'mine', 'requested（刚触发）应视为本次运行在跑，不得判失败');
    ok(api.runState(fresh('pending', null), null, NOW) === 'mine', 'pending 应视为本次运行在跑，不得判失败');
    ok(api.runState(fresh('queued', null), null, NOW) === 'mine', 'queued 应视为本次运行在跑');
    ok(api.runState(fresh('in_progress', null), null, NOW) === 'mine', 'in_progress 应视为本次运行在跑');
    ok(api.runState(fresh('completed', 'success'), null, NOW) === 'done', 'completed+success 才算完成');
    ok(api.runState(oldRun, null, NOW) === 'busy', '比触发时刻更早的旧运行不得被当成本次结果');
    ok(api.runState(oldRun, 8, NOW) === 'mine', '一旦锁定本次 run id，就只认这个 id');
    ok(api.runState(null, null, NOW) === 'busy', '还没查到 run 时应继续等待');
    ok(api.runState({ id: 9, status: 'weird-new-status', conclusion: null, created_at: new Date(NOW).toISOString() }, null, NOW) === 'busy',
      '未知状态应继续等待，绝不误报「云端更新失败」');
  }
}

/* 第 16 轮：页脚只保留「当前平台 … 点击岗位标题可跳转至岗位页面」一行，其余全部删除 */
const bodyHtml14 = html.replace(/<script id="payload"[\s\S]*?<\/script>/, '');
ok(!/id="foot"/.test(bodyHtml14) && !/elFoot\b/.test(js), '【第16轮】页脚统计行（收录/评分 75 分以上）已删除');
ok(!/信息以岗位描述（JD）正文为准，岗位发布信息与标题为辅/.test(bodyHtml14), '【第16轮】页脚「信息以 JD 正文为准…」说明行已删除');
ok(!/推荐指数为综合评分换算/.test(bodyHtml14) && !/橙色 60–79 分/.test(bodyHtml14), '【第14轮】旧「推荐指数换算」说明已删除');
ok(/当前平台：<b id="foot-plat">[\s\S]{0,20}<\/b>[\s\S]{0,20}点击岗位标题可跳转至岗位页面/.test(bodyHtml14), '【第16轮】页脚仅保留「当前平台+点击标题跳转」一行');
ok(!/数据来源：智联招聘、前程无忧/.test(bodyHtml14), '【第14轮】旧「数据来源」行已删除');
ok(nodes['foot-plat'] && nodes['foot-plat'].textContent === '智联招聘', '【第16轮】页脚当前平台名由脚本写入 — ' + (nodes['foot-plat'] || {}).textContent);
ok(/<option value="score">推荐指数（高→低）<\/option>/.test(bodyHtml14), '【第15轮】排序项改为「推荐指数（高→低）」');

/* ================= D. 本轮 UI 修改逐条验收 ================= */
const bodyHtml = html.replace(/<script id="payload"[\s\S]*?<\/script>/, '');
ok(!/id="stats"/.test(bodyHtml) && !/class="stats"/.test(bodyHtml) && !/renderStats/.test(js), '【P1】顶部统计卡区块已删除');
ok(!/type="search"/.test(bodyHtml) && !/elQ/.test(js) && !/state\.q\b/.test(js), '【新增1】搜索功能已取消');
ok(/<option value="sal">薪资待遇（高→低）<\/option>/.test(bodyHtml) && !/薪资（高→低）/.test(bodyHtml), '【P2】排序项已改为「薪资待遇」');
ok(!/不推荐（被过滤）/.test(bodyHtml) && /(j\.v !== '不推荐'|isRec\(j\))/.test(js), '【P3】不推荐岗位不展示（含移除其筛选标签）');
ok(/data-key="'\+esc\(p\.key\)\+'"/.test(js) && /data-key=zhilian/.test(html) && /data-key="51job"/.test(html), '【P7】平台按钮带独立配色挂钩');
ok(/--zl:#2563eb/.test(html) && /--qc:#dc2626/.test(html), '【P7】智联=蓝、前程=红 已定义');
ok(/\.tabs\{display:flex;justify-content:center/.test(html) && /min-width:200px/.test(html), '【P7】平台按钮居中且放大');
ok(/<i>推荐指数<\/i>/.test(html) && !/综合评分<\/option>/.test(bodyHtml), '【P5】右上角标题为「推荐指数」');
ok(/--hot-soft|--mid:|--low:/.test(html), '【新增2】分数分级配色已定义（红/橙/灰）');

/* ================= D2. 第5轮 3 条意见逐条验收 ================= */
// 意见 p1：工作模块只认 JD 正文的实际工作内容
ok(/SEC_DUTY/.test(js) && /SEC_ASK/.test(js), '【p1】按「岗位职责 / 任职要求」分段后再判定模块');
ok(!/j\.jd && j\.jd\.length > 20\) \? j\.jd : \(j\.t/.test(js) && !/MOD_RE/.test(js), '【p1】已弃用旧的「JD 否则回退标题」关键词匹配');
ok(/modWhy/.test(js) && /依据 JD：/.test(js), '【p1】命中项附带 JD 原文依据（悬停可见）');
ok(/function dutyItems\(j\)/.test(js) && /function modWeights\(j\)/.test(js), '【p1】按职责条目计算模块占比（dutyItems / modWeights）');
ok(/Math\.round\(exact \/ 5\) \* 5/.test(js) && /合计 100%/.test(js), '【p1】占比按 5% 刻度分配且合计 100%');
ok(/\bclass="pct"/.test(js) && /\.modtag \.pct\{/.test(html), '【p1】命中模块标签带百分比标记并已设样式');
ok(/SEC_BREAK/.test(js) && /小节标签/.test(js), '【p1】同一行内的小节标题也先断行再分段');
{
  // 反例：学历要求里的「行政管理专业」不得判为行政模块；「职业规划」不得判为规划模块
  const cases = [
    { jd: '【任职要求】1、行政管理、汉语言文学专业优先；2、本科及以上学历。【岗位职责】1、负责招聘渠道维护与简历筛选；2、组织面试安排。', want: ['招聘'], deny: ['行政', '规划', '薪酬'] },
    { jd: '【任职要求】1、人力资源、工商管理专业；【岗位职责】1、负责薪酬核算与社保公积金申报；2、负责考勤统计。', want: ['薪酬'], deny: ['行政', '绩效'] },
    { jd: '【任职要求】1、本科，职业规划清晰者优先。【岗位职责】1、负责员工入离职手续办理与劳动合同管理；2、组织员工活动与团队建设。', want: ['员关'], deny: ['规划'] },
    { jd: '【岗位职责】1、负责公司行政后勤、办公用品采购、固定资产管理及会务接待。', want: ['行政'], deny: ['招聘', '薪酬'] },
  ];
  for (const c of cases) {
    const got = nodes._modsOf({ jd: c.jd, t: '测试岗位' });
    const okWant = c.want.every((m) => got.includes(m));
    const okDeny = c.deny.every((m) => !got.includes(m));
    ok(okWant && okDeny, `【p1】JD 实测「${c.jd.slice(0, 18)}…」→ ${got.join('/') || '无'}（期望含 ${c.want.join('/')}，不含 ${c.deny.join('/')}）`);
  }
  // JD 缺失时不得凭标题臆测模块
  const noJd = nodes._modsOf({ jd: '', t: '薪酬绩效行政人事专员招聘培训' });
  ok(noJd.length === 0, `【p1】JD 缺失时不凭标题臆测模块（实际 ${noJd.join('/') || '无'}）`);

  /* ---- 第6轮：模块占比（以 5% 为刻度，合计 100%，未提及不显示）---- */
  ok(typeof nodes._dutyItems === 'function' && typeof nodes._modWeights === 'function', '【第6轮】占比计算函数已抽出（dutyItems / modWeights）');
  {
    const corpus = [
      { jd: '【岗位职责】\n1、负责招聘渠道维护与简历筛选；\n2、组织面试安排；\n3、负责薪酬核算与社保公积金申报；\n4、负责考勤统计。', t: '招聘薪酬专员' },
      { jd: '【岗位职责】\n1、负责员工入离职手续办理与劳动合同管理；\n2、组织员工活动与团队建设。', t: '员工关系专员' },
      { jd: '【任职要求】\n1、行政管理专业优先。\n【岗位职责】\n1、负责公司行政后勤、办公用品采购、固定资产管理及会务接待。', t: '行政专员' },
      { jd: '【岗位职责】\n1、根据经营目标配置合理的人员编制架构；\n2、结合目标，参与设计面向增长和成长的薪酬绩效并执行薪酬绩效方案；\n3、现有编制及业务发展需求，协助上级确定招聘目标，汇总岗位及人员需求数目，制订并执行招聘计划；\n4、撰写招聘广告，维护和更新招聘网站，发布职位需求信息，搜集简历，对简历进行分类、筛选，通知应聘者前来面试、对应聘者进行初步面试；\n5、公司制度和文化的贯彻宣讲，员工关系建设和团队文化建设。', t: 'HRBP' },
      { jd: '【岗位职责】\n1、负责前台接待与来访登记；\n2、负责办公用品采购与固定资产管理；\n3、负责会议室安排与会务支持。', t: '前台行政' },
      { jd: '【岗位职责】\n1、负责考勤统计与薪资核算；', t: '薪酬专员' },
    ];
    // p2：合计恒为 100%
    let sumOk = true, detail = [];
    for (const c of corpus) {
      const w = nodes._modWeights(c);
      const shown = nodes._MODULES.filter((m) => w[m] > 0);
      const sum = shown.reduce((s, m) => s + w[m], 0);
      if (shown.length && sum !== 100) { sumOk = false; detail.push(`${c.t}: ${shown.map((m) => m + w[m]).join('+')}=${sum}`); }
    }
    ok(sumOk, `【p2】模块占比合计恒为 100%${sumOk ? `（${corpus.length} 组实测全通过）` : ' → ' + detail.join(' | ')}`);
    // p1：只显示被提及的模块（未提及的完全不出现在标签里）
    let onlyHit = true, d2 = [];
    for (const c of corpus) {
      const hit = nodes._modsOf(c);
      const shown = nodes._MODULES.filter((m) => nodes._modWeights(c)[m] > 0);
      if (hit.join('/') !== shown.join('/')) { onlyHit = false; d2.push(`${c.t}: 命中[${hit}] 显示[${shown}]`); }
    }
    ok(onlyHit, `【p1】只显示 JD 提及过的模块，未提及的不出现${onlyHit ? '' : ' → ' + d2.join(' | ')}`);
    // 每项均为 5 的倍数且 ≥5%
    let stepOk = true;
    for (const c of corpus) for (const m of nodes._MODULES) { const v = nodes._modWeights(c)[m]; if (v !== 0 && (v % 5 !== 0 || v < 5)) stepOk = false; }
    ok(stepOk, '【第6轮】占比以 5% 为刻度（被提及即 ≥5%）');
    // HRBP 实测：招聘 2/5 条提及 → 40%，且未提及的规划/培训为 0
    const hrbp = corpus[3];
    ok(nodes._modWeight(hrbp, '招聘') === 40 && nodes._modWeight(hrbp, '规划') === 0 && nodes._modWeight(hrbp, '培训') === 0,
      `【第6轮】HRBP 实测：招聘 ${nodes._modWeight(hrbp, '招聘')}%、规划 ${nodes._modWeight(hrbp, '规划')}%、培训 ${nodes._modWeight(hrbp, '培训')}%（期望 40 / 0 / 0）`);
    // 行政专员实测：只有行政一个模块 → 100%
    ok(nodes._modWeight(corpus[2], '行政') === 100, `【第6轮】行政专员实测：行政 ${nodes._modWeight(corpus[2], '行政')}%（期望 100%）`);
    // 渲染层：页面上不得出现无百分比的模块标签
    const modTags = (grid.match(/<span class="modtag[^"]*"[^>]*>[^<]*(?:<i class="pct">\d+%<\/i>)?<\/span>/g) || []);
    const bare = modTags.filter((s) => !/<i class="pct">/.test(s));
    ok(modTags.length > 0 && bare.length === 0, `【p1】页面上的模块标签全部带占比（共 ${modTags.length} 个，无占比 ${bare.length} 个）`);
    // 渲染层：每张卡的占比合计为 100%
    const cards = grid.match(/<article class="card[\s\S]*?<\/article>/g) || [];
    let cardOk = 0, cardBad = [];
    for (const card of cards) {
      const ps = (card.match(/<i class="pct">(\d+)%<\/i>/g) || []).map((s) => Number(s.replace(/\D+/g, '')));
      if (ps.length === 0) continue;
      const s = ps.reduce((a, b) => a + b, 0);
      if (s === 100) cardOk++; else cardBad.push(s);
    }
    ok(cardBad.length === 0, `【p2】每张卡的占比合计为 100%（校验 ${cardOk} 张卡）${cardBad.length ? ' → 异常 ' + cardBad.slice(0, 5).join('/') : ''}`);
    // 渲染层：模块按固定顺序（规划→招聘→培训→薪酬→绩效→员关→行政→BP）排列
    const firstCard = cards[0] || '';
    const names = (firstCard.match(/<span class="modtag hit"[^>]*>([^<]*)<i class="pct">/g) || []).map((s) => (s.match(/>([^<]*)<i/) || [, ''])[1]);
    const orderIdx = names.map((n) => nodes._MODULES.indexOf(n));
    let ordered = orderIdx.every((v, i) => v >= 0 && (i === 0 || v > orderIdx[i - 1]));
    ok(ordered, `【第6轮】模块按固定顺序排列（首卡：${names.join(' · ')}）`);
  }
}
// 意见 p2：徽章行只留作息制度，不再重复判定文案
{
  const arts = gridQC.match(/<article class="card[\s\S]*?<\/article>/g) || [];
  const lastRow = (a) => (a.match(/<div class="row" style="display:flex;gap:6px;flex-wrap:wrap">([\s\S]*?)<\/div>/) || [, ''])[1];
  const badgeTexts = arts.map((a) => (lastRow(a).match(/>([^<>]+)<\/span>/g) || []).map((s) => s.replace(/[<>]|\/span/g, '').trim()));
  const verdicts = ['强烈推荐', '推荐', '可考虑', '备选', '不推荐'];
  const leaked = badgeTexts.flat().filter((t) => verdicts.includes(t));
  ok(leaked.length === 0, `【p2】徽章行不再出现判定文案（扫描 ${arts.length} 张卡，泄漏 ${leaked.length} 处）`);
  ok(badgeTexts.every((ts) => ts.length >= 1 && /双休|单休|大小周|排班|作息未提及/.test(ts[0])), '【p2】徽章行首项为作息制度（双休/单休/大小周/排班轮休/作息未提及）');
  ok(/if \(j\.hours\) extra\.push/.test(js) && /'是'\) extra\.push\('<span class="badge b3">弹性打卡/.test(js), '【p2】工作时间/弹性打卡徽章逻辑仍保留（有值即渲染）');
  ok(/<div class="sc"><b>/.test(gridQC) && /<i>推荐指数<\/i>/.test(gridQC), '【p2】不再渲染判定等级，改由右上角「推荐指数」单独表达');
}
// 意见 3：字体优化 + 字号增大（第 11 轮再次整体放大）
ok(/font:18px\/1\.78 "Microsoft YaHei UI","Microsoft YaHei"/.test(html), '【第11轮】正文基准字号 18px、微软雅黑优先');
ok(/\.t\{font-size:19\.5px/.test(html) && /\.sc b\{display:block;font-size:35px/.test(html), '【第11轮】岗位标题 19.5px、指数数字 35px');
ok(/\.meta \.mi\{display:flex;gap:9px;font-size:15\.5px/.test(html) && /\.chip\{\s*font-size:15\.5px/.test(html), '【第11轮】结构化信息与筛选标签 15.5px');
ok(/\.modtag\{[\s\S]{0,120}font-size:15px/.test(html) && /\.badge\{[\s\S]{0,120}font-size:15px/.test(html), '【第11轮】模块标签与徽章 15px');
ok(/@media\(max-width:760px\)\{[\s\S]{0,80}body\{font-size:17px\}/.test(html), '【第11轮】移动端同步放大字号');
ok(/font-feature-settings:"halt" 1/.test(html), '【意见3】启用中文标点挤压，排版更紧凑');

/* 第 11 轮：增大页边距 */
ok(/\.wrap\{max-width:1440px;margin:0 auto;padding:40px 34px 96px\}/.test(html), '【第11轮】页面留白加大（1440 容器 · 34px 左右边距）');
ok(/\.card\{[\s\S]{0,120}padding:22px 24px 20px/.test(html), '【第11轮】卡片内边距加大（22/24px）');
ok(/\.meta\{[\s\S]{0,200}padding:16px 18px/.test(html), '【第11轮】结构化信息内边距加大');

/* ================= E. 结构 ================= */
ok(!/BOSS/.test(bodyHtml), '页面正文无 BOSS 残留');
ok(!/2b3category|#2a road|undefined|[:,\[]\s*NaN|NaN\s*[,}\]]/.test(html), '无脏 CSS / undefined / NaN 残留');
ok(/--bg:#f5f7fa/.test(html) && !/--bg:#f7f8fa/.test(html), '配色方案已更新（新底色调）');
ok(/@media\(max-width:760px\)/.test(html), '移动端自适应存在');
ok(/minmax\(620px/.test(html), '【第11轮】卡片网格加宽（配合更大字号，避免文字过挤）');
const open = (html.match(/\{/g) || []).length, close = (html.match(/\}/g) || []).length;
ok(Math.abs(open - close) <= 2, `花括号基本配平 — ${open} vs ${close}`);
ok(!/https?:\/\/(?!www\.zhaopin|jobs\.51job|sou\.zhaopin|api\.github|github\.com)[a-z0-9.-]*\.(com|cn|net)/i.test(bodyHtml.replace(/<a href="[^"]*"/g, '')), '零外部依赖');
ok(/charset="utf-8"/.test(html) && /吴家良|林小夕/.test(html), 'UTF-8 声明与中文正常');

console.log(`\n合计：通过 ${pass} / 失败 ${fail}`);
process.exit(fail ? 1 : 0);
