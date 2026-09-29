/**
 * 提取 GitHub Actions 某个 run 的关键日志行
 * 用法：GH_TOKEN=xxx node cloud/gh-log.mjs <run_id>
 */
const TOKEN = process.env.GH_TOKEN;
const OWNER = process.env.GH_OWNER || 'Linxi16';
const REPO = process.env.GH_REPO || 'job-kanban';
const RUN_ID = process.argv[2];
const H = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'dsh-job-kanban',
};

const jr = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/actions/runs/${RUN_ID}/jobs`, { headers: H, signal: AbortSignal.timeout(60000) });
const jj = await jr.json();
const jobs = (jj.jobs || []).filter((x) => x.conclusion !== 'skipped');
console.log('作业:', jobs.map((x) => `${x.name}=${x.conclusion}`).join(', '));

for (const job of jobs) {
  const lr = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/actions/jobs/${job.id}/logs`, {
    headers: { ...H, Accept: 'application/vnd.github.raw' },
    signal: AbortSignal.timeout(120000),
    redirect: 'follow',
  });
  if (!lr.ok) { console.log(`  (日志 HTTP ${lr.status})`); continue; }
  const text = await lr.text();
  const keep = /(抓取|智联|前程|新增|去重|评分|判定|推荐|不推荐|条|构建|校验|通过|失败|合计|写入|归档|提交|✅|❌|⚠️)/;
  const lines = text.split('\n').filter((l) => keep.test(l) && !/^\d{4}-\d\d-\d\dT.*##\[group\]/.test(l));
  console.log(`\n===== ${job.name} 关键日志 =====`);
  for (const l of lines.slice(-70)) console.log(l.replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z\s?/, '').trimEnd());
}
