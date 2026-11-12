# B2a：写路径 library 耗时诊断与哨兵实现

> 测量阶段 #46 已审查通过并合并（91c73ce）。本文件后半部分续写独立的哨兵实现 PR；前面的原测量数据与数字证据不改，原“仅测量”边界属于当时提交。当前状态见文末“哨兵实现”。

> 当前实现 #47：暖写改为七文件哨兵复查，完整环境指纹、内容检查及读路径不变；三个主写动作 library 中位数为 33.082/31.166/27.3135 ms，四份标准答案不改且通过。新增环境保证说明和可选 B2c；实现提交的 CI 三个 job 全绿，等待审查，不自行合并。

任务卡：B2a 的测量阶段。

改了什么：三个隔离诊断脚本、此报告及可读数字证据；架构计划只更新进度表。

明确没改什么：没有生产开关或实现优化，不改响应 JSON、状态码、规则输入、版本号、回执或持久化格式，不改 UI、拓展、现有测试及标准答案。

兼容性：普通 v2 数据集的读取/保存用真实宿主完成，种子前后字节哈希一致；旧状态/旧拓展/历史回放的实现未动，沿用完整 CI 中的既有用例和四份标准答案检查。本报告不把合成回环结果当作真实设备或浏览器验收。

计时对比：下文列出完全无钩子的 main 基线、诊断模式、逐请求互斥分配、中位数/P95及计数，不提供未经实施的优化后时延。

测试：诊断装置 13 项及相关既有用例 32 项全部通过；完整两个系统 CI 及性能 job 结果见末节。

未解决或存疑：诊断对时延有可见扰动；未测冷加载/过期/并发；写入复用环境会放宽当前即时失效保证，需审查决定，不能借本次测量视为批准。

## 结论与边界

#45（B2-2）已按授权 Squash 合并到 main，合并提交 `fdadc76b19b904ca85746a4682b665451b5064d6`。本报告及独立测量分支基于这个提交；不修改任何生产实现、规则输入、响应内容、状态码、持久化格式或已有测试，不开始 B2b，也不实施 B2a 优化。

**主要耗时来自每次保存的完整运行环境复查，而不是重新哈希全部依赖。** 普通 draft HTTP 请求先 readCollection，再 writeCollection，contentIdentity 总共执行两次。写入的 environment 每次遍历 5 个规则依赖包的 61 个目录、537 个文件，执行 598 次依赖元数据检查和 598 次 native realpath；依赖文件的内容摘要全部命中缓存，实际重新哈希的依赖文件为 0。另有 rules-runner.cjs 每请求重新读取并哈希一次。

本次无诊断的 draft library 中位数/P95 为 **143.160/257.775 ms**，switch 为 **18.298/27.892 ms**；与上次约 125/19 ms 的结果有波动。开启完整诊断后分别为 **173.289/466.046 ms**、**21.279/33.048 ms**。以下内部细分是诊断开启时的实际值，不能当作无诊断下的精确分摊，更不能把两组差值全部解释为钩子的纯开销。

## 测量方法与可复现证据

- 机器：Windows 11 Pro，系统内核 10.0.26200，Intel Core i5-13500H，Node v24.13.0；本机回环通信、完全串行，无真实题库、无外部服务、无 SSH。
- A1 v2 原种子：quizforge-perf-a1-v2，200 题、3 种题型、5,002,406 字节状态、320 条旧回执、2 轮历史。每个子进程只复制 extensions、question-banks、.state 到其独立 mkdtemp，结束关闭规则进程和端口并删除该副本；原种子状态 SHA-256 前后核对。
- 三轮，每轮 plain（完全不装钩子）与 diagnostic 各一遍，顺序为 P→D / D→P / P→D。每遍独立进程、独立副本，先等待真实启动环境预热、真实打开题库，再 switch 20 次、draft 20 次；不包含白板、提交、考试或冷启动的统计。因此每个模式、每个操作 **n=60**，没有删离群值或重跑择优。
- [测量脚本](../../../../scripts/dev/measure-library-perf.mjs) 复用原 measure-perf 的 Server-Timing 解析/中位数/nearest-rank P95 以及 create-perf-fixture 的合法答案构造，不修改它们。客户端读完整响应后取耗时，library 总值使用原 Server-Timing，而不是自定义总时钟。
- [隔离钩子](../../../../scripts/dev/library-diagnostic-hooks.mjs) 用 Node 的同步 registerHooks，仅在本诊断子进程内改写 5 个模块的加载源码，给原函数加无值变化的包裹；不写回生产文件。库、索引、引擎和 FileCache 原型也仅在该进程包裹。无生产开关、无环境变量开关，应用从不导入这些脚本。
- 高精度时钟 performance.now；AsyncLocalStorage 分离嵌套上下文。函数表为**包含子调用的区间**；主分摊表按区间并集作互斥分配，不把 contentIdentity/contentIdentities 或 environment/validationEnvironment 重复相加。read/write 两个根区间均纳入一次请求。
- fs 计数在相同上下文截获 lstatSync/statSync/fstatSync、readdirSync、native realpath、readFileSync、createReadStream。目录数为 readdir 的唯一路径数，目录访问数含重复遍历。stat 区分普通文件、目录及失败的检查；**这些是可观测的 JS API 调用次数，不是内核 syscall 次数**，不能推算 realpath 内部做了几次 stat。
- 实际重新哈希在 FileCache 的内容 SHA-256 调用点、运行环境的摘要流缓存未命中和 runner 内容 SHA-256 调用点计数。fingerprint 对已有摘要/配置 JSON 的组合计算不冒充“重新读取文件哈希”。
- 每个请求保留全部函数区间/计数，响应后再聚合；不打印正文、答案或逐请求日志。钩子源码锚点必须唯一且 5 个目标均成功加载，否则失败退出。原有预加载 helper 会提前加载生产模块，所以诊断脚本将其动态导入放在钩子安装之后；首次冒烟发现这个问题并拒收结果，修正后才收正式 60 样本数据。
- 正式样本逐条断言：每次 switch 的 contentIdentity=1、environment=0；draft 为 contentIdentity=2、environment=1；indexSnapshot 均为 0。TTL 过期或发生冷加载会直接拒收，不混入本次“已打开题库”的比较。
- n=60 表示 60 个请求的聚合成本；未调用的函数，其请求分配成本为 0、实际函数调用样本数为 0，**没有测出该函数自身耗时为零**。本次未测 TTL 过期读、内容变更冷加载、并发合并 pending 或跨平台耗时。

