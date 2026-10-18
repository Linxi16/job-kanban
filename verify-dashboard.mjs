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
import { fileURLToPath } from 'url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const KANBAN = process.env.KANBAN_DIR
  || (fs.existsSync(path.join(__dir, '..', '岗位看板')) ? path.join(__dir, '..', '岗位看板') : path.join(__dir, '岗位看板'));
const FILE = path.join(KANBAN, '看板.html');
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
    const withJD = jobs.filter((x) => x.jd && x.jd.length > 20).length;
    const withRest = jobs.filter((x) => x.rest).length;
    console.log(`   ${p.label}: 收录 ${p.total} | 内嵌 ${jobs.length} | 有JD ${withJD}/${jobs.length} | 有作息 ${withRest}`);
    ok(jobs.every((x) => x.t && x.c), `${p.label} 所有岗位都有标题与公司名`);
    ok(jobs.length === p.total, `${p.label} v2.0 内嵌全部岗位（${jobs.length}/${p.total}）`);
    /* 抓取端偶尔会漏 JD（引擎会保留岗位、不给"按 JD 加分"）。
       不能要求 100%——线上一度是 499/500，本地旧数据恰好 500/500，写死就变成假红。 */
    ok(withJD >= jobs.length - Math.max(1, Math.round(jobs.length * 0.02)),
      `${p.label} 绝大多数岗位有 JD（${withJD}/${jobs.length}）`);
    ok(jobs.filter((x) => !x.jd || x.jd.length <= 20).every((x) => x.t && x.c),
      `${p.label} 无 JD 的岗位仍然展示（不因缺 JD 被丢弃）`);
    ok(jobs.every((x) => typeof x.score === 'number' && x.score >= 0), `${p.label} 全部岗位评分均已计算`);
    ok(jobs.every((x) => ['强烈推荐', '推荐', '可考虑', '备选', '不推荐'].includes(x.v)), `${p.label} 判定值合法（含「不推荐」）`);
    const bad = jobs.filter((x) => x.v === '不推荐' && (!x.neg || !x.neg.length));
    ok(bad.length === 0, `${p.label} 不推荐岗位都写明了过滤原因`);

    /* v2.0 P2/P4：接受应届生为三态，且必须是 是/否/？ 之一 */
    ok(jobs.every((x) => ['是', '否', '？'].includes(x.fr)), `${p.label} 接受应届生三态取值合法`);
    const frDist = {};
    for (const x of jobs) frDist[x.fr] = (frDist[x.fr] || 0) + 1;
    ok((frDist['是'] || 0) > 0 && (frDist['否'] || 0) > 0,
      `${p.label} 三态分布合理（是 ${frDist['是'] || 0} / 否 ${frDist['否'] || 0} / ？ ${frDist['？'] || 0}）`);
    /* 「经验不限 / 无需经验 / 在校生·应届生」必须判为「是」，写明要年限的必须判为「否」 */
    const yesRaw = jobs.filter((x) => /经验不限|无需经验|在校生|应届/.test(String(x.expRaw || '')));
    ok(yesRaw.length > 0 && yesRaw.every((x) => x.fr === '是'),
      `${p.label} 经验不限/无需经验/在校生一律判「是」（${yesRaw.length} 条）`);
    const noRaw = jobs.filter((x) => /^\d/.test(String(x.expRaw || '')) && !/不限|无需|在校生|应届/.test(String(x.expRaw || '')) && !x.fresh);
    ok(noRaw.length > 0 && noRaw.every((x) => x.fr === '否'),
      `${p.label} 明确写明年限且未声明接受应届的判「否」（含「1年以下」，${noRaw.length} 条）`);

    /* v2.0 P1：作息只允许四种制度或空 */
    ok(jobs.every((x) => !x.rest || ['双休', '单休', '大小周', '排班轮休'].includes(x.rest)),
      `${p.label} 作息取值只可能是四种制度或为空`);

    /* 需求4 依赖：每条都要有完整发布时间戳（24 小时窗口不能用日期粗算） */
    ok(jobs.every((x) => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(x.ts || '')),
      `${p.label} 每条岗位都有完整发布时间戳`);
  }
  ok(P.platforms.every((p) => p.total >= 400), `两个平台收录量均已接近/达到 500（${P.platforms.map((p) => p.total).join(' / ')}）`);
  ok(P.platforms.every((p) => p.jobs.length === p.total), 'v2.0：不再剔除「不推荐」，抓到的岗位全部内嵌展示');
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
    className: '', _onclick: null, _attrs: {},
    getAttribute(n) { return this._attrs[n] == null ? null : this._attrs[n]; },
    setAttribute(n, v) { this._attrs[n] = String(v); },
    insertAdjacentHTML(_pos, h) { this.innerHTML += h; },
    querySelectorAll(sel) {
      /* 真实 DOM 里同一个元素每次查询都返回同一个对象——脚本正是靠这个
         给按钮绑 onclick。若每次新建对象，外部再查一次拿到的就是没有处理函数的副本。 */
      this._cacheMap = this._cacheMap || {};
      if (this._cacheInner === this.innerHTML && this._cacheMap[sel]) return this._cacheMap[sel];
      const cls = sel.replace(/^\./, '');
      const out = [];
      const re = /<(button|span)([^>]*)>/g; let m;
      while ((m = re.exec(this.innerHTML))) {
        const tagName = m[1];
        const attrs = parseAttrs(m[2]);
        if (sel !== tagName && !(attrs.class || '').split(/\s+/).includes(cls)) continue;
        const child = makeEl(tagName);
        child._attrs = attrs;
        child.dataset = toDataset(attrs);   // 与浏览器一致：data-key → dataset.key
        const parent = this;
        // 注意：必须用箭头函数闭包，否则 parent._onclick.call(child) 中的 this 会错绑
        child.onclick = () => (typeof parent._onclick === 'function' ? parent._onclick.call(child) : undefined);
        out.push(child);
      }
      this._cacheMap = {}; this._cacheInner = this.innerHTML; this._cacheMap[sel] = out;
      return out;
    },
  };
  return el;
}
const nodes = {};
const IDS = ['tabs', 'chips', 'grid', 'more', 'sort', 'stamp', 'notice', 'foot-plat', 'refresh',
  'q', 'smode', 'toast', 'changelog', 'last-refresh', 'refresh-progress', 'pfill', 'pnote'];
