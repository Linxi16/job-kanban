/**
 * 启用 GitHub Pages + 触发抓取工作流 + 轮询结果
 * 用法：GH_TOKEN=xxx node cloud/gh-run.mjs [--no-trigger]
 */
const TOKEN = process.env.GH_TOKEN;
const OWNER = process.env.GH_OWNER || 'Linxi16';
const REPO = process.env.GH_REPO || 'job-kanban';
const WF = 'update.yml';
const BASE = `https://api.github.com/repos/${OWNER}/${REPO}`;
const H = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'dsh-job-kanban',
  'Content-Type': 'application/json',
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function gh(method, p, body) {
  const r = await fetch(BASE + p, { method, headers: H, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(60000) });
  const txt = await r.text();
  let j = null; try { j = JSON.parse(txt); } catch {}
  return { status: r.status, ok: r.ok, j, txt: txt.slice(0, 300) };
}

// ---------- 1. 启用 Pages（GitHub Actions 构建类型）----------
let pg = await gh('GET', '/pages');
if (pg.status === 404) {
  const c = await gh('POST', '/pages', { build_type: 'workflow' });
  console.log('创建 Pages:', c.status, c.ok ? '✅' : '⚠️ ' + c.txt);
  pg = await gh('GET', '/pages');
}
if (pg.j) console.log('Pages 状态:', pg.j.html_url || '(未生成)', '| build_type:', pg.j.build_type, '| status:', pg.j.status);

// ---------- 2. 触发工作流 ----------
if (!process.argv.includes('--no-trigger')) {
  const t = await gh('POST', `/actions/workflows/${WF}/dispatches`, { ref: 'main' });
  console.log('触发工作流:', t.status, t.status === 204 ? '✅ 已触发' : '⚠️ ' + t.txt);
}

// ---------- 3. 轮询 ----------
let run = null;
for (let i = 0; i < 20 && !run; i++) {
  await sleep(5000);
  const r = await gh('GET', `/actions/workflows/${WF}/runs?per_page=1`);
  run = r.j?.workflow_runs?.[0];
  if (run) break;
  console.log('  等待工作流注册…', i + 1);
}
if (!run) { console.log('❌ 未找到运行记录'); process.exit(1); }
console.log(`运行 #${run.run_number} id=${run.id} 状态=${run.status}`);
console.log('日志地址:', run.html_url);

const started = Date.now();
while (Date.now() - started < 50 * 60 * 1000) {
  await sleep(30000);
  const r = await gh('GET', `/actions/runs/${run.id}`);
  const j = r.j;
  const mins = ((Date.now() - started) / 60000).toFixed(1);
  console.log(`[${mins} 分] 状态=${j.status}${j.conclusion ? ' 结论=' + j.conclusion : ''}`);
  if (j.status === 'completed') {
    console.log('\n最终结论:', j.conclusion);
    if (j.conclusion !== 'success') {
      const jobs = await gh('GET', `/actions/runs/${run.id}/jobs`);
      for (const job of jobs.j?.jobs || []) {
        console.log(`  作业 ${job.name}: ${job.conclusion}`);
        for (const s of job.steps || []) console.log(`    - ${s.name}: ${s.conclusion}`);
      }
    }
    const p = await gh('GET', '/pages');
    console.log('站点地址:', p.j?.html_url);
    break;
  }
}
