(function(){
'use strict';
var DATA = JSON.parse(document.getElementById('payload').textContent);
var PLAT = DATA.platforms.filter(function(p){ return p.jobs && p.jobs.length; });

/* ---------- 状态 ---------- */
var LS = 'wjl-kanban-v3';
var state = { tab: 0, sort: 'score', filters: {} };
try { var s = JSON.parse(localStorage.getItem(LS) || '{}'); if (s && typeof s === 'object') {
  if (typeof s.tab === 'number') state.tab = Math.min(s.tab, PLAT.length - 1);
  if (s.sort) state.sort = s.sort;
  if (s.filters) state.filters = s.filters;
} } catch(e){}
function save(){ try { localStorage.setItem(LS, JSON.stringify({tab:state.tab,sort:state.sort,filters:state.filters})); } catch(e){} }

/* ---------- 工作模块 8 类：识别 JD 中的「实际工作内容」 ---------- */
var MODULES = ['规划','招聘','培训','薪酬','绩效','员关','行政','BP'];

/* 只在「职责段」里找模块；这些标题之后的内容属于要求/待遇，一律剔除 */
var SEC_DUTY = /岗\s*位\s*职\s*责|工\s*作\s*职\s*责|职\s*责\s*描\s*述|工\s*作\s*内\s*容|主\s*要\s*职\s*责|岗\s*位\s*内\s*容|职\s*位\s*描\s*述|你\s*将\s*负\s*责|岗\s*位\s*描\s*述/;
var SEC_ASK  = /任\s*职\s*要\s*求|任\s*职\s*资\s*格|岗\s*位\s*要\s*求|任\s*职\s*条\s*件|招\s*聘\s*要\s*求|应\s*聘\s*要\s*求|候\s*选\s*人\s*要\s*求|我\s*们\s*期\s*待|资\s*格\s*条\s*件|学\s*历\s*要\s*求|招\s*聘\s*对\s*象|招\s*聘\s*流\s*程|岗\s*位\s*亮\s*点|项\s*目\s*简\s*介|公\s*司\s*简\s*介|加\s*分\s*项|我\s*们\s*提\s*供|福\s*利\s*待\s*遇|薪\s*资\s*待\s*遇|福\s*利\s*保\s*障|入\s*职\s*要\s*求|能\s*力\s*倾\s*向|专\s*业\s*倾\s*向|岗\s*位\s*发\s*展\s*方\s*向|发\s*展\s*方\s*向|任\s*职\s*说明|应\s*聘\s*条\s*件|基\s*本\s*要\s*求|任\s*职\s*要\s*点|我\s*们\s*希\s*望|岗\s*位\s*优\s*势|薪\s*酬\s*福\s*利|员\s*工\s*福\s*利|待\s*遇\s*说\s*明/;

/* 命中必须落在具体职责表述上，避免「行政管理专业」「职业规划」「渠道销售」这类误判 */
var MOD_PAT = {
  '规划': /(人力资源|人力|人事|组织|人才|编制)[^，。；\n]{0,8}(规划|盘点|梯队|体系搭建)|(规划|盘点|搭建|优化|完善)[^，。；\n]{0,8}(人力资源|人力|组织架构|人才梯队|人员编制|职级体系)|组织架构|人才梯队|(编制|人才)[^，。；\n]{0,6}(规划|盘点|梯队)|年度[^，。；\n]{0,4}(人力|人员|招聘|编制)[^，。；\n]{0,4}(规划|预算|计划)/,
  '招聘': /(招聘|招募|简历筛选|面试|校招|社招|雇主品牌|人才引进|人员配置|招聘渠道)/,
  '培训': /(培训|带教|讲师|学习发展|人才培养|赋能)/,
  '薪酬': /(薪酬|薪资|工资|调薪|算薪|社保|公积金|五险一金|考勤|个税|发薪)/,
  '绩效': /(绩效|考核|kpi|okr|目标管理|绩效管理)/i,
  '员关': /(员工关系|劳动关系|入离职|入转调离|入职|离职|劳动合同|员工沟通|员工关怀|员工活动|企业文化|转正|调岗)/,
  '行政': /(行政|后勤|办公用品|固定资产|会务|接待|档案|证照|车辆|宿舍|食堂|办公环境|采购)/,
  'BP': /(hrbp|hr\s*bp|业务伙伴|业务对接|支持业务|业务部门|bp)/i
};

/* 小节标题可能的书写形式（用于在同一行内断开多个小节）
   只在【】标记、或行首编号后紧跟小节词时断行，避免把正文句子切断 */
var SEC_BREAK = /(【[^】\n]{2,14}】|(?:^|(?<=\n))[ \t\u00a0\u3000]*[一二三四五六七八九十]{1,2}[、.．)）](?=[^\n]{0,8}?(?:职责|要求|资格|条件|内容|待遇|福利|亮点|简介|流程|对象|发展|倾向|说明)))/gm;

/* 取出用于模块判定的正文：有独立职责段就只认职责段
   注意：必须保留换行边界，否则「【任职要求】…【岗位职责】」会粘成一行，
   导致分段失效、整篇 JD 被当成职责段。这里只压缩空白，不破坏换行。 */
function modHay(j){
  var raw = (j.jd || '').trim();
  if (raw.length <= 20) return '';
  var nrm = raw.replace(/\r/g, '')
    .replace(/[ \t\u00a0\u3000]*\n[ \t\u00a0\u3000]*/g, '\n')   // 去行首行尾空白，保留换行
    .replace(/[ \t\u00a0\u3000]{2,}/g, ' ');                        // 行内连续空白压成一个
  // 同一行里写了多个小节标题（如「【任职要求】…【岗位职责】…」）→ 在小节标题前断行
  nrm = nrm.replace(SEC_BREAK, '\n$1');
  var lines = nrm.split('\n');
  var duty = '';
  var rest = [];              // 非职责段内容（要求/待遇/前言）
  var inDuty = false, inAsk = false, sawAsk = false;
  for (var i = 0; i < lines.length; i++) {
    var L = lines[i].trim(); if (!L) continue;
    // 行首【…】小节标签：只按标签判归属，不受整行长度影响
    var bm = /^(【[^】]{2,14}】)/.exec(L);
    if (bm) {
      var tag = bm[1];
      if (SEC_DUTY.test(tag) && !SEC_ASK.test(tag)) {
        inDuty = true; inAsk = false;
        L = L.slice(tag.length).trim();
        if (!L) continue;
      } else if (SEC_ASK.test(tag) && !SEC_DUTY.test(tag)) {
        inAsk = true; inDuty = false; sawAsk = true;
        L = L.slice(tag.length).trim();
        if (!L) continue;
      }
    } else if (L.length <= 24 && SEC_DUTY.test(L) && !SEC_ASK.test(L)) {
      inDuty = true; inAsk = false; continue;
    } else if (L.length <= 26 && SEC_ASK.test(L) && !SEC_DUTY.test(L)) {
      inAsk = true; inDuty = false; sawAsk = true; continue;
    }
    if (inDuty) duty += L + '\n';
    else if (!inAsk) rest.push(L);
  }
  // 有独立职责段 → 只认职责段
  if (duty.length >= 20) return duty;
  // 无职责段但也不存在「要求/待遇」段 → 整篇就是工作内容描述
  if (!sawAsk) return nrm;
  // 存在要求段却没有职责段 → 只剩未分类内容；若为空则无可判定内容（不硬凑命中）
  var tail = rest.filter(function(L){
    return !(L.length <= 24 && SEC_DUTY.test(L)) && !(L.length <= 26 && SEC_ASK.test(L));
  }).join('\n');
  return tail.length >= 20 ? tail : '';
}

function modsOf(j){
  // 工作模块只依据 JD 正文的实际工作内容判定；JD 缺失或过短时直接返回空（绝不拿标题猜）
  var hay = modHay(j);
  if (!hay) return [];
  return MODULES.filter(function(m){ return MOD_PAT[m].test(hay); });
}

/* 把 JD 的职责段切成一条条具体工作内容
   切分点：换行、编号（1、 / 1. / 1) / 1． / （1） ）、中文序号（一、 / 二、 …） */
function dutyItems(j){
  var hay = modHay(j);
  if (!hay) return [];
  return hay.replace(/\r/g, '')
    .split(/\n|(?=\d{1,2}\s*[、.．)）])|(?=[一二三四五六七八九十]{1,2}\s*[、.．)）])/)
    .map(function(s){ return s.trim(); })
    .filter(function(s){ return s.length >= 4; });
}

