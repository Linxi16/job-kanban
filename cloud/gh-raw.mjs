/** 打印 GitHub Actions 原始日志行（调试用）：grep 关键词 + 行号 */
const TOKEN = process.env.GH_TOKEN;
const OWNER = process.env.GH_OWNER || 'Linxi16';
const REPO = process.env.GH_REPO || 'job-kanban';
const RUN_ID = process.argv[2];
const KW = process.argv[3] || '';
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
  if (!lr.ok) { console.log('日志 HTTP', lr.status); continue; }
  const raw = await lr.text();
  const lines = raw.split('\n');
  console.log(`总行数: ${lines.length}`);
  const idx = [];
  lines.forEach((l, i) => { if (KW && l.includes(KW)) idx.push(i); });
  console.log(`包含「${KW}」的行: ${idx.length} 处`);
  for (const i of idx.slice(0, 40)) console.log(`\n[${i}] ${lines[i].slice(0, 400)}`);
}
