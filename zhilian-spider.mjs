// 智联招聘抓取器
//   列表页：sou.zhaopin.com/?kw=X&jl=CODE&p=N   （每页20条，上限5页=100条）
//   详情页：zhaopin.com/jobdetail/<positionNumber>.htm → 完整JD
// 特性：低速节流、请求计数、可中断续跑、字段提取、粗筛
//
// 用法：
//   node zhilian-spider.mjs list                只抓列表页
//   node zhilian-spider.mjs detail [上限]       抓详情页（默认50）
//   node zhilian-spider.mjs all                 列表+详情一条龙
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, 'data');
if (!fs.existsSync(DATA)) fs.mkdirSync(DATA, { recursive: true });

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// ---- 配置 ----
const DETAIL_GAP_MS = 5000;   // 详情页间隔 5 秒（按你的要求）
const LIST_GAP_MS = 4000;     // 列表页间隔 4 秒
const DETAIL_CAP = Number(process.env.DETAIL_CAP || 100);
// 广东省主要城市（按你要求覆盖省内岗位）
const CITY_CODES = { 广州: 763, 深圳: 765, 佛山: 766, 东莞: 768, 珠海: 772, 中山: 770, 惠州: 771, 江门: 769 };
const KEYWORDS = ['HRBP', 'HR专员', '人事专员', '人力资源专员', '行政专员', '行政助理', '部门助理', '人力资源管培生'];
const MAX_PAGES = Number(process.env.MAX_PAGES || 5);   // 智联列表页硬上限 5 页
const TARGET = Number(process.env.TARGET || 500);       // 目标条数

const sleep = (ms) => new Promise((s) => setTimeout(s, ms));

function extractInitialState(html) {
  const i = html.indexOf('__INITIAL_STATE__');
  if (i < 0) return null;
  const eq = html.indexOf('=', i);
  if (eq < 0) return null;
  let s = -1;
  for (let k = eq; k < Math.min(eq + 300, html.length); k++) if (html[k] === '{') { s = k; break; }
  if (s < 0) return null;
  let depth = 0, inStr = false, esc = false, quote = '';
  for (let k = s; k < html.length; k++) {
    const c = html[k];
    if (inStr) { if (esc) { esc = false; continue; } if (c === '\\') { esc = true; continue; } if (c === quote) inStr = false; continue; }
    if (c === '"' || c === "'") { inStr = true; quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { try { return JSON.parse(html.slice(s, k + 1)); } catch { return null; } } }
  }
  return null;
}

