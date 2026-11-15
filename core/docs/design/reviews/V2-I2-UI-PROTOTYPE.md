# I②（D64）：第三版前端原型适配

**状态：已实现，待审查与负责人试用；不自行合并。** 基于 `v2` 的 `0ad25e4`，分支 `feat/v2-ui-prototype-3`。依据第三版 `prototype/quizforge-v2-mobile-overlay-bottom-nav-animated.html`、`V2_UI_PROTOTYPE.md` 第 3/5 节、D45/D63/D64 与工作流程；不参考旧第二版画布。当前只接入宿主界面，AI 辅导、考试、历史和设置仍待各自任务，不开始 G/H/J。

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
| 本机默认完整测试 / CI 五项 | 正在收集，提交后补结果；不把局部通过等同全仓通过 |

本轮最初的浏览器失败来自旧脚本点击已被全屏抽屉遮住的顶栏；改为 Esc 后原保存/失败恢复断言通过。新增测试开发时修正了 V1 fixture 的折叠键前缀及实际事件归属，生产 V1 逻辑未改。

**视觉证据。** 以下是当前确认 HTML 和真实 Vue 页面；题目/题数不同是原型假数据与公开基础展示库的区别。只比较宿主布局，不在本任务复制原型的考试、设置、导入等占位功能。图片位于 `reviews/screenshots/v2-ui-prototype-3/`：

| 场景 | 第三版 HTML | 当前 Vue |
|---|---|---|
| 桌面 1440×900 | [原型](screenshots/v2-ui-prototype-3/desktop-prototype.png) | [宿主](screenshots/v2-ui-prototype-3/desktop-vue.png) |
| 手机 390×844 | [原型](screenshots/v2-ui-prototype-3/mobile-prototype.png) | [宿主](screenshots/v2-ui-prototype-3/mobile-vue.png) |
| 手机题库抽屉 | [原型](screenshots/v2-ui-prototype-3/mobile-prototype-library.png) | [宿主](screenshots/v2-ui-prototype-3/mobile-vue-library.png) |
| 手机大纲 / 草稿 | — | [大纲](screenshots/v2-ui-prototype-3/mobile-vue-outline.png)、[草稿](screenshots/v2-ui-prototype-3/mobile-vue-draft.png)、[草稿上打开抽屉](screenshots/v2-ui-prototype-3/mobile-vue-draft-drawer.png) |

复现：先构建，运行 `node core/scripts/dev/probe-v2-ui-prototype.mjs <外置 playwright/index.mjs> chrome`；只复制公开示例到系统临时目录，完成后关闭浏览器、服务并清理合成数据，截图输出 `.temp/v2-ui-prototype/`。真实浏览器探针沿用 CI 原十项入口，新增动效检查已包含在 router 内。

**风险与边界。** 截图与 Chrome 视口验收不代替 Android/iOS 真机、系统手势或设备安全区实测；安全区保留 CSS env。截图是静态证据，动画中间帧与时长由浏览器断言验证。收放中触发 ResizeObserver 的正常布局变化不重建题型页面；原 iframe 保留和保存恢复检查继续通过。不新增动画库、缓存或业务保护机制。