for (const id of IDS) nodes[id] = makeEl('div');
// payload 脚本块：把原始 JSON 文本喂给看板脚本
nodes.payload = makeEl('script');
nodes.payload.textContent = pm ? pm[1].replace(/<\\\//g, '</') : '{}';
/* 动态元素（如「加载更多」按钮）：代码用 getElementById 取回后绑 onclick，
   必须返回同一个对象才能触发，所以按 id 缓存。 */
const dyn = {};
function dynamicEl(id) {
  if (dyn[id]) return dyn[id];
  for (const k of Object.keys(nodes)) {
    if (nodes[k].innerHTML && nodes[k].innerHTML.indexOf('id="' + id + '"') >= 0) return (dyn[id] = makeEl('div'));
  }
  return null;
}
let stored = {};
const sessionStored = {};
const sandbox = {
  document: {
    getElementById: (id) => nodes[id] || dynamicEl(id),
    querySelectorAll: () => [],
  },
  localStorage: {
    getItem: (k) => (k in stored ? stored[k] : null),
    setItem: (k, v) => { stored[k] = String(v); },
  },
  sessionStorage: {
    getItem: (k) => (k in sessionStored ? sessionStored[k] : null),
    setItem: (k, v) => { sessionStored[k] = String(v); },
    removeItem: (k) => { delete sessionStored[k]; },
  },
  alert: () => {}, fetch: () => Promise.reject(new Error('no-net')),
  setTimeout, clearTimeout, console, Date, Math, JSON, Number, String, Object, Array, RegExp, parseInt, parseFloat,
};
/* 静态 HTML 里的「搜索模式切换」与「更新日志弹窗」是模板写死的，
   DOM 桩不会解析静态标记，这里把真实片段灌进去，才能测到点击行为 */
const smodeHtml = (html.match(/<div class="smode" id="smode">([\s\S]*?)<\/div>/) || [, ''])[1];
nodes.smode.innerHTML = smodeHtml;
nodes.changelog.innerHTML = '<button class="primary mok" id="changelog-ok">我知道了</button>';
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
    + grab(/function modCount\(items, m\)\{[\s\S]*?\n\}/) + '\n'
    + grab(/function coreTop\(j, n\)\{[\s\S]*?\n\}/) + '\n'
    + grab(/function modWhy\(j, m\)\{[\s\S]*?\n\}/) + '\n'
    + '\nreturn { modsOf: modsOf, dutyItems: dutyItems, coreTop: coreTop, modWhy: modWhy, MODULES: MODULES, MOD_PAT: MOD_PAT };';
  try {
    const api = new Function(defs)();
    nodes._modsOf = api.modsOf;
    nodes._dutyItems = api.dutyItems;
    nodes._coreTop = api.coreTop;
    nodes._modWhy = api.modWhy;
    nodes._MODULES = api.MODULES;
    nodes._MOD_PAT = api.MOD_PAT;
    ok(typeof api.modsOf === 'function' && typeof api.dutyItems === 'function' && typeof api.coreTop === 'function',
      '模块判定 / 职责条目 / 核心工作内容（取前 3）函数可供实测调用');
  } catch (e) { ok(false, '抽取模块判定函数 — ' + e.message); }
}

