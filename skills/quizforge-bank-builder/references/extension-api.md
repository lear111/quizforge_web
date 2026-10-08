# 外部题型拓展 API 参考

适用当前 QuizForge Web：公共富文本 SDK `quizforge.richtext@1.1.1`，完整示例 `extensions/short-answer-1.2.1/`。以下接口已从实际宿主、规则执行器及 SDK 源码核对；不要根据名称推测额外接口。

## 可写范围与包结构

本文路径均相对于产品根目录。新题型 Agent **只能新增自己的外部 `extensions/<新目录>/` 和新 `question-banks/` 文件**。严禁修改整个应用 `core/`（包括 `core/web/`、`core/server/`、`core/src/`、`core/shared/`、`core/scripts/`、`core/test/`、`core/package*.json`、`core/pom.xml`、依赖和文档）、产品根启动脚本或应用配置，严禁直接修改 `.state/`。旧平铺项目中的同类核心文件也受保护。功能超出现有接口时，报告缺口，不为题型添加宿主分支。

拓展通过 `manifest.json` 声明资源，不存在另一个前端安装/注册 API：

```json
{
  "id": "example.new-type",
  "version": "1.0.0",
  "requiresApi": {"major": 1, "minMinor": 0, "capabilities": ["practice", "editor", "score", "richtext", "lifecycle"]},
  "name": "新题型",
  "description": "用途说明",
  "dependencies": [{"id": "quizforge.richtext", "version": "1.1.1"}],
  "entry": "practice.html",
  "script": "practice.js",
  "style": "practice.css",
  "rules": "rules.js",
  "questionSchema": "question.schema.json",
  "answerSchema": "answer.schema.json",
  "examples": "examples.json"
}
```

不用富文本时省略 `dependencies`。当前支持的公共 SDK ID 只有 `quizforge.richtext`，依赖指定确切版本，不支持版本范围。题目编辑器由拓展目录下可选的 `editor.json` 声明：

```json
{"entry":"editor.html","script":"editor.js","style":"editor.css"}
```

HTML 是 body 片段；CSS 和 JS 由宿主注入。页面及规则脚本按普通脚本执行，不能直接留下 ESM `import` 或 Node `require`。需要模块化开发时，在自己的拓展目录内预打包成声明的单文件，不改宿主构建。各路径必须指向本拓展内的真实文件，不能越界或依赖外网 CDN。

## 页面上下文与三种 UI

页面及规则环境公开只读 `QF.api:{major:1,minor:0,capabilities:[...]}`；页面资源由宿主携带 `apiVersion`。这是已实现协议的元数据，不授予写入权限，也不意味着规则环境能使用浏览器的方法。页面继续根据 context.capabilities 决定哪些操作可用。

练习页面通过 `onLoad(context)` 获得以下字段；这是当前接口全集，不含私有 HTTP 地址、状态修订号或拓展元数据：

```js
{
  mode: "practice", // 另有 "example"、"history"
  question: {id, title, data},
  answer, result,
  status: "unanswered", // 或 "draft"、"submitted"
  aiTask,
  capabilities: {canSave, canSubmit, canRetry, canReview, canAiGrade}
}
```

`question.data` 是规则 `project` 的返回值；`answer`、`result` 初始可为 `null`。题型自行定义题目/答案数据结构，页面不得假定所有题型都有 `stem` 或相同答案字段。

| UI | 应实现的行为 |
| --- | --- |
| 练习作答 | 恢复 `answer`；按 `canSave/canSubmit` 开放输入、草稿保存和提交；提交前不展示私有标准答案。 |
| 提交后结果/评分 | 展示服务器 `result` 和提交后投影；锁定作答输入；仅按 `canRetry/canReview/canAiGrade` 显示重做、人工评分和 AI 操作。待评分 `score:null` 不可显示为 0 分。 |
| 题目编辑 | 使用独立 editor 页面与 `QF.editor.register`；编辑私有原题、标准答案、解析等；由宿主读取文档并落盘。 |

`mode:"example"` 是拓展示例练习，使用独立示例状态；不要把示例写入题库。`mode:"history"` 复用练习页面展示冻结快照：所有上述 capabilities 为 `false`，`aiTask:null`，必须纯只读；不保存、不上传、不启动 AI 或轮询、不尝试由当前题库补全旧内容。历史只能读取图片及已声明 SDK；`QF.requestAction` 也会被拒绝，历史切题由宿主负责。

编辑上下文只有 `{mode:"edit",question:{id,title,data},capabilities:{canEdit:true}}`；此时 `question.data` 是完整原题数据，不能套用练习投影的字段缺失逻辑。编辑页面不能调用 `QF.save` 保存题目。

