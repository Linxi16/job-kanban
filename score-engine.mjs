/**
 * 求职筛选与评分引擎
 *
 * 输入：data/zhilian-list.json（+ zhilian-detail.json 可选）、data/51job-list.json
 * 输出：data/scored-<platform>.json、data/dashboard-data.json、data/筛选报告.md
 *
 * 规则来源（用户明确指定）：
 *   【期望】HRBP / HR专员 / 人力专员 / 行政专员 / 行政助理 / 部门助理 / HR管培生；6k+；广东省
 *   【加分】知名企业、游戏日化行业、500人以上、双休、弹性打卡、餐补/交补/包吃/包住/下午茶、
 *          7k+、广州/佛山、多模块、HRBP或管培生、接受应届生、一周内新发布
 *   【减分】招聘专员
 *   【过滤】单休、20-99人、乙方公司、第三方派遣、经验要求>1年
 *   【原则】以岗位描述（JD）内容为准；JD 未提及才参考岗位发布信息
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 数据目录可通过 DATA_DIR 指定（云端构建用），默认 <项目根>/data
const DATA = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, 'data');

// ============ 简历画像（吴家良） ============
const PROFILE = {
  name: '吴家良',
  birth: '2003/08',
  graduateYear: 2026,
  school: '广东财经大学',
  major: '人力资源管理（人才开发与管理方向）',
  city: '广州市海珠区',
  hometown: '广东省云浮市',
  targetRoles: ['HRBP', 'HR专员', '人力专员', '人力资源专员', '行政专员', '行政助理', '部门助理', '人力资源管培生', 'HR管培生'],
  internRoles: ['HRBP', 'HR', '招聘', '人力资源'],
  expectSalaryMinK: 6,
  english: 'CET-4',
  mbti: 'INFJ',
};

// 目标岗位关键词（用于判断岗位方向相关度）
const ROLE_PATTERNS = [
  { key: 'HRBP', re: /hrbp|hr\s*bp|业务伙伴|bp/i, weight: 20 },
  { key: '管培生', re: /管培|储备干部|管理培训生|培训生/i, weight: 18 },
  { key: '人力资源专员', re: /人力资源(专员|助理|岗|专员岗)|人事专员|人力专员/i, weight: 16 },
  { key: 'HR专员', re: /hr\s*(专员|助理|specialist)/i, weight: 16 },
  { key: '行政专员', re: /行政(专员|助理|岗|文员|前台)/i, weight: 12 },
  { key: '部门助理', re: /部门助理|业务助理|运营助理|总裁助理|总经理助理|总监助理/i, weight: 12 },
  { key: '招聘岗', re: /招聘(专员|助理|顾问|主管|经理|运营)/i, weight: -25 }, // 减分项
];

// 非目标岗位（明显不相关，直接排除出推荐）
const OFF_TARGET = /销售(代表|顾问|经理|专员|工程师)|电话销售|客服|市场(专员|经理)|运营(专员|经理)|财务|会计|出纳|java|前端|后端|测试|运维|算法|产品经理|设计师|美工|主播|编导|摄影|司机|保安|普工|操作工|仓管|跟单|采购|外贸|商务(专员|经理)|店长|导购|厨师|服务员|幼教|教师|助教|护士|药剂|保险(代理|顾问)|法务|合规|风控|审计|投资|理财|信贷|催收/i;

// 目标岗位标题白名单（标题必须命中其一，否则视为方向不相关）
const TARGET_TITLE = /hrbp|hr\s*bp|人力资源|人力专员|人事|行政|部门助理|业务助理|运营助理|总裁助理|总经理助理|总监助理|管培|储备干部|管理培训生|招聘(专员|助理|运营|主管|经理)|员工关系|薪酬|绩效|培训(专员|主管)|组织发展|企业文化|综合(专员|助理|管理)|文员|秘书|前台/i;

// 工作模块口径（用户指定 8 类：规划 / 招聘 / 培训 / 薪酬 / 绩效 / 员关 / 行政 / BP）
// 与看板标签同源：只依据 JD 正文的「实际工作内容」判定，
// 任职要求/福利待遇等段落里的词不算工作模块。
const MODULE_LABELS = ['规划', '招聘', '培训', '薪酬', '绩效', '员关', '行政', 'BP'];

// 职责段标题（其后内容 = 工作内容）
const SEC_DUTY = /岗\s*位\s*职\s*责|工\s*作\s*职\s*责|职\s*责\s*描\s*述|工\s*作\s*内\s*容|主\s*要\s*职\s*责|岗\s*位\s*内\s*容|职\s*位\s*描\s*述|你\s*将\s*负\s*责|岗\s*位\s*描\s*述/;
// 非职责段标题（其后内容 = 要求 / 待遇，不参与模块判定）
const SEC_ASK  = /任\s*职\s*要\s*求|任\s*职\s*资\s*格|岗\s*位\s*要\s*求|任\s*职\s*条\s*件|招\s*聘\s*要\s*求|应\s*聘\s*要\s*求|候\s*选\s*人\s*要\s*求|我\s*们\s*期\s*待|资\s*格\s*条\s*件|学\s*历\s*要\s*求|招\s*聘\s*对\s*象|招\s*聘\s*流\s*程|岗\s*位\s*亮\s*点|项\s*目\s*简\s*介|公\s*司\s*简\s*介|加\s*分\s*项|我\s*们\s*提\s*供|福\s*利\s*待\s*遇|薪\s*资\s*待\s*遇|福\s*利\s*保\s*障|入\s*职\s*要\s*求|能\s*力\s*倾\s*向|专\s*业\s*倾\s*向|岗\s*位\s*发\s*展\s*方\s*向|发\s*展\s*方\s*向|任\s*职\s*说\s*明|应\s*聘\s*条\s*件|基\s*本\s*要\s*求|任\s*职\s*要\s*点|我\s*们\s*希\s*望|岗\s*位\s*优\s*势|薪\s*酬\s*福\s*利|员\s*工\s*福\s*利|待\s*遇\s*说\s*明/;
// 小节标题可能的书写形式（用于在同一行内断开多个小节）
// 只在【】标记、或行首编号后紧跟小节词时断行，避免把正文句子切断
const SEC_BREAK = /(【[^】\n]{2,14}】|(?:^|(?<=\n))[ \t\u00a0\u3000]*[一二三四五六七八九十]{1,2}[、.．)）](?=[^\n]{0,8}?(?:职责|要求|资格|条件|内容|待遇|福利|亮点|简介|流程|对象|发展|倾向|说明)))/gm;

const MODULES = [
  { label: '规划', re: /(人力资源|人力|人事|组织|人才|编制)[^，。；\n]{0,8}(规划|盘点|梯队|体系搭建)|(规划|盘点|搭建|优化|完善)[^，。；\n]{0,8}(人力资源|人力|组织架构|人才梯队|人员编制|职级体系)|组织架构|人才梯队|(编制|人才)[^，。；\n]{0,6}(规划|盘点|梯队)|年度[^，。；\n]{0,4}(人力|人员|招聘|编制)[^，。；\n]{0,4}(规划|预算|计划)/ },
  { label: '招聘', re: /(招聘|招募|简历筛选|面试|校招|社招|雇主品牌|人才引进|人员配置|招聘渠道)/ },
  { label: '培训', re: /(培训|带教|讲师|学习发展|人才培养|赋能)/ },
  { label: '薪酬', re: /(薪酬|薪资|工资|调薪|算薪|社保|公积金|五险一金|考勤|个税|发薪)/ },
  { label: '绩效', re: /(绩效|考核|kpi|okr|目标管理|绩效管理)/i },
  { label: '员关', re: /(员工关系|劳动关系|入离职|入转调离|入职|离职|劳动合同|员工沟通|员工关怀|员工活动|企业文化|转正|调岗)/ },
  { label: '行政', re: /(行政|后勤|办公用品|固定资产|会务|接待|档案|证照|车辆|宿舍|食堂|办公环境|采购)/ },
  { label: 'BP', re: /(hrbp|hr\s*bp|业务伙伴|业务对接|支持业务|业务部门|bp)/i },
];

// 取出用于模块判定的正文：有独立职责段就只认职责段
// 注意：必须保留换行边界，否则「【任职要求】…【岗位职责】」会粘成一行，
// 导致分段失效、整篇 JD 被当成职责段。这里只压缩空白，不破坏换行。
function moduleHay(jd) {
  const raw = String(jd || '').trim();
  if (raw.length <= 20) return '';
  const nrm = raw.replace(/\r/g, '')
    .replace(/[ \t\u00a0\u3000]*\n[ \t\u00a0\u3000]*/g, '\n')   // 去行首行尾空白，保留换行
    .replace(/[ \t\u00a0\u3000]{2,}/g, ' ')                    // 行内连续空白压成一个
    .replace(SEC_BREAK, '\n$1');                               // 同一行里的多个小节标题各自断行
  const lines = nrm.split('\n');
  let duty = '';
  const rest = [];              // 非职责段内容（要求/待遇/前言）
  let inDuty = false, inAsk = false, sawAsk = false;
  for (const rawLine of lines) {
    let L = rawLine.trim();
    if (!L) continue;
    // 行首【…】小节标签：只按标签判归属，不受整行长度影响
    const bm = /^(【[^】]{2,14}】)/.exec(L);
    if (bm) {
      const tag = bm[1];
      if (SEC_DUTY.test(tag) && !SEC_ASK.test(tag)) {
        inDuty = true; inAsk = false;
        L = L.slice(tag.length).trim();
        if (!L) continue;
      } else if (SEC_ASK.test(tag) && !SEC_DUTY.test(tag)) {
        inAsk = true; inDuty = false; sawAsk = true;
        L = L.slice(tag.length).trim();
        if (!L) continue;
      }
    } else if (L.length <= 24 && SEC_DUTY.test(L) && !SEC_ASK.test(L)) {
      inDuty = true; inAsk = false; continue;
    } else if (L.length <= 26 && SEC_ASK.test(L) && !SEC_DUTY.test(L)) {
      inAsk = true; inDuty = false; sawAsk = true; continue;
    }
    if (inDuty) duty += L + '\n';
    else if (!inAsk) rest.push(L);
  }
  // 有独立职责段 → 只认职责段
  if (duty.length >= 20) return duty;
  // 无职责段但也不存在「要求/待遇」段 → 整篇就是工作内容描述
  if (!sawAsk) return nrm;
  // 存在要求段却没有职责段 → 只剩未分类内容；若为空则无可判定内容（不硬凑命中）
  const tail = rest.filter((L) => !(L.length <= 24 && SEC_DUTY.test(L)) && !(L.length <= 26 && SEC_ASK.test(L))).join('\n');
  return tail.length >= 20 ? tail : '';
}