const grid = nodes.grid.innerHTML;
const cardCount = (grid.match(/<article class="card/g) || []).length;
const p0 = P.platforms[0];
const PAGE = 50;          // 与 templates/dashboard.js 的分批渲染常量一致
const REC = (p) => (p.jobs || []).filter((j) => j.v !== '不推荐' && j.score >= 75);
/* v2.0：抓到的岗位全部参与展示与检索，不再按 75 分筛；
   首屏只渲染前 PAGE 条——1000 条一次性渲染会产生 4~5 万个 DOM 节点，手机会卡。 */
const rec0 = Math.min(PAGE, (p0.jobs || []).length);
ok(cardCount === rec0, `首屏按分批渲染展示 ${rec0} 张卡（实际 ${cardCount}）`);
const remain0 = (p0.jobs || []).length - cardCount;
ok(nodes.more.innerHTML.indexOf('还有 ' + remain0 + ' 条') >= 0,
  `「加载更多」标出剩余条数（还有 ${remain0} 条）`);

// 评分：百分制原始分，直接取自引擎（不再做平台内相对归一化）
const idxs = (grid.match(/<div class="sc"><b>(\d+)<\/b><i>推荐指数<\/i>/g) || []).map((s) => Number(s.replace(/\D+/g, '').slice(0, 3)));
ok(idxs.length === cardCount, `每张卡的分数都带「推荐指数」标签（${idxs.length}/${cardCount}）`);
ok(idxs.every((v) => v >= 0 && v <= 100), `展示的评分均为 0–100（${Math.min(...idxs)}–${Math.max(...idxs)}）`);
ok(idxs.every((v, i) => i === 0 || idxs[i - 1] >= v), '默认按评分降序排列');
ok(idxs.length > 0 && idxs[0] === Math.max(...(p0.jobs || []).map((j) => j.score)), `榜首即本平台最高评分（${idxs[0]}）`);
ok(!/<i>综合推荐指数<\/i>/.test(html) && /<i>推荐指数<\/i>/.test(html), '右上角标题改为「推荐指数」（数值仍为引擎原始评分）');
ok(/--hot:#dc2626/.test(html), '90+ 红色配色变量已定义');
const hotCount = (grid.match(/card idx-hot/g) || []).length;
ok(hotCount === idxs.filter((v) => v >= 90).length, `≥90 分卡片标记为红色档（${hotCount} 张）`);

/* 切到前程无忧（样本更多），后续内容类断言都在这里做 */
const rec1 = Math.min(PAGE, (P.platforms[1].jobs || []).length);
let gridQC = '';
if (typeof nodes.tabs._onclick === 'function') {
  nodes.tabs._onclick({ dataset: { i: '1' } });
  gridQC = nodes.grid.innerHTML;
  const n1 = (gridQC.match(/<article class="card/g) || []).length;
  ok(n1 === rec1, `切到前程无忧后渲染 ${rec1} 条（实际 ${n1}）`);
  ok(/class="on" data-key="51job"/.test(nodes.tabs.innerHTML), '当前激活平台为前程无忧');
  // 页签上的「推荐 N / 收录 M」必须与实际数据一致
  const recN = REC(P.platforms[1]).length;
  ok(nodes.tabs.innerHTML.indexOf('推荐 ' + recN) >= 0 && nodes.tabs.innerHTML.indexOf('收录 ' + P.platforms[1].total) >= 0,
    `页签计数正确（推荐 ${recN} / 收录 ${P.platforms[1].total}）`);
}

// 结构化标签（在前面程无忧的卡片上核验，样本更全）
ok(/<b>发布时间<\/b>/.test(gridQC) && /<b>经验要求<\/b>/.test(gridQC) && /<b>接受应届生<\/b>/.test(gridQC), '结构化标签含 发布时间/经验要求/接受应届生');
ok(/<b>学历要求<\/b>/.test(gridQC) && /<b>公司规模<\/b>/.test(gridQC) && /<b>工作模块<\/b>/.test(gridQC), '结构化标签含 学历要求/公司规模/工作模块');
/* 「未提及」与「？」的渲染改由后面的合成数据测试覆盖：
   真实数据里字段恰好都齐全时，这条会变成"看数据脸色"的弱断言。 */
// 信息索引原则：经验要求必须标明来源（JD 任职要求 vs 发布信息）
const allJobs = P.platforms.flatMap((p) => p.jobs);
ok(allJobs.every((j) => 'expRaw' in j && 'expFrom' in j), '每条岗位都带 expRaw / expFrom（经验来源）');
const srcDist = {};
for (const j of allJobs) srcDist[j.expFrom || '(空)'] = (srcDist[j.expFrom || '(空)'] || 0) + 1;
ok(srcDist['JD任职要求'] > 0 && srcDist['发布信息'] > 0,
  `经验来源两类都有（JD ${srcDist['JD任职要求'] || 0} 条 / 发布 ${srcDist['发布信息'] || 0} 条）`);
ok(!allJobs.some((j) => j.expFrom && !j.expRaw), '标了来源的岗位必有经验原文');
/* v2.0 P3：卡片上不再出现「（发布信息）」这类来源后缀 */
ok(!/（发布信息）/.test(gridQC), '经验要求不再追加「（发布信息）」来源后缀');
// 薪资必须是"月薪"口径：年薪（"万/年"）已在引擎里 ÷12，不能出现月薪 6 位数
const salBad = allJobs.filter((j) => j.salaryMinNum != null && j.salaryMinNum >= 60000);
ok(salBad.length === 0, `薪资月薪口径正确（未把年薪当月薪，异常 ${salBad.length} 条）`);
const salYear = allJobs.filter((j) => /年/.test(String(j.salaryText || '')));
ok(salYear.every((j) => j.salaryMinNum != null || /面议/.test(String(j.salaryText))),
  `年薪制岗位完成月薪换算（${salYear.length} 条）`);

/* v2.0 P5：工作模块 = 从 JD 提炼的核心工作内容，取前 3、不带百分比、按权重排序 */
const MODS = nodes._MODULES || [];
const modTags = [...gridQC.matchAll(/<span class="modtag[^"]*"[^>]*>([^<]+)<\/span>/g)].map((m) => m[1]);
ok(modTags.length > 0 && modTags.every((t) => MODS.includes(t) || t === '？'),
  `工作模块标签均来自词表（本页 ${new Set(modTags).size} 种）`);
ok(new Set(modTags).size >= 4, `本页出现 ≥4 种工作内容标签（${[...new Set(modTags)].sort().join('、')}）`);
ok(!/<i class="pct">/.test(js) && !/modWeights/.test(js), '已移除百分比标记与占比算法（改为只取前 3 项）');
ok(/function coreTop\(j, n\)/.test(js) && /slice\(0, n \|\| 3\)/.test(js), '核心工作内容「取前 3 项」逻辑存在');
// 每张卡最多 3 个模块标签
{
  const cards = gridQC.split('<article class="card').slice(1);
  const counts = cards.map((c) => (c.split('<span class="modtag').length - 1));
  ok(counts.every((n) => n <= 3), `每张卡最多显示 3 个核心工作内容（最多 ${Math.max(...counts)}）`);
  ok(counts.some((n) => n === 3), '存在正好显示 3 项核心工作内容的卡片');
}
ok(/class="modtag"/.test(js) && !/modtag hit/.test(js) && !/未提及的模块标签/.test(js), '工作模块只渲染被提及的项（已移除未命中样式分支）');
ok(MODS.length >= 12 && MODS.every((m) => m.length >= 2 && m.length <= 5), `词表 ${MODS.length} 项，标签均为 2–5 字`);
ok(MODS.includes('SSC') && MODS.includes('招聘') && MODS.includes('行政') && MODS.includes('HRBP'),
  '词表覆盖求职方向：招聘 / 行政 / SSC / HRBP');

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
  const exp = Math.min(PAGE, (P.platforms[1].jobs || []).filter((j) => j.rest === '双休').length);
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
  const expBp = Math.min(PAGE, (P.platforms[1].jobs || []).filter((j) => j.bp).length);
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
  ok((nodes.grid.innerHTML.match(/<article class="card/g) || []).length === rec0, '切回后智联仍是分批渲染（首屏 50 条），但可加载到全部岗位');
}

/* ================= v2.0 交互实测（真实调用，不查字符串）=================
   覆盖四个用户可见的新功能：分批加载、岗位/公司搜索、刷新后提示、更新日志弹窗 */
const cardN = () => (nodes.grid.innerHTML.match(/<article class="card/g) || []).length;
const cardTitles = () => [...nodes.grid.innerHTML.matchAll(/<h2 class="t">(?:<a[^>]*>)?([^<]*)/g)].map((m) => m[1]);
const cardComps = () => [...nodes.grid.innerHTML.matchAll(/<div class="co"><span>([^<]*)/g)].map((m) => m[1]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 1) 分批加载：首屏 50 → 点「加载更多」变 100 */
{
  const b = cardN();
  if (dyn.loadmore && typeof dyn.loadmore.onclick === 'function') {
    dyn.loadmore.onclick();
    const a = cardN();
    ok(a === Math.min(PAGE * 2, (p0.jobs || []).length), `【v2.0】「加载更多」再渲染一批（${b} → ${a}）`);
  } else ok(false, '【v2.0】「加载更多」按钮已绑定点击');
}

/* 2) 搜索：岗位名 */
{
  nodes.q.value = '人事';
  nodes.q.oninput.call(nodes.q);
  await sleep(350);
  const n = cardN(), titles = cardTitles();
  const exp = Math.min(PAGE, (p0.jobs || []).filter((j) => String(j.t).includes('人事')).length);
  ok(n === exp && n > 0, `【v2.0】按岗位名搜索「人事」命中 ${n} 条（预期 ${exp}）`);
  ok(titles.length === n && titles.every((t) => t.includes('人事')), '【v2.0】搜索结果里每张卡的岗位名都含关键词');
}

/* 3) 搜索：切到「公司」索引 */
{
  const coBtn = nodes.smode.querySelectorAll('.sm').filter((b) => b.getAttribute('data-m') === 'co')[0];
  if (coBtn) {
    coBtn.onclick();                       // 切换索引方式
    ok(nodes.q.placeholder.indexOf('公司') >= 0, '【v2.0】切到公司模式后输入框提示同步变化');
    nodes.q.value = '深圳';
    nodes.q.oninput.call(nodes.q);
    await sleep(350);
    const comps = cardComps();
    const exp = Math.min(PAGE, (p0.jobs || []).filter((j) => String(j.c).includes('深圳')).length);
    ok(comps.length === exp && comps.length > 0, `【v2.0】按公司名搜索「深圳」命中 ${comps.length} 条（预期 ${exp}）`);
    ok(comps.every((c) => c.includes('深圳')), '【v2.0】公司索引下每张卡的公司名都含关键词');
    // 复位
    nodes.q.value = '';
    nodes.q.oninput.call(nodes.q);
    await sleep(250);
    const jobBtn = nodes.smode.querySelectorAll('.sm').filter((b) => b.getAttribute('data-m') === 'job')[0];
    if (jobBtn) jobBtn.onclick();
    await sleep(100);
    ok(cardN() === Math.min(PAGE, (p0.jobs || []).length), '【v2.0】清空关键词后恢复全部岗位');
  } else ok(false, '【v2.0】「公司」索引按钮可点击');
}

/* 4) 更新日志：每日首次弹出，点「我知道了」后当天不再弹 */
{
  ok(nodes.changelog.className === 'modal on', '【v2.0】当天首次进入会弹出更新日志');
  const okBtn = dyn['changelog-ok'];
  if (okBtn && typeof okBtn.onclick === 'function') {
    okBtn.onclick();
    const d = new Date();
    const today = d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
    ok(stored['wjl-changelog-seen'] === today, '【v2.0】点「我知道了」记录当天日期');
    ok(nodes.changelog.className === 'modal', '【v2.0】点击后弹窗关闭');
    // 同一天再次进入：不应再弹
    try { vm.runInContext(js, sandbox, { timeout: 10000 }); } catch (e) { ok(false, '二次进入执行 — ' + e.message); }
    ok(nodes.changelog.className === 'modal', '【v2.0】同一天再次进入不再弹出更新日志');
  } else ok(false, '【v2.0】「我知道了」按钮可点击');
}

/* 5) 刷新完成后的 5 秒提示：今日新增 X 个岗位，其中推荐 Y 个 */
{
  sessionStored['wjl-just-refreshed'] = '1';
  try { vm.runInContext(js, sandbox, { timeout: 10000 }); } catch (e) { ok(false, '刷新后重载执行 — ' + e.message); }
  // 独立复算期望值：以 builtAt 为基准向前 24 小时
  const baseT = new Date(P.builtAt || P.generatedAt).getTime();
  let expN = 0, expRec = 0;
  for (const p of P.platforms) for (const j of p.jobs || []) {
    const t = Date.parse(String(j.ts || '').replace(' ', 'T') + '+08:00');
    if (!isFinite(t) || t > baseT || baseT - t > 86400000) continue;
    expN++;
    if (j.v !== '不推荐' && j.score >= 75) expRec++;
  }
  const txt = nodes.toast.innerHTML;
  ok(/今日新增/.test(txt) && txt.indexOf(String(expN)) >= 0 && txt.indexOf(String(expRec)) >= 0,
    `【v2.0】刷新后提示「今日新增 ${expN} 个岗位，其中推荐岗位 ${expRec} 个！」（实际「${txt.replace(/<[^>]+>/g, '')}」）`);
  ok(nodes.toast.className === 'on', '【v2.0】提示条以 .on 显示（CSS 中 5 秒后自动隐藏）');
  ok(sessionStored['wjl-just-refreshed'] == null, '【v2.0】提示只弹一次（标记用后即清）');
}

/* 6) 用合成数据验证「24 小时窗口」真的按小时算，而不是按自然日
   本地数据是旧的（20 天前发布），上面那条只会得出 0/0 —— 0==0 骗得过 bug。
   这里造 3 条岗位：1 小时前发布、2 小时前发布、3 天前发布。 */
{
  const bj = (d) => {
    const t = new Date(d.getTime() + 480 * 60000);
    const p2 = (n) => String(n).padStart(2, '0');
    return `${t.getUTCFullYear()}-${p2(t.getUTCMonth() + 1)}-${p2(t.getUTCDate())} ${p2(t.getUTCHours())}:${p2(t.getUTCMinutes())}:${p2(t.getUTCSeconds())}`;
  };
  const now = Date.now();
  const mkJob = (id, title, hoursAgo, score, v) => ({
    id, t: title, c: '测试公司', s: '8-10千', city: '广州', dist: '', pub: bj(new Date(now - hoursAgo * 3600e3)).slice(0, 10),
    ts: bj(new Date(now - hoursAgo * 3600e3)), exp: '经验不限', expRaw: '经验不限', expFrom: '发布信息',
    deg: '大专', size: '100-499人', url: '', score, v, neg: [], pen: [], bon: [],
    rest: '双休', hours: '', flex: '', mod: [], fresh: true, fr: '是', days: 0, jd: '【岗位职责】\n1、负责招聘渠道维护与简历筛选。', grad: '', bp: false,
  });
  const jc = mkJob('c', '3天前发布且信息缺失的岗位', 72, 70, '可考虑');
  jc.deg = ''; jc.size = ''; jc.city = '广州';      // 制造「未提及」
  const jd0 = mkJob('d', '没有 JD 的岗位', 72, 30, '不推荐');
  jd0.jd = '';                                       // 制造「工作模块 → ？」
  nodes.payload.textContent = JSON.stringify({
    generatedAt: new Date(now).toISOString(), builtAt: new Date(now).toISOString(),
    profile: { name: '林小夕' },
    platforms: [{ key: 'zhilian', label: '智联招聘', total: 4, recommended: 1, rejected: 3, jobs: [
      mkJob('a', '1小时前发布的推荐岗', 1, 80, '推荐'),
      mkJob('b', '2小时前发布的普通岗', 2, 40, '备选'),
      jc,
      jd0,
    ] }],
  });
  sessionStored['wjl-just-refreshed'] = '1';
  try { vm.runInContext(js, sandbox, { timeout: 10000 }); } catch (e) { ok(false, '合成数据执行 — ' + e.message); }
  const t2 = nodes.toast.innerHTML.replace(/<[^>]+>/g, '');
  ok(/今日新增 2 个岗位/.test(t2), `【v2.0】24 小时窗口按小时判定：1 小时前与 2 小时前算新增、3 天前不算（实际「${t2}」）`);
  ok(/其中推荐岗位 1 个/.test(t2), `【v2.0】「其中推荐岗位」只统计达线岗位（80 分算，40 分不算）（实际「${t2}」）`);
  // 字段缺失 → 显示「未提及」；没有 JD → 工作模块显示「？」
  const g2 = nodes.grid.innerHTML;
  ok(/<b>学历要求<\/b><span>未提及<\/span>/.test(g2), '【v2.0】学历缺失时显示「未提及」');
  ok(/<b>公司规模<\/b><span>未提及<\/span>/.test(g2), '【v2.0】公司规模缺失时显示「未提及」');
  ok(/<span class="modtag none">？<\/span>/.test(g2), '【v2.0】没有 JD 可判时工作模块显示「？」');
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

/* ============ 版本号 ============ */
{
  const m = html.match(/(v\d+(?:\.\d+)*) ● (\d{4}\/\d{1,2}\/\d{1,2}) ——林小夕/);
  ok(!!m, '页脚版本行格式正确（版本号 ● 日期 ——笔名）');
  ok(m && m[1] === 'v2.0', `版本号为 v2.0（实际「${m ? m[1] : '未匹配到'}」）`);
  /* 版本行的日期是「版本发布日」，写死为 2026/10/19，不随构建日变化 */
  ok(m && m[2] === '2026/10/19', `版本行日期为发布日 2026/10/19（实际「${m ? m[2] : '未匹配到'}」）`);
  ok(!/!VERSION!|!STAMP!/.test(html), '模板占位符已全部替换（无残留 !VERSION!/!STAMP!）');
  /* 与「上次刷新」区分：版本行固定，last-refresh 才随刷新变化 */
  ok(!/function stamp\(\)/.test(js), '已移除用 JS 覆盖版本行日期的逻辑（否则会变回构建日）');
}

/* ============ 上次刷新时间（刷新按钮下方小字）============ */
{
  ok(/id="last-refresh"/.test(html), '刷新按钮下方有「上次刷新」小字容器');
  // 结构：小字必须在 #refresh 之后（即按钮下方），且包在同一个容器里
  const iBtn = html.indexOf('id="refresh"'), iLast = html.indexOf('id="last-refresh"');
  ok(iBtn > 0 && iLast > iBtn, '小字位于刷新按钮之后（按钮下方）');
  // 必须被包在与按钮同一个 <div> 里，才会真的排在按钮下面（不是并排）
  const iWrap = html.lastIndexOf('<div>', iBtn);
  const iWrapEnd = html.indexOf('</div>', iWrap + 5);
  ok(iWrap > 0 && iWrap < iBtn && iWrapEnd > iLast,
    '小字与按钮同处一个容器、排在按钮之后（确保是"按钮下方"而非并排）');
  ok(/#last-refresh\{[^}]*font-size:13\.5px/.test(html), '小字字号小于正文（13.5px）');
  ok(/#last-refresh\{[^}]*text-align:right/.test(html), '小字右对齐，与按钮对齐');
  ok(/function lastRefresh\(\)/.test(js) && /lastRefresh\(\);/.test(js), '页面载入时写入上次刷新时间');

  /* 真实调用格式化函数：北京时间、格式正确、缺数据不猜 */
  const bodyOf2 = (sig) => {
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
  try {
    const api2 = new Function(bodyOf2('function fmtRefreshTime') + '\nreturn fmtRefreshTime;')();
    // 线上真实值：2026-09-29T21:26:06Z = 北京时间 2026年9月30日5时26分
    ok(api2('2026-09-29T21:26:06.303Z') === '2026年9月30日5时26分',
      `UTC 21:26 应显示为北京时间次日 5时26分（实际「${api2('2026-09-29T21:26:06.303Z')}」）`);
    // 补零检查：1月1日0时0分不能显示成 01
    ok(api2('2026-01-01T00:00:00Z') === '2026年1月1日8时0分', '个位数月/日/时不补零');
    // 跨年跨月边界
    ok(api2('2025-12-31T16:00:00Z') === '2026年1月1日0时0分', '跨年时刻按北京时间归入新年');
    // 缺数据不猜
    ok(api2('') === '' && api2(undefined) === '' && api2('乱七八糟') === '', '时间缺失或非法时返回空（不显示错误时间）');
    ok(/DATA\.builtAt \|\| DATA\.generatedAt/.test(js), '时间取自云端构建时刻 builtAt（回退 generatedAt）');
  } catch (e) { ok(false, '抽取 fmtRefreshTime — ' + e.message); }
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
ok(/type="search"/.test(bodyHtml) && /id="q"/.test(bodyHtml) && /elQ/.test(js), '【v2.0】搜索框已加回（输入框 + 事件绑定）');
ok(/data-m="job"/.test(bodyHtml) && /data-m="co"/.test(bodyHtml), '【v2.0】搜索支持「岗位 / 公司」两种索引方式');
ok(/<option value="sal">薪资待遇（高→低）<\/option>/.test(bodyHtml) && !/薪资（高→低）/.test(bodyHtml), '【P2】排序项已改为「薪资待遇」');
ok(/j\.v !== '不推荐'|isRec\(j\)/.test(js), '【P3】仍保留「推荐岗位」筛选标签（不推荐岗位现在也展示，但可一键筛掉）');
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
ok(/function dutyItems\(j\)/.test(js) && /function coreTop\(j, n\)/.test(js), '【p1】按职责条目提炼核心工作内容（dutyItems / coreTop）');
ok(!/modWeights/.test(js) && !/Math\.round\(exact \/ 5\)/.test(js), '【v2.0】已移除 5% 刻度占比算法');
ok(!/<i class="pct">/.test(js) && !/\.modtag \.pct\{/.test(html), '【v2.0】模块标签不再显示百分比（标记与样式均已移除）');
ok(/SEC_BREAK/.test(js) && /小节标签/.test(js), '【p1】同一行内的小节标题也先断行再分段');
{
  // 反例：学历要求里的「行政管理专业」不得判为行政模块；「职业规划」不得判为规划模块
  const cases = [
    { jd: '【任职要求】1、行政管理、汉语言文学专业优先；2、本科及以上学历。【岗位职责】1、负责招聘渠道维护与简历筛选；2、组织面试安排。', want: ['招聘'], deny: ['行政', '人力规划', '薪酬'] },
    { jd: '【任职要求】1、人力资源、工商管理专业；【岗位职责】1、负责薪酬核算与社保公积金申报；2、负责考勤统计。', want: ['薪酬', '社保公积金', '考勤'], deny: ['行政', '绩效'] },
    { jd: '【任职要求】1、本科，职业规划清晰者优先。【岗位职责】1、负责员工入离职手续办理与劳动合同管理；2、组织员工活动与团队建设。', want: ['员工关系', '企业文化'], deny: ['人力规划'] },
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

  /* ---- v2.0：核心工作内容取前 3、按提及次数排序、无百分比 ---- */
  ok(typeof nodes._dutyItems === 'function' && typeof nodes._coreTop === 'function', '【v2.0】coreTop 函数已抽出可供实测');
  {
    const corpus = [
      { jd: '【岗位职责】\n1、负责招聘渠道维护与简历筛选；\n2、组织面试安排；\n3、负责薪酬核算与社保公积金申报；\n4、负责考勤统计。', t: '招聘薪酬专员' },
      { jd: '【岗位职责】\n1、负责员工入离职手续办理与劳动合同管理；\n2、组织员工活动与团队建设。', t: '员工关系专员' },
      { jd: '【任职要求】\n1、行政管理专业优先。\n【岗位职责】\n1、负责公司行政后勤、办公用品采购、固定资产管理及会务接待。', t: '行政专员' },
      { jd: '【岗位职责】\n1、根据经营目标配置合理的人员编制架构；\n2、结合目标，参与设计面向增长和成长的薪酬绩效并执行薪酬绩效方案；\n3、现有编制及业务发展需求，协助上级确定招聘目标，汇总岗位及人员需求数目，制订并执行招聘计划；\n4、撰写招聘广告，维护和更新招聘网站，发布职位需求信息，搜集简历，对简历进行分类、筛选，通知应聘者前来面试、对应聘者进行初步面试；\n5、公司制度和文化的贯彻宣讲，员工关系建设和团队文化建设。', t: 'HRBP' },
      { jd: '【岗位职责】\n1、负责前台接待与来访登记；\n2、负责办公用品采购与固定资产管理；\n3、负责会议室安排与会务支持。', t: '前台行政' },
      { jd: '【岗位职责】\n1、负责考勤统计与薪资核算；', t: '薪酬专员' },
    ];
    /* 最多 3 项 */
    let maxOk = true, d1 = [];
    for (const c of corpus) {
      const top = nodes._coreTop(c, 3);
      if (top.length > 3) { maxOk = false; d1.push(`${c.t}: ${top.length} 项`); }
    }
    ok(maxOk, `【v2.0】最多只取 3 项核心工作内容（${corpus.length} 组实测）${maxOk ? '' : ' → ' + d1.join(' | ')}`);

    /* 按提及次数降序（排名分先后） */
    let ordOk = true, d2 = [];
    for (const c of corpus) {
      const top = nodes._coreTop(c, 3);
      for (let i = 1; i < top.length; i++) if (top[i].n > top[i - 1].n) { ordOk = false; d2.push(c.t); }
    }
    ok(ordOk, '【v2.0】按 JD 提及次数从多到少排序（次数相同则按词表顺序）');

    /* 只返回 JD 实际提及的项，绝不硬凑满 3 个 */
    let onlyHit = true, d3 = [];
    for (const c of corpus) {
      const top = nodes._coreTop(c, 3).map((o) => o.m);
      const hit = nodes._modsOf(c);
      if (!top.every((m) => hit.includes(m))) { onlyHit = false; d3.push(`${c.t}: 取[${top}] 实命中[${hit}]`); }
    }
    ok(onlyHit, `【v2.0】只返回 JD 实际提及的工作内容，不硬凑${onlyHit ? '' : ' → ' + d3.join(' | ')}`);

    /* 行政专员只有行政一项 → 只显示 1 项，不补到 3 项 */
    const adminTop = nodes._coreTop(corpus[2], 3).map((o) => o.m);
    ok(adminTop.join('/') === '行政', `【v2.0】只命中 1 项时就只显示 1 项（实际「${adminTop.join('/') || '无'}」）`);

    /* HRBP 样本：招聘提及最多，必须排进前 3 */
    const hrbpTop = nodes._coreTop(corpus[3], 3);
    ok(hrbpTop.length === 3 && hrbpTop[0].m === '招聘',
      `【v2.0】HRBP 样本前 3 项：${hrbpTop.map((o) => o.m + o.n).join(' · ')}（招聘提及最多，应居首）`);

    /* 渲染层：页面上的模块标签不带百分比，且每卡 ≤3 项 */
    const rendered = [...grid.matchAll(/<span class="modtag[^"]*"[^>]*>([^<]*)<\/span>/g)].map((m) => m[1]);
    ok(rendered.length > 0 && rendered.every((s) => !/%/.test(s)), `【v2.0】页面模块标签文字无百分比（共 ${rendered.length} 个）`);
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
  ok(badgeTexts.every((ts) => ts.every((t) => ['双休', '单休', '大小周', '排班轮休', '弹性打卡'].includes(t) || /^\d{1,2}[:：]\d{2}/.test(t))),
    '【v2.0】徽章行只含作息四种制度 / 工作时间 / 弹性打卡');
  ok(!/作息未提及/.test(gridQC), '【v2.0】作息未提及时整条省略，卡片里不再出现「作息未提及」');
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
