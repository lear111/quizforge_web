# F⑧：后端类型断言与 health 字段清理

**状态：[#167](https://github.com/lear111/quizforge_web/pull/167) 已完成代码审查（Review #5911430977），最新 CI 五项全绿，经负责人既定授权于 2026-11-15 合并到 `v2`（squash `4fb5a9b`）；F⑨/I② 尚未开工。** 基于最新 `v2` 的 `ffd9e9d`，分支 `refactor/v2-server-assertions`；依据 [#149 审查](https://github.com/lear111/quizforge_web/pull/149#issuecomment-6882626969)、工作流程分层、接口速查的 unknown 输入/锁定边界、数据结构当前作答与只读约定。只做本任务；不改 `V2_PROGRESS.md`，不开始 F⑨/I②。

**统计口径与结果：80 → 29（达到 <30）。** 开工前按 E② 的 controllers/services/repositories 共 18 个 JS 模块实测 80。TypeScript AST 只计带 JSDoc `@type` 的括号表达式，不计变量注解、`@typedef`、参数/返回类型、类型守卫或 `@satisfies`。原 18 模块现为 27；新属性读取工具另有 2，**纳入总数而非移出统计**，合计 19 个严格检查模块、29 处。可运行 `node core/scripts/dev/count-v2-type-assertions.mjs` 重现总数、逐文件位置、类型与表达式；计数器用例检查嵌套断言及声明排除，并约束总数 <30。无 any、双重断言、忽略标记或降级配置；strict/checkJs/skipLibCheck:false 原样，配置仅把新工具纳入检查。

以下路径相对 `core/server/v2/`；行号对应本次实现，逐项说明全部剩余断言。未列行号的文件已无强制断言。

| 文件 | 前 → 后 | 剩余位置与保留依据 |
|---|---|---|
| controllers/http.controller.js | 0 → 0 | 仅删除已批准的 health.phase；HTTP input 仍是 unknown |
| services/bank-open.service.js | 4 → 0 | 活动快照用同对象的已赋值字段推导；起始题按原分支收窄 |
| services/bank.service.js | 13 → 3 | 172：open 已登记快照的缓存契约，保留原缺失行为；273/278：只读状态的题项/满分索引契约，不新增缺失键错误 |
| services/practice-actions.service.js | 5 → 3 | 25：reconcile 后的当前记录，保留旧状态/错误顺序；81：已验证题号的索引；126：原异常 message，不改捕获范围 |
| services/practice-completion.service.js | 11 → 5 | 22/62：原当前记录前置条件，不加迁移/检查；174/188：原回执/评分异常 context 写入；184：已验证批次题号的索引 |
| services/practice-result.service.js | 1 → 0 | 数值上界允许 undefined，原比较在 undefined 时必为 false；其他 JS 比较转换保留 |
| services/practice.service.js | 3 → 2 | 112/133：题项/满分索引契约；total 改用真实 LoadedState，不把旧记录当成已验证当前题目 |
| services/question.service.js | 14 → 5 | 27：原 Map 键域探测，未添加 typeof 拒绝；31：单题 resolve 必有条目；141：成功解析后的 type；143：已验证题号；154：原异常 context，保留原重抛对象 |
| services/resource.service.js | 0 → 0 | 未改 |
| repositories/bank.repository.js | 9 → 3 | 41：正则原有 JS 字符串转换；54：解析元信息的读取边界；63：已由 outlineIndex 校验但须保留原 raw 对象/数字元数据 |
| repositories/catalog.repository.js | 2 → 0 | 元信息读取返回 unknown，字段 typeof 检查保留；分组 Map 读取收窄 |
| repositories/extension.repository.js | 6 → 1 | 195：artifactFiles/manifestSdks 跨函数验证后的完整 manifest，保留原对象与检查顺序 |
| repositories/ink.repository.js | 3 → 2 | 156：两阶段笔迹/回执验证后的原对象；158：原 catch.code，不增加 instanceof/兜底 |
| repositories/outline.repository.js | 1 → 1 | 113：逐字段检查后保留原题项与未验证展示元信息，不重建对象 |
| repositories/resource.repository.js | 1 → 1 | 14：relativePath 已验证输入；不改路径安全检查及其错误顺序 |
| repositories/shared-sdks.repository.js | 2 → 1 | 39：原 catch 的 code/Error 值，用单个别名保留，不改变重抛行为 |
| repositories/state-shape.repository.js | 2 → 0 | 枚举数组按 readonly unknown[] 做原 includes 比较，没有宣称外部 status 已通过检查 |
| repositories/state.repository.js | 3 → 0 | 读取结果按 undefined 收窄，冷读/身份匹配/回源逻辑保留 |
| utils/properties.js（新增） | 0 → 2 | 9：仅描述 JS 可选属性读取，返回 unknown；10：保留 ToPropertyKey，支持符号/原始值/对象键及空值短路，不把值验证成 DTO |

**依赖与实现边界。** `createPracticeLibrary` 在构造时注入实际 PracticeState，返回由 Object.assign 推导的非空交集，不用断言。对象仍是同一 LibrarySnapshots 实例，字段/缓存/生命周期不变；V2Server 与 HTTP 写处理使用准确的 PracticeLibrary。原构造函数仍接受不带存储、null 或已带存储的调用；只读打开/题目/总分/空 pending 保留，旧 JS 注入方式仍运行。静态写方法要求带存储的 receiver，新增只读写入/缺失依赖负例；“精确写答复联合”原负例仅把参数改为正确的写实例类型，仍要求原 2339，未删除断言。pending 的已有空存储判断改为局部收窄。

Map 只收窄原本不存 undefined 的图/数组/分组缓存；未命中仍回源，不新增 required 抛错、遍历、TTL 或缓存层；LRU 仅取首项。批次复用本次已校验的不可变题项，无 await 或题库索引重建跨越；缺失题号仍走原检查。文件 JSON/manifest 的重复探测改为局部值；未验证字段仍 unknown。`optionalProperty` 保留装箱、键转换、getter 抛错和 nullish 短路，不做 object/schema 检查。批次请求与 question/solution、SDK 校验只提取原条件为类型守卫，不增删限制。条件补丁分支用真实字段类型与 projectJson/patchJson 保留数字元数据，不改回执/锁/保存/评分顺序。decimalSum 声明改接收 Iterable<unknown>，因为旧实现本来逐值拒绝非数字/非有限值；坏值仍走原 INVALID_RESULT，而非把旧记录强转 CurrentState。

**health 兼容性。** 全仓代码核对没有业务读取 `health.phase`；只删除响应和 `core/shared/v2/api.d.ts` 的 phase，路径、apiVersion:2、availableFeatures 原样。只读接口测试加强为完整对象比较；新增负例禁止继续读取 phase。HEAD 长度随批准的字段删除改变，状态/其他头不变。前端、路由、题型、存储格式、路径/安全检查、配置严格级别均未改；构建成品不提交，不部署/打包/重启日常服务，不使用真实题库。

**验证。** 新增 `server-assertions.test.mjs` 5 项：AST 口径/预算；未知属性装箱/符号/键转换/getter 错误；只读与注入实例、原构造兼容和 1.0 答案/状态补丁/同 ID 重放字节；缓存未命中/暖态/身份命中/逐出；decimalSum 对未知坏值原样拒绝。原 11 项类型负例的指定错误码保留，另加只读写入、缺少注入存储、undefined 缓存值、未知属性、health.phase 共 5 项；新工具也必须作为真实 JS 被严格检查。新增路径范围断言初次遇到 Windows 斜杠差异，已用 path.normalize 修正比较，未跳过或放宽检查。

使用未改动 `ffd9e9d` 本机隔离检出与已有 compare-v2-http 比较 74 个回环请求：仅在测试加载钩子中从基线 health（含编码别名/HEAD）减去 phase 及其 20 字节，其余沿用已有 Date/nonce/计时归一化；其他响应/状态/头字节 **0 差异**，摘要 `8d40bb82dd6e5bbbe9d0572d31474eaacce4609435b909c35fae85793a86269b`。固定原脚本的 UUID/时间后，两端最终 state.json 共 1549 字节 Buffer.equals，组合摘要 `7d03c8feeb749f35d16d7b31197caa7ebd5961391c09d243c6aa19aafa617ac9`；原标准答案未更新，数字字面量保留。原比较脚本不改，诊断钩子/原始合成输出只在忽略目录。

Windows 11 / Node 24.13.0：最终完整 V2 223/0/0（113.13 s，不作性能对比）；相关 20/0；UI/后端类型、lint 200 文件 0 错误/19 既有警告、格式 209 文件无差异、构建和 --check 通过；十个既有 Chrome 探针通过。仅合成数据/隔离回环，视口检查不代表真机。主要风险为缓存值域不含 undefined、快照索引不可变等原不变量；保留了编译器仍不能直接证明的 29 处边界/索引断言，不通过新拒绝、替代默认值或不安全类型规避消除它们。

**CI。** [PR #167](https://github.com/lear111/quizforge_web/pull/167) 实施提交 `8cb974e` 的[运行 43726756143](https://github.com/lear111/quizforge_web/actions/runs/43726756143) 五项全绿，失败名单为空；Ubuntu 34 项跳过为原有 Windows 专项，没有新增跳过/重试/放宽断言。PR 正文与本文同步；此后只补本文，最终提交再核对五项结果，代码和进度页不再改动；不自行合并。

| CI job | 通过 / 失败 / 跳过及结果 | Job 总耗时 |
|---|---|---|
| Checks · Windows | 1484 / 0 / 0；UI/后端类型、构建及一致性通过 | 306 s |
| Checks · Ubuntu | 1450 / 0 / 34；同上 | 128 s |
| Performance · Ubuntu | 2 / 0 / 0 | 15 s |
| V2 code quality · Ubuntu | 格式 209 文件无差异；lint 200 文件，0 错误/19 既有警告 | 30 s |
| V2 browser checks · Ubuntu | 十个既有探针全部通过 | 156 s |