```powershell
npm --prefix core ci --ignore-scripts
node core/scripts/dev/check-library-diagnostics.mjs
node core/scripts/dev/measure-library-perf.mjs C:\dev\quizforge-web-refactor-a1\.temp\a1\seed-v2 .temp/b2a/results.json 20 3
```

输出文件已有时拒绝覆盖。另做的 2 样本冒烟只校验装置，不纳入统计。完整可供 git 审查的数字、各请求时长和恒定计数已提交为 [B2a-data.json](B2a-data.json)，其中包含原始输出哈希、种子哈希、生产模块哈希；没有题目正文和答案。

种子状态 SHA-256：`263b515087fe5ef71290958af86539f2306cdcf88d19123ebe54f940749f1c1e`。已提交数字证据 B2a-data.json SHA-256：`67259bfa280fae4a05d1aba0063132f7f1b1a85b9464af570fb614b6ce78df87`（221,653 字节）。

### 诊断影响与轮间波动

| 模式 / 操作 | n | library 中位数 / P95 ms | 客户端中位数 / P95 ms |
| --- | --- | --- | --- |
| plain/switch | 60 | 18.297 / 27.892 | 34.729 / 69.930 |
| plain/draft | 60 | 143.160 / 257.775 | 484.436 / 816.987 |
| diagnostic/switch | 60 | 21.279 / 33.048 | 41.293 / 78.772 |
| diagnostic/draft | 60 | 173.289 / 466.046 | 511.098 / 951.546 |

诊断开启的观测 library 中位数差为 draft **+30.1295 ms（+21.05%）**、switch **+2.981 ms（+16.29%）**；这是两次独立执行的差，不能在未控制文件系统/调度波动的情况下当作纯插桩开销。第二轮 draft 的 plain 甚至比 diagnostic 更慢，第三轮两者又明显不同。内部细分不按这个差值“校正”，不声称生产每次必耗 133 ms 的环境检查。能确定的是调用数、未重新哈希的事实以及诊断样本里各步骤实际消耗的时间。

| 轮次 / 顺序 | plain switch | diagnostic switch | plain draft | diagnostic draft |
| --- | --- | --- | --- | --- |
| 1 P→D | 17.523 / 36.076 | 21.050 / 25.112 | 139.471 / 162.358 | 144.892 / 188.942 |
| 2 D→P | 17.166 / 18.883 | 16.223 / 19.974 | 196.473 / 434.166 | 182.599 / 513.568 |
| 3 P→D | 20.575 / 24.052 | 29.737 / 33.328 | 140.265 / 176.078 | 208.719 / 358.402 |

## 调用链与互斥耗时

普通 draft：HTTP api → readCollection → checkedRead → 一次 contentIdentity + runtimeEnvironment（命中 30 秒复用）→ 读取/校验请求体 → writeCollection → 第二次 contentIdentity + environment → validationEnvironment → 5 次依赖 walkEntries + 摘要缓存检查。之后才进入状态动作，状态的 clone/persist 不属于这里。

switch：HTTP api → readCollection → checkedRead → 一次 contentIdentity + runtimeEnvironment（命中）。路由把已检查的 collection 交给 CollectionRoutes，不再解析一次。

### 互斥主分摊（ms，中位数 / P95，全部 n=60）

| 互斥分配 | draft ms | switch ms |
| --- | --- | --- |
| content | 42.300 / 89.530 | 21.154 / 32.914 |
| environment | 133.066 / 365.720 | 0.000 / 0.000 |
| runtime | 0.056 / 0.150 | 0.090 / 0.164 |
| index | 0.000 / 0.000 | 0.000 / 0.000 |
| lookup | 0.010 / 0.021 | 0.004 / 0.008 |
| otherBinding | 0.045 / 0.082 | 0.032 / 0.064 |
| 根绑定区间并集 | 173.277 / 466.027 | 21.271 / 33.042 |
| library − 六项之和（差额） | 0.011 / 0.018 | 0.007 / 0.011 |
| 原 Server-Timing library | 173.289 / 466.046 | 21.279 / 33.048 |

“其余绑定步骤”包含缓存/关闭状态/路径分支判断、指纹相等比较、返回值处理及未单列的包裹成本；没有将其估算成某个具体业务函数。**差额逐请求计算**为原 library 总值减去根绑定区间并集（等于六个互斥步骤之和），再统计中位数/P95；最大绝对差额 switch 0.0165 ms、draft 0.0220 ms。包括原计时器外层边界和 0.001 ms header 舍入，不能进一步准确归因。逐请求分摊恒等式最大数值误差 1.82e-12 ms。

各列中位数/P95不能相加推导总中位数/P95。逐请求计算的环境份额中位数为 **75.498%**（P95 79.467%），contentIdentity 为 **24.372%**（P95 27.611%）；switch 的 contentIdentity 份额为 **99.398%**（P95 99.576%）。

### 每个函数及调用链步骤（包含子调用，不作为互斥和）

