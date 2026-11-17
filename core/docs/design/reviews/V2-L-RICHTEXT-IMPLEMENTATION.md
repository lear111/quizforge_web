# L：HTML 富文本 SDK 2.0.0（D54、D66）

状态：实现完成；[PR #195](https://github.com/lear111/quizforge_web/pull/195) → `v2`，等待审查，不自行合并。
依据：[总体设计](../V2_ARCHITECTURE.md)、[数据结构 1.1](../V2_DATA_STRUCTURES.md#11-富文本内容d54待实现)、[题型协议](../../reference/V2_EXTENSIONS.md)、[已批准选型](V2-L-RICHTEXT.md)。

## 改了什么

- 新增 `quizforge.richtext@2.0.0`：DOMPurify **3.4.18** 显式标签/元素属性白名单，CSSOM 重建 D54 的十项样式；图片只允许 `qf-asset:`，链接只允许 http/https/mailto。KaTeX **0.16.43**、`trust:false`、原生 MathML，支持行内/独立公式、美元转义与 code/pre 排除，非法公式局部降级。
- `render(container, htmlString)` 保留 `ready`/`destroy()`；宿主现有 `configure({resources})` 接入同一资源桥，保留 `page/document.ts` 的旧 JSON 适配。图片等加载/解码结束，缺失显示错误；销毁结束等待并忽略迟到结果。SDK 不持有/撤销宿主借出的对象 URL。
- 后端直接生产依赖 **parse5 8.1.1**，只解析 question/可见 solution 中的 HTML `img[src]`；保留旧 JSON 扫描、路径检查、资源 ID 和锁定权限。宿主用不挂载的惰性 template 识别 HTML 图片，仅加载后端已授权资源，旧 JSON 图片照常预加载。
- 三个示例拓展 **3.0.0** / `@3`，SDK **2.0.0**；七道公开示例仅把题干/选项/解析变为 HTML，编号、答案、分数、分组和原图片不变。浏览器的三个合成题同步新格式；自定义合成题型显式保留自己的主版本，业务断言不变。

## 文件与职责

| 文件 | 职责 |
|---|---|
| `shared/richtext/2.0.0/src/{static,render,sanitize,math,images}.js` | 静态入口、生命周期、白名单、公式、图片 |
| `shared/richtext/2.0.0/{richtext.js,richtext.css,README.md,THIRD_PARTY_NOTICES.md}` | 版本化 SDK 分发、样式、使用说明及许可 |
| `scripts/build/build-richtext-html.mjs`、`package{,-lock}.json` | 独立构建/字节一致检查/体积统计、锁定依赖 |
| `server/v2/utils/asset-references.js`、`services/question.service.js` | HTML 与旧 JSON 素材扫描、现有权限控制 |
| `frontend/src/v2/stores/practice/page.ts` | HTML 图片预加载，保留旧 JSON 入口 |
| `scripts/dev/stage-v2-basic-demo.mjs`、三个示例 manifest、七题 bank.json | 仅公开示例格式转换 |
| `test/v2/{richtext-html,html-assets,picture-references,basic-demo,readonly-entry}.test.mjs` | 白名单、生命周期、素材隔离、示例、入口依赖回归 |
| `test/fixtures/v2-browser-bank.json`、相关浏览器/测量夹具 | 适配示例新主版本和 HTML；保留已有业务断言 |
| `scripts/dev/probe-v2-richtext-checks.mjs`、`probe-v2-basic-types.mjs` | 真实宿主桌面/手机显示和无远程加载验证 |
| `scripts/quality/scope.mjs`、`eslint.config.mjs` | 新 SDK 手写源码进入既有格式与长度检查；排除 minified 分发物 |

以上路径相对 `core/`；示例在仓库 `examples/v2/`。新 SDK 的静态分发文件与既有不可变共享 SDK 一致随版本保留；Vue UI 构建产物仍不追踪。入口依赖测试只新增允许 parse5/entities，规则引擎/ajv/执行环境禁用断言保留。

## 明确没改什么

不迁移其他题库或任何 practice/exam/rounds 用户记录；不改保存、锁定、评分、答案结构、HTTP 接口或旧资源路径权限。不实现编辑器/迁移工具。不改 V1 的 `service.json`、1.0.0/1.1.3 SDK；不删除旧共享文件。不保证旧记录升级兼容（D66）。全部验证使用公开示例副本或隔离合成目录，不重启日常服务。

## 验证与体积

| 检查 | 结果 |
|---|---|
| SDK/HTML 素材/七题示例专项 | 首轮 17/17；新增宿主图片、入口图等专项 11/11；均通过 |
| TypeScript UI/后端、lint、格式、UI 构建与一致性 | 通过；lint 289 文件，0 错误/0 警告；格式 301 文件，0 差异；SDK 构建字节一致 |
| 完整 V2 / 性能 | 最终隔离执行 **381/381** / **2/2** 通过，无跳过；V2 115.19 s |
| 11 个既有 Chromium 浏览器探针 | page / page-contract / grading / page-review / practice / save-recovery / whiteboard / basic-types / completion / router / exam 全部通过；桌面 1440×900、手机 390×844；HTML 验证加入原 basic-types，不删原断言 |
| 本机完整 `npm --prefix core test` | 首次 1642 项：1621 通过、20 失败、1 取消（1248.48 s）；不能称本机全仓通过，详情见下 |

环境：Windows NT 10.0.26200.0、Node 24.13.0、真实 Chromium 157.0.8103.39。测试数据、截图与服务均使用隔离合成目录/回环端口；无真实手机设备验收。性能检查在同时运行其他回归时执行，只记回归通过，不据此宣称提速。

本机完整测试的未通过项：旧 AI 访问保护/登录 9 项（`hub-connection` 6、`settings-provider` 2、HTTP 登录 1）；旧规则执行/子进程时限或关联断言 7 项（rule-engine 1、rules-runner 2、answer-areas 1、state-store 1、listening 2）；旧 library-package 的 EPERM rename 2 项；桌面 Hub 导入 1、托盘超时取消 1；本次入口图路径匹配 1。未在基线检出复测，**不认定为既有失败**，也未为通过而修改这些旧业务或断言。入口图问题修正为兼容 `core/node_modules/` 和 `node_modules/` 两种 esbuild 相对路径，保留原禁用依赖断言；从仓库根、core 两处执行均通过。

重跑记录：首次 V2 的归档恢复失败、第二次的 D19 ECONNRESET，分别隔离重跑 20/20、11/11，最后全 V2 381/381。浏览器首轮 page-contract 的合成 manifest 继承了新版主版本，与其自定义 `@2` 不符，显式保留其 2.0.0 后通过；router 首轮过渡等待超时，未改代码/断言/超时，隔离重跑通过。没有加入自动重试或固定 sleep。

### CI

代码提交 `e695f70` 的 [运行记录](https://github.com/lear111/quizforge_web/actions/runs/44012571420)（首次运行的两个 Checks 均仅因上述入口图路径断言失败，修正后重新验证）：

| job | 结果 | 耗时 |
|---|---|---|
| Checks (Windows) | 通过；1642/1642，无跳过、失败 | 5m24s |
| Checks (Ubuntu) | 通过；1608 通过、34 项既有平台跳过、0 失败 | 2m09s |
| V2 code quality (Ubuntu) | 通过 | 33s |
| Performance (Ubuntu) | 通过；2/2 | 28s |
| V2 browser checks (Ubuntu) | 通过；11 个探针，0 失败 | 4m17s |

SDK 实测：JS minified **300,654 B**，Node `gzipSync` 默认级别 **90,500 B**，CSS **1,288 B**。JS 相对旧 1.1.3（276,916 B）增加 **23,738 B**。`npm --prefix core run build:richtext-html -- --check` 与单元测试双重核对构建字节；不把估算当实测。

截图：[桌面](screenshots/v2-html-richtext/desktop-html-richtext.png)、[桌面表格](screenshots/v2-html-richtext/desktop-html-table.png)、[手机](screenshots/v2-html-richtext/mobile-html-richtext.png)、[手机表格](screenshots/v2-html-richtext/mobile-html-table.png)。均来自真实宿主与公开示例的隔离副本，自动化浏览器视口不等于真实手机设备验收。

## 风险及待验收

依赖升级会改变运行时解析器实现，因此专项测试覆盖 HTML 实体/重复图片/危险路径/锁定前后资源权限，并保留全部 V2 回归。历史/考试/保存协议不变。资源桥不提供取消协议，destroy 取消的是本次 DOM 等待和事件，已经交给宿主的资源读取只忽略迟到结果。

负责人验收：审查/合并后用原启动脚本打开基础题型演示，依次检查七题的段落、图片、公式、提交后解析及三种题型分数；另用实际手机检查窄屏排版。完整白名单/列表/表格的合成展示见上述截图与 basic-types 浏览器探针。本 PR 不改日常服务，不执行其他题库迁移或用户记录升级。
