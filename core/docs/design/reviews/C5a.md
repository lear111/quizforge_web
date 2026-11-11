# C5a：现有宿主中跨题复用 iframe（设计待审查）

任务卡：C5a。状态：**仅设计，未批准实施**。盘点基线：`61edb11`（main，已含 S1 #49、B7a #50）。源码位置均相对仓库根目录；行号以此提交为准。

## 0. 本 PR 的范围与审查摘要

**改了什么**：本文列出现状、复用键、逐题消息代际、加载确认、失败恢复、资源释放、五个内置题型的适配、测试与真实浏览器测量方案；计划中记录 C5a 提前独立设计，并把 B7 标为“导出部分已满足要求，不再继续；导入部分待定”。S1、B7a 状态改为已合并。

**明确没改什么**：没有实现 iframe 复用；没有修改 `app.js`、Bridge、SDK、manifest、后端、规则运行器、HTTP 响应、规则输入、状态码、题库/答案/历史/回执/持久化格式或版本号；不修改四份标准答案。没有 Pinia/Vue 入口迁移，没有 B2b、B7 后续诊断或优化，没有更新安装包、部署或重启服务。

**兼容性验证**：本 PR 只有两份 Markdown，生产与测试文件字节不变。下面的兼容性用例均为实施后的验收计划，不称为已经完成的复用验证。旧拓展、冻结页面继续走原分支，不因宿主支持 1.6 就自动加入复用。

**计时对比**：尚未实现，不报告虚构的前后数值。现有 `pane.node.dataset.loadMs` 只包住 `showQuestion`，不包含前置 `flushPane`；第 6 节给出两个不混淆的测量口径。

**测试**：本 PR 不增加/修改用例；CI 结果在文末记录。实施阶段新增用例见第 5 节。

**未解决或存疑（必须先决定）**：现行后端拒绝 API 1.6，也不向页面传出 manifest 的复用声明。“支持 requiresApi.question-reuse / API 1.6”与本轮“不改后端”不能同时完成产品接入。第 2.3 节明确最小协议登记的文件及另行授权边界；本设计 PR 不以硬编码内置 id、前端自行假定声明、放宽旧校验来绕过。

## 1. 现状盘点

### 1.1 宿主生命周期及闭包

| 位置 | 目前的步骤/捕获 | 复用设计中的处理 |
|---|---|---|
| `core/web/app.js:316` `navigateQuestion` | 历史转 `showHistoryQuestion`；检查单题编辑退出；`await flushPane`；开发题保留/恢复；最后 `showQuestion` | 保留顺序。常规题 `flushPane` 返回 false 也必须阻止跨题复用；开发保留题分支不参与复用 |
| `app.js:140` `flushPane` | 设置 pane inert；await plugin.flush；白板 flush → saveInk → writes.settled；检查失败与 hasUnsavedInput | 这是切题写入屏障，不缩短/跳过。题型 250 ms 防抖、上传及答案状态上报均须先排空；失败保留原输入 |
| `app.js:179` `showQuestion` | loading；读 payload、校验绑定/必要时刷新 descriptor；取 page 和 SDK；建立 candidateHost/plugin；await ready；提交 pane 数据、销毁旧 plugin；加载新 draft/相机；大纲与听力；prefetch；finally 记 loadMs | 保留候选优先的重建分支。只在第 2 节全部满足时，用带确认的 update 分支替代创建候选 frame；数据提交必须晚于新题确认 |
| `app.js:193` onRequest | 闭包捕获 `pane`、本次 `qid`、`candidatePlugin`、`assets`；比较 plugin 身份和 pane.questionId；加载中仅给 resource-get/sdk-editor 只读通路 | 不能把 qid 改成随时读取 pane.questionId。改为绑定 `{paneKey,qid,generation,payload.stamp,assets,plugin}`；每次分发使用不可变绑定，写屏障后撤销旧绑定 |
| 同一行 onLayout/onError | onLayout 捕获 pane；frame 是回调实参；onError 捕获 pane/candidatePlugin，仅当前 plugin 才报错；payload/revision 未直接捕获，靠 pane 间接取得 | 两者都接收/校验绑定代际，异步 onLayout await 后再校验。B 的错误不能显示成 A 的运行错误；旧题晚到布局不能改变新题高度/高级编辑状态 |
| `app.js:97` makeWriteQueue | send 以 enqueue 时 qid 寻址；onSaved 更新 qid 缓存，仅 qid 等于当前题才 update(context)；onFailed 可能 fresh read | 保留按题写队列；跨题提交前排空。异步展示副作用额外检查 plugin/代际/视图和版本戳，旧题结果只进入它自己的缓存 |
| `app.js:168` requestAi | 开始即捕获 qid；client 的 onConfirmed 读取 pane 当前 payload/revision，并可能 plugin.update | 已接受的 AI 操作仍按原 qid 执行；若代际已失效，只更新该题状态/缓存，不给新页发送 context。初版不复用 submitted 来源/目标，进一步缩小风险 |
| `app.js:603` `suspendPane` | 先 flush；保存 scroll；开发保留 runtime 例外；销毁 plugin/白板/观察器；释放 payload 与 collection.states | 不改。换题库仍销毁，不建立跨题库 frame 池；不因复用而保活后台 pane |
| `app.js:613` `activateReady` | suspend 旧 pane、activate 可见性、attachRuntime；刷新描述/题；stamp 不同或无 plugin 则 showQuestion | 保留 fresh read/stamp 检查。恢复被 suspend 的 pane 是冷建，不复用已销毁 frame；同题刷新与跨题复用明确分开 |
| `app.js:601/646/649` | activate 调 setActive；独立单例 listeningPlayer，updateChrome 时 setContext(pane) | 可见性仍按 pane；听力只在成功提交切题后收到新上下文，frame 复用不改变同材料续播/普通题暂停/考试原规则 |
| `app.js:297` prefetchAdjacent | idle 下仅预取邻题 payload/page/SDK；检查当前 pane/qid；真正切题仍条件重验证 stamp | 仍然只预取数据，不提前 update，不创建第二个活动复用页，不跳过 stamp 重新验证；取消旧 idle，不让迟到预取改变绑定 |

