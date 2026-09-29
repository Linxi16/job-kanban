/**
 * 前程无忧（51job）岗位采集器
 *
 * 依据：cupid.51job.com 的 open/noauth/jobs/fresh-job-list 接口（无需登录、不受 WAF 保护）
 *   签名 = HmacSHA256("/open/noauth/jobs/fresh-job-list?api_key=51job&timestamp=<秒>&<参数>", SIGN_KEY)
 *
 * 请求节流：默认 5 秒/次（用户指定）
 * 上限：默认 100 条岗位（用户指定）
 *
 * 用法：
 *   node 51job-spider.mjs list          # 采集岗位列表
 *   node 51job-spider.mjs dict          # 查城市代码
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, 'data');
if (!fs.existsSync(DATA)) fs.mkdirSync(DATA, { recursive: true });

const SIGN_KEY = 'abfc8f9dcf8c3f3d8aa294ac5f2cf2cc7767e5592590f39c3f503271dd68562b';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const HOME = 'https://cupid.51job.com';
const GAP_MS = Number(process.env.GAP_MS || 5000);       // 5 秒/次
const LIMIT = Number(process.env.LIMIT || 500);          // 目标 500 条
const PAGE_SIZE = 30;
const MAX_PAGES = Number(process.env.MAX_PAGES || 12);   // 每个关键词最多翻 12 页

const CITY = { 广州: '030200', 佛山: '030600' };
const KEYWORDS = [
  'HRBP', 'HR专员', '人事专员', '人力资源专员', '行政专员', '行政助理', '部门助理', '人力资源管培生',
  '人事助理', '人事行政专员', '行政人事', '招聘专员', '人力资源助理', '人事主管', '行政文员',
  '人事文员', '综合文员', '总经理助理', '人事行政助理', '人力资源', '人事', '行政',
];

const sign = (t) => crypto.createHmac('sha256', SIGN_KEY).update(t).digest('hex');
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));

async function cupidGet(apiPath, params = {}) {
  const qs = Object.entries(params)
    .filter(([, v]) => v !== '' && v !== null && v !== undefined)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  const t = apiPath + '?api_key=51job&timestamp=' + Math.floor(Date.now() / 1000) + (qs ? '&' + qs : '');
  const r = await fetch(HOME + t, {
    headers: {
      'User-Agent': UA, sign: sign(t), Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9', Referer: 'https://we.51job.com/pc/search',
    },
    signal: AbortSignal.timeout(30000),
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { }
  return { http: r.status, json, text };
}

/** 城市字典 */
async function dict() {
  const r = await cupidGet('/open/noauth/dictionary/search-job-area', { keyword: '佛山' });
  const out = [];
  const walk = (arr) => {
    for (const g of arr || []) {
      for (const it of g.items || []) {
        out.push({ code: it.code, value: it.value, group: g.title });
        if (Array.isArray(it.items)) walk([{ items: it.items }]);
      }
    }
  };
  walk(r.json?.resultbody);
  return out;
}

/** 归一化一条 51job 岗位 */
function normalize(it) {
  const d = it.jobAreaLevelDetail || {};
  return {
    platform: '前程无忧',
    jobId: String(it.jobId),
    title: it.jobName || '',
    company: it.fullCompanyName || it.companyName || '',
    url: `https://jobs.51job.com/guangzhou/` + `${it.jobId}.html`,   // 通用详情页
    // 薪资
    salaryText: it.provideSalaryString || '',
    salaryMin: it.jobSalaryMin || null,
    salaryMax: it.jobSalaryMax || null,
    // 地点
    city: d.cityString || '',
    province: d.provinceString || '',
    district: d.districtString || '',
    areaText: it.jobAreaString || '',
    // 时间
    publishTime: it.issueDateString || '',
    confirmTime: it.confirmDateString || '',
    // 要求
    workYear: it.workYearString || '',
    workYearCode: it.workYear || '',
    degree: it.degreeString || '',
    jobTerm: it.termStr || '',
    isIntern: !!it.isIntern,
    // 公司
    companySize: it.companySizeString || '',
    companyType: it.companyTypeString || '',
    industry: it.industryType1Str || it.coIndustryAllText || '',
    // 标签 / 福利
    jobTags: it.jobTags || [],
    welfareCodes: (it.jobWelfareCodeDataList || []).map((x) => x.code || x.value || x.name || JSON.stringify(x)).slice(0, 20),
    sesameLabels: (it.sesameLabelList || []).map((x) => x.value || x.name || x.code || JSON.stringify(x)).slice(0, 20),
    // 描述
    jobDescribe: (it.jobDescribe || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim(),
    // HR
    hrName: it.hrName || '',
    hrPosition: it.hrPosition || '',
    hrOnline: !!it.hrIsOnline,
    hrLabels: it.hrLabels || [],
    // 原始
    raw: it,
  };
}

async function list() {
  const seen = new Map();
  const log = [];
  let reqCount = 0;

  // 交错遍历：页深 → 关键词 → 城市，保证广佛两城都被覆盖
  outer:
  for (let page = 1; page <= MAX_PAGES; page++) {
    for (const kw of KEYWORDS) {
      for (const [cityName, cityCode] of Object.entries(CITY)) {
        if (seen.size >= LIMIT) break outer;
        reqCount++;
        process.stdout.write(`[${reqCount}] p${page} ${cityName}/${kw} … `);
        let r;
        try {
          r = await cupidGet('/open/noauth/jobs/fresh-job-list', {
            keyword: kw, jobArea: cityCode, pageNum: page, pageSize: PAGE_SIZE,
          });
        } catch (e) {
          console.log(`❌ ${e.message}`);
          await sleep(GAP_MS);
          continue;
        }
        const items = r.json?.resultbody?.job?.items || [];
        let added = 0;
        for (const it of items) {
          const id = String(it.jobId);
          if (seen.has(id)) continue;
          seen.set(id, normalize(it));
          added++;
          if (seen.size >= LIMIT) break;
        }
        const total = r.json?.resultbody?.job?.totalCount ?? '?';
        console.log(`HTTP ${r.http} status=${r.json?.status} 命中${total} 取${items.length} 新增${added} 累计${seen.size}`);
        log.push({ city: cityName, kw, page, total, got: items.length, added, reqCount });
        if (items.length >= PAGE_SIZE) await sleep(GAP_MS);
      }
    }
  }

  const list = [...seen.values()];
  fs.writeFileSync(path.join(DATA, '51job-list.json'), JSON.stringify(list, null, 1), 'utf8');
  fs.writeFileSync(path.join(DATA, '51job-crawl-log.json'), JSON.stringify(log, null, 1), 'utf8');
  console.log(`\n✅ 完成：共 ${list.length} 条岗位，${reqCount} 次请求 → data/51job-list.json`);
  return list;
}

const mode = process.argv[2] || 'list';
if (mode === 'dict') {
  const d = await dict();
  console.log(JSON.stringify(d.filter((x) => /广州|佛山|深圳|东莞|中山|珠海|惠州/.test(x.value)), null, 1));
} else {
  await list();
}
