# B2b：历史轮次独立存储设计（待审，不实施）

任务卡：B2b 设计；基线为已合并 B2a #47，`c5a91666ce7544ccb2024f55bff4ba96508ad993`。本 PR 只提交本设计、进度，以及明确授权的 B2a 依赖名单去重和测试；没有实现以下文件布局、迁移、读写适配或恢复协议。实现必须等待设计审查。

改了什么：盘点全部历史消费者，比较两个布局，提出不可变轮次对象与主文件提交点的方案，列出兼容、恢复、配额、内存模式和分 PR 验收。B2a 收尾的实际代码和测试见末节。

明确没改什么：StateStore、历史算法、EditJournal、存储格式、响应 JSON、状态码、规则输入、版本号、回执、四份标准答案、UI 和安装包均不改；不开始 B2c 或其他任务。

兼容性/计时：本节只给现有代码证据与静态字节模型，不把设计估算写成优化后实测。旧状态/旧拓展/冻结历史的读写成功语义是实现阶段的硬门槛；有意改变的是物理布局，必须用新标准答案覆盖。

## 1. 现状盘点

以下源码简称仅为本文件阅读方便：

- **S**：[practice/state-store.js](../../../server/host/practice/state-store.js)。当前主文件是 `.state/<sha256(stateKey)>.json`，schemaVersion=1；所有内嵌历史也会被 load 读取、验证、冻结、重新编码计大小。
- **H**：[history/history-rounds.js](../../../server/host/history/history-rounds.js)，含 legacyRounds/deleteLegacy/publicRecord/summarize。
- **J**：[editor/edit-journal.js](../../../server/host/editor/edit-journal.js)。当前 journal v1 是 bank+state，v2 是 source-only；不是新状态格式的版本号。
- **U**：[practice/short-answer-upgrade.js](../../../server/host/practice/short-answer-upgrade.js)。
- **E**：[exam/exam-sessions.js](../../../server/host/exam/exam-sessions.js)，**P**：[practice/practice-sessions.js](../../../server/host/practice/practice-sessions.js)。
- HTTP 入口在 [collection-routes.js](../../../server/host/practice/collection-routes.js) 与 [http/server.js](../../../server/host/http/server.js)；前端历史回放在 [history-view.js](../../../web/history/history-view.js)。

### 1.1 主状态中的历史字段及读写位置

| 字段 | 读 | 写/删除 | 设计归属 |
|---|---|---|---|
| historyRounds[] | S.activeRound/summaryRound/summaryStates/#summaryViews、reviewAvailable、AI assertAiCurrent、history/deleteHistory、load/validateSaved；H.validateRound | S.recordSubmission、recordReview、finish、edit/adaptDevelopmentState 的 interruptRound、deleteHistory；U.upgrade 同身份保留或新增快照 | 活动及关闭轮次主体独立；主文件只留固定大小引用 |
| history[] | S.history/deleteHistory/validateSaved；H.legacyRounds 按 legacyRoundId 或重复 questionId 分组 | 旧数据输入；H.deleteLegacy 删除一轮并为所有幸存记录固定分组边界 | 每个旧轮文件保存该组原始 records；不得丢失原始数字/字段/边界 |
| upgradedCompletion | S.summaryRound、validateSaved、#ownRound；不在 history() 的列表合并来源中 | U.upgrade 自动评分升级生成；S.act 的 whiteboard 更新 completionVersions，其余动作删除；restart 删除 | 独立快照引用；随当前答案变化的 completionVersions 保留在主文件，避免白板重写整轮 |
| finishReceipts[] | S.finish 先读回执幂等返回 | finish 追加/裁剪≤32；adaptDevelopmentState、U.upgrade 删除 | 主文件，回执不是关闭历史，不拆成轮次 |
| restartReceipts[] | S.restart | restart 追加/裁剪≤32；adaptDevelopmentState、U.upgrade 删除 | 主文件 |
| completionIntent | S.submitSaved 逐题继续提交；不是一次大事务 | submitSaved 先保存 request+qid 列表，完成后删除；adaptDevelopmentState 删除 | 主文件；必须保留进程中断后逐题续做和请求幂等 |
| completionReceipts[] | S.submitSaved/completionResult/saveCompletionResult | submitSaved 保存 submittedQuestions；saveCompletionResult 替换完成响应；adaptDevelopmentState 删除 | 主文件；不把“完成按钮”误改成只提交一次 |
| editReceipts[] | S.edit | edit 追加≤32，且按字节裁剪；adaptDevelopmentState/U.upgrade 删除 | 主文件；响应可带 collection，仍可能较大，B1 才处理瘦身 |
| questions[qid].receipts[] | S.act/confirmAi/confirmedAiReceipt | 各动作/AI 确认追加，retry 本身不清其他历史；restart/编辑/升级按既有规则清理 | 主文件；回执内复制的答案/笔迹不因 B2b 消失，不能算成已拆出的历史 |
| upgradedFrom | U.upgrade 标记来源；不作为轮次选择算法 | U.upgrade 设置，轮次也可有 upgradedFrom | 保留原元数据；根与轮次各自保存，不猜测含义 |
| extensionFingerprint、questions[*].fingerprint/revision、AI generations/task IDs | S.verifyCompatibility、summaryRound、reviewAvailable、assertAiCurrent | act/AI/编辑/适配/升级更新 | 当前状态和幂等/兼容关系仍在主文件；冻结轮自己的指纹/状态保留在轮次正文 |

