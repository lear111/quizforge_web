# 任务 D③ · Pinia 状态与跨组件流程

**范围与行为。** #137 已审查合并（`43927c1`）；本 PR 基于该提交，目标 `v2`，无行为变化，待审查，不自行合并。Pinia 4.1.0 进入 `dependencies`；每个应用创建独立 Pinia，目录、练习、界面分别归 `catalog`、`practice`、`ui` store。删除 742 行的 `use-practice-page.ts` 与 `defineExpose` / 组件引用调内部方法的桥接。打开、切题、刷新、保存、冲突恢复、评分、完成练习由 store 动作协调；视图只读状态、转发事件、交付 DOM 容器。每个 store 私有的运行句柄保存 iframe、队列、资源缓存与白板，不放模块级可变单例，也不代理 DOM。

**文件与格式化后行数（含空行）。** `App.vue` 128、`main.ts` 11、`views/PracticePage.vue` 84、`types/practice-types.ts` 46、`types/practice-session.ts` 89；`stores/` 中 practice 55、catalog 28、ui 29、actions 52、question-state 56、banks 159、saving 148、recovery 97、scoring 152、completion 104、page 182、runtime 79。入口接回既有 UI 导出；更新依赖锁、生成 JS 和许可说明（Vue、Pinia、nostics）；CSS 不变。构建成品退库仍留 G，不在此改 CI。诊断工具只迁移源码锚点到新文件，构建检查通过。

**审查补充。** `practice-types.ts` 改为文件头 `import type { PracticeApi }`。新增前端 ESLint 层级规则及测试：`views/components → stores → api/services`，禁止下层反向导入和非 API 层的 `fetch`（含别名、成员、解构、静态计算属性）；覆盖静态、动态、重导出、类型、require 导入。公共类型及 API/services 间既有底层引用允许，`main.ts` 仅作为组装入口。旧 V1 组件与白板不改。

**兼容性与明确没改什么。** 未改任何后端、API 报文、响应 JSON、状态码、规则输入、版本号、回执或持久化格式；未改 solution 发送条件、锁定/重做保证、题型沙箱、SDK 或题库。保存延迟仍为 0/1000/1500/10000 ms；保存首次出队才固定请求编号/版本/正文，失败原字节重放；切题与切库仍先等保存及队列，失败留在本题；评分后更新现有 iframe。资源缓存作用域、401 清缓存、对象 URL、白板与评分环境的释放顺序不变。未加重试、sleep、跳过或超时；不开始 Router、组件样式拆分、归档、历史或打包。本 PR 不作性能优化或收益归因。

**新增用例。** `frontend-stores.test.mjs` 五项：多应用隔离；保存响应保留较新的大纲状态与缺省笔迹；目录折叠及忙碌/错误清理；真实保存控制器与写队列完成前不读下一题；保存失败保留未保存内容并阻止切题。`frontend-layers.test.mjs` 三项覆盖依赖方向、允许路径、fetch 限制。既有测试与九个浏览器探针断言均未改。

**本机验证。** Windows 11（10.0.26200）、Node 24.13.0。新增 8 项通过 / 0 失败；类型、构建与成品一致性、格式通过；lint 0 错误、35 条大小警告（长服务函数留 F）。九个原有浏览器探针原断言全部通过，含桌面/手机尺寸；临时 Playwright 所需 Chromium 未安装，本机使用已有 Chrome 157.0.8103.39，CI 仍用 Chromium。这不是手机真机或发版验收；不使用真实数据，不启动/重启日常服务。

**本机完整测试的限制。** `npm test` 为 1409 通过 / 11 失败 / 0 跳过，938.45 s，未声称全绿。失败位于未改动的 `server/host/` 下 `ai/hub-connection.test.mjs`（68/88/96/114/133/160 行，AI 设置访问保护失败）、`ai/settings-provider.test.mjs`（32/54 行，同上）、`http/server.test.mjs`（290 行，503≠200）；另有 `extensions/rule-engine.test.mjs`（99 行，前台排队断言）与 `server/rules-runner.test.cjs`（281 行，spawnSync ETIMEDOUT）。后两文件以 `node --import ./core/scripts/test/test-environment.mjs --test --test-concurrency=1` 单独复核：42 通过 / 0 失败 / 0 跳过，79.24 s，表明负载敏感，不能据此把整套判为通过。没有修改这些生产文件或测试；两系统 CI 完整测试均无失败。

**CI。** [PR #138](https://github.com/lear111/quizforge_web/pull/138)，目标 `v2`，待审查。[实现提交 b391c4e 的首次运行 43590832008](https://github.com/lear111/quizforge_web/actions/runs/43590832008) 五项全绿，CI 失败用例名单为空。Ubuntu 34 项跳过均为既有 Windows 专项，本次未新增跳过。下表是 job 总耗时；仅文档补交后再核对最终提交。

| Job | 通过 / 失败 / 跳过 | 耗时 |
|---|---|---|
| Checks · Windows | 1420 / 0 / 0；类型与构建通过 | 270 s |
| Checks · Ubuntu | 1386 / 0 / 34；类型与构建通过 | 153 s |
| Performance · Ubuntu | 2 / 0 / 0 | 65 s |
| V2 code quality · Ubuntu | 格式通过；0 错误、35 大小警告 | 44 s |
| V2 browser checks · Ubuntu | 九个原有探针全部通过 | 216 s |

**存疑与后续。** 无新增产品决定；本机旧测试失败不在本次改动范围，未改变断言或超时。保留 PR 等审查，不自行合并或开始 D④。
