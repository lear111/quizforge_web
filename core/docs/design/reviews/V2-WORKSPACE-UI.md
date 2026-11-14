# I：定稿原型接入练习空间

**状态：[#150](https://github.com/lear111/quizforge_web/pull/150) 实现待审查，不自行合并。** #149 已审查合并；基于 `2472231`，目标分支 `v2`。按 `V2_UI_PROTOTYPE.md` 的定稿源码实现，含第 2 版已确认的侧栏调宽；不实现候选纸面主题。界面与导航为 `7518098`，检查与 CI 为 `1a80701`。

**改了什么 / 文件清单。** `frontend/src/v2/styles/{tokens,workspace,sidebar}.css` 集中原型颜色；既有 WorkspaceLibrary/Toolbar/Mobile/Outline、FinalScore、WorkspaceView/PracticePage 及其 scoped CSS 接入 56px 三栏、256/244 默认侧栏、760px 题卡、两侧固定翻页、五种状态色和三项图例。复用 LibraryList、OutlinePanel，补 `WorkspaceIcon`、`SidebarResize`、`QuestionNavigation`；宽度、收起状态归 `stores/layout.ts`，浏览器宽度读写在 `services/sidebar-layout.ts`，类型在 `types/layout.ts`。宽度分别限 200–420/200–380，支持鼠标、16px 方向键、双击复位及重开记忆；900px 及以下是 280px 抽屉、遮罩关闭。保留当前题库刷新图标；手机第二行只放草稿/刷新，不重复题库标题。

`router/navigation.ts` 允许未完成练习查看汇总，继续走原 flush/失败留题守卫；`stores/practice.ts` 仅让汇总时题号不显示当前题外圈。汇总居中、可返回原题；完成练习入口从顶栏移来，原确认文字、complete/评分/锁定流程不变。白板仍调用 V1 实现，适配器把翻页按钮作为既有 toolbarObstacles；其旧声明误写为矩形数组，按实际 JS 的 getBoundingClientRect 调用纠正为 HTMLElement iterable，未改白板 JS。

**明确没改什么。** 后端、共享接口/错误码、响应 JSON、规则输入、版本号、回执、持久化格式、数字字面量、保存时机与锁定、solution 发送、沙箱、题型代码、真实数据均未改。启动空地址仍不加载题库；导入/新建、设置、获取题库、进行中圆点、考试、再练一次等隐藏项不出现。原题卡与答题内容仍由题型负责，不把原型假数据或脚本搬进宿主。不开始 F/J，不打包、部署或重启日常服务。

**构建。** 按工作流程不提交新生成的 UI 成品；旧成品的清理留 G。本 PR 在两系统 Checks 的原 `build:ui -- --check` 前新增源码构建，保留一致性检查与所有其他门槛；浏览器 job 原本就先构建。源码检出后先 `npm --prefix core run build:ui` 再启动，不能用旧成品判断本次界面。

**断言调整与新增验证。** 既有运行时断言保留，例外仅是明确改变的界面/路由行为：

| 文件 | 调整 |
|---|---|
| `probe-v2-completion.mjs`、`probe-v2-router-views.mjs` | 完成前先进入大纲的汇总；“最终得分”改选 `.v2-summary-entry`；“查看题目”改“返回题目”；标题“本轮练习已完成”改“练习已完成”。取消、锁定、批量评分、相同回放正文、同 iframe、回看草稿等断言含义不变 |
| `frontend-router.test.mjs` | 一项旧“未完成汇总退回题目”预期按 D45 改为“允许当前汇总、仍未完成且可回题”；新增两项真实保存队列成功/失败的汇总守卫测试，不用桩代替守卫 |
| router 探针新增两个 workspace helper；whiteboard 探针 | 实际拖动/两侧上下限/键盘/复位/持久化、收起、900/901 分界、抽屉遮罩、五色/虚线/图例、上一/下一/最后一题去汇总、刷新当前汇总不发送 finish/results、不锁定、返回同 iframe、居中；白板工具条不遮挡翻页 |

**本机验证。** Windows 11、Node 24.13.0；V2 完整回归 181 通过 / 0 失败 / 0 跳过，44.29 s。UI/后端类型检查、构建及产物一致性通过；格式 171 文件无差异、lint 162 文件 0 错误/36 条既有大小警告；性能回归 2/0，4.43 s；十个既有 Chrome 探针全部通过，已检查桌面做题/汇总和手机做题/两侧抽屉截图。只用合成基础题型与隔离回环服务，桌面/手机尺寸不等于真机验收。新增浏览器用例最初误以为“只浏览后重开汇总”会记住第 3 题；对照 D32 修正为回首题（只保存/提交/重做才存位置），未改实现或既有断言。本次不是性能优化，不声称速度收益。

**数据缺口。** 目录接口没有题数，不伪造 0、不额外遍历或逐库请求：当前已打开题库显示实际大题数，其余仅名称；原型元素表同步注明。若需所有题库直接显示题数，另定目录字段与读取成本。#149 的 80 处断言收口、health.phase 删除已记到 F，当前不改。

**CI。** 实施提交 `3d4cd54` 的[运行 43633018121](https://github.com/lear111/quizforge_web/actions/runs/43633018121) 五项全绿，失败用例名单为空；Ubuntu 34 项跳过是既有 Windows 专项，未新增跳过。此后补本记录，并把遮罩/阴影原值移到颜色变量（数值不变），最终提交再核对同一门槛。

| CI job | 通过 / 失败 / 跳过及结果 | Job 总耗时 |
|---|---|---|
| Checks · Windows | 1442 / 0 / 0；UI/后端类型、源码构建及产物一致性通过 | 287 s |
| Checks · Ubuntu | 1408 / 0 / 34；同上 | 126 s |
| Performance · Ubuntu | 2 / 0 / 0 | 15 s |
| V2 code quality · Ubuntu | 格式 171 文件无差异；lint 162 文件，0 错误/36 既有警告 | 12 s |
| V2 browser checks · Ubuntu | 十个探针全部通过（含新 workspace 检查） | 179 s |

**试用（审查合并后）。** 先保存并手动关闭旧演示服务（同一数据目录不要同时运行两个服务）；在本工作目录运行 `npm --prefix core run build:ui`，再运行 `node core/server/v2-main.mjs --root examples/v2 --port 8794`；访问 `http://127.0.0.1:8794/`，展开基础题型、打开题库，检查侧栏调宽、两侧翻页、汇总/完成入口及手机抽屉。测试结束用 Ctrl+C 关闭。本任务没有执行这些人工试用命令或重启日常服务。