/* 单个模块的提及条数（组成工作内容的原始信号） */
function modCount(j, m){
  var items = dutyItems(j);
  if (!items.length) return 0;
  var n = 0;
  for (var i = 0; i < items.length; i++) if (MOD_PAT[m].test(items[i])) n++;
  return n;
}

/* 全部模块的占比：以「各模块提及条数」为权重做归一化分配，合计恒为 100%。
   只有被提及的模块参与分配（未提及的不显示）；每项取整到 5% 的刻度，
   取整产生的零头补给「小数部分最大」的模块，保证加总仍为 100%。 */
function modWeights(j){
  var items = dutyItems(j);
  var out = {}, i, m;
  for (i = 0; i < MODULES.length; i++) out[MODULES[i]] = 0;
  if (!items.length) return out;
  var cnt = [], total = 0;
  for (i = 0; i < MODULES.length; i++) {
    var m0 = MODULES[i], n = modCount(j, m0);
    cnt.push({ m: m0, n: n });
    total += n;
  }
  if (!total) return out;
  var live = cnt.filter(function(o){ return o.n > 0; });
  var acc = 0, parts = [];
  for (i = 0; i < live.length; i++) {
    var exact = live[i].n / total * 100;
    var v = Math.round(exact / 5) * 5;
    if (v < 5) v = 5;                                  // 被提及至少要有一格
    if (v > 100) v = 100;
    parts.push({ m: live[i].m, v: v, frac: exact - v });
    acc += v;
  }
  // 取整后的零头：差多少就从"被高估最多"的模块上挪，或补给"被低估最多"的模块
  var diff = 100 - acc;
  while (diff !== 0) {
    var best = -1, bestVal = null, step = diff > 0 ? 5 : -5;
    for (i = 0; i < parts.length; i++) {
      var nv = parts[i].v + step;
      if (nv < 5 || nv > 100) continue;
      // 正向补：小数部分越大越优先；反向扣：被高估越多越优先
      var score = step > 0 ? -parts[i].frac : parts[i].frac;
      if (bestVal === null || score > bestVal) { bestVal = score; best = i; }
    }
    if (best < 0) break;
    parts[best].v += step;
    diff -= step;
  }
  for (i = 0; i < parts.length; i++) out[parts[i].m] = parts[i].v;
  return out;
}

