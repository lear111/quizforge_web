# 贡献指南

欢迎通过 Issue 和 Pull Request（PR）改进 QuizForge Web。一个 PR 尽量围绕一个问题，便于审查、验证和回退。较大的新功能、接口调整或目录重构，请先通过 Issue 说明方案和影响范围。

> **在 `v2` 分支上工作时**，协作流程以 [V2 开发流程](core/docs/design/V2_WORKFLOW.md) 为准，设计以 [V2 总体设计](core/docs/design/V2_ARCHITECTURE.md) 为准，进度见 [V2 进度](core/docs/design/V2_PROGRESS.md)。本文件与之冲突的约定不适用于 `v2`。

## 开始开发

本分支为本地 Web V2 重做。P1-1 仅有只读接口与“界面尚在开发”说明页；不能用它进行日常作答。开发 PR 以 `v2` 为目标；`main` / `v1-final` 保留 V1。

1. Fork 仓库，克隆自己的 Fork，从项目默认主分支创建功能或修复分支。
2. 阅读 [README](README.md)，从 [Node.js 官方下载页](https://nodejs.org/en/download) 安装 **Node.js 24.x**（Windows 选择 x64 `.msi`，保留 npm 和 PATH），安装后重新打开终端。仓库不自动下载或安装 Node；不要选择其他主版本。无需 Java、JDK 或 Maven。
3. 在仓库根目录安装依赖并启动：

```powershell
npm --prefix core ci
node core/server/v2-main.mjs --root . --port 8794
```

浏览器访问 `http://127.0.0.1:8794/`，按 Ctrl+C 停止服务。Windows V2 使用根目录的 `Start-QuizForge-V2.cmd`；`npm --prefix core start` 也启动 V2。P1 期间旧 Web 脚本、`QuizForge.exe` 和旧后端只为既有测试/留档保留，尚未接到 V2，不能用它们验收本次更新。

拉取或合并改动了 `core/package-lock.json` 的提交后，请重新运行 `npm --prefix core ci`。V2 读取独立配置，不继承 V1 的 AI 密钥或局域网密码；P1-1 不创建作答或配置文件。V1 启动器的依赖修复行为仍仅适用于留档的 V1，P1-4 再统一清理旧入口与打包路径。

P1-1 的可重复接口测量（自动生成临时合成题库，独立回环随机端口，退出时关闭进程并删除合成数据）：

```powershell
node core/scripts/dev/measure-v2-readonly.mjs 30
```

请使用独立克隆和测试数据。手动测试删除、导入、迁移等操作时使用数据副本；同一数据目录只运行一个写入服务。

## 找到相关代码和文档

- [核心目录](core/README.md)：后端、浏览器代码和测试按功能分类，新代码优先放入对应目录。
- [开发与架构](core/docs/guides/CORE_SOURCE.md)：运行方式、模块职责及数据流。
- [API 文档](core/docs/reference/API.md)：宿主、拓展页面、规则和 HTTP 接口。
- [兼容与迁移](core/docs/reference/COMPATIBILITY.md)：版本绑定、历史快照和数据升级约定。
- [开发者文档索引](core/docs/README.md)：题库格式、考试、大纲、富文本等专项说明。
- [题库制作技能](skills/quizforge-bank-builder/SKILL.md)：制作题库及拓展时的流程和操作边界。

正式文档和仓库内的实现是贡献者的依据。维护者本地的开发更新记录只用于内部整理，PR 应包含完整说明。

## 修改范围与兼容性

- 保持改动集中，避免顺带移动目录、格式化无关代码或批量修改用户数据。
- 宿主管理数据和权限，拓展定义题型、答案结构及评分规则。修改时保持这条职责边界。
- 新增接口说明参数、返回值、错误和能力声明；同一 API 主版本保持旧调用兼容。涉及破坏性变更，先讨论版本和兼容方案。
- 题库通过 `{path:"extensions/分组/拓展"}` 绑定实际拓展，路径相对数据根目录；题库和拓展均使用物理文件夹分组。旧 ID/version 绑定须先由制作者升级。拓展不区分开发版与正式版，版本号用于作者说明。修改前备份并保持题目、小题 ID、答案结构和评分契约兼容；普通管理界面不开放拓展改名或移动。只导入格式 3 的单题库包／分组包，每次新增独立副本、重名加序号，不按 UUID、版本或哈希覆盖已有内容。具体规则见 [题库包](core/docs/reference/LIBRARY_PACKAGES.md)。
- 保持旧题库、答案、资源和冻结历史可读。普通读取不迁移数据；需要迁移时说明触发方式、备份及回退步骤。
- 修改接口、格式或用户行为时，在同一 PR 中更新相应正式文档；涉及制作流程或拓展适配时，同步相关技能参考。

## 验证改动

PR 需要 GitHub Actions CI 通过，以 CI 结果为准；CI 在 Windows 和 Ubuntu 上检查 Node.js 24，性能测试另在 Ubuntu 独立运行。对应的本地四条命令如下；安装时保留 `--ignore-scripts`，不要通过跳过测试或忽略退出码掩盖失败。

```powershell
npm --prefix core ci --ignore-scripts
npm --prefix core run typecheck:ui
npm --prefix core run build:ui -- --check
npm --prefix core test
```

独立性能测试命令为 `npm --prefix core run test:perf`。CI 失败时会上传命令输出日志，保留 7 天；在 PR 中如实列出失败和环境差异。

状态兼容性由 `core/test/practice/state-golden.test.mjs` 长期验证：当前实现执行固定动作序列，以 `Buffer.equals` 对比 d3505cf 生成的标准答案。后续任务卡若有意改变持久化输出，必须在同一 PR 更新标准答案、记录生成命令与 SHA-256，并解释具体变更原因；不能仅为通过检查而重录。生成方式和覆盖范围见 [B2 审查记录](core/docs/design/reviews/B2.md)。

磁盘与内存模式分别对比各自的标准答案；内存文件的生成命令及其与磁盘文件的既有差异见 [B2-2 审查记录](core/docs/design/reviews/B2-2.md)。上述更新要求对全部标准答案同样适用，包括第二个 AI 历史轮次场景的 `history-ai-disk-d3505cf.json` 和 `history-ai-memory-d3505cf.json`，不得只为测试变绿而重新生成。

在仓库根目录执行：

```powershell
npm --prefix core test
```

这是完整自动化测试入口，包含后端、规则和前端测试。开发过程中也可按范围检查：

```powershell
npm --prefix core run test:host
npm --prefix core run test:rules
```

修复行为缺陷时补充能复现问题的回归测试；测试应验证实际行为。纯文档修改检查命令、链接和内容一致性即可。

界面或交互变化需附截图及人工测试结果。保存、提交、考试、历史或接口变化，应验证相应的真实宿主流程；手机、触控笔及真实 AI 服务相关变化，注明测试设备和实际覆盖范围。

结构校验、页面预览和模拟服务测试不能代替真实功能验收。尚未验证的部分、测试失败和未实现功能请如实列出。基础题型开发原型中未实现的保存或评分，不能记为验收通过。

## 提交 PR

1. 检查 `git diff` 和 `git status`，确认提交范围。
2. 提交代码、必要测试、文档及可公开的最小样例。个人题库、作答、图片、历史、API Key、连接密码、本地更新记录及临时报告不应进入 PR；也不提交依赖目录和缓存。
3. 将分支推送到自己的 Fork，向项目默认主分支创建 PR。未完成时使用草稿 PR。
4. 按 PR 模板说明问题、最终行为、影响范围、兼容性、验证结果和未完成事项。
5. 根据审查意见修改并复测；实现范围变化时同步更新 PR 描述。

审查者可能只能通过 Git 读取代码。每个任务卡的 PR 描述全文须同时提交到 `core/docs/design/reviews/<任务卡编号>.md`，更新描述时同步更新该文件。记录改了什么、明确没改什么、兼容性验证、计时对比、用例清单、测试摘要、CI 各 job 的结果与完整失败用例名单，以及存疑事项。CI 记录注明运行 ID 和被测提交；未运行或尚未结束的检查如实标注，不把此前结果写成当前提交的验收结果。

提交 PR 即表示你同意贡献的内容按项目的 [MIT 许可证](LICENSE) 授权；不要提交来源或授权不明的代码、图片和题目。

维护者检查代码、兼容性和验证证据后合并，优先使用 Squash 合并，让主分支中的一个提交对应一个完整改动。主分支保持可运行；预览包制作、发布验收、版本标签和发布由维护者统一处理。

公开仓库只附带基础题型展示库及五种基础拓展。根目录人工 `test/` 和开发日志为本地维护资料；`core/test/`、后端测试及兼容夹具属于公开源码。生成的 EXE、内置 Node、依赖和 ZIP 不提交，用户预览包作为 GitHub Releases 附件发布。Windows 托盘及预览包构建见 [桌面启动器](core/desktop/README.md)。

本地构建 Windows 安装包可双击根目录 `Build-QuizForge-Installer.cmd`：准备 Node.js 24、Inno Setup 7.1 和系统 .NET Framework 4.8 后，入口会检查依赖、编译隔离启动器并生成安装包；不会自动发布。`Build-QuizForge-Installer.cmd -CheckOnly` 只检查环境。首次工具下载、版本输入、自定义路径和离线许可证见上述构建文档。

## 报告问题

Issue 请提供复现步骤、预期与实际结果、应用版本或提交、系统及浏览器信息。截图和日志先移除个人内容、密钥和密码；使用最小脱敏样例帮助复现。
