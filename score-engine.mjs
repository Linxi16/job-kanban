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
 *   【过滤】单休、20-99人、乙方公司、第三方派遣、经验下限≥2年、实习/非2026届
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
// 注意：管培生只认"管培/储备干部/管理培训生"，不能写裸词"培训生"——
//       否则"供应链管理培训生""销售管理培训生"会被当成方向命中（实测百事供应链管培 74 分进过看板）。
// BP 分两类：HR 线（HRBP / 招聘BP / 组织BP / 人力BP）算目标方向；
//            非 HR 线（财经BP/业务BP/财务BP/采购BP…）用负向预查排除。
const TARGET_TITLE = /hrbp|hr\s*bp|人力资源|人力专员|人事|行政|部门助理|业务助理|运营助理|总裁助理|总经理助理|总监助理|管培|储备干部|管理培训生|招聘(专员|助理|运营|主管|经理)|员工关系|薪酬|绩效|培训(专员|主管)|组织发展|企业文化|综合(专员|助理|管理)|文员|秘书|前台|办公室助理|办公助理|办公文员|共享服务|ssc|内勤|总务|后勤/i;
// 标题里的 BP：HR 线（HRBP/招聘BP/组织BP/人力BP）算目标方向；
// 非 HR 线（财经BP/业务BP/财务BP/采购BP/销售BP…）不算。
// 用两步判定而不是负向预查——"财务BP(总经理助理）"会被"总经理助理"命中而绕过预查。
const BP_IN_TITLE = /(^|[^a-z])bp/i;
const BP_NON_HR = /(财经|业务|财务|采购|销售|市场|产品|数据|技术|战略|投资|供应链|物流|渠道|电商|品牌|营销|客户|质量|生产|工程|研发|项目|法务|风控|审计|人力资本)\s*bp/i;
const BP_HR_LINE = /(hr|招聘|人力|人事|行政|组织|员工|薪酬|绩效|培训|文化)[^，。；\n]{0,4}bp/i;
/** 标题是否属于"BP 线"的目标方向（非 HR 线的 BP 要排除） */
function bpTitleHit(title) {
  const t = String(title || '');
  if (!BP_IN_TITLE.test(t)) return false;
  if (BP_NON_HR.test(t) && !BP_HR_LINE.test(t)) return false;
  return true;
}

// 明确属于"别的职能"的方向词（出现在标题里且无 HR/行政 锚点 → 方向不符）
const OFF_DIRECTION_WORD = /供应链|物流|仓储|关务|采购|外贸|跨境电商|销售|营销|市场|电商|新媒体|客服|财务|会计|出纳|审计|法务|风控|生产|制造|品质|工艺|设备|研发|软件|测试|运维|设计|美工|工程|安全|环境|商务|招商|门店|导购/i;
// HR / 行政 方向的锚点词。注意不要放裸词或含裸字——"培训生"是管培标记不是职能锚点，
// "运营培训生""技术培训生"都会因它被误判成 HR 方向。只保留本身就是 HR·行政 职能的词。
const HR_ANCHOR_TITLE = /hrbp|hr\s*bp|人力资源|人力|人事|行政|员工关系|薪酬|绩效|培训(专员|主管|经理|岗)|招聘|组织发展|企业文化|文员|秘书|前台|共享服务|ssc|内勤|总务|后勤|办公室助理|办公助理|办公文员/i;

// 任何"职能信息"词（HR/行政之外的职能也算）。用于区分两种完全不同的"方向不符"：
//   · 标题含别的职能词（供应链/销售/客服…）→ 真的是方向不对
//   · 标题一个职能词都没有（"上5休2/近地铁/五险一金"）→ 是无职能信息的纯引流标题
const ANY_FUNCTION_WORD = /hrbp|hr\b|人力资源|人力|人事|行政|招聘|员工关系|薪酬|绩效|培训|组织|文化|文员|秘书|前台|助理|管培|储备|内勤|后勤|总务|管理|运营|销售|市场|客服|财务|会计|采购|供应链|物流|仓储|生产|车间|品质|质检|技术|研发|工程|设计|电商|新媒体|商务|招商|门店|导购|医生|护士|教师|助教|法务|风控|审计|司机|保安|保洁|仓管|跟单|报关|关务/i;

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

/**
 * 经验年限「区间」的分隔符集合 —— 平台/JD 里出现过的全部写法：
 *   半角 -  波浪 ~ ～  汉字 至/到  连接号 – (U+2013)  破折号 — (U+2014)  不换行连字符 ‑ (U+2011)
 * 注意**不能**把「、」「.」「）」当区间符：那是列表编号分隔（"2、1年以上"= 第2条要求1年），
 * 混进来会把"第2条 1年"误读成区间"2-1年"，从而把门槛算错。
 */