| 函数 | draft 调用数 中位/P95 | draft ms 中位/P95 | switch 调用数 中位/P95 | switch ms 中位/P95 |
| --- | --- | --- | --- | --- |
| Library.readCollection | 1.000 / 1.000 | 20.319 / 43.102 | 1.000 / 1.000 | 21.271 / 33.042 |
| Library.checkedRead | 1.000 / 1.000 | 20.313 / 43.090 | 1.000 / 1.000 | 21.262 / 33.033 |
| binding.readLookup | 1.000 / 1.000 | 0.004 / 0.009 | 1.000 / 1.000 | 0.004 / 0.008 |
| Library.writeCollection | 1.000 / 1.000 | 152.628 / 411.799 | 0.000 / 0.000 | 0.000 / 0.000 |
| binding.writeLookup | 1.000 / 1.000 | 0.005 / 0.015 | 0.000 / 0.000 | 0.000 / 0.000 |
| Library.collection | 0.000 / 0.000 | 0.000 / 0.000 | 0.000 / 0.000 | 0.000 / 0.000 |
| Library.load | 0.000 / 0.000 | 0.000 / 0.000 | 0.000 / 0.000 | 0.000 / 0.000 |
| Library.scope | 0.000 / 0.000 | 0.000 / 0.000 | 0.000 / 0.000 | 0.000 / 0.000 |
| Library.candidate | 0.000 / 0.000 | 0.000 / 0.000 | 0.000 / 0.000 | 0.000 / 0.000 |
| Library.contentIdentity | 2.000 / 2.000 | 42.300 / 89.530 | 1.000 / 1.000 | 21.154 / 32.914 |
| Library.contentIdentities | 2.000 / 2.000 | 42.292 / 89.520 | 1.000 / 1.000 | 21.150 / 32.908 |
| Library.environment | 1.000 / 1.000 | 133.066 / 365.720 | 0.000 / 0.000 | 0.000 / 0.000 |
| Library.runtimeEnvironment | 1.000 / 1.000 | 0.056 / 0.150 | 1.000 / 1.000 | 0.090 / 0.164 |
| RuleEngine.validationEnvironment | 1.000 / 1.000 | 133.026 / 365.704 | 0.000 / 0.000 | 0.000 / 0.000 |
| engine.hashFile | 538.000 / 538.000 | 1.651 / 3.849 | 0.000 / 0.000 | 0.000 / 0.000 |
| Library.indexSnapshot | 0.000 / 0.000 | 0.000 / 0.000 | 0.000 / 0.000 | 0.000 / 0.000 |
| LibraryIndex.scan | 0.000 / 0.000 | 0.000 / 0.000 | 0.000 / 0.000 | 0.000 / 0.000 |
| files.walkEntries | 11.000 / 11.000 | 138.951 / 384.534 | 3.000 / 3.000 | 6.681 / 11.083 |
| files.walkFiles | 6.000 / 6.000 | 12.935 / 31.385 | 3.000 / 3.000 | 6.701 / 11.107 |
| extension.declaration | 6.000 / 6.000 | 9.922 / 18.116 | 3.000 / 3.000 | 4.951 / 6.960 |
| files.readBytes | 9.000 / 9.000 | 12.710 / 22.704 | 4.000 / 4.000 | 5.616 / 8.199 |
| files.readJson | 8.000 / 8.000 | 12.238 / 21.833 | 4.000 / 4.000 | 6.062 / 8.876 |
| files.safeFile | 1.000 / 1.000 | 0.480 / 1.070 | 0.000 / 0.000 | 0.000 / 0.000 |
| files.checkedStat | 716.000 / 716.000 | 138.699 / 384.200 | 57.000 / 57.000 | 12.023 / 19.505 |
| FileCache.entry | 52.000 / 52.000 | 10.150 / 27.328 | 26.000 / 26.000 | 5.420 / 8.696 |
| FileCache.hash | 50.000 / 50.000 | 9.932 / 26.838 | 25.000 / 25.000 | 5.338 / 8.488 |
| FileCache.json | 2.000 / 2.000 | 0.387 / 0.878 | 1.000 / 1.000 | 0.198 / 0.365 |
| file.sha256 | 1.000 / 1.000 | 1.945 / 3.513 | 0.000 / 0.000 | 0.000 / 0.000 |

contentIdentity 是 contentIdentities 的外包装；两行来自同一段工作。environment 包含 validationEnvironment，walkFiles 又包含 walkEntries；同理不得相加。indexSnapshot/scan、collection/load/scope/candidate 在这些暖样本中均未调用，因此不是本次 143 ms 的来源。

## 文件与目录工作量

下表计数逐个核对 60 个请求，最小值=中位数=P95=最大值，所以单个整数同时表示中位数和 P95。不同调用层级包含同一工作，不能累加层级行。

| 操作 / 范围 | 调用 | 不同目录 / 访问 | stat 总数 | 文件 / 目录 / 失败 | native realpath | 重哈希文件 / 次数 |
| --- | --- | --- | --- | --- | --- | --- |
| draft/Library.contentIdentity | 2 | 3 / 6 | 194 | 180 / 12 / 2 | 114 | 0 / 0 |
| draft/Library.contentIdentities | 2 | 3 / 6 | 194 | 180 / 12 / 2 | 114 | 0 / 0 |
| draft/Library.environment | 1 | 61 / 61 | 605 | 543 / 62 / 0 | 602 | 1 / 1 |
| draft/Library.runtimeEnvironment | 1 | 0 / 0 | 0 | 0 / 0 / 0 | 0 | 0 / 0 |
| draft/Library.indexSnapshot | 0 | 0 / 0 | 0 | 0 / 0 / 0 | 0 | 0 / 0 |
| draft/dependency | 5 | 61 / 61 | 598 | 537 / 61 / 0 | 598 | 0 / 0 |
| switch/Library.contentIdentity | 1 | 3 / 3 | 97 | 90 / 6 / 1 | 57 | 0 / 0 |
| switch/Library.contentIdentities | 1 | 3 / 3 | 97 | 90 / 6 / 1 | 57 | 0 / 0 |
| switch/Library.environment | 0 | 0 / 0 | 0 | 0 / 0 / 0 | 0 | 0 / 0 |
| switch/Library.runtimeEnvironment | 1 | 0 / 0 | 0 | 0 / 0 / 0 | 0 | 0 / 0 |
| switch/Library.indexSnapshot | 0 | 0 / 0 | 0 | 0 / 0 / 0 | 0 | 0 / 0 |
| switch/dependency | 0 | 0 / 0 | 0 | 0 / 0 / 0 | 0 | 0 / 0 |

