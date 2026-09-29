/** 校验 GitHub 令牌 + 读取用户信息 */
const TOKEN = process.env.GH_TOKEN;
const H = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'dsh-job-kanban',
};

async function gh(p) {
  const r = await fetch('https://api.github.com' + p, { headers: H, signal: AbortSignal.timeout(30000) });
  return { status: r.status, scopes: r.headers.get('x-oauth-scopes'), body: await r.json().catch(() => null) };
}

const u = await gh('/user');
console.log('用户接口:', u.status);
if (u.body?.login) {
  console.log('  登录名:', u.body.login);
  console.log('  昵称:', u.body.name);
  console.log('  ID:', u.body.id);
  console.log('  令牌权限范围:', u.scopes);
  console.log('  套餐:', u.body.plan?.name);
} else {
  console.log('  ❌ 失败:', JSON.stringify(u.body));
  process.exit(1);
}

const repos = await gh('/user/repos?per_page=100&sort=updated');
console.log('现有仓库数:', Array.isArray(repos.body) ? repos.body.length : '(读取失败)');
if (Array.isArray(repos.body)) {
  for (const r of repos.body.slice(0, 10)) console.log(`  - ${r.full_name} (${r.private ? '私有' : '公开'})`);
}