轮次正文包含 `collection`（含 states）、`questions[].payload`（答案、草稿、stamp、AI 任务信息）、page/pages、fingerprints、extensionFingerprint、summary、completionVersions、explicitCompletion、状态/时间/中断原因、API 声明及未知扩展字段。它们不能被摘要代替。保持 B2-2 已修复的 aiTask/aiTasks 字段，不重演内部视图漏字段问题。

注意两个现行行为：restart 要求已完成，只重置当前 questions 并删除 upgradedCompletion，不新增空轮；retry 不改已经冻结的条目。不能为了存储实现方便而改成其他语义。

### 1.2 v2 数据的实际字节构成

只读取 A1 生成的 `quizforge-perf-a1-v2`，200 题/3 类型/2 轮，文件 **5,002,406 字节**，SHA-256 `263b515087fe5ef71290958af86539f2306cdcf88d19123ebe54f940749f1c1e`。以 parseJson/jsonBytes 保留数字字面量，确认读取后重编码与原文件 Buffer.equals。未读取作者题库。

| 字段/类别 | 值编码字节 | 占文件 | 备注 |
|---|---:|---:|---|
| historyRounds | 2,792,789 | 55.8289% | 连键及冒号为 2,792,805 字节 |
| history | 0 | 0% | 字段缺失；不表示真实用户无此数据 |
| upgradedCompletion | 0 | 0% | 缺失 |
| finishReceipts / restartReceipts | 各 0 | 各 0% | 缺失 |
| completionReceipts / completionIntent | 各 0 | 各 0% | 缺失 |
| editReceipts / upgradedFrom | 各 0 | 各 0% | 缺失 |
| questions（包含以下两行） | 2,209,442 | 44.1676% | 连键 2,209,454 字节，不与子类别重复相加 |
| 当前题回执（各 receipts 值合计） | 1,056,024 | 21.1103% | B2b 不瘦身 |
| 当前题笔迹（各 draft 值合计） | 1,117,080 | 22.3309% | B3 才独立存储 |

根键实际只有 schemaVersion/collection/extensionFingerprint/questions/historyRounds；五个键值对合计 5,002,400 字节，外层括号及四个逗号 6 字节。删除 historyRounds 键值及其逗号后的当前核心 **C=2,209,600 字节**。

两个冻结轮都是 interrupted，各 **R=1,396,393 字节**；每轮 publicRecord(summary=true) 为 **I=903 字节**，questions 部分 1,315,079、pages 2,029、collection.states 22,868 字节（嵌套类别，不重复相加）。v2 没有活动轮，不能把“两个现有轮次”冒充“一个活动+一个关闭轮”。下文用现有 R 作为同规模活动轮的字节代理，只用于模型，实际活动轮须实现后测量。

这些数可在本地对生成种子复核：逐字段 `jsonBytes(projectJson(state,[field])).length-2` 是键值对大小，`jsonBytes(state[field]).length` 是值大小；缺失字段记 0，结构开销单列。不得 JSON.parse 后丢掉 numericSources 再声称字节精确。

### 1.3 所有历史读取路径及粒度

| 路径/函数 | 需要的内容 | 新布局计划 |
|---|---|---|
| S.load/validateSaved/verifyCompatibility；普通 GET collection overview | 当前 questions、身份，原来被迫读/验全部内嵌历史 | 新格式只读主文件；历史引用语法与限额元数据检查，不解冻全部历史。旧格式继续原样读取 |
| S.history(kind,id) 列表 | publicRecord(round,true)，只需摘要 | 扫描主文件的固定元数据前缀查 collection 前缀，再读索引头；不读题目/页面正文 |
| S.history(...,historyId) 详情；前端 createHistoryView/frozenPage | 选中轮完整正文、旧别名、冻结页面/答案 | 只取匹配的一个轮及必要的元数据补丁，保留防御性复制 |
| S.deleteHistory/H.deleteLegacy | 定位与分组边界需元数据；新布局无须读所有正文 | 对目标旧格式允许当前逻辑；新格式元数据重建目录，保留当前 questions，不清空答案 |
| 继续当前练习 | 当前 questions + 活动轮 | 普通重新打开不从历史导入答案；没有“把任意关闭历史恢复为当前题库”的后端接口 |
| 考试 resumeExam→open('exam',id) | E 的考试快照/状态 + 对应 Store 的当前题及活动轮 | 保留原分派；不新增恢复历史 API |
| S.summaryRound/scoreSummary/summary/finish | 活动轮；无活动时 upgradedCompletion 优先，否则仅看最后一个现代轮，且必须 completed；兼容检查可能需正文 | 显式获取候选轮，不跳过 interrupted 轮去寻找更早 completed 轮；completionVersions 可避开部分答案比对，但不假定所有旧轮都有它 |
| S.reviewAvailable/reviewCapabilities | 活动轮相应题的 submitted 与 answer，及 roundCompatible | 最多一个活动正文；不能仅凭摘要分数授权人工/AI 评分 |
| S.prepareAiInputs/aiSnapshot/assertAiCurrent/bindAiTask/confirmAi | 活动轮 ID、答案/版本/代际，确认后更新该轮 | 和 summary/review 共用不可变轮缓存；晚到 AI 与重复 requestId 保持现状 |
| S.recordSubmission/recordReview/#freezeRoundValue | 活动/最近轮的完整条目及冻结页面 | 只加载/构造本次所需轮，不补出一个全量 historyRounds 数组供 cloneJson 使用 |
| S.edit/adaptDevelopmentState | 当前题及最多活动轮；做完整备份时才需全部历史 | 编辑中断活动轮；备份显式物化，正常无变化读取不迁移布局 |
| U.upgrade | summaryRound、旧问题；同身份保留原历史，自动升级可生成 upgradedCompletion | 显式历史读取与复制引用；跨 stateKey 的新状态按原算法创建，不能把源目录所有历史偷偷挂到目标 |
| 题库/拓展 .qbank 导出（LibraryArchive/exportPackage） | 源题库、拓展、资产；不导出练习状态 | 不改导出内容，不把此功能说成已有历史导出 |
| 本设计的独立回退快照/自动备份 | 全部可见轮次和当前题，含旧 history 来源 | 允许一次完整遍历；单独计量，不能在普通 draft 暗中调用 |
| E.appendHistory/history/historyRecord | 有历史考试记录 + Store 列表/详情 | 列表元数据，详情一个完整轮；保留 exam- 前缀及原时间覆盖 |