// 保险/理财类公司（常以"人事/行政助理"名义招销售）
// 金融行业识别（用于"行业=金融 + JD含销售话术"的辅助判定，不能仅凭行业过滤）
const INSURANCE_INDUSTRY = /(保险|银行|证券|基金|信托|金融|投资|理财|财富管理)/;
const INSURANCE_BAIT = /(售后服务|客户经理|筹备主管|优才|储备经理|区域服务|销售|展业|业务拓展|客户资源|维护客户|开拓客户|业绩|佣金|提成|坐席|电销|主管助理|经理助理|组经理|部经理)/i;

// 高管理/资深岗位（应届生不匹配）
const SENIOR_TITLE = /(总监|总经理|副总|首席|负责人|主管|经理|资深|高级|专家|senior|lead|head|director|manager)/i;

// 非核心职能岗（外贸/业务/销售支持/后勤操作类，与 HR、行政方向不符）
const NON_CORE = /(外贸|业务助理|业务员|业务跟单|销售助理|销售文员|跟单|网管|售后|客服|门店|导购|店员|商务助理|采购助理)/;

// 明显偏离 HR / 行政方向的岗位表述（用于给"非核心职能岗"兜底判定，比 OFF_TARGET 更宽）
const OFF_DIRECTION = /(外贸|业务|跟单|网管|售后|客服|门店|导购|店员|商务助理|采购助理|船务|仓管|物流|配送|生产|车间|称量|涂装|装配|数控|电工|司机|保洁|保安)/;

// 乙方/外包/派遣特征
const AGENCY = /(人力资源服务|人力服务|劳务(派遣|外包|服务)|人才(服务|中介|派遣)|外包服务|staffing|rpo|猎头|猎聘|招聘外包|岗位外包|劳务公司|咨询(服务)?有限公司.*(人力|招聘)|第三方(派遣|外包)|派驻|驻场|代招)/i;

// 知名/品牌企业（加分）
const BRAND = /(腾讯|阿里|字节|跳动|百度|京东|美团|拼多多|网易|华为|小米|oppo|vivo|荣耀|比亚迪|特斯拉|美的|格力|海尔|立白|蓝月亮|宝洁|联合利华|欧莱雅|资生堂|雅诗兰黛|安踏|李宁|耐克|阿迪达斯|优衣库|名创优品|miniso|泡泡玛特|pop\s*mart|米哈游|网易游戏|三七互娱|完美世界|西山居|库洛|叠纸|莉莉丝|趣加|funplus|唯品会|shein|希音|tcl|创维|康佳|广汽|小鹏|蔚来|理想|顺丰|菜鸟|德邦|招商银行|中国平安|平安|中国人寿|南方电网|中建|中铁|中石化|中石油|国家电网|华润|万科|保利|碧桂园|恒大|越秀集团|广药|王老吉|珠江啤酒|燕塘|温氏|海天|厨邦|健力宝|喜茶|奈雪|瑞幸|星巴克|麦当劳|肯德基|百胜|屈臣氏|沃尔玛|山姆|宜家|名臣|丸美|珀莱雅|薇诺娜|韩后|卡姿兰)/i;

// 游戏 / 日化行业（加分）
const INDUSTRY_BONUS = /(游戏|手游|网游|电竞|日化|化妆品|护肤|美妆|个护|家清|洗护|潮玩|玩具|盲盒|快消|食品饮料)/i;

