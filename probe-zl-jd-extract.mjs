/**
 * 验证：智联搜索页内嵌 JD 的提取逻辑，对真实页面逐条比对。
 * 用法: node probe-zl-jd-extract.mjs [关键词] [城市码] [页]
 */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function extractInitialState(html) {
  const i = html.indexOf('__INITIAL_STATE__');
  if (i < 0) return null;
  const eq = html.indexOf('=', i);
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

// 与 cloud/fetch-all.mjs 完全一致的提取逻辑（复制，避免 import 副作用）
function zlEmbeddedJD(j) {
  const d = j && j.jobDetailData;
  const raw = d && d.position && d.position.desc && d.position.desc.description;
  if (!raw) return { jd: '', hasDetail: false };
  const jd = String(raw).replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim();
  return { jd, hasDetail: jd.length > 20 };
}

const kw = process.argv[2] || 'HRBP';
const city = process.argv[3] || '763';
const page = process.argv[4] || '1';
const url = `https://sou.zhaopin.com/?kw=${encodeURIComponent(kw)}&jl=${city}&p=${page}`;
const r = await fetch(url, {
  headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,*/*;q=0.8', 'Accept-Language': 'zh-CN,zh;q=0.9', Referer: 'https://sou.zhaopin.com/' },
  redirect: 'follow', signal: AbortSignal.timeout(35000),
});
const st = extractInitialState(await r.text());
const list = (st && st.positionList) || [];
console.log(`HTTP ${r.status} | ${kw} 城市${city} 第${page}页 | 岗位 ${list.length} 条\n`);

let hit = 0, lens = [], noRaw = 0, tooShort = 0;
for (const j of list) {
  const raw = j?.jobDetailData?.position?.desc?.description;
  const { jd, hasDetail } = zlEmbeddedJD(j);
  if (!raw) noRaw++;
  else if (!hasDetail) tooShort++;
  if (hasDetail) { hit++; lens.push(jd.length); }
  const flag = hasDetail ? '✅' : '❌';
  console.log(`${flag} ${String(j.name || '').slice(0, 26).padEnd(28)} JD ${String(jd.length).padStart(5)} 字  ${jd.slice(0, 40).replace(/\s+/g, ' ')}`);
}

lens.sort((a, b) => b - a);
console.log(`\n内嵌 JD 命中：${hit}/${list.length}（${(hit / Math.max(1, list.length) * 100).toFixed(0)}%）`);
console.log(`无处字段 ${noRaw} 条 | 有字段但过短 ${tooShort} 条`);
if (lens.length) {
  console.log(`JD 长度：最长 ${lens[0]} | 中位 ${lens[Math.floor(lens.length / 2)]} | 最短 ${lens[lens.length - 1]}`);
  const empty = list.filter((j) => !zlEmbeddedJD(j).hasDetail && j?.jobDetailData?.position?.desc?.description);
  if (empty.length) console.log(`⚠️ 有 desc.description 但清洗后过短的样例：${JSON.stringify(String(empty[0].jobDetailData.position.desc.description).slice(0, 80))}`);
}
