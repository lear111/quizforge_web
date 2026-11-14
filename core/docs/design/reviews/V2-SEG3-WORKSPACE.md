# 第 3 段：拆分练习主页面

`App.vue` 保留题库列表、顶栏、大纲、题库与题目导航；`PracticePage.vue` 管理题页、白板与保存状态。做题页从外壳接收请求前缀，当前仍请求 `/api/v2/banks/:id`，后续历史回看可使用自己的前缀。两份 Vue 文件分别为 88、21 行，原页面样式移到 `workspace.css`。

- 文件：`frontend/src/v2/{App.vue,PracticePage.vue,practice-types.ts,use-practice-page.ts,workspace.css}`，重建 `web/ui/quizforge-ui.js`。`scripts/dev/v2-bank-return-probe-bundle.mjs` 的计时标记跟随源码搬家，浏览器断言不变。
- 不改变题页通信、沙箱、保存顺序、请求和响应、评分、白板行为及磁盘格式；`page.ts`、`grading.ts`、`save-policy.ts` 保留原样。D41 与「完成练习」同交；历史和汇总未实现。
- 验证：类型检查、UI 构建一致性和差异空白检查通过；原有 `page`、`page-contract`、`grading`、`page-review`、`practice`、`save-recovery`、`whiteboard`、`basic-types` 八份 Chrome 157 脚本通过（桌面及手机视口、合成题库）。`basic-types` 首次因画笔按钮点击超时失败，原样单独重跑通过，未改断言或超时。切回测量的 `--phases` 脚本亦通过，证明搬家后的计时点可用；与多份完整测试并发，数据不作性能对比。
- 本地完整测试：多份套件并行时出现旧规则进程/启动用例超时，之后卡住，已停止本次测试进程；未完成，不能记为通过。CI 的两个系统完整套件与性能 job 结果另行记录，不放宽测试。
- 实现提交 `51efb7d` 的 [CI](https://github.com/lear111/quizforge_web/actions/runs/43537118136) 三项通过：Windows 1350 通过 / 0 失败（3m3s），Ubuntu 1316 通过 / 0 失败 / 原有平台跳过 34（1m24s），性能 4 通过 / 0 失败（31s）。构建产物 246001 字节、gzip 84959 字节，相比拆分前分别增加 1550、603 字节；不以此宣称提速。
- 后续：按 #107 的审查意见，历史复用查询路径时，保留 `Server-Timing` 的分段能力，明确区分历史读取新增开销。此项留待历史 PR 验证。