// 其中"游戏 / 日化"为最高一档（其余快消/食品饮料为次一档）
const INDUSTRY_STRONG = /(游戏|手游|网游|电竞|日化|化妆品|护肤|美妆|个护|家清|洗护|潮玩|盲盒)/i;

// ============ 文本提取 ============

/** 从 JD 抽取作息制度 */
function extractSchedule(text) {
  const t = text || '';
  const out = { rest: '', hours: '', flexible: '', note: '' };
  // 双休
  if (/双休|周末双休|五天工作制|每周工作5天|大小周|单双休/i.test(t)) {
    if (/大小周|单双休/i.test(t)) out.rest = '大小周';
    else out.rest = '双休';
  }
  // 单休（排除"非单休""不是单休"）
  if (/(?<![非不])单休|每周工作6天|一周工作6天|做六休一|六天工作制/i.test(t)) out.rest = '单休';
  // 排班轮休
  if (/排班|轮班|轮休|倒班|早晚班|班次|调休/i.test(t)) out.rest = out.rest === '单休' ? '单休' : '排班轮休';
  // 工作时间
  // 工作时间：必须有时段关键词引导，避免误抓 JD 中的任意时间
  const timeRe = /(\d{1,2}[:：]\d{2})\s*[-~—－至到]\s*(\d{1,2}[:：]\d{2})/;
  const validHour = (t) => { const h = parseInt(String(t).split(/[:：]/)[0], 10); return h >= 0 && h <= 23; };
  const spanH = (a, b) => {
    const h1 = parseInt(a, 10) + (parseInt(a.split(/[:：]/)[1], 10) || 0) / 60;
    const h2 = parseInt(b, 10) + (parseInt(b.split(/[:：]/)[1], 10) || 0) / 60;
    return h2 - h1;
  };
  const anchored = t.match(/(?:上班时间|工作时间|作息时间|考勤时间|上班时段|工作时间段)([^\n。；;]{0,60})/);
  if (anchored) {
    // 锚点后可能列了多段（如 "8:30-12:00，13:30-17:30"）→ 取最宽的一段
    const seg = anchored[1];
    const all = [...seg.matchAll(/(\d{1,2}[:：]\d{2})\s*[-~—－至到]\s*(\d{1,2}[:：]\d{2})/g)];
    let best = null;
    for (const m of all) {
      if (!validHour(m[1]) || !validHour(m[2])) continue;
      const s = spanH(m[1], m[2]);
      const h1 = parseInt(m[1], 10);
      if (s >= 5 && h1 >= 5 && h1 <= 14 && (!best || s > best.s)) best = { s, v: `${m[1]}-${m[2]}` };
    }
    if (best) out.hours = best.v.replace(/：/g, ':');
  }
  if (!out.hours) {
    // 未锚定：只接受形如 9:00-18:00 且时长≥5h 的完整工作时段
    const m = t.match(/(?<![\d:])(\d{1,2}[:：]\d{2})\s*[-~—－至到]\s*(\d{1,2}[:：]\d{2})(?![\d:])/);
    if (m && validHour(m[1]) && validHour(m[2])) {
      const h1 = parseInt(m[1], 10), h2 = parseInt(m[2], 10);
      if (h1 >= 6 && h1 <= 14 && h2 >= 15 && h2 <= 23 && spanH(m[1], m[2]) >= 5) {
        out.hours = `${m[1]}-${m[2]}`.replace(/：/g, ':');
      }
    }
  }
  // 弹性打卡
  if (/弹性(工作|打卡|上下班|考勤)|不打卡|灵活(考勤|上下班)|自由(打卡|上下班)|弹性时间/i.test(t)) out.flexible = '是';
  return out;
}

/** 从 JD 抽取福利 */
function extractWelfare(text) {
  const t = text || '';
  const w = {};
  if (/餐补|餐饮补贴|饭补|餐费补贴|包吃|免费三餐|工作餐|提供午餐|包午餐/i.test(t)) w['餐补/包吃'] = true;
  if (/交通补贴|交补|车补|交通补助|班车/i.test(t)) w['交通补贴'] = true;
  if (/包住|住房补贴|房补|提供住宿|员工宿舍|宿舍/i.test(t)) w['包住/房补'] = true;
  if (/下午茶|零食|茶歇|咖啡不限|饮品|下午茶点/i.test(t)) w['下午茶'] = true;
  if (/五险一金|六险一金|五险|社保/i.test(t)) w['五险一金'] = true;
  if (/双休|周末双休/i.test(t)) w['双休'] = true;
  if (/年终奖|13薪|14薪|年底双薪|绩效奖金/i.test(t)) w['年终奖'] = true;
  if (/带薪年假|年假/i.test(t)) w['带薪年假'] = true;
  if (/节日福利|生日福利|节日礼品|团建|员工旅游|员工活动/i.test(t)) w['节日/团建'] = true;
  if (/股票|期权|股权激励/i.test(t)) w['股权激励'] = true;
  if (/培训|带教|导师制|晋升|成长/i.test(t)) w['培训晋升'] = true;
  return w;
}

/** 从 JD/岗位信息 抽取接受应届生 */
function extractFreshFriendly(text) {
  const t = text || '';
  if (/接受应届|应届(生)?(优先|亦可|可投|欢迎)|欢迎应届|应届毕业生|无经验(可|亦)|不限经验|经验不限|无需经验|可培养|实习生转正|校招/i.test(t)) return true;
  return false;
}

/** 从 JD 抽取真实的经验要求（数字，年） */
function extractExpYearsFromJd(text) {
  const t = text || '';
  let maxYears = null;
  // "3年以上"、"2年及以上"、"1-3年"、"满2年"
  const patterns = [
    /(\d+)\s*年(?:及|以)?(?:以上|起|经验)/g,
    /(\d+)\s*[-~至]\s*(\d+)\s*年/g,
    /(?:满|需|要求)\s*(\d+)\s*年/g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(t))) {
      const nums = m.slice(1).filter(Boolean).map(Number);
      const v = Math.max(...nums);
      if (maxYears === null || v > maxYears) maxYears = v;
    }
  }
  return maxYears;
}

