# 贡献指南

V2 开发以 [总体设计](core/docs/design/V2_ARCHITECTURE.md)、[工作流程](core/docs/design/V2_WORKFLOW.md)、[一页进度](core/docs/design/V2_PROGRESS.md) 为准。旧计划与审查长文已移入 [归档](core/docs/design/archive/README.md)，仅作记录，不需要阅读。接口与状态的已批准约定见 [速查](core/docs/design/V2_API_AND_STATE.md)。

## 开始开发

开发分支从 `v2` 创建，PR 目标也是 `v2`。`main` / `v1-final` 保留 V1，除严重缺陷不再更新。第一个单选题流程已在开发分支实现，仍需风险审查和试用；当前状态见进度页。

安装 [Node.js 24.x](https://nodejs.org/en/download)（Windows 选 x64 MSI，保留 npm 和 PATH），在独立克隆和合成数据上开发：

```powershell
npm --prefix core ci --ignore-scripts
node core/server/v2-main.mjs --root examples/v2 --port 8794
```

访问 `http://127.0.0.1:8794/`，Ctrl+C 停止。Windows 可双击“启动 V2 基础题型演示.cmd”（旧单选演示入口也可）。示例题库和题型均在 `examples/v2/`，演示作答保存在该题库文件夹内部被忽略的 `.qf-v2/state.json`（D19），不覆盖原基础题型。`Start-QuizForge-V2.cmd` 和 `npm --prefix core start` 仍以仓库根目录作为数据根，只有该根已安装 V2 题库时才会显示可用题目。旧 `QuizForge.exe`、旧启动与安装脚本尚未接入 V2，不能用来验收；打包在功能第 7 段处理。V2 不读取 V1 的 `.state`、设置和密钥，不自动迁移真实数据。

前端 Vue / TypeScript 源码在 `core/frontend/`，产物在 `core/web/ui/`；修改后运行 `npm --prefix core run build:ui`。底层通用工具在 `core/server/host/platform/`，新后端在 `core/server/host/v2/`。`core/docs/reference/` 中未迁移的旧接口说明只描述 V1，不能覆盖 V2 总体设计。

## 检查与合并

CI 在 Windows、Ubuntu 检查 Node.js 24，另有 Ubuntu 性能测试与 V2 代码规范检查。所有 PR 必须四个 job 全绿，以 CI 结果为准；不跳过、删除、放宽测试，不加重试掩盖失败。对应本地四条命令：

```powershell
npm --prefix core ci --ignore-scripts
npm --prefix core run typecheck:ui
npm --prefix core run build:ui -- --check
npm --prefix core test
```

独立性能测试：`npm --prefix core run test:perf`。CI 失败日志保留 7 天；如实记录未验证内容和本地环境差异。界面变化须做真实浏览器检查，接口成功不等于界面验收通过。

V2 源码另有独立的代码规范 CI 检查，合并前同样必须通过：

```powershell
npm --prefix core run format:check
npm --prefix core run lint
```

使用 Prettier 统一 JS / TS / Vue / CSS 格式、ESLint 检查 JS / TS / Vue，行宽上限 100，一行一条语句，未使用变量与未声明变量报错（TS 的名称检查由现有类型检查负责）。URL、字符串、模板字符串与正则不强行折行。范围见 `core/scripts/quality/scope.mjs`：V2 后端、前端、共享模块、测试、示例和开发脚本，加上规范工具自身；沿用的 V1 模块、构建产物和被忽略的本地数据不参与。默认两个命令都只检查，不改文件；显式执行 `npm --prefix core run format:v2` 才会写入格式调整。工具依赖仅在 `devDependencies` 中，运行时依赖保持不变。

按 #115 审查决定，函数 50 行、普通文件 300 行、Vue 文件 150 行暂为警告（不计空行和注释，测试排除）；`lint` 有错误才失败。完整警告清单见 [整理记录附录](core/docs/design/archive/V2-FORMAT-WARNINGS.md)。一次性整理只记录长度问题，后续可读性 PR 再处理，不在格式 PR 中改逻辑。

引入工具与整理既有代码分开提审。工具 PR 会如实报告既有格式与规范问题，不能因为新检查失败就跳过检查或降低规则；待工具审查后，在单独的整理 PR 处理，不混入功能改动。

作答保存、锁定、分数、重做、历史/考试存储、题库写入、solution 发送、沙箱、鉴权/LAN 等高风险 PR 等审查通过再合并；其他 PR 在 CI 全绿后可合并。一个 PR 只做一件事，不顺带增加用户功能或检查、缓存、限制等保护机制；需改变这些行为时先依工作流程取得决定。

各 PR 的说明同步提交为 `core/docs/design/reviews/<任务>.md`，**不超过一页**；写清范围、没有改什么、测试与 CI 四个 job 的实际结果、失败名单、必要计时和存疑事项。更新 PR 描述时同步更新文件，未完成的检查写“待确认”。长篇原始证据存归档，不作为当前必须阅读的排期。

功能合并后提供五步以内的试用方法，负责人确认“可以”才算完成，并更新进度。完整说明见工作流程；不沿用已取消的 P1–P6 后端先行排期。

## 标准答案、数据与授权

既有 V1 磁盘/内存标准答案仍由 `core/test/practice/state-golden.test.mjs` 验证，包含 AI 历史场景；不能为让测试通过重新生成。若后续明确改变持久化输出，须在同一 PR 更新标准答案、说明原因、生成命令与 SHA-256。原方法见 [B2](core/docs/design/archive/reviews/B2.md) 与 [B2-2](core/docs/design/archive/reviews/B2-2.md)。V2 不迁移这些文件，新持久化格式用独立测试验证。

提交前检查 `git diff` 与 `git status`，只提交本次代码、必要测试和可公开的合成样例。真实题库、作答、图片、历史、密钥、密码、临时输出、依赖目录、生成的 EXE/安装包不提交。不要未经授权访问真实数据、结束日常服务或部署。

Issue 提供复现、预期与实际结果、版本、系统和浏览器，移除个人内容与密钥。贡献按 [MIT 许可证](LICENSE) 授权，不提交授权不明的题目、图片或代码。
