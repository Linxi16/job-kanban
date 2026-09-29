/** 打印 GitHub Actions 日志指定行区间 */
const TOKEN = process.env.GH_TOKEN;
const OWNER = process.env.GH_OWNER || 'Linxi16';
const REPO = process.env.GH_REPO || 'job-kanban';
const RUN_ID = process.argv[2];
const FROM = Number(process.argv[3] || 0), TO = Number(process.argv[4] || 60);
const H = {
  Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'dsh-job-kanban',
};
const jr = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/actions/runs/${RUN_ID}/jobs`, { headers: H, signal: AbortSignal.timeout(60000) });
const jj = await jr.json();
for (const job of jj.jobs || []) {
  if (job.conclusion === 'skipped') continue;
  const lr = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/actions/jobs/${job.id}/logs`, {
    headers: { ...H, Accept: 'application/vnd.github.raw' }, signal: AbortSignal.timeout(120000), redirect: 'follow',
  });
  if (!lr.ok) continue;
  const lines = (await lr.text()).split('\n');
  for (let i = FROM; i <= Math.min(TO, lines.length - 1); i++) {
    console.log(`[${i}] ${lines[i].replace(/^\S*Z\s?/, '')}`);
  }
}