/** 岗位发布信息里的经验要求 → 年数（-1 表示不限，null 表示未知） */
function expFromLabel(label) {
  const s = String(label || '');
  if (!s) return null;
  if (/经验不限|不限|无要求|无经验/.test(s)) return -1;
  if (/1年以下|一年以下|应届/.test(s)) return 0;
  if (/1-3年|1~3年|一至三年/.test(s)) return 3;
  if (/3-5年|3~5年|三至五年/.test(s)) return 5;
  if (/5-10年|5~10年/.test(s)) return 10;
  if (/10年以上/.test(s)) return 99;
  if (/2年/.test(s)) return 2;
  const m = s.match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

/** 薪资 → 最高月薪（元）：用于「薪资低于 6k」过滤（区间上限都到不了 6k 才算低薪） */
function parseSalaryMax(text) {
  const s = String(text || '');
  if (!s || /面议|谈判|薪资面议/.test(s)) return null;
  let m = s.match(/(\d+(?:\.\d+)?)\s*[-~至]\s*(\d+(?:\.\d+)?)\s*万/);
  if (m) return parseFloat(m[2]) * 10000;
  m = s.match(/(\d+(?:\.\d+)?)\s*[-~至]\s*(\d+(?:\.\d+)?)\s*千/);
  if (m) return parseFloat(m[2]) * 1000;
  m = s.match(/(\d{4,6})\s*[-~至]\s*(\d{4,6})\s*元/);
  if (m) return Number(m[2]);
  m = s.match(/(\d+(?:\.\d+)?)\s*[-~至]\s*(\d+(?:\.\d+)?)\s*[kK]/);
  if (m) return parseFloat(m[2]) * 1000;
  m = s.match(/(\d+(?:\.\d+)?)\s*[-~至]\s*(\d+(?:\.\d+)?)/);
  if (m) { const hi = parseFloat(m[2]); return hi >= 1000 ? hi : hi * 1000; }
  m = s.match(/(\d+(?:\.\d+)?)\s*万/);
  if (m) return parseFloat(m[1]) * 10000;
  m = s.match(/(\d+(?:\.\d+)?)\s*千/);
  if (m) return parseFloat(m[1]) * 1000;
  m = s.match(/(\d{4,6})/);
  if (m) return Number(m[1]);
  return null;
}

/**
 * 薪资 → 最低月薪（元） */
function parseSalaryMin(text) {
  const s = String(text || '');
  if (!s || /面议|谈判|薪资面议/.test(s)) return null;
  // 万
  let m = s.match(/(\d+(?:\.\d+)?)\s*[-~至]\s*(\d+(?:\.\d+)?)\s*万/);
  if (m) return parseFloat(m[1]) * 10000;
  // 千
  m = s.match(/(\d+(?:\.\d+)?)\s*[-~至]\s*(\d+(?:\.\d+)?)\s*千/);
  if (m) return parseFloat(m[1]) * 1000;
  // 元
  m = s.match(/(\d{4,6})\s*[-~至]\s*(\d{4,6})\s*元/);
  if (m) return Number(m[1]);
  // k
  m = s.match(/(\d+(?:\.\d+)?)\s*[-~至]\s*(\d+(?:\.\d+)?)\s*[kK]/);
  if (m) return parseFloat(m[1]) * 1000;
  // 单一数值
  m = s.match(/(\d+(?:\.\d+)?)\s*万/);
  if (m) return parseFloat(m[1]) * 10000;
  m = s.match(/(\d+(?:\.\d+)?)\s*千/);
  if (m) return parseFloat(m[1]) * 1000;
  m = s.match(/(\d{4,6})/);
  if (m) return Number(m[1]);
  return null;
}

/** 公司规模 → 人数下限 / 分类
 *  档次按用户指定：20–99 / 100–499 / 500–999 / 1000–9999 / 10000以上
 *  加分（有档次，0～10）：10000以上 10；1000–9999 8；500–999 5；100–499 2；20–99 0
 *  减分（20～99 人）：-12                                     */
function parseCompanyScale(text) {
  const s = String(text || '');
  if (!s) return { min: null, max: null, label: '', small: false, big: false, band: '', bonus: 0 };
  let min = null, max = null;
  const m = s.match(/(\d+)\s*[-~至]\s*(\d+)\s*人/);
  if (m) { min = Number(m[1]); max = Number(m[2]); }
  else {
    const m2 = s.match(/(\d+)\s*人以上/);
    if (m2) { min = Number(m2[1]); max = Infinity; }
  }
  // "少于50人""50人以下""20人以下" 等
  if (min === null) {
    const m3 = s.match(/(?:少于|不足|低于)\s*(\d+)\s*人/) || s.match(/(\d+)\s*人以下/);
    if (m3) { min = 1; max = Number(m3[1]); }
  }
  if (min === null && /20人以下/.test(s)) { min = 1; max = 20; }

  const small = min !== null && max !== null && max <= 99;   // 20-99人 及更小 → 过滤
  let band = '', bonus = 0, big = false;
  if (min !== null) {
    if (min >= 10000) { band = '10000人以上'; bonus = 10; big = true; }
    else if (min >= 1000) { band = '1000-9999人'; bonus = 8; big = true; }
    else if (min >= 500) { band = '500-999人'; bonus = 5; big = true; }
    else if (min >= 100) { band = '100-499人'; bonus = 2; }
    else { band = '20-99人'; bonus = 0; }
  }
  return { min, max, label: s, small, big, band, bonus };
}

/** 判断是否招聘专员岗（减分项） */
function isRecruitOnly(title, jd) {
  const t = String(title || '');
  const d = String(jd || '');
  // 标题直接是招聘岗
  if (/招聘(专员|助理|顾问|主管|经理|运营|专家)/.test(t) && !/hrbp|人事|人力资源|行政/i.test(t)) return true;
  // 标题含"招聘"且不含其他模块
  if (/招聘/.test(t) && /(猎头|rpo|人才寻访|招聘外包)/i.test(t + d)) return true;
  return false;
}

/** 岗位是否 80% 以上是招聘工作（减分项）
 *  依据 JD 内的职责条目：招聘条目占比 >= 0.8 即命中；否则退回标题判定 */
function isRecruitHeavy(title, jd) {
  const items = dutyItems(jd);
  if (items.length >= 3) {
    const n = items.filter((s) => MODULES.find((m) => m.label === '招聘').re.test(s)).length;
    if (n / items.length >= 0.8) return true;
    if (n / items.length > 0 && n / items.length < 0.8) return false;
  }
  return isRecruitOnly(title, jd);
}

/** 判断是否乙方/外包/派遣 */
function isAgency(company, jd, title) {
  const c = String(company || '');
  const d = String(jd || '');
  const t = String(title || '');
  if (AGENCY.test(c)) return true;
  if (/(人力资源服务|劳务派遣|劳务外包|人才派遣|招聘外包|派驻|驻场|外包服务)/.test(d) && /(甲方|客户公司|派往|驻场)/.test(d)) return true;
  if (/驻场|派驻|外包/.test(t)) return true;
  return false;
}

/** 把 JD 的职责段切成一条条具体工作内容（与看板 dutyItems 同源） */
function dutyItems(jd) {
  const hay = moduleHay(jd);
  if (!hay) return [];
  return hay
    .replace(/\r/g, '')
    .split(/\n|(?=\d{1,2}\s*[、.．)）])|(?=[一二三四五六七八九十]{1,2}\s*[、.．)）])/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 4);
}

/** 模块提及条数 */
function modCount(jd, m) {
  const items = dutyItems(jd);
  if (!items.length) return 0;
  let n = 0;
  for (const s of items) if (m.re.test(s)) n++;
  return n;
}

