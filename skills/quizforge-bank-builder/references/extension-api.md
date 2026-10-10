# 外部题型拓展 API 参考

适用当前 QuizForge Web：公共富文本服务 API v1.0、文档格式 v1。宿主通过 `core/shared/richtext/service.json` 选择兼容实现；Tiptap 是当前编辑实现，不是拓展依赖。完整现行示例 `extensions/基础题型/short-answer-1.3.0/` 使用公共富文本声明；旧简答包仅在 `core/test/fixtures/legacy-extensions/` 供兼容测试，不是当前安装清单。以下接口已从实际宿主、规则执行器及 SDK 源码核对；不要根据名称推测额外接口。

## 清单与公共服务声明

每个独立叶使用普通 manifest；开发标记、分组、样例和发布规则只见 [拓展开发](extension-development.md)，写入权限与流程只见 SKILL.md。以下是声明形状，替换身份和真实文件，不照抄不存在的资源：
```json
{
  "id": "example.new-type",
  "version": "1.0.0",
  "requiresApi": {"major": 1, "minMinor": 0, "capabilities": ["practice", "editor", "score", "richtext", "lifecycle"]},
  "name": "新题型",
  "description": "用途说明",
  "requiresRichText": {"major": 1, "minMinor": 0, "documentFormat": 1, "documentProfile": "advanced-v1", "capabilities": ["images", "tables", "math"]},
  "entry": "practice.html",
  "script": "practice.js",
  "style": "practice.css",
  "assets": ["assets/diagram.svg", "assets/font.woff2"],
  "rules": "rules.js",
  "questionSchema": "question.schema.json",
  "answerSchema": "answer.schema.json",
  "examples": "examples.json"
}
```

不用富文本时省略 `requiresRichText` 和 `dependencies`。新拓展使用 `requiresRichText`，不绑定 Tiptap/npm 包或具体 SDK 版本，也不得同时声明 `dependencies`（即使空数组）。必填字段是正整数 `major`、非负整数 `minMinor`、正整数 `documentFormat` 和非空 `documentProfile`；可选 `capabilities` 为不重复的非空字符串数组。当前支持 `major:1,minMinor:0,documentFormat:1`。配置 `basic-v1` 提供 `basic-formatting`、`images`；`advanced-v1` 另提供 `advanced-formatting`、`tables`、`math`、`image-resize`。声明实际需要的能力，宿主选择满足该配置的实现。配置决定可保存的文档范围，不能把 `basic-v1` 的旧格式当作可保存表格/公式的高级格式。

旧拓展的 `dependencies:[{id:"quizforge.richtext",version:"精确版本"}]` 继续支持；已知旧版本由宿主兼容表匹配，未知版本沿用精确加载。不要修改已发布 manifest 来补新声明。历史使用保存时冻结的精确实现，不应用当前兼容表重新选择。题目编辑器由拓展目录下可选的 `editor.json` 声明：

```json
{"entry":"editor.html","script":"editor.js","style":"editor.css"}
```

HTML 是 body 片段；CSS 和 JS 由宿主注入。页面及规则脚本按普通脚本执行，不能直接留下 ESM `import` 或 Node `require`。需要模块化开发时，在自己的拓展目录内预打包成声明的单文件，不改宿主构建。各路径必须指向本拓展内的真实文件，不能越界或依赖外网 CDN。

可选 `manifest.assets` 是练习／编辑共用的静态图片与字体列表，最多 100 个本包相对路径、单文件 1 MiB、合计 8 MiB；支持 PNG/JPEG/WebP/GIF/SVG、WOFF/WOFF2/TTF/OTF。不需要时省略，不照抄示例中不存在的文件。宿主将声明资源提供给 HTML/CSS 相对引用；旧开发标记的同名列表仅兼容读取；新文件直接在 manifest 声明，人工移除标记前核对声明完整。`editor.json` 仍只声明 entry/script/style。动态作答与题干富文本图片由 `QF.resources` 和内容哈希管理；放在 `assets/` 的 PNG/JPEG/WebP/GIF 仍可作为内容资源，静态 SVG／字体须声明且不作为富文本图片节点。

拓展目录可保留未使用的 SVG／字体等原型文件，它们不会因存在于 `assets/` 就被提供给页面或作为富文本资源；页面使用时仍须声明。题库自身的 `assets/` 继续只接受 PNG/JPEG/WebP/GIF。

## 页面上下文