## 注册与生命周期

练习/结果/历史页面注册一次：

```js
QF.page.register({
  async onLoad(context) { /* 更新界面，恢复状态 */ },
  async onFlush() { /* 完成编辑器上传、尚未发出的草稿和保存队列 */ },
  onDispose() { /* 同步停止定时器、监听器及渲染器 */ }
}).catch(showError);
```

`onLoad` 必须提供；`onFlush/onDispose` 可选。`register()` 返回 Promise，首次 `onLoad` 完成后才宣告就绪。宿主状态变化会在**同一页面再次调用 `onLoad`**；不要重复注册、重复绑定事件或无条件覆盖正在输入的内容。异步渲染/轮询用题目 ID、epoch 或 disposed 标记阻止过期回调。

宿主切题、切标签或退出前调用 `onFlush`，等待页面协议中已发出的请求；未触发的 debounce、编辑器上传和自建 Promise 队列需由拓展自己 flush。保存失败应抛错并保留当前输入，不能吞错后宣称保存成功。`onDispose` 不会被 await，不能在其中启动最后一次异步保存。

编辑页面注册一次，必需 `onLoad/getDocument`：

```js
QF.editor.register({
  async onLoad(context) { /* 填表，并将原始草稿 JSON.stringify 后记录为 originalSnapshot */ },
  async getDocument() {
    await flushInputs();
    // 校验失败应抛错；只返回题名和该题型完整私有数据。
    return {title: readTitle(), data: readQuestionData()};
  },
  hasChanges() { return JSON.stringify(readRawDraft()) !== originalSnapshot; },
  async exportDraft() { await flushInputs(); return readRawDraft(); },
  async importDraft(draft) { /* 恢复未完成输入，不要求题目已通过提交校验 */ },
  onFlush: flushInputs,
  onDispose: disposeInputs
}).catch(showError);
```

`hasChanges/exportDraft/importDraft` 可选，但完整编辑器应实现：草稿需 JSON/structured-clone 可序列化，并能保留暂时无效的原始输入。宿主恢复时先 `onLoad`、后 `importDraft`；导入不能把草稿当作新的“未修改”基线。缺少 `hasChanges` 时宿主按已修改处理；已有恢复草稿而缺 `importDraft` 会加载失败。`getDocument` 不返回 ID、拓展绑定、练习状态或整份题库；这些由宿主维护。

## 作答协议

以下方法返回 Promise，**业务失败通常以 envelope 返回，不会自动 throw**：

```js
const reply = await QF.save({purpose:"draft", data:{answer}});
if (!reply?.ok) throw new Error(reply?.error?.message || "保存失败");
// 成功形如 {ok:true,data:{status,result}}；失败 {ok:false,error:{code,message}}。
```

| 调用 | 参数与作用 |
| --- | --- |
| `QF.save({purpose:"draft",data:{answer}})` | 保存完整答案草稿，答案必须通过 answer schema/规则校验。 |
| `QF.save({purpose:"submit",data:{answer}})` | 提交完整答案，由后端 `grade` 评分。 |
| `QF.save({purpose:"review",data:{review}})` | 人工评分；`review` 至少包含有限数值 `score`，额外字段由本题型 `review` 校验。 |
| `QF.requestAction({action:"retry"})` | 由宿主重置当前题作答状态。 |
| `QF.requestAction({action:"previous"})` / `({action:"next"})` | 练习切题；最后一题 next 打开汇总。 |
| `QF.requestAction({action:"goToQuestion",params:{questionId}})` | 跳到本集合中存在的题目。 |
| `QF.ui.resize()` | 请求宿主按 body 高度调整 iframe；不接收布局参数。 |

不支持自定义 action、跨题库跳转、任意后端调用、修改题型绑定或直接写练习状态。页面不能伪造评分结果；提交参数是 `answer`，不是 `result`。历史和编辑模式拒绝上述 save/action。

AI 仅在当前已提交题目且 `canAiGrade===true` 时开放；人工/AI 确认还应检查 `canReview`：

| 调用 | 说明 |
| --- | --- |
| `QF.ai.grade({force:false})` | 发起/复用当前题评分任务；`force:true` 重新评分。 |
| `QF.ai.getTask({})` | 返回 envelope，其 `data` 为 `{task: 任务或null}`。 |
| `QF.ai.getTask({taskId})` | 返回 envelope，其 `data` 为该任务。 |
| `QF.ai.retry({taskId})` | 重试任务，返回任务。 |
| `QF.ai.confirm({taskId,candidateVersion,score})` | 用户确认候选后形成正式评分；传候选 `version` 防止确认过期建议。score 可省略以接受建议。 |

