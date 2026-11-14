# 任务 D① · 前端目录搬迁

**范围。** #133 已审查合并，基线 `50a5c51`。本 PR 无行为变化，只搬文件和修改引用：普通逻辑进入 `services/`；做题页与它的既有组合函数进入 `views/`；得分卡片进入 `components/`；练习类型进入 `types/`；全局样式进入 `styles/`。App 仍为外壳，V1/V2 共用的 `src/index.ts` 入口不动；`use-practice-page` 的拆分留到 Pinia 步骤。不建空目录或占位文件。

**文件与格式化后行数（含空行）。** 以下名称均相对 `core/frontend/src/v2/`；原文件除 App 外移到对应目录，保留原名。

| 位置 | 文件与行数 |
|---|---|
| `services/` | page.ts 331；grading.ts 301；save-policy.ts 179；write-queue.ts 27；source-cache.ts 102；whiteboard.ts 81；completion.ts 109；scoring.ts 35；outline.ts 56 |
| `views/` | PracticePage.vue 112；use-practice-page.ts 815 |
| `components/`、`types/`、`styles/` | FinalScore.vue 97；practice-types.ts 46；workspace.css 344 |
| 外壳 | App.vue 373 |

**兼容性与断言。** 不改请求、保存时机/排队、锁定、评分、沙箱、白板、页面样式或数据格式；不引入依赖，不拆长函数。九个测试文件只更新八个编译入口和规范范围中的 CSS 路径；四个开发脚本只更新题页/评分编译入口和测量钩子的路径匹配。归一化路径并格式化后，15 个源码文件的正文及现有测试/脚本断言与基线完全相同；未加重试、sleep、延长超时或改断言。

**构建字节验证。** 与基线的生成文件做 `Buffer.equals`：JS、CSS 均相等，未产生构建成品差异。SHA-256 分别为 `9f157772dcc6df00b7a9822c2c3258a8e4edf739b702761b8043823a0d3c2817`、`f3c3f5870ec6925ee96005ffb0e2a4bdcb4dbc665fee51e98bfdcc8145867c61`。没有性能收益归因。

**本机验证。** Windows、Node 24.13.0；147 项 V2 测试通过 / 0 失败 / 0 跳过；类型、构建及构建一致性通过；格式、lint 通过，0 错误、37 条原有大小警告。这一步原样保留长函数，后续按 D③ 与任务 F 拆分。本机未重跑包含旧 V1 权限失败的完整默认套件，完整套件与九项真实浏览器探针由 CI 执行；不是手机真机验收。只用合成夹具，不启动日常服务或使用真实数据。

**CI。** [PR #136](https://github.com/lear111/quizforge_web/pull/136)，目标 `v2`，待审查。实现提交 `bb057c8` 的[首次运行 43582772246](https://github.com/lear111/quizforge_web/actions/runs/43582772246) 全绿，失败用例名单为空。Ubuntu 的 34 项跳过是原有 Windows 专项；本次未新增跳过。

| Job | 通过 / 失败 / 跳过 | 总耗时 |
|---|---|---|
| Checks · Ubuntu | 1374 / 0 / 34，类型与构建通过 | 93 s |
| Checks · Windows | 1408 / 0 / 0，类型与构建通过 | 252 s |
| Performance · Ubuntu | 2 / 0 / 0 | 23 s |
| V2 code quality · Ubuntu | 格式通过；0 错误、37 既有警告 | 23 s |
| V2 browser checks · Ubuntu | 九项全部通过 | 169 s |

**后续。** 本 PR 等审查；后续按 D② api → D③ Pinia → D④ Router → D⑤ 组件解耦推进，不提前做后续任务。