现有 history() 为所有根文件按文件名排序，筛 collection 前缀后按 `[legacyRounds, ...historyRounds]` 顺序收集，列表再对 updatedAt 降序稳定排序；详情和删除的 first-match 优先级也须保留。新目录必须记录 sourceKind/原序号，而不是把反向链表顺序直接返回；相同时间的排序、legacyIds 别名和重复逻辑 ID 都不能默默改变。

### 1.4 写动作访问矩阵

| 动作 | 读历史 | 改历史 | 新格式常规写集 |
|---|---|---|---|
| draft | 未提交状态通常不需正文；能力判定可能看活动轮 | 不改普通冻结轮；删除 upgradedCompletion 别名（现行行为） | 主文件 |
| whiteboard | submitted/manual 题的能力判定可能需活动轮 | 普通历史正文不改；upgradedCompletion 仅 completionVersions 跟随 revision | 主文件（别名的可变版本图归主文件） |
| submit | 活动轮；不兼容时中断它；无活动则构造新轮 | 改活动或创建新轮；可能同时封存前轮 | 主文件 + 新活动轮对象，特殊封存用第 2 节的元数据补丁，不能漏旧轮中断 |
| review/AI confirm | 活动轮和对应完整答案/结果 | recordReview 更新该活动轮；全题及分目标均同 | 主文件 + 活动轮对象 |
| finish | 活动/最近候选；不兼容也可能中断旧轮再创建完成轮 | 固化草稿/未提交状态、summary/completionVersions，追加 finishReceipts | 主文件 + 本次完成轮对象；必要旧轮封存记录放其头部 |
| restart | summaryRound 判定已完成，可能看最近完成/升级快照 | 不新建空轮、不改关闭历史；重置当前 questions、清 upgradedCompletion | 主文件 |
| retry/bindAiTask | review/AI 绑定需活动轮；retry 不改已冻结内容 | 当前题/代际/任务及回执；不重写活动轮正文 | 主文件 |
| submitSaved/saveCompletionResult | 活动/最近轮及当前题；逐题 act 不可合并成单事务 | intent/回执在主；每次真正 submit 按上行修改活动轮 | 原分步提交继续，分别原子化；空 intent 不是历史布局迁移触发 |

## 2. 两个存储布局候选

### A：关闭轮独立，活动轮与全部摘要索引内嵌主文件

主文件保留当前题、活动完整轮、closedIndex[]，关闭内容另存。实现较简单，但 draft 每次仍写 C+R+N×I；摘要索引 O(N)，不满足“不随轮数增长”的严格目标。保留为对照，不推荐。不能因 903 字节摘要较小而声称写入与 N 无关。

### B：推荐——所有轮正文独立，主文件保留固定大小引用；索引在轮对象头或索引对象

路径均在当前 stateRoot 下，S=原 stateKey 的 SHA-256，D=对象完整编码字节 SHA-256：

```text
.state/S.json                         新 schemaVersion=2 主文件
.state/history/S/objects/D.json       不可变 round 或 index 对象
.state/S.json.before-history-split-<oldDigest>.bak   首次迁移原始 v1 文件
.state/.edit-journal.json             保留旧 journal；未来扩展 v3
```

主文件仅保留原非历史字段，以及 storage 元数据：activeRef、closedIndexRef、lastModernRef、upgradedRef、upgradedCompletionVersions、legacy/现代轮计数、下一现代轮序号、逻辑配额账本、迁移备份摘要。lastModernRef 保留原 summaryRound 的“只看最后一轮”语义，计数保留 summaryStates 的“从未有过历史”分支；删除最后/活动轮时须同时更新，不能回退到已删除对象。ref 含对象摘要、头摘要/长度和角色，不含题目或关闭轮数组；空引用只发生一次常数大小变化。计数/字节账本用固定宽度十六进制或等价固定编码，不能又把 N 个摘要塞回主文件。原 receipts/intent 保留；未知原根字段原样保留，不猜测/丢弃。

活动轮选择独立存储：否则即使去掉关闭历史，每次打字仍序列化约一个 R 的整轮冻结草稿。B 使普通 draft/whiteboard 只写 C+常数元数据，且避免打开题库时解析活动/关闭的全体快照。submit 的额外一个 R 不可避免，属于它确实修改的内容。

对象是**一个合法 JSON 文档**，格式化为固定单行元数据前缀 + 换行 + 正文成员。元数据里只放 publicRecord(summary=true) 的完整输出、别名/排序位置、前驱引用、校验信息、有限的封存补丁；round 对象的正文只含一个完整轮，旧组则含该组原始 legacy records；index-only 对象没有轮正文。按限定前缀读取元数据，完整读取仍用保留数字字面量的 JSON 解析。ref 的头摘要验证只读摘要路径，完整正文读取时另验完整摘要；摘要正确不代表尚未读取的正文也已验证。

