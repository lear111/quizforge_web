# J：D50 练习存储路径调整

状态：[PR #178](https://github.com/lear111/quizforge_web/pull/178) 已审查通过（Review #5914588155），最新 CI 五项全绿，2026-11-16 squash 合并到 `v2`（`0a48745`）；本阶段仅 D50 路径调整，归档与历史未实现。基线 `v2` / `6cb35d2`。依据 D19、D27、D33、D50 及数据结构第 2、3、5 节。本记录同时作为本次 PR 的完整描述。

## 修改与不变项

| 对象 | 旧位置 | 新位置 |
|---|---|---|
| 当前练习主状态、文件身份及缓存键 | `.qf-v2/state.json` | `.qf-v2/practice/state.json` |
| 区外笔迹、目录索引读取/清除的范围 | `.qf-v2/ink/<contentFingerprint>/<SHA256(questionId)>.json` | `.qf-v2/practice/ink/<contentFingerprint>/<SHA256(questionId)>.json` |

`StateRepository.file/load/commit/exists/evict` 共用新路径；`PracticeInk` 的读取、保存、索引、单题删除及全部清除均限定在 `practice/ink`。索引仍归属原有题库 LRU，逐出语义不变。新增小型路径模块复用受检父目录检查；默认原子写入继续由 `replaceFile` 检查祖先，非写入路径检查 `.qf-v2` 与 `practice`。没有答案和笔迹时不创建 `practice` 或状态文件。

未改动 JSON 字段/格式、32 MiB 单文件上限、独立笔迹版本与四条回执、错误响应结构、API、保存/锁定/评分/重做顺序、内容指纹及缓存策略、JSON 编码器或前端界面。未实现 restart、归档、历史、考试或 AI Agent；没有读取或清理开发者真实数据，没有启动或重启日常服务。

## 旧开发记录处理与失败恢复

只在正常打开/刷新流程检查两个精确旧位置，不把旧记录载入当前答案，不迁移、不复制。低层新状态读取不会悄悄处理旧文件。先完整预检旧 state 与旧 ink：受检真实路径、普通文件/目录、JSON（含重复键）、已知状态结构、笔迹结构及摘要目录/文件名；保留现有读取大小限制。可识别的早期回执格式也在范围内。确认全部内容后再逐项删除，删除前再检查身份；不用递归删除，不删除 `.qf-v2/`，不扫描/触碰 `practice`、`exam`、`rounds` 或无关同级内容。

- 预检发现损坏、不明字段/目录、链接、重定向或读取时变化：旧记录整套保留，返回 `STATE_INVALID` / 503，中文提示旧位置无法安全识别、原文件保留；需检查旧位置后再打开，不静默忽略错误。
- 删除中途失败：`STATE_WRITE_FAILED` / 503，未处理文件保留。先删旧笔迹、最后删旧状态；已删除的、确认属于旧开发记录的文件不回滚。下次打开可继续清理，当前新练习及其他目录不变。没有多文件事务或额外恢复日志。
- 新状态和新笔迹的写入仍为原子替换；失败时缓存只保留已提交图，旧字节不变，相同请求可重试。内容变化只清当前 `practice`，其他目录不受影响。

## 文件清单

- 后端：`repositories/state.repository.js`、`ink.repository.js`；新增 `practice-directory.repository.js`、`legacy-practice.repository.js`；`services/practice.service.js` 仅在 reconcile 入口调用旧位置清理。
- 测试：新增 `test/v2/practice-storage-paths.test.mjs`（8 项）、`practice-legacy-cleanup.test.mjs`（20 项）及 `test/fixtures/v2-practice-storage.mjs`；同步 storage、submit、position、server-assertions、archive-measurement 的硬编码路径。
- 浏览器/诊断：`scripts/dev/probe-v2-router.mjs` 清除夹具当前练习时限定为 practice；`v2-archive-fixture.mjs`、`v2-archive-metrics.mjs` 使用新源路径，不实现归档接口。
- 文档：同步 `V2_DATA_STRUCTURES.md`、`V2_API_AND_STATE.md`、`V2_PROGRESS.md` 和原 J 记录 `reviews/V2-J-HISTORY.md`（仓库没有另一个 `V2_J_HISTORY.md`）。I② 试用状态及 K 排期不变。
- 前次测量 JSON **未改动**：`V2-J-ARCHIVE-MEASUREMENTS.json`，SHA-256 `6253a14233b636ff0720341959dafb7a05e1c8f31b9835898f3d4882cdf04ced`；原数据与结论保留，未用本次测试覆盖。

## 回归证据

新增 28 项覆盖：延迟创建；新状态/笔迹路径与缓存键；重放/冲突；新 Node 进程恢复且文件字节不变；外部删改；题库变化只清当前练习；写失败保留原图/字节及重试；新 practice、ink、指纹目录链接攻击；旧路径不作新状态；旧新并存；坏 JSON、重复键、不明字段/格式/目录/文件；旧 state/ink/指纹/文件重定向；旧回执；预检期间文件变化；删除中断后恢复；HTTP 错误提示且不泄露答案。既有拓展变化、切库、保存/评分/完成练习与恢复断言全部保留。链接测试按平台使用 symlink / Windows junction，不按语言跳过。

本地 Windows 11 Pro（10.0.26200）、Node v24.13.0：完整 V2 **272 通过、0 失败、0 跳过**（原 244 + 新增 28）；前后端类型、lint、格式、UI 构建与 `--check` 通过。lint 230 文件、0 错误、0 警告；格式 239 文件、0 差异。性能检查 **2 通过、0 失败、0 跳过**。无断言删除/放宽、无新重试或超时修改。

既有性能检查：每档 5 次预热、30 个样本，本机回环；下列为客户端 median / P95（ms）。本轮与其他验证并行，非受控前后对照，不据此声称提速或性能完全相同。

| 题数 | overview | 单题 | 保存答案 | 保存笔迹 |
|---|---:|---:|---:|---:|
| 20 | 97.849 / 180.438 | 11.482 / 26.851 | 16.575 / 66.425 | 32.713 / 77.875 |
| 200 | 136.361 / 238.433 | 11.629 / 42.626 | 17.064 / 41.885 | 30.435 / 61.077 |

路径层级增加一次父目录检查；打开/刷新增加旧位置预检，有旧记录时有一次性读取/删除成本。暖态单题保存不遍历旧记录。未做性能优化，没有发现现有性能断言退化；未测真实题库、网络盘、断电恢复或并发外部恶意替换的所有 OS 级竞态。

早期本地验证暴露并修正了两个问题：原链接测试仍攻击旧 ink 位置，已改为攻击新路径并保留断言；旧清理预检对目录误用仅接受普通文件的身份辅助函数，已改为相同六字段的目录可用身份比较。浏览器首次十项均在启动前因缺少 Playwright Chromium 失败，无页面断言执行；保留失败日志，补充环境后运行结果见下。没有用重试隐藏业务失败。

## 浏览器与 CI

本机改用已安装的 Chrome，通过同一套十项探针（page、page-contract、grading、page-review、practice、save-recovery、whiteboard、basic-types、completion、router），0 项失败；各探针原有桌面/手机场景和保存失败、版本冲突、完成练习断言均保留。没有修改测试超时或增加重试，最初缺少 Chromium 的十份失败日志也保留在被忽略的 `.temp` 中。CI 继续使用工作流原定的 Playwright Chromium。

实施提交 `be3cc53` 的 [CI run 43792215562](https://github.com/lear111/quizforge_web/actions/runs/43792215562)，首轮结果如下。没有失败用例被删除、跳过或放宽。

| CI job | 首轮结果 / 测试数量 | 总耗时 |
|---|---|---:|
| Checks (windows-latest) | 1531 通过、2 失败、0 跳过；D50 新增测试全通过 | 4m15s |
| Checks (ubuntu-latest) | 1499 通过、0 失败、34 项原有平台跳过；含类型/构建检查 | 2m11s |
| V2 code quality (ubuntu-latest) | 格式、lint 全通过 | 20s |
| V2 browser checks (ubuntu-latest) | 原有十项探针全通过 | 3m59s |
| Performance (ubuntu-latest) | 2 通过、0 失败、0 跳过 | 14s |

Windows 首轮失败完整名单：

| 文件 / 用例 | 首条错误 | 调查 |
|---|---|---|
| `core/server/host/ai/hub-connection.test.mjs:68` — completing login saves only the device token, reads quota, and logout revokes it | `AI_SETTINGS_SAVE_FAILED` / 503：无法完成 AI 设置文件的访问保护，设置未确认保存，请重启服务后重试。 | 失败于 `ai-settings.js` 的 PowerShell 访问保护，约 15.311s |
| `core/server/host/ai/settings-provider.test.mjs:32` — AI settings preserve masked-key editing and owner-protected saved credentials | 同上 | 同一保护路径，约 15.066s |

两处测试、AI 保护实现和脚本与基准完全无差异，也不使用本次练习路径。保护调用固定超时为 15s，但异常被统一包装，日志未保留底层原因，不能只凭耗时断言一定超时。仅针对失败的 Windows job 手工复核一次，不改代码、超时或测试重试策略：同一实施提交的 [attempt 2 / job 133055162821](https://github.com/lear111/quizforge_web/actions/runs/43792215562/attempts/2) **1533 通过、0 失败、0 跳过，5m11s**。首次失败的两项均通过；因此确认本次首轮失败未稳定重现，底层原因仍不确定，不把它定性为已经修复的缺陷。

实施提交五项 CI 均通过；以上保留首轮及复核的完整结果，不称首次全绿。随后提交只同步本记录与进度页，不改生产代码或测量数据；最终 PR 仍执行原有五项检查。无失败名单被隐去。PR 保持待审查，不合并、不开始历史或 K。
