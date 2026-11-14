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

## 已接通的练习接口

`B = /api/v2/banks/{bankId}`，`Q = B/questions/{questionId}`。

| 方法与路径 | 读取内容 |
|---|---|
| GET `/api/v2/health`、`/api/v2/catalog` | 健康状态；物理分组与题库列表 |
| GET `B/overview` | 题库信息、大纲、各题状态、上次作答位置、起始题和补评候选；可传 `?questionId=…` 指定起始题 |
| GET `Q` | 传 `?snapshotId=…`；读取单题（含独立笔迹及其版本） |
| GET `/api/v2/extensions/{artifactId}/manifest`、`/api/v2/extensions/{artifactId}/files/{entryId}` | 静态题型清单与受限入口，后端不执行 |
| GET `/api/v2/sdk/{component}/{version}/{entryId}` | 已声明的 SDK 文件；宿主用 `?snapshotId=…` 绑定浏览器缓存 |
| GET `Q/assets/{assetId}`、`B/listening/{materialId}` | 带 `?snapshotId=…`；按题目可见性取素材、本地听力或 http(s) 地址。听力播放界面尚未接入 |

### 已接通的写接口

请求体为 JSON；每行列出全部业务请求字段，`?` 表示可省略。成功均返回 HTTP 200。表中「单题」与 GET `Q` 共用字段：`bankId`、`snapshotId`、`questionId`、`type`、`extension`、`item`、`question`、`solution`、`answer`、`submissionId`、`result`、`resources`，以及 `state{questionId, status, revision, hasSavedAnswer, locked, score, maxScore, hasInk}`；`solution` 仅锁定时有内容，未锁定时为 `null`。除重做外，这些写入返回的单题省略 `ink` 和 `inkRevision`，前端保留当前笔迹及其版本。

| 方法与路径 | JSON 请求字段 | 成功返回 | 此接口的主要失败 |
|---|---|---|---|
| PUT `Q/answer` | `requestId`、`snapshotId`、`expectedRevision`、`answer`、`answered?` | 单题，含已保存的答案和最新题目版本；不修改笔迹 | 400 `INVALID_REQUEST`（缺答案、作答状态非法）；409 `REVISION_CONFLICT` / `ANSWER_LOCKED` |
| PUT `Q/ink` | `requestId`、`snapshotId`、`expectedInkRevision`、`ink` | `{inkRevision, state}`，前端保留刚保存的笔迹；不改题目版本、锁或结果 | 400 `INVALID_REQUEST`（缺笔迹）；409 `REVISION_CONFLICT`（笔迹版本冲突） |
| POST `Q/submit` | `requestId`、`snapshotId`、`expectedRevision`、`answer` | 单题，带已锁定的答案、`submissionId`、`solution` 和最新题目版本；保持大纲状态 | 400 `INVALID_REQUEST`（缺答案）；409 `REVISION_CONFLICT` / `ANSWER_LOCKED` |
| PUT `Q/result` | `requestId`、`snapshotId`、`expectedRevision`、`submissionId`、`source: "grader"`、`result` | 单题，含最新分数、大纲状态和题目版本 | 409 `SUBMISSION_STALE`（锁不匹配）/ `RESULT_CONFLICT`（版本冲突）；422 `INVALID_RESULT` |
| POST `Q/retry` | `requestId`、`snapshotId`、`expectedRevision` | 单题，答案、锁、评分及笔迹已清空，题目版本递增，笔迹版本回到 0；不返回解析内容 | 409 `REVISION_CONFLICT`；503 `STATE_WRITE_FAILED`（清除笔迹或写作答失败） |
| POST `B/refresh` | `questionId?`、`expectedSnapshotId?`（现有快照比对，见下） | 新概览（含 `snapshotId`、`activeCleared`、`notice`）；附 `changes{activeCleared, addedQuestionIds, removedQuestionIds, activeRoundInterrupted}`，本段 `activeRoundInterrupted` 固定为 false。保留仍存在的当前题 | 400 `INVALID_REQUEST`（无效题号）；409 `SNAPSHOT_STALE`（带旧预期快照）；题库读取或清理失败时返回相应错误，不发布候选快照 |

