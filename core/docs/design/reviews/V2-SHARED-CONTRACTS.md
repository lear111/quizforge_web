# E①：共享数据声明与前端引用

**状态：实现待审查，未合并。** #142 方案已审查合并；本 PR 只做第①步，第②步后端 JSDoc / checkJs 尚未开始。基于 `64b4047`，目标分支 `v2`。

**改了什么 / 文件清单。** 新增 `shared/v2/{json,bank,state,api}.d.ts`：作答、评分、回执、大纲、已实现接口的请求/答复只维护共享定义。`state.d.ts` 文件头明确题型内容不透明、分数/小题分数/大纲状态由宿主理解；`question/solution/answer` 为 unknown，score/parts/status 为精确类型，message 的内容不作解释。`api.d.ts` 的错误码联合与当前后端实际发出的 34 个码一一对应；前端分支和恢复列表用 satisfies 引用它，拼写错误编译失败。

前端 `v2/api/{banks,catalog,client,extensions,questions,requests}.ts`、`services/{outline,grading,scoring,completion,save-policy}.ts`、`stores/practice/{saving,recovery}.ts`、`types/practice-types.ts` 改引用。笔迹保存答复改为真实的精简对象，普通单题写答复允许省略笔迹，GET / retry 明确带笔迹。沿用的 `outline/model.ts` 仅把两个展示字段改为 unknown，对应 D46 不检查展示元信息的现状，不新增默认值或断言。新增 `test/v2/shared-contracts.test.mjs` 与其 TS 夹具；eslint 为该 TS 夹具启用既有 TS 解析器，无规则放宽。

**明确没改什么。** 不改后端、接口字段/路径/状态码、JSON 序列化、规则输入、版本号、回执、持久化格式、数字字面量、保存/锁定/重做、solution 发送条件、沙箱、启动行为或题库内容；无新依赖、运行时检查、重试或超时。不开始 F、打包、部署或重启日常服务。重新构建的 UI 成品与基线逐字节相同（Git blob `8ec057c07451d17eea7ae70afa5896dfc82c4122`），无成品差异。

**静态断言清单。** 新增 6 处，其中 3 个非空断言；没有双重断言、any、忽略错误或关闭严格模式。它们仅补编译器无法关联的调用流程，不声称验证外来数据。既有后端检查不动；第②步再按审查要求把它们标成守卫/断言函数。

| 文件与位置 | 数量 | 依据 |
|---|---:|---|
| `api/questions.ts:44,62`，`inkRevision!` / `submissionId!` | 2 | 活动页从含笔迹的 GET 建立，精简更新保留笔迹版本；评分入口只处理已锁定答案 |
| `services/completion.ts:54`，`submissionId!` | 1 | pendingGrading 是后端筛出的已锁定、未评分题 |
| `stores/practice/saving.ts:52`，fields → AnswerRequest 字段 | 1 | read 只构造空 fields 或完整 answer/answered；原 Object.keys 判断后才排入答案保存 |
| 同文件 `:64,67`，saved → InkResponse / QuestionResponse | 2 | 原 kind 分支与排队的 answer/ink 请求一一对应；精简响应不能被当完整题使用 |

**与说明书的差异（交审查者处理，未改设计或行为）。** 数据结构第 2 节写 `practice/state.json`，实际仍为 `.qf-v2/state.json`，迁移已排任务 J；第 2 节允许带分数评语，当前 validResultShape 在 score 为数字时只接受 message:null，共享类型按实际实现收紧（该功能排第 5 段）；D46 不验证并会转发标题、编号、听力元信息等，缺省标题/编号也没有被接口补成空字符串；未检查的字段用 unknown，不能谎称已是字符串，题号/满分仍精确。BankFile 声明不代表未知解析结果已经通过检查，后端不得据此跳过缩窄。

**验证与兼容性。** 新增 3 项测试：有效请求/作答/题库与 API 返回类型；14 种无效赋值必须得到编译错误（无忽略标记）；错误码联合与后端 AST 清单完全一致。负例注入处理了 Windows 路径分隔符差异，并断言确实注入，未放宽预期。原测试断言全部保留。本机 Windows 11、Node 24.13.0；只运行合成夹具与回环服务，不使用真实题库。不做性能优化，不把并行检查时的性能读数当对比。

**检查结果。** UI 类型检查、构建、格式和 lint 通过（0 错误、36 条既有大小警告）；契约 3/0、性能 2/0。本机完整测试 1423 通过 / 13 失败 / 1 超时（1039.26 s）：hub-connection 6、settings-provider 2、http/server 1，涉及凭据/登录；rule-engine 1 涉及进程排队；library-export-images 2 为 rename EPERM；windows-tray 导入 1 为 Request could not be completed，EXE 生命周期 1 超时。后端与构建成品无差异，不据此调整测试或旧实现，也不把本机完整套件记为通过。十个 Chrome 浏览器探针全部通过（脚本覆盖桌面/手机尺寸，非真机）；实现提交 `d5cd547` 的[运行 43617526510](https://github.com/lear111/quizforge_web/actions/runs/43617526510) 五项全绿，失败名单为空。Ubuntu 的 34 项跳过是既有 Windows 专项。本次只补记录，推送后再核对最终提交。


| CI Job | 通过 / 失败 / 跳过 | Job 总耗时 |
|---|---|---|
| Checks · Windows | 1437 / 0 / 0；UI 类型与构建通过 | 183 s |
| Checks · Ubuntu | 1403 / 0 / 34；UI 类型与构建通过 | 121 s |
| Performance · Ubuntu | 2 / 0 / 0 | 17 s |
| V2 code quality · Ubuntu | 格式 147 文件无差异；lint 144 文件，0 错误、36 警告 | 30 s |
| V2 browser checks · Ubuntu | 十个既有探针全部通过 | 166 s |
