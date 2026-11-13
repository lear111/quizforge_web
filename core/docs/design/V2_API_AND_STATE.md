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
| PUT `Q/draft`、`Q/ink` | 原样保存答案/非答案草稿；独立文件、独立版本保存区外笔迹（③b） |
| POST `Q/submit`；PUT `Q/result` | 原子保存并锁定最终答案，成功后返回 solution；接收前端评分 |
| POST `Q/retry` | 清空本题活跃答案、草稿、笔迹、锁、结果和相关回执，历史不变 |
| POST `B/refresh` | 显式重新检查；整体内容变化时清空本轮作答与区外笔迹，返回 activeCleared/notice |
| POST `B/finish`、`B/restart`；GET `B/summary`、`B/pending-grading`；PUT `B/results` | 完成/新一轮、汇总、恢复待评分、批量评分上报（第 3 段） |
| GET `B/history`、`B/history/{roundId}`；DELETE 同详情路径；POST 同路径 `/continue` | 历史列表、详情、删除、继续（第 3 段细化） |
| POST/GET `/api/v2/exams`；GET/DELETE `E`；GET `E/questions/{questionId}` | 创建、列出、读取、删除考试与读取考试题（第 4 段） |
| PUT `E/questions/{questionId}/draft`、`/ink`、`E/position`；POST `E/hand-in`；GET `E/pending-grading`、`E/summary`；PUT `E/results` | 考试保存、位置、交卷、待评分与结果（第 4 段） |
| POST `/api/v2/practice-sessions`；DELETE `/api/v2/practice-sessions/{sessionId}` | 临时练习的独立内存作用域，后续实现 |
| POST `Q/ai-tasks`；GET `/api/v2/ai-tasks/{taskId}`；POST 同路径 `/cancel`、`/retry`；POST `/api/v2/ai/chat` | 锁定答案的 AI 任务；辅导对话（第 5 段） |
| GET/PUT `/api/v2/settings/{ai,network,development}`；POST `/api/v2/settings/ai/test`；GET `/api/v2/settings/ai/hub`；POST 同路径 `/login`、`/logout`、`/redeem` | 设置、连接测试及 Hub 账号（第 5、6 段核对字段） |
| POST `/api/v2/auth/login`、`/api/v2/settings/network/https/regenerate`；GET `/api/v2/admin-contact` | LAN 登录、证书与固定联系方式查询（后续保留边界） |
| POST `/api/v2/imports`、`/api/v2/exports`、`/api/v2/library/manage`；GET/PUT `Q/editor`；POST `Q/editor/assets` | 导入导出与本机编辑；包格式和转换在第 6 段确认 |
| GET `/api/v2/extensions/{artifactId}/manifest`、同路径 `/files/{entryId}`；GET `/api/v2/sdk/{component}/{version}/{entryId}` | 受限静态题型与 SDK 文件，不在后端执行 |
| GET `Q/assets/{assetId}`、`B/listening/{materialId}`；考试/历史对应作用域资源路径 | 按题目可见性取素材、本地听力或 http(s) 地址；历史资源方案第 3 段确认 |

## 状态、锁定与分数

| 状态 | 锁定 | 允许转换 |
|---|---|---|
| unanswered 未作答 | 否 | 保存答案 → drafting；提交 → submitted-pending；仅保存笔记不变 |
| drafting 草稿 | 否 | 继续保存；清答案 → unanswered；提交 → submitted-pending |
| submitted-pending 已提交待评分 | 是 | graded、pending-review、ungradable |
| graded 已评分 | 是 | 合法结果更新；明确重新评分；练习重做 |
| pending-review 待人工或 AI 评分 | 是 | graded、ungradable、继续待评；练习重做 |
| ungradable 无法评分 | 是 | 明确重新评分；练习重做 |

