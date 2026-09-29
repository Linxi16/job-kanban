/**
 * 从私有仓库拉取构建产物到本地（验证云端数据质量）
 * 用法：GH_TOKEN=xxx node cloud/gh-pull.mjs <仓库内路径> <本地路径>
 */
import fs from 'node:fs';
import path from 'node:path';

const TOKEN = process.env.GH_TOKEN;
const OWNER = process.env.GH_OWNER || 'Linxi16';
const REPO = process.env.GH_REPO || 'job-kanban';
const [repoPath, localPath] = process.argv.slice(2);
if (!repoPath || !localPath) { console.log('用法: node cloud/gh-pull.mjs <仓库路径> <本地路径>'); process.exit(1); }

const H = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: 'application/vnd.github.raw',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'dsh-job-kanban',
};
const enc = repoPath.split('/').map(encodeURIComponent).join('/');
const r = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${enc}`, { headers: H, signal: AbortSignal.timeout(120000) });
if (!r.ok) { console.log(`❌ HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`); process.exit(1); }
const buf = Buffer.from(await r.arrayBuffer());
fs.mkdirSync(path.dirname(localPath), { recursive: true });
fs.writeFileSync(localPath, buf);
console.log(`✅ ${repoPath} → ${localPath} (${(buf.length / 1024).toFixed(0)} KB)`);