主文件也保持合法 JSON：schemaVersion/collection/storage 的固定元数据前缀先写，换行后是当前 questions 等正文。列表只读该前缀筛版本/collection，不为找到前缀解析全部当前笔迹。v1 未规定此前缀，仍按旧 reader 读取，不通过读操作悄悄重写。

#### 为什么特别处理“中断旧轮并建新轮”的 submit

如果旧轮文件原地改为 interrupted，再写新轮，再改主文件，至少三个权威文件，与“两文件”目标冲突。B 不原地改旧对象：新活动对象的头记录 `{旧正文引用, 按原顺序设置的 status/interruptionReason/closedAt, 上一 closedIndexRef}`，只含封存元数据，不含第二个完整轮。详情读取旧正文后以保留数字元数据的浅复制应用这个补丁；列表用对应 publicRecord 摘要。补丁只能表达存储适配已知的封存元数据，不能修改答案/页面/分数或接受外部任意 JSON Patch。

如果 closedIndexRef 的索引头恰由当前活动对象承载，下一次更新活动轮时复制这份**有限**头记录并把主引用改指新对象；旧活动代际不再可达。新建轮时，前一轮对象已是实际要保留的冻结正文，成为索引前驱。因此每个普通 submit（含此特殊分支）只发布一个新活动对象和主文件，不形成“每提交一次永久保留一个旧活动整轮”的链。

finish 将自己的完成轮摘要加入同一个对象头；restart 只清当前状态，不新增轮。删除历史时允许另建 index-only 元数据对象，按现行 first-match 删除一个 entryKey、保留别名边界，并重建活索引后提交主文件；不重写所有关闭正文。index-only 对象可包含多条摘要，属于删除/迁移等目录重建成本，不在 submit 中写入。

引用按角色解释：`roundRef` 只使用该对象正文；`indexRef` 才跟随头部索引链。删除后重建索引，新主 closedIndexRef 不再依赖旧活动头时，后续活动写不得重新引入旧索引链。GC 也必须按角色遍历，不能把正文对象中已失去权威性的旧头链接当作永久根。该部分复杂度是真实成本，须专项故障/空间用例；若审查不接受，改为显式目录文件并承认特殊 submit 多于两个文件，不能暗中放宽当前目标。

### 写量与打开题库的对比

记 C=2,209,600、R=1,396,393、I=903，F 为主文件固定引用/账本开销，H 为对象头开销，N 为关闭轮数。以下是静态编码模型，不是已实现的写盘计时：

| 动作/读取 | A | B |
|---|---|---|
| draft/whiteboard | 主文件 C+活动 R+约 N×I，每次含全部索引 | 主文件 C+F，与 N 无关；可能读一个活动正文判能力，但不写它 |
| submit，已有活动 | 主文件 C+R+N×I | 主文件 C+F + 一个活动 R+H；两个权威文件 |
| submit，旧活动中断并开新轮 | 主文件新活动 + 旧轮归档/索引更新，需要额外处理 | 仍两个，封存描述寄存在新活动对象头；旧正文不可变 |
| finish | 写归档轮，更新主文件/目录 | 写完成轮对象和主文件；活动引用转为关闭索引 |
| restart | 主文件 | 主文件 |
| open，两个现有冻结轮且无活动 | 主文件 C+约 2I | 主文件 C+F；不读关闭正文 |
| open，有活动且 N 个关闭轮 | 主文件 C+R+N×I | 主文件 C+F；请求具体题目/summary 时按需取活动/最近轮 |

N=2 时，A 带活动的主写量约 **3.608 MB**；B 的 draft 为 **2.210 MB+F**，submit 约 **3.606 MB+F+H**。R 是已有冻结轮的代理，不能当作真实新活动测量值；F/H 格式尚待审查，不编造精确总字节数。B 的普通 submit 可能多一次 fsync，不能仅凭字节模型声称时延必同比下降。

## 3. 一致性、失败和恢复

### 3.1 普通状态动作：主文件是唯一提交点

1. 在原 SerialTransactions 内取旧根与所需轮，验证 revision/requestId/身份，构造写时复制候选；共享的旧对象保持冻结。事先算配额、编码及完整摘要，不以任何顺序覆盖旧轮文件。
2. 对本次新不可变对象：同目录临时文件完整写入、fsync，再原子发布到 D.json。若同名对象已存在，仅在字节/摘要相符时复用；不覆盖异物、链接或损坏对象。普通 submit 一个这样的对象。
3. 所有新引用已就绪后，沿用 replaceFile 的单主文件原子替换；这是逻辑提交点。逐帧暂存名字不得额外消耗业务轮 UUID，避免人为改变已有轮 ID 的确定性序列。
4. 主文件成功后才冻结新容器并发布根/轮缓存及字节账本；不得先把候选轮放进共享缓存。提交后冻结或缓存发布若意外失败，清缓存、以磁盘根恢复，不能把磁盘已提交事务假装回滚成旧缓存；重试由持久 requestId 回执判定。

| 中断/失败位置 | 可见磁盘状态 | 下次加载 |
|---|---|---|
| 编码/配额失败、对象发布前 | 旧主、旧对象；可能有不完整临时文件 | 读旧主；旧缓存和旧图不变；只清本实例确认无主引用的暂存 |
| 一个或多个新对象已发布，主替换前 | 旧主 + 未引用对象 | 旧主仍权威；可校验后复用这些对象，不用“最近文件”猜主状态 |
| 主 replaceFile 在 rename 前失败 | 旧主 | 不发布缓存；失败动作保持旧状态 |
| rename 已成功但响应/进程未完成 | 新主 + 完整预发布对象 | 读新主及回执；同 requestId 返回原结果，不能重复提交 |
| replaceFile 抛错但不能确定是否越过 rename | 需核对磁盘主摘要属于前像还是后像 | 后像即已提交并清缓存；前像才可报未提交；两者都不符则停止保护，不覆盖外部改动 |

