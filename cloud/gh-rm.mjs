/** 从仓库删除一个文件（Git Data API 全量重建 tree，排除指定路径） */
const TOKEN = process.env.GH_TOKEN;
const OWNER = process.env.GH_OWNER || 'Linxi16';
const REPO = process.env.GH_REPO || 'job-kanban';
const BRANCH = 'main';
const DROP = process.argv[2];
const H = {
  Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'dsh-job-kanban', 'Content-Type': 'application/json',
};
async function gh(method, p, body) {
  const r = await fetch('https://api.github.com' + p, {
    method, headers: H, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(120000),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${method} ${p} → ${r.status} ${JSON.stringify(j?.message || j)}`);
  return j;
}
const ref = await gh('GET', `/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`);
const head = ref.object.sha;
const commit = await gh('GET', `/repos/${OWNER}/${REPO}/git/commits/${head}`);
const full = await gh('GET', `/repos/${OWNER}/${REPO}/git/trees/${commit.tree.sha}?recursive=1`);
const keep = (full.tree || []).filter((t) => t.type === 'blob' && t.path !== DROP);
console.log(`原文件数 ${(full.tree || []).filter((t) => t.type === 'blob').length} → 保留 ${keep.length}`);
const tree = keep.map((t) => ({ path: t.path, mode: t.mode, type: 'blob', sha: t.sha }));
const newTree = await gh('POST', `/repos/${OWNER}/${REPO}/git/trees`, { tree });
const nc = await gh('POST', `/repos/${OWNER}/${REPO}/git/commits`, {
  message: `移除 ${DROP}（含个人信息）`,
  tree: newTree.sha,
  parents: [head],
});
await gh('PATCH', `/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`, { sha: nc.sha, force: true });
console.log(`✅ 已删除 ${DROP}，新 commit ${nc.sha.slice(0, 8)}`);
