# I②（D64）：第三版前端原型适配

**状态：已审查并合并到 `v2`，等待负责人试用。** PR [#170](https://github.com/lear111/quizforge_web/pull/170)，审查记录 #5911681782，五项 CI 全绿，2026-11-15 squash 合并提交 `73a4051`。 基于 `v2` 的 `0ad25e4`，分支 `feat/v2-ui-prototype-3`。依据第三版 `prototype/quizforge-v2-mobile-overlay-bottom-nav-animated.html`、`V2_UI_PROTOTYPE.md` 第 3/5 节、D45/D63/D64 与工作流程；不参考旧第二版画布。当前只接入宿主界面，AI 辅导、考试、历史和设置仍待各自任务，不开始 G/H/J。

**改动与职责。**

- `LibraryList` / `LibraryNode` 递归传递可选 `animateGroups`，仅 V2 显式打开；新增 `LibraryGroupTransition` 用网格行高度 300ms / 透明度 220ms 展开收起，保留原子节点及选中/展开数据。V1 默认仍渲染原 div/hidden，无新增包裹，测试检查 keyed 行身份与原折叠行为。
- `styles/sidebar.css` + 两个 Workspace 侧栏：桌面宽度 320ms / 透明度 240ms，收起宽为 0；内容按原侧栏宽度裁剪，不在收放中挤成多行。`SidebarResize` 拖动时关闭宽度过渡以直接跟手；默认 256/244、范围 200–420/200–380、持久化、双击与键盘每次 16px 不变。
- `WorkspaceView` / `workspace-panels.ts` / `layout.ts`：≤900px 固定 280px 左右抽屉，覆盖整个视口含顶栏，位移 340ms、全屏遮罩 280ms；关闭立即 inert / 不接收点击，过渡结束才 visibility:hidden。一次一个抽屉；遮罩/Esc 关闭、焦点返回开关。断点变化关闭抽屉并保留桌面调宽/收起偏好；监听在卸载时移除。只新增显示状态，不触碰练习状态。
- 删除重复 `WorkspaceMobile`，统一 `WorkspaceToolbar` 为唯一 56px 顶栏：两端开关、截断的题库信息、草稿、原刷新功能；三栏分隔线对齐。`QuestionNavigation` 的原两个按钮包进同一 nav：>600px 仍为侧边；≤600px 采用独立 flex 底栏（76px + 安全区，按钮 48×52），压缩滚动视口，题目与白板工具不用叠在底栏后。汇总页不渲染翻页带。
- `prefers-reduced-motion: reduce` 关闭分组、侧栏、抽屉与遮罩过渡，无新增依赖。同步原型元素表，修正旧表中已移除的当前题库题数说明；不把未实现业务标为完成。

**明确没改什么。** 后端、API/共享类型、保存/提交/锁定/评分/恢复、Pinia 练习动作、题型 iframe 与接口、Vue Router URL、题库和持久化格式、白板工具和坐标逻辑均无差异；刷新题库继续走原动作。原按钮的导航事件/禁用条件不改，末题进入汇总、切题先 flush、失败留在原题、前进后退与刷新恢复由原业务断言验证。未改 `V2_PROGRESS.md`，未提交构建成品，未动日常服务或使用真实练习数据。

**测试与兼容性。** `library-motion.test.mjs` 新增一项 V1 原 DOM/hidden/keyed 状态回归；原业务断言保留。新增 `probe-v2-workspace-motion.mjs` 接入原 router 浏览器检查，真实 CSS 动画暂停到中点取样再结束，不加固定 sleep/重试：验证 300/220、320/240、340/280ms、收起后主区不留宽度、焦点/点击隔离、唯一顶栏、900/901 和 600/601 边界、移动抽屉与桌面偏好切换、76px 底栏/按钮尺寸、提交按钮可滚到可见位置、草稿工具不被底栏覆盖且被抽屉遮罩隔离、减少动态效果。旧脚本中“再次点被遮住的顶栏以关抽屉”改为原 Esc，分组展开判断改用 aria-expanded；断言含义不变。等待实际 CSS 结束再测静态尺寸，避免过渡中几何浮点值和反向动画缩短造成错误判断。

Windows 11 / Node 24.13.0 / 本机 Chrome（真实浏览器，隔离合成数据与回环端口）：

| 检查 | 结果 |
|---|---|
| 完整 V2 单元测试 | 224 通过 / 0 失败 / 0 跳过；56.62s |
| UI + 后端严格 TypeScript | 通过 |
| lint / 格式 / 构建及 --check | 0 错误、19 条既有警告；212 文件无格式差异；通过 |
| 十个既有浏览器探针 | page、page-contract、grading、page-review、practice、save-recovery、whiteboard、basic-types、completion、router 全部通过 |
| HTML / Vue 对照截图 | 桌面 1440×900、手机 390×844；截图脚本无页面错误 |
| 本机默认完整测试 | 1474 通过 / 11 失败 / 0 跳过；750.01s，退出码 1，失败清单见下 |

本轮最初的浏览器失败来自旧脚本点击已被全屏抽屉遮住的顶栏；改为 Esc 后原保存/失败恢复断言通过。新增测试开发时修正了 V1 fixture 的折叠键前缀及实际事件归属，生产 V1 逻辑未改。

本机默认测试未全绿，失败均在未改动的 V1 路径；没有为此修改代码/配置、重试策略或断言。前 9 项与归档 `archive/reviews/V2-P1-1.md` 的本机凭据访问保护问题一致，本次没有逐项在干净基线复跑，不将其说成本次重新证明的基线结果。另 2 项在测试负载结束后以 `--test-concurrency=1` 单独运行原文件一次，2 文件共 9/0/0，保留初次失败事实，不用于代替完整结果：

| 测试文件（相对 core） | 失败用例 / 首条错误 |
|---|---|
| server/host/ai/hub-connection.test.mjs:68 | completing login saves only the device token, reads quota, and logout revokes it；AI_SETTINGS_SAVE_FAILED，无法完成 AI 设置文件的访问保护 |
| 同文件 :88 | a token the Hub rejects logs this computer out；同上 |
| 同文件 :96 | the free quota grades through the Hub gateway with the device token and keeps custom settings；同上 |
| 同文件 :114 | gateway errors become clear, non-retried messages and a rejected token logs out；同上 |
| 同文件 :133 | with both sources on, the free quota grades first and the custom model takes over when it cannot；同上 |
| 同文件 :160 | settings saved with one source before this version keep working；同上 |
| server/host/ai/settings-provider.test.mjs:32 | AI settings preserve masked-key editing and owner-protected saved credentials；同上 |
| 同文件 :54 | disabled AI remains disabled across persisted settings reload without losing automatic preference；同上 |
| server/host/http/server.test.mjs:290 | Hub login starts on the host only and the loopback callback finishes it without exposing the token；503 !== 200 |
| server/host/library/library-archive.test.mjs:30 | format 3 round-trip preserves code and repeated imports always create independent copies；rename EPERM；单独复查通过 |
| test/extensions/short-answer-rules.test.mjs:22 | manual review accepts half points and never invents a score before confirmation；规则子进程 spawnSync ETIMEDOUT；单独复查通过 |

**CI 证据。** [PR #170](https://github.com/lear111/quizforge_web/pull/170) 实施提交 `6d68e3c` 的[运行 43732458896](https://github.com/lear111/quizforge_web/actions/runs/43732458896) 五项全绿，CI 失败用例名单为空。Ubuntu 34 项是既有 Windows 专项跳过，未增加跳过。PR 正文与本文同步，此后仅补本文并核对最终提交五项 CI，不自行合并。

| CI job | 结果 | Job 总耗时 |
|---|---|---|
| Checks · Windows | 1485 通过 / 0 失败 / 0 跳过，UI/后端类型及构建通过 | 243s |
| Checks · Ubuntu | 1451 / 0 / 34，类型及构建通过 | 98s |
| V2 code quality · Ubuntu | 212 文件无格式差异，203 文件 lint 0 错误/19 既有警告 | 18s |
| V2 browser checks · Ubuntu | 原十项探针全部通过，含新增动效与断点断言 | 191s |
| Performance · Ubuntu | 2 / 0 / 0 | 25s |


**视觉证据。** 以下是当前确认 HTML 和真实 Vue 页面；题目/题数不同是原型假数据与公开基础展示库的区别。只比较宿主布局，不在本任务复制原型的考试、设置、导入等占位功能。图片位于 `reviews/screenshots/v2-ui-prototype-3/`：

| 场景 | 第三版 HTML | 当前 Vue |
|---|---|---|
| 桌面 1440×900 | [原型](https://github.com/lear111/quizforge_web/blob/6d68e3c940ab7e2c075a83b188baf6dc3b506589/core/docs/design/reviews/screenshots/v2-ui-prototype-3/desktop-prototype.png) | [宿主](https://github.com/lear111/quizforge_web/blob/6d68e3c940ab7e2c075a83b188baf6dc3b506589/core/docs/design/reviews/screenshots/v2-ui-prototype-3/desktop-vue.png) |
| 手机 390×844 | [原型](https://github.com/lear111/quizforge_web/blob/6d68e3c940ab7e2c075a83b188baf6dc3b506589/core/docs/design/reviews/screenshots/v2-ui-prototype-3/mobile-prototype.png) | [宿主](https://github.com/lear111/quizforge_web/blob/6d68e3c940ab7e2c075a83b188baf6dc3b506589/core/docs/design/reviews/screenshots/v2-ui-prototype-3/mobile-vue.png) |
| 手机题库抽屉 | [原型](https://github.com/lear111/quizforge_web/blob/6d68e3c940ab7e2c075a83b188baf6dc3b506589/core/docs/design/reviews/screenshots/v2-ui-prototype-3/mobile-prototype-library.png) | [宿主](https://github.com/lear111/quizforge_web/blob/6d68e3c940ab7e2c075a83b188baf6dc3b506589/core/docs/design/reviews/screenshots/v2-ui-prototype-3/mobile-vue-library.png) |
| 手机大纲 / 草稿 | — | [大纲](https://github.com/lear111/quizforge_web/blob/6d68e3c940ab7e2c075a83b188baf6dc3b506589/core/docs/design/reviews/screenshots/v2-ui-prototype-3/mobile-vue-outline.png)、[草稿](https://github.com/lear111/quizforge_web/blob/6d68e3c940ab7e2c075a83b188baf6dc3b506589/core/docs/design/reviews/screenshots/v2-ui-prototype-3/mobile-vue-draft.png)、[草稿上打开抽屉](https://github.com/lear111/quizforge_web/blob/6d68e3c940ab7e2c075a83b188baf6dc3b506589/core/docs/design/reviews/screenshots/v2-ui-prototype-3/mobile-vue-draft-drawer.png) |

复现：先构建，运行 `node core/scripts/dev/probe-v2-ui-prototype.mjs <外置 playwright/index.mjs> chrome`；只复制公开示例到系统临时目录，完成后关闭浏览器、服务并清理合成数据，截图输出 `.temp/v2-ui-prototype/`。真实浏览器探针沿用 CI 原十项入口，新增动效检查已包含在 router 内。

**风险与边界。** 截图与 Chrome 视口验收不代替 Android/iOS 真机、系统手势或设备安全区实测；安全区保留 CSS env。截图是静态证据，动画中间帧与时长由浏览器断言验证。收放中触发 ResizeObserver 的正常布局变化不重建题型页面；原 iframe 保留和保存恢复检查继续通过。不新增动画库、缓存或业务保护机制。