整个 draft 的两个根绑定区间合计 **799 次显式 stat API 调用（723 次文件、74 次目录、2 次失败）**，716 次 native realpath；遍历 64 个不同目录，实际 readdir 访问 67 次。按代码和种子布局，这两个失败探测对应 content 检查中不存在的 assets；此处是源码核对，报告数据只保留失败次数，不宣称记录了每条失败的路径/错误码。所有 HTTP 动作均成功。文件内容哈希只发生 1 次，路径为 server/rules-runner.cjs。

### environment 内部的耗时（包含子调用）

| environment 子步骤 | 每 draft 中位/P95 ms（n=60） |
| --- | --- |
| Library.environment | 133.066 / 365.720 |
| RuleEngine.validationEnvironment | 133.026 / 365.704 |
| 依赖 walkEntries（5 次合计） | 126.064 / 351.543 |
| 其中依赖 stat API | 34.925 / 99.101 |
| 其中依赖 native realpath | 74.537 / 203.810 |
| hashFile（538 次摘要命中合计） | 1.651 / 3.849 |
| runner read + hash 边界 | 1.945 / 3.513 |
| environment − walkEntries − hashFile − runner（未单列差额） | 3.048 / 6.162 |

5 个依赖是 ajv、fast-uri、fast-deep-equal、json-schema-traverse、require-from-string；没有遍历整个 node_modules。5 次 walkEntries 共 61 个目录、537 个文件，stat=598、native realpath=598；这些依赖的重新哈希为 0。hashFile 函数调用 **538 次**（537 个依赖文件 + Node 可执行文件），均为摘要命中；其中 Node 文件仍做身份检查。runner 则走独立的 readBytes + hash，并非 fileDigests 的 hashFile 路径。

依赖 walkEntries 的耗时占 environment 的逐请求份额中位数 **95.144%**（P95 96.124%）。其内部可观测 stat 用时中位数 34.925 ms、native realpath 74.537 ms；这是路径/元数据检查占主导的直接证据。函数包含排序、遍历、路径正规化、JS 调度和诊断包裹，不把未单列的时间都叫成“哈希”或“CPU”。也没有证据将 Windows 文件 API 延迟归因到具体硬盘、杀毒软件或内核组件。

## 各项检查保护的语义及复用风险

| 检查与源码位置 | 现有保护 | 若写动作跳过/复用，会漏什么 | 后果与边界 |
|---|---|---|---|
| writeCollection 的 closed、examResolver、已加载绑定与 environment 可用性；library.js | 关闭后拒绝写；考试走正确解析器；缺失/不可用缓存转完整加载 | 继续使用已关闭实例、错误命名空间或未校验绑定 | 写错作用域或使用不可用规则环境；本次不测考试，不移除此判断 |
| contentIdentity/contentIdentities 的 bank.json 摘要、JSON/听力/资源及注册表；library.js | 外部修改、移动、替换题库/材料/资源后，不能沿用旧题与规则校验缓存 | 复用窗口内外部修改题干/答案、绑定、文件位置、资产或 richtext registry | 旧题可能继续作答/评分，状态与磁盘题库版本不一致；需要保留写入时的即时内容检查 |
| 扩展目录 declaration + walkFiles + FileCache.hash；library.js、extension-packages.js | 目录内规则、schema、manifest、实践页面或其他文件变动改变源指纹 | 增删/替换拓展或 schema 后仍沿用已验证旧输入 | 沿用失效的类型/校验/页面快照，历史与当前包可能错配；不能仅凭 manifest 版本未变就复用 |
| checkedStat/checked path + native realpath；files.js | 拒绝符号链接、特殊文件及重定向路径，保证普通文件/目录 | 仅用缓存目录列表或普通 stat 取代完整路径检查，会漏链接/重定向或新增项 | 可能跨越目录边界，不能把路径安全检查直接删掉；也不能声称仅缓存父目录 mtime 就等价 |
| FileCache.entry 的 dev/ino/size/mtimeNs/ctimeNs/birthtimeNs；file-cache.js | 摘要命中仍核对文件身份；未命中时读取并复查身份 | 文件被原地写入/替换后缓存摘要没失效 | 错误接受旧题/旧资源；摘要缓存是基于元数据的变更检测，不是对有权限攻击者的真实性认证 |
| environment/validationEnvironment 的 Node、runner 和 5 个依赖包指纹；library.js、rule-engine.js | 每次写入复查环境；变化使旧校验环境不再命中 | 外部替换 Node/规则 runner/依赖文件，在复用窗口内不被这条检查发现 | 延迟校验缓存失效，可能继续沿用先前验证/编译的规则环境；不等于修改了执行权限机制，也不能声称完整阻止 TOCTOU |
| runtimeEnvironment 的 30 秒 recentEnvironment 与 unavailable 判定；library.js | 暖读复用；过期回 environment；unavailable 不作为可复用成功值 | 写入改用它后，保证由“每次复查”变为“最多约 30 秒后复查”，并发 pending 还会共用结果 | 这是保证变更，不是无语义影响的换函数；invalidate 会清 recentEnvironment，但外部文件编辑不一定发出 invalidate |
| indexSnapshot/LibraryIndex.scan、scope/candidate、代际与加载后复查；library.js、library-index.js | 冷加载/内容变化时重找目录/别名/唯一绑定，装载期间变化重试或拒绝，较新索引让读缓存退出快路 | 删除冷路检查会漏移走/重复/冲突的绑定或装载期间变化 | 索引暖路已经是 0 次，去掉不能解释本次提速；不得为了优化无关操作而取消冷路冲突与身份保护 |

