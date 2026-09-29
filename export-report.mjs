/**
 * 导出：推荐岗位 CSV + Markdown 汇总报告
 * 读取 data/scored-*.json
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, 'data');
const OUT = path.join(__dirname, '岗位看板');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const PLAT = [
  ['zhilian', '智联招聘'],
  ['51job', '前程无忧'],
];

function csvCell(v) {
  const s = String(v == null ? '' : v).replace(/"/g, '""').replace(/\r?\n/g, ' ');
  return `"${s}"`;
}

const allRec = [];
const lines = [];

for (const [key, label] of PLAT) {
  const p = path.join(DATA, `scored-${key}.json`);
  if (!fs.existsSync(p)) continue;
  const jobs = JSON.parse(fs.readFileSync(p, 'utf8'));
  const rec = jobs.filter((x) => x.verdict !== '不推荐');
  allRec.push([label, rec]);

  // 每平台 CSV
  const head = ['排名', '综合评分', '判定', '岗位', '公司', '薪资', '城市', '区域', '经验要求', '学历', '公司规模', '行业',
    '休息制度', '工作时间', '弹性打卡', '发布时间', '匹配方向', '加分项', '减分项', '过滤项', '福利', '含模块', '投递链接', '数据来源', '信息来源'];
  const rows = rec.slice(0, 200).map((x, i) => [
    i + 1, x.score, x.verdict, x.title, x.company, x.salaryText, x.city, x.district || '',
    x.workYear || '', x.degree || '', x.companySize || '', x.industry || '',
    x.schedule?.rest || '未提及', x.schedule?.hours || '未提及', x.schedule?.flexible === '是' ? '是' : '未提及',
    x.publishTime || '未获取', x.roleKey || '',
    (x.bonuses || []).map((b) => `${b.k}(+${b.v})`).join('；'),
    (x.penalties || []).map((b) => `${b.k}(${b.v})`).join('；'),
    (x.negatives || []).join('；'),
    (x.welfare || []).join('、'), (x.modules || []).join('、'),
    x.url || '', label, '岗位描述（JD）正文 + 岗位发布信息与标题（相互补充，冲突时以 JD 正文为准）',
  ]);
  const csv = '\uFEFF' + [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
  const f = path.join(OUT, `${label}-推荐岗位.csv`);
  fs.writeFileSync(f, csv, 'utf8');
  console.log(`✅ ${f}（${rec.length} 条）`);
}

// ---- Markdown 汇总 ----
const SANITIZE = process.env.SANITIZE === '1';   // 云端发布版本：不输出可定位到本人的信息
const now = new Date();
lines.push('# 求职岗位筛选汇总 · ' + (SANITIZE ? '林小夕' : '吴家良'));
lines.push('');
lines.push(`> 生成时间：${now.toLocaleString('zh-CN')}　|　数据平台：智联招聘 · 前程无忧`);
lines.push('');
lines.push('## 一、你的求职画像（用于匹配）');
lines.push('');
lines.push('| 项目 | 内容 |');
lines.push('|---|---|');
if (SANITIZE) {
  lines.push('| 姓名 / 届别 | 林小夕 · **2026届** |');
  lines.push('| 学历 | 本科 · 人力资源管理专业 |');
  lines.push('| 实习经历 | 4段HR：HRBP实习生 · HR实习生 · 招聘助理 · 助教 |');
} else {
  lines.push('| 姓名 / 届别 | 吴家良 · **2026届**（2022.09–2026.07） |');
  lines.push('| 学校专业 | 广东财经大学 · 人力资源管理（人才开发与管理方向）· 统招全日制本科 |');
  lines.push('| 现居 / 籍贯 | 广州市海珠区 / 广东省云浮市 |');
  lines.push('| 实习经历 | 4段HR：HRBP实习生（谷雨生物）· HR实习生（骆驼户外）· 招聘助理（欢创信息）· 助教（星火教育） |');
}
lines.push('| 核心能力 | 招聘全流程、人才画像、招聘SOP、员工关系、BP业务对接、多维表格看板、飞书/办公软件 |');
lines.push('| 求职意向 | HRBP / 人力专员 / HR专员 / 招聘运营 / 行政专员 / 部门助理 / HR管培生 |');
lines.push('| 期望薪资 | 6k+（7k+ 更优） |');
lines.push('| 期望地点 | 广东省（广州/佛山优先） |');
lines.push('');
lines.push('## 二、筛选规则与结果');
lines.push('');
lines.push('**信息来源**：**岗位描述（JD）正文 + 岗位发布信息与标题**，两者相互补充——**有冲突时以岗位描述（JD）正文为准**；JD 未提及的项目在新版规则中统一标注为「未提及」，不做推测。看板中作息制度（双休/大小周/单休/排班轮休）、工作时间、弹性打卡均按此口径填写。');
lines.push('');
lines.push('**评分标准（v2）**：基准分 50，加分上限 70（总分上限 100）。有档次的标准按 0～10 计分，无档次的标准按 0 或 5 计分。');
lines.push('');
lines.push('**【加分项】**');
lines.push('');
lines.push('| 标准 | 分制 |');
lines.push('|---|---|');
lines.push('| 品牌企业/知名企业 | 0 或 8 |');
lines.push('| 游戏行业/日化行业 | 0～10（游戏、日化、美妆个护 10；快消/食品饮料 5） |');
lines.push('| 公司规模 | 0～10（10000人以上 10；1000–9999人 8；500–999人 5；100–499人 2；20–99人 0） |');
lines.push('| 双休制 | 0～10（双休 10；大小周 2；排班轮休/单休 0；**未提及不加分**） |');
lines.push('| 弹性打卡 | 0 或 10（**未提及不加分**） |');
lines.push('| 餐补/交补/包吃/包住/下午茶 | 0～10（每命中 1 项 +4，封顶 10） |');
lines.push('| 薪资 7k＋ | 0 或 5 |');
lines.push('| 工作地点在广州/佛山 | 0 或 5（其它城市不加分） |');
lines.push('| 工作内容为多个模块 | 0～5（≥3 个模块 5；2 个模块 3） |');
lines.push('| 岗位是 HRBP / HR管培生 | 0 或 5 |');
lines.push('| 接受应届生 | 0 或 5 |');
lines.push('| 岗位一周内新发布 | 0 或 5（两周内 2） |');
lines.push('');
lines.push('**【减分项】（推荐指数降低）**');
lines.push('');
lines.push('| 标准 | 分制 |');
lines.push('|---|---|');
lines.push('| 岗位工作 80% 以上是招聘 | 0 或 -15 |');
lines.push('| 大小周/单休/排班轮休 | 0～-10（大小周 -3；排班轮休 -6；单休 -8） |');
lines.push('| 公司规模 20～99 人 | 0 或 -12 |');
lines.push('| 乙方公司 | 0 或 -12 |');
lines.push('| 第三方派遣 | 0 或 -12 |');
lines.push('| 经验要求＞1 年 | 0 或 -10 |');
lines.push('');
lines.push('**过滤项（判定"不推荐"）**：**非广东省内**、单休、20–99人、乙方/第三方派遣、经验要求>1年，另加：销售引流岗（保险公司以"行政/人事"名义招销售）、岗位方向不符、招聘工厂/BPO公司刷屏、实习/非2026届。');
lines.push('');
lines.push('**判定门槛**：**推荐岗位 = 评分 75 分以上**（强烈推荐 ≥90　·　推荐 75–89）；75 分以下的按可考虑 65–74、备选 <65 归档，只在 CSV 里保留备查；命中过滤项 = 不推荐。看板只展示 75 分以上的岗位。');
lines.push('**薪资过滤**：**薪资上限低于 6k 直接过滤**（判定为不推荐，不进看板）；区间上限能到 6k（如 5千-1万）不算低薪。');
lines.push('');
lines.push('> 信息来源为「岗位描述（JD）正文 + 岗位发布信息与标题」，两者相互补充，**有冲突时以岗位描述（JD）正文为准**。');
lines.push('');
lines.push('## 三、各平台结果');
lines.push('');

let grand = 0, grandRec = 0;
for (const [label, rec] of allRec) {
  const key = PLAT.find((p) => p[1] === label)[0];
  const all = JSON.parse(fs.readFileSync(path.join(DATA, `scored-${key}.json`), 'utf8'));
  grand += all.length; grandRec += rec.length;
  lines.push(`### ${label}`);
  lines.push('');
  lines.push(`- 收录岗位：**${all.length}** 条　→　筛选保留：**${rec.length}** 条（过滤 ${all.length - rec.length} 条）`);
  const dist = {};
  for (const x of all) dist[x.verdict] = (dist[x.verdict] || 0) + 1;
  lines.push(`- 判定分布：${Object.entries(dist).map(([k, v]) => `${k} ${v}`).join('　·　')}`);
  lines.push('');
  lines.push('| # | 评分 | 判定 | 岗位 | 公司 | 薪资 | 城市 | 经验 | 休息制度 | 工作时间 | 弹性 | 发布时间 |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
  rec.slice(0, 30).forEach((x, i) => {
    lines.push(`| ${i + 1} | **${x.score}** | ${x.verdict} | ${x.title} | ${x.company} | ${x.salaryText || '—'} | ${x.city}${x.district ? '·' + x.district : ''} | ${x.workYear || '—'} | ${x.schedule?.rest || 'JD未提及'} | ${x.schedule?.hours || 'JD未提及'} | ${x.schedule?.flexible === '是' ? '✅' : '—'} | ${(x.publishTime || '未获取').slice(0, 10)} |`);
  });
  lines.push('');
  if (rec.length > 30) lines.push(`> 其余 ${rec.length - 30} 条见 \`${label}-推荐岗位.csv\` 与看板。`);
  lines.push('');
}

lines.push('## 四、合计');
lines.push('');
lines.push(`- 两平台合计收录 **${grand}** 条岗位，筛选后保留 **${grandRec}** 条推荐。`);
lines.push('');
lines.push('## 五、使用说明');
lines.push('');
lines.push('1. 打开 `看板.html` → 顶部切换 **智联招聘 / 前程无忧** 两个模块，各自独立排序与筛选。');
lines.push('2. 排序方式：综合评分 / 发布时间 / 薪资 / 经验门槛。筛选标签：**推荐岗位 · 接受应届生 · 双休 · BP＆管培生**（可多选叠加）。');
lines.push('3. 每张岗位卡可展开 **评分依据**（逐条列出加分/减分/过滤原因）与 **岗位描述**（高亮双休、弹性、餐补等关键词），点击岗位标题可跳转原岗位。');
lines.push('4. 点 **刷新数据** 按钮读取最新数据。当前为手动模式：**你想更新时叫我一声，我按 5 秒/次的慢速重新采集一遍，你再点刷新即可看到最新岗位**（未设置任何系统计划任务）。');
lines.push('');
lines.push('## 六、数据状态与注意事项');
lines.push('');
lines.push('- **数据范围**：广东省 8 个城市（广州、深圳、佛山、东莞、珠海、中山、惠州、江门）。');
lines.push('- **数据新鲜度**：两个平台均为本次新采集，含真实 JD 正文与发布时间。');
lines.push('- **两个平台均无需登录**，数据完整可直接复核。');
lines.push('- 单双休 / 工作时间 / 弹性打卡以 JD 正文为准；JD 未写明的标注"JD未提及"，不臆测。');
lines.push('- 被过滤的岗位在看板中可通过「不推荐」筛选查看，每条都写明了具体过滤原因，便于你复核。');

const md = lines.join('\n');
fs.writeFileSync(path.join(OUT, '筛选汇总报告.md'), md, 'utf8');
console.log(`✅ ${path.join(OUT, '筛选汇总报告.md')}`);
console.log(`\n合计：收录 ${grand} 条，推荐 ${grandRec} 条`);
