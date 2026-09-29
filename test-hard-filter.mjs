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
    id: 'h25-标题括号写明广州应放行',
    title: '人力资源管培生（广州）',
    desc: '真实误杀（中铁建工）：前程 jobAreaString 取的是总部"北京·丰台区"，'
      + '但标题写「（广州）」且 JD 明写"分子公司及工作地点…（广州）"→ 属广州岗，不得按北京过滤',
    jd: '一、招聘简介\n本岗位引进人力资源系统后备人才。\n三、招聘条件\n1.2026届人力资源管理相关专业本科及以上学历应届毕业生；\n'
      + '五、分子公司及工作地点\n5.中铁建工集团第五建设有限公司（广州）\n6.中铁诺德城市投资有限公司（深圳）',
    city: '北京·丰台区',
    clean: true,
  },
  {
    id: 'h26-标题括号写外省仍应过滤',
    title: '人事经理（湖南永州）',
    desc: '标题括号里是外省"永州"，且 city 是黑名单里的外省 → 不得因为"永州"含"州"就误配到"惠州"，仍应地域过滤',
    jd: '岗位职责：\n1、负责人事全模块管理。\n任职要求：\n1、本科及以上学历，接受应届生。\n福利待遇：双休。',
    city: '湖南永州',
    mustHit: '非广东省内',
  },
  {
    id: 'h27-外省城市配广东括号不得误判为广东',
    desc: 'city="南宁"（黑名单外省）配标题"（广州）" → 括号必须是广东地名才认，'
      + '而"南宁"本身已判外省，最终仍应过滤（防通用子串兜底放水）',
    title: '人力资源专员（南宁）',
    jd: '岗位职责：\n1、负责招聘与员工关系。\n任职要求：\n1、本科及以上学历，接受应届生。\n福利待遇：双休。',
    city: '南宁',
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
  // --- 薪资格式：年薪"万/年"必须 ÷12 换算成月薪 ---
  {
    id: 'h17-年薪12到14万应拿薪资加分',
    title: '人力资源专员',
    desc: '12-14万/年 = 月薪 1万-1.17万 → 应拿「薪资7k+」加分（曾被整段忽略，也算不出低薪）',
    jd: '岗位职责：\n1、负责招聘与员工关系。\n任职要求：\n1、本科及以上学历，接受应届生。\n福利待遇：双休。',
    salary: '12-14万/年',
    mustBonus: '薪资7k+',
    expectSalaryMin: true,
  },
  {
    id: 'h18-年薪6到8万应判低薪',
    title: '人事专员',
    desc: '6-8万/年 = 月薪 5千-6.7千，下限低于 6k → 应判「薪资偏低」（不换算就会误判为高薪）',
    jd: '岗位职责：\n1、负责人事日常事务。\n任职要求：\n1、大专及以上学历。',
    salary: '6-8万/年',
    mustPenalty: '薪资偏低',
    expectSalaryMin: true,
  },
  {
    id: 'h19-年薪40万不应误判为月薪',
    title: '人力资源总监',
    desc: '40-50万/年 = 月薪 3.3万-4.2万，不得被当成月薪 40 万；同时"10年以上经验"应被经验门槛拦下',
    jd: '岗位职责：\n1、统筹集团人力资源战略。\n任职要求：\n1、本科及以上学历，10年以上经验。\n福利待遇：双休。',
    salary: '40-50万/年',
    mustPenalty: '经验要求超出校招范围',
    mustBonus: '薪资7k+',
    expectSalaryMin: true,
  },
  // --- 经验门槛：明确下限不得被次级条件稀释 ---
  {
    id: 'h20-明确2年以上不得被至少1年稀释',
    title: 'HRBP',
    desc: '真实线上漏网（彩讯科技）：JD 写「经验：2年以上HRBP经验，至少1年互联网/科技行业背景」，'
      + '曾经被"至少1年"取成 min=1 → 83 分进推荐档；明确下限 2 必须优先，应拦下',
    jd: [
      '一、公司介绍',
      '彩讯科技（300634.SZ）创立于2004年，是国家高新技术企业，员工4000余人。',
      '二、岗位职责',
      '【人力资源合作伙伴】',
      '▸ 深入理解业务战略，为技术团队提供专业HR解决方案',
      '▸ 负责业务团队招聘统筹：人才画像、渠道优化、面试管理',
      '▸ 推动绩效管理落地：目标设定、绩效辅导、结果应用',
      '【员工关系与发展】',
      '▸ 处理员工关系事务：入转调离、纠纷预防',
      '▸ 推动培训体系，识别能力短板并协调资源',
      '三、任职要求',
      '【基本条件】',
      '学历：本科及以上，人力资源管理、心理学、管理学等相关专业优先',
      '经验：2年以上HRBP经验，至少1年互联网/科技行业背景',
      '优先：有研发团队HRBP服务经验，了解技术团队特性',
      '证书：人力资源管理师或SHRM/PHR等国际认证优先',
      '【专业能力】',
      '▸ 精通HR全模块，至少精通招聘、绩效、员工关系中两个模块',
      '▸ 熟悉互联网/科技行业人才市场，有技术岗位招聘经验优先',
      '四、为什么选择彩讯',
      '▸ A 股期权激励 + 管理 / 专业双通道晋升',
    ].join('\n'),
    mustHit: '经验要求超出校招范围',
    expectExp: 2,
  },
  {
    id: 'h21-JD写1到3年应放行',
    title: '人力资源专员',
    desc: 'JD 任职要求写「1-3年经验」→ 下限 1，用户口径"1～3年也算" → 必须放行，不得按 3 年拦',
    jd: '岗位职责：\n1、负责招聘与员工关系。\n任职要求：\n1、本科及以上学历，1-3年人力资源相关经验。\n福利待遇：双休。',
    clean: true,
    expectExp: 1,
  },
  // --- 日薪 / 时薪：必须折算成月薪再和 6k 门槛比 ---
  {
    id: 'h22-日薪250元应折算为月薪5438并判低薪',
    title: '人力资源专员',
    desc: '真实漏网（万宝盛华兼职岗）："250元/天" 旧正则解析不出下限 → 低薪兼职直接漏过薪资过滤，'
      + '还拿了不少加分。按 21.75 天/月折算 = 5438 元/月 < 6k → 应判「薪资偏低」',
    jd: '岗位职责：\n1、负责前台接待与行政事务。\n任职要求：\n1、大专及以上学历。',
    salary: '250元/天',
    mustPenalty: '薪资偏低',
    noBonus: '薪资7k+',
  },
  {
    id: 'h23-日薪区间150到200元不得被读成20万',
    title: '人事助理',
    desc: '"150-200元/天" 旧 4~6 位兜底读成 200000（月薪 20 万）→ 完全反向。'
      + '折算后 3263-4350 元/月，应判「薪资偏低」',
    jd: '岗位职责：\n1、负责人事档案整理。\n任职要求：\n1、大专及以上学历。',
    salary: '150-200元/天',
    mustPenalty: '薪资偏低',
    noBonus: '薪资7k+',
  },
  {
    id: 'h24-时薪25元应折算为月薪4350并判低薪',
    title: '行政助理',
    desc: '"25元/小时" 按 8 小时/天 × 21.75 天/月 = 4350 元/月 < 6k → 应判「薪资偏低」',
    jd: '岗位职责：\n1、负责办公用品与档案管理。\n任职要求：\n1、大专及以上学历。',
    salary: '25元/小时',
    mustPenalty: '薪资偏低',
    noBonus: '薪资7k+',
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
    let ok = true, what = '';
    if (c.clean) {
      ok = negs.length === 0;
      what = ok ? '无过滤项 ✅' : `出现过滤项：${negs.join('；')}`;
    } else if (c.mustHit) {
      ok = negs.some((n) => n.includes(c.mustHit));
      what = ok ? `命中「${c.mustHit}」` : `未命中「${c.mustHit}」，实际：${negs.join('；') || '(无)'}`;
    } else {
      // 纯数值/得分类用例（如薪资换算）：不断言过滤项，只断言加分/扣分/解析结果
      what = negs.length ? `过滤项：${negs.join('；')}` : '无过滤项';
    }
    // noBonus：被过滤的岗位不得同时拿到该方向加分（口径必须自洽，不能又罚又奖）
    if (ok && c.noBonus) {
      if (bons.includes(c.noBonus)) { ok = false; what += `，但错误地拿到了「${c.noBonus}」加分`; }
      else what += `，且未拿「${c.noBonus}」加分`;
    }
    // mustBonus / mustPenalty：必须出现该加分项 / 扣分项（用于薪资等数值换算类断言）
    if (ok && c.mustBonus) {
      if (bons.includes(c.mustBonus)) what += `，且拿到「${c.mustBonus}」加分`;
      else { ok = false; what += `，但缺少「${c.mustBonus}」加分`; }
    }
    if (ok && c.mustPenalty) {
      const pens = (r.penalties || []).map((p) => p.k).join('；');
      if (pens.includes(c.mustPenalty) || negs.some((n) => n.includes(c.mustPenalty))) what += `，且含「${c.mustPenalty}」`;
      else { ok = false; what += `，但缺少「${c.mustPenalty}」`; }
    }
    // 薪资必须已解析成月薪（薪酬类用例专用）
    if (ok && c.expectSalaryMin) {
      if (r.salaryMinNum != null) what += `，月薪下限解析=${Math.round(r.salaryMinNum)}`;
      else { ok = false; what += '，但月薪下限未解析出来'; }
    }
    // 经验门槛必须取到预期年数（经验口径类用例专用）
    if (ok && c.expectExp !== undefined) {
      if (r.effectiveExp === c.expectExp) what += `，经验门槛=${r.effectiveExp}（${r.expSource || '无'}）`;
      else { ok = false; what += `，但经验门槛=${r.effectiveExp}（期望 ${c.expectExp}，来源 ${r.expSource || '无'}）`; }
    }
    if (ok) pass++;
    console.log(`  ${ok ? '✅' : '❌'} ${c.id.padEnd(24)} ${what} | ${r.score} 分`);
    if (!ok) console.log(`         意图: ${c.desc}`);
  });
  console.log(`\n硬过滤用例通过 ${pass}/${CASES.length}`);
  process.exit(pass === CASES.length ? 0 : 1);
}

console.log('用法：--make 造数据 | --check 校验（中间需先跑 score-engine）');