源文件均保持原样。已有 library.test.mjs 覆盖外部题库更改、拓展替换、移动/删除、较新索引、暖写不扫描无关题库、运行环境改变等行为；本次原测试保持不变。尤其 `warm writes ignore display settings and preserve runtime invalidation and closed-library checks` 把 validationEnvironment 改为新值后要求下一次写立即失效；简单换成 30 秒缓存会与这一现行保证冲突，不能只改断言让其通过。

## 两个候选改法（本次均未实施）

1. **写入复用 runtimeEnvironment（计划原方向）**：保留每次源内容/拓展/路径检查，只把完整运行环境遍历改为最近成功结果；冷加载、导入、显式失效仍作完整核对，unavailable 不能复用。收益依据是每请求可避免本次 environment 路径（诊断中位数 133.066 ms），以及 605 次 stat、602 次 native realpath、61 次目录访问；不是宣称新版本一定节省恰好 133 ms。风险是上表中 Node/依赖被外部替换后的即时写保证放宽，必须先审查是否接受、怎样保留环境变化用例；本次没有更改测试。**只做这项仍保留两次 contentIdentity（诊断中位数 42.300 ms），不能据此承诺 <20 ms。**
2. **普通 POST 只在读取请求体后解析一次写绑定**：将当前路由前置 readCollection 的功能/命名空间决策放到最终受验证的 writeCollection 结果之后；保留写入时完整 contentIdentity，不能简单借用读请求的旧 collection。可避免一次读绑定复查（本次 draft 中 readCollection 中位数 20.3195 ms，内容 stat=97），并保持“请求体到达后再检查”的外部内容变更边界。风险是 history 开关、临时练习租约、权限/请求体校验顺序与状态 store 选择必须共同审查；考试、AI、历史路由不能被顺手改动。本次没有设计或实施这个重排。它本身也保留完整 environment，单独做仍不足以到 20 ms。

以上可分别或组合审查。当前数据只能给出各自移除的已测工作量，无法准确测出未实现方案的最终时延，不用相减中位数来伪造优化后指标。若不接受延后环境变更检测，应另行设计保持即时检查的实现，再讨论预期收益；不得以本报告视为已批准放宽保证。

## 文件、验证及提交状态

- 新增三个仅开发用脚本：measure-library-perf.mjs、library-diagnostic-hooks.mjs、check-library-diagnostics.mjs；应用不会加载它们。
- 新增本审查记录及 B2a-data.json，仅更新架构计划进度表（标记 B2-2 已合并、B2a 仅测量完成）。所有生产实现和现有测试/夹具/安装/CI 文件不改。
- 诊断装置检查：`node core/scripts/dev/check-library-diagnostics.mjs` **13/13 通过**。覆盖真实 FileCache 首次哈希/再次命中、真实 SHA-256 流计数、独立文件数、同步返回身份、异步拒绝、嵌套区间完成、并集不重计、内容不变、所有 fs 包裹恢复。
- `npm --prefix core run typecheck:ui`：退出 0，无类型错误。
- `npm --prefix core run build:ui -- --check`：退出 0，产物和许可证匹配。
- `node --test core/server/host/library/library.test.mjs core/server/host/platform/file-cache.test.mjs core/server/host/extensions/rule-engine.test.mjs`：**32 项、32 通过、0 失败、0 跳过**，26272.5525 ms；完整检查以本 PR 两个平台 CI 为准。没有为测量而跳过、删除或放宽测试，不处理本机已知凭据 ACL 问题。
- 本次没有重跑本机默认完整套件，也不将已知的本机 ACL 问题说成本次新增失败。完整套件在以下干净 CI 环境执行，诊断脚本仅在本机 Windows 验证；CI 的常规套件不执行完整六轮诊断，不能声称本次验证了 Ubuntu 插桩性能。

### 完整 CI 摘要（可直接从 git 阅读）

PR **#46** 实施提交 `7d383aa6e14a15d71650cef8cf55d33d0eb324d9`，运行 **42941752894**，Node **v24.22.2**。通过 GitHub API 读取全部 job 的原始日志和起止时间，结果如下。两个 Checks 均在 `npm ci --ignore-scripts` 后依次通过 typecheck、build check 和完整测试，没有修改 CI。

| job / ID | 结果 | 测试总数 | 通过 | 失败 | 跳过 | job 墙钟秒 | 测试秒 |
|---|---|---:|---:|---:|---:|---:|---:|
| Checks (windows-latest) / 130264968216 | success | 1213 | 1213 | 0 | 0 | 224 | 183.3046581 |
| Checks (ubuntu-latest) / 130264968132 | success | 1213 | 1179 | 0 | 34 | 108 | 90.109921319 |
| Performance (ubuntu-latest) / 130264967906 | success | 2 | 2 | 0 | 0 | 30 | 17.085517079 |

失败用例完整名单：**Windows 空；Ubuntu 空；Performance 空**。34 个平台跳过与 B2-2 相同，没有新增跳过、重试或放宽断言；四份标准答案均包含在原完整测试中，未修改。

此后只补充这份记录和架构计划的 PR 链接，不再改诊断脚本、数字证据或生产文件。PR 描述与本文件保持一致，工作分支 `perf/architecture-b2a-diagnostics`。**仅测量已完成，等待审查；不合并 #46、不实施候选方案、不开始 B2b 或其他任务卡。**

## 哨兵实现（测量审查后的独立 PR）

任务卡：B2a 实现；基线 `91c73ce0dc0f14dcecc3f8aac29fdce31347052e`，已按授权合并 #46。工作分支 `perf/architecture-b2a-sentinels`。本节续写，不替换前述测量与 B2a-data.json。

改了什么：新增 WriteEnvironment，暖写通过七文件受检身份检查后复用成功完整指纹；完整计算前后核对哨兵、时限及失效代际。Library.environment 仍调用原全量算法并登记成功快照；writeCollection 只更换环境检查入口，首次冷加载后的写入强制完整计算。增加测试与独立测量脚本。