`transitionTo` 实际经 `core/web/practice/practice-lifecycle.js` 调 Vue 岛屿导出的 `core/frontend/src/practice/lifecycle.ts`：Promise tail 串行执行，失败后队列恢复；不是 latest-wins。C5a 复用此队列，不迁移 store、不另造并发导航器。

### 1.2 frame / bootstrap / SDK 状态的归属

| 状态及源码 | 今天的作用域 | 跨题处理（仅声明复用的页面） |
|---|---|---|
| `frame.js` session、nonce、sandbox、CSP、srcdoc、bridge、assets/库脚本、appearance 监听器 | iframe 实例 | 保留；source + session 校验不弱化。assets 身份不同即重建，禁止复用时重写 srcdoc |
| `frame.js` dirty/inputDirty/faulted/readyDone、viewContext、normalHeight/expanded | 实例变量，update 现在只重置 dirty，ready 只注册一次 | ready 仍仅首次；跨题新增 update Promise。dirty/inputDirty 只能在旧题屏障成功且旧作用域撤销后归零；faulted 不清零伪装健康，报错即重建。height/expanded 按新题重置/关闭 |
| `frame.js` flushes/documents/drafts/outlineNavigations/captures Map，各自 timer | 实例 | 条目记录 generation/loadId；切题前正常 flush；残留题级请求以 QUESTION_CHANGED 结算并清 timer。编辑器读文档不应出现在可复用分支。迟到响应不结算另一题的请求 |
| `api-v1.js:3–22` hooks/editorHooks、context、closed/inactive、sequence、requests、pending、inputGeneration | 实例；inputGeneration 仅区分输入快照，**不是题目代际** | page 注册与单调 sequence 保留；context 与题目作用域替换。requests/pending 按作用域记录，完成/失败/撤销必须有界；旧 reply 不清新题 inputDirty。不能只把 inputGeneration 当作跨题隔离 |
| `api-v1.js:5/24–26` resourceCache/resourceUrls/resourceBytes | 目前整 iframe；get 去重，累计图片 16 MiB；dispose 才 revoke/clear；put 单图 4 MiB | 每题单独一组；A→B 清 A 的 Promise/URL/计数，B 再从 0 算。旧资源完成不得生成/注册 URL；若完成与撤销竞争，立即 revoke。跨题不保留图片 Promise |
| `api-v1.js:28–63` contentFacade/editorLoading；QFRichText 全局 configure；静态脚本与 editor loader | 实例，同时有题级 view/editor | 相同 SDK 的脚本可保留；每题新建资源绑定 facade，旧 view/editor 先 destroy。render 显式注入题级 resources；createEditor 显式注入 resources/setExpanded，不能依赖可变的全局 configure。仅编辑代码的成功加载可保留；题级 loader Promise/失败不可借给新题 |
| `api-v1.js:73–77` answerAreaService、draftMode；`shared/answer-area/1.4.1/component.js` instances/pending | 一份 provider/service、多答题区，内部有图片/上传队列、epoch、布局 RAF、observer、选择/拖动状态 | 旧题 flush 后 destroy service/instances，再用原 provider 私有工厂为 B 建新 service；不得只 refresh 旧实例，因为 response-part id 可重复。保留工厂私有引用，不在 QF 暴露，不改冻结 SDK 文件 |
| `frame.js` qfSharedAnswerAreas/qfAnswerAreaRegions/qfAnswerAreaFocus/qfInteractiveRegions | frame DOM 扩展字段；白板据此接收共享墨迹、平移和图片控制 | 撤销 A 时清空并抑制新的白板映射；B 加载期间布局只缓存不对外发布。提交 B 时一次发布 B 布局、回灌 B 笔迹；不能把 A 的 rect/document 暂时解释成 B 的答案 |
| `app.js` whiteboard/ink/inkTimer、draftLayoutPending、相机与滚动；pane sizeObserver/worldObserver | pane + 当前题；笔迹事实来自 payload.draft | 白板实例及工具偏好可保留，inkTimer 屏障先清；新题仍 load 它自己的 draft、清 pending buffer、重置/恢复相机和 scroll。草稿/练习模式转换沿用原坐标规则，不缩放改写存储笔迹 |
| `api-v1.js` outlineQueue 与 hooks.onOutlineNavigate | iframe 串行子题导航 | 切题撤销排队/运行中的旧导航结果；新题新 queue。host outlineItemId 清空；同题子题定位不必换代际 |
| `api-v1.js:110/138` visibility、body/root ResizeObserver；appearanceListeners | 实例 | observer/外观订阅每 frame 一份，不能每 onLoad 追加。load 中暂停/丢弃旧 resize，完成后强制新 resize；不可见时维持现有停观测语义 |
| `frame-capture.js` 捕获监听、几何 MutationObserver/ResizeObserver、60 ms timer、last/lastAreas | 目前靠 iframe 销毁释放，独立消息生产者 | 必须一起改为可撤销的题级绑定：取值、排队时捕获 generation，撤销时取消 timer/观测，重置序列化去重值，B 成功后恢复并强制上报。不能只改 api-v1 的 send 而遗漏捕获脚本 |
| 题型 saver 的 250 ms timer、queue/reports，简答 poll/reviewTimer/编辑队列，图片 FileReader/解码 | 题型脚本私有；当前通常靠 reset/onDispose | 第 1.3 节逐个适配；屏障排空、abort + epoch 抑制迟到结果；旧 timer 若仍触发只能拿到已经撤销的 scope，不能调用 B 的接口 |
| `web/listening/listening-player.js` progress/blobs/objectUrl/observer、generation/AbortController | 宿主单例，独立 iframe | 不搬进 frame/不按题清全部音频缓存；沿用其自身取消/配额/URL 生命周期。只用已提交 pane 做 setContext；测试同材料、异材料、普通题、考试原行为不变 |

`frame.destroy()` 今天会 dispose、清共享布局、关闭 expanded、清 host timers/监听和 Map、remove frame；bootstrap dispose destroy 答题区、onDispose、revoke URL、断 observer、结算 requests。复用需要显式题级清理，不能再靠这些“最终销毁”隐式代劳。frame-capture 当前无独立 dispose handle，须在新复用分支补清理入口，旧消息模式保持兼容。