/* 兼容旧调用：单模块占比（取归一化后的结果） */
function modWeight(j, m){
  return modWeights(j)[m] || 0;
}

/* 模块命中的依据原文（给用户看"为什么算命中"）：取所在职责条目整句 */
function modWhy(j, m){
  var items = dutyItems(j);
  if (!items.length) return [];
  var out = [];
  for (var i = 0; i < items.length && out.length < 2; i++) {
    if (!MOD_PAT[m].test(items[i])) continue;
    var s = items[i].slice(0, 64);
    if (items[i].length > 64) s += '…';
    out.push(s);
  }
  return out;
}

/* ---------- 原始评分（0–100 百分制，直接展示引擎评分，不再做平台内相对归一化） ---------- */
var REC_MIN = 75;                       // 「推荐岗位」门槛：75 分以上
function raw(j){
  var v = Number(j.score);
  if (!isFinite(v)) v = 0;
  v = Math.round(v);
  return v < 0 ? 0 : (v > 100 ? 100 : v);
}
function isRec(j){ return j.v !== '不推荐' && raw(j) >= REC_MIN; }
function scoreCls(v){ return v >= 90 ? 'idx-hot' : (v >= 75 ? 'idx-mid' : 'idx-low'); }

/* ---------- 筛选条件（用户指定 4 项）---------- */
var FILTERS = [
  { id:'rec',   label:'推荐岗位',   test:function(j){ return isRec(j); } },
  { id:'fresh', label:'接受应届生', test:function(j){ return !!j.fresh; } },
  { id:'rest',  label:'双休',       test:function(j){ return j.rest === '双休'; } },
  { id:'bp',    label:'BP＆管培生', test:function(j){ return !!j.bp; } }
];