明确没改什么：contentIdentity/contentIdentities、runtimeEnvironment（读 30 秒）的方法文本均不改；RuleEngine.validationEnvironment 的实现和完整指纹取值/校验缓存键不改；不改响应 JSON、状态码、规则输入、版本号、回执、持久化格式、标准答案和 UI。不做候选改法 2、B2b 或其他任务；B2c 仅登记为可选未排期。

兼容性：将核对四份标准答案的 Buffer.equals 和 SHA-256，保持旧题库/旧状态/冻结历史的既有用例；冷加载、导入继续调用全量校验。完整指纹仍为原算法的返回值，哨兵不参与指纹/缓存键组合。

新保证的正式说明见 [ENVIRONMENT_FRESHNESS.md](../../../reference/ENVIRONMENT_FRESHNESS.md)：七哨兵身份变化下一次写立即计算新值，非哨兵依赖变化最多延后到 10 分钟到期后的下一次写；前置读 30 秒到期等完整检查也会更早发现变化。没有改变路径/规则执行权限及信任边界。

### 实现细节与触发

- 哨兵为 process.execPath、server/rules-runner.cjs、五个依赖各自 package.json；以原 fileIdentity/checkedStat/statIdentity 获取 dev/ino/size/mtimeNs/ctimeNs/birthtimeNs，保留符号链接与 canonical-path 拒绝，每次暖写七个 lstat，不扫描依赖目录。
- 完整计算时先清除写缓存，再在原 validationEnvironment 前后各采集一次哨兵；只有成功值、哨兵一致、invalidate 代际一致才登记成功。unavailable 或哨兵读取失败不授权复用；哨兵变化中断快照也不将旧值登记给下次写。完整结果的处理语义与原来相同。
- 以完整计算开始时刻为基准，age≤600000 ms 且哨兵相同才复用；age>600000 或时钟回退立即完整计算。Library.now 可注入，测试不等待。命中写缓存不会刷新读 recentEnvironment.at。
- 为严格覆盖“冷加载之后第一次写也完整计算”，每次新的 collection 实际加载成功都会标记下一次写必须完整计算；不是只借用冷读刚算出的值。完成这次必要检查后，后续暖写才检查七个哨兵。必要完整检查和窗口到期样本与真正暖写分开报告，不藏掉首写尖峰。
- 原 environmentPending 保留并发合并；写缓存的 generation 防止 invalidate 期间进行中的完整计算重新发布旧成功值。没有增加规则/业务请求重试。

### 旧断言与新保证对照

| 原断言 | 新断言 | 对应保证 |
|---|---|---|
| 将 validationEnvironment 桩换成新字符串后，下一次写立即得到不同 collection | 不改七个哨兵、未过期时复用原 collection；注入 600001 ms 后第一次写重新计算并得到不同 collection；原 display settings/closed-library 断言保留 | 非哨兵变化允许在 10 分钟窗口内延后感知；不再把任意换桩当作哨兵变化 |
| 上条间接代表所有运行环境变化 | 三个独立真实文件测试分别修改测试 Node 文件、runner、依赖 package.json：下一次 Library.writeCollection 返回重载结果，缓存环境与真实全量值一致且不同于旧值 | 七哨兵身份变化立即完整计算，本次写使用新环境 |
| 无十分钟边界用例 | 非哨兵 index.js 原地修改，在 599999、600000、600001 ms 三个独立用例分别验证复用/复用/重算 | 时限精确定义和两侧边界，不使用真实等待 |
| content/extension 外部修改后下一次写重载/拒绝 | 原用例及其断言文本保持原样 | 题库与拓展即时变更检查不受哨兵窗口影响 |

### 新增用例与首次失败证据

在任何实现改动前，先新增真实 RuleEngine 的暖写绑定计数用例；未优化基线运行失败：1 项、0 通过、1 失败，`a warm write must not recompute the complete environment`，全量调用 3≠2（2805.1981 ms）。最终用例区分必须完整计算的冷加载后首写与之后的暖写，暖写断言无依赖目录访问、哨兵 stat 为 1..7，完整计算次数不增加。基线测量同时已记录每写五次依赖 walkEntries。

新增 write-environment.test.mjs 以测试自有小型运行环境走原 RuleEngine.validationEnvironment 的真实遍历/内容哈希（不修改安装 Node、runner 或真实 node_modules）；Library 集成使用真实规则引擎执行题型，仅将环境计算绑定到这份隔离安装并注入时间/Node 测试路径。覆盖：

- 默认哨兵精确七项和 process.execPath；Node/runner/package.json 三种身份变化后真实 Library 写立即换环境。
- 非哨兵原地更改与 599999/600000/600001 三个边界；暖写不延长读 30 秒 TTL。
- 显式 invalidate、真实冷加载、真实题库包导入后的第一次写完整计算。
- unavailable 不复用及恢复原指纹；缺失哨兵不建立成功缓存；重定向父目录受检拒绝。
- 完整计算中哨兵改变、进行中 invalidate、时钟回退、强制首写不会错误发布或延长缓存。

现阶段专项：`node --test core/server/host/extensions/write-environment.test.mjs core/server/host/library/library.test.mjs`，**42 项、42 通过、0 失败、0 跳过**，21474.3147 ms。含未修改的外部内容/拓展变化用例，读 30 秒行为通过。其余验证和正式性能结果将在下节补充。

### 三轮 v2 性能与到期写入

机器同测量阶段：Windows 11 Pro 10.0.26200，i5-13500H，Node v24.13.0；同一份 5,002,406 字节 v2 种子（200 题/3 题型/2 轮历史），种子 SHA-256 前后不变。三轮均为本机回环、完全串行；没有与本任务的测试或构建并行运行。独立脚本只处理生成副本，关闭进程/端口并核对父目录后删除自己的 mkdtemp。