### 1.3 五个内置题型（不是 legacy fixture 副本）

以下源码均为 `extensions/基础题型/<目录>/practice.js`。三类选择题的 saver 与主逻辑基本相同，但逐个测试，不能测单选后代替其他两类。

| 题型 / 当前版本 | 另一题 context 的实际处理 | 仍需的适配 |
|---|---|---|
| 单选题 / 2.0.1 | onLoad 以 mode:id 换 key；epoch++、saver.reset、destroy views；从 next.answer 重建 selected/选项；await view.ready；onDispose 才拆长期事件 | 新题级 scope API；saver 队列/上报/错误与 onBusy 捕获 scope，flush 后才 reset；迟到 render catch 也检查 epoch（目前只有 ready 成功分支检查）；重置 acting/busy；事件只绑一次 |
| 多选题 / 2.0.1 | 同上；selectedOptionIds 恢复多个勾选，不能沿用旧 Set | 同单选；验证 A/B 选项 id 相同、选中集合不同及清空上报，避免残留勾选 |
| 判断题 / 2.0.1 | 同上；value 映射 true/false，选项 DOM 重建 | 同单选；验证 false 与 null 区别，不能用 truthy 恢复丢掉“错误”选项 |
| 简答题 / 2.0.2 | onLoad 换 key 或 submitted 状态切换时 rebuild；清 views/targets/answers/tasks/reviewDrafts/reviewTimers，stopPoll；destroy editor，active=null；重建 parts；onFlush 等 switching/closeEditor/saver/review | switching Promise 必须排空并重新建立，不让旧 activate 打开 B 的 editor；停止 poll 不等于取消已发任务，所有成功/失败/finally 用 scope+epoch；重置 polling/acting/busy/reportedStatus；编辑器上传在 flush 等待，拒绝/失败不离开 A；显式题级富文本资源/布局绑定 |
| 简答题（答题区） / 1.0.4 | 换 key rebuild；saver.reset 带自身 generation，destroy components、views，清所有 Map/reviewTimers、stopPoll；mount sharedInk 答题区并 restoreArea；onFlush 交错 drain 组件及 saver 避免 onChange 死锁 | 题型 saver generation 不能代替 Bridge generation；每个 component/onChange/上传/图片解码必须绑定题级 scope，旧 service 完全 destroy。新同名 response-part 答题区只恢复 B 的 text/images/ink；清图片选择、焦点、deferredInk、拖动/确认/布局状态；poll 同简答题；保留现有防死锁 flush 顺序 |

目前选择题的 onLoad 已支持按 key 重建，不代表所有异步链已能安全跨题。五类现行 manifest 均**未声明** question-reuse；未来应发布新拓展版本并设置 minMinor:6/新增能力，不悄悄给已安装旧包改 manifest/指纹，不迁移旧历史页面。具体新拓展版本号在实现 PR 审查，不在本设计改包。

## 2. 复用判定及 API 边界

### 2.1 保守的 allow-list

复用只从一个正常活动、已 ready、无 pageFailure/faulted/recovering/keepRuntime 的普通 bank 练习页，进入同一 bank 的另一道未提交题。旧题和新题状态都不是 submitted；同一 `pane.key`（含 kind/id）且 pane 未关闭、未 suspend，视图 mode 相同，draftMode 相同。初版排除 development/development-bank/extension example、保留输入页、summary、历史、编辑、考试及 submitted 查看。即使页面声明能力，上述排除仍生效。同题 submit/review/retry/AI 回调的 update 是现有“同题状态刷新”，不据此扩展跨题范围。

必须**全部身份相等**：拓展 id/version/reference path/pageId/typeId、已条件重验证 payload.stamp.packageVersion、API major/minor、已验证的 questionReuseDeclared===true、页面资源身份（见下）、contentApi 全部字段、dependencies 的 id/version 及已取得的 SDK 内容、answerAreaComponent 的 version/script/style、视图 mode。

其中 id/version/packageVersion/API/opt-in/页面内容是必需身份，缺失/未知即冷建。path/pageId/typeId、富文本与答题区则是可选项：按已验证页面契约规范化为明确的“未使用”身份（例如独立题型无 typeId、无 dependencies 表示空依赖、未声明 answer-areas 的选择题没有 answerAreaComponent）。两侧都确认未使用可以相等；单侧使用、声明了却缺资源、或无法确认声明则冷建。不能要求每个选择题都存在答题区组件，也不能把不明原因的 undefined==undefined 当作已证明可复用。

`state-store.js:156` 的 packageVersion 已封装 extension.fingerprint/providerRevision/referencePath；可比较这个已有不透明值，无须新增暴露 raw fingerprint 的响应字段。`extensionMetadata` 常规响应并不直接给 raw fingerprint；仅比较 id/version/path 或 `sameExtension()` 不充分。question revision/contentVersion 是**逐题数据**，不同题自然不同，不能错误要求它们相等；它们由 loadQuestion/写队列保持新鲜，保存仍使用原 renderedContentVersion/乐观并发语义。

页面资源身份拟为 page route key（包含 packageVersion）加准备完毕 assets 的精确内容身份：html/script/style/bodyTag/内联 assets、examActionSelectors、API 声明、dependencies/contentApi/组件与实际库内容。建立一次、缓存随 page cache 失效。优先复用现有不透明键并比较精确序列化值；不能只比 JS 对象引用（缓存会 clone）、长度或弱 hash。避免依赖 LAN HTTP 下可能不存在的 crypto.subtle；不为比较身份引入网络或 SDK 重编译。

### 2.2 候选方式与推荐

1. **直接 update + flush（不采用）**：改动少，但没有完成确认，所有旧异步会在可变 context 上执行；单题资源配额也会错误累计，不能满足本卡。
2. **推荐：现有宿主 + opt-in Bridge 题目作用域 + 确认屏障**：不需要 Pinia；保留现有串行导航和冷建分支，新增严格条件及题级资源清理。复杂度集中在 Bridge，收益以浏览器测量验证。
3. 每题保留 frame 池（不采用）：绕开部分初始化，却放大多页资源/后台 timer 与未保存输入语义；与 suspendPane 的释放策略相反，不是本任务。

