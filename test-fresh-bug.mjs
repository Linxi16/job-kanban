/**
 * 应届生判定修复的端到端回归测试。
 *
 * 为什么分两步：沙箱禁止带管道的子进程（spawnSync EPERM），
 * 所以本脚本只负责「造数据」和「校验结果」，运行评分引擎由外部驱动：
 *
 *   node test-fresh-bug.mjs --make      造出两个场景的数据目录
 *   DATA_DIR=.tmp-fresh-test node score-engine.mjs      ← 跑场景A
 *   DATA_DIR=.tmp-fresh-real node score-engine.mjs      ← 跑场景B
 *   node test-fresh-bug.mjs --check     校验结果
 */
import fs from 'node:fs';
import path from 'node:path';

const DIR_A = '.tmp-fresh-test';
const DIR_B = '.tmp-fresh-real';

export const CASES = [
  {
    id: 'case1-校招是职责',
    title: '人事行政专员',
    desc: '职责含校园招聘/校招，任职要求写 3年以上经验',
    jd: '岗位职责：\n1、组织实施员工培训。\n2、校园招聘工作，开展宣讲组织、简历筛选、面试等校招事宜。\n任职要求：\n1、本科及以上学历。\n2、3年以上相关行政/人事综合岗工作经验。',
    exp: '3-5年',
    expect: false,
  },
  {
    id: 'case2-要求段接受应届',
    title: '人力资源专员',
    desc: '任职要求明写「接受应届生」',
    jd: '岗位职责：\n1、负责招聘与员工关系。\n任职要求：\n1、本科及以上学历，接受应届生。\n2、沟通能力强。',
    exp: '经验不限',
    expect: true,
  },
  {
    id: 'case3-要求段应届优先',
    title: '人事专员',
    desc: '任职要求写「应届生优先」',
    jd: '岗位职责：\n1、负责人事行政工作。\n任职要求：\n1、应届生优先，人力资源相关专业。',
    exp: '1年以下',
    expect: true,
  },
  {
    id: 'case4a-职责校招-下限2年仍放过',
    title: '行政人事专员',
    desc: '要求段写"2年以上"（下限2）→ 按用户口径「1年以内、1～3年都算」，下限2不超范围，放过；职责段校招字样不加分',
    jd: '岗位职责：\n1、校园招聘工作，开展宣讲组织、简历筛选。\n任职要求：\n1、本科及以上学历，人力资源管理专业。\n2、2年以上人事行政相关工作经验。',
    exp: '2年',
    expect: false,
  },
  {
    id: 'case4b-职责校招-发布信息经验不限',
    title: '行政人事专员',
    desc: '职责含校招，但发布信息标「经验不限」→ 平台声明采信，应加分',
    jd: '岗位职责：\n1、校园招聘工作。\n任职要求：\n1、本科及以上学历，人力资源管理专业。',
    exp: '经验不限',
    expect: true,
  },
  {
    id: 'case5-可培养但下限3年',
    title: '人力资源主管',
    desc: '职责含「可培养」，要求段写 3年以上 → 下限3超范围，且无应届豁免',
    jd: '岗位职责：\n1、负责招聘，新人可培养。\n任职要求：\n1、3年以上人事工作经验。',
    exp: '3-5年',
    expect: false,
  },
  {
    id: 'case5b-接受应届豁免3年',
    title: '人力资源主管',
    desc: '要求段写"3年以上，条件优秀应届生可考虑" → JD 明确接受应届，豁免经验门槛，应加分',
    jd: '岗位职责：\n1、负责招聘与员工关系。\n任职要求：\n1、3年以上人事工作经验，条件优秀的应届毕业生可考虑。',
    exp: '3-5年',
    expect: true,
  },
  {
    id: 'case6-经验不限欢迎应届',
    title: '人事助理',
    desc: '要求段写「经验不限，欢迎应届」',
    jd: '岗位职责：\n1、人事行政事务。\n任职要求：\n1、经验不限，欢迎应届。',
    exp: '经验不限',
    expect: true,
  },
  {
    id: 'case7-仅发布信息3到5年',
    title: '行政专员',
    desc: 'JD 要求段未提经验，发布信息标 3-5年 → JD 未提及才采信发布信息，下限3超范围',
    jd: '岗位职责：\n1、负责招聘工作。\n任职要求：\n1、本科及以上学历。',
    exp: '3-5年',
    expect: false,
  },
  {
    id: 'case8-下限1年放过',
    title: '人力资源助理',
    desc: '要求 1-3年（下限1）→ 在校招范围内，放过（旧口径会误拦）',
    jd: '岗位职责：\n1、作为储备干部培养。\n任职要求：\n1、1-3年相关经验。',
    exp: '1-3年',
    // 断言类型：过滤门槛（下限1 → 不超范围）
    assertFilter: true,
    expectFilter: false,
  },
  {
    id: 'case9-明确不招应届',
    title: '员工关系专员',
    desc: 'JD 写「不招应届生」→ 绝不能加分；下限1年本不超范围，属"不接受应届"而非"经验超范围"',
    jd: '岗位职责：\n1、人事行政工作。\n任职要求：\n1、本科及以上学历。\n2、不招应届生，需有工作经验。',
    exp: '1-3年',
    expect: false,
  },
  {
    id: 'case10-非应届勿投',
    title: '薪酬绩效专员',
    desc: 'JD 写「非应届勿投」→ 绝不能加分',
    jd: '岗位职责：\n1、人事行政工作。\n任职要求：\n1、本科及以上学历。\n2、非应届勿投。',
    exp: '经验不限',
    expect: false,
  },
  {
    id: 'case11-要求1到3年但接受应届',
    title: '总裁秘书',
    desc: '真实场景：JD 写"1-3年经验"但同段写"优秀应届毕业生可酌情考虑" → 应加分',
    jd: '岗位职责：\n1、协助处理日常行政与招聘事务。\n任职要求：\n教育背景：本科以上学历，人力资源管理、行政管理或相关专业优先。\n工作经验：1-3年人事行政助理或相关岗位工作经验。优秀应届毕业生可酌情考虑。\n工作技能：具有英语八级或以上优先考虑。',
    exp: '无需经验',
    expect: true,
  },
  {
    id: 'case12-发布信息经验不限',
    title: '行政秘书',
    desc: '发布信息标「经验不限」，JD 无应届字样也无年限 → 平台声明应采信',
    jd: '岗位职责：\n1、负责行政事务与会议安排。\n任职要求：\n1、本科及以上学历，专业不限。',
    exp: '经验不限',
    expect: true,
  },
  {
    id: 'case13-职责段年限不算数',
    title: '员工关系专员',
    desc: '职责段写"维护3年以上老客户"（不是经验要求），要求段未写年限，发布信息标经验不限 → 职责段的数字不得当门槛',
    jd: '岗位职责：\n1、负责维护3年以上老客户关系与员工关怀活动。\n2、制定部门五年规划。\n任职要求：\n1、本科及以上学历，沟通能力强。',
    exp: '经验不限',
    expect: true,
  },
  {
    id: 'case14-JD下限优先于发布信息',
    title: '人力资源助理',
    desc: '发布信息标「经验不限」，但 JD 任职要求段写"1年以上经验" → 冲突时以 JD 为准；下限1仍在校招范围，放过',
    jd: '岗位职责：\n1、协助招聘与员工入离职办理。\n任职要求：\n1、本科及以上学历。\n2、1年以上人事相关岗位经验。',
    exp: '经验不限',
    assertFilter: true,
    expectFilter: false,
  },
  {
    id: 'case15-福利文案伪应届',
    title: '行政人事专员',
    desc: '福利条款写"应届毕业生到岗可报销路费"（不是招收声明），要求段要求 3年经验 → 不得加分、且应因超范围被过滤',
    jd: '岗位职责：\n1、负责人事行政日常事务。\n任职要求：\n1、本科及以上学历。\n2、3年以上人事行政相关工作经验。\n福利待遇：\n1、五险一金、节日大礼包。\n2、应届毕业生到岗报到时可按公司标准报销一次来程路费。',
    exp: '3-5年',
    expect: false,
  },
  {
    id: 'case16-要求段应届毕业生',
    title: '人力资源专员',
    desc: '任职要求段写"2026届应届毕业生" → 应加分（宽口径词在要求段内算数）',
    jd: '岗位职责：\n1、负责人力资源各模块工作。\n任职要求：\n1、2026届国内外普通高等院校毕业的应届毕业生，人力资源管理相关专业。',
    exp: '在校生/应届生',
    expect: true,
  },
  {
    id: 'case17-下限2到3年过滤',
    title: '人事主管',
    desc: '要求段写"2-3年经验"（下限2，超范围，无应届豁免）→ 应过滤',
    jd: '岗位职责：\n1、负责人事行政全盘工作。\n任职要求：\n1、本科及以上学历。\n2、2-3年人事行政相关工作经验。',
    exp: '1-3年',
    expect: false,
  },
];

