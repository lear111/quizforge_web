# V2 第 2.5 段：V1 代码清点

这份清单按 V2 的实际启动链和后续功能复用价值分组。此 PR 只提交清单；待审查确认删除范围后另开 PR。不改变 API、存储、运行行为、依赖、测试或构建产物。

| 分类 | 文件或模块、入口与依据 | 后续处理 |
| --- | --- | --- |
| V2 正在使用 | `core/server/v2-main.mjs → host/v2/server.js → snapshots、bank-reader、type-registry、state、ink、receipts、io、timing`；`core/shared/v2/answered.js` 同时供浏览器与后端使用。入口依赖隔离、锁定和持久化由 `core/test/v2/{readonly,submit,storage,drafts,json-fields}.test.mjs` 覆盖。 | 保留模块、测试、`core/test/fixtures/v2-*` 及已提交的 `examples/v2/`。 |
| V2 正在使用 | `core/frontend/src/index.ts → mountV2App → v2/App.vue` 直接用 `library/LibraryList.vue`、`outline/OutlinePanel.vue` 及其类型；白板入口 `v2/whiteboard.ts → core/web/draft/`，保留白板、工具栏、坐标、画布与 `shared/ink`。V2 题型依赖 `shared/richtext/1.1.3/`；`core/web/ui/` 的 JS/CSS 由 V2 根页直接加载。 | 保留 `core/test/v2/`、`core/test/draft/` 中对应测试及高级富文本的构建、测试与许可。 |
| V1/V2 共用，可瘦身 | `host/platform/json.js` 中 `jsonEqual` 现用于旧历史和旧写链；`integralField` 也被待复用的网络设置与 AI 用到。V2 直接用解析、保留数字字面量的读写、复制/投影/冻结、指纹与精确求和。另有 `platform/{files,file-cache,digest-cache,timing}.js` 的安全路径、身份比较、缓存和诊断共用，`foundation.test.mjs` 混有规则、资源与编辑日志用例。 | 只列出，暂不瘦身；拆测试时保留 V2 和后续复用代码的独立断言。 |
| V1/V2 共用，可瘦身 | `frontend/src/index.ts` 仍导出 V1 挂载器，Vite 把它们一起打进 `core/web/ui/quizforge-ui.js`；`quizforge-web-local.css` 及白板样式同时服务两端。 | 删除 PR 需检查旧调用方并重建；退役前基线 `20733b5`：JS **244,451 B**，Node 默认 gzip **84,356 B**，SHA-256 `2c47a0ab1bff448ad9531fb1e1670e9bd8d51d7e2b6daacef0c691a97c47c892`。对照记录退役后的原始/gzip 字节和差值。 |
| 后续值得复用 | 第 3–5 段：`frontend/src/{practice-summary,history,exam,ai,chat,appearance,network,user-center}` 与 `web/listening/` 交互；`host/ai/` 的模型连接、Hub 登录与凭据处理，`host/http/` 的网络、桌面与联系管理员辅助模块；`shared/answer-area/` 和 `shared/richtext/` 的组件与编辑器。 | 保留对应测试；沿用可复用交互与组件，旧评分、历史和考试的状态契约另按 V2 设计。 |
| 后续值得复用 | 第 6–7 段：`host/library/library-archive.js` 的 ZIP/CRC 安全处理、`archive-move.js` 文件流程、`host/resources/` 资源辅助、`frontend/src/{library,editor,development}`、`web/library/` 的导入与桌面衔接、`core/desktop/`、`scripts/{build,launcher}/`。 | 保留安全回归和桌面验证；安装器、托盘、启动器仍有旧入口或请求契约，先定替代，再退役。 |
| 候选退役：旧规则链 | `server/rules-runner.cjs`、`host/extensions/{rule-engine,write-environment,validation-cache}.js`、`host/library/import-validation.js`、`host/practice/short-answer-upgrade.js`、`test:rules`。引用由 V1 的 `server/main.mjs → host/http/server.js` 和旧题库加载、编辑、导入路径带入。AJV 还在运行时打包 `scripts/build/runtime-dependencies.mjs`、依赖检查和测试。 | 先从 V1 入口退役，追踪并处理打包/脚本/测试调用方；不删归档安全测试或 V2 结构检查。 |
| 候选退役：旧作答宿主 | `web/{index.html,app.js}`、`web/bridge/{api-v1,api-bridges,frame,extension-pages,extension-requests}.js`、`host/practice/{collection-routes,practice-sessions,state-store,outline}.js`、`host/history/history-rounds.js`、`host/editor/{edit-journal,editor-drafts}.js`。现有 `start:v1`、旧启动脚本及 V1 集成/源码截取测试仍直接引用；A1 `test:perf` 也以 V1 接口和夹具为入口。 | 不能按目录删除。逐项核对历史/考试/编辑器复用面、`core/test/{practice,bridge,editor,exam}` 与混合测试、CI 性能 job 的现行契约。新增 V2 等效覆盖后才讨论替换，不在本 PR 跳过测试。 |

另一个易漏入口：根目录已跟踪的 `question-banks/` 和 `extensions/` 是 `core/scripts/dev/stage-v2-basic-demo.mjs` 的输入，基础展示库与 `core/test/v2/basic-demo.test.mjs` 会校验它们。不要把演示源与用户的旧数据一起当成退役对象；也未读取用户数据。

验证：核对导入图、启动脚本、构建及测试入口；`git diff --check`。纯文档变更按现有 workflow 的路径过滤不启动 CI。无新增用例、无持久化/兼容变化或性能变化；现有 bundle 数值仅为后续删除 PR 的对照。待审：确认退役范围与旧启动、打包和 CI 性能用例的替换顺序。