async function get(url) {
  const r = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,*/*;q=0.8', 'Accept-Language': 'zh-CN,zh;q=0.9' },
    redirect: 'follow', signal: AbortSignal.timeout(35000),
  });
  return { status: r.status, finalUrl: r.url, html: await r.text() };
}

// ---------- 一、抓列表页 ----------
async function fetchList() {
  const all = [];
  const seen = new Set();
  let reqs = 0;
  const t0 = Date.now();

  // 交错遍历：页深 → 关键词 → 城市，保证每个城市/关键词都有机会被覆盖到，
  // 避免某个城市先跑满目标条数导致其余城市一条不取。
  outer:
  for (let p = 1; p <= MAX_PAGES; p++) {
    for (const kw of KEYWORDS) {
      for (const [city, code] of Object.entries(CITY_CODES)) {
        if (all.length >= TARGET) break outer;
        const url = `https://sou.zhaopin.com/?kw=${encodeURIComponent(kw)}&jl=${code}&p=${p}`;
        try {
          const { status, html } = await get(url);
          reqs++;
          const st = extractInitialState(html);
          const list = (st && st.positionList) || [];
          let added = 0;
          for (const j of list) {
            const key = j.number || j.jobId;
            if (!key || seen.has(key)) continue;
            seen.add(key);
            all.push({ ...j, __city: city, __kw: kw });
            added++;
          }
          process.stdout.write(`  p${p} ${city}/${kw}: HTTP ${status} 取${list.length} 新增${added} 累计${all.length}\n`);
          if (list.length < 20) continue;   // 该组合无更多结果
        } catch (e) {
          process.stdout.write(`  p${p} ${city}/${kw}: ❌ ${e.message}\n`);
        }
        await sleep(LIST_GAP_MS);
      }
    }
  }
  fs.writeFileSync(path.join(DATA, 'zhilian-list.json'), JSON.stringify(all, null, 1), 'utf8');
  console.log(`\n列表完成：${all.length} 条唯一岗位 | ${reqs} 次请求 | ${((Date.now() - t0) / 60000).toFixed(1)} 分钟`);
  console.log(`已存 data/zhilian-list.json`);
  return all;
}

// ---------- 二、粗筛（不花详情请求） ----------
const BAD_TITLE = /销售|电销|客服|运营专员|市场专员|业务员|招工|普工|骑手|司机|主播|保险代理|房产|中介|店长|导购|地推|招商|地推|BD|商务拓展/;
const GOOD_TITLE = /HRBP|HR\s*BP|人事|人力|招聘|行政|助理|管培|储备干部|部门助理|行政专员/i;
const BAD_EXP = /3-5年|5-10年|10年以上|5年以上|3年以上|3年及以上|五年|三年/;
const OK_EXP = /无经验|应届|1年以下|1-3年|经验不限|不限/;
const SMALL_SCALE = /^20-99人$|^0-20人$|^少于20人$|^20人以下$/;

function roughFilter(j) {
  const title = String(j.name || '');
  const exp = String(j.workingExp || '');
  const scale = String(j.companySize || '');
  const reasons = [];
  if (BAD_TITLE.test(title)) reasons.push('标题不符:' + title);
  if (!GOOD_TITLE.test(title)) reasons.push('标题非目标岗');
  if (BAD_EXP.test(exp)) reasons.push('经验超标:' + exp);
  if (SMALL_SCALE.test(scale)) reasons.push('规模过小:' + scale);
  return { pass: reasons.length === 0, reasons };
}

// ---------- 三、抓详情页 ----------
function parseSalaryToK(s) {
  // "3-5万·14薪" / "8千-1.2万" / "6000-8000元"
  const t = String(s || '');
  const num = (x, unit) => {
    let v = parseFloat(x);
    if (unit === '万') v *= 10;      // 万/月 → k
    else if (unit === '千') v *= 1;  // 千 → k
    else v = v / 1000;               // 元 → k
    return v;
  };
  const m = t.match(/([\d.]+)\s*(万|千|元)?\s*[-~至]\s*([\d.]+)\s*(万|千|元)?/);
  if (m) {
    const u1 = m[2] || m[4] || '元';
    const u2 = m[4] || m[2] || '元';
    return { lo: num(m[1], u1), hi: num(m[3], u2) };
  }
  const single = t.match(/([\d.]+)\s*(万|千|元)/);
  if (single) { const v = num(single[1], single[2]); return { lo: v, hi: v }; }
  return null;
}

function pickDetail(dp, dc, j) {
  const jdHtml = String(dp.jobDesc || '');
  const jd = String(dp.description || jdHtml.replace(/<br\s*\/?>/g, '\n') || '');
  return {
    number: dp.positionNumber || j.jobNumber,
    jobId: dp.positionId,
    name: dp.positionName,
    salary: dp.salary,
    salaryK: parseSalaryToK(dp.salary),
    education: dp.education,
    workingExp: dp.positionWorkingExp,
    workType: dp.workType,
    publishTime: dp.publishTime,
    workCity: dp.workCity,
    cityDistrict: dp.cityDistrict,
    companyName: dc.companyName,
    companySize: dc.companySize,
    industryName: dc.industryName || j.industryName || '',
    financingStage: dc.financingStageName || '',
    companyDescription: dc.companyDescription || '',
    labels: dp.labels || [],
    welfareLabel: dp.welfareLabel || [],
    welfareTags: dp.welfareTags || [],
    url: dp.positionUrl || (j.number ? `https://www.zhipin.com` : ''),
    zlUrl: `https://www.zhaopin.com/jobdetail/${dp.positionNumber || j.jobNumber}.htm`,
    jd,
    jdLen: jd.length,
  };
}

async function fetchDetails(cap) {
  const listPath = path.join(DATA, 'zhilian-list.json');
  if (!fs.existsSync(listPath)) { console.log('❌ 请先跑 list'); return; }
  const list = JSON.parse(fs.readFileSync(listPath, 'utf8'));

  // 候选排序优先级：① 评分引擎结果（若已生成）② 粗筛通过 ③ 发布时间倒序
  let candidates, rejected;
  const scoredPath = path.join(DATA, 'scored-zhilian.json');
  if (fs.existsSync(scoredPath)) {
    const ranked = JSON.parse(fs.readFileSync(scoredPath, 'utf8'));
    const rankMap = new Map(ranked.map((r, i) => [r.id, { i, score: r.score, verdict: r.verdict, neg: (r.negatives || []).length }]));
    // 候选：未被过滤项命中（negatives 为空）的岗位，按分数降序
    const arr = list.map((j) => ({ j, r: rankMap.get(String(j.number)) }));
    candidates = arr
      .filter((x) => x.r && x.r.neg === 0)
      .sort((a, b) => b.r.score - a.r.score);
    rejected = arr.filter((x) => !x.r || x.r.neg > 0);
    console.log(`按评分引擎排序：候选 ${candidates.length} 条（未被过滤、分数降序），不推荐 ${rejected.length} 条`);
  } else {
    const rough = list.map((j) => {
      const f = roughFilter(j);
      return { j, pass: f.pass, reasons: f.reasons, t: Date.parse(String(j.publishTime || '').replace(/-/g, '/')) || 0 };
    });
    candidates = rough.filter((s) => s.pass).sort((a, b) => b.t - a.t);
    rejected = rough.filter((s) => !s.pass);
    console.log(`粗筛：${list.length} 条 → 通过 ${candidates.length}，剔除 ${rejected.length}`);
  }

  const outPath = path.join(DATA, 'zhilian-detail.json');
  const done = fs.existsSync(outPath) ? JSON.parse(fs.readFileSync(outPath, 'utf8')) : [];
  const doneSet = new Set(done.map((d) => d.number));

  const todo = candidates.slice(0, cap).filter((c) => !doneSet.has(c.j.number));
  console.log(`详情页：本批 ${todo.length} 次请求（上限 ${cap}，间隔 ${DETAIL_GAP_MS / 1000}s，约 ${((todo.length * DETAIL_GAP_MS) / 60000).toFixed(0)} 分钟）\n`);

  let n = 0;
  for (const c of todo) {
    const j = c.j;
    const url = `https://www.zhaopin.com/jobdetail/${j.number}.htm`;
    try {
      const { status, html } = await get(url);
      const st = extractInitialState(html);
      if (st && st.jobDetail) {
        const rec = pickDetail(st.jobDetail.detailedPosition || {}, st.jobDetail.detailedCompany || {}, j);
        rec.__city = j.__city;
        rec.__kw = j.__kw;
        rec.__listPublishTime = j.publishTime;
        rec.__listIndustry = j.industryName;
        rec.__listWelfare = j.welfareLabel;
        rec.__score = c.r ? c.r.score : null;
        rec.__verdict = c.r ? c.r.verdict : null;
        done.push(rec);
        n++;
        process.stdout.write(`  [${n}/${todo.length}] ✓ ${rec.name || '?'} @ ${rec.companyName || '?'} | JD ${rec.jdLen}字 | ${rec.publishTime || '无时间'} | 分${rec.__score ?? '-'}\n`);
      } else {
        process.stdout.write(`  [${n}/${todo.length}] ⚠ HTTP ${status} 但无 jobDetail\n`);
      }
    } catch (e) {
      process.stdout.write(`  [${n}/${todo.length}] ❌ ${j.name}: ${e.message}\n`);
    }
    if (n % 10 === 0) fs.writeFileSync(outPath, JSON.stringify(done, null, 1), 'utf8'); // 定期存盘
    await sleep(DETAIL_GAP_MS);
  }
  fs.writeFileSync(outPath, JSON.stringify(done, null, 1), 'utf8');
  // 同时存被剔除的，便于核查
  fs.writeFileSync(path.join(DATA, 'zhilian-rejected.json'), JSON.stringify(
    rejected.slice(0, 800).map((r) => ({ name: r.j.name, company: r.j.companyName, exp: r.j.workingExp, size: r.j.companySize, why: r.reasons || (r.r ? r.r.verdict : '') })),
    null, 1), 'utf8');
  console.log(`\n详情完成：新增 ${n} 条，累计 ${done.length} 条 → data/zhilian-detail.json`);
}

// ---------- 主流程 ----------
const mode = process.argv[2] || 'list';
if (mode === 'list') await fetchList();
else if (mode === 'detail') await fetchDetails(parseInt(process.argv[3] || DETAIL_CAP, 10));
else if (mode === 'all') { await fetchList(); await fetchDetails(DETAIL_CAP); }
else console.log('用法: node zhilian-spider.mjs list|detail [上限]|all');