/** 各模块归一化占比（5% 刻度、合计恒为 100%）——与看板 modWeights 完全同源 */
function modWeights(jd) {
  const items = dutyItems(jd);
  const out = {};
  for (const m of MODULES) out[m.label] = 0;
  if (!items.length) return out;
  const cnt = MODULES.map((m) => ({ m, n: modCount(jd, m) }));
  const total = cnt.reduce((s, o) => s + o.n, 0);
  if (!total) return out;
  const live = cnt.filter((o) => o.n > 0);
  let acc = 0;
  const parts = live.map((o) => {
    const exact = (o.n / total) * 100;
    let v = Math.round(exact / 5) * 5;
    if (v < 5) v = 5;
    if (v > 100) v = 100;
    acc += v;
    return { m: o.m, v, frac: exact - v };
  });
  let diff = 100 - acc;
  while (diff !== 0) {
    const step = diff > 0 ? 5 : -5;
    let best = -1;
    let bestVal = null;
    for (let i = 0; i < parts.length; i++) {
      const nv = parts[i].v + step;
      if (nv < 5 || nv > 100) continue;
      const sc = step > 0 ? -parts[i].frac : parts[i].frac;
      if (bestVal === null || sc > bestVal) { bestVal = sc; best = i; }
    }
    if (best < 0) break;
    parts[best].v += step;
    diff -= step;
  }
  for (const p of parts) out[p.m.label] = p.v;
  return out;
}

/** 由分数 / 过滤项 得到判定（唯一口径，避免多处重复实现）
 *  「推荐岗位」门槛 = 75 分（用户指定）：强烈推荐 ≥90 / 推荐 75–89 / 可考虑 65–74 / 备选 <65 */
function verdictOf(score, penalties, negatives) {
  if ((negatives || []).length > 0) return '不推荐';
  if (score >= 90) return '强烈推荐';
  if (score >= 75) return '推荐';
  if (score >= 65) return '可考虑';
  return '备选';
}

/** 是否属于「HRBP / HR管培生」方向 */
function isBpOrMt(title, roleKey) {
  if (/招聘岗/.test(roleKey || '')) return false;
  const t = String(title || '');
  // 非HR方向的管培生（供应链/销售/营销/生产/技术等）不算
  if (/管培|管理培训生|储备干部|培训生/.test(t) && /(外贸|供应链|物流|销售|营销|市场|商务|生产|制造|技术|研发|工程|门店|零售|运营|质量|采购)/.test(t)) return false;
  if (/业务伙伴|BP|管培/.test(roleKey || '') && !/不相关|其它/.test(roleKey || '')) return true;
  return /(hr\s*bp|人力资源业务伙伴|业务伙伴|人[力事]管培|人[力事]资源管培|hr管培|管培生|管理培训生|储备干部|储备经理)/i.test(t);
}

