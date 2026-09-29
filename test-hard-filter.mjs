/**
 * 硬过滤回归测试（实习岗 / 岗位方向 / 地域 / 薪资 / 单休 / 乙方）。
 *
 * 沙箱禁止带管道的子进程（spawnSync EPERM），所以造数据与校验分开：
 *   node test-hard-filter.mjs --make
 *   DATA_DIR=.tmp-hard-filter node score-engine.mjs
 *   node test-hard-filter.mjs --check
 *
 * 每条用例声明「期望命中的过滤项关键字」（mustHit）或「期望不出现任何过滤项」（clean）。
 */
import fs from 'node:fs';
import path from 'node:path';

const DIR = '.tmp-hard-filter';

export const CASES = [
  {
    id: 'h01-标题实习生+可转正',
    title: '人力资源实习生',
    desc: '复现漏网：标题"实习生"、JD 写"可实习6个月…可提供转正机会" —— 「可转正」不得豁免实习过滤',
    jd: '岗位描述:\n1.整理人事相关档案资料；\n2.维护并开拓招聘渠道；\n3.协助招聘工作，包含简历搜寻、面试安排等。\n岗位要求:\n1.人力资源管理专业，27届毕业，要求可实习6个月及以上，可提供转正机会；\n2.大学英语通过6级。',
    mustHit: '实习',
  },
  {
    id: 'h02-标题27届实习生',
    title: '27届人力资源实习生',
    desc: '标题明写 27届 → 非2026届，必须过滤',
    jd: '工作职责\n1、基础人事：入转调离办理、资料存档等。\n任职要求\n1、27届本科在校生，人力资源相关专业优先。',
    mustHit: '实习',
  },
  {
    id: 'h03-JD要求实习时长',
    title: '行政专员',
    desc: '标题正常，但 JD 写"要求实习6个月以上" → 属实习性质，应过滤',
    jd: '岗位职责：\n1、负责行政后勤与办公用品管理。\n任职要求：\n1、本科及以上学历，要求实习6个月以上，每周到岗5天。',
    mustHit: '实习',
  },
  {
    id: 'h04-供应链管理培训生',
    title: '供应链管理培训生',
    desc: '复现漏网：TARGET_TITLE 裸词"培训生"曾放行 → 非HR方向管培应过滤',
    jd: '岗位职责：\n1、参与供应链计划、采购与仓储轮岗。\n任职要求：\n1、2026届本科及以上学历，物流/供应链专业。',
    mustHit: '管培方向不符',
  },
  {
    id: 'h05-电商运营助理',
    title: '电商运营助理',
    desc: '非HR职能方向词 → 应过滤',
    jd: '岗位职责：\n1、负责店铺日常运营与活动报名。\n任职要求：\n1、本科及以上学历。',
    mustHit: '岗位方向不符',
  },
  {
    id: 'h06-HRBP带方向后缀应放行',
    title: 'HRBP助理（研发方向）',
    desc: '含 HRBP 锚点，"研发方向"只是服务对象 → 不得误过滤',
    jd: '岗位职责：\n1、负责研发中心的招聘与员工关系维护。\n2、组织研发团队培训与绩效跟进。\n任职要求：\n1、本科及以上学历，1年以上HR相关经验。',
    clean: true,
  },
  {
    id: 'h07-安全行政专员应放行',
    title: '安全行政专员',
    desc: '含"行政"锚点，"安全"是业务定语 → 不得误过滤',
    jd: '岗位职责：\n1、负责公司安全生产台账与行政后勤事务。\n2、组织安全培训与办公用品采购。\n任职要求：\n1、大专及以上学历。',
    clean: true,
  },
  {
    id: 'h08-非广东地域',
    title: '人事专员',
    desc: '工作地在上海 → 地域过滤',
    jd: '岗位职责：\n1、负责人事招聘与员工关系。\n任职要求：\n1、本科及以上学历。',
    city: '上海',
    mustHit: '非广东省内',
  },
  {
    id: 'h09-薪资低于6k',
    title: '行政助理',
    desc: '薪资 3.5-4千 → 过滤',
    jd: '岗位职责：\n1、负责行政日常事务。\n任职要求：\n1、大专及以上学历。',
    salary: '3.5-4千',
    mustHit: '薪资低于6k',
  },
  {
    id: 'h10-正常工作应无过滤项',
    title: '人力资源专员',
    desc: '双休、薪资达标、广东、HR方向、要求段接受应届 → 不得有任何过滤项',
    jd: '岗位职责：\n1、负责招聘全流程与员工入离职办理。\n2、组织新员工培训与员工关怀活动。\n任职要求：\n1、本科及以上学历，接受应届生。\n福利待遇：五险一金、双休、餐补。',
    clean: true,
  },
  {
    id: 'h11-笼统管培生应放行',
    title: '管培生',
    desc: '用户求职方向含"管培生"，标题没写具体方向 → 不得过滤（曾因"管培方向不符"过宽被误杀，且被过滤的同时还拿了管培加分）',
    jd: '岗位职责：\n1、轮岗学习人力、行政等模块工作。\n任职要求：\n1、2026届本科及以上学历，接受应届生。\n福利待遇：双休、五险一金。',
    clean: true,
  },
  {
    id: 'h12-储备干部应放行',
    title: '储备干部',
    desc: '与 h11 同理：无具体方向的储备干部不得过滤',
    jd: '岗位职责：\n1、从基层轮岗，往人事行政管理方向培养。\n任职要求：\n1、本科及以上学历，接受应届生。\n福利待遇：双休。',
    clean: true,
  },
  {
    id: 'h13-海外管培生应放行',
    title: '海外管培生（26届毕业生投递）',
    desc: '标题只有"海外"没有具体职能方向 → 不得过滤',
    jd: '岗位职责：\n1、参与海外业务的人力与行政支持工作。\n任职要求：\n1、2026届本科及以上学历，接受应届生。\n福利待遇：双休、餐补。',
    clean: true,
  },
  {
    id: 'h14-招聘BP应放行',
    title: '招聘BP',
    desc: 'HR 线 BP → 属目标方向，不得过滤（曾因白名单只认"HRBP"而漏掉裸"BP"）',
    jd: '岗位职责：\n1、负责业务线招聘交付与人才盘点。\n任职要求：\n1、本科及以上学历，1年以上招聘经验。\n福利待遇：双休。',
    clean: true,
  },
  {
    id: 'h15-运营培训生应过滤',
    title: '运营培训生',
    desc: '写明"运营"方向且无 HR 锚点 → 过滤；且不得再拿"HRBP/管培生"加分（曾双向矛盾）',
    jd: '岗位职责：\n1、参与平台运营与商家管理工作。\n任职要求：\n1、2026届本科及以上学历。',
    mustHit: '岗位方向不符',
    noBonus: 'HRBP / HR管培生',
  },
  {
    id: 'h16-财务BP应过滤',
    title: '财务BP(总经理助理）',
    desc: '非 HR 线 BP，虽含"总经理助理"字样 → 仍应过滤（负向预查曾被"总经理助理"绕过）',
    jd: '岗位职责：\n1、负责事业部财务分析与预算管理。\n任职要求：\n1、本科及以上学历，5年以上财务经验。',
    mustHit: '岗位方向不符',
    noBonus: 'HRBP / HR管培生',
  },
];

