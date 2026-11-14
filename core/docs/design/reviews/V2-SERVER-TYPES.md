# E②：后端 JS 严格类型检查

**状态：实现待审查，未合并。** #143 已审查合并；基于 `d0d5e6a`，目标分支 `v2`。文件读写层、业务层、请求层分别提交为 `da90642`、`5434420`、`e0c573f`，不开始 F。

**改了什么 / 文件清单。** `tsconfig.server-v2.json` 开启 `allowJs/checkJs/strict/noEmit`、NodeNext、`skipLibCheck:false`；`package.json` 新增 `typecheck:server`，两系统 Checks 执行并保留失败日志。新增开发类型包 `@types/node@24.19.2`、`@types/express@5.0.6` 及锁文件。实际检查 `controllers` 1、`services` 8、`repositories` 9 个 JS 模块：请求和解析结果先为 unknown，既有检查标注成守卫/断言函数，方法出口引用共享 DTO。`types/{data,http}.d.ts` 只放快照、缓存、Express 上下文等后端内部定义，不复制共享字段。六个 utils 声明与三个旧 `host/platform` 声明只描述实际调用边界，不检查其 JS 实现、不遮蔽上述 18 个真实模块。eslint 支持声明中的合法重载并仍拒绝重复变量；分层规则只允许到中立 types 目录的纯类型引用，运行时/反向越层仍拒绝。

**明确没改什么 / 兼容性。** 未改接口路径、响应 JSON、状态码、规则输入、版本号、回执、持久化格式、数字字面量、冻结、原子写入、保存/锁定/重做、solution 发送条件、沙箱、启动行为或题库内容；无新运行时依赖、检查、缓存、重试、超时。旧工具 JS、前端和共享传输声明均无差异，UI 构建与基线逐字节相同（blob `8ec057c07451d17eea7ae70afa5896dfc82c4122`）。去除注释/括号并规范对象缩写后的 AST 对比：V2 32 个原 JS 文件中 30 个完全一致；另两个仅 `manifestType` 用同一 input 的本地别名保留守卫、`validateResult` 用同一 result.parts 的本地别名保留闭包缩窄，检查顺序和被读对象不变。

**类型断言清单（80 处）。** 以下路径均相对 `core/server/v2/`；行号对应实施提交。无 any、双重断言、忽略标记或关闭严格检查。断言不代表新增运行时验证；可由既有守卫证明的输入均沿用守卫。D46 未验证的展示数据仍为 unknown，属性探测、正则/属性键的 JS 隐式转换不伪装成数据已通过检查。

| 文件 | 行号（数量） | 必要依据 |
|---|---|---|
| services/bank-open.service.js | 133,155,156,225（4） | open 已设置 activeCleared；属性探测后 typeof；起始题分支已处理无效 ID |
| services/bank.service.js | 104,105,111,127,128,158,179,232,234,249,251,264,269（13） | 位置/起始题过滤；非空 LRU/has 后 get；先 bindStore；snapshotId 只作属性探测；题目已在索引 |
| services/practice-actions.service.js | 25,81,121,128,131（5） | reconcile 后当前状态；题目已存在；answer 投影及可选 status 补丁保留旧字段；原异常 message |
| services/practice-completion.service.js | 21,68,88,142,153,165,167,168,177,179,180（11） | reconcile/索引约定；候选状态补丁；questionId 属性探测；已校验请求 ID；原异常字段 |
| services/practice-result.service.js | 57（1） | 原有限分数判断中的比较上界，不新增值转换 |
| services/practice.service.js | 112,133,141（3） | 已检查的索引条目和满分；reconcile 后当前状态 |
| services/question.service.js | 26,29,30,32,33,142,144,146,157,158,159,178,185,188（14） | 正则/type 既有解析与 resolution；snapshot 已匹配；索引/存储已建立；原异常字段及属性探测 |
| repositories/bank.repository.js | 35,36,37,44,57,66,76,77,116（9） | 未验证元信息的可选属性/键/正则探测；原 outline 检查后描述读取结果；question/solution 的原循环已检查对象 |
| repositories/catalog.repository.js | 58,89（2） | 标题仅属性探测；分组在前一分支已加入 Map |
| repositories/extension.repository.js | 36,77,108,128,179,275（6） | manifest 属性探测及既有身份/入口检查；非空 LRU、Map 已赋值；SDK 项已逐项检查 |
| repositories/ink.repository.js | 35,160,162（3） | 原 Number 比较、完整笔迹守卫、原异常 code |
| repositories/outline.repository.js | 113（1） | 原有逐字段大纲检查完成后的记录 |
| repositories/resource.repository.js | 14（1） | relativePath 已检查此输入，返回规范路径不能同时让 TS 缩窄调用方 |
| repositories/shared-sdks.repository.js | 39,40（2） | 原 catch 的 code/message 属性读取，无新增 instanceof 或兜底 |
| repositories/state-shape.repository.js | 57,59（2） | 原状态枚举成员判断，不声称在判断前已合法 |
| repositories/state.repository.js | 51,55,65（3） | 同步 Map.has/插入后的 get；其间无 await |

**新增用例与检查。** `server-types.test.mjs` 两项：编译器必须检查真实三层 JS、严格选项不被关闭/同名声明不遮蔽；11 个负例各只允许一个指定诊断码，覆盖 unknown、状态/评分守卫、opaque solution、HTTP 输入/输出、满分 Map、状态断言、错误码拼写、SDK 数组参数、笔迹精简答复。`fixtures/server-types.mjs` 仅作编译输入。`code-quality.test.mjs` 新增一项检查纯类型分层及重载，既有断言保留。校准负例时修正了编译器当前目录和 JSDoc 绑定位置，避免把找不到依赖/隐式 any 误当预期错误；没有放宽诊断数量或错误码。

**本机验证。** Windows 11、Node 24.13.0；类型检查（后端/UI）、UI 构建、格式、lint 通过（0 错误、36 条既有大小警告）。V2 完整回归 179/0/0，57.81 s（通过/失败/跳过）；其中类型反例 2/0，质量用例 8/0；服务相关独立回归 41/0。性能回归 2/0（4.35 s）；十个既有 Chrome 探针全部通过（桌面/手机尺寸）。只用合成夹具和隔离回环服务，无真实题库、部署、打包或日常服务重启；Chrome 尺寸测试不等于真实手机验收。本机未重复跑旧 V1 完整套件，其全量结果以两个系统 CI 实跑为准；不沿用 #143 的本机失败名单当作本次结果。本任务不做性能优化，不声称耗时收益。

**CI。** 提审后记录五个 job 的实际结果、耗时与失败名单；未运行不记为通过。

**存疑 / 后续。** #143 指出的 health `phase:"segment-1"`：除 health 输出及其静态类型约束外，未找到后端或前端的业务读取依赖；本 PR 保留，由审查者决定是否删除。`saving.ts` 三处 kind/请求答复关联断言留 F，用可辨识联合收口，本 PR 不改。