export const REAL = {
  id: '真实岗位-人事专员培训方向',
  title: '人事专员（培训方向）',
  jd: `公司简介：\n广东新锐创立于2001年，深耕公共建筑暖通机电与洁净环境领域。\n岗位职责：\n1、组织实施员工培训，搭建内部讲师队伍。\n2、校园招聘工作，开展宣讲组织、简历筛选、面试等校招事宜。\n3、负责会议组织、现场安排、会议记录及纪要整理；\n任职要求：\n1、本科及以上学历，人力资源管理、行政管理等相关专业。\n2、3年以上相关行政/人事综合岗工作经验，熟悉培训工作优先。\n3、熟悉Office办公软件，文字功底好。\n上班时间：\n1、上午8:30-17:30，中午12点-13:30休息（7.5小时）\n2、周末双休，法定节假日同步休息；`,
};

function rec(i, c, company) {
  return {
    number: `TEST${i + 1}`,
    name: c.title,
    companyName: company,
    salary60: '8000-12000元',
    workCity: '广州',
    cityDistrict: '天河区',
    publishTime: new Date().toISOString().slice(0, 10),
    workingExp: c.exp,
    education: '本科',
    companySize: '500-999人',
    industryName: '互联网',
    positionURL: `https://example.com/${i}`,
    jobSkillTags: [],
    // 与云端 cloud/fetch-all.mjs 的写入格式保持一致：内嵌 JD 放在 jobDescFull
    jobDescFull: c.jd,
    hasDetail: true,
  };
}