这是提交给审查者的推荐，不表述为已经批准实施。

### 2.3 1.6/question-reuse 同步清单与范围矛盾

| 位置 | 实施时最小协议登记 | 本轮状态 |
|---|---|---|
| manifest.requiresApi | 可选 `question-reuse` 需 major1/minMinor≥6；没有声明绝不跨题复用 | 仅设计 |
| `web/bridge/api-bridges.js` | 新增 1.6 bridge/capability；保留 1.0–1.5 选择/字段/消息路径 | 前端实现 PR 才做 |
| `web/bridge/frame.js`、`api-v1.js`、`frame-capture.js` | 仅在能力被主动声明且元数据经宿主确认时启用代际协议/加载确认/题级 facade；同版本但没声明仍走兼容分支 | 前端实现 PR 才做 |
| `server/host/extensions/extension-api.js` | apiVersion、最大 minor、CAPABILITIES、minMinor 检查、history 支持范围需要同步；新页宣告 1.6，旧 frozen apiVersion 不重标 | **后端文件，本轮禁止修改，需先另行批准此最小例外** |
| `server/host/extensions/extension-packages.js` | readExtension 记录验证过的 questionReuseDeclared，snapshotPage 下传 boolean；没有该字段默认 false；developmentContract 同步能力身份 | **同上**；前端目前读不到 manifest 声明，不能凭 API capabilities 推断 opt-in |
| `server/rules-runner.cjs` | 最高 minor 与 QF.api capability 元数据登记同步到 1.6；不增加浏览器方法、不改规则输入/评分实现 | **同上**；当前 runner 拒绝 1.6，不许前端单独假升版本 |
| 引用文档与测试 | EXTENSIONS.md、制作技能 references/extension-api.md、API版本测试、声明传递/冻结页测试同步；该技能参考已有部分 1.3 旧描述，实施需定点纠正 | 不在设计 PR 修改 |

**审查决策点**：若“不改后端”也约束后续 C5a 实施，则本任务只能保留设计/使用测试专用显式元数据做隔离原型，不能向真实拓展开放 1.6。建议先批准一个只做上述协议登记的前置 PR，再做前端接入；不自行执行这个例外。

旧拓展在新宿主可获得新页 API 元数据不代表主动声明复用；仍每题重建、仍可使用全局 QF 现有方法。历史始终按 frozen page.apiVersion 选 bridge；即使今后冻结页为 1.6 也每题冷建，不能重新读取现装拓展覆盖历史。原 1.0–1.5 消息 envelope 不新增强制字段，旧夹具与四份持久化标准答案不更新。

## 3. 切换时序与竞态

### 3.1 一次 A→B

1. 进入原 transitionTo 串行队列；使 pane inert（含草稿画布），检查编辑退出。只记录一次导航意图，不提前修改 questionId/outline/listening。
2. `await flushPane(A)`：SDK/题型 flush → 当前题答案/答题状态/上传排空 → 白板 flush/saveInk → writes.settled。false、未保存标志或异常均中止；A DOM、payload、笔迹与输入保留，可重试。此时 A 已接受写入全部有结果；不把“请求发出”当作“写入完成”。
3. 预判旧页资格，`loadQuestion(B)` 条件重验证，检查 collection 绑定，取得 page/SDK（可能命中缓存），用第 2 节精确条件作最终判定。获取失败时未调用 update，保持 A 原 frame 和白板。复用不取消任何既有内容变更校验。
4. 不满足条件，完全走现有 candidate-first 冷建；满足则保存已确认的 A payload/stamp/白板视图恢复资料，标记 switch transaction，清 A 题级布局的可交互映射，封闭写入口。撤销 A scope（abort signal、pending 题级请求结算、旧观察回调暂停），递增 generation，建立 `{g,B,loadId,stamp,phase:loading}` 待定绑定。pane.questionId/payload 仍是 A。
5. `await plugin.update(contextB,{generation,loadId,questionChange:true})`（拟议新增可等待形态，保留旧调用形态）。SDK 清 A 题级资源/答题区/导航链，调用 B 的 onLoad 并等待其 Promise/必要的 view.ready，再发 `context-loaded`。若有共享答题区，还必须完成 B 的首份布局并发送给 host 缓存，不能只等富文本 ready（详见下节）。加载中宿主只允许待定 B 绑定的 resource-get/sdk-editor 等只读请求；save/answer-state/AI/action/上传拒绝为 PAGE_LOADING，不经可变 pane 路由。几何/resize 暂存，不能写入 A 白板。
6. host 只接受当前 plugin/source/session/generation/loadId 的成功确认；再次检查 pane 未关、transaction 未失效、模式/绑定未被改变。然后在同一同步提交段设置 pageAssets/collection/questionId/payload/renderedContentVersion/states、清旧 ink buffer/outlineItemId/summary，whiteboard.load(B.draft)，同步相机；发布 B 缓存布局并回灌 B 墨迹，再打开 B 写入口、发送 scoped `context-activated`。SDK 在该确认前保持新控件 inert/不接受作答。清 loading 后更新大纲/Chrome/听力、安排 prefetch。
7. context-activated 前后不存在用户可输入的半提交状态；host commit 与激活之间无 await。loadMs 在最后 finally 取值。若节点关闭/取消，撤销待定绑定，不发布布局/大纲、不再唤醒页面。

### 3.2 加载确认、同题刷新和回退