- 主状态为 `.qf-v2/state.json`：根字段 formatVersion:2、questions、historyIndex、contentFingerprint、lastQuestionId；题状态含 status、revision、answerVersion、answer、draft、submission、resultRevision、result、receipts、receiptOrder，以及可选的 answered，不含 ink 或逐题 fingerprint。未出现的题提供未作答默认值；没有作答文件时只读不创建，尚未写入的空根可不含指纹/位置。historyIndex 只存轮次索引，绝不内嵌历史内容；目录独立于 v1 `.state`。
- 笔迹记录为独立文件，字段 ink、inkRevision、receipts、receiptOrder（路径与清理见 D33）；不存在时返回 ink:null、inkRevision:0。主状态上限 32 MiB，每题笔迹文件另限 32 MiB；不是把全部笔迹算进主状态。
- 提交信封：requestId、snapshotId、expectedRevision、answer。先保存成功再返回 solution；当前锁凭证为 submissionId + answerVersion + contentFingerprint（题库整体内容指纹），评分请求通过题库/题号路径绑定该题的当前锁。
- 结果上报：requestId、snapshotId、submission、expectedResultRevision、source:"grader"、result。必须对应当前锁定答案；score 为有限数且 0 ≤ score ≤ 大纲满分。小题 ID 不重复且属于本题、各自不越界，总分按精确十进制求和一致；拒绝数字字符串、越界截断及过期结果。
- 同作用域同 requestId 同内容重放幂等，不同内容冲突；先核对权限与代际。每题 draft/submit/result/retry 共用最近 4 条成功回执；ink 的独立文件另保留最近 4 条成功回执，receiptOrder 显式 FIFO，不依赖数字键枚举；仅存 ID/签名/顺序。已淘汰请求仍校验 revision 或评分版本/锁凭证。重做清旧回执，保留本次重做回执供重放。较早 V2 记录没有顺序时读取不改写，下次成功写入按现存键序取最近 3 条再加入新条；无法倒推旧数字键的真实顺序。V1 状态及标准答案不迁移。
- draft/retry 信封为 requestId、snapshotId、expectedRevision；ink 使用 requestId、snapshotId、expectedInkRevision；draft 至少有 answer/draft 一个字段，ink 必须有 ink。省略不改、显式 null 清空。answer 变化递增 answerVersion，保存非答案 draft 只递增 revision，ink 只递增独立 inkRevision；retry 同时递增 revision/answerVersion、清空活跃内容，hasSavedAnswer 为 false。旧锁及评分不可恢复。单题 GET 附 ink/inkRevision；ink 保存仅返回 `{ inkRevision, state }`，不回传笔迹正文；其他写入确认省略 ink/inkRevision（retry 附清空后的当前笔迹），前端保留已知笔迹版本；写时复制、提交后冻结、串行与原子替换沿用，写失败不替换缓存。
- D35 作答状态：draft 可选 answered，必须随 answer 提交；无小题时为布尔值，有小题时为至多 1000 键的布尔映射，只合并提供的小题，忽略大纲中不存在的 id。省略保留原值；仅 draft/ink 的非答案笔记不改变它，锁后不能随 answer 修改，retry 清空为 false/空映射。概览和单题 state 返回 answered（旧记录缺省 false/空映射），有小题的已评分状态另附 outlineScores；不解析 answer 推测是否已作答。旧记录读取不补写该字段，未传 answered 的原有持久化标准向量不变。
- D15：answer 包括正式答题区笔迹；区外 ink 不评分。锁后 draft 请求只要含 answer 就拒绝，其余非答案 draft/ink 可保存，分别增加 revision/inkRevision，不改变答案版本、锁或分数；重做历史不变。第 2 段保留独立非答案 draft，白板全部为 ink；答题区契约留第 5 段。

## 审查决定与后续边界

- D14：全新设置与默认值，不读取 v1 密钥或密码。D18：type 的 @ 后是拓展主版本，零匹配 EXTENSION_NOT_FOUND，多匹配 EXTENSION_AMBIGUOUS，不自动选取。
- D19：作答及历史位于题库内部 `.qf-v2/`，随文件夹移动/改名/复制，副本各自保存；不按路径或 id 匹配记录。该目录不属于题库内容，资源接口不可见，后续导出必须排除。D20：历史保存当时题目、解析、作答与结果；素材仅存引用，失效时按条降级（第 3 段实现）。
- D16：完成/交卷时从未保存答案的题直接记 0 分；批量结果后立即汇总，待评/无法评分单列，后续更新。D17：每轮不可变文件先落盘，再在主状态登记摘要索引；最终化规则留第 3 段设计。
- D27：根 contentFingerprint 由 bank.json 原始字节和全部已使用题型拓展的文件内容确定，不含物理目录名、题库素材、SDK 或无关文件。打开/刷新/重新加载不一致时清空全部 questions 与 ink 目录，historyIndex 不变；无 state 文件不创建。返回 activeCleared 和“题库或题型已变化，本轮作答已清空”。锁凭证携带 contentFingerprint；不再保存逐题 fingerprint。开发模式的进一步交互留第 6 段。
- D32：state.json 根 lastQuestionId 只随 draft/submit/retry 更新，result/ink/浏览不更新；删除 position 接口与文件。窗口内切库仍用内存记浏览位置，浏览器只用 V2 localStorage 记题库。
- 当前练习没有 GET/POST `B/position`，也没有 `.qf-v2/position.json`；不要再调用或创建。表中 `E/position` 仅为尚未实现的考试提案，第 4 段另定。
- D33：区外笔迹位于 .qf-v2/ink/<contentFingerprint>/<SHA256(questionId)>.json。按题原子替换且独立 inkRevision/回执；ink 不改 state.json；选择题保存不读写任何 ink；hasInk 只由目录文件名索引给出，代表存在保存记录（包括空白板）。retry 先删本题笔迹后写 state，后一写失败时答案保留、笔迹已删，原请求可重试。D27 先删全 ink 再清主状态，失败恢复同理。
- D29：后端最近 8 个题库 LRU，逐出时释放 state/身份/笔迹索引；带 snapshotId 访问被逐出题库时重开，比对一致则透明继续，否则返回过期并按 D27 清理。
- 打开/刷新也检查作答文件的 dev/ino/size/mtimeNs/ctimeNs/birthtimeNs，变化重读，消失回初始态，坏文件报错保留并失效缓存；普通单题读写不扫描题库。写入后下次打开核对身份及字节，避免把外部替换文件身份误配给缓存。POST refresh 接受 questionId/expectedSnapshotId，返回 overview 加 changes（activeCleared 布尔及新增/删除题号、activeRoundInterrupted:false），题目删除才回退；CAS 或清理写入失败不发布新快照，历史阶段尚未实现。
- 打开仅检查 JSON 与大纲，坏题延迟到单题报错；overview 附一道起始题。遍历上限 1000 项，超限返回 lowerBound:1001、limit:1000 与中文原因，不为精确总数继续遍历。
- 锁前不发 solution 适用于作答/评分；本机管理权限的编辑器和导出是例外。后端不执行作者代码；评分沙箱先做真实浏览器验证。
- 读取常量沿用已合并实现；负责人本次确认作答文件上限沿用 32 MiB，其他写入字段上限、包格式、历史资源和账号细节尚未定案，不从旧长文档的提案自动变成新要求。涉及保存、锁定、评分、沙箱的 PR 等审查；第 1 段不提前实现其他段。
