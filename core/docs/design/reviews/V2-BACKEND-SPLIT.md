# 任务 C · 后端拆分与精简

**范围。** #127 已审查合并，本 PR 目标 `v2`。打开题库拆成定位、读快照、解析题型/SDK、两种指纹、核对作答、组装概览；`bank.service.js` 保留流程与 LRU，`bank-open.service.js` / `question.service.js` 分别组织概览与单题。磁盘目录清点归 `catalog.repository.js`。作答规则留在 `practice.service.js` 及 actions / completion / result 三个 service；文件校验、身份复核、缓存和原子写入归 `state.repository.js` / `state-shape.repository.js`。保留原写入注入点、冻结与失败回退次序，补充锁定、原型题号、写成功后发布缓存的原因注释。拓展 `resolve` 也拆成选择、声明/入口检查、SDK 检查与工件组装，不删检查。

**D46（本次唯一有意的行为变化）。** `readBank` 只解析并建立大纲题号/满分索引，保留大题全库、小题所在大题内不重复、正有限满分及总和不溢出。取消格式版本、作者 ID、标题/简介、features、分组标题、label、题号形式、有小题时禁止大题 label/maxScore、听力声明的打开时检查；缺失显示信息用空值/既有缺省值。目录列表也不再以格式版本挡住入口。读单题仍检查 question/solution 对象；资源路径、链接、私有目录、1000 项上限等安全检查均未删，听力本地路径仍在取文件时检查；完整听力声明检查随第 6 段落实。不新增缓存、TTL 或保护机制，未顺手删除其他检查。

**断言变更/新增。** `readonly.test.mjs` 原拒绝用例中七种已取消的检查移到“应能打开并读题”的严格断言，保留 outline/重复题号/非正或非数字分数/总和溢出的拒绝断言；另测缺失显示信息的缺省值与缺少 questions 的单题错误。`submit.test.mjs` 的私有听力路径由“打开即拒绝”改为“打开成功、实际取文件拒绝”，不放宽私有文件保护。`code-quality.test.mjs` 新增两项 D48 分层检查用例，覆盖正向、反向、controller 越层、直接磁盘访问、导出、动态字面量导入和 require。规则进入 `lint`；app 只负责组装，同层与通用工具可复用。

**#127 前两项。** 九个探针的导入置于头部说明之后；practice 只保留外层失败截图。未改断言或超时，不加重试/固定等待；不加 Chromium 缓存。白板 pointerdown 根因仍未完全排除，今后 CI 再偶发失败按产品问题调查提交评分后首笔是否丢失，不再只调整探针。

**兼容性。** 除 D46 外，无行为变化；不改前端、沙箱、接口、锁定/评分/回执和持久化格式，不改依赖或标准答案。以 #127 合并提交 `fdb888c` 为基线，测试专用加载钩子与相同确定性合成流程对比 22 个检查点（含保存、重放、冲突、笔迹、锁定、评分、重做、完成、批量评分、刷新及最终文件）：返回内容与磁盘/缓存 JSON 字节全部一致，摘要 `eed6ed403546dc266c5f189c3b2fecc532abe2be8b78c552697518adff91da2f`。现有确定性持久化字节断言继续通过。

**格式化后行数（含空行）。** bank service / open / question：204 / 167 / 151；practice service / actions / completion / result：118 / 115 / 146 / 50；state repository / shape：117 / 114；bank repository / outline / catalog / extension：82 / 58 / 73 / 238；state utils：11。原 bank / practice 分别 518 / 586 行；拆分后的后端文件与函数没有大小警告。

**验证。** [PR #129](https://github.com/lear111/quizforge_web/pull/129)，目标 `v2`，不自行合并；任务 D 未开始。Windows、Node 24.13.0；只用合成数据与临时回环端口，不触碰日常服务或真实题库。针对性 69 项通过，最终只读与规范用例 20 项通过（有重叠，不相加）；类型、构建一致性通过，lint 0 错误、37 条其他既有警告；性能测试 2 项通过，未做性能收益归因。九项配套 Chromium 158 探针通过（桌面/手机视口，不是真机）。

**CI。** 实现提交 `9301c5c` 的[首次运行 43575001676](https://github.com/lear111/quizforge_web/actions/runs/43575001676) 全绿，无重跑、重试、放宽断言或超时。下表为各 job 的起止时间差；Ubuntu 的 34 项跳过是原有 Windows 专项，不是本次新增跳过。

| Job | 通过 / 失败 / 跳过 | 耗时 |
|---|---|---|
| Checks · Ubuntu | 1345 / 0 / 34；类型与构建通过 | 116 s |
| Checks · Windows | 1379 / 0 / 0；类型与构建通过 | 239 s |
| Performance · Ubuntu | 2 / 0 / 0 | 16 s |
| V2 code quality · Ubuntu | 格式通过；0 错误、37 既有警告 | 20 s |
| V2 browser checks · Ubuntu | 九项全部通过 | 142 s |

**本机完整测试的限制。** `npm --prefix core test` 退出 1，1363 通过 / 16 失败 / 0 跳过，1024.15 s；V2 用例均通过。失败均在未改动的 V1 路径：`hub-connection` 6 项、`settings-provider` 2 项与 `http/server` 登录 1 项报 AI 设置访问保护失败（`AI_SETTINGS_SAVE_FAILED` / 503）；`rule-engine` 1 项前后台完成顺序断言失败；`library-export-images`、`library-package`、`library` 各 1 项目录 rename 报 `EPERM`；`windows-tray` 3 项目录 rename 或服务启动报 `EPERM`。这是本机一次完整运行的实测结果，未对这 16 项另做未改动基线复现，不把它们统称为已证明的既有失败，也不以 CI 通过掩盖本机失败；两系统 CI 相应用例全部通过。原始日志与合成生成物留在 git 忽略的 `.temp/`，不提交用户数据。
