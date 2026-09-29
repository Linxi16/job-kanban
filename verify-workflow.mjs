/**
 * 工作流结构校验：确保 .github/workflows/update.yml 的分片配置正确。
 * 语法/结构错误在 GitHub 上要跑几十秒才暴露，这里本地秒级拦下。
 *
 * 用法: node verify-workflow.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const DSH_NM = 'C:/Users/Lin xi/AppData/Roaming/npm/node_modules/@deepseek-ai/dsh/node_modules/';
let YAML = null;
for (const cand of [DSH_NM + 'yaml', DSH_NM + 'js-yaml', 'yaml', 'js-yaml']) {
  try { const m = createRequire(import.meta.url)(cand); YAML = m.default || m; break; } catch { }
}
if (!YAML) { console.error('❌ 找不到 YAML 解析器'); process.exit(2); }

const FILE = '.github/workflows/update.yml';
let wf;
try {
  wf = YAML.parse(fs.readFileSync(FILE, 'utf8'));
} catch (e) {
  console.error(`❌ YAML 语法错误：${e.message}`);
  process.exit(1);
}

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log('   ❌ ' + m); } };

const jobs = wf.jobs || {};
ok(JSON.stringify(Object.keys(jobs).sort()) === JSON.stringify(['qc', 'refresh', 'zhilian']),
  `任务集合应为 zhilian/qc/refresh，实际 ${Object.keys(jobs)}`);

const ALL_CITIES = ['广州', '佛山', '深圳', '东莞', '中山', '珠海'];
for (const name of ['zhilian', 'qc']) {
  const j = jobs[name] || {};
  const inc = (j.strategy && j.strategy.matrix && j.strategy.matrix.include) || [];
  ok(inc.length === 3, `${name}: 分片数应为 3，实际 ${inc.length}`);
  const cities = inc.flatMap((e) => String(e.cities || '').split(',').filter(Boolean));
  ok(JSON.stringify([...cities].sort()) === JSON.stringify([...ALL_CITIES].sort()),
    `${name}: 城市应覆盖 6 城，实际 ${cities}`);
  ok(inc.every((e) => e.shard != null && e.cities), `${name}: 每个 include 项都要有 shard 与 cities`);
  ok(j['timeout-minutes'] === 40, `${name}: timeout 应为 40，实际 ${j['timeout-minutes']}`);
  const scrape = (j.steps || []).filter((s) => String(s.run || '').includes('cloud/fetch-all.mjs'));
  ok(scrape.length === 1, `${name}: 应有 1 个调用 cloud/fetch-all.mjs 的抓取步骤，实际 ${scrape.length}`);
  if (scrape.length) {
    const e = scrape[0].env || {};
    ok('SHARD' in e, `${name}: 抓取步骤要传 SHARD`);
    ok(!('GAP_MS' in e), `${name}: 不应在分片里覆盖 GAP_MS（应走全局）`);
    ok(!('ZL_PAGES' in e || 'QC_PAGES' in e), `${name}: 页数应走全局 env`);
    ok(String(scrape[0].run || '').includes('cloud/fetch-all.mjs'), `${name}: 抓取命令应为 cloud/fetch-all.mjs`);
  }
  const up = (j.steps || []).filter((s) => String(s.uses || '').startsWith('actions/upload-artifact'));
  ok(up.length === 1, `${name}: 应有 1 个上传步骤`);
  if (up.length) {
    const w = up[0].with || {};
    ok(String(w.name || '').includes('matrix.shard'), `${name}: artifact 名要含 matrix.shard`);
    ok(w['if-no-files-found'] === 'error', `${name}: if-no-files-found 应为 error`);
    ok(String(w.path || '').includes('matrix.shard'), `${name}: 上传路径要含分片号`);
  }
}

const r = jobs.refresh || {};
ok(JSON.stringify(r.needs) === JSON.stringify(['zhilian', 'qc']), `refresh 应依赖 zhilian+qc，实际 ${JSON.stringify(r.needs)}`);
ok(r.environment && r.environment.name === 'github-pages', 'refresh 需要 github-pages 环境');
const dl = (r.steps || []).filter((s) => String(s.uses || '').startsWith('actions/download-artifact'));
ok(dl.length === 1, 'refresh 应有 1 个下载步骤');
if (dl.length) {
  const w = dl[0].with || {};
  const pat = String(w.pattern || '');
  const names = ['zhilian', 'qc'].flatMap((p) => [1, 2, 3].map((i) => `${p}-shard${i}`));
  const re = new RegExp('^' + pat.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
  const miss = names.filter((n) => !re.test(n));
  ok(miss.length === 0, `下载 pattern「${pat}」应命中全部 6 个分片，漏掉 ${miss}`);
  ok(w['merge-multiple'] === true, 'merge-multiple 应为 true');
  ok(w.path === 'data', `下载目录应为 data，实际 ${w.path}`);
}
const stepNames = (r.steps || []).map((s) => s.name || '');
// 回归用例步骤名在这里定义一次，避免和 update.yml 各写一遍导致改一处漏一处
const CASE_STEPS = ['回归用例（应届生判定）', '回归用例（硬过滤：实习 / 方向 / 地域 / 薪资 / 年薪·日薪·时薪换算）'];
// 纯函数单测步骤：直接 node 跑，不需要 --make/--check 两阶段
const UNIT_STEPS = ['回归用例（经验年限解析）'];
// 数据审计：读 scored-*.json 做断言（必须非零退出才有意义）
const AUDIT_STEPS = ['数据审计（地域 / 过滤项）'];
for (const want of ['合并分片', '评分与判定', '构建看板（本地完整版）', '校验看板（本地完整版）',
                    '校验口径一致性（看板 vs 引擎的模块判定）',
                    ...CASE_STEPS, ...UNIT_STEPS, ...AUDIT_STEPS,
                    '构建看板（云端发布版·脱敏）', '校验发布版（结构 + 脱敏）', '归档快照（只保留最近 3 份）',
                    '提交结果到仓库', '发布到 GitHub Pages']) {
  ok(stepNames.includes(want), `refresh 缺少步骤「${want}」`);
}
// 回归用例必须在"构建看板"之前：判定逻辑改坏了要在发布前失败，而不是发出去
const idxCase = stepNames.indexOf(CASE_STEPS[0]);
const idxBuild = stepNames.indexOf('构建看板（本地完整版）');
ok(idxCase > -1 && idxBuild > -1 && idxCase < idxBuild, '回归用例应排在构建看板之前');
// verify-parity 依赖看板 HTML，必须在「构建看板（本地完整版）」之后
{
  const p = stepNames.indexOf('校验口径一致性（看板 vs 引擎的模块判定）');
  ok(p > -1 && p > idxBuild, '校验口径一致性应排在构建看板之后（它要读看板 HTML）');
}
for (const nm of CASE_STEPS) {
  const s = (r.steps || []).find((x) => x.name === nm);
  ok(s && /--make/.test(s.run) && /--check/.test(s.run), `${nm}: 要跑 --make 与 --check`);
}
for (const nm of UNIT_STEPS) {
  const s = (r.steps || []).find((x) => x.name === nm);
  ok(s && /node\s+test-[\w-]+\.mjs/.test(s.run), `${nm}: 应直接跑 node test-*.mjs`);
  ok(s && stepNames.indexOf(nm) < idxBuild, `${nm}: 应排在构建看板之前`);
}
for (const nm of AUDIT_STEPS) {
  const s = (r.steps || []).find((x) => x.name === nm);
  ok(s && /node\s+audit-[\w-]+\.mjs/.test(s.run), `${nm}: 应直接跑 node audit-*.mjs`);
  ok(s && stepNames.indexOf(nm) < idxBuild, `${nm}: 应排在构建看板之前`);
  // 两个审计脚本都必须被跑到，且都要能被推送（否则云端缺文件）
  const called = [...String(s?.run || '').matchAll(/node\s+(audit-[\w-]+\.mjs)/g)].map((m) => m[1]);
  ok(called.length === 2, `${nm}: 应同时跑 audit-cities 与 audit-negatives，实际 ${called}`);
}
const mergeStep = (r.steps || []).find((s) => s.name === '合并分片');
ok(mergeStep && String(mergeStep.run).includes('cloud/merge-shards.mjs'), '合并分片应调用 cloud/merge-shards.mjs');

const env = wf.env || {};
ok(env.GAP_MS === '3800', `GAP_MS 应为 3800，实际 ${env.GAP_MS}`);
ok(env.ZL_PAGES === '2', `ZL_PAGES 应为 2，实际 ${env.ZL_PAGES}`);
ok(env.QC_PAGES === '3', `QC_PAGES 应为 3，实际 ${env.QC_PAGES}`);
ok(String(env.ZL_KWS || '').split(',').length === 8, `ZL_KWS 应为 8 个，实际 ${String(env.ZL_KWS || '').split(',').length}`);
ok(String(env.QC_KWS || '').split(',').length === 8, `QC_KWS 应为 8 个，实际 ${String(env.QC_KWS || '').split(',').length}`);
ok(!('ZL_CITIES' in env) && !('QC_CITIES' in env), '城市不应放在全局 env（已移交 matrix）');

const trig = wf.on === undefined ? wf[true] : wf.on;
const trigKeys = Object.keys(trig || {});
ok(trigKeys.length === 1 && trigKeys[0] === 'workflow_dispatch', `只应有 workflow_dispatch 触发，实际 ${trigKeys}`);
ok(wf.permissions && wf.permissions.contents === 'write' && wf.permissions.pages === 'write', 'permissions 需含 contents/pages: write');
ok(wf.concurrency && wf.concurrency.group === 'job-refresh', 'concurrency.group 应为 job-refresh');

// ---------- 云端可用性守卫 ----------
// 工作流里出现的每个 node 脚本都必须「本地存在」且「在推送清单里」。
// 否则云端 checkout 后跑不到该文件 → 整条流水线在最后一步前才失败（曾漏掉 test-exp-parse.mjs）。
const runText = (r.steps || []).map((s) => String(s.run || '')).join('\n')
  + '\n' + ['zhilian', 'qc'].flatMap((n) => (jobs[n]?.steps || []).map((s) => String(s.run || ''))).join('\n');
const usedScripts = [...new Set([...runText.matchAll(/node\s+([\w./-]+\.mjs)/g)].map((m) => m[1]))].sort();
ok(usedScripts.length >= 6, `应能解析出工作流调用的脚本，实际 ${usedScripts.length} 个`);
const missingLocal = usedScripts.filter((p) => !fs.existsSync(p));
ok(missingLocal.length === 0, `工作流调用的脚本本地不存在：${missingLocal}`);

let manifest = [];
try {
  // 直接 import 单一事实来源，绝不再用正则复制解析清单。
  // （曾用正则解析 .tmp-manifest.mjs，被一行注释文本 // 'test-exp-parse.mjs', 骗过，
  //   守卫显示全绿而云端实际 file-not-found —— 这正是本守卫要防的那类失败。）
  ({ PUSH: manifest } = await import('./cloud/gh-push-list.mjs'));
} catch (e) {
  ok(false, `无法 import cloud/gh-push-list.mjs：${e.message}`);
}
ok(Array.isArray(manifest) && manifest.length > 0, '应能从 cloud/gh-push-list.mjs 取到推送清单');
const notPushed = usedScripts.filter((p) => !manifest.includes(p));
ok(notPushed.length === 0, `工作流调用但不在推送清单里的脚本（云端会 file-not-found）：${notPushed}`);
// 清单里的条目必须本地都在（否则 gh-upload 会因缺文件失败）
const manifestMissing = manifest.filter((p) => !fs.existsSync(p));
ok(manifestMissing.length === 0, `推送清单里本地缺失的文件：${manifestMissing}`);
// 垃圾文件不得进清单（云端 git add -A 会连带提交）
const junk = manifest.filter((p) => /^\.tmp-|^probe-|spider\.mjs$|\.bak$|^归档\//.test(p));
ok(junk.length === 0, `推送清单里不应含临时/垃圾文件：${junk}`);
// 清单里不得出现已被删除的废弃文件（本地已清场，别再推回去）
const gone = ['check-jd-coverage.mjs', 'zhilian-spider.mjs', '51job-spider.mjs', 'data/zhilian-detail.json'];
const resurrected = gone.filter((p) => manifest.includes(p));
ok(resurrected.length === 0, `清单里不应包含已废弃文件：${resurrected}`);
// .gitignore 必须存在且覆盖测试夹具目录（否则云端每次都会重推 .tmp-*）
ok(fs.existsSync('.gitignore'), '.gitignore 必须存在（云端 git add -A 依赖它排除临时产物）');
if (fs.existsSync('.gitignore')) {
  const gi = fs.readFileSync('.gitignore', 'utf8');
  ok(/^\.tmp-\*\/?$/m.test(gi), '.gitignore 需忽略 .tmp-*（回归夹具目录）');
  ok(/^归档\/$/m.test(gi), '.gitignore 需忽略 归档/');
  ok(/zhilian-detail\.json/m.test(gi), '.gitignore 需忽略已废弃的 data/zhilian-detail.json');
}

// 归档保留份数：用户口径是「只保留最近 3 份」。
// tail -n +4 保留前 3 行（= 最新 3 份），-n +11 才是 10 份 —— 改错就是悄悄多留一堆快照。
const arch = (r.steps || []).find((s) => /^归档快照/.test(s.name || ''));
ok(!!arch, '应有归档快照步骤');
if (arch) {
  // 只统计真正的管道命令（tail ... | xargs ... rm），避免把解释性注释里的 tail -n +4 也算进来
  const n = [...String(arch.run).matchAll(/tail\s+-n\s+\+(\d+)\s*\|\s*xargs/g)].map((m) => Number(m[1]));
  ok(n.length === 2, `归档步骤应对 html 与 json 各做一次裁剪，实际 ${n.length} 次`);
  ok(n.every((x) => x === 4), `归档应保留最近 3 份（tail -n +4），实际 ${n.map((x) => `+${x}（保留 ${x - 1} 份）`)}`);
  ok(/最近\s*3\s*份/.test(arch.name), `归档步骤名应与实际保留份数一致，实际「${arch.name}」`);
}

console.log(`\n工作流校验：✅ ${pass} 项通过${fail ? `，❌ ${fail} 项失败` : ''}`);
process.exit(fail ? 1 : 0);
