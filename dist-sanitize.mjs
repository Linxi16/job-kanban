/**
 * 发布版脱敏判定（verify-dist.mjs 与 test-verify-dist.mjs 共用同一份逻辑）。
 *
 * 关键设计：岗位数据里出现任何公司名都合法（招聘方本身就叫「星火教育」
 * 「欢创信息」等），所以 PII 只能查「个人画像区」和「页面署名区」。
 */

/** 页面上属于"本人信息"的两块区域 */
export function piiRegions(html) {
  const m = html.match(/<script id="payload" type="application\/json">([\s\S]*?)<\/script>/);
  let profile = '';
  if (m) {
    try {
      const obj = JSON.parse(m[1].replace(/<\\\//g, '</'));
      profile = JSON.stringify(obj.profile || {});
    } catch {
      profile = m[1].slice(0, 3000);
    }
  }
  const chrome = [
    (html.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '',
    (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || '',
  ].join(' ');
  return { profile, chrome };
}

export const PII_RULES = [
  ['姓名', /吴家良/],
  ['学校', /广东财经大学/],
  ['籍贯', /云浮/],
  ['现居（本人）', /海珠区/],
  ['生日', /2003\/08|2003-08|2003年8月/],
  ['手机号', /1[3-9]\d{9}/],
  ['QQ号', /2580769551/],
  ['实习公司', /谷雨生物|骆驼户外|欢创信息|星火教育/],
];

/**
 * 检查脱敏情况。
 * @returns {{name:string, region:string, hit:string}|null}[] 泄漏项（空数组=全部干净）
 */
export function findLeaks(html) {
  const { profile, chrome } = piiRegions(html);
  const leaks = [];
  for (const [name, re] of PII_RULES) {
    const inProfile = profile.match(re);
    const inChrome = chrome.match(re);
    if (inProfile || inChrome) {
      leaks.push({ name, region: inProfile ? '画像区' : '署名区', hit: (inProfile || inChrome)[0] });
    }
  }
  return leaks;
}