/* ---------- 薪资解析（取区间下限，单位 k/月） ---------- */
function salaryK(j){
  var t = String(j.s || '').replace(/\s/g,'');
  var m = t.match(/([\d.]+)\s*[-~至]\s*([\d.]+)\s*万/);
  if (m) return parseFloat(m[1]) * 10;
  m = t.match(/([\d.]+)\s*[-~至]\s*([\d.]+)\s*千/);
  if (m) return parseFloat(m[1]);
  m = t.match(/([\d.]+)\s*[-~至]\s*([\d.]+)/);
  if (m) { var v = parseFloat(m[1]); return v > 1000 ? v/1000 : v; }
  m = t.match(/(\d{4,6})/);
  if (m) return Number(m[1]) / 1000;
  return 0;
}
/* 经验门槛数值化：越小门槛越低 */
function expRank(e){
  var t = String(e || '');
  if (/不限|无经验|应届/.test(t)) return 0;
  if (/1年以下|1年以内/.test(t)) return 1;
  if (/1-3年|1年以上/.test(t)) return 2;
  if (/3-5年|3年以上/.test(t)) return 3;
  if (/5-10年|5年以上/.test(t)) return 4;
  if (/10年以上/.test(t)) return 5;
  return 2;
}

/* ---------- 渲染 ---------- */
var elTabs = document.getElementById('tabs'),
    elChips = document.getElementById('chips'),
    elGrid = document.getElementById('grid'),
    elSort = document.getElementById('sort'),
    elStamp = document.getElementById('stamp'),
    elLastRefresh = document.getElementById('last-refresh'),
    elNotice = document.getElementById('notice'),
    elFootPlat = document.getElementById('foot-plat');

function esc(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
    return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];
  });
}
function cur(){ return PLAT[state.tab]; }
/* 某平台的「推荐岗位」条数 = 未被过滤 且 评分 ≥ 80 */
function recCount(p){
  return (p.jobs || []).filter(function(j){ return isRec(j); }).length;
}

function renderTabs(){
  elTabs._onclick = function(btn){ state.tab = Number(btn.dataset.i); save(); render(); };
  elTabs.innerHTML = '<div class="seg">' + PLAT.map(function(p,i){
    return '<button class="'+(i===state.tab?'on':'')+'" data-key="'+esc(p.key)+'" data-i="'+i+'">'
      + esc(p.label) + '<span class="cnt">推荐 '+recCount(p)+' / 收录 '+p.total+'</span></button>';
  }).join('') + '</div>';
  Array.prototype.forEach.call(elTabs.querySelectorAll('button'), function(b){
    b.onclick = function(){ return elTabs._onclick(b); };
  });
}

function renderChips(){
  elChips._onclick = function(chip){
    var id = chip.dataset.f;
    if (state.filters[id]) delete state.filters[id]; else state.filters[id] = 1;
    save(); renderChips(); renderGrid();
  };
  elChips.innerHTML = FILTERS.map(function(f){
    return '<span class="chip'+(state.filters[f.id]?' on':'')+'" data-f="'+f.id+'">'+esc(f.label)+'</span>';
  }).join('');
  Array.prototype.forEach.call(elChips.querySelectorAll('.chip'), function(c){
    c.onclick = function(){ return elChips._onclick(c); };
  });
}

/* 单项：值缺失即显示"未提及" */
function mi(label, val, wide){
  var v = (val == null ? '' : String(val)).trim();
  var none = !v || /^(未提及|未知|-|—|--)$/.test(v);
  return '<div class="mi' + (none ? ' none' : '') + (wide ? ' wide' : '') + '">'
    + '<b>' + esc(label) + '</b><span>' + esc(none ? '未提及' : v) + '</span></div>';
}