统一失败格式：`{"error":{"code":"…","message":"…"}}`，可能附题库、题号、字段或限额等定位信息。各接口还可能返回：400 `INVALID_REQUEST`（如非 JSON、重复键、缺少或无效的请求编号）；401 `AUTH_REQUIRED`；403 `HOST_REJECTED` / `ORIGIN_REJECTED`；404 `BANK_NOT_FOUND` / `QUESTION_NOT_FOUND` / `EXTENSION_NOT_FOUND`；409 `BANK_NOT_OPEN` / `SNAPSHOT_STALE`，同一请求编号换正文为 `REQUEST_CONFLICT`；413 `STATE_SIZE_LIMIT`；422 题库、题型或素材结构不合法（刷新超限为 `FILE_COUNT_LIMIT`）；503 `STATE_INVALID` / `STATE_WRITE_FAILED` / `STORAGE_UNAVAILABLE` 等。各操作只返回适用的错误。失败未确认时，保存答案/笔迹保留输入，重试同一个编号和正文；401 先处理认证。确定拒绝的写入（如版本冲突、快照过期、超限）不重发旧请求，作答界面重新读取已保存状态。无效评分单独降为「无法评分」再上报。

**当前两处既有例外，供审查：** `B/refresh` 是重新读取磁盘并发布快照的动作，现有前端只传当前题号；后端可选 `expectedSnapshotId`，没有请求回执或题目版本。`GET B/overview` 仍按 D27 在打开或重载时发现内容变化并清空过期作答；需重新打开已逐出的题库时也会执行同一检查；首次读取到可识别的旧开发笔迹也可清理该文件。两者沿用已审查行为，本段不改变清理时机、刷新请求或存储。

## 第 3 段接口：完成练习、归档、历史

完成与评分已实现待审查；归档与历史尚未实现。

`B = /api/v2/banks/{bankId}`，`R = B/rounds/{roundId}`。设计依据：D20、D22、D40、D42、D44，数据结构见 [说明书](V2_DATA_STRUCTURES.md) 第 2.1、4 节。

**完成练习**

| 接口 | 请求 | 成功返回 | 主要错误 |
|---|---|---|---|
| POST `B/finish` | `requestId`、`snapshotId` | `{completedAt, states, total, pendingGrading}`；待评分项为 `{question, error}`，成功的 question 含锁定答案、完整题目及 `solution`（省略笔迹） | 快照过期；写入失败不返回解析。已完成则不重复锁定，返回最新汇总 |
| PUT `B/results` | `requestId`、`snapshotId`、`results: [{ questionId, submissionId, expectedRevision, result }]` | `{completedAt, states, total}`；总分 `{ score, maxScore }` | 快照过期；重复题号、任一条提交编号或版本不符则整批拒绝并指出是哪一题；分数不合格 |

`finish` 的效果：所有尚无提交编号的题填上编号；未作答的题（包括保存过但已清空、所有大纲状态均为 `unanswered`）直接写入 0 分的结果并把各小题状态记为 `wrong`；顶层写 `completedAt`。全部在一次原子写入里完成。`completedAt` 有值后，`PUT Q/answer`、`POST Q/submit`、`POST Q/retry` 一律拒绝，`PUT Q/result` 与 `PUT Q/ink` 照常。拒绝答案/提交/重做时返回 409 `ROUND_COMPLETED`，包括这些请求的旧回执重放。已锁定的题及已有结果不变。

**负责人确认的整库例外**：`finish` 不带整库版本号，锁定服务器最新保存的答案；不存题库级回执，重复请求只保证不重复锁定并返回最新汇总。`results` 逐题检查版本与锁，全部通过才写一次；每题记录同一个批次请求的完整签名，仍各保留 4 条。全部命中回执返回最新汇总，部分命中而其他已淘汰时整批拒绝；空批次只读汇总、不写盘。

概览 `GET B/overview` 增加 `completedAt` 和 `total: { score, maxScore }`。总分由后端把各题得分相加（没有分数的按 0），不落盘。

`finish` 之后、`results` 之前如果页面关闭，再次打开时概览的待补评列表里会有这些题，按现有的自动补评处理。

**归档**

| 接口 | 请求 | 成功返回 | 主要错误 |
|---|---|---|---|
| POST `B/restart` | `requestId`、`snapshotId` | 新一轮的概览 | 快照过期；尚未完成（`completedAt` 为空） |

效果按顺序：仍无分数的题记 0 分（D23）；新建 `rounds/<轮次>/`，复制 `bank.json`、`state.json`、所用拓展文件夹，移入笔迹；全部成功后清空当前 `state.json`。中途失败则删除未完成的目录并返回可重试的错误，当前作答保持已完成状态。

**历史**

