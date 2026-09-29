/**
 * 推送范围清单（单一事实来源，纯数据、无副作用、不联网）
 *
 * 为什么必须集中定义：verify-workflow.mjs 要断言"工作流里每个 node 脚本都在清单内"。
 * 早先 verify-workflow 用正则去复制解析那份清单，结果被一行注释文本
 * （// 'test-exp-parse.mjs',）骗过——守卫显示全绿，实际云端会 file-not-found。
 * 现在清单只在这里写一次，校验脚本直接 import，不可能再解析错。
 *
 * ── 为什么分成 CODE 与 DATA ──────────────────────────────────────────
 * 代码的作者是「人」，数据的作者是「云端」。两者混在一个清单里出过事：
 * 本地推送会顺手把 13 个数据/看板产物（本地旧副本）盖到云端刚抓的新数据上，
 * 而且不报任何错 —— 页面照常打开，只是岗位列表悄悄退回旧的一批。
 * 因此分开：
 *   CODE = 人写的代码/配置/模板/文档 → 本地推送默认推这些
 *   DATA = 云端运行的产物（data/*、岗位看板/*、dist/*）→ 本地默认不推
 * 云端工作流自己产数据并提交，不经过这份清单；要本地推数据须显式 --with-data。
 * ──────────────────────────────────────────────────────────────────
 *
 * 只列文件、不列目录。清单外的远端文件不会被 gh-upload.mjs 删除（需显式 gh-rm.mjs）。
 */
export const CODE = [
  // 仓库元信息
  '.gitignore',
  '.github/workflows/update.yml',
  'README.md',
  'tools/README.md',   // 已删除脚本的留痕（避免以后翻 Git 历史猜用途）

  // 引擎与构建
  'score-engine.mjs',
  'build-dashboard.mjs',
  'export-report.mjs',

  // 本地画像（读简历 PDF）——仅在本地跑，但需随仓库留存
  'extract-resume.mjs',
  'profile-data.mjs',
  'dist-sanitize.mjs',
  'cleanup-scratch.mjs',

  // 回归与校验（工作流会依赖，缺一个就会在云端 file-not-found）
  'test-all.mjs',
  'test-exp-parse.mjs',
  'test-hard-filter.mjs',
  'test-fresh-bug.mjs',
  'test-verify-dist.mjs',   // 脱敏的反向测试：注入 PII 必须被抓到（曾长期未纳入回归，白放着）
  'verify-dashboard.mjs',
  'verify-dist.mjs',
  'verify-workflow.mjs',
  'verify-parity.mjs',
  'audit-live.mjs',
  'audit-negatives.mjs',
  'audit-cities.mjs',

  // 看板模板：build-dashboard.mjs 运行时读取
  'templates/dashboard.html',
  'templates/dashboard.js',

  // 云端抓取与 GitHub API 工具
  'cloud/fetch-all.mjs',
  'cloud/merge-shards.mjs',
  'cloud/gh-push-list.mjs',
  'cloud/gh-manifest.mjs',
  'cloud/gh-upload.mjs',
  'cloud/gh-pull.mjs',
  'cloud/gh-check.mjs',
  'cloud/gh-run.mjs',
  'cloud/gh-log.mjs',
  'cloud/gh-step.mjs',
  'cloud/gh-raw.mjs',
  'cloud/gh-lines.mjs',
  'cloud/gh-rm.mjs',
  'cloud/gh-watch.mjs',
];

/**
 * 云端运行产物：本地推送默认不推（见文件头说明）。
 * 这些文件的正确来源是 GitHub Actions —— 每次运行重新抓取、重新评分、重新构建。
 */
export const DATA = [
  // 数据（线上看板直接读这些）
  'data/zhilian-list.json',
  'data/51job-list.json',
  'data/scored-zhilian.json',
  'data/scored-51job.json',
  'data/dashboard-data.json',

  // 看板产物
  '岗位看板/看板.html',
  '岗位看板/看板数据.json',
  '岗位看板/智联招聘-推荐岗位.csv',
  '岗位看板/前程无忧-推荐岗位.csv',
  '岗位看板/筛选汇总报告.md',

  // 发布版（GitHub Pages 实际服务的目录）
  'dist/index.html',
  'dist/看板.html',
  'dist/看板数据.json',
];

/** 完整清单 = CODE + DATA（校验脚本用；推送用哪个由 gh-manifest.mjs 决定） */
export const PUSH = [...CODE, ...DATA];

// 自检：防止以后往两个清单里各加一次、或漏加导致 PUSH 与实际推送范围脱节
{
  const dup = CODE.filter((f) => DATA.includes(f));
  if (dup.length) throw new Error(`CODE 与 DATA 不应重叠：${dup.join(', ')}`);
  if (new Set(CODE).size !== CODE.length) throw new Error('CODE 内有重复条目');
  if (new Set(DATA).size !== DATA.length) throw new Error('DATA 内有重复条目');
  if (PUSH.length !== CODE.length + DATA.length) throw new Error('PUSH 应等于 CODE + DATA');
}