const EXP_RANGE_SEP = '[\\-~～—–‑至到]';

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

/**
 * 把 JD 切成「岗位职责 / 任职要求 / 其他」三段。
 *
 * 为什么要切：「校园招聘工作」「负责校招事宜」是**职责**（你要干的活），
 * 不代表**招收对象**是应届生。实测「人事专员（培训方向）」因职责里出现"校招"
 * 被误判为接受应届生（+5 分，还顺带免掉"经验>1年"的扣分），而它的任职要求
 * 明写"3年以上相关工作经验"。切段后只在「任职要求」段判定。
 */
function splitJdSections(jd) {
  const t = String(jd || '');
  const dutyRe = /(岗位职责|工作职责|职位描述|工作内容|职责描述|主要职责|岗位说明|职位职责|工作范围|你将负责|你要做)/;
  const reqRe = /(任职要求|任职资格|岗位要求|职位要求|人员要求|应聘要求|招聘要求|任职条件|资格要求|我们希望你|我们需要你|岗位条件|教育背景|任职需求)/;
  // 要求段的终止标题：福利/待遇/作息/联系方式等一旦出现，就不再属于"任职要求"。
  // （否则"福利待遇：应届毕业生到岗可报销路费"会被算进要求段，当成招收声明。）
  const tailRe = /(福利待遇|薪酬福利|福利|待遇|薪资待遇|公司福利|员工福利|我们提供|我们能给|你将获得|联系方式|简历投递|投递方式|工作地点|工作时间|上班时间|面试地址|备注|加分项|其他说明)/;

  // 标题形态：行首（可带空格）或紧跟在"一、/二./1、/(一)"这类序号之后。
  // 为什么必须这样判：职责正文里常出现"梳理各岗位任职资格、岗位说明书"这类**引用**，
  // 直接取首个匹配会把要求段的起点锚在职责文本中间，导致真正的"二、任职要求"
  // 被当成正文、要求段被截空，经验门槛只能回落到发布信息。
  // 实测漏网：安徽帮益把「人事专员」的"3 年及以上企业独立招聘经验"因此完全没被读到。
  const isHeadingAt = (idx, re) => {
    const m = re.exec(t.slice(idx));
    if (!m || m.index !== 0) return false;
    const lineStart = t.lastIndexOf('\n', idx - 1) + 1;
    const before = t.slice(lineStart, idx);
    if (/^[ \t\u00a0\u3000]*$/.test(before)) return true;                  // 行首
    return /[一二三四五六七八九十\d]{1,3}\s*[、.．)）]\s*$/.test(before); // "二、" / "1."
  };
  /** 优先取「标题形态」的首次出现；没有标题形态才退回首次出现 */
  const pickHeading = (re) => {
    const g = new RegExp(re.source, 'g');
    let m;
    const hits = [];
    while ((m = g.exec(t))) hits.push(m.index);
    if (!hits.length) return -1;
    const head = hits.find((i) => isHeadingAt(i, re));
    return head !== undefined ? head : hits[0];
  };

  const di = pickHeading(dutyRe);
  const ri = pickHeading(reqRe);
  if (ri < 0) return { duty: di >= 0 ? t.slice(di) : '', req: '', hasReqSection: false };
  // 职责段从职责标题到要求标题（或到文末）
  const duty = di >= 0 && di < ri ? t.slice(di, ri) : '';
  // 要求段从要求标题开始，到下一个「职责标题 / 终止标题 / 文末」为止
  let reqEnd = t.length;
  const rest = t.slice(ri + 4);
  const stops = [];
  const nd = rest.match(dutyRe);
  if (nd) stops.push(nd.index);
  const nt = rest.match(tailRe);
  if (nt) stops.push(nt.index);
  if (stops.length) reqEnd = ri + 4 + Math.min(...stops);
  return { duty, req: t.slice(ri, reqEnd), hasReqSection: true };
}

/**
 * 抽取 JD 里的**最低**经验年限（准入下限）。
 *
 * 关键：要求是**分条**写的，条与条之间是"且"的关系，条内"或"才是可选。
 *   · "2年以上制造业招聘经验，1年以上海外岗位招聘经验" → 两条都要 → 门槛 2（不是 1）
 *   · "3年以上人事行政工作经验，其中1年以上制造业经验" → 第二条是"其中"细分 → 门槛 3
 *   · "5-7年HRBP工作经验，1年以上HR团队管理经验"        → 门槛 5
 *   · "1-3年招聘或猎头经验"                              → 条内"或" → 门槛 1
 *   · "1年以上招聘经验（主管岗需3年以上）"               → 主管岗是替代路径 → 门槛 1
 *
 * 所以算法是：**先按条取下限，再取条间最大值**；条内多个候选（"或"/"、"并列）
 * 取最小值，这样"或"的可选关系不会被误当成"且"。
 *
 * 早先的实现是把整段所有数字取一个 min，于是"2年以上"总被旁边的"1年以上"
 * 稀释成 1 年（线上真实漏网：彩讯科技 HRBP 写了"2年以上HRBP经验，至少1年互联网
 * 行业背景"，被读成 1 年 → 83 分进推荐档）。
 */