新增 measure-sentinel-perf.mjs 原样沿用主序列：open → switch 20 → draft 20 → whiteboard 20 → submit 10，随后每轮另做 10 次过期 draft。plain 完全无钩子；diagnostic 使用隔离加载钩子，加入 Library.writeEnvironment/WriteEnvironment 的函数与文件计数。P→D / D→P / P→D，共每操作 60/60/30 个主写样本以及每模式 30 个到期样本。首写必须完整计算的三个尖峰全部纳入主表，没有删除离群值。

为单独观察写窗口，诊断实验的 Library.now 在主序列固定为 0，过期样本每次增加 600001 ms；只注入这个测试实例，不改变生产时间和读路径代码。这避免将零散的 30 秒读 TTL 刷新混入主暖写表；实际应用中读 TTL 仍会触发完整检查，不能将主表 P95 当成所有实际写入的上界。同期旧实现对照用原 measure-perf.mjs、原始真实时钟，读取只读旧检出（生产树与合并基线 91c73ce 相同），覆盖另外 60/60/30 次操作；其每次写都完整计算，持续刷新读环境时间。原 B2a 的诊断表只测了 draft，白板/提交没有编造旧诊断数据。

```powershell
node core/scripts/dev/measure-sentinel-perf.mjs C:\dev\quizforge-web-refactor-a1\.temp\a1\seed-v2 .temp/b2a-sentinels/results.json 20 3
node core/scripts/dev/measure-perf.mjs C:\dev\quizforge-web-refactor-a1\.temp\a1\seed-v2 3 on C:\dev\quizforge-web-refactor-b2a\core\server\host\http\server.js > .temp/b2a-sentinels/baseline.json
```

library 耗时，单位 ms，均为中位数 / P95：

| 动作 | n/模式 | 原 B2a 诊断基线 | 同期旧实现（无钩子） | 新实现（无钩子） | 新实现（诊断） | 新 environment 互斥部分（诊断） |
| --- | --- | --- | --- | --- | --- | --- |
| draft | 60 | 173.289 / 466.046 | 143.798 / 256.812 | 33.082 / 64.005 | 37.839 / 144.494 | 1.295 / 6.312 |
| whiteboard | 60 | 原报告未测 | 137.409 / 248.782 | 31.166 / 52.657 | 36.335 / 62.020 | 1.248 / 2.513 |
| submit | 30 | 原报告未测 | 125.041 / 293.728 | 27.313 / 84.431 | 33.077 / 147.261 | 1.194 / 5.147 |

三个主写动作的新实现无钩子 library 中位数均 <50 ms。各轮也均达标：

| 轮次 | draft library | whiteboard library | submit library |
| --- | --- | --- | --- |
| 1 | 32.537 / 64.005 | 33.114 / 52.657 | 26.433 / 84.431 |
| 2 | 32.951 / 52.733 | 28.599 / 35.470 | 22.099 / 28.615 |
| 3 | 35.716 / 54.393 | 31.418 / 42.042 | 36.277 / 115.874 |

environment 是包含子调用的区间并集：包括完整 Library.environment 或新 Library.writeEnvironment；不重复相加其嵌套区间。写检查与哨兵读取细分如下（全主序列，保留首写尖峰，n 同主表）：

| 动作 | writeEnvironment ms | sentinels ms | 哨兵 stat 中位/P95 | 依赖 walkEntries 中位/P95 |
| --- | --- | --- | --- | --- |
| draft | 1.295 / 6.312 | 1.258 / 4.275 | 7 / 7 | 0 / 0 |
| whiteboard | 1.248 / 2.513 | 1.228 / 2.396 | 7 / 7 | 0 / 0 |
| submit | 1.194 / 5.147 | 1.172 / 5.092 | 7 / 7 | 0 / 0 |

逐样本计数断言：全部 **147 个真正暖写**（57 draft + 60 whiteboard + 30 submit）均为依赖 walkEntries=0、哨兵 stat=7、sentinels 调用=1。三个冷加载后首写为必要全量，不称为暖写；其无钩子 library 分别为 143.939 / 187.283 / 135.217 ms（n=3）。没有通过取消这些检查来达标。

#### 窗口到期后的第一次 HTTP 写

每轮追加的十个过期样本，逐次跨过十分钟窗口；无真实等待，不改题库内容，每个请求只做一次正常 draft。所有 30 个诊断样本都断言完整 environment=1、依赖 walkEntries=5：

| 模式 | n | 客户端中位数/P95 ms | library 中位数/P95 ms | 完整环境及哨兵的 environment 部分 ms |
| --- | --- | --- | --- | --- |
| plain | 30 | 534.302 / 762.029 | 129.267 / 299.755 | 未插桩，不估算 |
| diagnostic | 30 | 593.122 / 774.759 | 155.037 / 258.982 | 115.595 / 194.151 |

到期后 HTTP 请求的前置 readCollection 也已经超过原有 30 秒读 TTL，因此这一次全量计算实际从读检查进入；写检查随后复用这个刚完成的成功结果。这是保留原读路径后的真实 HTTP 调用链，不把它伪装为 WriteEnvironment.get 内部独立计时。其 writeEnvironment 自身中位数/P95为 1.307 / 2.258 ms；完整 Library.environment 为 114.454 / 192.545 ms。直接写入口超过十分钟触发 full 的语义另由三个真实文件/注入时钟集成用例验证。

这说明定期完整检查仍会让单次写回到全量扫描量级，不能声称每次写都低于 50 ms。完整计算前后各检查 7 个哨兵；到期 HTTP 样本连同随后暖写的 7 次，共 21 次哨兵 stat，属于必要全量样本，不混作“暖路径 ≤7”。

诊断相对无钩子主序列的 library 中位数观测增量为 draft 4.757 ms、whiteboard 5.169 ms、submit 5.764 ms。和原测量相同，这是有调度/文件系统波动的独立执行差，不当作可精确扣除的纯插桩成本。总客户端耗时仍包含现有规则/状态持久化，未将 library 的达标误称为总响应 <50 ms。

