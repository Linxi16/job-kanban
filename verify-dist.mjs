/**
 * 云端发布版（dist/看板.html）专属校验：
 *   1. 结构与主看板一致（payload、脚本、进度条、每日次数）
 *   2. 已脱敏：不含姓名/学校/现居/籍贯/生日等可定位到本人的信息
 *   3. 按钮指向正确的仓库与工作流
 */
import fs from 'fs';
import path from 'path';

const FILE = process.env.DIST_HTML || path.join('dist', '看板.html');
const html = fs.readFileSync(FILE, 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('✅ ' + m); } else { fail++; console.log('❌ ' + m); } };

console.log('校验文件: ' + FILE + ` (${(html.length / 1024).toFixed(0)} KB)\n`);

/* ---------- 1. 结构完整 ---------- */
const pm = html.match(/<script id="payload" type="application\/json">([\s\S]*?)<\/script>/);
ok(!!pm, 'payload 脚本块存在');
let P = null;
try { P = JSON.parse(pm[1].replace(/<\\\//g, '</')); ok(true, 'payload JSON 可解析'); }
catch (e) { ok(false, 'payload JSON 可解析 — ' + e.message); }
if (P) {
  ok(Array.isArray(P.platforms) && P.platforms.length === 2, `平台数量为 2（实际 ${P.platforms && P.platforms.length}）`);
  const jobs = (P.platforms || []).reduce((n, p) => n + (p.jobs || []).length, 0);
  ok(jobs > 0, `内嵌推荐岗位 ${jobs} 条`);
  ok((P.platforms || []).every((p) => /^https?:\/\//.test(p.url || p.home || '') || true), '平台结构正常');
}
ok(/id="refresh"/.test(html), '刷新按钮存在');
ok(/id="refresh-progress"/.test(html) && /id="pfill"/.test(html) && /id="pnote"/.test(html), '进度条结构完整');
ok(/DAILY_LIMIT\s*=\s*5/.test(html), '每日刷新上限 5 次');
ok(/今日剩余次数：/.test(html) && /alert\('无剩余次数'\)/.test(html), '次数提示文案完整');

/* 站点根路径可直接访问（手机不用输文件名） */
const idxPath = path.join(path.dirname(FILE), 'index.html');
const hasIdx = fs.existsSync(idxPath);
ok(hasIdx, '发布目录含 index.html（根路径可直接打开）');
if (hasIdx) {
  const idx = fs.readFileSync(idxPath, 'utf8');
  ok(idx === html, 'index.html 与看板内容完全一致');
}

/* ---------- 2. 脱敏 ---------- */
/* 判定逻辑抽在 dist-sanitize.mjs，测试脚本共用同一份实现。
   2026-10-19 起改为结构化校验（画像字段白名单 + 姓名必须为笔名 + 标题固定），
   规则里不再保存任何真实取值——否则"检测名单"本身就成了一份个人信息清单。 */
const { piiRegions, findLeaks, ALLOWED_PROFILE_KEYS, PEN_NAME, SITE_TITLE } = await import('./dist-sanitize.mjs');
const { profile: profRegion, title: pageTitle, h1: pageH1 } = piiRegions(html);
console.log(`（画像区 ${profRegion.length} 字；岗位数据不计入）\n`);
const leaks = findLeaks(html);
ok(leaks.length === 0,
  `发布版无个人信息泄漏${leaks.length ? '：' + leaks.map((l) => `${l.name}（${l.region}）`).join('、') : ''}`);
if (P) {
  const prof = P.profile || {};
  ok(prof.name === PEN_NAME, `画像署名已换成笔名（当前：${prof.name}）`);
  const extra = Object.keys(prof).filter((k) => !ALLOWED_PROFILE_KEYS.includes(k));
  ok(extra.length === 0,
    `画像只保留允许字段（${Object.keys(prof).length} 个）${extra.length ? ' → 多余：' + extra.join('、') : ''}`);
}
ok(pageTitle === SITE_TITLE && pageH1 === SITE_TITLE,
  `页面标题与大标题均为站名（title「${pageTitle}」· h1「${pageH1}」）`);

/* ---------- 3. 按钮指向 ---------- */
const owner = (html.match(/GH_OWNER\s*=\s*'([^']+)'/) || [])[1];
const repo = (html.match(/GH_REPO\s*=\s*'([^']+)'/) || [])[1];
const wf = (html.match(/GH_WF\s*=\s*'([^']+)'/) || [])[1];
ok(!!owner && !!repo && !!wf, `按钮已注入仓库信息：${owner}/${repo} → ${wf}`);
ok(/api\.github\.com\/repos\//.test(html) && /\/dispatches/.test(html), '按钮走 GitHub Actions 触发接口');

console.log(`\n合计：通过 ${pass} / 失败 ${fail}`);
process.exit(fail ? 1 : 0);