- `registered/ready` 仍是 frame 首次注册一次，不复用它作为每题 ready。初次 1.6 opt-in 注册带 generation0；跨题新增 `context-loaded {generation,loadId,ok,error?}`，host 的 update Promise 完成才提交 pane。确认表示 onLoad/必要渲染已完成，**不表示后端保存或自动评分完成**。
- 首份共享布局是准备屏障的一部分：onLoad 构造实例/restoreArea 完成后，Bridge 在渲染帧中触发新 service 的只读 refresh/测量，确保已就绪实例的首份 layout（可明确为空）先于 context-loaded 发送；同一窗口 postMessage 顺序与 generation/loadId 共同保证 host 先缓存再提交。不能调用 service.flush 来获取首布局，因为它的 onSync 需要活动题白板，会与加载屏障死锁。布局缺失/超时则加载失败；新控件在此之前保持 inert。激活后尺寸继续变化沿用 ResizeObserver 更新，并以新题 draft 重新投影；延迟首布局另有专项用例。
- 跨题 update 使用与首次注册相同的 10 秒上限作为初始建议，失败/超时只进行一次冷建 B 的回退，不无限重试、不在回退中重发答案保存。same-question submit/retry/AI update 仍是同一代际的 context refresh；为同题 onLoad 另设单调 loadId 串行化，避免与跨题交错。失败只能影响对应刷新，不冒充成功切题。旧调用方没 await 时仍需内部 catch，不能增加未处理 rejection。
- 收到 update 不意味着 DOM 可回滚。**update 发出前失败**可原样保留 A；**update 发出后失败**将该 frame 标记故障并隐藏/撤销，冷建 B。B 冷建成功才提交；若 B 仍失败，尝试用已保存且重新验证的 A 数据冷建 A（不是对已坏 frame 再 update 一次）。A 白板保持未提交切换时的值，恢复后继续使用；若 A 也无法重建，保留 A 的逻辑题号/保存结果并显示可重载错误，绝不把 B 的 DOM 当成可写 A。需要恢复的是已保存数据，不能以“回退”丢弃失败输入：旧输入保存失败时根本不进入第 4 步。
- onLoad 内不允许等待 context-activated，否则与 host 等 context-loaded 死锁；onLoad 仅构造/读取资源，真正用户操作从激活后发生。跨题 onLoad 拒绝发起自动 save/上传/评分；旧拓展不受此新增 opt-in 约束。

### 3.3 代际的具体隔离，不只给 postMessage 补当前 g

每个复用 frame 有不复用的 session；每个题目租期有单调安全整数 generation（A→B→A 是三个不同值）；每次 context 有独立 loadId。questionId、stamp 是宿主绑定值，页面消息不得指定另一个 qid 来改变写目标。代际不是用户/网络权限边界，仍保留 source/session/CSP 和后端权限/版本校验。

**关键陷阱**：若 send() 发送时才读全局 currentGeneration，A 的 setTimeout 在 B 加载后调用 QF.save，就会被贴上 B 的 generation。单纯 envelope 字段不能解决。因此建议在 opt-in 的 API 1.6 增加 `onLoad(context, scope)` 的第二个参数：scope 含只读 generation、AbortSignal、绑定这一代际的 api facade（save/requestAction/ai/resources/page.reportAnswerState/ui.resize/content/answerAreas）。请求、timer、上传、render callbacks 必须捕获这个 scope/api，不能捕获会变成 B 的变量。scope 撤销后调用直接返回 QUESTION_CHANGED，不发新请求；已发送 reply 用原代际结算。

仅对**主动声明复用且进入题级协议**的页面，未绑定题目作用域的全局 QF 写操作/资源与题级布局操作报 QUESTION_SCOPE_REQUIRED，禁止静默回落到“当前题”。全局保留 api 元数据、page.register、纯文档校验与外观订阅等 frame 级入口。新内置 practice 页需按此迁移，但其 editor/history/non-reuse 分支保留原全局兼容入口；不要让 history 因新 manifest 而被要求有活跃可写 scope。现有旧拓展所有全局方法语义不变。此项是**拟议新增 1.6 opt-in 约束，需审查**，不伪装成现有 API 已具备的能力。

1.6 的第二参数可在普通、已提交查看及 history 的首次 onLoad 都提供，不因“当前这次不可跨题复用”而缺少接口；history scope 的权限仍只读。只有正常 opt-in 练习页启用无作用域写拒绝，旧API/编辑器/未声明页面保留原入口。由新页面按实际有无 scope 选择接口，不以宿主 QF.api 支持列表替代 manifest opt-in。同题 context refresh 复用原 scope，不 abort 正在交互的编辑器。

**题级清理所有权**：每个新题型在 onLoad 建立本题局部对象和操作队列，并在该 scope.signal 的 abort 监听（或 Bridge 私有 cleanup registry）登记幂等清理：取消 timer、使 epoch 失效、destroy view/editor/component、丢弃已排空的 saver。Bridge 撤销 A 时同步触发这些清理，完成后才设置 B context/创建 B service，不能先 refresh A 的组件为 B 的权限。`hooks.onDispose` 仍仅在 iframe 最终销毁调用一次：当前内置 onDispose 会永久设置 disposed=true 并拆全局事件，每次切题调用它会让 B 无法工作。同题刷新不触发清理；所有长期事件绑定只做一次。

| 消息/异步来源 | 发送/接受规则 |
|---|---|
| request/reply（save、answer-state、action、AI、resource、sdk-editor、answer-area-sync/editor-layout） | 发起时绑定不可变 generation；host 接收先校验插件+session+阶段+g，再以绑定 qid/stamp 调现有路由。reply 回同一 g/id；旧 reply 不清新输入。加载期只有指定只读请求可用 |
| dirty/inputDirty/error、resize、interactive/answer-area-regions/layout/focus/pan | 生产回调注册时绑定 g；切题取消旧 timer/observer 批次；host 仅接当前 active g，B loading 几何缓冲。全局无法定位来源的 error/unhandledrejection 保守令 frame 故障、走重建，不把未知错误归给新题继续复用 |
| flush/flushed、document/draft、capture-region/captured-region、outline-navigate/navigated | 每个 pending 条目含 g/loadId；发起/响应均检查，清 timer 并结算旧请求；旧 queued outline hook 不再调用，已运行 hook 的结果不发布 |
| host→page answer-area-ink/tooling/command/mode、visibility/appearance | 墨迹/command/布局为题级，必须带 g；工具偏好可缓存但仅对新活跃 g 生效。appearance/visibility 为实例级，但暂停/恢复 observer 仍按当前事务阶段 |
| 异步 handler await 之后 | 再检查 transaction/g/plugin/closed；不能仅在进入 listener 时检查一次。已接受旧题写入排空后才换代；不能取消服务端已接受保存来假装回滚 |

