# 任务 D② · 前端请求集中到 api/

**范围。** #136 已审查并合并；本 PR 基于 `3cc1b24`，目标 `v2`，无行为变化。按 #136 评论把全部已使用的后端请求迁到 `core/frontend/src/v2/api/`，按资源分文件；令牌、匿名凭据策略、错误转换、请求编号生成、快照查询与写请求封装各只有一处。没有增加未使用的接口。

**文件与格式化后行数（含空行）。** `api/` 新增 client.ts 45、requests.ts 15、catalog.ts 12、banks.ts 22、questions.ts 41、extensions.ts 15、sdk.ts 14、index.ts 18。现有 App.vue 355；views/PracticePage.vue 111、use-practice-page.ts 742；services/source-cache.ts 88、completion.ts 110；types/practice-types.ts 45。App、views、components 和 services 不再拼后端地址或调用 fetch；资源缓存通过资源接口取文件。构建 JS 同步更新，CSS 不变。诊断脚本 `v2-bank-return-probe-bundle.mjs` 仅把 overview 的源码锚点改为新调用。

| 资源文件 | 对应的既有接口 |
|---|---|
| catalog.ts | GET catalog |
| banks.ts | GET overview、POST refresh / finish、PUT results |
| questions.ts | GET 单题 / 图片、PUT answer / ink / result、POST submit / retry |
| extensions.ts、sdk.ts | GET manifest / 页面与评分源码、富文本 JS / CSS |

**兼容性与没改什么。** 后端、接口字段、锁凭证、solution 发送条件、持久化格式、沙箱与题型不变；保存延迟、排队顺序、冲突恢复、缓存作用域、401 清缓存、对象 URL 与白板生命周期不变。保存仍在首次出队时冻结编号/版本/正文，网络失败重发原字节；批量评分仍复用同一正文，仅被拒绝的非法结果另发新编号。refresh 不增添请求编号或快照字段。不增加依赖、保护机制、重试、sleep、跳过或超时，不开始 Pinia / Router；#136 指定的长组合函数拆分和 App 外壳精简分别留 D③ / D④。

**测试。** 新增 `frontend-api.test.mjs` 四项：JSON/源码/图片共用鉴权与取消；错误字段与 401/断网/无效 JSON；排队时取版本与失败后逐字节重放、独立 ink 版本；单题/批量/刷新报文。`source-cache.test.mjs` 只调整编译入口和加载夹具，原断言不变；其余现有测试和九个浏览器探针断言未改。本机 Windows、Node 24.13.0：151 项 V2 测试通过 / 0 失败 / 0 跳过；最终接口调整后相关 10 项再跑通过；类型、构建、构建一致性、格式、lint 通过（0 错误、37 条既有大小警告）。未做性能优化或计时收益归因；浏览器检查由 CI 执行，不是真机验收；未使用真实数据或启动/重启日常服务。

**CI。** 待首次运行后补齐五项 job 的结果、耗时及失败用例名单；不会在未核实结果前合并。

**存疑与后续。** 无新增产品决定。保留本 PR 等审查，不自行合并或开始 D③。
