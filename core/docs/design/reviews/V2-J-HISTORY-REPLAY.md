# J：历史列表与只读回看

状态：已实现，等待审查；目标 `v2`，基于 `a55ebea`（#180 归档已合并）。不自行合并，不开始历史删除、历史笔迹编辑或 K。本文件与 PR 描述同步。

## 依据与边界

依据 D19、D20、D22、D23、D42、D50、负责人本次 J 任务，以及 [API 第 3 段](../V2_API_AND_STATE.md)、[数据结构第 4 节](../V2_DATA_STRUCTURES.md)、[工作流程](../V2_WORKFLOW.md)。历史答案、评分、题库及拓展只读；本轮白板也只显示。沿用现有归档文件，不新增索引、不改 restart 事务或 `restart.json` 恢复语义，不改正常练习保存/评分协议、沙箱权限、持久化格式、JSON 编码器、考试或 AI。

## 实现与文件职责

- `repositories/history.repository.js`：严格 UUID、受检路径与归档 bank/state/ink 读取；只观察恢复回执，排除 prepared 和暂存目录，不执行恢复、迁移或 D27。不存在为 404，损坏为明确错误并保留文件。
- `services/history-{snapshot,state}.service.js`、`history.service.js`：独立历史快照、按归档 state 计算列表/总分、概览与题目。列表时间倒序，不存索引。历史工件 ID 按题库、轮次及原工件隔离，只从该轮 extensions 解析；不回退已安装拓展。沿用版本化共享 SDK 及现有 iframe 安全边界。历史打开项沿用八项容量、独立于当前练习缓存，不驱逐或清理当前作答。
- `routes/history.routes.js`、`controllers/history.controller.js`、app/handlers/types：只注册 rounds、overview、question、asset 四个 GET。历史写路径（包括 ink、result、retry、restart 和 DELETE）均为 404。相关 artifact/SDK 读取复用现有资源出口。
- 素材引用来自归档题目与解析，字节只从原题库受检路径读取；缺失或不安全路径为 404「素材已不存在」。拓展缺失不阻断大纲、答案状态和成绩。每次历史数据读取重新检查归档文件，不用先前成功的缓存掩盖损坏。
- `api/history.ts`、`stores/practice/history.ts`、`router/history.ts` 与相关 actions/runtime/navigation：进入前完成现有 flush，保存当前题目/作答/笔迹/视图；离开恢复，不重新打开当前题库触发 D27。直接历史 URL 刷新后没有内存中的当前页面时，返回按钮正常打开当前练习。支持历史题目/汇总 URL、前进和后退。
- `HistoryMenu.vue/css`、`HistoryBanner.vue`、Toolbar/Workspace/FinalScore：真实历史浮层、时钟图标、完成时间、得分、回看标识与返回按钮；删除顶部刷新入口，保留目录刷新列表。普通模式顺序为草稿、历史、右栏开关；回看隐藏可写草稿入口。手机浮层无横向溢出。
- page/scoring/completion/API/whiteboard：独立阻断 changed、submit、retry、自动保存、评分 Worker 和结果写回。历史上下文始终 locked、can.submit/retry=false；API 客户端也拒绝历史对象写请求。白板复用原只读模式与归档相机，显示笔迹但隐藏工具，不保存；退出后恢复正常草稿行为。
- `shared/v2/api.d.ts` 增加历史响应类型及读取作用域，正式 API/数据/界面状态说明与进度索引同步。没有改旧的 #176 测量 JSON，也没有提交真实数据或生成 UI 成品。

## 回归覆盖与验证

新增 17 项（含子用例）：空列表/三轮排序；历史题目、答案、成绩、拓展、笔迹隔离；所有写入口 404；素材消失；拓展缺失；坏归档/非法 UUID；prepared 排除且 journal 不变；round/ink/assets 链接攻击；Store flush/失败保留/恢复当前页；只读上下文与评分阻断；API 作用域；历史路由前进后退及失败地址不变。逐文件 SHA-256/Buffer 比较保证当前及归档文件未改写。

原 restart 路径测试中「历史读取未实现」的旧预期更新为列表可读，所有历史写断言保留并扩充。顶部刷新删除后，basic-types/whiteboard 探针通过真实题库入口重新打开，并展开刷新后默认收起的分组；router 中原刷新业务断言通过已挂载的真实 Store 与导航动作继续执行，不替换实现、不删除断言。completion 保留全部原测试，追加历史桌面/手机流程；结果输出提取至小 helper 满足既定长度限制。没有新增测试重试、放宽超时、跳过或降低断言。