作用域 facade 不可能替第三方取消它自己创建的所有 DOM/全局 timer：声明该能力就是遵守清理/作用域约定，host 不 monkey-patch 全局 setTimeout/Promise。恶意同 frame 脚本可主动仿造本 frame 的协议，和现有 sandbox 模型相同；本卡保证正常拓展的迟到操作被隔离，不把 generation 宣称为新的安全边界。

### 3.4 连续 A→B→C、refresh 与预取

沿用现有 FIFO transition 队列：B 尚未完成时 C 排在后面，**不并发 update、不 latest-wins**。B 成功激活后才开始 B→C 的 flush/取数/加载；若 B 最终失败并恢复 A，排队的 C 重新从当时实际活动题开始，不能使用原先 B 的绑定。关闭 pane 使所有后续事务失效。该策略可能短暂显示 B，但不会串题；后续是否合并导航意图另立任务，不混入 C5a。

同题保存/AI 的 context refresh 在 frame 内串行，不改 g；跨题开始前 flush 必须等待此前刷新完成，避免旧 onLoad 仍改 DOM。**不能把 await 队列接在产生该刷新结果的 QF.save reply 上**：写队列 onSaved 发起刷新可排队，但保存 reply 必须独立结算，防止 flush→save→onLoad→flush 环。bootstrap 的 pending/ready 队列分开统计并补死锁用例。prefetch 只进现有有界缓存，不触发 onLoad/资源预解码；导航仍读取 stamp，不拿预取结果直接判永久可复用。

## 4. 资源、配额及长期运行

- 正常退出旧题：flush 完成 → invalidate old scope → destroy 题级视图/editor/答题区（取消 observer/RAF/上传结果应用）→ revoke 该题所有资源 URL → clear resourceCache/计数 → 新 scope。清理幂等，销毁 frame 时再清一次也不出错。
- 旧 get/put/FileReader 完成仍需检查原 scope；不向 B 的 cache 写 Promise，不让 A 的失败 catch 删除 B 同 assetId 的缓存项。A、B 即使引用同一 assetId，也重新在各自配额计数；不靠跨题共享 Blob 规避单题 16 MiB。put 保留单图 4 MiB、格式白名单，未动宿主资源存储与瞬态/持久策略。
- 富文本静态 provider 与成功加载的 editor 脚本可保留，因为复用键要求精确 SDK 身份相同。每次 render/createEditor 由 Bridge facade 显式传资源/布局 scope；不修改已冻结的富文本 SDK/provider 版本。若当前 SDK 无法通过外部 facade 隔离某条异步链，对该 SDK 禁用复用，另行报告，不在本任务重写 SDK。
- 答题区保留原 provider 工厂私有引用，每题新 service；destroy 后删除旧实例 Map/pending 的可达引用。B 的白板回灌须等 B layout 提交，qfSharedAnswerAreas 旧文档绝不越代。共享墨迹仍只有宿主画布，不增加第二层手写实现。
- frame 级 ResizeObserver/appearance listener/page hooks 只注册一次；捕获脚本自己的 observer/timer 每题撤销/恢复，view 自有监听必须 destroy。检查不仅看 JS Map.size，还看 listener/RAF/Blob URL 的新增-释放平衡。
- 初版建议**不按 N 次周期重建**：没有数据确定合理 N，按次数重建也不能修串写。faulted、超时、身份/模式变化、未排空输入、不可验证作用域立即走原冷建；长时间测试显示泄漏再决定兜底阈值。1000 次导航（五类循环）后 active resourceBytes/URL/实例数应回到单题基线，detached nodes/heap 不持续线性增长；不得拿自动重建掩盖泄漏。

## 5. 测试方案与既有断言盘点

### 5.1 新增用例（实施 PR，真实函数/Bridge，不以 stub 假定隔离成功）

1. **五类逐个 A→B→A**：原 frame 身份不变、onLoad 恰好顺序执行、B 输入不出现在 A；A 从服务器确认状态恢复选项/富文本/答题区文字图片与笔迹；相同 part/option id、不同题内容；判断题 false/null。题目切换瞬间触发未到 250 ms 的输入与白板，断言保存 URL/answerStateId 对应 A，B 没有收到那次写入。
2. **作用域/迟到矩阵**：保存、answer-state、resource-get/put、FileReader、sdk-editor、AI reply、onLayout await、resize/region/ink/focus、outline/capture、error 的 A 结果在 B 各阶段到达；检查 B 的 revision/payload/输入/布局/配额/URL 不变。特别测试 A 的 timer 在 B 激活后才调用旧 scope.api.save，被本地拒绝而非仅消息不匹配；未绑定全局写在 opt-in 页拒绝。
3. **快速导航/故障**：可控 Promise 挡住 B 的 onLoad，排队 C，断言同一时刻一个 update；B 成功、拒绝、超时、pane 关闭各一条；B update 失败只回退一次冷建；B 冷建再失败恢复 A；恢复也失败不发布可写错题。页面 faulted 后下一题冷建；flushed false/失败禁止离开 A、保留输入。
4. **身份/排除条件**：逐项改变题库/版本/packageVersion/path/pageId/页面 HTML/CSS/内联资源/富文本版本及实际库内容/答题区版本/视图/能力，断言冷建；必要字段缺失或可选身份未知时冷建，双方确认未使用的可选项允许相等。未声明能力、只宣告宿主1.6但无 opt-in、旧 manifest、development 保留题、历史、编辑、考试、任一 submitted 来源/目标逐个断言冷建。
5. **资源/几何**：A/B 各 12 MiB 合法图片，切换不误触 16 MiB；单题17 MiB仍失败；同 assetId 新旧 get 竞争；每题 revoke/计数归零；共享答题区 B 加载期间不覆盖 A 白板，控制 RAF 延迟首布局时不得确认/激活，首布局后才提交并正确回灌；observer/监听/请求 timer 数量有界。断言 onDispose 跨题不调用、最终销毁恰一次，scope abort 每题恰一次。跨手机/桌面宽度缩放回归沿用 draft logical layout。
6. **同题更新与死锁**：submit/retry/review/AI context 同题更新仍正确，不清尚未保存输入/人工滑条；正在 save 时 flush、onSaved context update 时 flush、上传链 onChange/save 互相等待，使用可控调度验证能结束，不加固定 sleep/放宽超时。非复用旧协议 exact envelope 保留。
7. **听力/预取**：同材料切题续播、普通题暂停、跨材料换源和错误切题保持原材料；考试既有规则不变；预取不发 context/不建 frame，迟到预取不改变页面与大纲。