function jobCard(j){
  var v = raw(j), vc = scoreCls(v);
  var loc = esc(j.city) + (j.dist ? '·' + esc(j.dist) : '');

  // 发布时间
  var pub = j.pub ? (j.pub + (typeof j.days === 'number' ? '（' + j.days + '天前）' : '')) : '';
  // 经验要求：严格按"信息索引原则"显示——JD 任职要求段写了就显示 JD 的，
  // JD 未提及才显示发布信息标签，并标明来源（用户要求：JD 未提及才参考发布信息）。
  var expRaw = esc(j.expRaw || j.exp || '');
  var exp = j.expFrom === 'JD任职要求' ? expRaw
          : (expRaw ? expRaw + '（发布信息）' : '未标明');
  // 是否接受应届生：引擎按 JD 判定，未判定时退回发布信息的"不限/无经验"
  var fresh = j.fresh ? '接受应届生'
            : (/不限|无需经验|无经验|不要求经验/.test(expRaw) ? '经验不限'
            : (/1-3年|1年以上|3-5年|5-10年|10年以上|1年以下|应届/.test(expRaw) ? '需工作经验' : ''));
  if (!fresh && j.grad && /接受2026届|2026\/2027届均可/.test(j.grad)) fresh = '接受2026届毕业生';
  // 学历
  var deg = j.deg || '';
  // 公司规模
  var size = j.size || '';
  // 工作模块：按 JD 职责条目算出占比（5% 刻度，合计 100%）
  // 只显示 JD 中实际提及的模块，按固定模块顺序排列，悬停可见判定依据
  var modW = modWeights(j);
  var modHtml = MODULES.filter(function(m){ return modW[m] > 0; }).map(function(m){
    var pct = modW[m];
    var why = modWhy(j, m).join(' ／ ');
    var tip = '依据 JD：' + why + '（占工作内容 ' + pct + '%，按职责条目提及比例，合计 100%）';
    return '<span class="modtag"' + (tip ? ' title="' + esc(tip) + '"' : '') + '>'
      + m + '<i class="pct">' + pct + '%</i></span>';
  }).join('');

  var meta = '<div class="meta">'
    + mi('发布时间', pub)
    + mi('经验要求', exp)
    + mi('接受应届生', fresh)
    + mi('学历要求', deg)
    + mi('公司规模', size)
    + '<div class="mi wide"><b>工作模块</b><span>' + modHtml + '</span></div>'
    + '</div>';

  var body = '';
  var hasEvidence = (j.bon || []).length || (j.pen || []).length || (j.neg || []).length;
  if (hasEvidence) {
    body += '<div class="row"><strong style="font-size:12px;color:var(--ink3);font-weight:500">评分依据</strong>'
      + (j.bon || []).map(function(b){ return '<span class="pill">' + esc(b.k) + ' +' + b.v + '</span>'; }).join('')
      + (j.pen || []).map(function(b){ return '<span class="pill m">' + esc(b.k) + ' ' + b.v + '</span>'; }).join('')
      + (j.neg || []).map(function(n){ return '<span class="pill n">过滤：' + esc(n) + '</span>'; }).join('')
      + '</div>';
  }
  if (j.jd && j.jd.length > 20) {
    body += '<div class="row"><strong style="font-size:12px;color:var(--ink3);font-weight:500">岗位描述</strong></div>'
      + '<div class="jd">' + hl(j.jd) + '</div>';
  }
  var details = body ? '<details><summary>评分依据 / 岗位描述</summary><div class="bd">' + body + '</div></details>' : '';

  // 附加信息条：只保留作息制度 + 工作时间 + 弹性打卡（评分已由右上角分数体现，不再重复）
  var extra = [];
  extra.push('<span class="badge' + (j.rest === '双休' ? ' b3' : '') + '">' + esc(j.rest || '作息未提及') + '</span>');
  if (j.hours) extra.push('<span class="badge">' + esc(j.hours) + '</span>');
  if (j.flex === '是') extra.push('<span class="badge b3">弹性打卡</span>');

  return '<article class="card ' + vc + '">'
    + '<div class="top">'
    +   '<h2 class="t">' + (j.url ? '<a href="' + esc(j.url) + '" target="_blank" rel="noopener">' + esc(j.t) + '</a>' : esc(j.t)) + '</h2>'
    +   '<div class="sc"><b>' + v + '</b><i>推荐指数</i></div>'
    + '</div>'
    + '<div class="co"><span>' + esc(j.c) + '</span><em>' + loc + '</em></div>'
    + (j.s ? '<div class="sal">' + esc(j.s) + '</div>' : '')
    + meta
    + '<div class="row" style="display:flex;gap:6px;flex-wrap:wrap">' + extra.join('') + '</div>'
    + details
    + '</article>';
}

var HL_RE = /(双休|周末双休|单休|大小周|排班轮休|弹性打卡|不打卡|弹性工作|六险一金|五险一金|包吃|包住|餐补|房补|交通补贴|下午茶|年终奖|带薪年假|节日福利|团建|应届|无经验|经验不限|接受小白|可转正|朝九晚六)/g;
function hl(txt){
  return esc(txt).replace(HL_RE, '<mark>$1</mark>');
}