复用 replaceFile 的文件 fsync、同目录 rename 及 Windows 现有 rename 处理，不添加业务重试。**进程中断恢复**是本阶段验收；当前 replaceFile 没有可移植的目录 fsync，不能据此许诺 Windows 断电后一切已返回成功的事务绝不丢失。Linux 可验证目录刷盘，Windows 的断电持久性/是否需要更强日志另列未决，不能假装两个文件天然构成断电原子事务。

### 3.2 编辑源文件的事务

J 不是直接可用的新布局 journal：它当前校验 plannedState.schemaVersion===1，且 v2 表示 source-only。计划扩展 **journal v3**，继续保留 v1/v2 恢复器，保存 bank/main 精确前后像和新不可变对象引用清单；历史对象先发布，journal 再持久化，之后沿原顺序 roll-forward bank/main，完成才删 journal。恢复前校验新对象可用，若目标不是精确前像/后像则停止，不覆盖外部编辑。

新对象损坏/丢失时不强行 roll-forward 到悬空主文件，保留 journal、备份和前后像，明确恢复错误。正常进程崩溃不会删除已发布对象；断电/外部损坏的修复不能用自动丢轮处理。journal v3 的根物理上限、chunk 数随第 4 节的小元数据开销调整，128 MiB journal 总上限不静默突破；不能把全部轮正文再 base64 塞进 journal。

### 3.3 孤儿、悬空及缓存

- 孤儿对象不作为数据导入、也不算丢失轮；它可能是未提交候选或刚被替代的活动代际。完成恢复、检查所有主根/保留备份/待处理 journal 后，才可标记清理。清理不在普通 draft 的关键路径；先移至自有回收区/延迟删除，不跨 stateHash 或跟随符号链接。
- 悬空引用或摘要损坏：需要该对象的操作返回明确的存储不可用错误，保留当前主/备份/文件，不把历史当成空数组、不自动改写引用。仅因 closed 历史坏而是否允许继续保存独立草稿，见未决项；不能用懒加载掩盖损坏。
- 主根替换原子；读者持有旧冻结根时旧对象仍须可读。在当前单进程事务锁内，GC 等活动读者及 journal 退出，再删除无任何根可达的对象。多进程同时写同一 stateRoot 不是现有事务锁支持的模式，本设计不冒充有文件系统 CAS；如需支持，先审查进程级锁。
- 根缓存、活动/关闭正文缓存、元数据头缓存合用原 64 MiB 编码字节预算，冷正文先淘汰，保留原最多 8 个根的策略。不是每个缓存各给 64 MiB。原 2 MiB outline 缓存仍按原单独口径，memoryBytes 计入它。编码字节不是 JS 实际堆大小，应额外观察 GC/峰值，不混淆二者。

## 4. 兼容、迁移、备份及限额

### 4.1 迁移时机与步骤

新 reader 同时支持 v1 内嵌根和 v2 引用根。普通读取 v1 不拆文件、不改写；显式传入动作意图，不能凭某次 commit 的对象差异就触发布局迁移。

- 可以触发：真正 recordSubmission/recordReview、产生/改写轮次的 finish、显式历史删除、显式升级/编辑中确实改历史的写操作。只有 intent/回执或当前答案变化的 draft/whiteboard/retry/bindAiTask 不触发。无轮次变化的 restart 不为“迁移方便”强写历史。
- 先保存原始主文件 `.before-history-split-<oldDigest>.bak`，独占创建并 fsync，已有同名文件校验完全相同才复用。备份失败不迁移，也不提交用户动作。
- 从旧输入构造该动作候选，按原 H.legacyRounds 的分组以及 historyRounds 顺序规划对象和索引，保留旧 ID/时间/字面量/未知字段。新物理路径用内容摘要，不给旧轮另造业务 UUID。
- 逐一发布不可变对象，最后将主文件原子替换为 v2；前面任何中断主文件仍是可用 v1。重试通过旧主摘要和相同对象摘要复用暂存，不双倍追加旧历史。已有同一 requestId 的成功回执先返回，不能为一次重放偷偷迁移。

S.load 目前还会做旧 stateKey 的 pre-unified 复制，以及 adaptDevelopmentState 的内容适配/备份；这两个**现有读时写行为不等于允许 B2b 读时迁移**。v1 内容适配即使中断了旧活动轮，仍写 v1；下一次合格的历史写动作才拆分。v2 已在新布局时则按新提交协议适配。必须分别测试，不能声称原代码的所有 GET 本来都绝无写入。

### 4.2 旧 history、别名与升级完成快照

迁移先调用原 legacyRounds 确定每组边界，在每个旧轮对象中保留该组原始 records，而非丢弃它们只保存投影。列表头保留 legacyIds 和原分组/排序位置；详情仍通过原转换逻辑构造同一逻辑轮。删除旧轮后，用目录元数据固定幸存边界，避免拼接后重新合并；回退导出要按 deleteLegacy 的原规则恢复 legacyRoundId 的存在/位置。不能重新猜分组。

upgradedCompletion 不是普通列表轮：独立引用但不加入 closedIndex。其白板后 completionVersions 图是跟随当前练习的匹配数据，放根并在内部构造完整候选时按原位置合并；publicRecord 本就剔除此字段。删除别名不删仍被普通历史引用的快照。

