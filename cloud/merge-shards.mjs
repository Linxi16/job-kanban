/**
 * 合并各城市分片抓取结果 + 本地历史数据，生成评分引擎需要的完整输入。
 *
 * 用法：
 *   DATA_DIR=data node cloud/merge-shards.mjs                # 合并两个平台全部分片
 *   DATA_DIR=data PLATFORM=zhilian node cloud/merge-shards.mjs
 *
 * 逻辑：
 *   - 智联：读 data/zhilian-shard*-list.json，按 number 去重 → data/zhilian-list.json
 *   - 前程：读 data/51job-shard*-list.json，按 jobId 去重 → data/51job-list.json
 *   - 若某平台完全没有分片文件，则保留仓库里已有的数据文件（本地手动运行时不会丢数据）
 *   - 合并完成后删除分片文件，避免污染仓库
 */
import fs from 'fs';
import path from 'path';

const DATA = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(process.cwd(), 'data');
const ONLY = (process.env.PLATFORM || '').trim();

const listFiles = (prefix) => {
  if (!fs.existsSync(DATA)) return [];
  return fs.readdirSync(DATA)
    .filter((f) => f.startsWith(prefix) && /-shard\d+-list\.json$/.test(f))
    .sort((a, b) => (parseInt(a.match(/-shard(\d+)-/)[1], 10) - parseInt(b.match(/-shard(\d+)-/)[1], 10)))
    .map((f) => path.join(DATA, f));
};

function merge(target, outFile, keyOf, platforms) {
  if (ONLY && ONLY !== platforms[0] && !platforms.includes(ONLY)) return null;
  const files = listFiles(target);
  if (!files.length) {
    const exists = fs.existsSync(outFile);
    console.log(`⚠️ ${target}: 没有分片文件，${exists ? '保留已有数据' : '且没有历史数据'} → ${path.basename(outFile)}`);
    return { platform: target, shards: 0, total: 0, kept: exists };
  }
  const seen = new Set();
  const all = [];
  let dupes = 0;
  for (const f of files) {
    let arr = [];
    try { arr = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) {
      throw new Error(`分片文件损坏: ${f} — ${e.message}`);
    }
    if (!Array.isArray(arr)) throw new Error(`分片文件不是数组: ${f}`);
    let added = 0;
    for (const it of arr) {
      const k = String(keyOf(it) || '');
      if (!k) continue;
      if (seen.has(k)) { dupes++; continue; }
      seen.add(k);
      all.push(it);
      added++;
    }
    console.log(`  ${path.basename(f)}: ${arr.length} 条 → 新增 ${added}｜累计 ${all.length}`);
  }
  fs.writeFileSync(outFile, JSON.stringify(all, null, 1), 'utf8');
  for (const f of files) fs.unlinkSync(f);
  console.log(`✅ ${target}: 合并 ${files.length} 个分片 → ${all.length} 条唯一岗位（跨分片重复 ${dupes} 条）→ ${path.basename(outFile)}`);
  return { platform: target, shards: files.length, total: all.length, dupes, kept: false };
}

const results = [
  merge('zhilian', path.join(DATA, 'zhilian-list.json'), (x) => x.number || x.jobId, ['zhilian']),
  merge('51job', path.join(DATA, '51job-list.json'), (x) => x.jobId, ['51job', 'qc']),
].filter(Boolean);

const bad = results.filter((r) => !r.kept && r.total === 0);
if (bad.length) {
  console.log(`\n❌ 以下平台合并后为 0 条：${bad.map((b) => b.platform).join('、')}`);
  process.exit(1);
}
console.log('\n===== 合并完成 =====');
console.log(JSON.stringify(results, null, 1));
