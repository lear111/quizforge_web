# G：构建成品、进度索引与测试整理

**状态：实现完成，待审查；不自行合并，不开始 H。** 基线 `v2` / `8401d63`，分支 `chore/v2-test-docs-cleanup`。依据 G 的三项范围及 `V2_WORKFLOW.md` 第 2/8/9 节；没有新增产品功能或变更 D 编号决定。

**构建与运行。** 仅取消 Git 追踪 `core/web/ui/quizforge-ui.js`、`quizforge-web-local.css`，加入精确忽略项；用 `git rm --cached` 保留本机文件，未删除运行资源。V1 和 V2 都使用此 bundle，HTTP 路径不变；`THIRD_PARTY_NOTICES.txt` 继续跟踪且内容不变，版本化 SDK/手写资源保留。新增 `scripts/build/ensure-ui.mjs`：成品缺失、全部前端源码/配置/构建脚本/package/lock/npm 安装时间比成品新时构建，否则不加载 Vite。三个 V2 CMD、V1 PowerShell（含复用现有服务）、npm start/test/test:host 接入；编译失败不继续启动。直接 node 运行后端、单文件测试或探针须先 build，文档已说明。现有 Windows 暂存流程本来先 build 再复制，无需改动。CI 仍先 build、再 `--check` 比较本机成品与当前源码，新增核对“JS/CSS 未追踪、已生成、许可仍追踪”。没有让运行时使用 Git 中的成品。

**文档。** `V2_PROGRESS.md` 从 203 行变为 42 行，仅“功能总表 + 任务表”（状态、PR、独立记录）；复用现有记录，不重复创建已完成任务。原文/测试结论/决定完整保留在 `archive/V2_PROGRESS_BEFORE_G.md`，调整移动后的相对链接及两个历史锚点。新增 H/J/K/L 与第 5/6/7 段的短记录仅迁入既有排期，并明确“尚未开工”，没有新设计或批准。I② 保持“代码已合并，待负责人试用”；F①–F⑧ 已完成，未添加额外 F 子任务。README、贡献指南和启动说明同步构建前置条件，不改总体设计、工作流程与接口文档。

**拆分与等价证据。** 新测试全部仍为发现器可找到的 `core/test/v2/*.test.mjs`；共享夹具在被排除发现的 `test/fixtures/`，不注册测试。原测试名称、断言、数据、超时/重试/跳过选项保留。TypeScript AST 对比基线与本次 **57 个 test 注册表达式（含参数循环，执行 58 个顶层用例）完全相同**，摘要 `da4e858ec8f67d19f484335ed3af3ce48d8e2ac3943f803833e8980f55593b6e`；练习探针 **21 个断言 AST** 多重集相同，摘要 `c373b7efdc2978381c8fc11c8160761f522178605dde8c1422706c695de466c9`。AST 比较保留表达式/字面量，忽略排版与尾逗号；四个共享夹具的 17 个原函数/变量声明 AST 也逐项相同。移动过程中发现参数循环在夹具重复注册导致多 2 项，已移回 guard 文件，最终不重复也不遗漏。

| 原文件 / 行数 | 按功能拆分后（行数） | 原用例数 → 新用例数 |
|---|---|---|
| drafts.test / 678 | 原答案/笔迹 186；receipts 144；compatibility 108；recovery 164；refresh 62；共享 setup 39 | 16 → 16 |
| readonly.test / 606 | 原只读总流程 152；structure 192；snapshots 116；security 85；entry 35；共享运行夹具 50 | 13 → 13 |
| frontend-router.test / 499 | 原路由展示 126；guards 183；共享路由夹具 229 | 16 → 16（含循环两种情况） |
| grading.test / 466 | 原排队/期限/生命周期 193；messages 85；results 144；共享评分夹具 63 | 13 → 13 |
| probe-v2-practice / 445 | 原入口 87；network 113；flow 160；recovery 103；原执行顺序、数据根、上下文生命周期、报告字段与 CLI 不变 | 桌面/手机、网络隔离、补评分与坏起始题场景保留 |