function extractMinYearsFromJd(text) {
  const t = String(text || '');
  if (!t.trim()) return null;

  // 单个候选里取"最低年限"：区间取下限，"3年以上"取 3
  const CAND = new RegExp(
    '(\\d+)\\s*' + EXP_RANGE_SEP + '\\s*\\d+\\s*年'                 // "1-3年" / "2–4年"（区间取下限）
    + '|(\\d+)\\s*年\\s*(?:及|以)?\\s*(?:以上|起|前)'                // "2年以上" / "2年及以上"
    + '|(\\d+)\\s*年\\s*(?:以下|以内)'                              // "1年以下"
    + '|(\\d+)\\s*年\\s*(?:以上\\s*)?(?:相关)?(?:工作)?经验'         // "2年经验" / "2年以上相关工作经验"
    + '|(?:满|需|要求|至少)\\s*(\\d+)\\s*年',                        // "满2年" / "至少2年"
    'g',
  );
  const floorOfClause = (clause, useRange) => {
    const g = new RegExp(CAND.source, 'g');
    const nums = [];
    let m;
    while ((m = g.exec(clause))) {
      const v = m.slice(1).find((x) => x != null);
      if (v != null) nums.push(Number(v));
    }
    if (!nums.length) return null;
    // 区间型（"1-3年"）本身已取下限，无歧义
    if (useRange && nums.length === 1) return nums[0];
    return Math.min(...nums);
  };

  // "其中N年以上X经验"是**前一条的细分约束**（"3年以上人事经验，其中1年以上制造业经验"），
  // 不是可选路径，不能参与取最小；它写的年限只会更高，去掉不影响门槛。
  // 真正的可选路径（"1-3年招聘或猎头经验"）在**同一条内**，仍走下面的 min。
  const t2 = t.replace(/[，,]\s*(?:其中|且|并)[^，,。；;\n]{0,12}?\d+\s*年[^，,。；;\n]{0,14}/g, '');

  // 按"条"切分：换行 / 分号 / 条列编号（"，2、"）/ 并列年限条件（"，1年以上管理经验" "/ "，至少1年…"）
  const clauses = t2
    .split(/[\n\r；;]+/)
    .flatMap((x) => x.split(/[，,]\s*(?=\d+\s*[、.．)）]|(?:至少|满|需|要求)\s*\d+\s*年|\d+\s*年)/))
    .map((x) => x.trim())
    .filter(Boolean);

  const floors = [];
  for (const c of clauses) {
    const f = floorOfClause(c, true);
    if (f !== null) floors.push(f);
  }
  if (!floors.length) {
    const f = floorOfClause(t, false);
    return f;
  }
  return Math.max(...floors);
}

/**
 * 判定岗位是否真的「接受应届生」。
 *
 * 信息索引原则：**先看 JD，JD 未提及才看发布信息，冲突时以 JD 为准。**
 * 判定优先级：
 *   ① JD 明确"不招应届"            → 一票否决
 *   ② JD 明确"接受应届/应届可投"    → 加分（"优秀应届毕业生可酌情考虑"也算）
 *   ③ JD 任职要求段要求 ≥1 年经验   → 不加分（JD 优先，无视发布信息怎么写）
 *   ④ JD 要求段没写年限，发布信息标"经验不限" → 加分（兜底）
 *   ⑤ 都没提                        → 不加分（宁可漏加，不可错加）
 *
 * 关键教训：「校园招聘工作」「校招事宜」是**职责**（你要干的活），不是招收对象。
 * 实测「人事专员（培训方向）」职责段写校招、任职要求写"3年以上经验"，
 * 旧逻辑却给了"接受应届生 +5"，正好违反"以 JD 为准"。
 */
