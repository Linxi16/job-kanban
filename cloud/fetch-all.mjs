/**
 * 云端一条龙抓取（GitHub Actions / 本机通用）
 *
 * 用法：
 *   node cloud/fetch-all.mjs            # 默认：智联列表2页 + 前程列表2页
 *   node cloud/fetch-all.mjs --probe    # 小规模探针：每平台各 1 个关键词 1 页
 *
 * 环境变量：
 *   DATA_DIR      数据目录（默认 <仓库根>/data）
 *   ZL_KWS        智联关键词，逗号分隔
 *   ZL_CITIES     智联城市，逗号分隔（名称，需在内置城市码表中）
 *   ZL_PAGES      智联最多翻几页（硬上限 5）
 *   QC_KWS        前程关键词，逗号分隔
 *   QC_CITIES     前程城市，逗号分隔
 *   QC_PAGES      前程最多翻几页
 *   GAP_MS        请求间隔毫秒（默认 5000，用户指定，不得调小）
 *
 * 产出：
 *   <DATA_DIR>/zhilian-list.json
 *   <DATA_DIR>/51job-list.json
 *   <DATA_DIR>/fetch-report.json
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
if (!fs.existsSync(DATA)) fs.mkdirSync(DATA, { recursive: true });

const PROBE = process.argv.includes('--probe');
const GAP_MS = Number(process.env.GAP_MS || 5000);
/* SHARD=1..N：本进程只负责一组城市，产物写成 *-shardN-*.json，由 merge-shards.mjs 合并 */
const SHARD = (process.env.SHARD || '').trim();
const SHARD_TAG = SHARD ? `-shard${SHARD}` : '';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));

// ---------------- 智联招聘 ----------------
const ZL_CITY_CODES = { 广州: 763, 深圳: 765, 佛山: 766, 东莞: 768, 珠海: 772, 中山: 770, 惠州: 771, 江门: 769 };
const ZL_KWS = (process.env.ZL_KWS || 'HRBP,人事专员,行政专员,人力资源专员').split(',').map((s) => s.trim()).filter(Boolean);
const ZL_CITIES = (process.env.ZL_CITIES || '广州,佛山,深圳,东莞').split(',').map((s) => s.trim()).filter(Boolean);
const ZL_PAGES = Math.min(Number(process.env.ZL_PAGES || 2), 5);
const ZL_CAP = Number(process.env.ZL_CAP || 2000);

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