当前页面及规则环境公开只读 `QF.api:{major:1,minor:2,capabilities:[...]}`；冻结旧页面保持自己的 1.0／1.1 版本；页面资源由宿主携带 `apiVersion`。这是已实现协议的元数据，不授予写入权限，也不意味着规则环境能使用浏览器的方法。页面继续根据 context.capabilities 决定哪些操作可用。

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

三态布局、访谈及编辑白名单只见 [UI 设计](ui-design.md)；本节仅定义页面可用数据与权限。

| UI | 应实现的行为 |
| --- | --- |
| 练习作答 | 恢复`answer`；按 `canSave/canSubmit` 开放输入、草稿保存和提交；提交前不展示私有标准答案。 |
| 提交后结果/评分 | 展示服务器`result` 和提交后投影；锁定作答输入；仅按 `canRetry/canReview/canAiGrade` 显示重做、人工评分和 AI 操作。待评分 `score:null` 不可显示为 0 分。 |
| 题目编辑 | 使用独立 editor 页面与`QF.editor.register`；编辑私有原题、标准答案、解析等；由宿主读取文档并落盘。 |

`mode:"example"` 是拓展示例练习，使用独立示例状态；不要把示例写入题库。`mode:"history"` 复用练习页面展示冻结快照：所有上述 capabilities 为 `false`，`aiTask:null`，必须纯只读；不保存、不上传、不启动 AI 或轮询、不尝试由当前题库补全旧内容。历史只能读取图片及已声明 SDK；`QF.requestAction` 也会被拒绝，历史切题由宿主负责。