function detectFreshOk(jd, title, expLabelYears, log) {
  const t = String(jd || '');
  const { req, hasReqSection } = splitJdSections(t);
  const titleStr = String(title || '');

  // 否定：明确不招应届生 → 绝不算加分
  const NEG_FRESH = /(不招|不收|谢绝|勿投|非|不要)[^。；;\n]{0,6}(应届|在校生)|应届生?[^。；;\n]{0,4}(勿投|免投|勿扰)/i;
  if (NEG_FRESH.test(t)) {
    if (log) log.push('应届加分被拦截：JD 明确不招应届生');
    return false;
  }

  // ② JD 明确接受应届。范围遵守"以 JD 为准"的取数纪律：
  //    ── 有任职要求段时，"应届毕业生"这类**宽口径**词只在要求段内算数。
  //       否则福利条款里一句"应届毕业生到岗报到时可报销路费"（讲的是报销，不是招收对象）
  //       会把整个岗位判成接受应届。
  //    ── 全文/标题兜底只认**强招收措辞**（接受应届/欢迎应届/应届优先…），
  //       这类词几乎不可能出现在福利文案里。
  const BROAD = /接受应届|应届(?=[，。；、,;\s]|$)|应届[^。；;\n]{0,6}(优先|亦可|可投|欢迎|均可)|欢迎应届|优秀应届|招聘应届|应届毕业生|无经验(可|亦)/i;
  const STRONG_ONLY = /接受应届|欢迎应届|应届[^。；;\n]{0,6}(优先|亦可|可投|均可)|优秀应届|招聘应届|无经验(可|亦)/i;
  const scopeText = hasReqSection ? req : t;
  let hit = scopeText.match(BROAD);
  let where = hasReqSection ? '（任职要求段）' : '（JD 全文，无要求段）';
  if (!hit) {
    hit = t.match(STRONG_ONLY) || titleStr.match(STRONG_ONLY);
    if (hit) where = '（JD 全文·强招收措辞）';
  }
  if (hit) {
    if (log) log.push(`接受应届生：JD 明确"${hit[0]}"${where}`);
    return true;
  }

  // ③ 经验年限：JD 任职要求段优先，JD 未提及才看发布信息
  const expRes = resolveExpYears(t, expLabelYears);
  if (expRes.years !== null && expRes.years >= 1) {
    if (log) {
      const detail = expRes.source === 'JD任职要求'
        ? `JD任职要求=${expRes.years}${expRes.conflict ? `（发布信息=${expLabelYears}，以 JD 为准）` : ''}`
        : `JD未提及，采信发布信息=${expLabelYears}`;
      log.push(`应届加分被拦截：要求 ≥${expRes.years} 年经验（${detail}）`);
    }
    return false;
  }

  // ④ JD 没提年限 → 采信平台侧声明："经验不限"（expFromLabel 返回 -1）
  if (expLabelYears === -1) {
    if (log) log.push('接受应届生：JD 未提年限，采信发布信息"经验不限"');
    return true;
  }

  if (log) log.push('未提及是否能接受应届生 → 不加分');
  return false;
}

/**
 * 统一的信息索引口径（用户指定）：
 *   **先看 JD 内容，JD 未提及才参考发布信息；两者冲突时以 JD 为准。**
 *
 * 因此所有"JD 侧取值"都必须限定在**任职要求段**内。
 * 职责段里的"N年"是别的意思（"维护3年以上老客户""制定五年规划"），
 * 拿它当经验门槛就违背了"以 JD 为准"。
 *
 * scope='req'  → JD 任职要求段写了年限，采信它（JD 优先）
 * scope='none' → JD 要求段没写年限（或整篇无要求段），交给发布信息兜底
 */
function jdYearsOf(jd) {
  const t = String(jd || '');
  const { req, hasReqSection } = splitJdSections(t);
  if (!hasReqSection) return { years: null, scope: 'none' };
  const y = extractMinYearsFromJd(req);
  return { years: y, scope: y === null ? 'none' : 'req' };
}

/**
 * 经验门槛（年）的唯一取数口径：
 *   ① JD 任职要求段写明年限 → 用 JD 的（JD 优先，冲突时以 JD 为准）
 *   ② JD 要求段没写        → 用发布信息标签
 *   ③ 都没有                → null（不设门槛）
 *
 * 取的是**最低年限**（准入下限）："1-3年" → 1 年也能投。
 */
function resolveExpYears(jd, expLabelYears) {
  const jdRes = jdYearsOf(jd);
  if (jdRes.scope === 'req' && jdRes.years !== null) {
    return { years: jdRes.years, source: 'JD任职要求', conflict: expLabelYears !== null && expLabelYears !== jdRes.years };
  }
  return { years: expLabelYears, source: expLabelYears === null ? null : '发布信息', conflict: false };
}

/**
 * 是否超出校招应届生的经验范围（用户口径）：
 *   · 1年以内、1～3年  → 不算超范围（下限 ≤1 能覆盖）
 *   · 明确要求 2年以上（下限 ≥2，如"2~3年""3~5年""2年以上"）→ 超范围
 *   · JD 提及"接受应届生 / 接受无经验" → 豁免
 * expResult 来自 resolveExpYears()，其 years 已是"最低年限"。
 */
function expIsOutOfRange(freshOk, expResult) {
  if (freshOk) return false;
  return expResult.years !== null && expResult.years >= 2;
}