任务状态包括 `queued/running/succeeded/failed/superseded/confirmed`；成功候选在 `task.candidate`，包含 `version/score/feedback`。返回均需检查 `ok`。宿主绑定当前题目、答案和版本并提供请求 ID；页面不得提交自己的评分输入、provider 配置或凭据。AI 建议只是候选，必须由用户明确确认才能计入正式得分；不得自动调用 confirm。轮询必须在离开题目和 `onDispose` 时停止。

## 同步规则 API 与评分归属

`rules.js` 必须调用一次 `QF.defineType({...})`，独立规则进程只提供这个 QF 接口，没有页面的 `QF.save/content/resources`。所有方法必须**同步返回可 JSON 编码的值**，不能返回 Promise，也不能使用 DOM、网络、文件系统、动态编译或依赖外部进程状态。

| 方法 | 契约 |
| --- | --- |
| `validateQuestion(data)` | 可选；question schema 先执行，再执行此方法；返回 `false` 拒绝题目。跨字段条件在此校验。 |
| `validateAnswer(answer,data)` | 可选；answer schema 先执行；返回 `false` 拒绝。草稿和提交均受校验。 |
| `project(data,state)` | 必需；返回公开 `question.data`。正常投影 state 为 `{submitted:boolean,result}`。提交前主动构造不含标准答案/评分细则的对象，禁止简单展开私有 data。 |
| `grade(data,answer)` | 必需；返回正式 graded 结果或 pending 待评结果。不能让页面承担判题。 |
| `review(data,answer,review)` | 可选；将人工/AI 确认的 score 转为 graded 结果；验证范围、步长、额外字段。不可返回 pending。 |
| `getScore(data,state)` | 新题型应实现；返回 `{score,maxScore}`，不重判题。批量评分的 state 含 `status/answer/result/revision` 及派生 `submitted`。未提交返回 0 分；pending 返回 null；graded 返回保存的正式分数。 |
| `prepareAiGrading(data,answer)` | 可选；从私有题目与已提交答案构造下述 AI 输入，仅提供输入，不调用模型。 |

`grade/review` 的结果必须为对象，并始终包含 `feedback`（可为 `null`）：

```js
// 自动/人工完成评分；gradingStatus 可省略，默认 graded。
{gradingStatus:"graded", score:3, maxScore:5, correct:false, feedback:"评分说明"}
// 人工或 AI 待评分；仅 grade 可以返回。
{gradingStatus:"pending", score:null, maxScore:5, correct:null, feedback:null}
```

`maxScore` 是有限非负数；graded 的 `score` 是 `[0,maxScore]` 内有限数，`correct` 为 boolean。`correct` 的含义由拓展决定。`getScore` 在 pending 时必须 `score:null`，其他状态分数有限且合法；AI 确认的 getScore 必须与正式 result 的 score/maxScore 相同，如果返回 gradingStatus 也必须一致。类型自己的分值、部分得分、正确判定、解释和人工评分校验全部留在拓展规则；宿主只做通用持久化、调用、验证和汇总。

`getScore` 在 AI 准备/确认校验路径可能只获得 `{submitted:true,result}`，因此不能要求 status/answer/revision 必然存在。需要人工/AI 评分的题型必须显式返回 `gradingStatus:"pending"` 或 `"graded"`；宿主据此识别可复评结果，仅注册 review 不会让省略 gradingStatus 的自动判分结果开放复评。

运行时 `canAiGrade` 要求同时存在 `prepareAiGrading` 和 `review`，还受宿主当前题状态及有效当前练习轮次约束；不是 manifest 中可自行打开的能力开关。仅实现 prepare 不会开放 AI。页面以 context 的 canReview/canAiGrade 为准，不按函数存在与否自行推断权限。

AI 输入协议：

```js
{
  protocolVersion: 1,
  question: [{type:"text",text:"题干"}],
  answer: [{type:"text",text:"已提交答案"}],
  referenceAnswer: [{type:"text",text:"参考答案"}], // 可空数组
  rubric: [{type:"text",text:"评分细则"}],
  maxScore: 5,
  scoreStep: 0.5
}
// 图像块：{type:"image",assetId:"64位小写SHA-256",alt:"可选描述"}
```

不允许额外顶层字段、图片 URL/路径或其他块类型。question/answer/rubric 必须非空数组；每字段最多 2000 块；文本合计最多 400000 字符；图片合计最多 40 张，alt 最多 500 字符；编码总量最多 1 MiB。maxScore/scoreStep 必须有限正数，maxScore 是 scoreStep 的整数倍，并与已提交 result 及 getScore 的满分完全相同。富文本转 AI 块需自己保留文字、公式、表格含义和 assetId；SDK 不提供 `toAiBlocks`，简答题的转换函数属于该拓展。