if (process.argv.includes('--make')) {
  for (const [d, list] of [
    [DIR_A, CASES.map((c, i) => rec(i, c, `测试科技${i + 1}有限公司`))],
    [DIR_B, [rec(0, REAL, '广东新锐建筑环境工程有限公司')]],
  ]) {
    fs.rmSync(d, { recursive: true, force: true });
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'zhilian-list.json'), JSON.stringify(list, null, 1), 'utf8');
  }
  console.log(`✅ 已造数据：${DIR_A}（${CASES.length} 个用例）、${DIR_B}（1 个真实岗位）`);
  process.exit(0);
}

if (process.argv.includes('--check')) {
  if (!fs.existsSync(path.join(DIR_A, 'scored-zhilian.json'))) {
    console.log(`❌ ${DIR_A}/scored-zhilian.json 不存在，请先跑 DATA_DIR=${DIR_A} node score-engine.mjs`);
    process.exit(1);
  }
  const scored = JSON.parse(fs.readFileSync(path.join(DIR_A, 'scored-zhilian.json'), 'utf8'));
  // 按 number（TEST1/TEST2…）匹配，不按标题——用例有可能同名
  const byId = new Map();
  for (const x of scored) byId.set(String(x.id), x);

  let pass = 0;
  console.log('用例结果：');
  CASES.forEach((c, i) => {
    const rec2 = byId.get(`TEST${i + 1}`);
    if (!rec2) { console.log(`  ❌ ${c.id}: 未出现在评分结果中（期望 id=TEST${i + 1}）`); return; }
    const hasBonus = (rec2.bonuses || []).some((b) => b.k === '接受应届生');
    const filtered = (rec2.negatives || []).some((n) => n.startsWith('经验要求超出校招范围'));
    // 两种断言类型：默认考"应届加分"，带 assertFilter 的考"经验门槛过滤"
    const ok = c.assertFilter ? filtered === c.expectFilter : hasBonus === c.expect;
    if (ok) pass++;
    const what = c.assertFilter
      ? `期望${c.expectFilter ? '过滤' : '不过滤'} / 实际${filtered ? '过滤' : '不过滤'}`
      : `期望${c.expect ? '加分' : '不加分'} / 实际${hasBonus ? '加分' : '不加分'}`;
    console.log(`  ${ok ? '✅' : '❌'} ${c.id.padEnd(26)} ${what} | ${rec2.score} 分 | ${c.desc}`);
    if (rec2.negatives && rec2.negatives.length) console.log(`         过滤项: ${rec2.negatives.join('；')}`);
    if (rec2.freshNote) console.log(`         判定说明: ${rec2.freshNote}`);
  });
  console.log(`\n用例通过 ${pass}/${CASES.length}`);

  console.log('\n--- 真实岗位回归（线上那个 90 分岗位）---');
  let realOk = false;
  if (fs.existsSync(path.join(DIR_B, 'scored-zhilian.json'))) {
    const r = JSON.parse(fs.readFileSync(path.join(DIR_B, 'scored-zhilian.json'), 'utf8'))[0];
    const hasBonus = (r.bonuses || []).some((b) => b.k === '接受应届生');
    const hasNeg = (r.negatives || []).some((n) => /经验要求超出校招范围/.test(n));
    realOk = !hasBonus && hasNeg;
    console.log(`  分数 ${r.score}（修复前线上 90 分）| 判定 ${r.verdict}`);
    console.log(`  加分项: ${(r.bonuses || []).map((b) => `${b.k} +${b.v}`).join(' | ') || '(无)'}`);
    console.log(`  过滤项: ${(r.negatives || []).join(' | ') || '(无)'}`);
    console.log(`  ${!hasBonus ? '✅' : '❌'} 「接受应届生」加分已移除`);
    console.log(`  ${hasNeg ? '✅' : '❌'} 「经验要求超出校招范围」过滤已恢复`);
  } else {
    console.log(`  ⚠ 缺少 ${DIR_B}/scored-zhilian.json，跳过`);
  }
  const allOk = pass === CASES.length && realOk;
  console.log(`\n${allOk ? '🎉 全部通过' : '⚠ 存在失败项'}`);
  process.exit(allOk ? 0 : 1);
}

console.log('用法：node test-fresh-bug.mjs --make | --check');
