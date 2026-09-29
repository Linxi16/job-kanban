/** 按步骤名打印 GitHub Actions 日志片段 */
const TOKEN = process.env.GH_TOKEN;
const OWNER = process.env.GH_OWNER || 'Linxi16';
const REPO = process.env.GH_REPO || 'job-kanban';
const RUN_ID = process.argv[2];
const WANT = (process.argv[3] || '').split(',').filter(Boolean);
const H = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'dsh-job-kanban',
};
const jr = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/actions/runs/${RUN_ID}/jobs`, { headers: H, signal: AbortSignal.timeout(60000) });
const jj = await jr.json();
for (const job of jj.jobs || []) {
  if (job.conclusion === 'skipped') continue;
  const lr = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/actions/jobs/${job.id}/logs`, {
    headers: { ...H, Accept: 'application/vnd.github.raw' }, signal: AbortSignal.timeout(120000), redirect: 'follow',
  });
  if (!lr.ok) continue;
  const raw = await lr.text();
  const lines = raw.split('\n').map((l) => l.replace(/^\S*Z\s?/, '').trimEnd());
  const marks = [];
  for (const l of lines) {
    const g = /^##\[group\](.*)$/.exec(l);
    if (g) marks.push(g[1]);
  }
  console.log(`\n### 作业 ${job.name} 的步骤组：`);
  for (const m of marks) console.log('   - ' + m);
  let printing = false;
  for (const l of lines) {
    const g = /^##\[group\](.*)$/.exec(l);
    if (g) { printing = WANT.length === 0 || WANT.some((w) => g[1].includes(w)); if (printing) console.log(`\n───── ${g[1]} ─────`); continue; }
    if (/^##\[endgroup\]/.test(l)) { printing = false; continue; }
    if (printing && l.trim() && !/^##\[/.test(l)) console.log(l);
  }
}
