/**
 * 发布版脱敏判定（verify-dist.mjs 与 test-verify-dist.mjs 共用同一份逻辑）。
 *
 * 设计要点（2026-10-19 重构）：
 *   早先用的是「真名/学校/籍贯…的取值清单」来做黑名单，结果**清单本身就是个人信息**——
 *   为了检测泄露，反而把真名和学校写进了公开仓库。现在改成**结构化校验**：
 *     ① 画像区只允许出现固定的 6 个字段；
 *     ② 画像里的 name 必须正好是笔名；
 *     ③ 页面标题 / 大标题必须正好是站名；
 *     ④ 任意区域不得出现手机号这类通用敏感格式。
 *   这样规则里不再需要存任何真实取值，覆盖面反而更大（多出一个字段就会被抓到）。
 *
 * 只查「个人画像区」和「页面署名区」：岗位数据里出现任何公司名都合法
 * （招聘方本身就叫「星火教育」等），拿整页扫会误报。
 */

/** 对外显示的笔名 */
export const PEN_NAME = '林小夕';

/** 发布版画像区允许保留的字段（其余一律视为泄露） */
export const ALLOWED_PROFILE_KEYS = ['name', 'graduateYear', 'targetRoles', 'expectSalaryMinK', 'english', 'mbti'];

/** 页面标题与大标题必须正好是站名 */
export const SITE_TITLE = '岗位看板';

/** 通用敏感格式（不针对某个人，任何人都适用） */
export const PII_PATTERNS = [
  ['手机号', /1[3-9]\d{9}/],
  ['身份证号', /\d{6}(19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{3}[\dXx]/],
];

/** 页面上属于"本人信息"的两块区域 */
export function piiRegions(html) {
  const m = html.match(/<script id="payload" type="application\/json">([\s\S]*?)<\/script>/);
  let profile = '', profileObj = null;
  if (m) {
    try {
      const obj = JSON.parse(m[1].replace(/<\\\//g, '</'));
      profileObj = obj.profile || null;
      profile = JSON.stringify(obj.profile || {});
    } catch {
      profile = m[1].slice(0, 3000);
    }
  }
  const title = ((html.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '').trim();
  const h1 = ((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || '').replace(/<[^>]+>/g, '').trim();
  return { profile, profileObj, title, h1, chrome: [title, h1].filter(Boolean).join(' ') };
}

/**
 * 检查脱敏情况。
 * @returns {{name:string, region:string, hit:string}[]} 泄漏项（空数组=全部干净）
 */
export function findLeaks(html) {
  const { profile, profileObj, title, h1 } = piiRegions(html);
  const leaks = [];

  /* ① 姓名必须是笔名 */
  if (profileObj) {
    if (profileObj.name !== PEN_NAME) {
      leaks.push({ name: '姓名', region: '画像区', hit: String(profileObj.name) });
    }
    /* ② 画像字段必须在白名单内 */
    for (const k of Object.keys(profileObj)) {
      if (!ALLOWED_PROFILE_KEYS.includes(k)) {
        leaks.push({ name: `画像字段「${k}」`, region: '画像区', hit: k });
      }
    }
  } else if (/"name"\s*:\s*"([^"]*)"/.test(profile)) {
    /* 画像 JSON 解析失败时退回文本判断，避免"解析不了就当干净" */
    const nm = profile.match(/"name"\s*:\s*"([^"]*)"/)[1];
    if (nm !== PEN_NAME) leaks.push({ name: '姓名', region: '画像区', hit: nm });
  }

  /* ③ 标题必须正好是站名（有人往标题里拼名字就会被抓到） */
  if (title && title !== SITE_TITLE) leaks.push({ name: '页面标题', region: '署名区', hit: title });
  if (h1 && h1 !== SITE_TITLE) leaks.push({ name: '页面大标题', region: '署名区', hit: h1 });

  /* ④ 通用敏感格式（画像区 + 署名区） */
  const both = profile + ' ' + [title, h1].join(' ');
  for (const [name, re] of PII_PATTERNS) {
    const hit = both.match(re);
    if (hit) leaks.push({ name, region: '画像区/署名区', hit: hit[0] });
  }

  return leaks;
}