function rec(c, i) {
  return {
    number: `TEST${i + 1}`,
    name: c.title,
    companyName: `测试科技${i + 1}有限公司`,
    salary60: c.salary || '8-10千',
    workCity: c.city || '广州',
    cityDistrict: '天河区',
    publishTime: new Date().toISOString().slice(0, 10),
    workingExp: c.exp || '经验不限',
    education: '本科',
    companySize: '500-999人',
    industryName: '互联网',
    positionURL: `https://example.com/${i}`,
    jobSkillTags: [],
    jobDescFull: c.jd,
    hasDetail: true,
  };
}

if (process.argv.includes('--make')) {
  fs.rmSync(DIR, { recursive: true, force: true });
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(path.join(DIR, 'zhilian-list.json'), JSON.stringify(CASES.map(rec), null, 1), 'utf8');
  console.log(`✅ 已造数据：${DIR}（${CASES.length} 个用例）`);
  process.exit(0);
}

if (process.argv.includes('--check')) {
  const f = path.join(DIR, 'scored-zhilian.json');
  if (!fs.existsSync(f)) {
    console.log(`❌ ${f} 不存在，请先跑 DATA_DIR=${DIR} node score-engine.mjs`);
    process.exit(1);
  }
  const byId = new Map();
  for (const x of JSON.parse(fs.readFileSync(f, 'utf8'))) byId.set(String(x.id), x);

  let pass = 0;
  console.log('硬过滤用例结果：');
  CASES.forEach((c, i) => {
    const r = byId.get(`TEST${i + 1}`);
    if (!r) { console.log(`  ❌ ${c.id}: 未出现在评分结果中`); return; }
    const negs = r.negatives || [];
    const bons = (r.bonuses || []).map((b) => b.k).join('；');
    let ok, what;
    if (c.clean) {
      ok = negs.length === 0;
      what = ok ? '无过滤项 ✅' : `出现过滤项：${negs.join('；')}`;
    } else {
      ok = negs.some((n) => n.includes(c.mustHit));
      what = ok ? `命中「${c.mustHit}」` : `未命中「${c.mustHit}」，实际：${negs.join('；') || '(无)'}`;
    }
    // noBonus：被过滤的岗位不得同时拿到该方向加分（口径必须自洽，不能又罚又奖）
    if (ok && c.noBonus) {
      if (bons.includes(c.noBonus)) { ok = false; what += `，但错误地拿到了「${c.noBonus}」加分`; }
      else what += `，且未拿「${c.noBonus}」加分`;
    }
    if (ok) pass++;
    console.log(`  ${ok ? '✅' : '❌'} ${c.id.padEnd(24)} ${what} | ${r.score} 分`);
    if (!ok) console.log(`         意图: ${c.desc}`);
  });
  console.log(`\n硬过滤用例通过 ${pass}/${CASES.length}`);
  process.exit(pass === CASES.length ? 0 : 1);
}

console.log('用法：--make 造数据 | --check 校验（中间需先跑 score-engine）');