function renderGrid(){
  var p = cur();
  // 只展示评分达到「推荐岗位」门槛（75 分）的岗位；不推荐岗位与低分岗位都不进入网格
  var jobs = (p.jobs || []).filter(isRec);
  var active = Object.keys(state.filters);
  if (active.length) {
    jobs = jobs.filter(function(j){
      for (var i = 0; i < active.length; i++) {
        var f = FILTERS.filter(function(x){ return x.id === active[i]; })[0];
        if (f && !f.test(j)) return false;
      }
      return true;
    });
  }
  if (state.sort === 'score') {
    jobs.sort(function(a,b){ return (b.score - a.score) || ((a.days==null?999:a.days) - (b.days==null?999:b.days)); });
  } else if (state.sort === 'pub') {
    jobs.sort(function(a,b){ return String(b.pub||'').localeCompare(String(a.pub||'')) || (b.score - a.score); });
  } else if (state.sort === 'sal') {
    jobs.sort(function(a,b){ return salaryK(b) - salaryK(a) || (b.score - a.score); });
  } else if (state.sort === 'exp') {
    jobs.sort(function(a,b){ return expRank(a.exp) - expRank(b.exp) || (b.score - a.score); });
  }
  var LIMIT = 300;
  var shown = jobs.slice(0, LIMIT);
  elGrid.innerHTML = shown.length
    ? shown.map(jobCard).join('')
    : '<div class="empty">当前平台没有达到 75 分的推荐岗位，试试取消筛选条件。</div>';
  if (jobs.length > LIMIT) {
    elNotice.innerHTML = '<div class="note">符合条件共 ' + jobs.length + ' 条，为保证流畅只展示前 ' + LIMIT + ' 条。请增加筛选条件以缩小范围。</div>';
  } else {
    elNotice.innerHTML = '';
  }
}

function render(){
  renderTabs(); renderChips(); renderGrid();
  if (elFootPlat) elFootPlat.textContent = cur().label;
}

/* ---------- 事件 ---------- */
elSort.onchange = function(){ state.sort = elSort.value; save(); renderGrid(); };

/* ---------- 云端更新：GitHub Actions 触发 ---------- */
var GH_OWNER = '!GH_OWNER!', GH_REPO = '!GH_REPO!', GH_WF = '!GH_WF!', GH_WF_NAME = '!GH_WF_NAME!';
var GH_KEY = 'wjl-gh-token';
var GH_API = 'https://api.github.com/repos/' + GH_OWNER + '/' + GH_REPO + '/actions';
function ghToken(){
  var t = '';
  try { t = localStorage.getItem(GH_KEY) || ''; } catch(e) {}
  if (!t) {
    t = (prompt('首次使用：粘贴你的 GitHub 令牌（只保存在本机浏览器，不会上传到任何地方）\n\n生成地址：github.com/settings/tokens\n只需勾选 repo + workflow') || '').trim();
    if (t) { try { localStorage.setItem(GH_KEY, t); } catch(e) {} }
  }
  return t;
}
function ghFetch(url, opt){
  opt = opt || {};
  var h = { 'Accept': 'application/vnd.github+json', 'Authorization': 'Bearer ' + (opt.token || '') };
  if (opt.method === 'POST') h['Content-Type'] = 'application/json';
  return fetch(url, { method: opt.method || 'GET', headers: h, body: opt.body, cache: 'no-store' });
}

/* ---------- 进度推算（纯函数，可单测）----------
   进度必须看「全部 job」，不能只看某一个：
   GitHub 返回的 jobs 顺序是随机的，而 refresh（25 步）比抓取分片（各 8 步）
   重得多。以前取 jobs[0]，只要第一个 job 跑完就直接显示 100%，
   实际上 refresh 一步没开始——进度条卡在 100% 一两分钟（曾以为是"卡住"）。
   各 job 按实测耗时加权（抓取分片 8/70，refresh 22/110），累计权重 70。 */