| 接口 | 作用 |
|---|---|
| GET `B/rounds` | 历史列表：`[{ roundId, completedAt, score, maxScore }]`，按完成时间倒序。得分由该轮 `state.json` 相加得出，不另存索引 |
| DELETE `R` | 删除一轮（整个目录） |
| GET `R/overview` | 打开一轮。返回内容与 `B/overview` 同形，另带 `readOnly: true` |
| GET `R/questions/{questionId}` | 读一道题，与 `Q` 同形。`solution` 总是返回（全部已锁定） |
| PUT `R/questions/{questionId}/ink` | 保存笔记，与 `Q/ink` 相同 |
| GET `R/questions/{questionId}/assets/{assetId}` | 素材。引用来自该轮的 `bank.json`，文件仍在题库文件夹里找；不存在时返回 404，前端显示"素材已不存在" |

拓展文件沿用 `/api/v2/extensions/{artifactId}/…`，该轮概览给出的 `artifactId` 指向轮次目录里的拓展副本。

`R` 下不提供 `answer`、`submit`、`retry`、`result`，请求这些路径返回 404。宿主给拓展的事实固定为 `locked: true`、`can.submit: false`、`can.retry: false`。

拓展副本无法解析或载入时，该题按"题型不可用"处理，概览中的状态和分数照常返回。

## 后续接口（未实现，字段随各段审查）

`E = /api/v2/exams/{examId}`。

| 方法与路径 | 用途 |
|---|---|
| POST/GET `/api/v2/exams`；GET/DELETE `E`；GET `E/questions/{questionId}` | 创建、列出、读取、删除考试与读取考试题（第 4 段） |
| PUT `E/questions/{questionId}/answer`、`/ink`；POST `E/hand-in`；GET `E/pending-grading`、`E/summary`；PUT `E/results` | 考试保存、交卷、待评分与结果（第 4 段） |
| POST `/api/v2/practice-sessions`；DELETE `/api/v2/practice-sessions/{sessionId}` | 临时练习的独立内存作用域，后续实现 |
| POST `Q/ai-tasks`；GET `/api/v2/ai-tasks/{taskId}`；POST 同路径 `/cancel`、`/retry`；POST `/api/v2/ai/chat` | 锁定答案的 AI 任务；辅导对话（第 5 段） |
| GET/PUT `/api/v2/settings/{ai,network,development}`；POST `/api/v2/settings/ai/test`；GET `/api/v2/settings/ai/hub`；POST 同路径 `/login`、`/logout`、`/redeem` | 设置、连接测试及 Hub 账号（第 5、6 段核对字段） |
| POST `/api/v2/auth/login`、`/api/v2/settings/network/https/regenerate`；GET `/api/v2/admin-contact` | LAN 登录、证书与固定联系方式查询（后续保留边界） |
| POST `/api/v2/imports`、`/api/v2/exports`、`/api/v2/library/manage`；GET/PUT `Q/editor`；POST `Q/editor/assets` | 导入导出与本机编辑；包格式和转换在第 6 段确认 |
| 考试、历史作用域的资源路径 | 随对应功能确定，历史资源方案第 3 段确认 |

## 状态、锁定与分数

- 主状态为 `.qf-v2/state.json`：`formatVersion:2`、`questions`、`contentFingerprint`、`lastQuestionId`，完成时增加 `completedAt`（缺省按未完成）。每题只保存 `status`、`answer`、`result`、`submissionId`、`revision`、`receipts`。不保存单独的 `answered`、历史索引或笔迹；从未作答的题使用默认值，浏览不创建作答文件。磁盘结构见[数据结构说明书](V2_DATA_STRUCTURES.md)。
- D37/D38：`status` 是大纲显示状态；无小题时为值，有小题时为小题 id 到值的映射，未出现的小题为 `unanswered`。五个值为 `unanswered`、`answered`、`correct`、`wrong`、`ungradable`。拓展通过 `changed` 传布尔值或最多 1000 键的布尔映射 `answered`；宿主立即更新大纲，`Q/answer` 随答案转为 `status` 保存，忽略未知小题。提交锁定不变色；后端按得分等于满分判对，否则判错（含部分得分）；待人工或 AI 保持现状，无法评分显示警示色；重做恢复默认。
- 保存与锁定：`Q/answer` 带 requestId、snapshotId、expectedRevision、answer，可带 answered；`Q/submit` 同样携带最终 answer，提交成功后返回 solution、submissionId，之后不可改答案。锁定由 submissionId 判断，已锁定且 result 为 null 才自动补评。作答、提交、结果、重做每次成功写入递增同一个 revision。
- 评分上报：`Q/result` 带 requestId、snapshotId、submissionId、expectedRevision、source:"grader"、result。凭证必须仍属当前锁且版本一致，旧锁返回 SUBMISSION_STALE、旧版本返回 RESULT_CONFLICT。结果为 `{ score, parts, message }`：无小题或无分数时 parts 为 null；有小题的数值评分以小题 ID 为键，全部且仅包含对应小题，分值有限、非负、未越界，精确十进制合计等于总分。无分数时 message 为 null 表示待人工或 AI，非空说明表示无法评分。有分数时 message 为 null。
- 每题 answer/submit/result/retry 共用最多 4 条 FIFO 回执 `[{requestId,signature}]`；笔迹另存 4 条。相同 ID 和内容重放不再写盘；不同内容返回 REQUEST_CONFLICT；已淘汰请求仍须通过版本和锁检查。重做清旧回执，保留本次重做回执供重放。读写沿用冻结、写时复制和原子替换。
- 白板用 `Q/ink`，带 requestId、snapshotId、expectedInkRevision、ink，返回 `{ inkRevision, state }`。单题 GET 附笔迹；除重做外，答案/提交/评分确认省略笔迹，前端保留已知值。白板可在锁后写，不参与评分、不改变题目 revision、提交凭证或结果。主状态和单题笔迹各限 32 MiB。
- D36/D39：旧 `Q/draft` 不再使用，`draft`、`hasDraft` 和 `getDraft()` 不对外提供。新结构中残留的开发版 draft 字段仅忽略，读取不改写；可识别的旧结构在打开时按内容变化清空本轮，只有旧笔迹时在读取该题时清空。损坏或无法识别的记录报错并保留；不迁移旧开发数据或 V1 数据。

