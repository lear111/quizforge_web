# V2 接口与状态速查

本文只记录前端与后端之间的接口及作答存储（内部速查），不代表所有接口已实现。题型与宿主页面之间的接口以 [题型拓展开发说明](../reference/V2_EXTENSIONS.md) 为准，不在本文重复维护。开发顺序与决定权以 [工作流程](V2_WORKFLOW.md) 为准；当前能力见 [进度](V2_PROGRESS.md)。原论证与待定提案保留在 [归档](archive/reviews/V2-P1.md)。

## 接口设计规则

负责人确认的六条规则。新增或修改接口时照此执行。

1. **地址表示"哪个东西"，一层套一层**：`/api/v2/banks/{题库}` → `…/questions/{题}` → `…/answer`。
2. **方法表示"做什么"**：GET 读取，不改变任何东西；PUT 把某一项替换成新内容；POST 执行动作（提交、重做、刷新）；DELETE 删除。
3. **一个接口只做一件事**：规则不同的事不合并到一个接口里。保存答案、保存笔迹、上报评分各一个接口。
4. **每个写请求固定带三样**：请求编号（幂等，重发不会执行两遍）、题库版本 `snapshotId`（确认前端的题库是最新的）、版本号（乐观锁，发现多标签冲突；笔迹用它自己的版本号）。
5. **答复格式统一**：成功时返回该对象的最新状态，前端不用再问一次；失败时返回错误代码和一句说明，前端按代码分两类处理——能重试的保留输入，不能重试的重新载入。
6. **两条边界**：后端不解析 `question`、`solution`、`answer` 的内容，原样转发；`solution` 只在提交锁定后返回。

磁盘上的数据结构见 [数据结构说明书](V2_DATA_STRUCTURES.md)；拓展与宿主之间的接口见 [题型拓展开发说明](../reference/V2_EXTENSIONS.md)，不在本文范围。

## 接口列表

`B = /api/v2/banks/{bankId}`，`Q = B/questions/{questionId}`；`E = /api/v2/exams/{examId}`。

| 方法与路径 | 用途 |
|---|---|
| GET `/api/v2/health`、`/api/v2/catalog` | 健康状态；物理分组与题库列表 |
| GET `B/overview`、`Q` | 检查并打开题库，附大纲、状态和一道起始题；读取单题 |
| PUT `Q/answer`、`Q/ink` | 原样保存答案；独立文件、独立版本保存白板笔迹（D36） |
| POST `Q/submit`；PUT `Q/result` | 原子保存并锁定最终答案，成功后返回 solution；接收前端评分 |
| POST `Q/retry` | 清空本题活跃答案、笔迹、锁、结果和相关回执，历史不变 |
| POST `B/refresh` | 显式重新检查；整体内容变化时清空本轮作答与区外笔迹，返回 activeCleared/notice |
| POST `B/finish`、`B/restart`；GET `B/summary`、`B/pending-grading`；PUT `B/results` | 完成/新一轮、汇总、恢复待评分、批量评分上报（第 3 段） |
| GET `B/history`、`B/history/{roundId}`；DELETE 同详情路径；POST 同路径 `/continue` | 历史列表、详情、删除、继续（第 3 段细化） |
| POST/GET `/api/v2/exams`；GET/DELETE `E`；GET `E/questions/{questionId}` | 创建、列出、读取、删除考试与读取考试题（第 4 段） |
| PUT `E/questions/{questionId}/answer`、`/ink`、`E/position`；POST `E/hand-in`；GET `E/pending-grading`、`E/summary`；PUT `E/results` | 考试保存、位置、交卷、待评分与结果（第 4 段） |
| POST `/api/v2/practice-sessions`；DELETE `/api/v2/practice-sessions/{sessionId}` | 临时练习的独立内存作用域，后续实现 |
| POST `Q/ai-tasks`；GET `/api/v2/ai-tasks/{taskId}`；POST 同路径 `/cancel`、`/retry`；POST `/api/v2/ai/chat` | 锁定答案的 AI 任务；辅导对话（第 5 段） |
| GET/PUT `/api/v2/settings/{ai,network,development}`；POST `/api/v2/settings/ai/test`；GET `/api/v2/settings/ai/hub`；POST 同路径 `/login`、`/logout`、`/redeem` | 设置、连接测试及 Hub 账号（第 5、6 段核对字段） |
| POST `/api/v2/auth/login`、`/api/v2/settings/network/https/regenerate`；GET `/api/v2/admin-contact` | LAN 登录、证书与固定联系方式查询（后续保留边界） |
| POST `/api/v2/imports`、`/api/v2/exports`、`/api/v2/library/manage`；GET/PUT `Q/editor`；POST `Q/editor/assets` | 导入导出与本机编辑；包格式和转换在第 6 段确认 |
| GET `/api/v2/extensions/{artifactId}/manifest`、同路径 `/files/{entryId}`；GET `/api/v2/sdk/{component}/{version}/{entryId}` | 受限静态题型与 SDK 文件，不在后端执行 |
| GET `Q/assets/{assetId}`、`B/listening/{materialId}`；考试/历史对应作用域资源路径 | 按题目可见性取素材、本地听力或 http(s) 地址；历史资源方案第 3 段确认 |

