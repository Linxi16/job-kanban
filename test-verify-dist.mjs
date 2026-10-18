/**
 * 反向测试：确认「脱敏判定」真能抓到泄漏，且不会因岗位数据里的公司名误报。
 * 直接调用 dist-sanitize.mjs（与 verify-dist.mjs 同一份实现），避免子进程（沙箱禁止管道 stdio）。
 *
 * 2026-10-19：规则已改为结构化校验（不含任何真实取值），因此这里用合成的假姓名/假学校来注入，
 * 不再需要引用真名——注入什么都会被"字段白名单 + 姓名必须为笔名"抓到。
 */
import fs from 'node:fs';
import { findLeaks, PII_PATTERNS, ALLOWED_PROFILE_KEYS, PEN_NAME } from './dist-sanitize.mjs';

const FILE = 'dist/看板.html';
const ORIG = fs.readFileSync(FILE, 'utf8');
const ANCHOR = `"name":"${PEN_NAME}"`;
if (!ORIG.includes(ANCHOR)) { console.log('⚠️ 找不到画像锚点，测试无效'); process.exit(1); }

let pass = 0, total = 0;
const report = (ok, msg) => { total++; if (ok) { pass++; console.log('✅ ' + msg); } else console.log('❌ ' + msg); };

/* ---- 1. 画像区注入 → 必须被抓到 ---- */
const INJECT = [
  ['姓名', '"name":"张三"'],                                   // 姓名不是笔名
  ['画像字段「school」', '"name":"林小夕","school":"某某大学"'],      // 多出白名单外字段
  ['画像字段「phone」', '"name":"林小夕","phone":"13800138000"'],    // 多出字段 + 手机号
  ['画像字段「qq」', '"name":"林小夕","qq":"123456789"'],             // 多出字段
  ['手机号', '"name":"13800138000"'],                          // 姓名位置塞手机号，验证通用格式能抓到
];
for (const [expect, replacement] of INJECT) {
  const leaks = findLeaks(ORIG.replace(ANCHOR, replacement));
  const hit = leaks.find((l) => l.name === expect);
  report(!!hit, `抓到「${expect}」${hit ? ` → 泄漏于${hit.region}（${hit.hit}）` : '！返回：' + JSON.stringify(leaks)}`);
}

/* ---- 2. 署名区（<title> / <h1>）注入 → 必须被抓到 ---- */
{
  const leaks = findLeaks(ORIG.replace('<h1 class="title-main">岗位看板</h1>', '<h1 class="title-main">岗位看板 · 张三</h1>'));
  report(leaks.some((l) => l.name === '页面大标题'), `抓到「署名区拼姓名」${leaks.length ? '' : ' → 未发现'}`);
}
{
  const leaks = findLeaks(ORIG.replace('<title>岗位看板</title>', '<title>岗位看板｜张三</title>'));
  report(leaks.some((l) => l.name === '页面标题'), '抓到「标题拼姓名」');
}

/* ---- 3. 岗位数据里出现公司名 → 不得误报 ---- */
{
  const jobHtml = ORIG + '<!-- 某某科技 某某教育 招生顾问 -->';
  const jobLeaks = findLeaks(jobHtml);
  report(jobLeaks.length === 0, `岗位/备注区出现公司名不误报${jobLeaks.length ? '！' + JSON.stringify(jobLeaks) : ''}`);
}

/* ---- 4. 当前真实 dist 必须干净 ---- */
{
  const real = findLeaks(ORIG);
  report(real.length === 0, `当前 dist 看板干净${real.length ? '！残留：' + JSON.stringify(real) : ''}`);
}

/* ---- 5. 规则完整性 ---- */
report(ALLOWED_PROFILE_KEYS.length >= 5 && ALLOWED_PROFILE_KEYS.includes('name'),
  `画像白名单完整（${ALLOWED_PROFILE_KEYS.length} 个字段）`);
report(PII_PATTERNS.every(([n, re]) => typeof n === 'string' && n.length && re instanceof RegExp),
  `通用敏感格式规则完整（${PII_PATTERNS.length} 条）`);

/* 注：这里**故意不写**「规则里不许出现真名」的断言——那样等于把真名又写回代码。
   检查方式改为推送前用 grep 扫一遍仓库（见交接说明）。 */

console.log(`\n反向测试：${pass}/${total} 通过`);
process.exit(pass === total ? 0 : 1);