U 的 same-state 升级保留引用并处理活动中断；跨 stateKey 按当前算法建立新当前状态/新快照，不直接把外源 owner 的所有对象路径塞给新根。必要正文复制/重新编码到新 S 目录，备份与源 bank/main journal 同步保护。

### 4.3 降级与备份

旧程序只懂 schemaVersion=1，会拒读新主，**迁移后不能直接降级并保留新进度**。回退办法：

1. 仅退回迁移前：停服务并备份完整 `.state`，用精确迁移前 .bak 恢复同名主；迁移后新增记录留在整目录备份，不说它们被老版本读取了。
2. 保留迁移后所有数据：在新版本中显式导出**自包含 schema1 状态快照**（拟实现的本地工具，不是现有 .qbank 导出），物化全部历史和旧 records，校验各引用/字节上限后输出到新路径，绝不覆盖运行中的主。停服务后配合资源/SDK/考试目录完整备份再替换，旧程序不接触新格式根；工具未完成不得启用迁移。

现有 `.before-content-edit.bak`、带摘要后缀的变体、`.pre-unified.bak`、upgrade-backups/.../state.json 仍需能作为**完整快照**使用。v1 备份不改。v2 内容编辑/升级备份先物化成 schema1 独立文件；journal 的物理 mainBefore 与可回退的逻辑完整快照分开，不把一个带悬空引用的主文件复制品冒充自包含备份。此类少见操作允许完整读历史，失败先保护现有数据。journal 尚持有的旧根及任何引用式诊断副本必须作为 GC 根。

### 4.4 限额口径

- 初期**不借拆分放大原 32 MiB 逻辑集合限制**：当前题/回执 + 保留的现代轮正文 + 原始 legacy records + upgradedCompletion 的原兼容表示，按与旧 schema1 等价的编码成本计账；删除/新写用旧值/新值的字节差更新，不能每次 draft 重编码全部历史。元数据保存不可变对象长度和配额账本，按需校验，计数用固定宽度。
- 主正文逻辑上限仍 32 MiB，物理主允许加固定元数据前缀预算（建议 16 KiB）；每轮逻辑正文至多 32 MiB。元数据头也必须受限并单独读取；为了保留当前 publicRecord 的未知大字段，不能随便定 1 KiB 然后丢字段。最坏物理轮对象可能含重复摘要头+正文，需在实现前确定最大 64 MiB 的有界容器解析预算，而不是把通用 readBytes 全局上限调大。
- 32 MiB 是活数据的逻辑限额；物理对象头、旧代际、暂存、完整备份会占额外磁盘空间，删除逻辑历史不是立即释放所有物理字节。缓存的**所有实际持有的编码表示**都计入 64 MiB，不能因磁盘去重而漏算内存重复。
- 旧 legacy 按原 records 口径计费，目录归组不重复收取转换视图体积；转换视图仍受内存预算。未知根字段留在核心，其字节照计。元数据不一致、循环、异常声明长度必须报错；不能信任未验证的账本去无限分配/遍历。目录遍历的独立资源上限需在首个 codec PR 推导并以原合法边界夹具测试，而非默默限制可读轮数。
- 历史读取的损坏发现会变成按需，缓存/备份/磁盘物理限额的这些变化必须明确发布；不是本设计已经实现的配额升级。

## 5. 内存模式与考试

实际盘点与“所有考试都使用 StateStore.memory”不同：E.store(record) 优先临时 runtime，否则用持久 states；有历史考试还保存 exams/id/exam.json、snapshot.json、题型/材料。只有 history=false 临时考试和普通临时练习状态使用 memory Store。临时考试也会创建暂存题型/音频目录并清理，不能声称整个考试流程从未落盘。

本卡只拆练习状态/轮次，保留这个分派。内存实现使用相同逻辑 Core+目录/轮对象 Map（键为对象引用），无 fs、无 staging 文件、无 journal/备份写入；单次提交先校验所有新增字节，再一起交换根和对象 Map 并冻结。旧图/旧历史对象仍不被原地修改。

MemoryBytes 包含当前根、所有仍需保留的轮/别名/目录及 outline；不能依靠“未加载的磁盘引用”给内存历史少算。保留每 store 32 MiB/最多 32 集合的准入，以及 P 和 TemporaryExamSessions 各自 224 MiB/32 会话的现有限制，资源/AI/考试快照仍按各自 bytes() 相加。内存不可通过淘汰唯一历史副本来满足预算；只淘汰可重建派生缓存。磁盘可以淘汰正文缓存后再读文件，不能把这套 LRU 直接照搬给内存。

外部语义保持：临时模式 history/deleteHistory 仍 HISTORY_DISABLED；finish 返回 historyId=null，临时考试所有权/过期与保留历史考试的 exam- 包装不变。内存也须保留一轮运行中的快照供 summary/review/AI；“不对用户展示历史”不等于内部没有轮。内存模式编辑源仍可能调用 commitSource，另行验证原有源编辑语义，不把它说成练习状态落盘。

## 6. 四份标准答案与成功响应的逐字节兼容

旧文件全部保留，**不重新生成、不覆盖**：state-golden-d3505cf.json、state-golden-memory-d3505cf.json、history-ai-disk-d3505cf.json、history-ai-memory-d3505cf.json。它们转为明确的“v1 输入/旧逻辑输出”夹具；存量 v1 模式的读取、旧动作未触发迁移前仍沿原字节比较，不能删除原断言来隐藏不兼容。

新增而非替换：新磁盘根+所有对象的确定性目录清单标准答案；内存逻辑图/配额的标准答案，以及公开响应快照。引用文件排序只用于比较目录文件清单，不对业务 JSON 排序、抹时间、改 ID 或归一化数字。

