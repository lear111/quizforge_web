# 本地 Web 前端分阶段迁移

目标：用 Vue 3 + TypeScript 管理宿主界面的组件与状态，保留现有视觉、数据和拓展契约。使用 Vite 构建静态文件，仍由现有 Node 服务提供，不新增运行时前端服务。

2026-11-09 状态：阶段 1 已完成源码与隔离验收；阶段 1 已通过 PR #24 合并；阶段 2a 列表迁移自动检查完成，浏览器验收待完成；阶段 2b～4 待推进。开发分支为 `feat/vue-sidebar-phase1`；第一阶段独立提交时附带尚未入库的原生聊天接口与侧栏调宽依赖，本阶段不打包或重启日常服务。

## 阶段与验收

| 阶段 | 范围 | 完成条件 |
| --- | --- | --- |
| 1：构建与 AI 聊天 | 接入 Vue / TypeScript / Vite；迁移单会话聊天，建立旧宿主与 Vue 的挂载边界 | 类型检查、生产构建、实际产物的聊天测试、原侧栏回归、桌面和手机浏览器检查通过 |
| 2a / 2b：题库列表与设置 | 题库/文档混合列表、分组弹窗、设置分区逐块迁移 | 新建/改名/删除/导入反馈、权限、手机操作与原行为一致；每次只迁一个区域 |
| 3：大纲与练习协调 | 大纲、当前题目定位、导航与保存状态逐步集中管理 | 切题、切库、编辑离开拦截、考试和历史状态不串写，不重复保存或请求 |
| 4：复杂编辑区域 | 题目编辑表单、历史与汇总界面，清理对应的旧 DOM 操作 | 保存冲突、未保存输入保护、只读历史和已有拓展兼容性验证通过 |

每阶段单独验收后再推进；阶段 1 不新增自动读题、工具调用、聊天持久化或多会话功能。用户已暂缓第三方 Agent 集成，此次不扩展 WebMCP/MCP 功能。

## 共存规则

1. 一个 DOM 区域只有一个所有者。阶段 1 中 Vue 仅管理 `#ai-chat-root` 的子节点；原宿主管理页签、题目大纲、题型 iframe、草稿画布和外部辅导入口。宿主不得再直接修改 Vue 内的消息、输入和状态节点。
2. `core/web/ai/ai-chat.js` 是迁移适配层，只负责原生页签与挂载/取消/销毁；`core/frontend/src/chat/AiChatPanel.vue` 负责视图，`session.ts` 负责单会话请求与状态。通过注入原 `request` 函数调用现有 `/api/ai/chat`，不另存模型密钥。
3. 切换页签只隐藏面板，不卸载 Vue，不丢失输入或在途请求。销毁组件取消请求并丢弃过期响应；刷新仍按原约定清空对话。
4. 题型 iframe、Bridge、SDK、题库/历史格式、草稿坐标和渲染引擎保持原有契约。未来只在宿主组件生命周期中包装这些模块；笔迹点列、Canvas 实例和大型题库对象不整体转成深层响应式状态。
5. 先沿用现有 CSS、主题变量和可访问性标记，不在框架迁移中重做外观。现阶段不引入路由、全局状态库或 UI 组件库；后续有明确需要再决定。

## 开发与构建

源码在 `core/frontend/`，`vite.config.ts` 构建为 `core/web/ui/quizforge-ui.js`，附带 `THIRD_PARTY_NOTICES.txt`。产物随源码提交，普通源码启动和安装版无需再运行 Vite，也不请求 CDN。

```powershell
# 在产品根目录；依赖版本以 core/package-lock.json 为准
npm --prefix core ci
npm --prefix core run typecheck:ui
npm --prefix core run build:ui
npm --prefix core run build:ui -- --check
```

`--check` 在内存重新构建并比对产物，不覆盖文件；修改 Vue/TS 源码后必须重新构建。Windows 暂存构建入口先构建 UI 再复制静态文件，避免漏带或打包旧产物。本阶段不生成安装包。

输出使用 IIFE 库格式，只发布一个 `window.QuizForgeUI.mountAiChat` 挂载入口。`index.html` 在原 `app.js` 执行前加载同源构建文件；运行时使用预编译模板，不使用 `eval` 或运行时模板编译。Vue 构建依赖放在 devDependencies，安装包只需要静态产物。

## 回归入口

```powershell
node --test core/test/ai/ai-chat.test.mjs core/test/outline/outline-resize.test.mjs
node --test core/server/host/ai/ai-chat.test.mjs core/server/host/http/ai-chat.test.mjs
node --test --test-name-pattern="all browser entry" core/server/host/http/server.test.mjs
```

UI 测试在各自 JSDOM 页面里运行真实生产产物，验证用户操作，不模拟 Vue 渲染器。浏览器验收使用隔离合成题库，检查正常题卡、桌面/窄屏侧栏、发送、失败、停止与刷新；不能用 DOM 测试代替真实设备验收。

工作区阶段 1 结果共 29 项。独立发布分支不携带尚未提交的外部辅导模块，验收范围为 7 项聊天 UI、4 项侧栏、7 项聊天后端与 HTTP、1 项资源图，共 19 个唯一用例。类型检查与 `build:ui -- --check` 通过。锁定 Vue 3.5.45、Vite 8.3.7、plugin-vue 6.0.10、TypeScript 5.9.3、vue-tsc 3.3.14；TypeScript 7 与当前 vue-tsc 的 tsc 导出路径不兼容，未采用。

浏览器使用真实完整页面和隔离合成题库，在 1440×900 与 390×844 检查：发送/停止/失败恢复输入，切题与页签切换保留对话，原题选择保存，刷新清空会话。手机宽度 390、页面滚动宽度 390、侧栏宽度 340，无新增水平溢出。共 4 次本地模拟聊天请求、1 次取消；没有真实模型调用。构建 JS 为 64,046 字节（Vite 报告 gzip 约 25.76 kB），附带 Vue MIT 许可证。证据位于忽略目录 `.temp/vue-sidebar-phase1/`，临时服务已停止，合成数据已清理；未做真机或安装包验收。

参考：[Vue 渐进使用方式](https://vuejs.org/guide/extras/ways-of-using-vue.html)、[Vue 工具链](https://vuejs.org/guide/scaling-up/tooling.html)、[Vite 构建](https://vite.dev/guide/build.html)。

## 阶段 2a：列表渲染

`LibraryList.vue` / `LibraryNode.vue` 接管 `#library-list` 子树；`library-view.js` 仅整理排序、分组与回调，宿主继续管理工具栏和练习切换。同步渲染契约保留，目录刷新按题库/文档身份复用节点，避免丢失焦点；关闭页面时卸载。使用原有 CSS，不改题库格式或接口。支持已有文档条目，但不引入未提交的文档上传和浏览功能。分组弹窗及设置表单仍为原实现，留给 2b 及后续独立分支。

验证：类型检查、生产构建和构建一致性通过。两轮共 76 项相关用例通过（33 项聊天/列表/目录管理，43 项目录索引/开发模式/练习切换/列表迁移专项），包含错误行、只读权限、焦点与节点保留、回调替换、文档同组显示、卸载后重挂载。生产 JS 为约 69.61 kB，gzip 约 27.51 kB。浏览器工具三次创建标签页均超时，尚未完成本阶段的实际桌面/手机渲染验收，因此本阶段尚未完成，不自动合并。未做真机和安装包验收。
