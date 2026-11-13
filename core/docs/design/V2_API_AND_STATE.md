# V2 接口与状态速查

仅压缩已审查的约定，不代表所有接口已实现。开发顺序与决定权以 [工作流程](V2_WORKFLOW.md) 为准；当前能力见 [进度](V2_PROGRESS.md)。原论证与待定提案保留在 [归档](archive/reviews/V2-P1.md)。

## 接口列表

`B = /api/v2/banks/{bankId}`，`Q = B/questions/{questionId}`；`E = /api/v2/exams/{examId}`。

| 方法与路径 | 用途 |
|---|---|
| GET `/api/v2/health`、`/api/v2/catalog` | 健康状态；物理分组与题库列表 |
| GET `B/overview`、`Q` | 检查并打开题库，附大纲、状态和一道起始题；读取单题 |
| PUT `Q/draft`、`Q/ink` | 原样保存答案/非答案草稿；单独保存区外笔迹（第 2 段①后端） |
| POST `Q/submit`；PUT `Q/result` | 原子保存并锁定最终答案，成功后返回 solution；接收前端评分 |
| POST `Q/retry` | 清空本题活跃答案、草稿、笔迹、锁、结果和相关回执，历史不变 |
| GET/PUT `B/position`；POST `B/refresh` | 独立保存停留题号；显式重新检查并清理内容已变题目的活跃记录 |
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

- 题状态含 revision、answerVersion、answer、draft、ink、submission、resultRevision、result、receipts、receiptOrder。未出现的题提供未作答默认值。主状态预留 historyIndex，绝不内嵌历史轮次；目录独立于 v1 `.state`。
- 提交信封：requestId、snapshotId、expectedRevision、answer。先保存成功再返回 solution；锁凭证为 submissionId + answerVersion + questionFingerprint，并绑定题库/考试与题号。
- 结果上报：requestId、snapshotId、submission、expectedResultRevision、result。必须对应当前锁定答案；score 为有限数且 0 ≤ score ≤ 大纲满分。小题 ID 不重复且属于本题、各自不越界，总分按精确十进制求和一致；拒绝数字字符串、越界截断及过期结果。
- 同作用域同 requestId 同内容重放幂等，不同内容冲突；先核对权限与代际。每题 draft/ink/submit/result/retry 共用最近 4 条成功回执，receiptOrder 显式 FIFO，不依赖数字键枚举；仅存 ID/签名/顺序。已淘汰请求仍校验 revision 或评分版本/锁凭证。重做清旧回执，保留本次重做回执供重放。较早 V2 记录没有顺序时读取不改写，下次成功写入按现存键序取最近 3 条再加入新条；无法倒推旧数字键的真实顺序。V1 状态及标准答案不迁移。
- draft/ink/retry 信封为 requestId、snapshotId、expectedRevision；draft 至少有 answer/draft 一个字段，ink 必须有 ink。省略不改、显式 null 清空。answer 变化递增 answerVersion，保存笔记/笔迹只递增 revision；retry 同时递增 revision/answerVersion、清空活跃内容，hasSavedAnswer 为 false。旧锁及评分不可恢复。各接口成功返回与单题 GET 同形的当前状态；写时复制、提交后冻结、串行与原子替换沿用，写失败不替换缓存。
- D15：answer 包括正式答题区笔迹；区外 ink 不评分。锁后 draft 请求只要含 answer 就拒绝，其余非答案 draft/ink 可保存，仅增加 revision，不改变答案版本、锁或分数；重做历史不变。第 2 段保留独立非答案 draft，白板全部为 ink；答题区契约留第 5 段。

## 审查决定与后续边界

- D14：全新设置与默认值，不读取 v1 密钥或密码。D18：type 的 @ 后是拓展主版本，零匹配 EXTENSION_NOT_FOUND，多匹配 EXTENSION_AMBIGUOUS，不自动选取。
- D19：作答及历史位于题库内部 `.qf-v2/`，随文件夹移动/改名/复制，副本各自保存；不按路径或 id 匹配记录。该目录不属于题库内容，资源接口不可见，后续导出必须排除。D20：历史保存当时题目、解析、作答与结果；素材仅存引用，失效时按条降级（第 3 段实现）。
- D16：完成/交卷时从未保存答案的题直接记 0 分；批量结果后立即汇总，待评/无法评分单列，后续更新。D17：每轮不可变文件先落盘，再在主状态登记摘要索引；最终化规则留第 3 段设计。
- 内容指纹只覆盖整道题记录（type、question、solution）与大纲条目；素材字节、听力表、拓展代码变动不清活跃记录。正常检查只在打开、刷新、重新加载，开发模式按明确标记检查。
- 打开/刷新也检查作答文件的 dev/ino/size/mtimeNs/ctimeNs/birthtimeNs，变化重读，消失回初始态，坏文件报错保留并失效缓存；普通单题读写不扫描题库。写入后下次打开核对身份及字节，避免把外部替换文件身份误配给缓存。POST refresh 接受 questionId/expectedSnapshotId，返回 overview 加 changes（清除/新增/删除题号、activeRoundInterrupted:false），题目删除才回退；CAS 或清理写入失败不发布新快照，历史阶段尚未实现。
- 打开仅检查 JSON 与大纲，坏题延迟到单题报错；overview 附一道起始题。遍历上限 1000 项，超限返回 lowerBound:1001、limit:1000 与中文原因，不为精确总数继续遍历。
- 锁前不发 solution 适用于作答/评分；本机管理权限的编辑器和导出是例外。后端不执行作者代码；评分沙箱先做真实浏览器验证。
- 读取常量沿用已合并实现；负责人本次确认作答文件上限沿用 32 MiB，其他写入字段上限、包格式、历史资源和账号细节尚未定案，不从旧长文档的提案自动变成新要求。涉及保存、锁定、评分、沙箱的 PR 等审查；第 1 段不提前实现其他段。