生成步骤必须在实现 PR 记录提交号、命令、SHA-256：

1. 用未修改的 c5a9166 reader 对四个输入（第二场景含六组状态）分别生成 history 列表、全部详情、summary、选中题 response/capabilities/AI 可用性等 jsonBytes 作为基准成功响应；再用新 reader 直接读 v1，逐个 Buffer.equals。不同 Store 的 stampKey、时间和业务随机源沿原确定性场景固定，不能修改已保存的轮 ID。
2. 对每份 v1 副本触发明确合格的历史写，另有不改变逻辑值的存储迁移测试适配器仅用于测试；验证迁移前后**既有**历史列表/详情（包括 aiTask/aiTasks、legacy 分组/别名、数字 1/1.0、冻结页面）字节相同。真实新动作本来改变的那轮，对照同动作的原实现输出；不能拿“新旧本来不同”放过其他字段。
3. 新格式固定序列覆盖原 draft/whiteboard/submit/review/retry/AI/finish/restart、写失败、同 requestId 重放，并加跨对象发布点崩溃、旧轮中断同时新建、legacy 删除边界、upgradedCompletion、source edit/upgrade journal、缺失对象/坏摘要/GC 活读者。新磁盘标准答案逐文件比 Buffer，内存标准答案比逻辑图和公开响应，解释二者本来就有的 historyId 差别。
4. 新物理格式下原“整个状态恰好 stringify 一次”类计数要改为**仅主核心一次，关闭历史不序列化**的同等严格断言，逐条记录理由并等待审查，不跳过或变成随实现的宽断言。公开对象被调用方改动、失败/成功都不改旧冻结图的用例继续保留。

复用 cloneJson/projectJson/shallowCopyJson 及 parseJson/jsonBytes 的 numericSources 约定，不能用普通 JSON 重编码或 structuredClone 搬轮次。新增持久化格式的标准答案遵守 CONTRIBUTING：在同一 PR 解释有意变化、来源、生成方式；不是为测试变绿重录。

## 7. 分 PR 与验收（均需设计通过后才开始）

| 后续 PR | 范围/独立可审查边界 | 验收 |
|---|---|---|
| B2b-1 codec 与只读适配 | 类型化主/对象格式、受检路径、双 reader、元数据/正文/兼容视图、字节账本和内存后端；schema2 只来自测试夹具，真实 v1 还不迁移 | 所有旧成功响应 Buffer.equals，旧四份文件不改；读不写盘；循环/坏长度/缺失/摘要故障；内存无状态 I/O、字节准入守恒；CI 三 job |
| B2b-2 多文件 COW 提交 | 对已是新格式的状态实现活动/目录更新、不可变发布和主提交点、特殊 submit 封存补丁、冻结/读者保护；不靠临时生产开关绕过验证，真实旧根仍走旧写路 | 故障注入每个写/fsync/rename/返回点，缓存与磁盘前后像一致；真正普通 submit 只发布主+一个活动对象，不改关闭正文；目录 delete 与详情/别名顺序等价；新标准答案，CI 三 job |
| B2b-3 迁移、备份、编辑/升级与切换验收 | 合格历史写才迁移；legacy raw 分组、降级导出、完整备份、journal v3（旧恢复器保留）、考试/临时集成；所有工具完成才启用迁移 | 全流程一次/重复/中断迁移与回退，源/主同时编辑故障恢复；历史列表/详情/删除/继续练习/summary/review/AI/简答升级/考试/内存全部既有用例；完整性能与 CI 三 job |

每个实现 PR 都续写对应 reviews 文件并与 PR 描述同步；若 B2b-3 过大再按迁移与编辑集成拆两个 PR，不能部分启用而让其他入口损坏新状态。

### 性能门槛与估算依据

已有 B2a 数字证据中与本基线相同 StateStore 的旧状态测量：open state-load 中位数/P95 **1451.358/1892.082 ms（n=3）**；旧完整内嵌写 persist 中位数/P95 draft **267.5725/426.654**、whiteboard **271.3175/395.621**、submit **386.973/594.677 ms**。这些是已有测量，不是 B2b 的新跑分。

字节依据：只有两个关闭轮时，核心 C/总量=**44.1707%**，可消除约 **55.8293%** 的每次关闭历史编码/读取字节。固定 fsync/rename、状态其余部分和对象校验不按这个比例缩放，因此不编造精确毫秒收益。B2b 不解决仍占约 2.17 MB 的当前笔迹+旧回执，也不优化题库 library 或规则。

设计建议的实施验收值，待审确认：

- 原 v2 与经真实合格写迁移后的副本对照，三轮；open 的 state-load 中位数至少下降 **35%**，并报告 P95、每次实际读的文件/正文数与字节数。目标针对新格式/已迁移数据；未迁移的 v1 只读不宣称提速。
- 在相同当前 questions/回执/活动轮下改变关闭轮数 1/2/10/20（完整 v2 轮体量在旧 32 MiB 预算内的取值），每次 draft/whiteboard 主文件编码/写入字节完全相同；没有关闭正文读取/编码/写入。0→1 的空引用变化允许一次固定开销，不能再随 N 线性增长。更大 N 用小合法轮测索引，不通过解除配额造不合法 fixture。
- draft/whiteboard 的 persist 中位数相对二轮未拆分基线至少下降 **30%**；同一硬件、进程隔离、同一序列下各 N 的中位数最大/最小≤**1.15**。决定性回归门槛是字节/调用次数；若时间波动不达标，报告原因和原始值，不放宽门槛或择优丢样本。
- submit 同样三轮报告 persist 的中位数/P95与总物理写量；目标仅修改主+活动一份正文，关闭轮数增加不引入关闭正文重写，时间不因额外对象 fsync 比匹配未拆分基线退化超过 **15%**。finish/restart 另列写集和耗时，不把它们混成普通 submit。
- source 编辑/备份/迁移允许 O(N) 并单独报告。旧输入四套、新格式两模式、所有已有测试及三个 CI job 均通过后才提交验收；不以减少测试或隐藏维护耗时代替达标。