其余超过 300 行的 V2 测试已清点：save-policy 383、submit 382、page 365、completion-edge 327、storage 319，仍围绕各自单一服务/状态链，本次不再为了行数拆开。没有修改 ESLint 长度级别；探针从顶层顺序场景提取函数后新增一条长度警告（共 20），H 再决定，不隐瞒、不放宽规则。

**验证（Windows 11、Node 24.13.0，仅合成数据和隔离回环）。**

| 检查 | 实际结果 |
|---|---|
| 拆分前完整 V2 | 224 通过 / 0 失败 / 0 跳过；62.08s |
| 整理后完整 V2 | 239 / 0 / 0；82.17s；原 224 不变，另加构建前置 15 项（5 个主用例 + 10 个子用例） |
| 新增构建回归 | 15 / 0 / 0：暖态不编译、缺失 3 种成品、7 种源码/依赖变化、失败传播、启动/测试入口顺序 |
| 前后端类型 / 构建 / --check | 通过；构建输出与源码、许可一致 |
| lint / 格式 / Git 检查 | 0 错误、20 警告；227 文件无格式差异；JS/CSS 本机仍存在且忽略，许可仍跟踪；117 个文档相对链接无失效 |
| 性能组 | 2 / 0 / 0；并行运行值不作性能比较 |
| 十项浏览器 | 原十入口全部通过，练习探针的 CLI/报告/网络正反对照入口保留 |
| 本机完整默认回归 | 1500 项：1490 通过 / 10 失败 / 0 跳过；789.98s，退出 1；失败清单见下 |
| CI 五项 | 实施提交 `626eba8` 全绿，失败名单为空；见下表 |


本机完整回归的 10 项均在未改动的旧路径：`server/host/ai/hub-connection.test.mjs` 的 68/88/96/114/133/160 行、`ai/settings-provider.test.mjs` 的 32/54 行为 `AI_SETTINGS_SAVE_FAILED`（无法完成设置文件访问保护），`http/server.test.mjs:290` 为由此得到 503 而非 200，共 9 项；与此前记录的本机环境现象一致，本次未做干净基线复跑，不宣称重新证明了基线。另 `extensions/rule-engine.test.mjs:99` 的 “foreground requests skip queued background batches and get a reserved worker” 在完整运行中实际先完成 background-1，断言只应完成 foreground，属于时间/负载相关现象，原因未进一步审计；无改动单独运行该文件一次为 8/0/0，8.65s，保留初次失败事实。没有改旧代码、超时、重试或期望值来掩盖失败。


**CI 证据。** [PR #172](https://github.com/lear111/quizforge_web/pull/172) 实施提交 `626eba8` 的[运行 43738767221](https://github.com/lear111/quizforge_web/actions/runs/43738767221) 五项全绿。Windows/Ubuntu 均从未携带 UI 成品的检出构建并通过新增追踪检查；所有 CI 失败用例名单为空。Ubuntu 34 项跳过仍是原有 Windows 专项，没有新增跳过。PR 正文与本文同步，此后仅补文档，并核对最终提交的五项 CI。

| CI job | 通过 / 失败 / 跳过及结果 | Job 总耗时 |
|---|---|---|
| Checks · Windows | 1500 / 0 / 0，类型、构建、--check、未追踪检查均通过 | 237s |
| Checks · Ubuntu | 1466 / 0 / 34，同上 | 121s |
| V2 code quality · Ubuntu | 227 文件格式无差异，218 文件 lint 0 错误/20 警告 | 22s |
| V2 browser checks · Ubuntu | 原十项入口全部通过 | 219s |
| Performance · Ubuntu | 2 / 0 / 0 | 20s |

**未改与风险。** 后端业务、API/数据契约、保存/评分/锁定/白板/路由、题型与示例、HTTP 运行路径均无差异。没有升级依赖、修改发现器或产品校验，不读真实题库/设置，不停日常服务，不生成安装包。源码启动首次需安装开发依赖并构建；源码 EXE 与直接 node 入口仍按说明预先 build，安装包由现有暂存流程带成品。基于 mtime 的启动检查按本任务要求判断过期；精确字节校验仍由构建后 `--check` 完成。真实设备、安装器发布不属于本次验收。