async function fetchZhilian() {
  const all = [];
  const seen = new Set();
  let reqs = 0, fails = 0;
  const t0 = Date.now();
  console.log(`\n===== 智联招聘：${ZL_KWS.length} 关键词 × ${ZL_CITIES.length} 城市 × ${ZL_PAGES} 页 =====`);

  outer:
  for (let p = 1; p <= ZL_PAGES; p++) {
    for (const kw of ZL_KWS) {
      for (const city of ZL_CITIES) {
        const code = ZL_CITY_CODES[city];
        if (!code) { console.log(`  ⚠️ 未知城市「${city}」，跳过`); continue; }
        if (all.length >= ZL_CAP) break outer;
        const url = `https://sou.zhaopin.com/?kw=${encodeURIComponent(kw)}&jl=${code}&p=${p}`;
        try {
          const r = await fetch(url, {
            headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,*/*;q=0.8', 'Accept-Language': 'zh-CN,zh;q=0.9', Referer: 'https://sou.zhaopin.com/' },
            redirect: 'follow',
            signal: AbortSignal.timeout(35000),
          });
          reqs++;
          const html = await r.text();
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
          console.log(`  p${p} ${city}/${kw}: HTTP ${r.status} 取${list.length} 新增${added} 累计${all.length}`);
          if (!list.length) fails++;
          await sleep(GAP_MS);
        } catch (e) {
          reqs++; fails++;
          console.log(`  p${p} ${city}/${kw}: ❌ ${e.message}`);
          await sleep(GAP_MS);
        }
      }
    }
  }
  fs.writeFileSync(path.join(DATA, `zhilian${SHARD_TAG}-list.json`), JSON.stringify(all, null, 1), 'utf8');
  const mins = ((Date.now() - t0) / 60000).toFixed(1);
  const hitCapZ = all.length >= ZL_CAP;
  console.log(`智联完成：${all.length} 条唯一岗位 | ${reqs} 次请求（失败 ${fails}） | ${mins} 分钟`);
  if (hitCapZ) console.log(`  ⚠️ 已达到上限 ${ZL_CAP} 条，提前结束抓取（本次未跑完全部组合）`);
  return { count: all.length, reqs, fails, minutes: Number(mins) };
}

// ---------------- 前程无忧 ----------------
const QC_SIGN_KEY = 'abfc8f9dcf8c3f3d8aa294ac5f2cf2cc7767e5592590f39c3f503271dd68562b';
const QC_HOME = 'https://cupid.51job.com';
const QC_API = '/open/noauth/jobs/fresh-job-list';
/* 前程无忧 jobArea 城市码（2026-09 实测验证：返回岗位城市与代码一致） */
const QC_CITY = {
  广州: '030200', 佛山: '030600', 深圳: '040000', 东莞: '030800',
  珠海: '030500', 中山: '030700', 惠州: '030300', 江门: '031500',
  汕头: '030400', 韶关: '031400', 湛江: '031700', 肇庆: '031800',
};
const QC_KWS = (process.env.QC_KWS || 'HRBP,人事专员,行政专员,人力资源专员').split(',').map((s) => s.trim()).filter(Boolean);
const QC_CITIES = (process.env.QC_CITIES || '广州,佛山').split(',').map((s) => s.trim()).filter(Boolean);
const QC_PAGES = Number(process.env.QC_PAGES || 2);
const QC_CAP = Number(process.env.QC_CAP || 2000);
const QC_PAGE_SIZE = 30;

const qcSign = (t) => crypto.createHmac('sha256', QC_SIGN_KEY).update(t).digest('hex');

async function qcGet(params) {
  const qs = Object.entries(params)
    .filter(([, v]) => v !== '' && v !== null && v !== undefined)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  const t = QC_API + '?api_key=51job&timestamp=' + Math.floor(Date.now() / 1000) + (qs ? '&' + qs : '');
  const r = await fetch(QC_HOME + t, {
    headers: {
      'User-Agent': UA, sign: qcSign(t), Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9', Referer: 'https://we.51job.com/pc/search',
    },
    signal: AbortSignal.timeout(30000),
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { }
  return { http: r.status, json, text };
}

function qcNormalize(it) {
  const d = it.jobAreaLevelDetail || {};
  return {
    platform: '前程无忧',
    jobId: String(it.jobId),
    title: it.jobName || '',
    company: it.fullCompanyName || it.companyName || '',
    url: it.jobHref || `https://jobs.51job.com/${it.jobId}.html`,
    salaryText: it.provideSalaryString || '',
    salaryMin: it.provideSalaryMin ?? null,
    salaryMax: it.provideSalaryMax ?? null,
    city: d.cityName || it.jobAreaString || '',
    province: d.provinceName || '',
    district: d.districtName || '',
    areaText: it.jobAreaString || '',
    publishTime: it.issueDateString || '',
    confirmTime: it.confirmDateString || '',
    workYear: it.workYearString || '',
    degree: it.degreeString || '',
    companySize: it.companySizeString || '',
    companyType: it.companyTypeString || '',
    industry: it.industryType1Name || '',
    jobTags: it.jobTags || [],
    welfareCodes: it.welfareCodeList || [],
    jobDescribe: it.jobDescribe || '',
    hrName: it.hrName || '',
    hrOnline: it.hrOnline === true,
  };
}

async function fetch51job() {
  const all = [];
  const seen = new Set();
  let reqs = 0, fails = 0;
  const t0 = Date.now();
  console.log(`\n===== 前程无忧：${QC_KWS.length} 关键词 × ${QC_CITIES.length} 城市 × ${QC_PAGES} 页 =====`);
  // 城市名写错会导致整块数据被静默跳过，这里开跑前就硬性拦下来
  const badCities = QC_CITIES.filter((c) => !QC_CITY[c]);
  if (badCities.length) {
    const msg = `未知城市：${badCities.join('、')}｜可用：${Object.keys(QC_CITY).join('、')}`;
    console.log('  ❌ ' + msg);
    if (process.env.STRICT_CITY === '1') throw new Error(msg);
  }
  console.log(`  城市：${QC_CITIES.map((c) => `${c}(${QC_CITY[c] || '?'})`).join(' ')}　预计请求 ${QC_KWS.length * QC_CITIES.length * QC_PAGES} 次`);

  outer:
  for (let p = 1; p <= QC_PAGES; p++) {
    for (const kw of QC_KWS) {
      for (const city of QC_CITIES) {
        const code = QC_CITY[city];
        if (!code) { console.log(`  ⚠️ 未知城市「${city}」，跳过`); continue; }
        if (all.length >= QC_CAP) break outer;
        try {
          const { http, json } = await qcGet({ keyword: kw, jobArea: code, pageNum: p, pageSize: QC_PAGE_SIZE, sortType: 1 });
          reqs++;
          const items = json?.resultbody?.job?.items || [];
          let added = 0;
          for (const it of items) {
            const id = String(it.jobId || '');
            if (!id || seen.has(id)) continue;
            seen.add(id);
            all.push(qcNormalize(it));
            added++;
          }
          console.log(`  p${p} ${city}/${kw}: HTTP ${http} 取${items.length} 新增${added} 累计${all.length}`);
          if (!items.length) fails++;
        } catch (e) {
          reqs++; fails++;
          console.log(`  p${p} ${city}/${kw}: ❌ ${e.message}`);
        }
        await sleep(GAP_MS);
      }
    }
  }
  fs.writeFileSync(path.join(DATA, `51job${SHARD_TAG}-list.json`), JSON.stringify(all, null, 1), 'utf8');  const mins = ((Date.now() - t0) / 60000).toFixed(1);
  const hitCapQ = all.length >= QC_CAP;
  console.log(`前程完成：${all.length} 条唯一岗位 | ${reqs} 次请求（失败 ${fails}） | ${mins} 分钟`);
  if (hitCapQ) console.log(`  ⚠️ 已达到上限 ${QC_CAP} 条，提前结束抓取（本次未跑完全部组合）`);
  return { count: all.length, reqs, fails, minutes: Number(mins) };
}

// ---------------- 主流程 ----------------
/* PLATFORM=zhilian 或 51job 时只抓一个平台（云端拆成两个并行任务，各平台内部仍严格保持 GAP_MS 间隔）。
   两个平台访问的是不同网站，并行不会给任何单一站点增加压力。 */
const ONLY = (process.env.PLATFORM || '').trim().toLowerCase();
const doZhilian = !ONLY || ONLY === 'zhilian' || ONLY === '智联';
const do51job = !ONLY || ONLY === '51job' || ONLY === '前程';
const report = { generatedAt: new Date().toISOString(), dataDir: DATA, gapMs: GAP_MS, probe: PROBE, platform: ONLY || 'all' };
console.log(`本次抓取范围：${doZhilian ? '智联招聘 ' : ''}${do51job ? '前程无忧' : ''}（间隔 ${GAP_MS}ms）`);

/* 预演模式：不联网，只算请求数与预计耗时（node cloud/fetch-all.mjs --plan） */
if (process.argv.includes('--plan')) {
  const perReqMs = GAP_MS + 700;   // 5 秒间隔 + 约 0.7 秒网络与解析
  const plan = (name, kws, cities, pages, codeTable, cap) => {
    const bad = cities.filter((c) => !codeTable[c]);
    const reqs = kws.length * cities.length * pages;
    const mins = (reqs * perReqMs / 60000).toFixed(1);
    console.log(`\n【${name}】关键词 ${kws.length} × 城市 ${cities.length} × 页数 ${pages} = ${reqs} 次请求 → 约 ${mins} 分钟`);
    console.log(`  城市：${cities.map((c) => `${c}(${codeTable[c] || '❌未知'})`).join(' ')}`);
    console.log(`  唯一岗位上限：${cap} 条`);
    if (bad.length) console.log(`  ❌ 未知城市：${bad.join('、')}｜可用：${Object.keys(codeTable).join('、')}`);
    return bad.length ? null : reqs * perReqMs;
  };
  const tz = doZhilian ? plan('智联招聘', ZL_KWS, ZL_CITIES, ZL_PAGES, ZL_CITY_CODES, ZL_CAP) : 0;
  const tq = do51job ? plan('前程无忧', QC_KWS, QC_CITIES, QC_PAGES, QC_CITY, QC_CAP) : 0;
  if (tz === null || tq === null) process.exitCode = 1;
  else console.log(`\n并行结构下总耗时由较慢的一方决定：约 ${(Math.max(tz, tq) / 60000).toFixed(1)} 分钟（另加合并/评分/构建约 1.5 分钟）`);
  process.exit(process.exitCode || 0);
}
if (doZhilian) {
  try {
    report.zhilian = await fetchZhilian();
  } catch (e) {
    console.log('智联整体失败:', e.message);
    report.zhilian = { error: e.message };
  }
}
if (do51job) {
  try {
    report['51job'] = await fetch51job();
  } catch (e) {
    console.log('前程整体失败:', e.message);
    report['51job'] = { error: e.message };
  }
}
fs.writeFileSync(path.join(DATA, `fetch-report-${(ONLY || 'all')}${SHARD_TAG}.json`), JSON.stringify(report, null, 1), 'utf8');
fs.writeFileSync(path.join(DATA, 'fetch-report.json'), JSON.stringify(report, null, 1), 'utf8');
console.log('\n===== 汇总 =====');
console.log(JSON.stringify(report, null, 1));
