# J：练习归档与「再练一次」

目标分支 `v2`，基线 `616e2ac`。[PR #180](https://github.com/lear111/quizforge_web/pull/180) 已审查通过（Review #5915183191），最终 head `44f8163` 的 CI 五项全绿，squash 合并到 `v2`（`355549b`）；历史回看相关接口未实现。依据 D20、D22、D23、D42、D50，以及 `V2_ARCHITECTURE.md` 4.9、`V2_DATA_STRUCTURES.md` 2–4、`V2_API_AND_STATE.md` 的 restart 约定。本文与 PR 描述同步。

## 改了什么

- 实现 `POST /api/v2/banks/{bankId}/restart`：仅已完成、快照匹配的练习可以归档，成功返回新轮概览。
- 完整复制原 `bank.json` 字节、已解析且未被替换的题型拓展文件、独立白板笔迹。最终 state 沿用原 JSON 编码器/格式；仅尚无有效分数的题在候选中记 0，评分消息按现有数值结果格式为 null；已评分题逐字节保留。素材不复制，引用不改写。
- 汇总页增加确认按钮。先 flush iframe/白板/保存队列，再把归档放进原写队列。失败保留汇总和冻结的请求体，成功清掉旧题页、文件缓存、评分服务与批次，进入新轮第一题。
- 更新 API、结构、进度说明及共享声明；原 `safeDirectory` 只补准确类型声明，没有改动该平台函数。

## 提交顺序与恢复

内部 `.qf-v2/restart.json` 是最近一次轮次转换的恢复回执，**不是历史索引**。只含请求编号摘要（不受原编号长度影响）、原快照、轮次 UUID、prepared/committed 与前一操作的单条回执。新轮 UUID 加入 snapshotId，不参与 contentFingerprint，不改变 state.json 格式。

1. 读取并检查已完成练习，创建 detached 最终评分候选；原状态不变。
2. 在 `.qf-v2/.restart-<UUID>/archive/` 写齐 bank/state/extensions/ink；`fresh/` 为空新练习。复制前比较全部拓展文件摘要，逐文件复制再核对摘要；bank 核对打开时的原始摘要。源文件缺失/替换/复制失败不切换练习。
3. 原子写 prepared 回执。将 `practice/` 改名到 `previous-practice/`，再把 fresh 改名为 practice，把完整 archive 改名为 `rounds/<UUID>/`。
4. 原子写 committed 回执，这是提交点。此后再替换内存缓存、打开新快照并清理暂存备份。

每个候选文件及回执沿用 replaceFile：受检路径、wx 临时文件、文件 fsync、原子 rename。没有声称多文件 rename 本身有事务性。打开/刷新题库和 restart 开始时先恢复：

- 提交点之前：回滚目录切换，恢复原已完成练习及前一成功回执，然后删除本次未提交候选。恢复若遇到非空的新 practice、链接或不可读路径，停止并保留，下一次可继续；不猜测哪个内容可以丢弃。
- 提交点之后：永不回滚、删除或覆盖新练习；只安全清理暂存备份。清理失败返回成功及 notice，保留备份；后续打开重试清理。旧备份未能清理时不启动下一次新的归档，避免丢失其恢复线索。
- prepared 写入前退出可能留下未登记的暂存孤儿；它不位于 rounds 中、不能被当作历史。当前不遍历自动清理这种未知目录。
- 普通读题仍用既有内存快照，不新增文件系统检查。服务重启时加载持久回执；同一服务内成功归档立即驱逐旧快照/作答缓存。

## 重复请求与不可变边界

- 同一请求编号及原快照重发，读取 durable committed 回执返回当前新轮概览；HTTP 响应丢失或服务重启不会重复生成历史。不同编号配旧快照被拒绝；同一编号用于不同快照返回 REQUEST_CONFLICT。更旧回执即使不再保留，也因轮次快照不同而不会误归档下一轮。
- 新旧轮的 snapshotId 不同，旧标签页/迟到的保存、评分、完成和归档不能写进新轮。新轮的 contentFingerprint 不变，清空通过更换 practice 目录完成，无答案时不预写空 state。
- 历史 bank/state/extensions 为物理副本，后续修改源文件不影响它们。没有历史答案、评分或题库写 API；不设置操作系统只读位，也不把外部文件编辑当作受保护边界。ink 与 state 分离，供未来独立笔记接口使用。
- 当前未实现 D56 的 answer-files；未知 practice 文件、符号链接/联接点、非法目录保留并拒绝，不提前实现文件上传或静默删除未知资料。

## 明确没有改什么

不改保存、提交、评分、重做的现有请求体及状态机；不改 JSON 编码、题型协议、评分 Worker/沙箱、素材引用。未实现历史列表/详情/删除/回看/历史笔迹接口、考试 K、AI Agent、人工评分或 D56。不使用真实数据、不停止日常服务、不部署、不打包。#176 的模拟数据 JSON 原样保留（SHA-256：`6253a14233b636ff0720341959dafb7a05e1c8f31b9835898f3d4882cdf04ced`）。

## 文件职责

- `repositories/restart-files.repository.js`：受检复制、改名、目录与保守清理。
- `repositories/restart-journal.repository.js`：单条恢复回执、严格路径、回滚与提交后清理。
- `services/practice-archive.service.js`：最终分数候选、已用拓展核对、归档事务顺序及重放。
- `bank-open.service.js` / `bank.service.js`：加载前恢复、新轮快照、restart 入口；routes/controller/types 同步。
- `stores/practice/restart.ts`、API/actions/runtime/FinalScore/WorkspaceView：保存屏障、冻结请求与成功/失败页面切换。
- `test/v2/restart*.test.mjs`、合成 fixtures：归档/失败/进程退出/路径/Store 回归。
- 原 completion 浏览器探针追加桌面/手机确认、失败、真正提交后的响应丢失与同体重试；原断言全保留。原 readonly 用例将已实现 restart 的旧 501 预期改为畸形请求 400，继续检查没有 solution、没有写盘。
- `measure-v2-restart.mjs` 及写入计数 helper：独立临时根、回环、200 题真实 HTTP 测量；没有生产诊断开关。

## 验证结果

实现提交 `045c2df`、`7f7ef37b97c7c1b0af8a0a5aff6ea192a0f47aa2`。以下为该最终代码的实际结果；没有增加测试重试、延长超时、跳过用例或降低断言。

| 本地检查 | 结果 |
|---|---|
| `npm --prefix core run typecheck:ui`、`typecheck:server` | 均通过 |
| `npm --prefix core run lint` | 242 个文件，0 错误、0 警告 |
| `npm --prefix core run format:check` | 251 个文件，无格式差异 |
| `npm --prefix core run build:ui`、`build:ui -- --check` | 均通过；生成 JS/CSS 未被 Git 追踪 |
| 全部 `core/test/v2/*.test.mjs`，测试环境加载器、并发 4 | **315 通过、0 失败、0 取消、0 跳过**，80.179 秒；原 272 项 + 新增 43 项（含子用例） |
| 十项现有浏览器探针 | 全部通过；completion 包含 1440px 桌面及 390px 手机的归档流程，浏览器 errors 为空 |
| `npm --prefix core run test:perf` | 2 通过、0 失败，10.115 秒 |
| `npm --prefix core test`（整个仓库，包含 v1） | 1576 项：1562 通过、13 失败、1 取消，1149.635 秒；完整名单见下表 |

V2 运行命令：`node --import ./core/scripts/test/test-environment.mjs --test --test-concurrency=4 <core/test/v2 下全部 .test.mjs 文件>`。浏览器命令沿用 `node core/scripts/dev/probe-v2-<名称>.mjs .temp/v2-browser/node_modules/playwright/index.mjs chrome`，名称为 page、page-contract、grading、page-review、practice、save-recovery、whiteboard、basic-types、completion、router；工具位于忽略目录，不新增依赖。

新增专项覆盖：未完成与旧快照拒绝；零分/原有效分数/锁定/答案；bank/拓展副本与源修改隔离；笔迹与空新轮；重复/冲突/迟到请求/服务重启；五处 precommit 回滚；状态写、拓展复制、目录切换失败；六处真实子进程退出；第二次归档失败恢复上一回执；提交后清理失败；回滚遇到额外新作答时同时保留两份；链接/非法目录/未知 practice/畸形 journal；没有历史读写接口；Store 队列、并发点击、冻结重试与保存失败屏障；冷请求/缓存驱逐后源内容变化及拓展缺失仍保留原已完成练习。

过程中发现并修复：逐请求恢复曾令 normal-read 多做目录检查、提前改变既有路径错误码，现只在加载/归档边界恢复；冷归档曾可能调用普通 open 触发内容变化清理，现先构造只读快照并比较再处理。原 readonly 中 restart 尚未实现的预期同步更新。另一次并发完整 V2 中 D19 读题收到 ECONNRESET，新增恢复用例一次 immediate retry 收到 503；浏览器 router 在完整仓库测试同时运行时一次 workspace-motion 等待超时。停下重负载测试后原文件/探针原样重跑，最终全量 315 项和 router 均通过；没有修改这些超时或断言，CI 原始单轮也通过。

### 本地完整仓库回归的非通过项

以下均在未修改的旧版测试及生产路径，不能把本地完整回归说成全绿。未在本任务另建基线检出重跑，因此不将原因推断当作已证实的基线结论。8 项直接报告 Windows 私有凭据 ACL 保护失败，HTTP 登录项返回 503；另有规则/托盘时间与子进程问题。CI 两系统的同一套测试无失败，见后表。本地日志留在忽略目录，不提交真实用户数据。

| 文件（相对 core/） | 用例名 | 首条错误 / 结果 |
|---|---|---|
| server/host/ai/hub-connection.test.mjs:68 | completing login saves only the device token, reads quota, and logout revokes it | AI_SETTINGS_SAVE_FAILED：无法完成 AI 设置文件的访问保护 |
| server/host/ai/hub-connection.test.mjs:88 | a token the Hub rejects logs this computer out | 同上 |
| server/host/ai/hub-connection.test.mjs:96 | the free quota grades through the Hub gateway with the device token and keeps custom settings | 同上 |
| server/host/ai/hub-connection.test.mjs:114 | gateway errors become clear, non-retried messages and a rejected token logs out | 同上 |
| server/host/ai/hub-connection.test.mjs:133 | with both sources on, the free quota grades first and the custom model takes over when it cannot | 同上 |
| server/host/ai/hub-connection.test.mjs:160 | settings saved with one source before this version keep working | 同上 |
| server/host/ai/settings-provider.test.mjs:32 | AI settings preserve masked-key editing and owner-protected saved credentials | 同上 |
| server/host/ai/settings-provider.test.mjs:54 | disabled AI remains disabled across persisted settings reload without losing automatic preference | 同上 |
| server/host/http/server.test.mjs:290 | Hub login starts on the host only and the loopback callback finishes it without exposing the token | the free quota needs no model address：503 !== 200 |
| server/rules-runner.test.cjs:121 | merged outline jobs retain fresh globals at original request boundaries | spawnSync node.exe ETIMEDOUT |
| server/rules-runner.test.cjs:259 | VM loops, oversized output and invalid grades are rejected | assert.ok(Date.now()-before<3500) 不成立 |
| server/rules-runner.test.cjs:357 | outline hook rejects malformed arrays, unsafe labels, duplicate ids and hidden fields | spawnSync node.exe ETIMEDOUT |
| test/desktop/windows-tray.test.mjs:117 | opening a local qbank cold-starts one tray, coalesces pending opens and imports later opens independently | 90000ms 超时，1 项 cancelled |
| test/desktop/windows-tray.test.mjs:143 | running tray imports group packages and reports invalid files without partial installs or another service | Tray state did not settle：导入失败 Request could not be completed |

### GitHub CI

[运行 43802307362](https://github.com/lear111/quizforge_web/actions/runs/43802307362)，代码 SHA `7f7ef37b97c7c1b0af8a0a5aff6ea192a0f47aa2`，五个 job 全部通过；无失败用例。总耗时按 job 的 started_at / completed_at 差计算，含安装与构建；不是单纯测试耗时。

| Job | 结果 | job 总耗时 | 测试/检查摘要 |
|---|---|---:|---|
| Checks (windows-latest) | success | 251 秒 | 1576 通过、0 失败、0 取消、0 跳过；测试 167.735 秒 |
| Checks (ubuntu-latest) | success | 131 秒 | 1542 通过、0 失败、0 取消、34 既有平台跳过；测试 105.583 秒 |
| Performance (ubuntu-latest) | success | 20 秒 | 2 通过、0 失败 |
| V2 code quality (ubuntu-latest) | success | 19 秒 | 格式及 lint 通过 |
| V2 browser checks (ubuntu-latest) | success | 220 秒 | 原有十项探针各执行一次，全部通过，含桌面/手机归档与响应丢失 |

## 200 题真实接口测量

命令 `node core/scripts/dev/measure-v2-restart.mjs`。Windows 11 Pro `10.0.26200`、i5-13500H（16 logical CPU）、Node `v24.13.0`；每档 200 题、3 个实际内置拓展、预热 5 次、有效 30 次。真实 POST 至响应 JSON 收完；种子恢复、目录计数与临时清理在计时外。全部三个独立临时根清理核对成功。新原始证据：[V2-J-RESTART-MEASUREMENTS.json](V2-J-RESTART-MEASUREMENTS.json)。

| 合成场景 | n | 真实 HTTP median / P95 ms | 归档文件数 | 归档字节 | 实际写文件次数 | 实际写入字节 | #176 模拟 median / P95 ms（仅背景） |
|---|---:|---:|---:|---:|---:|---:|---:|
| small-no-ink | 30 | 343.516 / 398.848 | 20 | 265732 | 22 | 266635 | 43.075 / 65.398 |
| small-with-ink | 30 | 1426.082 / 3341.974 | 120 | 1849839 | 122 | 1850742 | 229.142 / 406.289 |
| large-with-ink | 30 | 1554.134 / 2055.181 | 120 | 16244149 | 122 | 16245052 | 250.232 / 348.868 |

数值以新 JSON 原始值为准；写入计数为进程内临时 hook 统计 fs.writeSync 返回的字节与写文件打开次数，包含 bank/state/拓展/笔迹及两次 journal，rename 不重复计数，不是物理磁盘写放大。目录元数据写入不计为文件正文。三档有效样本中这些文件数与字节数保持一致。

这不是 #176 的等量前后优化对比：#176 是直接 copy 的模拟归档，没有真实 HTTP、完整题库/拓展核对、持久回执、目录切换、恢复及响应概览；其目录复制没有逐文件 fsync。本次每个副本沿用安全原子写入。还将旧合成已评分小题的 outline 对齐到其 parts，满足真实接口的数据语义。真实接口明显慢于模拟，尤其含 100 份笔迹时；没有据此替换 JSON 编码器或未经批准改变文件安全策略。没有测多用户并发或恶劣磁盘负载；同步文件操作会在归档期间占用此本地服务的事件循环，应由后续实测/审查决定是否需要异步化。

## 审查后保留事项

归档采用同步文件操作，200 题、100 份笔迹的真实 HTTP 测量 median 约 1.43–1.55 秒、P95 可达约 3.34 秒；可能阻塞单机 Node.js 服务的其他请求。CI 五项通过不构成生产 100 并发验收，需要单独测并发延迟。当前 `restart.json` 的 committed 回执恢复时要求最新轮次目录存在；后续实现删除历史尤其删除最新轮次时，须同步处理回执/恢复与旧请求重放语义，否则可能影响打开当前练习。本轮未提前实现该修改。

## 潜在风险和未测试事项

- 覆盖正常进程退出与文件系统错误，不承诺突然断电/磁盘控制器缓存情况下的多目录持久性；现有平台无目录 fsync。恢复失败会停下并保留原件，可能需要解决权限/占用后重试。
- 不支持多个服务进程同时使用同一数据目录（沿用现有单进程存储前提）；多浏览器标签共享一个服务受快照隔离保护。
- 原拓展已被覆盖/删除时拒绝归档，无法从未保存的内存脚本反推完整旧版本，需要恢复原文件后重试。
- 冷请求（服务重启或 LRU 驱逐）只重建只读快照并比较，不调用普通 open 的内容变化清理。否则旧快照拒绝前可能误清已完成练习；已用专项用例覆盖题库/拓展变化、拓展缺失及未预先打开的正常归档。
- 素材仍依赖源题库；未来回看需兑现缺失素材提示。本 PR 没有可见的历史回看入口。
- 浏览器手机尺寸测试不等于 Android/iOS 真机验收；实现不触及旧安装包或服务器部署。