/**
 * 岗位发布信息里的经验要求 → 年数（-1 表示不限，null 表示未知）
 *
 * 口径必须是**准入下限**，与 JD 侧 extractMinYearsFromJd 保持一致：
 *   "1-3年" → 1（1 年经验就能投 → 不超范围）
 *   "2-3年"/"3-5年"/"2年以上" → 2/3/2（下限定在 2 以上 → 超范围）
 * 早先这里返回的是**区间上限**（"1-3年"→3），导致发布信息写"1-3年"的岗位
 * 被误判为"要求 3 年经验"而整批拦掉，与用户口径"1～3年也算"直接冲突。
 */
function expFromLabel(label) {
  const s = String(label || '');
  if (!s) return null;
  // 注意：「经验不限」「不限经验」必须先于数字兜底判定
  if (/经验不限|不限经验|不限|无要求|无经验/.test(s)) return -1;
  if (/1年以下|一年以下|应届/.test(s)) return 0;
  if (/1-3年|1~3年|一至三年/.test(s)) return 1;
  if (/3-5年|3~5年|三至五年/.test(s)) return 3;
  if (/5-10年|5~10年/.test(s)) return 5;
  if (/10年以上/.test(s)) return 99;
  if (/2年/.test(s)) return 2;
  const m = s.match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

/**
 * 薪资串 → 「区间 + 口径」的统一解析。
 *
 * 口径（unit）有三类，都换算成**月薪（元）**再比较，否则无法和用户的 6k 门槛对齐：
 *   月薪：元 / 千 / 万 / k           —— "4.5-5.5千"、"9000-12000元"
 *   年薪：带"/年""每年""年薪"时 ÷12  —— "12-14万/年"（否则 25 万会被当成月薪 25 万）
 *   日薪：元/天 ÷  ── 按 21.75 个工作日/月 折算（劳动法月计薪天数）
 *   时薪：元/小时 ÷  ── 按 8 小时/天 × 21.75 天 折算
 *
 * 日薪/时薪必须折算再比：兼职岗"250 元/天"约合 5438 元/月，低于 6k 门槛；
 * 之前既不折算也解析不出（正则要求 4~6 位数字），结果**低薪兼职直接漏过薪资过滤**，
 * 还出现过"150-200元/天"被 4~6 位兜底读成 200000 的错值。
 */
function parseSalaryRange(text) {
  const s = String(text || '').trim();
  if (!s || /面议|谈判|薪资面议/.test(s)) return null;

  // 口径判定
  const isDaily = /\/\s*[天日]|元?\s*每\s*[天日]|天\s*薪/.test(s);
  const isHourly = /\/\s*(?:小时|时|h|H)|每小时|时\s*薪/.test(s);
  const isYear = /年薪|\/\s*年|每\s*年|年\s*薪/.test(s);
  const perMonth = isHourly ? 8 * 21.75 : isDaily ? 21.75 : 1;
  const perYear = isYear ? 12 : 1;
  // 统一换算因子：原始数字 → 月薪
  const conv = (n) => {
    if (isHourly || isDaily) return n * perMonth;
    return n / perYear;
  };

  // 单位权重（把不同单位统一成"元"）
  const U = '(万|千|[kK]|元)';
  const unitMul = (u) => (u === '万' ? 10000 : u === '千' ? 1000 : u === '元' ? 1 : 1000);

  // ① 区间 "a-b 单位"
  let m = s.match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*[-~～—–至到]\\s*(\\d+(?:\\.\\d+)?)\\s*${U}?`));
  if (m) {
    const mul = unitMul(m[3]);
    let lo = parseFloat(m[1]) * mul;
    let hi = parseFloat(m[2]) * mul;
    // 无单位时按数量级兜底：>=1000 视为元，否则视为千
    if (!m[3]) { if (lo < 1000 && !isDaily && !isHourly) lo *= 1000; if (hi < 1000 && !isDaily && !isHourly) hi *= 1000; }
    return { min: conv(lo), max: conv(hi) };
  }
  // ② 单一数值
  m = s.match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${U}`));
  if (m) {
    const v = parseFloat(m[1]) * unitMul(m[2]);
    return { min: conv(v), max: conv(v) };
  }
  // ③ 纯数字兜底
  m = s.match(/(\d+(?:\.\d+)?)/);
  if (m) {
    let v = parseFloat(m[1]);
    if (v < 1000 && !isDaily && !isHourly) v *= 1000;
    return { min: conv(v), max: conv(v) };
  }
  return null;
}

/**
 * 薪资 → 最高月薪（元）：用于「薪资低于 6k」过滤（区间上限都到不了 6k 才算低薪）
 */
function parseSalaryMax(text) {
  const r = parseSalaryRange(text);
  return r ? Math.round(r.max) : null;
}