## 审查决定与后续边界

- D14：全新设置与默认值，不读取 v1 密钥或密码。D18：type 的 @ 后是拓展主版本，零匹配 EXTENSION_NOT_FOUND，多匹配 EXTENSION_AMBIGUOUS，不自动选取。
- D19：作答及历史位于题库内部 `.qf-v2/`，随文件夹移动/改名/复制，副本各自保存；不按路径或 id 匹配记录。该目录不属于题库内容，资源接口不可见，后续导出必须排除。D20：历史保存当时题目、解析、作答与结果；素材仅存引用，失效时按条降级（第 3 段实现）。
- D16：完成/交卷时未作答的题直接记 0 分（负责人补充：存过又清空也按未作答）；批量结果后立即汇总，待评/无法评分单列，后续更新。D17 / D39：历史轮次单独保存，摘要来源与最终化规则留第 3 段设计，主状态不预留 historyIndex。
- D27：根 contentFingerprint 由 bank.json 原始字节和全部已使用题型拓展的文件内容确定，不含物理目录名、题库素材、SDK 或无关文件。打开/刷新/重新加载不一致时清空全部 questions 与 ink 目录；无 state 文件不创建。返回 activeCleared 和“题库或题型已变化，本轮作答已清空”。不保存逐题 fingerprint，锁凭证为 submissionId。开发模式的进一步交互留第 6 段。
- D32：state.json 根 lastQuestionId 只随 answer/submit/retry 更新，result/ink/浏览不更新；删除 position 接口与文件。窗口内切库仍用内存记浏览位置，浏览器只用 V2 localStorage 记题库。
- D33：区外笔迹位于 .qf-v2/ink/<contentFingerprint>/<SHA256(questionId)>.json。按题原子替换且独立 inkRevision/回执；ink 不改 state.json；选择题保存不读写任何 ink；hasInk 只由目录文件名索引给出，代表存在保存记录（包括空白板）。retry 先删本题笔迹后写 state，后一写失败时答案保留、笔迹已删，原请求可重试。D27 先删全 ink 再清主状态，失败恢复同理。
- D29：后端最近 8 个题库 LRU，逐出时释放 state/身份/笔迹索引；带 snapshotId 访问被逐出题库时重开，比对一致则透明继续，否则返回过期并按 D27 清理。
- 打开/刷新也检查作答文件的 dev/ino/size/mtimeNs/ctimeNs/birthtimeNs，变化重读，消失回初始态，坏文件报错保留并失效缓存；普通单题读写不扫描题库。写入后下次打开核对身份及字节，避免把外部替换文件身份误配给缓存。刷新接口的请求和返回见上表。
- 打开仅检查 JSON 与大纲，坏题延迟到单题报错；overview 附一道起始题。遍历上限 1000 项，超限返回 lowerBound:1001、limit:1000 与中文原因，不为精确总数继续遍历。
- 锁前不发 solution 适用于作答/评分；本机管理权限的编辑器和导出是例外。后端不执行作者代码；评分沙箱先做真实浏览器验证。
- 读取常量沿用已合并实现；负责人本次确认作答文件上限沿用 32 MiB，其他写入字段上限、包格式、历史资源和账号细节尚未定案，不从旧长文档的提案自动变成新要求。涉及保存、锁定、评分、沙箱的 PR 等审查。