| 本机检查 | 实际结果 |
|---|---|
| UI / server TypeScript | 均通过 |
| ESLint / 格式 | 258 文件，0 错误、0 警告；268 文件无格式差异 |
| UI build / --check / Git 追踪 | 均通过，生成 JS/CSS 未被 Git 追踪 |
| 全部 V2 单元测试 | 332 通过、0 失败/取消/跳过，124.379 秒（原 315 + 新 17） |
| 历史与路由专项最终检查 | 22 通过、0 失败，10.574 秒 |
| 十项原浏览器探针 | 全部通过；page、page-contract、grading、page-review、practice、save-recovery、whiteboard、basic-types、completion、router；Chromium 1440×900 / 390×844，errors 为空 |
| 性能检查 | 2 通过、0 失败，30.385 秒；合成 20/200 题既有回环检查，非历史大规模压测 |
| 完整 npm test（含旧版） | 1593 项，1580 通过、13 失败、0 取消/跳过，864.600 秒；详情如下，不能称本机完整回归全绿 |

浏览器追加验证：历史空态、浮层关闭/边界、真实 SDK 及绕过 SDK 的 changed/submit/retry 均无写请求；没有 grade-js 请求；归档笔迹实际绘制到 canvas，无法编辑；返回恢复当前答案且两个 state 文件字节不变；拓展和素材失败明确降级。自动化使用合成/公开基础题型副本、独立临时根和回环随机端口，finally 清理；没有访问真实题库、部署或重启日常服务。首次发现笔迹读出但不可见，修正为复用白板只读坐标空间，保留归档相机，未修改白板底层算法。手机为浏览器视口，未做真实设备验收。

### 本机完整回归失败清单

环境：Windows 11 / Windows_NT 10.0.26200、Node 24.13.0，本机桌面会话；未读取凭据或修改账户权限、ACL。以下没有在本任务修复，也没有重新检出基线完整验证，因此不把原因推测当作基线结论。

| 文件（相对 core） | 失败用例 | 首条错误 |
|---|---|---|
| server/host/ai/hub-connection.test.mjs:68 | completing login saves only the device token, reads quota, and logout revokes it | AI_SETTINGS_SAVE_FAILED，无法完成 AI 设置文件的访问保护 |
| 同文件 :88 | a token the Hub rejects logs this computer out | 同上 |
| 同文件 :96 | the free quota grades through the Hub gateway with the device token and keeps custom settings | 同上 |
| 同文件 :114 | gateway errors become clear, non-retried messages and a rejected token logs out | 同上 |
| 同文件 :133 | with both sources on, the free quota grades first and the custom model takes over when it cannot | 同上 |
| 同文件 :160 | settings saved with one source before this version keep working | 同上 |
| server/host/ai/settings-provider.test.mjs:32 | AI settings preserve masked-key editing and owner-protected saved credentials | 同上 |
| 同文件 :54 | disabled AI remains disabled across persisted settings reload without losing automatic preference | 同上 |
| server/host/http/server.test.mjs:290 | Hub login starts on the host only and the loopback callback finishes it without exposing the token | 503 !== 200 |
| server/host/library/library-package.test.mjs:137 | single bank export includes only its dependencies, imports at root, and can be re-exported | EPERM，rename |
| test/desktop/windows-tray.test.mjs:117 | opening a local qbank cold-starts one tray, coalesces pending opens and imports later opens independently | 2 !== 1 |
| 同文件 :211 | two program installations targeting the same data reuse the original tray | Tray state did not settle；启动失败 EPERM |
| test/v2/submit.test.mjs:343 | D19 private records are excluded from fingerprints, file limits, question assets and local listening | fetch failed / ECONNRESET |

不改代码、并发 1 单独重跑 library-package、windows-tray、submit 三个文件：41 项，40 通过、1 失败，252.698 秒；上述四项全部通过，但 library-package:108 的 `renaming and moving imported banks and groups preserve answers, stable identities and extension paths` 改为 EPERM rename 失败。ACL 类九项未重复。完整仓库并发中 D19 的 ECONNRESET 与独立 V2 332 项全通过均保留记录；没有借此修改产品或测试。

## CI 与待审查事项

CI 尚未运行，提交 PR 后补齐 Windows/Ubuntu Checks、Performance、code-quality、browser 五项实际结果及运行链接；不把本机局部通过代替 CI。

风险与范围：列表逐轮读取 bank/state，未测大量历史时的耗时；不增加索引。素材仍依赖原目录，删除素材后按约定降级。共享 SDK 仍由宿主提供原声明版本，缺失时题型不可用，不替换归档作者代码。当前练习若在回看期间由别的标签页修改，返回后仍沿用既有快照/版本冲突处理；不新增同步机制。历史白板编辑、历史删除、考试、AI 和 D56 均未实现。不承诺外部手工改动归档文件后仍保持其内容不可变；保护边界是宿主与 HTTP 写入口。