完整数字、逐请求时长和计数见 [B2a-sentinel-data.json](B2a-sentinel-data.json)（617999 字节，SHA-256 ee3ecf3fa58151f988e3e473b76a3eb447b789297d4d112de7fa1c4de913bf65）；原 B2a-data.json 不改。新证据包含旧对照和新实现的 summary/samples、原始输出哈希与生产文件哈希，不含题目正文或答案。

### 四份标准答案与最终本机检查

四份 fixture 未更改，磁盘和内存模式均通过 Buffer.equals；原场景与第二 AI 历史场景也未改动：

| fixture | SHA-256 |
| --- | --- |
| state-golden-d3505cf.json | 07849dbea421df2de8d9034522151018295a2615bafd21b2702be94b3889ef50 |
| state-golden-memory-d3505cf.json | 698b1e5fb38c6a28e09b588da4b761b86f777175c548902913fed8b2baac97ac |
| history-ai-disk-d3505cf.json | ec4bce06913a99f1fc7629c1ed437d7ecd49e0b203aec0cfc0da6d07ecc1c292 |
| history-ai-memory-d3505cf.json | 35ca3dfabf1ca5643b0148c19f9fc9bd1e0d16390a04f971110acf1a551803f7 |

- 专项：node --test core/server/host/extensions/write-environment.test.mjs core/server/host/library/library.test.mjs core/server/host/library/import-validation.test.mjs core/server/host/platform/file-cache.test.mjs core/test/practice/state-golden.test.mjs core/test/practice/history-ai-golden.test.mjs，**62 项、62 通过、0 失败、0 跳过**（42712.2614 ms）。补充的同字节哨兵替换用例确认身份变动会重算但指纹不变；冷加载校验缓存用例确认键和文件字节相同、validateBank/outlineBatch 为 0。
- npm --prefix core run test:perf：**3 项、3 通过、0 失败、0 跳过**（50973.3911 ms）。增加真实 HTTP 暖 draft 子用例，除成功保存合法答案外，直接断言完整环境调用 0、依赖目录访问 0、七哨兵 lstat=7；原性能夹具与断言保留。
- npm --prefix core run typecheck:ui：退出 0；npm --prefix core run build:ui -- --check：退出 0，源码、构建产物和许可证一致。
- runtimeEnvironment、contentIdentity/contentIdentities 文本与合并基线相同；RuleEngine.validationEnvironment、ValidationCache 和缓存键表达式未改。没有更新任一标准答案。
- 不重跑已知本机凭据 ACL 的整套失败作为伪“全绿”；完整默认套件以随后干净 CI 的两个系统结果为准，没有跳过/删除/放宽测试。

### 本实现 PR 的 CI 与交付

| 文件 | 本次改动 |
|---|---|
| core/server/host/extensions/write-environment.js | 独立写缓存、七哨兵、完整计算快照、十分钟边界与失效代际 |
| core/server/host/library/library.js | 完整计算登记；写检查新入口；冷加载首写、invalidate/close 清理；内容检查与读方法不改 |
| core/server/host/extensions/write-environment.test.mjs | 19 项真实隔离文件/Library 集成测试，含指纹与校验缓存键不变 |
| core/server/host/library/library.test.mjs | 允许改写的一条旧运行环境断言；新增暖写绑定计数，现有内容/拓展变更用例不动 |
| core/test/performance/perf-fixture.test.mjs | 保留原断言并加真实暖 HTTP draft 子用例，计数完整扫描与七哨兵 |
| core/scripts/dev/measure-library-perf.mjs | 仅导出共用 metrics、允许其包含写哨兵区间，以及避免作为模块导入时执行 CLI；原主测量序列不改 |
| core/scripts/dev/measure-sentinel-perf.mjs | 独立三轮对照和注入过期 HTTP 写，逐样本校验计数 |
| core/docs/reference/ENVIRONMENT_FRESHNESS.md | 新旧感知保证、边界、受检路径、指纹及读策略说明 |
| core/docs/design/reviews/B2a.md / B2a-sentinel-data.json | 本次全部审查记录和可由 git 重算的数字证据；旧 B2a-data.json 不改 |
| core/docs/design/ARCHITECTURE_REFACTOR_PLAN.md | B2a 新验收与保证引用，测量 #46 已合并；B2c 只登记可选未排期 |

本实现为非草稿 **PR #47**，实施提交 `20a8e5485b6a03a34d0412d7ba8a036043e9a500`，CI 运行 **42948328879**。按每个 job 原始日志与 API 起止时间核对，完整结果直接保存在本文件；CI 配置不改，仍为 Node 24、npm ci --ignore-scripts、类型检查、构建一致性检查及完整默认套件，另有独立 perf job。

| job / ID | 结果 | 总用例 | 通过 | 失败 | 跳过 | job 墙钟秒 | 测试秒 |
|---|---|---:|---:|---:|---:|---:|---:|
| Checks (windows-latest) / 130286402898 | success | 1233 | 1233 | 0 | 0 | 207 | 173.594054 |
| Checks (ubuntu-latest) / 130286402419 | success | 1233 | 1199 | 0 | 34 | 105 | 92.423643376 |
| Performance (ubuntu-latest) / 130286402888 | success | 3 | 3 | 0 | 0 | 30 | 17.558857279 |

失败完整名单：**Windows 空；Ubuntu 空；Performance 空**。相对测量 PR 的 1213 项，默认套件增加 19 项隔离环境用例和 1 项暖绑定计数，原用例均保留；perf 增加 1 个真实 HTTP 暖 draft 子用例。Ubuntu 的原有 34 个平台跳过不变，不新增跳过，不加重试、延长超时或放宽断言。

此后提交仅补充本审查记录和进度表，不再改实现、测试、测量脚本或数字证据。PR 描述与本文件同步。**B2c 仅为可选未排期登记；不实现 POST 顺序调整、不开始 B2b 或其他任务。本实现 #47 保持开放，等待审查，不自行合并。**
