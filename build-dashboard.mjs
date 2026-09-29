/**
 * 构建双平台可视化看板（智联招聘 / 前程无忧）
 *   读取 data/dashboard-data.json（各平台已评分岗位）
 *   输出 岗位看板/看板.html（单文件、零外部依赖、可离线打开）+ 看板数据.json
 *
 * 页面 = templates/dashboard.html（骨架与样式）
 *      + <script id="payload">内嵌数据
 *      + templates/dashboard.js（页面脚本）
 */
import fs from 'fs';
import path from 'path';

const VERSION = 'v1';
const MAXJD = 1800;                 // 单条 JD 内嵌上限（控制页面体积）
const OUT_DIR = process.env.OUT_DIR || '岗位看板';
const OUT_HTML = path.join(OUT_DIR, '看板.html');
const OUT_JSON = path.join(OUT_DIR, '看板数据.json');

const TEMPLATE = fs.readFileSync(path.join('templates', 'dashboard.html'), 'utf8');
const PAGEJS = fs.readFileSync(path.join('templates', 'dashboard.js'), 'utf8');
const dash = JSON.parse(fs.readFileSync(path.join('data', 'dashboard-data.json'), 'utf8'));

/**
 * 届别提示：候选人是 2026 届，需要区分"明确接受 2026 届"与"只面向 2027 届"，
 * 避免"2027 年度项目"这类字样被误读成"只招 2027 届"。
 */
function gradTag(x) {
  const t = x.title || '';
  const jd = x.jobDescFull || x.jd || '';
  const both = /(2026\s*(?:[-–—~～]|至|到|、|\/)\s*2027\s*届|2026届及以后|2026届应届|2026届毕业生|2026年应届|应往届|往应届)/.test(jd);
  if (both) return '2026/2027届均可';
  const y27 = /(2027届|2028届|27届|28届|2027年毕业|2028年毕业)/.test(t + jd);
  if (y27) return '2027届及以后';
  if (/(不限|应届|无经验)/.test(x.workYear || '') || x.freshOk) return '接受2026届';
  return '';
}

/* ---------- 是否属于「BP / 管培生」方向（供筛选标签使用）----------
   判定依据：岗位方向角色（引擎判定）或岗位名称中明确出现 BP / HRBP / 管培生 */
function bpTag(x) {
  const role = x.roleKey || '';
  const t = x.title || '';
  if (/招聘岗/.test(role)) return false;            // 招聘专员（减分项）不算
  if (/业务伙伴|BP/.test(role)) return true;         // 引擎判定的 HRBP 方向
  if (/管培/.test(role)) return true;                // 引擎判定的管培方向
  return /(hr\s*bp|人力资源业务伙伴|业务伙伴|管培生|管理培训生|储备干部|储备经理)/i.test(t);
}

/* ---------- 打包 ---------- */
function packJob(x) {
  return {
    id: x.id, t: x.title, c: x.company, s: x.salaryText || '',
    city: x.city || '', dist: x.district || '',
    pub: (x.publishTime || '').slice(0, 10), exp: x.workYear || '', deg: x.degree || '',
    size: x.companySize || '', ind: x.industry || '', url: x.url || '',
    score: x.score, v: x.verdict,
    neg: (x.negatives || []).slice(0, 4), pen: x.penalties || [], bon: x.bonuses || [],
    rest: (x.schedule || {}).rest || '', hours: (x.schedule || {}).hours || '', flex: (x.schedule || {}).flexible || '',
    wel: (x.welfare || []).slice(0, 8), mod: (x.modules || []).slice(0, 8),
    fresh: !!x.freshOk, days: x.daysAgo, dup: x.dupCount || 1,
    jd: (x.jobDescFull || x.jd || '').slice(0, MAXJD),
    hr: x.hrName || '', hrPos: x.hrPosition || '', hrOn: !!x.hrOnline,
    role: x.roleKey || '', grad: gradTag(x),
    bp: bpTag(x),
  };
}

/* ---------- 公开版本脱敏 ----------
   岗位数据本身是公开信息，但"求职画像"里含有可定位到本人的字段。
   设置 SANITIZE=1（云端发布时）后，姓名换成笔名、学校/专业/现居/籍贯/生日一律不输出。 */
const PEN_NAME = '林小夕';
const SANITIZE = process.env.SANITIZE === '1';
function sanitizeProfile(p) {
  if (!SANITIZE) return p || {};
  return {
    name: PEN_NAME,
    graduateYear: p.graduateYear,
    targetRoles: p.targetRoles,
    expectSalaryMinK: p.expectSalaryMinK,
    english: p.english,
    mbti: p.mbti,
  };
}

const platforms = [];
for (const [key, p] of Object.entries(dash.platforms)) {
  const rec = (p.jobs || []).filter((x) => x.verdict !== '不推荐');
  platforms.push({
    key, label: p.label || key,
    total: p.total || (p.jobs || []).length,
    recommended: p.recommended != null ? p.recommended : rec.length,
    rejected: p.rejected != null ? p.rejected : ((p.jobs || []).length - rec.length),
    jobs: rec.map(packJob),
  });
}

const builtAt = new Date().toISOString();
const payload = {
  generatedAt: dash.generatedAt || builtAt,
  builtAt,
  profile: sanitizeProfile(dash.profile),
  platforms,
};

/* ---------- 组装页面 ----------
   版本号与"版本行"都由这里统一生成：v1 ● 2026/9/29 ——林小夕 */
const d = new Date(builtAt);
const STAMP = `${VERSION} ● ${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ——林小夕`;
const GH_OWNER = process.env.GH_OWNER || 'Linxi16';
const GH_REPO = process.env.GH_REPO || 'job-kanban';
const GH_WF = process.env.GH_WF || 'update.yml';
const GH_WF_NAME = process.env.GH_WF_NAME || '更新岗位数据';
const fill = (s) => s.split('!VERSION!').join(VERSION).split('!STAMP!').join(STAMP)
  .split('!GH_OWNER!').join(GH_OWNER).split('!GH_REPO!').join(GH_REPO)
  .split('!GH_WF!').join(GH_WF).split('!GH_WF_NAME!').join(GH_WF_NAME);

const html = fill(TEMPLATE)
  + '<script id="payload" type="application/json">' + JSON.stringify(payload) + '</script>\n'
  + '<script>\n' + fill(PAGEJS) + '</script>\n'
  + '</body>\n</html>';

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT_HTML, html, 'utf8');
fs.writeFileSync(OUT_JSON, JSON.stringify(payload), 'utf8');

/* 发布目录额外写一份 index.html：手机直接访问站点根路径（不带文件名）也能打开看板 */
const isSiteDir = /^(dist|site|public)$/i.test(path.basename(path.resolve(OUT_DIR)));
if (isSiteDir) {
  const idx = path.join(OUT_DIR, 'index.html');
  fs.writeFileSync(idx, html, 'utf8');
  console.log('✅ 站点首页:', idx.replace(/\\/g, '/'), '（访问根路径即可打开）');
}

const kb = (n) => Math.round(n / 1024) + ' KB';
console.log('✅ 看板已生成:', path.resolve(OUT_HTML), '(' + kb(Buffer.byteLength(html, 'utf8')) + ')');
console.log('✅ 数据副本:', OUT_JSON.replace(/\\/g, '/'), '(' + kb(Buffer.byteLength(JSON.stringify(payload), 'utf8')) + ')');
console.log('   版本', VERSION, '| 打包：' + platforms.map((p) => `${p.label} ${p.jobs.length} 条`).join('、'));