// ============ 打分主逻辑 ============
function scoreJob(job, platform, now) {
  const title = job.title || '';
  const company = job.company || '';
  const jd = job.jd || '';
  // 岗位描述优先；JD 未提及才参考发布信息中的标签
  const postLabels = [...(job.tags || []), ...(job.welfareFromPost || [])].filter(Boolean).join(' ');
  const text = `${title}\n${jd}`;            // JD 主体（用于作息/时间/弹性判定）
  const textAll = `${text}\n${postLabels}`;  // 含发布标签（仅作补充）
  const negatives = [];   // 过滤项（命中→不推荐）
  const penalties = [];   // 减分项
  const bonuses = [];     // 加分项
  let score = 50;

  // ---------- 硬过滤 ----------
  // 0) 地域：必须在广东省内（前程用 jobArea 只按公司注册地过滤，会混入北京/苏州等异地岗位）
  const GD_CITIES = ['广州', '深圳', '佛山', '东莞', '珠海', '中山', '惠州', '江门', '肇庆', '汕头', '湛江', '茂名', '韶关', '梅州', '汕尾', '河源', '阳江', '清远', '潮州', '揭阳', '云浮'];
  const jobCity = String(job.city || '').trim();
  if (!jobCity) {
    negatives.push('工作地点未标明');
  } else if (!GD_CITIES.some((c) => jobCity.includes(c))) {
    negatives.push(`非广东省内（${jobCity}）`);
  }

  // 1) 经验要求 > 1年
  const expLabelYears = expFromLabel(job.workYear);
  const jdYears = extractExpYearsFromJd(jd);
  const freshOk = extractFreshFriendly(jd) || extractFreshFriendly(title);
  let effectiveExp = expLabelYears;
  if (jdYears !== null && (expLabelYears === null || jdYears > expLabelYears)) effectiveExp = jdYears;
  // JD 明确接受应届 → 视为不限
  if (freshOk && (effectiveExp === null || effectiveExp >= 0)) effectiveExp = Math.min(effectiveExp ?? 0, 1);

  const expIsOver1 = effectiveExp !== null && effectiveExp > 1;
  if (expIsOver1) negatives.push(`经验要求>1年（${job.workYear || 'JD要求' + jdYears + '年'}）`);

  // 2) 20-99人
  const scale = parseCompanyScale(job.companySize);
  if (scale.small) negatives.push(`公司规模偏小（${scale.label}）`);

  // 3) 乙方/派遣
  if (isAgency(company, jd, title)) negatives.push('乙方/外包/派遣公司');

  // 4) 单休（JD 优先；JD 未提及才看发布标签）
  let sched = extractSchedule(text);
  if (!sched.rest) { const s2 = extractSchedule(textAll); if (s2.rest) { sched = { ...sched, rest: s2.rest, note: '来自岗位发布标签' }; } }
  if (!sched.hours) { const s2 = extractSchedule(textAll); if (s2.hours) sched.hours = s2.hours; }
  if (!sched.flexible) { const s2 = extractSchedule(textAll); if (s2.flexible) sched.flexible = s2.flexible; }
  if (sched.rest === '单休') negatives.push('单休');

  // 5) 薪资低于 6k（用户指定：薪资过滤门槛 6k；区间上限都到不了 6k 才算低薪，未标明薪资不误杀）
  const salMaxNum = job.salaryMaxNum ?? parseSalaryMax(job.salaryText);
  if (salMaxNum !== null && salMaxNum < 6000) negatives.push(`薪资低于6k（${job.salaryText}）`);

  // ---------- 岗位方向命中（供加分⑦ 与 roleKey 使用）----------
  let roleHit = null;
  for (const p of ROLE_PATTERNS) {
    if (p.re.test(title)) { roleHit = p; break; }
  }
  if (!roleHit && OFF_TARGET.test(title)) {
    penalties.push({ k: '岗位方向不相关（非HR/行政方向）', v: -20 });
  } else if (!roleHit && (NON_CORE.test(title) || OFF_DIRECTION.test(title))) {
    penalties.push({ k: '非核心职能岗（外贸/业务/后勤类）', v: -20 });
  }
  // 命中"部门助理"等宽口径方向、但标题明显是业务/外贸/销售支持类 → 依然按非核心职能减分
  if (roleHit && /(外贸|跨境电商|业务助理|业务员|业务跟单|销售助理|销售文员|商务助理|采购助理|船务|跟单)/.test(title)) {
    penalties.push({ k: '非核心职能岗（外贸/业务类，非HR/行政方向）', v: -15 });
  }

  // ---------- 减分 ----------
  if (SENIOR_TITLE.test(title)) penalties.push({ k: '管理/资深岗位（应届不匹配）', v: -15 });
  // 海外/外派岗位：与"广东省内"期望不符，明确标注并减分
  // 标题可宽匹配；JD 只认"明确外派"的表述，避免"有境外留学背景者优先"这类加分条件被误判
  const overseasTitle = /海外|驻外|外派|出国|境外|柬埔寨|越南|泰国|印尼|印度|非洲|中东/i.test(title);
  const overseasJd = /(常驻|派驻|外派|出差|工作地点|base|Base|驻地)[^。；\n]{0,20}(柬埔寨|越南|泰国|印尼|印度|非洲|中东|海外|境外|国外)|(柬埔寨|越南|泰国|印尼|印度|非洲|中东)[^。；\n]{0,10}(常驻|派驻|工作地点|base)|驻外|海外常驻|需长期驻/i.test(jd);
  if (overseasTitle || overseasJd) {
    penalties.push({ k: '海外/外派岗位（非广东省内常驻）', v: -20 });
  }

  // 保险/金融公司以"人事/行政"名义招销售 → 过滤
  // 这类岗位标题看起来是行政/人事，JD 里却写"无责底薪+绩效奖+提成、收入上不封顶"，
  // 实质是保险销售，必须拦掉（实际复核中"中国平安·行政专员"即为此类）。
  const strongHrInFin = /(人力资源(专员|经理|主管|岗)|人事(专员|经理|主管|岗)|hrbp|薪酬|绩效|培训(专员|经理)|招聘(专员|经理)|组织发展|员工关系)/i.test(title);
  const salesBait = /提成|上不封顶|无责底薪|业绩提成|业绩奖金|佣金|新人津贴|增员|优才|筹备主管|客户经理|销售|业务员|代理制|坐席|电销|陌拜|拜访客户/i;
  const baitHit = salesBait.test(jd) || salesBait.test(postLabels);
  // ① 保险主体（公司名含"保险/人寿/财险/平安"等）——这类公司挂"行政/人事/秘书"名头基本是销售引流
  const insurerCo = /(保险|人寿|财险|平安|太平洋|泰康|友邦|国寿|人保|太平人寿|阳光人寿|华夏人寿|前海人寿|中宏人寿|工银安盛|建信人寿|中信保诚|招商信诺)/.test(company);
  // ② 泛金融主体（银行/证券/基金/投资/理财等）——不能仅凭公司名判定，必须 JD 有销售话术
  const genericFinCo = /(银行|证券|基金|信托|金融|投资|理财|财富管理|贷款|证券|期货)/.test(company) || INSURANCE_INDUSTRY.test(job.industry || '');
  // ③ 本身就是专业职能岗（合规/财务/法务/IT等），保险公司里这类岗位不可能是销售引流
  const HARD_PRO_FUNC = /(合规|风控|法务|财务|会计|审计|精算|核保|理赔|IT|信息技术|研发|数据分析|人力资源(经理|总监|主管)|人事(经理|总监|主管))/i;
  const hardProFunc = HARD_PRO_FUNC.test(title);
  const insCo = (insurerCo && !hardProFunc) || (genericFinCo && baitHit && !hardProFunc);
  if (insCo && baitHit) {
    negatives.push(`疑似销售引流岗（${company.replace(/有限公司.*/, '')}·保险/金融类，JD 含销售话术）`);
  } else if (insCo && !strongHrInFin) {
    negatives.push(`疑似销售引流岗（${company.replace(/有限公司.*/, '')}·保险/金融类，标题「${title.slice(0, 14)}」非专业HR岗）`);
  } else if (insCo && (INSURANCE_BAIT.test(title) || /销售|业绩|客户经理|筹备主管|优才/i.test(title))) {
    negatives.push(`疑似销售岗（${company.replace(/有限公司.*/, '')}·保险/金融类）`);
  }

  // 标题方向校验：标题未命中目标职能 → 不推荐
  const titleHit = TARGET_TITLE.test(title);
  if (!titleHit) {
    negatives.push(`岗位方向不符（标题：${title.slice(0, 20)}）`);
  }
  // 管培生方向校验：外贸/销售/营销管培生不属于HR行政方向
  if (/管培|储备干部/.test(title) && !/人力资源|人力|人事|行政|hrbp|hr/i.test(title)) {
    negatives.push(`管培方向不符（${title.slice(0, 20)}）`);
  }

  // 客服/销售职能（非HR方向）
  if (/客服/.test(title)) penalties.push({ k: '客服职能（非HR/行政方向）', v: -20 });
  if (/销售/.test(title)) penalties.push({ k: '销售职能', v: -30 });

  // ================================================================
  // 评分标准（v2）：基准分 50 + 加分（上限 70）+ 减分
  //   有档次的标准按 0～10 计分；无档次的标准按 0 或 5 计分
  // ================================================================

  // ---------- 加分①：品牌企业 / 知名企业 + 游戏、日化行业 + 规模超500人 ----------
  const brandHit = BRAND.test(company);
  if (brandHit) bonuses.push({ k: '品牌/知名企业', v: 8 });

  const industryField = `${job.industry || ''} ${company}`;
  const industryHit = INDUSTRY_BONUS.test(industryField) || INDUSTRY_BONUS.test(title);
  // "游戏/日化"最高一档：行业字段 / 公司名命中，或标题明确写了游戏日化
  const industryStrong = INDUSTRY_STRONG.test(industryField) || INDUSTRY_STRONG.test(title);
  if (industryHit) bonuses.push({ k: industryStrong ? '游戏/日化行业' : '快消/食品饮料行业', v: industryStrong ? 10 : 5 });

  if (scale.bonus > 0) bonuses.push({ k: `公司规模${scale.band}（${scale.label}）`, v: scale.bonus });

  // ---------- 加分②：双休制 / 弹性打卡（有档次，各 0～10；未提及不加分）----------
  const restBonus = { 双休: 10, 大小周: 2, 排班轮休: 0, 单休: 0 }[sched.rest] ?? 0;
  if (restBonus > 0) bonuses.push({ k: `作息：${sched.rest}`, v: restBonus });
  if (sched.flexible === '是') bonuses.push({ k: '弹性打卡', v: 10 });

  // ---------- 加分③：餐补 / 交补 / 包吃 / 包住 / 下午茶（有档次，0～10）----------
  let wel = extractWelfare(text);
  if (!Object.keys(wel).length) wel = extractWelfare(textAll);   // JD 未提及福利 → 参考发布标签
  const CARE = ['餐补/包吃', '交通补贴', '包住/房补', '下午茶'];
  const careHit = CARE.filter((k) => wel[k]);
  if (careHit.length) bonuses.push({ k: `关怀福利：${careHit.join('、')}`, v: Math.min(careHit.length * 4, 10) });

  // ---------- 加分④：薪资 7k＋（无档次，0 或 5）----------
  const salMin = job.salaryMinNum ?? parseSalaryMin(job.salaryText);
  if (salMin !== null && salMin >= 7000) bonuses.push({ k: `薪资7k+（${job.salaryText}）`, v: 5 });
  else if (salMin !== null && salMin < 7000 && salMaxNum !== null && salMaxNum < 7000) penalties.push({ k: `薪资偏低（${job.salaryText}）`, v: -6 });

  // ---------- 加分⑤：工作地点在广州 / 佛山（无档次，0 或 5）----------
  const city = job.city || '';
  if (/广州|佛山/.test(city)) bonuses.push({ k: `地点：${city}`, v: 5 });

  // ---------- 加分⑥：工作内容为多个模块（有档次，0～5）----------
  // 口径按用户指定：规划 / 招聘 / 培训 / 薪酬 / 绩效 / 员关 / 行政 / BP
  // 只依据 JD 正文的实际工作内容（任职要求/福利段不计），与看板标签同源
  const modWeightsMap = modWeights(jd);
  const modHit = MODULES.map((m) => m.label).filter((k) => modWeightsMap[k] > 0);
  if (modHit.length >= 3) bonuses.push({ k: `多模块（${modHit.slice(0, 5).join('/')}）`, v: 5 });
  else if (modHit.length === 2) bonuses.push({ k: `双模块（${modHit.join('/')}）`, v: 3 });

  // ---------- 加分⑦：岗位是 HRBP / HR管培生（无档次，0 或 5）----------
  const bpHit = isBpOrMt(title, roleHit ? roleHit.key : '');
  if (bpHit) bonuses.push({ k: '岗位方向：HRBP / HR管培生', v: 5 });

  // ---------- 加分⑧：接受应届生（无档次，0 或 5）----------
  if (freshOk) bonuses.push({ k: '接受应届生', v: 5 });

  // ---------- 加分⑨：岗位一周内新发布（无档次，0 或 5）----------
  let daysAgo = null;
  if (job.publishTime) {
    const d = new Date(String(job.publishTime).replace(/-/g, '/'));
    if (!isNaN(d)) {
      daysAgo = Math.floor((now - d) / 86400000);
      if (daysAgo <= 7) bonuses.push({ k: `一周内新发布（${daysAgo}天前）`, v: 5 });
      else if (daysAgo <= 14) bonuses.push({ k: `两周内发布（${daysAgo}天前）`, v: 2 });
      else if (daysAgo > 60) penalties.push({ k: `发布较久（${daysAgo}天前）`, v: -3 });
    }
  }

  // ---------- 减分②：大小周 / 单休 / 排班轮休（有档次，0～-10）----------
  if (sched.rest === '大小周') penalties.push({ k: '大小周（非双休）', v: -3 });
  else if (sched.rest === '排班轮休') penalties.push({ k: '排班轮休（非双休）', v: -6 });
  else if (sched.rest === '单休') penalties.push({ k: '单休（非双休）', v: -8 });

  // ---------- 减分④⑤：乙方公司 / 第三方派遣（无档次，0 或 -12）----------
  const agencyHit = isAgency(company, jd, title);
  if (agencyHit) penalties.push({ k: '乙方/外包/派遣公司', v: -12 });

  // ---------- 减分①：岗位工作 80% 以上是招聘（无档次，0 或 -15）----------
  if (isRecruitHeavy(title, jd)) penalties.push({ k: '招聘工作占比≥80%（招聘专员类）', v: -15 });

  // ================================================================

  // ---------- 实习岗 / 非2026届（明确面向在校生）→ 过滤 ----------
  // 注意：标题看不出来但 JD 写明的也算（实测"互联企信·人事招聘专员"JD 开头即"不是应届生岗位！！实习岗位！！"）
  const internTitle = /(实习生|intern|在校生|27届|28届|2027届|2028届|大[一二三四]在校|研[一二]在读)/i.test(title);
  const internJd = /(不是应届生|非应届生|仅限在校|只招在校|在校生优先|实习生岗位|实习岗位|本岗位为实习|属实习岗|招聘实习生|2027届|2028届|27届|28届|2027年毕业|2028年毕业|大一|大二|大三在读|研一在读|研二在读|需实习\d|实习\d个月以上|要求实习)/.test(jd);
  const canConvert = /(可转正|转正机会|表现优异.{0,6}转正|实习转正)/.test(jd);
  // 豁免：JD 明确同时面向 2026 届（如"面向对象：2026-2027届"），说明是正规校招而非实习生岗
  const alsoGraduates2026 = /(2026\s*(?:[-–—~～]|至|到|、|\/)\s*2027\s*届|2026届及以后|2026届应届|2026届毕业生|2026年应届|应往届|往应届)/.test(jd);
  if ((internTitle || internJd) && !canConvert && !alsoGraduates2026) {
    negatives.push('实习/非应届届别岗位（明确面向在校生或非2026届）');
  }

  // ---------- 招聘平台/信息科技类公司（多为RPO乙方）----------
  if (/(直聘网|招聘网|人才网|信息科技|信息技术|网络科技|科技服务)/.test(company) &&
      /(招聘|邀约|人事|人力资源)/.test(title) &&
      !/(游戏|软件|电子|生物|医药|制造|实业|集团)/.test(company)) {
    penalties.push({ k: '疑似招聘平台/RPO类公司', v: -20 });
  }

  // ---------- 引流话术（"可小白""不限经验""高提成"等，多为低质/销售引流岗）----------
  if (/(可小白|轻松上手|无经验可|接受小白|接受无经验|高提成|无责定薪|邀约专员|轻松|包吃住|吃住)/.test(title) &&
      /(人事|招聘|行政|客服|邀约)/.test(title)) {
    penalties.push({ k: '标题含引流话术（低质/销售引流岗特征）', v: -20 });
  }

  // 计算：基准 50 + 加分（封顶 70，即总分上限 100）+ 减分
  const bonusRaw = bonuses.reduce((s, b) => s + b.v, 0);
  const bonusCap = Math.min(bonusRaw, 70);
  if (bonusRaw > 70) bonuses.push({ k: `加分封顶（原始 ${bonusRaw} → 70）`, v: 70 - bonusRaw });
  score += bonusCap;
  for (const p of penalties) score += p.v;
  // 过滤项严重扣分，确保沉底
  score -= negatives.length * 25;

  // 判定（评分标准 v2：基准 50、上限 100；「推荐岗位」门槛 = 80 分）
  const verdict = verdictOf(score, penalties, negatives);

  return {
    ...job,
    platform,
    score: Math.max(0, Math.round(score)),
    verdict,
    negatives,
    penalties,
    bonuses,
    schedule: sched,
    welfare: Object.keys(wel),
    welfareCare: careHit,
    modules: modHit,
    moduleWeights: modWeightsMap,
    bp: isBpOrMt(title, roleHit ? roleHit.key : ''),
    scoreBase: 50,
    bonusRaw,
    bonusCap,
    freshOk,
    effectiveExp,
    daysAgo,
    roleKey: roleHit ? roleHit.key : (OFF_TARGET.test(title) ? '不相关' : '其它'),
    jobDescFull: jd,
  };
}