### 5.2 现有相关断言清单及拟议变化

基线用 `rg mountExtension/mounted/destroyed/frame/update` 扫 `core/test/{bridge,practice,development,exam,draft}`，再读对应路径。没有发现“所有普通同题型相邻题必须销毁”的独立通用断言；以下不能一律改成少 mount 次数。

| 文件 / 用例或断言 | 现状依据 | 拟议处理 |
|---|---|---|
| `core/test/bridge/mixed-extension-host.test.mjs`：mixed navigation…；ordinary mixed banks… | mounted HTML/context 序列；maxLive=2/live=1；其数据未声明能力且在切换不同题型 | **原样保留**，仍每题新候选；另外加声明能力且同题型的 A/B/A 测试，mounted=1/update=2，不拿旧用例当 opt-in |
| 同文件：a changed question extension…；package-only stamp changes… | 必须取得新版本/page，不用旧页 | **原样保留**，另补同 id/version 但 packageVersion/SDK/精确页面变更不可复用 |
| 同文件：mixed extensions…frozen history；mixed history mounts…；history keeps API metadata… | frozen page 顺序、无 live HTTP、maxLive=2、全只读 | **原样保留**；1.6 frozen 页也新增同样的每题重建断言 |
| 同文件：incompatible practice assets…；server-state recovery fences late writes… | 失败保留原 plugin/payload/白板，READ_ONLY | 原冷建分支保留；新 reuse.update 失败不能声称保留原 DOM，新增第 3.2 节恢复断言；recovery 隔离仍不放宽 |
| `core/test/practice/collection-navigation-host.test.mjs`：collection loading…；sidebar switching saves answers and ink… | 跨题库旧 frame 必须 destroy，返回需 attach/load | **原样保留**，C5a 不跨题库池化；增加冷恢复后首次 frame 不误复用 |
| `core/test/development/development-host.test.mjs`：ordinary candidate-first loading…；CSS hot refresh…；unsaved development question frames…；broken development editor… | 失败保留、热更新重建、park/restore 同一实例、编辑失败恢复 | **原样保留**，开发/编辑不复用；不会给全部 fixture 自动打 capability |
| `core/test/bridge/frame.test.mjs`：loading a saved editor document clears…；dispose/flush/source/session/input-dirty 用例 | 同题 update 后 dirty=false、旧 envelope 精确匹配；dispose 清 timer | 老协议/编辑分支不改；新1.6 opt-in 加独立带g分支，不能把旧匹配断言普遍删掉 |
| `core/test/bridge/outline-navigation-bridge.test.mjs`：host waits for registration, retains its iframe…；ordered callbacks/disposal | 子题定位原本就在同 frame，ready只一次 | **原样保留**；新增跨题新 loadId 与旧 outline 回复隔离，不能把子题导航当成跨题复用已验收 |
| `core/test/bridge/api-bridges.test.mjs`；`core/server/host/extensions/extension-api.test.mjs`；`core/server/rules-runner.test.cjs` | 当前将1.6作为 future拒绝 | 若协议前置PR获批，新增1.6支持且future用1.7，保留畸形/未知major/能力拒绝；**这是版本断言的明确变更，不能在前端PR偷偷修改后端测试** |
| `core/test/bridge/{answer-area-component,answer-area-host-channel,answer-area-input,answer-area-media,answer-area-resize,appearance-bridge}.test.mjs` | 冻结 provider、共享单层笔迹、焦点/geometry来源、readonly/配额 | 旧协议与冻结样例不改，新增复用题级 service/observer/URL 释放及同名 area 隔离 |
| `core/test/bridge/legacy-api-integration.test.mjs`；`core/test/extensions/*` | 多数读取 legacy-extensions 的已发布版本，不是当前五题型 | 不把旧样本替换为新五类；保留 v1原测试，另建从真实内置目录读当前代码的复用集成夹具 |
| `core/test/practice/{question-layout,save-recovery,write-queue,answer-preview,answer-feedback-host,practice-restart-host,question-navigation,practice-lifecycle,listening}.test.mjs`；`core/test/exam/` | 相机/笔迹、失败输入、按题串行、状态上报、重开缓存、FIFO、听力、考试 | 相关语义/断言不改；截取 app.js 的夹具只增加需要的新依赖/截取范围，走生产判定与回调，不重写整套测试形式 |

实施合并前再次扫描动态新增用例；文档不以此清单代替全部测试。四份黄金文件继续 Buffer.equals，不因前端微优化换持久化标准答案。

## 6. 测量方案（不以 JSDOM 数值替代浏览器）

环境：本机 Windows / Node24，独立合成数据根、独立回环端口、真实 Chromium；固定同一浏览器版本/机器/窗口/DPR/扩展与后台负载。浏览器自动化优先使用临时 Playwright/CDP 驱动独立 Chrome/Edge profile（工具存忽略目录，不引入运行时依赖）；不能驱动时负责人手动按下列步骤操作。不得占用日常8787/8788服务，也不连接 Hub/远程 API。设计阶段不启动服务、不打开真实题库。