## 8. 风险与需要审查的决定

1. 是否接受推荐 B 的“索引头/封存元数据补丁 + 类型化引用”复杂度，换取严格两文件 submit？若改用朴素目录，必须明确允许罕见 rollover 多写几个文件，不能同时声称满足两文件目标。
2. 是否接受现有 32 MiB 逻辑集合限额不放宽、物理容器可含受限重复头的口径？codec PR 需给出头/目录遍历硬上限的推导，不损失旧合法未知字段；磁盘备份/孤儿额外空间需预检。
3. 懒加载会延后发现关闭正文损坏。保守建议：需要坏对象的历史/提交/备份停止且不丢数据；独立草稿是否可继续，需要明确产品决定。不能既承诺 open 完全不读历史，又声称已经检查了所有历史正文。错误被发现的时机是可见变化，须审查。
4. 进程崩溃和断电是不同保证；Windows 缺少现用目录 fsync，是否要求断电级事务将决定是否增加日志/放宽两文件物理写目标。未验证前不作承诺。
5. 单进程 owner、外部改文件检测、跨 stateKey 升级副本、删除后 GC/备份/活动读者，均须实现故障用例；引用摘要不是有权限攻击者的真实性认证。
6. 当前 metadata/API 很宽，未知字段、legacy 分组、同时间稳定排序、重复逻辑 ID、AI task optional fields、upgradedCompletion 白板版本图及 numericSources 都有遗漏风险，必须用原 reader 的成功响应做字节基准。
7. B2b-3 工具未齐不能启用迁移；用户降级必须先导出或选择迁移前备份，不能给旧程序直接打开新根。
8. 本文门槛是设计提案，没有任何 B2b 优化实测。审查通过前不写存储实现、不更新四份标准答案，不顺带做 B1/B2c/B3。

## 9. 本 PR 的 B2a 收尾、测试与交付记录

B2a 依赖名单改为 rule-engine.js 导出冻结的 RULE_DEPENDENCIES，原顺序不变，完整遍历和 WriteEnvironment 均引用它。没有改文件集合、顺序、指纹 namespace、内容读取或校验缓存键。

新增测试在隔离的合成安装中观察 validationEnvironment 实际访问的依赖根目录，与七哨兵中的五个 package.json 所属包集合比较，再与导出列表比较；不是两个桩各返回同一个值。额外断言原遍历顺序、冻结名单及原实现生成的指纹 `80458ae0167cdd00b42fe5f26620bdbae703c1e9493caa42c938c893634b07da`。该值在改动前由未改动 c5a9166、同一合成 Node/runner/五个依赖文件实际全量计算获得；不包含主机绝对路径。其他 B2a 测试不改。

本机环境：Windows 11 Pro x64，10.0.26200，Node v24.13.0；隔离工作树，无文件系统沙箱。本次不启动应用服务、不访问正式/测试服务器、不读 SSH 配置或作者题库；仅复用 A1 生成种子作只读字节盘点。

| 本机检查 | 结果 |
|---|---|
| npm --prefix core ci --ignore-scripts | 退出 0 |
| npm --prefix core run typecheck:ui | 退出 0 |
| npm --prefix core run build:ui -- --check | 退出 0，源码/构建/许可证一致 |
| node --test core/server/host/extensions/write-environment.test.mjs | 20 项，20 通过，0 失败/跳过，11010.4936 ms |
| node --test core/test/practice/state-golden.test.mjs core/test/practice/history-ai-golden.test.mjs core/server/host/extensions/write-environment.test.mjs | 30 项，30 通过，0 失败/跳过，25829.8065 ms |
| git diff --check | 退出 0 |

四份标准答案的磁盘/内存 Buffer.equals 均通过；文件未改，SHA-256 与 B2a 一致：

| fixture | SHA-256 |
|---|---|
| state-golden-d3505cf.json | 07849dbea421df2de8d9034522151018295a2615bafd21b2702be94b3889ef50 |
| state-golden-memory-d3505cf.json | 698b1e5fb38c6a28e09b588da4b761b86f777175c548902913fed8b2baac97ac |
| history-ai-disk-d3505cf.json | ec4bce06913a99f1fc7629c1ed437d7ecd49e0b203aec0cfc0da6d07ecc1c292 |
| history-ai-memory-d3505cf.json | 35ca3dfabf1ca5643b0148c19f9fc9bd1e0d16390a04f971110acf1a551803f7 |

完整默认套件由推送后的 Windows/Ubuntu 干净 CI 执行，独立 perf job 不变；本机已知凭据 ACL 环境的整套失败本次不重复运行，也不改断言去规避。CI 三 job 的实际结果/失败名单会直接补在本文件与 PR 描述。未运行 B2b 实现或性能优化测试，因为根本没有实现。

本文件同时是完整 PR 描述。文件清单：rule-engine.js、write-environment.js 的名单去重；write-environment.test.mjs 新用例；B2b.md 设计；ARCHITECTURE_REFACTOR_PLAN.md 进度。没有提交临时分析脚本、真实数据或 B2b 代码。推送后等待审查，不自行合并。