## 公共富文本 `QF.content`

只有声明富文本依赖后才能访问 `QF.content`。静态渲染包随页面加载；编辑包在首次 `createEditor` 时由宿主按声明版本延迟加载。直接使用以下公开 API，不调用 `_createEditor`、自行 configure 宿主资源桥或复制修改 shared SDK。

| API | 参数及返回 |
| --- | --- |
| `QF.content.render(container,doc,options={})` | container 为 DOM 元素，doc 为下述 JSON 文档；options 仅支持 `resources` 覆盖，通常省略。返回 `{ready:Promise<void>,destroy()}`；ready 等待图片处理。 |
| `QF.content.createEditor(container,options={})` | options：`doc`、`onChange(doc)`、`placeholder`、`contentWidth`；高级集成还接受 `resources/setExpanded`，通常保留宿主默认桥接。返回下述 editor。 |
| `validateDocument(doc,{requireContent:false})` | 返回 boolean；`requireContent:true` 要求存在非空文字、图片或公式。 |
| `cloneDocument(doc)` | 验证并深拷贝；无效文档抛错。 |
| `isEmpty(doc)` | 空或无效文档返回 true。 |
| `fromEditorDocument(doc)` | 清理编辑器 JSON attrs 后验证/拷贝；不是 HTML、Markdown 或 Office 转换器。 |
| `EMPTY_DOCUMENT` | `{type:"doc",content:[{type:"paragraph"}]}`；使用 cloneDocument 获得自己的副本。 |

editor 方法：`ready`、`getDocument()`、`setDocument(doc)`、`focus()`、`flush()`、`isUploading()`、`setAdvanced(boolean)`、`isAdvanced()`、`destroy()`。`ready` 和 `flush/setAdvanced` 为 Promise；setDocument 不发 onChange。保存/切字段前 `await editor.flush()`，再取 getDocument，处理上传失败。每个 iframe **只允许一个活动富文本 editor**；创建第二个前先 flush 并 destroy 第一个，其他字段用静态 render。销毁后不要使用；每次重绘先 destroy 旧 renderer/editor。

```js
const editor = QF.content.createEditor(host, {
  doc: QF.content.cloneDocument(initialDoc),
  placeholder: "填写答案",
  onChange(doc) { answer = doc; scheduleDraft(); }
});
await editor.ready;
// 离开前 await editor.flush(); 保存成功后才能销毁。
```

富文本是带白名单节点/属性的 JSON，不是任意 HTML：

```js
{type:"doc",content:[
  {type:"paragraph",content:[{type:"text",text:"题干",marks:[{type:"bold"}]}]},
  {type:"image",attrs:{assetId:"64位小写SHA-256",alt:"插图",width:480,align:"center"}},
  {type:"blockMath",attrs:{latex:"x^2+y^2=z^2"}}
]}
```

支持 paragraph、heading（level 1–3）、blockquote、bulletList/orderedList/listItem、codeBlock、horizontalRule、image、table/tableRow/tableCell/tableHeader、text、hardBreak、inlineMath/blockMath。marks 支持 bold/italic/strike/underline/code/link/textStyle/highlight/subscript/superscript。字体、字号、行距应从 SDK 的 `FONT_FAMILIES/FONT_SIZES/LINE_HEIGHTS` 枚举选择；颜色为 `#RRGGBB`，链接只允许 http/https/mailto。图片属性是 assetId，不接受 src/URL/base64；数学属性是 latex，不接受 HTML。

文档最多深度 32、5000 节点、100000 文本字符、40 图片；公式 latex 最多 2000 字符；表格最多 30 行/每行最多 30 个有效列；image width 为 24–2400 整数。需复杂表格/mark attrs 时阅读 `core/shared/richtext/1.1.1/src/document.js` 的实际白名单，禁止靠示例猜任意 attrs。

## 图片、宽度与运行限制

`await QF.resources.put(file)` 接收浏览器 File/Blob，支持 PNG/JPEG/WebP/GIF，每图最多 4 MiB，返回 `{id,mime,size}`，失败抛错。文档使用 `id` 作为 assetId。`await QF.resources.get(id)` 返回 `{url,mime,size}`；id 必须 64 位小写十六进制，url 是当前 iframe 的 Blob URL，不可持久化到题库。富文本默认已连接这些资源接口。

