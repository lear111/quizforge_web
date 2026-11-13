# V2 第 2.5 段：第一批 V1 退役

依据 [#101 的清单](V2-SEG2-5-V1-INVENTORY.md)及[负责人确认](https://github.com/lear111/quizforge_web/pull/101#issuecomment-6860548010)，本次只去掉可独立退役的入口，独立的 CI 性能检查改跑 V2。`main`、`v1-final`、演示源、前后端业务逻辑和归档格式不变。

| 项目 | 结果 |
| --- | --- |
| 删除的文件、用例 | `core/test/performance/perf-fixture.test.mjs`（4 项：V1 A1 夹具与旧状态、夹具上的只读统计和哈希、V1 环境哨兵、V1 计时统计与解析）；保留 `core/test/tooling/inspect-state-sizes.test.mjs` 的 3 项独立统计脚本测试。普通套件未删除用例。 |
| 删除的命令 | `core/package.json` 的 `start:v1`、`test:rules` 及 `core/scripts/test/run.mjs` 的独立 `rules` 分组。规则进程仍被旧链路使用，默认 `npm test` 仍跑 `core/server/rules-runner.test.cjs`。 |
| 依赖与打包 | 本次未移除依赖或打包内容。AJV、旧服务文件及其覆盖仍有可运行的调用方，见下表。 |
| 生成的 UI | `core/web/ui/quizforge-ui.js`：原始 244,451 → 244,451 B，默认 gzip 84,356 → 84,356 B，差值均为 0；SHA-256 前后均为 `2c47a0ab1bff448ad9531fb1e1670e9bd8d51d7e2b6daacef0c691a97c47c892`。 |

| 未删除 | 保留原因 |
| --- | --- |
| `core/server/main.mjs`、`host/http/server.js`、`host/practice/short-answer-upgrade.js` | 后续复用的 `core/desktop/windows/TrayContext.cs:121–139` 会检查并启动 `main.mjs --desktop`，用旧服务的托盘状态协议；`Start-QuizForge-Web.ps1:114` 和富文本预览也直接调用该入口。`main.mjs:30` 无条件导入 HTTP 服务与升级模块；不能只删后两者。V2 的 CLI 不支持 `--desktop`；不在本 PR 改启动器。 |
| `host/extensions/{rule-engine,write-environment,validation-cache}.js`、`host/library/import-validation.js`、`core/server/rules-runner.cjs` | 旧 HTTP 服务仍实例化规则引擎和题库（`host/http/server.js:14–15`），后者仍直接导入环境指纹、缓存与导入校验（`host/library/library.js:19–27`）。题库制作的 `skills/quizforge-bank-builder/scripts/validate-bank.mjs:348,444–445` 也会启动并验证旧 runner。 |
| AJV 及其依赖 | `rules-runner.cjs:6` 和题库制作脚本的 schema 预览（`validate-bank.mjs:306`）还直接调用 AJV；`core/scripts/build/stage-windows-app.mjs` 仍调用 `runtime-dependencies.mjs` 打包它们，现有托盘运行依赖这套包。安装器/工具可迁移或明确退役后，再完整移除旧链和对应测试。 |

`core/test/performance/v2-backend.test.mjs` 新增 2 项：20 与 200 题各预热 5 次、测 30 次打开、读题、保存答案与保存白板。每个操作都检查有效载荷、锁定前无参考答案；保存还检查版本、重启后从磁盘读回，以及 `Server-Timing` 各阶段与总值一致。报告中位数、P95；每个本机请求最多 5 秒，不把波动较大的毫秒数当跨机器性能承诺。既有 `test:perf` 命令和 CI job 不变。仅用合成数据和随机回环端口。

验证：类型与构建一致检查通过；Chrome 157.0.8103.39 桌面和手机视口分别打开基础题型公开演示，7 题选答、保存、提交、评分和重开均通过，页面异常 0。完整套件本地对照及 CI 结果待运行完成后补录。