## 状态、锁定与分数

- 主状态为 `.qf-v2/state.json`：`formatVersion:2`、`questions`、`contentFingerprint`、`lastQuestionId`。每题只保存 `status`、`answer`、`result`、`submissionId`、`revision`、`receipts`。不保存单独的 `answered`、历史索引或笔迹；从未作答的题使用默认值，浏览不创建作答文件。磁盘结构见[数据结构说明书](V2_DATA_STRUCTURES.md)。
- D37/D38：`status` 是大纲显示状态；无小题时为值，有小题时为小题 id 到值的映射，未出现的小题为 `unanswered`。五个值为 `unanswered`、`answered`、`correct`、`wrong`、`ungradable`。拓展通过 `changed` 传布尔值或最多 1000 键的布尔映射 `answered`；宿主立即更新大纲，`Q/answer` 随答案转为 `status` 保存，忽略未知小题。提交锁定不变色；后端按得分等于满分判对，否则判错（含部分得分）；待人工或 AI 保持现状，无法评分显示警示色；重做恢复默认。
- 保存与锁定：`Q/answer` 带 requestId、snapshotId、expectedRevision、answer，可带 answered；`Q/submit` 同样携带最终 answer，提交成功后返回 solution、submissionId，之后不可改答案。锁定由 submissionId 判断，已锁定且 result 为 null 才自动补评。作答、提交、结果、重做每次成功写入递增同一个 revision。
- 评分上报：`Q/result` 带 requestId、snapshotId、submissionId、expectedRevision、source:"grader"、result。凭证必须仍属当前锁且版本一致，旧锁返回 SUBMISSION_STALE、旧版本返回 RESULT_CONFLICT。结果为 `{ score, parts, message }`：无小题或无分数时 parts 为 null；有小题的数值评分以小题 ID 为键，全部且仅包含对应小题，分值有限、非负、未越界，精确十进制合计等于总分。无分数时 message 为 null 表示待人工或 AI，非空说明表示无法评分。有分数时 message 为 null。
- 每题 answer/submit/result/retry 共用最多 4 条 FIFO 回执 `[{requestId,signature}]`；笔迹另存 4 条。相同 ID 和内容重放不再写盘；不同内容返回 REQUEST_CONFLICT；已淘汰请求仍须通过版本和锁检查。重做清旧回执，保留本次重做回执供重放。读写沿用冻结、写时复制和原子替换。
- 白板用 `Q/ink`，带 requestId、snapshotId、expectedInkRevision、ink，返回 `{ inkRevision, state }`。单题 GET 附笔迹；除重做外，答案/提交/评分确认省略笔迹，前端保留已知值。白板可在锁后写，不参与评分、不改变题目 revision、提交凭证或结果。主状态和单题笔迹各限 32 MiB。
- D36/D39：旧 `Q/draft` 不再使用，`draft`、`hasDraft` 和 `getDraft()` 不对外提供。新结构中残留的开发版 draft 字段仅忽略，读取不改写；可识别的旧结构在打开时按内容变化清空本轮，只有旧笔迹时在读取该题时清空。损坏或无法识别的记录报错并保留；不迁移旧开发数据或 V1 数据。