/**
 * 薪资 → 最低月薪（元） */
function parseSalaryMin(text) {
  const r = parseSalaryRange(text);
  return r ? Math.round(r.min) : null;
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

/** 标题是否属于 HR / 行政方向（唯一口径，硬过滤与方向加分共用）
 *  规则：写了别的职能方向词（运营/产品/技术/供应链…）且没有 HR·行政锚点 → 不算；
 *        否则看是否有 HR·行政锚点。 */
function isHrAdminTitle(title) {
  const t = String(title || '');
  if (OFF_DIRECTION_WORD.test(t) && !HR_ANCHOR_TITLE.test(t)) return false;
  return HR_ANCHOR_TITLE.test(t);
}

/** 是否属于「HRBP / HR管培生」方向 */
function isBpOrMt(title, roleKey) {
  if (/招聘岗/.test(roleKey || '')) return false;
  const t = String(title || '');
  if (!isHrAdminTitle(t)) return false;               // 非 HR/行政方向：不加分，roleKey 也不能翻案
  if (/业务伙伴|bp|管培|储备干部|培训生/i.test(t)) return true;
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
  // 0) 地域：必须在广东省内
  //    前程无忧的 jobAreaString 是「招聘工作地 / 分公司所在地」，对集团批量招聘会取总部，
  //    例如中铁建工「人力资源管培生（广州）」city="北京·丰台区"，而 JD 第五节明写
  //    "分子公司及工作地点：5.中铁建工集团第五建设有限公司（广州）" —— 只看 city 会误杀。
  //    所以 city 不在广东时，再查标题括号里的地点（"（广州）""（深圳）"是平台标注的工作地）。
  //    城市名匹配用黑名单优先：广东城市名尾字常与外省撞车（"永州"含"惠州"的"州"、
  //    "苏州"含"州"），纯 includes 会把外省判成广东，所以先判外省地名。
  const GD_CITIES = ['广州', '深圳', '佛山', '东莞', '珠海', '中山', '惠州', '江门', '肇庆', '汕头', '湛江', '茂名', '韶关', '梅州', '汕尾', '河源', '阳江', '清远', '潮州', '揭阳', '云浮'];
  const NON_GD = /北京|上海|天津|重庆|苏州|南京|无锡|常州|徐州|南通|扬州|盐城|泰州|镇江|连云港|宿迁|淮安|杭州|宁波|温州|嘉兴|绍兴|金华|台州|湖州|丽水|衢州|舟山|合肥|芜湖|福州|厦门|泉州|漳州|南昌|济南|青岛|烟台|潍坊|临沂|淄博|济宁|泰安|威海|郑州|洛阳|武汉|宜昌|襄阳|长沙|株洲|湘潭|衡阳|岳阳|常德|永州|郴州|邵阳|益阳|娄底|怀化|张家界|湘西|成都|绵阳|德阳|宜宾|泸州|南充|贵阳|昆明|南宁|柳州|桂林|海口|三亚|沈阳|大连|鞍山|抚顺|吉林|长春|哈尔滨|大庆|齐齐哈尔|石家庄|唐山|保定|廊坊|沧州|邯郸|太原|大同|西安|咸阳|宝鸡|渭南|兰州|西宁|银川|乌鲁木齐|呼和浩特|拉萨|香港|澳门|台湾|湖南|湖北|江西|江苏|浙江|安徽|福建|山东|河南|河北|山西|陕西|甘肃|青海|辽宁|吉林|黑龙江|四川|贵州|云南|广西|海南|西藏|宁夏|新疆|内蒙古|驻柬埔寨|柬埔寨|海外|越南|泰国|印尼|马来西亚|新加坡/;
  const jobCity = String(job.city || '').trim();
  const gdIn = (s) => GD_CITIES.find((c) => String(s || '').includes(c)) || '';
  let cityResolved = NON_GD.test(jobCity) ? '' : gdIn(jobCity);
  if (!jobCity) {
    negatives.push('工作地点未标明');
  } else if (!cityResolved) {
    // 标题里的括号地点：必须紧跟在括号内且长度很短，避免"人力资源经理（湖南永州）"这种被判成广东
    const tm = String(title || '').match(/[（(]\s*([^）)]{2,8})\s*[）)]/g) || [];
    const titleGd = tm.find((x) => !NON_GD.test(x) && gdIn(x));
    if (titleGd) cityResolved = gdIn(titleGd);
    else negatives.push(`非广东省内（${jobCity}）`);
  }
  // 把解析结果落回 job，随评分行一起输出：
  //   job.city  = 平台原始值（前程可能是总部所在地，如"北京·丰台区"）
  //   cityResolved = 引擎最终采信的工作地（可能来自标题括号）
  // 输出它是为了让 audit-live.mjs 能核对"推荐档是否真在广东"，而不是自己再模糊匹配一遍。
  job.cityResolved = cityResolved;

  // 1) 经验要求（校招应届生门槛）
  //    信息索引口径：先看 JD（只看任职要求段），JD 未提及才看发布信息；冲突时以 JD 为准。
  //    门槛口径：只看**下限**。「1年以内 / 1～3年」放过（下限 ≤1 能覆盖）；
  //    「2年以上 / 2~3年 / 3~5年」这类下限 ≥2 的过滤。
  //    豁免：JD 明确接受应届生 / 接受无经验。
  const expLabelYears = expFromLabel(job.workYear);
  const freshLog = [];
  const freshOk = detectFreshOk(jd, title, expLabelYears, freshLog);
  const expRes = resolveExpYears(jd, expLabelYears);
  const expTooMuch = expIsOutOfRange(freshOk, expRes);
  if (expTooMuch) {
    // 展示口径同样以 JD 为准：JD 写了年限就标出来源，不显示发布信息的标签
    const showY = expRes.source === 'JD任职要求' && expRes.years !== null
      ? `${expRes.years}年·JD任职要求`
      : (job.workYear || `${expRes.years}年`);
    negatives.push(`经验要求超出校招范围（${showY}）`);
  }
  // 导出用：过滤判定所依据的经验年限（-1=不限，null=未标明）
  const effectiveExp = expRes.years;

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

  // ---------- 标题方向校验 ----------
  // 先算两个复用位：标题是否带"别的职能"方向词、是否带 HR/行政 锚点
  const offDirWord = OFF_DIRECTION_WORD.test(title);
  const hrAnchor = HR_ANCHOR_TITLE.test(title);

  // 标题未命中目标职能 → 不推荐（BP 线另算：HR 线 BP 放过，财经/业务 BP 不算）
  const titleHit = TARGET_TITLE.test(title) || bpTitleHit(title);
  if (!titleHit) {
    // 分两种口径，避免把"无职能信息的引流标题"误说成"方向不符"（实测 125 条：
    // "上5休2/近地铁/五险一金""300一天充电器打包长白班坐班"——它们根本没有岗位方向可言）
    if (!ANY_FUNCTION_WORD.test(title)) {
      negatives.push(`标题无职能信息（${title.slice(0, 20)}）`);
    } else {
      negatives.push(`岗位方向不符（标题：${title.slice(0, 20)}）`);
    }
  }
  // 管培生方向校验：外贸/销售/营销/供应链/运营管培生不属于HR行政方向
  // （"培训生"曾漏在这条之外，被上面的 TARGET_TITLE 白名单放行）
  // 笼统的「管培生」「储备干部」「海外管培生」不拦——用户求职方向本就含"管培生"。
  if (/管培|储备干部|培训生/.test(title) && offDirWord && !hrAnchor) {
    negatives.push(`管培方向不符（${title.slice(0, 20)}）`);
  }
  // 方向词兜底：标题出现"别的职能"方向词、且没有任何 HR/行政 锚点 → 方向不符
  // 例："百事集团2027年度供应链管理培训生""全能综合助理（兼新媒体与活动）"
  if (offDirWord && !hrAnchor) {
    negatives.push(`岗位方向不符（标题：${title.slice(0, 20)}）`);
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
  // 信息索引口径：以 JD 为准；JD **未提及的单项**才参考发布标签（逐项兜底，
  // 不是"JD 一项都没提才看发布信息"——那样 JD 只写餐补时会漏掉发布信息里的包住）。
  const wel = extractWelfare(text);
  const welFromLabel = extractWelfare(textAll);
  for (const k of Object.keys(welFromLabel)) if (!wel[k]) wel[k] = true;
  const CARE = ['餐补/包吃', '交通补贴', '包住/房补', '下午茶'];
  const careHit = CARE.filter((k) => wel[k]);
  if (careHit.length) bonuses.push({ k: `关怀福利：${careHit.join('、')}`, v: Math.min(careHit.length * 4, 10) });

  // ---------- 加分④：薪资 7k＋（无档次，0 或 5）----------
  const salMin = job.salaryMinNum ?? parseSalaryMin(job.salaryText);
  if (salMin !== null && salMin >= 7000) bonuses.push({ k: `薪资7k+（${job.salaryText}）`, v: 5 });
  else if (salMin !== null && salMin < 7000 && salMaxNum !== null && salMaxNum < 7000) penalties.push({ k: `薪资偏低（${job.salaryText}）`, v: -6 });

  // ---------- 加分⑤：工作地点在广州 / 佛山（无档次，0 或 5）----------
  // 用 cityResolved（可能是从标题括号补出来的工作地），否则"（广州）"这类岗位会漏加
  if (/广州|佛山/.test(cityResolved)) bonuses.push({ k: `地点：${cityResolved}`, v: 5 });

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
  // 说明：只在「任职要求」段判定，且若明确要求 ≥1 年经验则不加分（见 detectFreshOk）
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

  // ---------- 实习岗 / 非2026届（面向在校生）→ 过滤 ----------
  // 用户是 2026 届校招，实习岗与在读届别岗位一律不匹配。
  //
  // 判定分三档（越靠前越确定）：
  //   ① 标题/学历标注**明写**实习或在读届别 → 一票过滤，任何"可转正"都不能翻案
  //      （实测「珠海杰理·人力资源实习生」JD 写"可实习6个月及以上…可提供转正机会"，
  //       旧逻辑用 canConvert 豁免了整个实习判定，83 分进了推荐档——转正机会改不了
  //       "招收对象是在校生"这个事实。）
  //   ② JD 明写实习岗或在读届别 → 过滤
  //   ③ JD 要求实习时长（实习N个月/要求实习）→ 过滤（注：实习性质，与备注中"实习期3个月"不同）
  // 唯一豁免：JD 明确同时面向 2026 届（正规校招，如"2026-2027届"）。
  const internTitle = /实习生|实习岗|见习生|intern|在校生|27届|28届|2027届|2028届|大[一二三四]在校|研[一二]在读/i.test(title);
  const internDegree = /(在校生|在读|27届|28届|2027届|2028届|大[一二三四]|研[一二]在读)/.test(String(job.degree || ''));
  const internJd = /(不是应届生|非应届生|仅限在校|只招在校|在校生优先|实习生岗位|实习岗位|本岗位为实习|属实习岗|招聘实习生|在校生|在读学生|全日制在读|2027届|2028届|27届|28届|2027年毕业|2028年毕业|大一|大二|大三在读|研一在读|研二在读)/.test(jd);
  const internDuration = /(实习\s*[0-9一二三四五六七八九十]+\s*个?月|需实习|要求实习|可实习|能实习|实习时间|实习期\s*[0-9])/.test(jd);
  // 豁免：JD 明确同时面向 2026 届（如"面向对象：2026-2027届"），说明是正规校招而非实习生岗
  const alsoGraduates2026 = /(2026\s*(?:[-–—~～]|至|到|、|\/)\s*2027\s*届|2026届及以后|2026届应届|2026届毕业生|2026年应届|应往届|往应届)/.test(jd);
  if ((internTitle || internDegree || internJd || internDuration) && !alsoGraduates2026) {
    negatives.push('实习/非应届届别岗位（面向在校生或非2026届）');
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
  // 过滤项去重：不同规则可能推出同一句文案（如"岗位方向不符"同时被标题白名单和
  // 方向词兜底命中），去重同时避免重复扣分。
  const negativesUniq = [...new Set(negatives)];
  const bonusRaw = bonuses.reduce((s, b) => s + b.v, 0);
  const bonusCap = Math.min(bonusRaw, 70);
  if (bonusRaw > 70) bonuses.push({ k: `加分封顶（原始 ${bonusRaw} → 70）`, v: 70 - bonusRaw });
  score += bonusCap;
  for (const p of penalties) score += p.v;
  // 过滤项严重扣分，确保沉底
  score -= negativesUniq.length * 25;

  // 判定（评分标准 v2：基准 50、上限 100；「推荐岗位」门槛 = 75 分）
  const verdict = verdictOf(score, penalties, negativesUniq);

  return {
    ...job,
    platform,
    score: Math.max(0, Math.round(score)),
    verdict,
    negatives: negativesUniq,
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
    freshNote: freshLog.join('；'),
    effectiveExp,
    expSource: expRes.source,
    expLabelYears,
    expLabelRaw: String(job.workYear || '').trim(),   // 发布信息的经验原文（仅当 JD 未提及时才采信）
    salaryMinNum: salMin,      // 引擎实际用于判定的月薪下限（"万/年"已 ÷12）
    salaryMaxNum: salMaxNum,   // 引擎实际用于判定的月薪上限（用于"薪资低于6k"过滤）
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
    // 云端抓取已把智联列表内嵌的 JD 提取到 jobDescFull；老数据可能只有详情页
    const embJD = String(x.jobDescFull || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim();
    const detJD = String(det.jd || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim();
    const jd = embJD || detJD;
    const hasDetail = jd.length > 20;
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
      jd,
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

// ============ 主流程（仅直接运行时执行；被 import 时只导出纯函数供单测使用）============
const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMainModule) {
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
}

export { extractMinYearsFromJd, expFromLabel, parseSalaryMin, parseSalaryMax, resolveExpYears, expIsOutOfRange, detectFreshOk };
