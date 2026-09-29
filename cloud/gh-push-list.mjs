/**
 * 推送范围清单（单一事实来源，纯数据、无副作用、不联网）
 *
 * 为什么必须集中定义：verify-workflow.mjs 要断言"工作流里每个 node 脚本都在清单内"。
 * 早先 verify-workflow 用正则去复制解析那份清单，结果被一行注释文本
 * （// 'test-exp-parse.mjs',）骗过——守卫显示全绿，实际云端会 file-not-found。
 * 现在清单只在这里写一次，校验脚本直接 import，不可能再解析错。
 *
 * 只列文件、不列目录。清单外的远端文件不会被 gh-upload.mjs 删除（需显式 gh-rm.mjs）。
 */
export const PUSH = [
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
  'test-verify-dist.mjs',
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