## 审查决定与后续边界

- D14：全新设置与默认值，不读取 v1 密钥或密码。D18：type 的 @ 后是拓展主版本，零匹配 EXTENSION_NOT_FOUND，多匹配 EXTENSION_AMBIGUOUS，不自动选取。
- D19：作答及历史位于题库内部 `.qf-v2/`，随文件夹移动/改名/复制，副本各自保存；不按路径或 id 匹配记录。该目录不属于题库内容，资源接口不可见，后续导出必须排除。D20：历史保存当时题目、解析、作答与结果；素材仅存引用，失效时按条降级（第 3 段实现）。
- D16：完成/交卷时从未保存答案的题直接记 0 分；批量结果后立即汇总，待评/无法评分单列，后续更新。D17 / D39：历史轮次单独保存，摘要来源与最终化规则留第 3 段设计，主状态不预留 historyIndex。
- D27：根 contentFingerprint 由 bank.json 原始字节和全部已使用题型拓展的文件内容确定，不含物理目录名、题库素材、SDK 或无关文件。打开/刷新/重新加载不一致时清空全部 questions 与 ink 目录；无 state 文件不创建。返回 activeCleared 和“题库或题型已变化，本轮作答已清空”。不保存逐题 fingerprint，锁凭证为 submissionId。开发模式的进一步交互留第 6 段。
- D32：state.json 根 lastQuestionId 只随 answer/submit/retry 更新，result/ink/浏览不更新；删除 position 接口与文件。窗口内切库仍用内存记浏览位置，浏览器只用 V2 localStorage 记题库。
- 当前练习没有 GET/POST `B/position`，也没有 `.qf-v2/position.json`；不要再调用或创建。表中 `E/position` 仅为尚未实现的考试提案，第 4 段另定。
- D33：区外笔迹位于 .qf-v2/ink/<contentFingerprint>/<SHA256(questionId)>.json。按题原子替换且独立 inkRevision/回执；ink 不改 state.json；选择题保存不读写任何 ink；hasInk 只由目录文件名索引给出，代表存在保存记录（包括空白板）。retry 先删本题笔迹后写 state，后一写失败时答案保留、笔迹已删，原请求可重试。D27 先删全 ink 再清主状态，失败恢复同理。
- D29：后端最近 8 个题库 LRU，逐出时释放 state/身份/笔迹索引；带 snapshotId 访问被逐出题库时重开，比对一致则透明继续，否则返回过期并按 D27 清理。
- 打开/刷新也检查作答文件的 dev/ino/size/mtimeNs/ctimeNs/birthtimeNs，变化重读，消失回初始态，坏文件报错保留并失效缓存；普通单题读写不扫描题库。写入后下次打开核对身份及字节，避免把外部替换文件身份误配给缓存。POST refresh 接受 questionId/expectedSnapshotId，返回 overview 加 changes（activeCleared 布尔及新增/删除题号、activeRoundInterrupted:false），题目删除才回退；CAS 或清理写入失败不发布新快照，历史阶段尚未实现。
- 打开仅检查 JSON 与大纲，坏题延迟到单题报错；overview 附一道起始题。遍历上限 1000 项，超限返回 lowerBound:1001、limit:1000 与中文原因，不为精确总数继续遍历。
- 锁前不发 solution 适用于作答/评分；本机管理权限的编辑器和导出是例外。后端不执行作者代码；评分沙箱先做真实浏览器验证。
- 读取常量沿用已合并实现；负责人本次确认作答文件上限沿用 32 MiB，其他写入字段上限、包格式、历史资源和账号细节尚未定案，不从旧长文档的提案自动变成新要求。涉及保存、锁定、评分、沙箱的 PR 等审查；第 1 段不提前实现其他段。