var JOB_WEIGHT = { scraper: { steps: 8, sec: 70 }, refresh: { steps: 22, sec: 110 } };
function progressOfJobs(jobs){
  jobs = jobs || [];
  var totalW = 0, doneW = 0, actName = '', actFin = 0, actTotal = 0, actJob = null, actOrder = -1;
  jobs.forEach(function(j){
    var isRefresh = /refresh|构建|评分/i.test(j.name || '');
    var spec = isRefresh ? JOB_WEIGHT.refresh : JOB_WEIGHT.scraper;
    var live = (j.steps || []).filter(function(s){ return s.conclusion !== 'skipped'; });
    var fin = live.filter(function(s){ return s.status === 'completed'; }).length;
    var prog = live.length ? Math.min(1, fin / Math.max(live.length, spec.steps)) : 0;
    totalW += spec.sec; doneW += spec.sec * prog;
    // 提示文字取"最靠前且未完成"的 job（refresh 优先，因为它最耗时）
    if (j.status !== 'completed') {
      var idx = isRefresh ? 1 : 0;
      if (idx > actOrder) { actOrder = idx; actJob = j; actName = ''; actFin = fin; actTotal = live.length; }
      if (j === actJob && !actName && live.length) {
        var a = live.filter(function(s){ return s.status !== 'completed'; })[0];
        if (a) actName = a.name.replace(/（.*?）/g, '').replace(/^抓取双平台最新岗位$/, '抓取岗位中');
      }
    }
  });
  if (!jobs.length) return { pct: 5, note: '云端排队中…' };
  if (!actJob) return { pct: 100, note: '正在发布…' };
  var pct = totalW ? Math.round(doneW / totalW * 100) : 5;
  if (pct > 96) pct = 96;   // 最后一个 job 收尾时先停在 96%，真正完成才到 100%
  return { pct: pct, note: (actName || '处理中') + ' ' + (actFin + 1) + '/' + (actTotal || 1) };
}

/* ---------- 运行状态判定（纯函数，可单测）----------
   之前把 queued/in_progress/success 之外的 run 一律当"失败"，还直接拼 conclusion。
   GitHub 的 run 状态有 5 种（requested/pending/queued/in_progress/completed），
   刚触发的头几秒常是 requested/pending，那时 conclusion 还是 null
   —— 于是弹出「云端更新失败：null」，但云端根本没失败。 */
function runState(run, runId, since){
  if (!run) return 'busy';                                     // 还没排到，继续等
  if (runId) return run.id === runId ? 'mine' : 'busy';         // 已锁定本次运行，等它变化
  var st = run.status || '';
  if (st === 'completed') {
    if (since && new Date(run.created_at).getTime() < since) return 'busy';  // 是上一次的旧运行，忽略
    return 'done';
  }
  if (st === 'requested' || st === 'pending' || st === 'queued' || st === 'waiting' || st === 'in_progress') {
    if (since && new Date(run.created_at).getTime() < since) return 'busy';
    return 'mine';
  }
  return 'busy';                                               // 状态未知也继续等，绝不误报失败
}
document.getElementById('refresh').onclick = function(){
  var btn = this;
  var used = quotaUsed();
  var left = DAILY_LIMIT - used;
  if (left <= 0) { alert('无剩余次数'); return; }
  if (!confirm('今日剩余次数：' + left + '\n\n确定要刷新数据吗？\n（云端抓取约 5 分钟，期间可继续浏览）')) return;
  var token = ghToken();
  if (!token) { alert('未配置令牌，无法触发云端更新。\n\n你也可以在手机上打开 github.com/' + GH_OWNER + '/' + GH_REPO + '/actions 手动点击运行。'); return; }
  setQuota(used + 1);

  var old = btn.textContent;
  btn.disabled = true; btn.textContent = '正在触发…';
  showBar(); setProgress(2, '已触发，正在排队…');
  var since = Date.now() - 120000;   // 只认这个时刻之后创建的 run；留 2 分钟容差防本机与 GitHub 时钟偏差

  ghFetch(GH_API + '/workflows/' + GH_WF + '/dispatches', {
    method: 'POST', token: token,
    body: JSON.stringify({ ref: 'main', inputs: {} })
  }).then(function(r){
    if (r.status === 401 || r.status === 403) throw new Error('令牌无效或权限不足（需要 repo + workflow）');
    if (!r.ok && r.status !== 204) throw new Error('触发失败 HTTP ' + r.status);
    btn.textContent = '云端抓取中…';
    var deadline = Date.now() + 30 * 60 * 1000;
    var POLL_MS = 30000;   // 每 30 秒向云端查询一次
    var runId = null;      // 锁定本次触发的 run，避免误判到上一次的运行

    function finish(msg){
      btn.disabled = false; btn.textContent = old;
      hideBar();
      if (msg) alert(msg);
    }
    /** 查一次队列；返回 'mine'（本次运行在跑）/ 'done'（已出结果） */
    function pollOnce(){
      return ghFetch(GH_API + '/workflows/' + GH_WF + '/runs?per_page=1', { token: token })
        .then(function(r){ return r.json(); })
        .then(function(j){
          var run = j && j.workflow_runs && j.workflow_runs[0];
          var st = runState(run, runId, since);
          if (st === 'busy') { setProgress(3, '云端排队中…'); return 'mine'; }
          if (st === 'mine') {
            runId = run.id;
            return pollSteps(run.id, token).then(function(){ return 'mine'; });
          }
          if (run.conclusion === 'success') return 'done';
          throw new Error('云端更新失败：' + (run.conclusion || '未知原因'));
        });
    }
    function poll(){
      if (Date.now() > deadline) { finish('抓取时间较长，请稍后手动刷新页面查看结果。'); return; }
      pollOnce().then(function(st){
        if (st === 'done') {
          btn.textContent = '更新完成';
          setProgress(100, '更新完成，正在重新载入…');
          var el = document.getElementById('refresh-progress');
          if (el) el.className = 'on done';
          setTimeout(function(){ location.reload(); }, 1800);
          return;
        }
        setTimeout(poll, POLL_MS);
      }).catch(function(e){
        finish(e.message + '\n\n可打开 github.com/' + GH_OWNER + '/' + GH_REPO + '/actions 查看日志。');
      });
    }
    setTimeout(poll, 5000);
  }).catch(function(e){
    var back = DAILY_LIMIT - quotaUsed();
    finish('无法触发云端更新：' + e.message + '\n\n本次不计入次数，今日剩余：' + back + ' 次');
  });
};

