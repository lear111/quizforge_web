# F⑦：完成状态与路由同步整理

**状态：实施完成，待代码审查，不自行合并。** 从最新 `v2` 的 `14e6ad1` 建立 `fix/v2-completion-routing`。依据 [#140 审查意见](https://github.com/lear111/quizforge_web/pull/140#issuecomment-6878898252)、D40/D42 的完成与重载、D45 的汇总入口以及 D48 的 Vue Router 分层。保留已批准的单向导航，修复隐式切页；不更新 `V2_PROGRESS.md`，不开始 F⑧/I②。

**现状与复现。** 原 Store watch 监听 `overview?.completedAt` 的值（相同值不触发），直接写 `ui.scoreView = !!value`，没有 Router 调用。所有生产触发来源：① banks 的打开/刷新替换概览及打开失败回滚；② `applyCompletion` 的 Object.assign（finish 成功、丢响应后确认成功、批次结果）；③ `resumeCompletion` 重读概览（新的完成时间或记录已被清空）；④ `reloadAfterConflict` 在 ROUND_COMPLETED/快照冲突时回读概览、题库已移除时清空概览；⑤ Router 回到目录时清空 overview。打开/刷新和目录导航本来就显式选择视图，watch 重复介入；完成、继续评分和冲突回读的数据更新则可能在异步流程内擅自切页。

新增真实 Chromium 复现：合成 B 库保存一道单选答案 → 用独立请求模拟另一标签页完成 → 本页刷新进入汇总 → 返回题目 → 继续评分时返回不同的合法完成时间，并让批次写入返回 503。改动前 hash 仍是 `/banks/B/questions/1`，题卡却被隐藏、汇总出现；浏览器断言 `.v2-card.isVisible()` 得到 false。完成时间变化由测试路由替换响应字段模拟，不改变后端或磁盘业务逻辑；批次失败保留待评分以观察稳定状态。另有真实 Pinia/Router 的数据到达测试，改动前 4 项中 2 通过 / 2 失败：完成时间增加和清除都会在不改地址时切页。先复现、再改实现，日志仅放忽略目录。

**修改前后状态流转。**

| 路径 | 调整后 | 保留的行为 |
|---|---|---|
| 任何 `completedAt` 数据更新 | 删除 Store watch，单独更新完成元数据不再改变视图 | 锁定、结果、待评分、权限仍由原数据与流程决定 |
| 汇总页“完成练习” | 原 complete 等待结束后显式 `navigation.showSummary()`，不用 watch 推断页面 | D45 的按钮仍只在汇总页；确认、flush、锁定/评分、失败留在汇总均不改 |
| 汇总页“继续评分” | 等待原动作后，仍完成则 showSummary，记录已清空则 showQuestion | 保留发现外部重置后返回新题的原行为，改为经 Router 执行 |
| 题目页“继续评分” | 原 Store 评分动作仅更新数据，保持题目视图和地址 | 不新增跳转、评分重试或保存策略 |
| 保存冲突回读 | 保留原问题回读、锁定页面更新和错误提示，删除 watch 的无地址隐式切页 | 不修改 recovery、保存控制器、写队列或冲突处理语义 |
| 打开/刷新题库 | 保留 banks 显式的 scoreView 选择；刷新后 Toolbar 仍调用 showCurrent；直接题目/汇总地址由原 guard 处理 | 普通打开已完成库默认汇总，显式题目地址仍看题；刷新未完成库回题目 |
| 打开失败回滚 | 立即恢复原概览与 scoreView，删除等待 watch 的 nextTick | 原旧题、输入和视图回滚条件不变 |

Router 的守卫、pending/pushing、flush 屏障、地址编码、失败取消、直接地址/前进后退及连续导航处理全部原样，仅更新 showCurrent 的注释。没有增加反向监听、双向同步、全局事件、框架、标志位、缓存或保护机制。视图只调整两个导航调用，模板与布局不变；未修改任何保存或评分函数。

**文件与测试。** 共 9 文件：`stores/practice.ts`、`stores/practice/banks.ts`、`views/WorkspaceView.vue`、`router/navigation.ts`（仅注释）；`frontend-stores.test.mjs` 与新增 `frontend-completion-routing.test.mjs`；既有 `probe-v2-router.mjs` 与新增 `probe-v2-completion-routing.mjs`；本文。Store 原实例隔离用例改名并把“仅更新完成时间后 scoreView 为 true”改为 false，这是本任务明确移除的旧行为；其他断言原样保留，新增回归明确锁定新语义，不放宽断言。

新增单元 5 项：完成元数据到达不自动离题；清空完成状态不自动离开汇总；显式题目/汇总的前进后退；刷新发现完成/未完成两种情况分别与竞争地址变更交错，busy 时拒绝竞争导航，结束后页面/地址一致。使用真实 Pinia Store 和 Router，数据到达用直接赋值模拟，刷新使用真实 Store/API/guard、受控响应，不用假 watch 或假导航返回值。原 Router 16 项保留（保存失败保留地址、连续切题、深链接、重开、回滚等）。

浏览器新增步骤接入原 router 探针，在桌面/手机视口各验证：外部完成后继续改答案收到真实 409，回读锁定题而不丢地址；本页刷新进入汇总；返回题目后时间变化且评分失败仍留题；在汇总继续评分时合成记录被清空，转入新题并刷新仍一致；重新打开已完成 A 库默认汇总，返回题目后刷新仍留题。只删除已验证位于该测试临时根内的 B 库记录，不碰真实数据。原完成探针与其他浏览器断言全部保留。

**本机结果。** Windows 11 / Node 24.13.0：UI/后端类型、构建及一致性、格式 206 文件无差异；lint 197 文件、0 错误/19 既有警告。完整 V2 218 / 0 失败 / 0 跳过（71.91 s，不作性能对比）；最终相关单元 26 / 0，全部十个既有探针通过（page、page-contract、grading、page-review、practice、save-recovery、whiteboard、basic-types、completion、router），router 包含新增桌面/手机视口回归。本机不重复旧版全仓测试，CI 两平台运行完整套件。真实 Chromium 视口不代表真机验收。

**明确没改什么与风险。** 未改后端/HTTP、持久化/标准答案、自动保存、评分、白板、题型协议、安全沙箱、页面布局、I② 或其他断言清理；不部署、打包或重启日常服务。构建成品不提交。主要风险为曾依赖隐式 watch 的继续评分与异常恢复，已对照全部完成时间赋值点、视图调用与旧回滚覆盖；未来新加更改完成状态的入口也须显式选择 Router 动作，不能恢复数据反向驱动切页。本次没有新产品行为待决。

**CI：等待运行。** PR 正文与本文一致，五项 job、失败名单及耗时将在验证完成后补入；提交后不合并。
