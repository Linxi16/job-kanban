# 已删除的本地脚本（留痕）

这些脚本在本项目演进过程中被删除。记在这里是为了：以后想起"当时那个核验脚本哪去了"时，
不用去翻 Git 历史猜它是否还有价值。

判断依据：**全项目零引用**（没有任何文件引用它），且功能已被下列正式脚本覆盖。

| 已删除 | 原本的用途 | 为什么删 | 现在用什么代替 |
|---|---|---|---|
| `check-jd-coverage.mjs` | 统计推荐档里有多少岗位缺 JD | 依赖已废弃的 `data/zhilian-detail.json`（旧详情页抓取），跑了必然报错 | 每次云端运行自动抓取列表时**列表内就带完整 JD**，`verify-dashboard.mjs` 断言"内嵌推荐全部有 JD" |
| `check-city-mix.mjs` | 核查跨城市混入 | 一次性核对 | `audit-cities.mjs`（有断言、跑在流水线里） |
| `check-intern-filter.mjs` | 核查实习岗是否漏过滤 | 一次性核对 | `test-hard-filter.mjs` 的实习用例 + `audit-live.mjs` |
| `check-insurance-filter.mjs` | 核查五险一金相关判定 | 一次性核对 | `audit-live.mjs` |
| `check-zhilian-data.mjs` | 校验新采集智联数据的字段完整性 | 一次性核对 | `verify-dashboard.mjs` + `audit-cities.mjs` |
| `check-payload.mjs` | 看板 HTML 内嵌数据是否完整 | 一次性核对 | `verify-dashboard.mjs`（内嵌推荐数、JD 覆盖率） |
| `audit-jd.mjs` | 打印指定推荐岗位的 JD 正文人工复核 | 一次性人工抽查 | 看板页面上直接点开岗位即可看 JD |
| `audit-recs.mjs` | 推荐结果质量抽检 | 一次性人工抽查 | 同上 |
| `audit-neg-samples.mjs` | 过滤项抽样核对 | 一次性人工抽查 | `audit-negatives.mjs`（每类抽样 4 条并打印） |
| `inspect-detail.mjs` | 查看 `data/zhilian-sample` 详情样本 | 依赖已删除的样本文件 | 不存在了 |
| `zhilian-detail-probe.mjs` | 探测智联详情页能否拿到 JD 正文 | 探测已完成，结论已固化 | 结论：智联列表 SSR 内嵌 `__INITIAL_STATE__.positionList` **已带完整 JD**，无需详情页 |
| `zhilian-paging-probe.mjs` | 探测智联分页参数与每页条数 | 探测已完成，结论已固化 | 结论：`sou.zhaopin.com/?kw=&jl=&p=<页>`，每页 20 条 |

补充：`zhilian-spider.mjs` / `51job-spider.mjs`（旧爬虫）与 `make-mobile.mjs`（从旧看板 HTML 还原数据做手机版）
也已删除——前者因**用户未授权爬虫抓取**，抓取改由 `cloud/fetch-all.mjs` 走平台官方接口完成；
后者因看板模板本身已适配移动端。
