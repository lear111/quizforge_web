# J：历史列表与只读回看

状态：已实现，[PR #182](https://github.com/lear111/quizforge_web/pull/182) 等待审查；目标 `v2`，基于 `a55ebea`（#180 归档已合并）。不自行合并，不开始历史删除或 K。本文件与 PR 描述同步。

## 依据与边界

依据 D19、D20、D22、D23、D42、D50、负责人本次 J 任务，以及 [API 第 3 段](../V2_API_AND_STATE.md)、[数据结构第 4 节](../V2_DATA_STRUCTURES.md)、[工作流程](../V2_WORKFLOW.md)。历史答案、评分、题库及拓展只读；按负责人补充要求，历史宿主白板可继续编辑，题型答案与评分仍冻结。沿用现有归档文件，不新增索引、不改 restart 事务或 `restart.json` 恢复语义，不改正常练习保存/评分协议、沙箱权限、持久化格式、JSON 编码器、考试或 AI。

## 实现与文件职责

- `repositories/history.repository.js`：严格 UUID、受检路径与归档 bank/state/ink 读取；只观察恢复回执，排除 prepared 和暂存目录，不执行恢复、迁移或 D27。不存在为 404，损坏为明确错误并保留文件。
- `services/history-{snapshot,state}.service.js`、`history.service.js`：独立历史快照、按归档 state 计算列表/总分、概览与题目。列表时间倒序，不存索引。历史工件 ID 按题库、轮次及原工件隔离，只从该轮 extensions 解析；不回退已安装拓展。沿用版本化共享 SDK 及现有 iframe 安全边界。历史打开项沿用八项容量、独立于当前练习缓存，不驱逐或清理当前作答。
- `routes/history.routes.js`、`controllers/history.controller.js`、app/handlers/types：注册 rounds、overview、question、asset 四个 GET 及单独的历史 PUT ink。其余历史写路径（包括 result、retry、restart 和 DELETE）均为 404。相关 artifact/SDK 读取复用现有资源出口。
- 素材引用来自归档题目与解析，字节只从原题库受检路径读取；缺失或不安全路径为 404「素材已不存在」。拓展缺失不阻断大纲、答案状态和成绩。每次历史数据读取重新检查归档文件，不用先前成功的缓存掩盖损坏。
- `api/history.ts`、`stores/practice/history.ts`、`router/history.ts` 与相关 actions/runtime/navigation：进入前完成现有 flush，保存当前题目/作答/笔迹/视图；离开恢复，不重新打开当前题库触发 D27。直接历史 URL 刷新后没有内存中的当前页面时，返回按钮正常打开当前练习。支持历史题目/汇总 URL、前进和后退。
- `HistoryMenu.vue/css`、`HistoryBanner.vue`、Toolbar/Workspace/FinalScore：真实历史浮层、时钟图标、完成时间、得分、回看标识与返回按钮；删除顶部刷新入口，保留目录刷新列表。普通模式顺序为草稿、历史、右栏开关；回看保留草稿入口。手机浮层无横向溢出。
- page/scoring/completion/API/whiteboard：独立阻断题型 changed、submit、retry、作答保存、评分 Worker 和结果写回。历史上下文始终 locked、can.submit/retry=false；API 客户端拒绝历史答案/提交/重做/评分，唯独宿主 ink 使用 roundId 路由。白板初始只读显示，点草稿可编辑并独立保存归档相机和笔迹；退出后恢复正常草稿行为。
- `shared/v2/api.d.ts` 增加历史响应类型及读取作用域，正式 API/数据/界面状态说明与进度索引同步。没有改旧的 #176 测量 JSON，也没有提交真实数据或生成 UI 成品。

## 回归覆盖与验证

新增 17 项（含子用例）：空列表/三轮排序；历史题目、答案、成绩、拓展、笔迹隔离；所有非 ink 写入口 404；素材消失；拓展缺失；坏归档/非法 UUID；prepared 排除且 journal 不变；round/ink/assets 链接攻击；Store flush/失败保留/恢复当前页；只读上下文与评分阻断；API 作用域；历史路由前进后退及失败地址不变。逐文件 SHA-256/Buffer 比较保证当前及归档文件未改写。

原 restart 路径测试中「历史读取未实现」的旧预期更新为列表可读，非 ink 历史写断言保留并扩充；原 ink 禁写预期按本次明确授权改为独立读写与隔离断言。顶部刷新删除后，basic-types/whiteboard 探针通过真实题库入口重新打开，并展开刷新后默认收起的分组；router 中原刷新业务断言通过已挂载的真实 Store 与导航动作继续执行，不替换实现、不删除断言。completion 保留全部原测试，追加历史桌面/手机流程；结果输出提取至小 helper 满足既定长度限制。没有新增测试重试、放宽超时、跳过或降低断言。

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

浏览器追加验证：历史空态、浮层关闭/边界、真实 SDK 及绕过 SDK 的 changed/submit/retry 均无写请求；没有 grade-js 请求；归档笔迹实际绘制到 canvas，初始只读；返回恢复当前答案且两个 state 文件字节不变；拓展和素材失败明确降级。自动化使用合成/公开基础题型副本、独立临时根和回环随机端口，finally 清理；没有访问真实题库、部署或重启日常服务。首次发现笔迹读出但不可见，修正为复用白板只读坐标空间，保留归档相机，未修改白板底层算法。手机为浏览器视口，未做真实设备验收。

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

代码提交 `67145df6256a70d652e332177609a5ce184a7c65` 的 [CI 43829372972](https://github.com/lear111/quizforge_web/actions/runs/43829372972) 五项全部通过。下表耗时为 job 开始到结束（含安装和收尾），测试计数直接取 CI 日志；随后提交只补充本记录和进度页 PR 链接，不修改产品或测试。

| Job | 结果 | 总耗时 | 实际检查结果与失败清单 |
|---|---|---|---|
| Checks (ubuntu-latest) | 通过 | 99 秒 | 类型、构建及一致性通过；1593 项，1559 通过、0 失败、34 项既有平台跳过；失败清单为空 |
| Checks (windows-latest) | 通过 | 242 秒 | 类型、构建及一致性通过；1593 项全部通过、0 失败/跳过；失败清单为空 |
| V2 browser checks (ubuntu-latest) | 通过 | 209 秒 | 十项浏览器探针通过，包含桌面/手机历史流程；失败清单为空 |
| Performance (ubuntu-latest) | 通过 | 14 秒 | 2 项通过、0 失败/跳过；失败清单为空 |
| V2 code quality (ubuntu-latest) | 通过 | 22 秒 | 格式与 lint 通过；失败清单为空 |

本机完整测试中的 13 项失败与上述 CI 结果同时保留，不将本机失败静默改记为通过。没有为取得 CI 通过而删除、跳过或放宽测试；Ubuntu 的 34 项平台跳过沿用既有测试定义。

风险与范围：列表逐轮读取 bank/state，未测大量历史时的耗时；不增加索引。素材仍依赖原目录，删除素材后按约定降级。共享 SDK 仍由宿主提供原声明版本，缺失时题型不可用，不替换归档作者代码。当前练习若在回看期间由别的标签页修改，返回后仍沿用既有快照/版本冲突处理；不新增同步机制。历史删除、考试、AI 和 D56 均未实现。不承诺外部手工改动归档文件后仍保持其内容不可变；保护边界是宿主与 HTTP 写入口。


## 负责人补充：历史宿主白板可写（同 PR，不新增任务编号）

- `ink-write.repository.js` 提取原 PracticeInk.apply 的笔迹事务，实践与历史共用校验、四条回执、幂等/版本冲突、32 MiB、保留数字字面量编码及原子写入；practice 路径和协议不变。`HistoryInk` 只接收已校验轮次，文件解析始终落在该轮 ink，完全不调用 PracticeInk 的 practice/open/clear 或旧记录清理。
- 历史 PUT ink 每次重新校验归档和 snapshotId，确认题目存在；只替换该题笔迹文件，state/bank/extensions 与 restart.json 不写。历史 readOnly 继续表示答案/评分冻结，不妨碍宿主白板编辑。
- 保存控制器对历史只捕获宿主 ink，不调用题型 answer getter；changed 仍被拦截。沿用 1500 ms 停笔/10000 ms 最大等待、冻结请求体与 requestId、失败重试和版本冲突恢复；恢复始终调用历史 GET/overview，不退到正常练习。
- 历史切题、切轮和退出前均 flush；失败保留旧题/轮次与当前练习暂存。读取归档相机，编辑时启用宿主笔具，离开编辑仍显示原坐标笔迹。
- 专项用例：持久化与新 reader；原请求重放/同 ID 异体；写失败原请求重试；旧版本不覆盖；快照、缺题、坏记录、超限与链接拒绝；宿主 saver 不读取插件答案；历史切题/换轮/退出等待及失败保留；快照冲突恢复不触碰当前练习。每次 HTTP 测试比较归档 bank/state 及当前 practice state/ink 的 Buffer。
- 浏览器专项在原 completion 探针内覆盖桌面和手机：笔迹和相机重读、失败阻止离开、同体重试、切题等待、其他标签页冲突不覆盖、响应丢失后幂等重试、退出前保存、SDK 与绕过 SDK 的 changed/submit/retry 无写入。全部历史写请求只能是该轮 ink，当前 practice 文件与历史 state 字节不变。

本次补充的浏览器检查另外发现：直接打开/刷新历史 URL 时，原逻辑会把空 overview 暂存成“当前练习”，返回后停在空页。现仅在确有当前练习时暂存；无暂存则按原分支重新打开当前题库。新增 Store 回归，浏览器保留原先“返回后选中答案仍在”的断言，并实际刷新历史页验证。

### 补充验证（上面的第一次结果不代表本次补充）

| 检查 | 结果 |
|---|---|
| 历史 ink HTTP 专项 | 6 通过、0 失败/跳过；含两个链接攻击子用例 |
| 历史 Store 专项（最终修改） | 8 通过、0 失败/跳过，2.725 秒 |
| 完整 V2 中间轮 | 341 通过、0 失败/跳过，135.561 秒；随后补空暂存返回用例及恢复保护，最终结果以下补记 |
| UI / server 类型检查 | 均通过 |
| lint / 格式检查 | 262 文件、0 错误/警告；272 文件、0 格式差异 |
| UI 构建、构建一致性、Git 追踪 | 全部通过，生成 JS/CSS 未追踪 |
| 十项浏览器探针 | 全部通过；completion 中新增的桌面 1440×900 / 手机 390×844 历史编辑流程通过，pageerror 为空 |
| 性能检查 | 2 通过、0 失败/跳过，32.665 秒；与其他测试并行运行，不用于宣称性能改善 |
| 完整 npm test / GitHub CI | 运行中，完成后在本节补记 |

新增 10 项（含子用例）：6 项后端，4 项 Store；既有协议/冻结/沙箱与业务断言保留。初次完整 V2 发现新增历史读取类型断言超出既有断言数限制，改用真实形状校验后的 asserts 类型守卫，未改变限制或放宽测试。初次 lint 的长度违规按职责提取测试 helper 后消除，没有增加规则豁免。

浏览器边界：归档相机可能将题卡底部的“重试保存”置于指针可视区域之外；本探针通过按钮 focus + Enter 验证原有键盘操作，不使用 force 点击、不重置相机、不删除重试断言。这里未重设计白板相机/错误提示布局，仍作为交互局限记录。手机仅为 Chromium 手机视口，不代表真机触控验收。未启动、重启或修改日常服务和真实作答目录。