宿主解释 [题库 features](bank-format.md#整库功能开关)，拓展只按 context.capabilities 操作，不猜存储方式或直接写状态。编辑上下文与练习投影不同，不能用公开数据覆盖私有原题。

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
let originalQuestion;
QF.editor.register({
  async onLoad(context) {
    originalQuestion = context.question;
    /* 只填必要内容控件，并将原始草稿 JSON.stringify 后记录为 originalSnapshot。 */
  },
  async getDocument() {
    await flushInputs();
    // 校验失败应抛错；只返回题名和该题型完整私有数据。
    return {title: originalQuestion.title, data: readQuestionData()};
  },
  hasChanges() { return JSON.stringify(readRawDraft()) !== originalSnapshot; },
  async exportDraft() { await flushInputs(); return readRawDraft(); },
  async importDraft(draft) { /* 恢复未完成输入，不要求题目已通过提交校验 */ },
  onFlush: flushInputs,
  onDispose: disposeInputs
}).catch(showError);
```

`hasChanges/exportDraft/importDraft` 可选，但完整编辑器应实现：草稿需 JSON/structured-clone 可序列化，并能保留暂时无效的原始输入。宿主恢复时先 `onLoad`、后 `importDraft`；导入不能把草稿当作新的“未修改”基线。缺少 `hasChanges` 时宿主按已修改处理；已有恢复草稿而缺 `importDraft` 会加载失败。`getDocument` 不返回 ID、拓展绑定、练习状态或整份题库；这些由宿主维护。

`readQuestionData()` 合入必要内容修改并保留原 data 的隐藏字段／稳定 ID；默认保留原 title。返回字段必填不等于要加输入框，控件只按 [编辑白名单](ui-design.md#简洁布局与编辑白名单)。

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
| `QF.save({purpose:"submit",data:{answer}})` | 提交完整答案，由后端`grade` 评分。 |
| `QF.save({purpose:"review",data:{review}})` | 人工评分；`review` 至少包含有限数值 `score`，额外字段由本题型 `review` 校验。 |
| `QF.requestAction({action:"retry"})` | 由宿主重置当前题作答状态。 |
| `QF.requestAction({action:"previous"})` / `({action:"next"})` | 练习切题；最后一题 next 打开汇总。 |
| `QF.requestAction({action:"goToQuestion",params:{questionId}})` | 跳到本集合中存在的题目。 |
| `QF.ui.resize()` | 请求宿主按 body 高度调整 iframe；不接收布局参数。 |

不支持自定义 action、跨题库跳转、任意后端调用、修改题型绑定或直接写练习状态。页面不能伪造评分结果；提交参数是 `answer`，不是 `result`。历史和编辑模式拒绝上述 save/action。

AI 仅在当前已提交题目且 `canAiGrade===true` 时开放；人工改分与 AI 结果保存仍受 `canReview` 限制：

| 调用 | 说明 |
| --- | --- |
| `QF.ai.grade({force:false})` | 发起/复用当前题评分任务；`force:true` 重新评分。 |
| `QF.ai.getTask({})` | 返回 envelope，其`data` 为 `{task: 任务或null}`。 |
| `QF.ai.getTask({taskId})` | 返回 envelope，其`data` 为该任务。 |
| `QF.ai.retry({taskId})` | 重试任务，返回任务。 |
| `QF.ai.confirm({taskId,candidateVersion,score})` | 保留的兼容/幂等接口；已确认任务可重读正式结果。传候选 `version` 防止使用过期结果；score 可省略。新页面无需提供确认按钮。 |

任务状态包括 `queued/running/succeeded/failed/superseded/confirmed`；校验结果在 `task.candidate`，包含 `version/score/feedback`。通过校验且仍对应当前答案的 AI 结果，由宿主自动调用拓展 review 并原子保存正式分数与反馈，任务进入 confirmed，无需用户再次确认。返回均需检查 `ok`。宿主绑定当前题目、答案和版本并提供请求 ID；页面不得提交自己的评分输入、provider 配置或凭据。评分进度与失败可重试提示保留，失败/过期结果不能改动已有分数。轮询必须在离开题目和 `onDispose` 时停止。

新版简答 1.3.0 提交时保存默认 0 分，人工滑条以拓展规定步长（简答为 0.5）调用既有 `QF.save({purpose:"review",...})`，调整后自动保存，不另设“确认评分”步骤；已发布旧包保留原 UI。连续调整应合并或串行保存，处理返回错误并在 onFlush 等待最后一次保存；不得把尚未成功保存的本地分数当作已确认结果。人工/AI 的正式反馈使用实际最终得分，人工改分应保留原 AI 理由。

需要新版简答交互时核实实际安装的 1.3.0 并精确绑定，不自动替换用户旧题库／旧包。

是否在提交后自动发起 AI 评分由应用设置的 autoGrade 控制（默认关闭），题卡也保留手动发起按钮。拓展不读写 AI 配置，不自行重复启动提交后的自动任务；按既有任务接口读取当前进度、显示结果与失败重试。

## 同步规则 API 与评分归属

`rules.js` 必须调用一次 `QF.defineType({...})`，独立规则进程只提供这个 QF 接口，没有页面的 `QF.save/content/resources`。所有方法必须**同步返回可 JSON 编码的值**，不能返回 Promise，也不能使用 DOM、网络、文件系统、动态编译或依赖外部进程状态。

| 方法 | 契约 |
| --- | --- |
| `validateQuestion(data)` | 可选；question schema 先执行，再执行此方法；返回`false` 拒绝题目。跨字段条件在此校验。 |
| `validateAnswer(answer,data)` | 可选；answer schema 先执行；返回`false` 拒绝。草稿和提交均受校验。 |
| `project(data,state)` | 必需；返回公开`question.data`。正常投影 state 为 `{submitted:boolean,result}`。提交前主动构造不含标准答案/评分细则的对象，禁止简单展开私有 data。 |
| `grade(data,answer)` | 必需；返回正式 graded 结果或 pending 待评结果。不能让页面承担判题。 |
| `review(data,answer,review)` | 可选；将人工调整或 AI 自动保存的 score 转为 graded 结果；验证范围、步长、额外字段。不可返回 pending。 |
| `getScore(data,state)` | 新题型应实现；返回`{score,maxScore,outlineStates?:[{id,status}]}`，不重判题。批量评分的 state 含 `status/answer/result/revision` 及派生 `submitted`。未提交返回 0 分；pending 返回 null；graded 返回保存的正式分数。 |
| `prepareAiGrading(data,answer)` | 可选；从私有题目与已提交答案构造下述 AI 输入，仅提供输入，不调用模型。 |

`grade/review` 的结果必须为对象，并始终包含 `feedback`（可为 `null`）：

```js
// 自动/人工完成评分；gradingStatus 可省略，默认 graded。
{gradingStatus:"graded", score:3, maxScore:5, correct:false, feedback:"评分说明"}
// 人工或 AI 待评分；仅 grade 可以返回。
{gradingStatus:"pending", score:null, maxScore:5, correct:null, feedback:null}
```

`maxScore` 是有限非负数；graded 的 `score` 是 `[0,maxScore]` 内有限数，`correct` 为 boolean。`correct` 的含义由拓展决定。`getScore` 在 pending 时必须 `score:null`，其他状态分数有限且合法；保存 AI 结果时的 getScore 必须与正式 result 的 score/maxScore 相同，如果返回 gradingStatus 也必须一致。大纲采用精简的满分判定：未提交为 unanswered，提交后满分为 correct，低于满分或仍 pending 为 incorrect；pending 仍是 null 分，保留评分进度/错误说明。小题通过 getScore.outlineStates 提供同样三种状态，宿主不猜测私有小题分数。类型自己的分值、部分得分、解释和人工评分校验全部留在拓展规则；宿主只做通用持久化、调用、验证和汇总。

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

只有声明 `requiresRichText` 或旧式富文本依赖后才能访问 `QF.content`。静态渲染包随页面加载；编辑包在首次 `createEditor` 时由宿主延迟加载同一已选择的实现。`QF.content.api` 提供公共接口、文档格式、配置与能力的元数据；依照声明和配置使用功能，不检测供应包版本或依赖 Tiptap 内部对象。直接使用以下公开 API，不调用 `_createEditor`、自行 configure 宿主资源桥或复制修改 shared SDK。

| API | 参数及返回 |
| --- | --- |
| `QF.content.render(container,doc,options={})` | container 为 DOM 元素，doc 为下述 JSON 文档；options 仅支持`resources` 覆盖，通常省略。返回 `{ready:Promise<void>,destroy()}`；ready 等待图片处理。 |
| `QF.content.createEditor(container,options={})` | options：`doc`、`onChange(doc)`、`placeholder`、`contentWidth`；高级集成还接受 `resources/setExpanded`，通常保留宿主默认桥接。返回下述 editor。 |
| `validateDocument(doc,{requireContent:false})` | 返回 boolean；`requireContent:true` 要求存在非空文字、图片或公式。 |
| `cloneDocument(doc)` | 验证并深拷贝；无效文档抛错。 |
| `isEmpty(doc)` | 空或无效文档返回 true。 |
| `fromEditorDocument(doc)` | 清理编辑器 JSON attrs 后验证/拷贝；不是 HTML、Markdown 或 Office 转换器。 |
| `EMPTY_DOCUMENT` | `{type:"doc",content:[{type:"paragraph"}]}`；使用 cloneDocument 获得自己的副本。 |

editor 方法：`ready`、`getDocument()`、`setDocument(doc)`、`focus()`、`flush()`、`isUploading()`、`destroy()`；`advanced-v1` 另提供 `setAdvanced(boolean)`、`isAdvanced()`。`ready` 和 `flush/setAdvanced` 为 Promise；setDocument 不发 onChange。保存/切字段前 `await editor.flush()`，再取 getDocument，处理上传失败。每个 iframe **只允许一个活动富文本 editor**；创建第二个前先 flush 并 destroy 第一个，其他字段用静态 render。销毁后不要使用；每次重绘先 destroy 旧 renderer/editor。

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

`advanced-v1` 支持 paragraph、heading（level 1–3）、blockquote、bulletList/orderedList/listItem、codeBlock、horizontalRule、image、table/tableRow/tableCell/tableHeader、text、hardBreak、inlineMath/blockMath。marks 支持 bold/italic/strike/underline/code/link/textStyle/highlight/subscript/superscript。字体、字号、行距应从公开的 `FONT_FAMILIES/FONT_SIZES/LINE_HEIGHTS` 枚举选择；颜色为 `#RRGGBB`，链接只允许 http/https/mailto。图片属性是 assetId，不接受 src/URL/base64；数学属性是 latex，不接受 HTML。`basic-v1` 沿用基础格式：不支持表格/公式、textStyle/highlight/subscript/superscript、段落对齐/行距和图片 width/align；其节点和属性以对应基础配置校验器为准。

文档最多深度 32、5000 节点、100000 文本字符、40 图片；高级配置的公式 latex 最多 2000 字符；表格最多 30 行/每行最多 30 个有效列；image width 为 24–2400 整数。需复杂表格/mark attrs 时先只读查看 `core/shared/richtext/service.json`，再阅读所选配置实现的 `src/document.js` 实际白名单，禁止靠示例猜任意 attrs。文档是 QuizForge 的持久化协议，不保存编辑器私有节点、HTML 或供应包版本。

## 图片、宽度与运行限制

`await QF.resources.put(file)` 接收浏览器 File/Blob，支持 PNG/JPEG/WebP/GIF，每图最多 4 MiB，返回 `{id,mime,size}`，失败抛错。文档使用 `id` 作为 assetId。`await QF.resources.get(id)` 返回 `{url,mime,size}`；id 必须 64 位小写十六进制，url 是当前 iframe 的 Blob URL，不可持久化到题库。富文本默认已连接这些资源接口。

iframe 不允许外网 fetch、脚本/CDN、外部图片、表单提交或访问宿主 DOM；仅 `sandbox="allow-scripts"`，图片允许 data/blob。规则执行环境也没有网络/文件 API，不能获取凭据。不要用 localStorage/父窗口内部对象作为保存通道，也不要自行组装宿主 postMessage 私有协议。

宿主桌面练习世界宽 760px，手机阅读为流式宽度；现有简答卡片为 `width:100%;max-width:704px`。新 UI 使用响应式宽度、`min-width:0`、一致的正文 padding，避免固定最小宽度或大量横向溢出。练习、结果、题目编辑的正文宽度保持一致；`createEditor({contentWidth})` 指**正文内容宽度**，可省略交由组件测量，高级模式会保留此宽度。`setAdvanced(true)` 展开当前同一编辑器，由宿主提供全屏布局，不创建另一套 editor；不要误用不存在的 `QF.ui.expand/setWidth`。

资源限制：manifest/editor.json 最多 256 KiB；声明的页面 HTML、JS、CSS、rules、schema 各最多 1 MiB；examples 和单份题库最多 8 MiB。规则输入最多 8 MiB、输出最多 2 MiB、单次 VM 执行限 650ms，子进程堆限 96 MiB，宿主总执行期限 8 秒。编写线性、纯同步规则，不用大规模枚举/递归或在投影中返回重复大资源。

宿主只保留当前活动 iframe/白板/编辑器；切标签时旧页面会被 flush、销毁，恢复时重新构造，因此不依赖后台隐藏页面运行。题型在 onDispose 清理自建 timer、监听器、observer、renderer、editor、Object URL；异步回调检查 disposed/epoch。宿主会释放 `QF.resources.get` 创建的 URL，单 iframe 读取图片累计限 16 MiB；拓展自建 URL 仍需自行 revoke。

宿主 JSON 缓存已受 LRU 数量、字节及 5 分钟空闲期限制：题目 12 条/16 MiB、页面 4 条/4 MiB、SDK 4 条/8 MiB。拓展不扩容、不建立绕过这些限制的全局长期缓存、不改宿主清理逻辑。

## 版本与历史兼容

当前支持 API 1.0／1.1／1.2，缺 requiresApi 按 1.0 读。显式声明只允许 major、minMinor、capabilities：前两项是整数，当前 major=1、minMinor 为 0–2；capabilities 可省略，不重复、不含空字符串。能力为 practice、editor、editor-drafts、score、manual-review、ai-grading、resources、richtext、navigation、lifecycle，子题定位另用 outline-items（minMinor>=1），子题状态用已有 score（minMinor>=2），见 [子题接口](#子题导航与状态)。未知版本／能力在执行规则前拒绝，不能只提高声明假装实现 API v2。

requiresRichText 独立声明公共服务 API、文档格式、配置与实际能力；与应用、拓展和 Tiptap 版本分别独立。富文本声明细则见 [清单](#清单与公共服务声明)。

新拓展与新样例可声明 API 和顶层题库 `formatVersion:1`；严禁为补字段修改已经发布的 Manifest、已练习题库或旧绑定。缺省按 v1 是读取规则，不是转换操作。历史按每份冻结页面的 apiVersion 加载，缺字段按 v1.0；同一轮可有不同题型，不按当前安装包或轮次顶层版本重判旧页面。

代码更新／样例例外／发布流程只见 [拓展开发](extension-development.md#更新与发布)。技术兼容上，富文本修复由宿主选择满足原声明的实现，无需更改拓展版本；旧 basic 配置不自动扩大为 advanced。历史／精确 SDK 端点使用固定不可变快照，不因当前源码变化刷新，禁止删除或覆盖快照强迫更新。需要新公共能力时报告维护者，不改 shared 或伪造声明。

混合题库每题绑定自己的拓展版本；题型页面只使用该题上下文，不假设集合只有一个类型。历史页面由宿主解析保存的 page/pageKey 和 SDK 依赖；缺快照引用应报错，不能由当前安装版本兜底。拓展无需也不应自行解析历史存储。

## 子题导航与状态

父题保留一份完整 answer、草稿、提交状态、历史和总分。大纲只建立父题内定位，不为小题另建状态或重复累加分数。目录形状、ID／标签约束和矩阵分组只见 [题库大纲](bank-format.md#矩阵大纲与显示编号)。

显式 parts 要求 manifest 声明 `requiresApi:{major:1,minMinor:1,capabilities:["practice","editor","score","outline-items"]}`，实际增加或删减不需要的可选能力。页面／编辑器都实现 `onOutlineNavigate(itemId)`。仅为缺显式 outline 的文件提供可选同步规则 `getOutlineItems(data)`，返回有序 `[{id,label}]` 或无小问时 `[]`，不返回 Promise。显式配置优先、跳过生成钩子；派生目录不得泄露私有答案、分值或 HTML。

```js
QF.page.register({
  async onLoad(context) { await renderQuestion(context); }, // 自行渲染并填充 targets
  async onOutlineNavigate(itemId) {
    const target = targets.get(itemId);
    if (!target) return false;
    target.scrollIntoView({block:'center', behavior:'auto'});
    target.focus({preventScroll:true}); // 容器可设 tabIndex=-1
    return true;
  },
  onDispose() { targets.clear(); disposeRenderers(); }
});
```

`targets` 是本 iframe 渲染时按稳定小题 ID 建立的 Map，片段不代替其他必要钩子。回调 true／undefined 表示完成，false 报 OUTLINE_ITEM_NOT_FOUND，其他失败可抛带 code 的 Error。等渲染／图片就绪再定位；编辑回调保留 getDocument／草稿钩子，切活动富文本目标先 flush 再 destroy。宿主先打开父题、同父题复用 iframe，不重置答案／白板；goToQuestion 仍只接受顶层题 ID，不能用子题 ID、宿主 DOM 或私有消息绕过。

历史定位来自冻结目录和页面，只读，不用当前题库重建或创建作答编辑器。编辑定位使用已保存目录；getDocument 返回 title/data，宿主保留显式 outline，不推断私有数据增删／重排／改号。结构变化需同步维护题库目录，目标已删应返回 false；规则派生目录在保存后刷新。

### 小题对错状态

依赖小题状态时 minMinor=2，仍用 score／outline-items，无新方法或保存端点：

```js
// getScore 的返回值；score/maxScore 仍是整道父题
return {score, maxScore, outlineStates:[
  {id:'part-a', status:'correct'},
  {id:'part-b', status:'incorrect'}
]};
```

outlineStates 每项严格只有 id/status，最多 100 项、父题内 ID 唯一并遵守目录 ID 的纯文本限制；按稳定 ID 匹配，不按 label，多余 ID 不着色。未提交含草稿只能 unanswered；提交后小题得满分为 correct，部分分／零分／仍待评分为 incorrect。pending 正式分数仍为 null，不因错误色伪造零分。省略细节的小题中性，不能套父题对错或从人工总分猜小题分数。

grade/review 把逐小题细节保存在正式 result 的自有 feedback 结构，getScore 读取已保存结果并输出状态，不重新判分；AI 校验可能只给 submitted/result，不依赖 answer／revision。此接口当前不接收小题数值 score/maxScore，不能往 outlineStates 塞额外字段；宿主总分只累加父题输出。

宿主在答案／评分变化时刷新并缓存，白板不触发重算；历史冻结当轮状态，不调用当前规则补判，旧记录缺字段时保持中性。实际测试跨父题进入、同父题连续定位、编辑未保存内容、历史定位、草稿中性、评分／重做着色及不同父题相同小题 ID 的隔离。缺能力则说明限制并给题卡内导航替代，不改宿主。

## 核对源码入口

页面协议：`core/web/frame.js`、`core/web/extension-requests.js`、`core/web/practice-context.js`、`core/web/ai-client.js`。规则与 AI 输入校验：`core/server/rules-runner.cjs`、`core/src/main/java/io/quizforge/web/AiGradingProtocol.java`。富文本服务选择：`core/shared/richtext/service.json`；配置实现：该文件指定的 `core/shared/richtext/<provider.version>/src/{static,document,render,editor}.js`。完整现行富文本/AI 示例：`extensions/基础题型/short-answer-1.3.0/{editor.js,practice-ai.js,src/rules.js,src/ai-document.js}`。基础自动判分示例：`extensions/基础题型/single-choice/`。这些核心入口仅供只读核对；没有 `core/` 的旧平铺 fixture 对应根层路径。
