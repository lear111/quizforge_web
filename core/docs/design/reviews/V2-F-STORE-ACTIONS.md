# F⑥：Store 动作与依赖关系整理

**状态：实施完成，待代码审查，不自行合并。** 从最新 `v2` 的 `c1dcd48` 建立 `refactor/v2-store-actions`；F①–⑤ 已合并。依据工作流程第 8 节、进度页 F 的动作收口范围、D48 的分层，以及接口速查中目录/概览/单题、保存、完成练习约定。只整理已接通的 Store 调用关系，不实施待开发功能；按本次指令不修改 `V2_PROGRESS.md`，F⑦/I② 不开始。

**调用关系与职责。** 原 Pinia 将 `createActions(session)` 的 35 个方法全部公开，内部辅助动作与视图动作没有区分。现由 `PracticeViewActions` 声明 15 个视图/Router 动作，`PracticeActions` 继承并增加 19 个内部动作；`actions.ts` 中的 `viewActions` 只选取已有函数引用，不再包装、绑定或创建异步转发。Session 继续持有完整动作表，Store 只发布选出的 15 项：

| 使用方 | 对外动作 |
|---|---|
| WorkspaceNavigation | `catalog`、`openBank`、`navigate`、`flush`、`clearQuestion`、`resetSources`、`pageFaulted` |
| PracticePage | `attachView`、`detachView`、`retrySave`、`continueGrading` |
| WorkspaceToolbar | `refreshBank`、`toggleDraft` |
| WorkspaceView | `complete`、`resumeCompletion` |

内部保留 `update/context/applyCompletion`、`pictures/disposePage/applyContext/show/scopeSources`、`createSaver/reloadAfterConflict`、`score/grade/submit/retry/recoverPending/reloadCompletedQuestion/gradeCompleted`、`initializeRuntime/remember`。这些绑定将同一个 Session 交给各模块，页面回调、保存及评分用 `ctx.actions()` 取得它们；保留原来的延迟绑定和回调查找，不改模块交互、生命周期或执行顺序。

**删除、保留与调用方清单。**

| 原调用/参数 | 调整后及理由 | 修改的实际调用方 |
|---|---|---|
| `navigation.start → initializeCatalog → banks.initializeCatalog → actions.catalog → banks.catalog → ui.run → catalogStore.read(api) → api.catalog.get` | 删除无状态的 `initializeCatalog` 两层绑定/转发；启动直接走现有 `catalog`，保留列表读取完成后再恢复地址的顺序 | `router/navigation.ts` 的 `start`；`stores/practice/actions.ts`、`banks.ts`；类型声明 |
| `loadLocation → practice.openBank('bank', id, questionId) → banks.openBank(ctx, kind, id, questionId)` | 删除 Store 未使用的 `kind`；可选 `id` 的无值不操作行为、指定题号、上次位置、flush 屏障和错误恢复不变 | `router/navigation.ts` 的 `loadLocation`；动作绑定和类型 |
| `catalogStore.read(整个 PracticeApi)` | 仅传同一实例的 `api.catalog`，类型也缩窄；`get()` 的接收对象仍是原 catalog，async/await 与鉴权成功清除时点不变 | `banks.catalog`、`stores/catalog.ts`、`PracticeSession.catalogStore`；原测试夹具 |
| 通用列表 `open(kind, bankId?) → navigation.openBank(kind, bankId?)` | **保留**：共享 LibraryList 的组件事件形状；Router 仍接受该适配签名，未改组件/事件/导航接口 | 无修改；全仓核对后仅移除进入 Store 的占位参数 |
| `catalogStore.read` 与 Session 动作表 | **保留**：目录 Store 负责列表映射；API 由 Practice Store 创建并持有，不能为了消除参数而让 catalog 反向引用 practice 或另建 API | 没有增加依赖层、模块循环、API 实例、注入容器或可变配置 |

改动文件共 9 个：上述 6 个生产文件（`stores/practice.ts` 只调整导入和返回对象，其他装配不变）、原 `frontend-stores.test.mjs`、新增 `frontend-store-actions.test.mjs`、本文。旧测试中 update/context/remember 改由基于相同 Pinia refs 的 Session 动作调用；列表夹具缩窄为 catalog 资源，既有 5 项用例的全部断言保留。其余前端调用方无需修改，Vue 类型检查覆盖所有实际使用者。

**明确没改什么。** 未改 HTTP/API 客户端实现、后端、状态格式、题型协议、保存/评分/白板/沙箱/缓存机制及 UI；未改 `completedAt` watch 或地址同步逻辑（Router 仅上述两处调用适配）。每个 Practice Store 仍创建一个 API、一个 runtime/queue 和一个 Session，当前令牌 getter、401 后的清源回调、Pinia 实例隔离、挂载/卸载时点均原样。无新依赖、断言转换、缓存策略、重试或性能优化。未删减/跳过/放宽测试，未更新标准答案，未部署、打包、访问真实题库或中断日常服务；构建生成物不提交。

**回归与本机结果。** 新增 6 项：① 对外 15 动作与内部辅助不再暴露；② 启动只读目录、空地址不开库、换令牌后复用原 catalog 对象；③ 401/断网保留旧列表，成功后才清鉴权状态；④ 多 Pinia 隔离 transport/令牌/列表；⑤ busy 时不重复读取且不提前清鉴权；⑥ 缺 bankId 不请求、去掉 kind 后打开指定题库。原 Router 16 项覆盖指定题/返回位置、前进后退、保存与排队、失败留题留地址、快速切换、故障页重开、登录后恢复和汇总；原浏览器探针覆盖实际切题/切库/刷新、完成与继续评分。

Windows 11 / Node 24.13.0：UI/后端 TypeScript、构建及 `--check` 通过；格式 204 文件无差异，lint 195 文件、0 错误/19 项既有警告。完整 V2 213 通过 / 0 失败 / 0 跳过（84.16 s，不作性能对比），十个既有 Chrome 探针最终结果与 CI 表将在验证完成后补入。本机不重复旧版全仓测试，由 CI 两平台运行完整套件。仅使用合成数据、受控 Promise 和独立回环服务，浏览器视口检查不代表真实手机验收。

**风险与保留边界。** 主要风险是遗漏 Store 调用方和缩窄 catalog 参数时改变鉴权引用，分别由全仓引用核对、Vue 类型检查、真实 API/Router 的回归及浏览器测试覆盖。对外 Store 动作的收口会让未列入仓库的开发调试脚本无法再调用内部方法；内部模块继续经 Session 使用。启动只删除无状态别名的异步转发，不调整导航守卫或新增并发策略；本次不声称性能收益。

**CI：等待运行。** PR 正文与本文保持一致，最终五项 job 结果和失败名单将在此补全；提交后不合并。