/* ---------- 进度条 ---------- */
var elProg = document.getElementById('refresh-progress');
var elFill = document.getElementById('pfill');
var elNote = document.getElementById('pnote');
function showBar(){
  if (elProg) elProg.className = 'on';
}
function hideBar(){ if (elProg) elProg.className = ''; }
function setProgress(p, note){
  p = Math.max(0, Math.min(100, Math.round(p)));
  if (elFill) elFill.style.width = p + '%';
  if (elNote) elNote.textContent = p + '%' + (note ? ' · ' + note : '');
}
/** 取本次运行的全部 job，按加权步骤数推算进度（算法在 progressOfJobs，已单测） */
function pollSteps(runId, token){
  return ghFetch(GH_API + '/runs/' + runId + '/jobs', { token: token })
    .then(function(r){ return r.json(); })
    .then(function(j){
      var pr = progressOfJobs(j && j.jobs);
      setProgress(pr.pct, pr.note);
    })
    .catch(function(){});   // 单次查询失败不改变进度，下一轮再试
}

/* ---------- 每日刷新次数（每日凌晨重置）---------- */
var DAILY_LIMIT = 5;
var QUOTA_KEY = 'wjl-refresh-quota';
function todayKey(){ var d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
function quotaUsed(){
  try {
    var o = JSON.parse(localStorage.getItem(QUOTA_KEY) || 'null');
    if (!o || o.d !== todayKey()) return 0;     // 跨天自动重置
    return o.n || 0;
  } catch(e) { return 0; }
}
function setQuota(n){
  try { localStorage.setItem(QUOTA_KEY, JSON.stringify({ d: todayKey(), n: n })); } catch(e) {}
}


function stamp(){
  var d = new Date(DATA.builtAt || DATA.generatedAt);
  if (isNaN(d.getTime())) d = new Date();
  var ds = d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate();
  elStamp.textContent = '!VERSION! ● ' + ds + ' ——林小夕';
}
/** 上次刷新时间 → 「2026年9月30日5时26分」
    固定按北京时间（UTC+8，不随访客时区变化），不补零。
    offsetMin 显式传入是为了让测试可复现：不依赖运行机器的时区。
    时间取自云端构建时刻：每次刷新都会重新生成数据与页面，所以它就是上次刷新的时间。 */
function fmtRefreshTime(iso, offsetMin){
  var d = new Date(iso);
  if (!iso || isNaN(d.getTime())) return '';   // 时间缺失或非法就不显示，不猜
  var off = typeof offsetMin === 'number' ? offsetMin : 480;
  var t = new Date(d.getTime() + off * 60000);
  return t.getUTCFullYear() + '年' + (t.getUTCMonth() + 1) + '月' + t.getUTCDate() + '日'
    + t.getUTCHours() + '时' + t.getUTCMinutes() + '分';
}
function lastRefresh(){
  if (!elLastRefresh) return;
  var t = fmtRefreshTime(DATA.builtAt || DATA.generatedAt);
  elLastRefresh.textContent = t ? '上次刷新：' + t : '';
}
document.title = '岗位看板';

elSort.value = state.sort;
render(); stamp(); lastRefresh();
})();