// ============ 加载数据 ============
function loadZhilian() {
  const listPath = path.join(DATA, 'zhilian-list.json');
  if (!fs.existsSync(listPath)) return [];
  const list = JSON.parse(fs.readFileSync(listPath, 'utf8'));
  // 详情（可选）
  let details = {};
  const dPath = path.join(DATA, 'zhilian-detail.json');
  if (fs.existsSync(dPath)) {
    const d = JSON.parse(fs.readFileSync(dPath, 'utf8'));
    for (const x of d) {
      const k = x.positionNumber || x.number;
      if (k) details[k] = x;
    }
  }
  return list.map((x) => {
    const det = details[x.number] || {};
    const hasDetail = !!det.jd;
    return {
      id: String(x.number || x.jobId || ''),
      title: det.name || x.name || '',
      company: det.companyName || x.companyName || '',
      salaryText: det.salary || x.salary60 || x.salaryReal || '',
      city: det.workCity || x.workCity || '',
      district: det.cityDistrict || x.cityDistrict || '',
      // 详情页发布时间更准，其次列表页
      publishTime: det.publishTime || x.publishTime || '',
      workYear: det.workingExp || x.workingExp || '',
      degree: det.education || x.education || '',
      companySize: det.companySize || x.companySize || '',
      industry: det.industryName || x.industryName || '',
      url: det.zlUrl || x.positionURL || '',
      tags: (x.jobSkillTags || []).map((t) => t.name || t),
      welfareFromPost: [...(det.welfareLabel || []), ...(det.welfareTags || [])],
      jd: String(det.jd || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim(),
      hasDetail,
    };
  });
}

function load51job() {
  const p = path.join(DATA, '51job-list.json');
  if (!fs.existsSync(p)) return [];
  return JSON.parse(fs.readFileSync(p, 'utf8')).map((x) => ({
    id: x.jobId,
    title: x.title,
    company: x.company,
    salaryText: x.salaryText,
    salaryMinNum: x.salaryMin,
    city: x.city,
    district: x.district,
    publishTime: x.publishTime,
    workYear: x.workYear,
    degree: x.degree,
    companySize: x.companySize,
    industry: x.industry,
    url: x.url,
    tags: x.jobTags || [],
    welfareFromPost: [...(x.welfareCodes || []), ...(x.sesameLabels || [])],
    jd: x.jobDescribe || '',
    hrName: x.hrName,
    hrOnline: x.hrOnline,
    hasDetail: true,
  }));
}

// ============ 主流程 ============
const now = new Date();
const out = { generatedAt: now.toISOString(), profile: PROFILE, platforms: {} };

for (const [key, label, loader] of [['zhilian', '智联招聘', loadZhilian], ['51job', '前程无忧', load51job]]) {
  const raw = loader();
  if (!raw.length) { console.log(`⬜ ${label}: 无数据`); continue; }
  let scored = raw.map((j) => scoreJob(j, label, now)).sort((a, b) => b.score - a.score);

  // ---- 公司级刷屏检测：同一家公司在HR/行政类岗位上挂>5条 → 判定为招聘工厂/BPO ----
  const byCo = new Map();
  for (const x of scored) {
    const k = String(x.company || '').trim();
    if (!k) continue;
    if (!byCo.has(k)) byCo.set(k, []);
    byCo.get(k).push(x);
  }
  let spamCo = 0;
  for (const [co, arr] of byCo) {
    if (arr.length > 5 && arr.some((x) => /(招聘|直聘|人力|人才|咨询|企业管理|服务)/.test(co))) {
      spamCo++;
      for (const x of arr) {
        x.negatives.push(`公司疑为招聘工厂/BPO（在HR行政类岗位挂出 ${arr.length} 条）`);
        x.penalties.push({ k: '公司级刷屏', v: -20 });
      }
    }
  }
  scored.sort((a, b) => (b.score - b.negatives.length * 25) - (a.score - a.negatives.length * 25));
  // 重新计算最终判定（公司级惩罚会改变结果；分数本身已在 scoreJob 内扣过过滤项）
  for (const x of scored) {
    x.score = Math.max(0, Math.round(x.score));
    x.verdict = verdictOf(x.score, x.penalties, x.negatives);
  }
  if (spamCo) console.log(`  ⚠ 识别到 ${spamCo} 家招聘工厂/BPO公司`);
  // ---- 去重：同公司+同标题只保留最高分的一条（记录重复次数）----
  const seenKey = new Map();
  const deduped = [];
  for (const x of scored) {
    const k = `${x.company}|${x.title}`.replace(/\s+/g, '');
    if (seenKey.has(k)) { seenKey.get(k).dupCount++; continue; }
    x.dupCount = 1;
    seenKey.set(k, x);
    deduped.push(x);
  }
  const dupRemoved = scored.length - deduped.length;
  scored = deduped;

  // ---- 统一截取：每个平台最多保留 500 条（按最终分降序，保证推荐岗位优先入选）----
  const CAP = Number(process.env.CAP || 500);
  scored.sort((a, b) => {
    const an = a.negatives.length ? 1 : 0, bn = b.negatives.length ? 1 : 0;
    return (an - bn) || (b.score - a.score);
  });
  const capped = scored.length > CAP;
  if (capped) scored = scored.slice(0, CAP);

  const rec = scored.filter((x) => x.verdict !== '不推荐');
  const rej = scored.filter((x) => x.verdict === '不推荐');  out.platforms[key] = { label, total: scored.length, recommended: rec.length, rejected: rej.length, jobs: scored };
  fs.writeFileSync(path.join(DATA, `scored-${key}.json`), JSON.stringify(scored, null, 1), 'utf8');
  console.log(`\n=== ${label}：原始 ${raw.length} → 去重后 ${dupRemoved + scored.length}${capped ? ` → 按分截取前 ${CAP}` : ''}（移除同岗重复 ${dupRemoved}）| 推荐 ${rec.length} | 不推荐 ${rej.length} ===`);
  const dist = {};
  for (const x of scored) dist[x.verdict] = (dist[x.verdict] || 0) + 1;
  console.log(`  判定分布: ${Object.entries(dist).map(([k, v]) => `${k} ${v}`).join(' | ')}`);
  console.log(`  过滤项命中: ${Object.entries(
    rej.flatMap((x) => x.negatives).reduce((a, n) => { const k = n.replace(/（.*/, ''); a[k] = (a[k] || 0) + 1; return a; }, {})
  ).map(([k, v]) => `${k} ${v}`).join(' | ')}`);
  console.log(`  Top 10:`);
  rec.slice(0, 10).forEach((x, i) => {
    console.log(`   ${String(i + 1).padStart(2)}. [${x.score}] ${x.title} | ${x.company} | ${x.salaryText} | ${x.city} | ${x.verdict}${x.dupCount > 1 ? ` (×${x.dupCount})` : ''}`);
  });
}

fs.writeFileSync(path.join(DATA, 'dashboard-data.json'), JSON.stringify(out, null, 1), 'utf8');
console.log(`\n✅ 已写出 data/dashboard-data.json`);
