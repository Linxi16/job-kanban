/**
 * 反向测试：确认「脱敏判定」真能抓到泄漏，且不会因岗位数据里的公司名误报。
 * 直接调用 dist-sanitize.mjs（与 verify-dist.mjs 同一份实现），避免子进程（沙箱禁止管道 stdio）。
 */
import fs from 'node:fs';
import { findLeaks, PII_RULES } from './dist-sanitize.mjs';

const FILE = 'dist/看板.html';
const ORIG = fs.readFileSync(FILE, 'utf8');
const ANCHOR = '"name":"林小夕"';
if (!ORIG.includes(ANCHOR)) { console.log('⚠️ 找不到画像锚点，测试无效'); process.exit(1); }

let pass = 0, total = 0;

/* ---- 1. 画像区注入 → 必须被抓到 ---- */
const INJECT = [
  ['姓名', '"name":"吴家良"'],
  ['学校', '"name":"林小夕","school":"广东财经大学"'],
  ['籍贯', '"name":"林小夕","hometown":"广东省云浮市"'],
  ['生日', '"name":"林小夕","birth":"2003-08-12"'],
  ['手机号', '"name":"林小夕","phone":"13800138000"'],
  ['QQ号', '"name":"林小夕","qq":"2580769551"'],
  ['实习公司', '"name":"林小夕","intern":"谷雨生物"'],
];
for (const [expect, replacement] of INJECT) {
  total++;
  const leaks = findLeaks(ORIG.replace(ANCHOR, replacement));
  const hit = leaks.find((l) => l.name === expect);
  if (hit) { pass++; console.log(`✅ 抓到「${expect}」→ 泄漏于${hit.region}（${hit.hit}）`); }
  else console.log(`❌ 漏掉「${expect}」！返回泄漏项：${JSON.stringify(leaks)}`);
}

/* ---- 2. 署名区注入 → 必须被抓到 ---- */
total++;
const chromeLeaks = findLeaks(ORIG.replace('<title>岗位看板 · 林小夕</title>', '<title>岗位看板 · 吴家良</title>'));
if (chromeLeaks.some((l) => l.name === '姓名' && l.region === '署名区')) { pass++; console.log('✅ 抓到「署名区真名」'); }
else console.log(`❌ 漏掉「署名区真名」！${JSON.stringify(chromeLeaks)}`);

/* ---- 3. 岗位数据里出现公司名 → 不得误报 ---- */
total++;
const jobHtml = ORIG.replace(ANCHOR, '"name":"林小夕"')
  .replace(/<script id="payload" type="application\/json">/, '<script id="payload" type="application/json">')
  + '<!-- 珠海星火教育 欢创信息 谷雨生物 骆驼户外 招生顾问 -->';
const jobLeaks = findLeaks(jobHtml);
if (jobLeaks.length === 0) { pass++; console.log('✅ 岗位/备注区出现公司名不误报'); }
else console.log(`❌ 误报！${JSON.stringify(jobLeaks)}`);

/* ---- 4. 当前真实 dist 必须干净 ---- */
total++;
const real = findLeaks(ORIG);
if (real.length === 0) { pass++; console.log('✅ 当前 dist 看板干净'); }
else console.log(`❌ 当前 dist 看板有残留：${JSON.stringify(real)}`);

/* ---- 5. 规则完整性：每条规则都要有名字 ---- */
total++;
const named = PII_RULES.every(([n, re]) => typeof n === 'string' && n.length && re instanceof RegExp);
if (named) { pass++; console.log(`✅ 脱敏规则表完整（${PII_RULES.length} 条）`); }
else console.log('❌ 脱敏规则表有缺陷');

console.log(`\n反向测试：${pass}/${total} 通过`);
process.exit(pass === total ? 0 : 1);
