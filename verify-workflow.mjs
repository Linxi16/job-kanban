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
for (const want of ['合并分片', '评分与判定', '构建看板（本地完整版）', '校验看板（本地完整版）',
                    '回归用例（应届生判定）', '回归用例（硬过滤：实习 / 方向 / 地域 / 薪资）',
                    '构建看板（云端发布版·脱敏）', '校验发布版（结构 + 脱敏）', '归档快照（只保留最近 10 份）',
                    '提交结果到仓库', '发布到 GitHub Pages']) {
  ok(stepNames.includes(want), `refresh 缺少步骤「${want}」`);
}
// 回归用例必须在"构建看板"之前：判定逻辑改坏了要在发布前失败，而不是发出去
const idxCase = stepNames.indexOf('回归用例（应届生判定）');
const idxBuild = stepNames.indexOf('构建看板（本地完整版）');
ok(idxCase > -1 && idxBuild > -1 && idxCase < idxBuild, '回归用例应排在构建看板之前');
for (const nm of ['回归用例（应届生判定）', '回归用例（硬过滤：实习 / 方向 / 地域 / 薪资）']) {
  const s = (r.steps || []).find((x) => x.name === nm);
  ok(s && /--make/.test(s.run) && /--check/.test(s.run), `${nm}: 要跑 --make 与 --check`);
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

console.log(`\n工作流校验：✅ ${pass} 项通过${fail ? `，❌ ${fail} 项失败` : ''}`);
process.exit(fail ? 1 : 0);
