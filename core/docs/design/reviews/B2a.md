# B2a：写路径 library 耗时诊断（仅测量，等待审查）

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
- [测量脚本](../../../scripts/dev/measure-library-perf.mjs) 复用原 measure-perf 的 Server-Timing 解析/中位数/nearest-rank P95 以及 create-perf-fixture 的合法答案构造，不修改它们。客户端读完整响应后取耗时，library 总值使用原 Server-Timing，而不是自定义总时钟。
- [隔离钩子](../../../scripts/dev/library-diagnostic-hooks.mjs) 用 Node 的同步 registerHooks，仅在本诊断子进程内改写 5 个模块的加载源码，给原函数加无值变化的包裹；不写回生产文件。库、索引、引擎和 FileCache 原型也仅在该进程包裹。无生产开关、无环境变量开关，应用从不导入这些脚本。
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

整个 draft 的两个根绑定区间合计 **799 次显式 stat API 调用（723 次文件、74 次目录、2 次失败）**，716 次 native realpath；遍历 64 个不同目录，实际 readdir 访问 67 次。失败检查是两个 content 检查中的 assets 不存在探测（正常 ENOENT），不是业务失败。文件内容哈希只发生 1 次，路径为 server/rules-runner.cjs。

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
- CI 三个 job 的结果、耗时和失败名单：待运行后填写。
- 测量完成后推送独立 PR，等待审查；不合并、不改实现、不开始 B2b 或其他任务卡。
