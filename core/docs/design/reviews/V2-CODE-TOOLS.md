# V2 代码规范工具（待审查）

## 范围与顺序

#108、#109、#110 均已审查合并。本 PR 仅执行近期顺序②中的“工具”，以 `v2` 为目标；工具审查后另开一次性整理 PR。#112 已审查合并，本 PR 已同步其基线；Express、重复遍历、可读性与 Pinia 重组尚未开始，归档与历史暂不实施。

## 改了什么、没有改什么

- 文件：`core/eslint.config.mjs`、`core/prettier.config.mjs`、`core/scripts/quality/{scope,format,lint}.mjs`、`core/test/v2/code-quality.test.mjs`、`core/package{,-lock}.json`、`.github/workflows/ci.yml`、`CONTRIBUTING.md`、进度页和本记录。
- ESLint 检查 JS / TS / Vue，Prettier 统一缩进、引号与 LF 换行；100 字符、一行一条语句、未使用变量、未声明变量等报错。TS 名称检查沿用 `vue-tsc`；Vue 模板变量、示例与浏览器探针使用的浏览器/SDK 全局名称正确声明，不误报。
- 明确限定 V2 目录和开发脚本；沿用 V1 模块、构建产物和被忽略的数据排除。Git 清单含未提交新文件，新增源码也受检查。
- `format:check`、`lint` 只检查；`format:v2` 显式写入。新增独立 CI job 同时收集两个检查的真实失败结果，上传日志 7 天，不使用跳过或 `continue-on-error`。
- 七项工具依赖仅入 devDependencies；运行时依赖及锁文件中既有生产依赖的版本与完整性字段不变。未修改任何业务源码、旧测试断言、响应、存储格式、评分、沙箱、构建产物或真实数据；未格式整理现有源码。本 PR 无行为变化。

## 验证与实际结果

本地 Windows、Node 24.13.0：`typecheck:ui` 与 `build:ui -- --check` 通过；V2 测试 94/94 通过，独立性能测试 2/2 通过。新增四项用例覆盖范围边界、JS 规则、TS/Vue 模板解析及格式检查不写入。

本地完整测试 1355 项：1344 通过、10 失败、1 取消，1021.57 秒。名单（均在 CI 通过，未改断言）：`server/host/ai/hub-connection.test.mjs` 第 68/88/96/114/133/160 行、`settings-provider.test.mjs` 第 32/54 行报设置文件访问保护失败；`server/host/http/server.test.mjs:290` 预期 200 实际 503；`server/host/library/library-export-images.test.mjs:115` 的 case 2 报目录 rename EPERM；`test/desktop/windows-tray.test.mjs:170` 报原有 60000 ms 超时（取消）。本 PR 不修这些本地差异，也未据此跳过测试或延长超时。

合入 #112 后源码检查：74 个文件，68 个文件格式不符；3267 条规范错误，0 警告。工具与新测试自身 0 错误。旧源码在本 PR 保持原样，因此新增规范 job 预期失败；须在审查后另行整理，不能将失败描述为全绿、不能先合并。没有界面变更，本 PR 未重复浏览器验收。性能测试仅验证既有测试通过，不据并行本地运行声称速度改善。

CI 证据：[运行 43546124706](https://github.com/lear111/quizforge_web/actions/runs/43546124706)，实现提交 `557cadd`；之后只回填文档。

| CI job | 结果 / 总耗时 | 失败名单 |
|---|---|---|
| Checks / Ubuntu | 1321 通过、0 失败、34 个既有平台跳过；2 分 | 无 |
| Checks / Windows | 1355 通过、0 失败、0 跳过；3 分 42 秒 | 无 |
| Performance / Ubuntu | 2 通过、0 失败；14 秒 | 无 |
| V2 code quality / Ubuntu | 失败；19 秒 | 61 个文件格式不符、2850 条规范错误，与本地一致 |

## 存疑事项

工具与整理按要求分开，因此本 PR 暂不满足新增规范检查的合并门槛；停在审查阶段，不自行合并或开始整理，不修改既有规则来隐藏问题。后续若某项规范修正需要改变行为，应单独报告。

**同步 #112**：`923259b` 已合入 v2（CI 运行 43547627494：Windows 1367 通过，Ubuntu 1333 通过/34 个既有跳过，性能 2 通过，均 0 失败）。本 PR 对比最新 v2 仍仅含工具与记录，无业务变化。本地 V2 首次整组 109 通过/1 失败（`submit.test.mjs:132`，`fetch failed` / `ECONNRESET`），单文件复测及同步后 CI 待回填。上表保留同步前的工具 CI 证据，不将其当作同步后的最终结果。
