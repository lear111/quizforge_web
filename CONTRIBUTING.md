# 贡献指南

V2 开发以 [总体设计](core/docs/design/V2_ARCHITECTURE.md)、[工作流程](core/docs/design/V2_WORKFLOW.md)、[一页进度](core/docs/design/V2_PROGRESS.md) 为准。旧计划与审查长文已移入 [归档](core/docs/design/archive/README.md)，仅作记录，不需要阅读。接口与状态的已批准约定见 [速查](core/docs/design/V2_API_AND_STATE.md)。

## 开始开发

开发分支从 `v2` 创建，PR 目标也是 `v2`。`main` / `v1-final` 保留 V1，除严重缺陷不再更新。目前只有 V2 后端读取部分，能启动说明页，尚不能做题；第一个可试用功能的范围见进度页。

安装 [Node.js 24.x](https://nodejs.org/en/download)（Windows 选 x64 MSI，保留 npm 和 PATH），在独立克隆和合成数据上开发：

```powershell
npm --prefix core ci --ignore-scripts
node core/server/v2-main.mjs --root . --port 8794
```

访问 `http://127.0.0.1:8794/`，Ctrl+C 停止。Windows 也可用 `Start-QuizForge-V2.cmd`，或 `npm --prefix core start`。旧 `QuizForge.exe`、旧启动与安装脚本尚未接入 V2，不能用来验收；打包在功能第 7 段处理。V2 不读取 V1 的 `.state`、设置和密钥，不自动迁移真实数据。

前端 Vue / TypeScript 源码在 `core/frontend/`，产物在 `core/web/ui/`；修改后运行 `npm --prefix core run build:ui`。底层通用工具在 `core/server/host/platform/`，新后端在 `core/server/host/v2/`。`core/docs/reference/` 中未迁移的旧接口说明只描述 V1，不能覆盖 V2 总体设计。

## 检查与合并

CI 在 Windows、Ubuntu 检查 Node.js 24，另有 Ubuntu 性能测试。所有 PR 必须三个 job 全绿，以 CI 结果为准；不跳过、删除、放宽测试，不加重试掩盖失败。对应本地四条命令：

```powershell
npm --prefix core ci --ignore-scripts
npm --prefix core run typecheck:ui
npm --prefix core run build:ui -- --check
npm --prefix core test
```

独立性能测试：`npm --prefix core run test:perf`。CI 失败日志保留 7 天；如实记录未验证内容和本地环境差异。界面变化须做真实浏览器检查，接口成功不等于界面验收通过。

作答保存、锁定、分数、重做、历史/考试存储、题库写入、solution 发送、沙箱、鉴权/LAN 等高风险 PR 等审查通过再合并；其他 PR 在 CI 全绿后可合并。一个 PR 只做一件事，不顺带增加用户功能或检查、缓存、限制等保护机制；需改变这些行为时先依工作流程取得决定。

各 PR 的说明同步提交为 `core/docs/design/reviews/<任务>.md`，**不超过一页**；写清范围、没有改什么、测试与 CI 三个 job 的实际结果、失败名单、必要计时和存疑事项。更新 PR 描述时同步更新文件，未完成的检查写“待确认”。长篇原始证据存归档，不作为当前必须阅读的排期。

功能合并后提供五步以内的试用方法，负责人确认“可以”才算完成，并更新进度。完整说明见工作流程；不沿用已取消的 P1–P6 后端先行排期。

## 标准答案、数据与授权

既有 V1 磁盘/内存标准答案仍由 `core/test/practice/state-golden.test.mjs` 验证，包含 AI 历史场景；不能为让测试通过重新生成。若后续明确改变持久化输出，须在同一 PR 更新标准答案、说明原因、生成命令与 SHA-256。原方法见 [B2](core/docs/design/archive/reviews/B2.md) 与 [B2-2](core/docs/design/archive/reviews/B2-2.md)。V2 不迁移这些文件，新持久化格式用独立测试验证。

提交前检查 `git diff` 与 `git status`，只提交本次代码、必要测试和可公开的合成样例。真实题库、作答、图片、历史、密钥、密码、临时输出、依赖目录、生成的 EXE/安装包不提交。不要未经授权访问真实数据、结束日常服务或部署。

Issue 提供复现、预期与实际结果、版本、系统和浏览器，移除个人内容与密钥。贡献按 [MIT 许可证](LICENSE) 授权，不提交授权不明的题目、图片或代码。