1. 用合成 bank 至少每类两题，包含真实富文本、图片和答题区；另建交替跨题型 bank。基线用实现前提交独立检出，相同带新题型代码的试验分支强制冷建作补充 A/B，避免把拓展重写收益全算成 frame 复用。强制冷建仅测试加载钩子，不加生产开关。
2. 每轮预热10次；五个题型分别至少30个暖同型切题样本（A↔B，包含每次先有未保存输入的独立组）；跨型各方向至少30个。基线/复用交替三轮，隔离冷启动样本，不把丢弃/失败导航算成成功。记录 median/P95、样本数及定义（P95用nearest-rank），列原始JSON证据而不存题文/答案。
3. **显示加载耗时**：每次等待目标 qid 的新加载确认、loading完成，再读取 pane.dataset.loadMs；当前是showQuestion开始到finally，含取题/准备SDK/挂载或update，**不含flush**。两分支维持同边界，指标四舍五入精度注明；若测试专用性能钩子保留高精度原值，一并列出，不能与整数dataset混算。
4. **用户切题耗时**：点击/导航意图到新题确认并下一帧可见（两次requestAnimationFrame作一致的绘制采样约定），包含flush/写队列，独立记录。自动化不能靠固定sleep取dataset旧值；等待新的nav完成标记/代际、qid及非busy，核对真实frame identity。JSDOM只测调用次数、消息时序和隔离。
5. 分组报告缓存命中/未命中（既有dataset.questionSource），控制相同网络payload与资源、同型/跨型、无输入/待保存输入。证明同型减少frame/srcdoc/SDK初始化计数，不要求HTTP为0（现有loadQuestion仍条件重验证）。跨型性能目标建议median/P95相对基线均不劣化超过5%；若样本噪声超过阈值先扩大样本查因，不凭目标改测试超时。
6. 手工补验：手机真实浏览器（注明机型、OS、浏览器、LAN方式）五类A/B/A，笔/触摸/文字/上传；检查输入与墨迹不串、图片正常、滚动/大纲/听力/返回历史编辑考试可用。负责人可运行自动化并回传摘要；未做真实手机验收要明确保留缺口。
7. 长跑1000次看URL create/revoke计数、pending/实例/监听计数；真实浏览器可额外取heap快照/强制GC后detached nodes曲线（测试工具权限下），不把未暴露的内存数字估算成实测。错误/配额案例均单列，不纳入普通切题延迟统计。

结果表模板（目前全部未测）：

| 场景/题型 | 基线提交/浏览器版本 | n | loadMs median/P95 | 用户切题 median/P95 | frame 创建/销毁/update次数 | 失败数 |
|---|---|---:|---|---|---|---:|
| 五类暖同型，分别列5行 | 待实施记录 | ≥30/轮 | 未测 | 未测 | 未测 | 未测 |
| 跨型各方向 | 同上 | ≥30/轮 | 未测 | 未测 | 未测 | 未测 |

## 7. 建议拆分及门槛

1. **本 PR：C5a设计/计划收口**。仅本文及计划；审核通过前不开始实现。第2.3/3.3的协议/作用域选择必须审查。
2. **前置 C5a-0：1.6 协议登记（待另行授权后端最小范围）**。后端声明/runner元数据/页面boolean + 前端bridge版本表、版本/历史兼容测试与文档；仍不启用跨题复用，不改存储/规则行为。若不给后端例外则停在设计，不发布半套1.6。
3. **C5a-1：现有app.js/bridge内的opt-in加载事务**。scope、g/loadId确认与激活、回调绑定、frame-capture/资源/答题区的题级清理、重建回退；用合成显式声明夹具测竞态。未声明拓展与排除场景不变；不改Pinia/Vue入口、不改后端。CI三job全绿、四标准答案不变后审查。
4. **C5a-2：五个内置题型新版本适配、真实浏览器测量与验收**。逐个新scope/异步清理及manifest opt-in，保留历史/编辑兼容分支，不批量更新作者旧包；真实题型A/B/A、长跑、桌面/手机与同/跨型数值。只有测量证明收益且无跨题串写/泄漏才发布。SDK源码/版本若必须改，停下另立任务，不在此悄悄重写冻结SDK。

未来是否再包装 ExtensionFrame.vue 属于原阶段C，**不是以上PR的依赖**。各实现PR继续把完整描述、文件清单、测试/CI失败名单与证据提交reviews，不自动合并。

## 8. 风险与未决问题

| 风险/问题 | 处理或待审查决定 |
|---|---|
| 禁改后端与1.6/manifest opt-in不可同时实现 | 第2.3节列最小协议前置PR；未批准不能开真实接入实现 |
| 第二参数scope及禁止opt-in页无作用域写是新增契约 | 请求审查；若不接受，不能只贴全局g来声称满足迟到隔离，需要另审等效设计 |
| update破坏旧DOM后失败，不能像candidate-first保留旧frame | 第3.2节冷建B一次/再恢复A，已保存数据为依据；UI短暂加载遮罩，不假装事务能撤销页面副作用 |
| 白板共享答题区布局与新DOM不同步 | loading阶段不发布几何，commit时原子换题、load draft、再发布布局/墨迹；真实笔/手机验收 |
| SDK configure 全局闭包或自建异步绕过scoped resources | facade显式注入，旧view/editor销毁；识别不能隔离的SDK就禁复用，不猜测兼容 |
| flush/上传/onSaved刷新互相等待 | 分开请求reply与render队列，新增可控Promise死锁用例；失败不放行切题 |
| 网络/内容变更与预取旧缓存 | 保留条件stamp校验、写contentVersion和page身份；没有API字段就保守重建 |
| 长期第三方代码泄漏、全局未知error无法定位代际 | opt-in清理契约+长跑；未知全局错误重建，不把定期重建当修复 |
| submitted/考试/历史/编辑先不复用，收益范围有限 | 有意保守；报告按场景比例，不声称所有切题都变快；扩展范围要另审 |
| 真实手机自动化工具不可用 | 负责人按第6节手工验收；未完成不得标注已验收 |

## 9. 本设计 PR 验证记录

- 基线：`61edb11`，S1合并提交`0fd4e09`，B7a合并提交`61edb11`；两项合并前最终head的三个CI job均已通过。
- 代码/测试修改：0；设计阶段新增用例：0；真实性能测量：未执行。
- 当前设计PR的CI：待推送后补全三个job的结果、耗时及失败用例名单；未完成前不标为全绿。
- S1真实数据统计尚未执行；本文不包含任何真实状态逐文件输出或数据结论。
