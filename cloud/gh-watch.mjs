/** 轮询最新一次工作流 + 检查站点可达性 */
const TOKEN = process.env.GH_TOKEN;
const OWNER = 'Linxi16', REPO = 'job-kanban', WF = 'update.yml';
const H = { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'dsh', 'X-GitHub-Api-Version': '2022-11-28' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SITE = 'https://linxi16.github.io/job-kanban/';

let run = null;
for (let i = 0; i < 10 && !run; i++) {
  await sleep(4000);
  const r = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WF}/runs?per_page=1`, { headers: H });
  run = (await r.json()).workflow_runs?.[0];
}
console.log(`监控运行 #${run.run_number} (id=${run.id})`);
const started = Date.now();
while (Date.now() - started < 40 * 60 * 1000) {
  await sleep(30000);
  const r = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/actions/runs/${run.id}`, { headers: H });
  const j = await r.json();
  const mins = ((Date.now() - started) / 60000).toFixed(1);
  console.log(`[${mins} 分] ${j.status}${j.conclusion ? ' / ' + j.conclusion : ''}`);
  if (j.status === 'completed') {
    const jobs = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/actions/runs/${run.id}/jobs`, { headers: H });
    const jj = await jobs.json();
    for (const job of jj.jobs || []) for (const s of job.steps || []) console.log(`   ${s.conclusion === 'success' ? '✅' : s.conclusion === 'skipped' ? '⏭' : '❌'} ${s.name}`);
    break;
  }
}
await sleep(15000);
try {
  const r = await fetch(SITE, { redirect: 'follow', signal: AbortSignal.timeout(30000) });
  const html = await r.text();
  console.log(`\n站点 HTTP ${r.status} | 大小 ${(html.length / 1024).toFixed(0)} KB`);
  console.log('含岗位看板标题:', html.includes('岗位看板'));
  console.log('含 75 分推荐卡:', html.includes('推荐指数'));
  console.log('含个人信息:', /吴家良|广东财经大学|云浮/.test(html));
} catch (e) {
  console.log('\n站点访问失败:', e.message);
}
console.log('站点地址:', SITE);