iframe 不允许外网 fetch、脚本/CDN、外部图片、表单提交或访问宿主 DOM；仅 `sandbox="allow-scripts"`，图片允许 data/blob。规则执行环境也没有网络/文件 API，不能获取凭据。不要用 localStorage/父窗口内部对象作为保存通道，也不要自行组装宿主 postMessage 私有协议。

宿主桌面练习世界宽 760px，手机阅读为流式宽度；现有简答卡片为 `width:100%;max-width:704px`。新 UI 使用响应式宽度、`min-width:0`、一致的正文 padding，避免固定最小宽度或大量横向溢出。练习、结果、题目编辑的正文宽度保持一致；`createEditor({contentWidth})` 指**正文内容宽度**，可省略交由组件测量，高级模式会保留此宽度。`setAdvanced(true)` 展开当前同一编辑器，由宿主提供全屏布局，不创建另一套 editor；不要误用不存在的 `QF.ui.expand/setWidth`。

资源限制：manifest/editor.json 最多 256 KiB；声明的页面 HTML、JS、CSS、rules、schema 各最多 1 MiB；examples 和单份题库最多 8 MiB。规则输入最多 8 MiB、输出最多 2 MiB、单次 VM 执行限 650ms，子进程堆限 96 MiB，宿主总执行期限 8 秒。编写线性、纯同步规则，不用大规模枚举/递归或在投影中返回重复大资源。

宿主只保留当前活动 iframe/白板/编辑器；切标签时旧页面会被 flush、销毁，恢复时重新构造，因此不依赖后台隐藏页面运行。题型在 onDispose 清理自建 timer、监听器、observer、renderer、editor、Object URL；异步回调检查 disposed/epoch。宿主会释放 `QF.resources.get` 创建的 URL，单 iframe 读取图片累计限 16 MiB；拓展自建 URL 仍需自行 revoke。

宿主 JSON 缓存已受 LRU 数量、字节及 5 分钟空闲期限制：题目 12 条/16 MiB、页面 4 条/4 MiB、SDK 4 条/8 MiB。拓展不扩容、不建立绕过这些限制的全局长期缓存、不改宿主清理逻辑。

## 版本与历史兼容

当前仅实现 Extension API v1.0。Manifest 不写 `requiresApi` 时按 v1.0 处理；显式声明仅允许 `major`、`minMinor`、`capabilities`，前两项必须是整数且分别至少为 1、0，capabilities 可省略（等于空列表）。当前支持 `major:1,minMinor:0`，支持能力为 `practice`、`editor`、`editor-drafts`、`score`、`manual-review`、`ai-grading`、`resources`、`richtext`、`navigation`、`lifecycle`；能力字符串必须非空且不重复。只声明实际需要的能力，富文本仍须单独依赖准确 SDK 版本。未知版本、未知能力或坏声明在规则执行前拒绝。API v2 尚未实现，不可仅改声明假装兼容。

新拓展与新样例可声明 API 和顶层题库 `formatVersion:1`；严禁为补字段修改已经发布的 Manifest、已练习题库或旧绑定。缺省按 v1 是读取规则，不是转换操作。历史按每份冻结页面的 apiVersion 加载，缺字段按 v1.0；同一轮可有不同题型，不按当前安装包或轮次顶层版本重判旧页面。

已发布版本不能原地改字节。新题型使用新 ID/新目录；已有题型升级使用新 version/新目录，保留旧目录与旧题库、历史，不直接迁移或覆盖原文件。引用 SDK 使用确切版本；已固定 SDK 快照优先于同版本 shared 源码，修改源码不会刷新旧快照，绝不可删除/覆盖快照强迫更新。需要公共 SDK 新能力时报告给应用维护者，不在本任务中改 shared 或伪造 SDK 版本。

混合题库每题绑定自己的拓展版本；题型页面只使用该题上下文，不假设集合只有一个类型。历史页面由宿主解析保存的 page/pageKey 和 SDK 依赖；缺快照引用应报错，不能由当前安装版本兜底。拓展无需也不应自行解析历史存储。

## 核对源码入口

页面协议：`core/web/frame.js`、`core/web/extension-requests.js`、`core/web/practice-context.js`、`core/web/ai-client.js`。规则与 AI 输入校验：`core/server/rules-runner.cjs`、`core/src/main/java/io/quizforge/web/AiGradingProtocol.java`。SDK：`core/shared/richtext/1.1.1/src/{static,document,render,editor}.js`。完整富文本/AI 示例：`extensions/short-answer-1.2.1/{editor.js,practice-ai.js,src/rules.js,src/ai-document.js}`。基础自动判分示例：`extensions/single-choice/`。这些核心入口仅供只读核对；没有 `core/` 的旧平铺 fixture 对应根层路径。
