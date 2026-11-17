# 题型拓展开发说明（V2）

写给题型拓展的作者。这里只讲拓展和宿主页面之间的接口。拓展不直接和后端通信，后端接口见 [V2 接口与状态速查](../design/V2_API_AND_STATE.md)，拓展作者不需要读它。

> 状态：接口已定稿（apiVersion 2）。宿主的实现正在按本文调整，当前进度见 [V2 进度](../design/V2_PROGRESS.md)。本文与代码不一致时，以本文为准并报告问题。

## 1. 分工

| 拓展负责 | 宿主负责 |
|---|---|
| 把题目画出来 | 保存作答、锁定答案 |
| 画"提交""重做"按钮 | 决定当前是否允许提交、重做 |
| 显示得分和反馈 | 调度评分、记录分数 |
| 被问到时交出答案 | 大纲、汇总、历史、考试 |
| 报告哪个小题已作答 | 白板、听力播放 |

拓展运行在隔离页面里：不能访问网络，不能访问宿主页面，不能读写文件。它拿到的只有宿主交给它的这一道题。

## 2. 文件组成

```
extensions/<分组>/<题型>/
  manifest.json      必需
  practice.html      必需：做题页面的骨架
  practice.js        必需：做题页面的脚本
  practice.css       必需：做题页面的样式
  grade.js           必需：评分
  README.md          推荐：说明本题型的 question / solution / answer 各有哪些字段
```

现行 `apiVersion: 2` 仍要求上述 5 个必需文件，包括 `grade.js`；仅支持人工评分的主观题也必须提供 `grade.js`，可在其中返回 `{ score: null }`。未来是否允许省略评分入口尚未决定，不得按已实现功能处理。

`manifest.json`：

```json
{
  "id": "quizforge.single-choice",
  "version": "3.0.0",
  "name": "单选题",
  "apiVersion": 2,
  "entries": {
    "practice": { "html": "practice.html", "js": "practice.js", "css": "practice.css" },
    "grade": "grade.js"
  },
  "sdkVersions": { "richtext": "2.0.0" }
}
```

题库里用 `"type": "quizforge.single-choice@3"` 指向它，`@` 后面是 `version` 的主版本号。题目富文本字段改为 HTML 字符串，因此题型拓展主版本从 2 升至 3。改了 `question`、`solution` 或 `answer` 的数据格式，必须升主版本号。

程序不检查题目数据是否符合你的格式。数据写错了，你的 `load` 会出错，用户看到的是"题型页面未能加载"。所以请在 README 里把字段写清楚。

## 3. 做题页面

### 3.1 你要提供的

```js
QF.page.register({
  async load(context) { /* 画题目 */ },
  getAnswer() { /* 返回当前作答 */ }
});
```

| 函数 | 必需 | 要求 |
|---|---|---|
| `load(context)` | 是 | 按 `context` 把整道题画出来。**会在同一页面上被多次调用**：首次显示、提交后、评分后、重做后、内容在别处被修改后。每次都要按新的 `context` 完整重画，不要假设页面是空的。公式、图片等全部显示完毕后才结束 |
| `getAnswer()` | 是 | 返回当前作答。格式由你定，宿主原样保存、原样交还，不解析 |

### 3.2 你会收到的 `context`

| 字段 | 内容 |
|---|---|
| `question` | 题库中这道题的 `question`，原样 |
| `item` | 大纲中这道题的条目：`label`、`maxScore`；有小题时为 `parts: [{ id, label, maxScore }]` |
| `answer` | 上次保存的作答，没有则为 `null` |
| `locked` | 答案是否已锁定。锁定后不得再让用户修改答案 |
| `solution` | 题库中这道题的 `solution`。**锁定前为 `null`** |
| `result` | 评分结果 `{ score, parts, message }`（见 4.2），没有则为 `null` |
| `can.submit` | 当前是否允许提交 |
| `can.retry` | 当前是否允许重做 |
| `appearance` | 外观信息，如深浅色 |

### 3.3 你可以调用的

| 调用 | 作用 |
|---|---|
| `QF.page.changed({ kind, answered })` | 告诉宿主"用户改了内容"。见 3.4 |
| `QF.page.submit()` | 请求提交本题。宿主会调用你的 `getAnswer()`，保存并锁定，评分，然后用新的 `context` 再次调用 `load` |
| `QF.page.retry()` | 请求重做本题。宿主清空本题的作答、笔迹和分数，然后用初始 `context` 再次调用 `load` |
| `QF.page.grade({ score, parts, message })` | **待实现（D60）。** 用户人工评分或改分。页面只把分数通知宿主，不直接请求后端，也不执行 `grade.js`；仅对已锁定的本题有效。宿主校验并保存成功后，再用新的 `context` 调用 `load`。见 4.3 |
| `QF.page.regrade()` | **待实现（D62）。** 请求宿主重新调用评分函数。只在本题已锁定时有效 |
| `QF.resources.get(引用)` | 把题库里的 `qf-asset:路径` 换成可以显示的地址 |
| `QFRichText.render(容器, htmlString)` | 清洗并显示 HTML 富文本。返回对象提供 `ready`（资源加载完成）和 `destroy()`（清理本次渲染） |

> D54 已实现：V2 新题型的题干、选项和解析等富文本字段统一使用受限 HTML 字符串。`render` 的第二个参数传 HTML 字符串，调用方式不变；显示前由 SDK 按白名单清洗。允许的标签和样式见[数据结构说明书](../design/V2_DATA_STRUCTURES.md) 1.1 节。其他现有 V2 题库仍待负责人安排一次性迁移；不迁移任何既有作答记录。

页面高度由宿主自动测量，不用上报。

### 3.4 `changed`：保存与作答状态

用户每次修改内容后调用一次。你不需要自己保存，宿主会在合适的时候调用 `getAnswer()` 取走内容。

`kind` 说明这次是哪种修改，宿主据此决定多久后保存：

| `kind` | 用于 | 保存时机 |
|---|---|---|
| `"choice"` | 点选、勾选 | 立即 |
| `"text"` | 打字 | 停顿约 1 秒后 |
| `"ink"` | 手写 | 停笔约 1.5 秒后 |

`answered` 报告作答状态，用来更新大纲：

- 没有小题的题：`answered: true` 或 `answered: false`。
- 有小题的题：`answered: { "小题id": true }`，只写发生变化的小题即可。

"已作答"指用户给出了答案。答案被清空时要报告 `false`。白板上的草稿由宿主处理，与题型无关。

宿主收到后立即更新大纲，不等保存完成。大纲里找不到的小题 id 会被忽略。

### 3.5 按事实显示，不按场景显示

你不需要知道现在是练习还是考试、是作答中还是已完成。宿主每次调用 `load` 都会告诉你下面五个事实，照着画就行：

| `context` 里的事实 | 你要做的 |
|---|---|
| `locked` 为真 | 不让用户改答案 |
| `can.submit` 为假 | 不显示提交按钮 |
| `can.retry` 为假 | 不显示重做按钮 |
| `solution` 不为空 | 显示答案解析 |
| `result` 不为空 | 显示得分 |

各种场景只是这些事实的不同组合，由宿主决定：

| 场景 | `locked` | `can.submit` | `can.retry` | `solution` | `result` |
|---|---|---|---|---|---|
| 练习，作答中 | 否 | 是 | 是 | 无 | 无 |
| 练习，单题已提交 | 是 | 否 | 是 | 有 | 有 |
| 练习，已完成 | 是 | 否 | 否 | 有 | 有 |
| 历史回看 | 是 | 否 | 否 | 有 | 有 |
| 考试，作答中 | 否 | 否 | 否 | 无 | 无 |
| 考试，交卷后 | 是 | 否 | 否 | 有 | 有 |

按钮由你画，规则由宿主定。不允许时调用 `submit()` 或 `retry()` 会被拒绝。以后规则变了只改宿主，你的代码不用动。

## 4. 评分

### 4.1 你要提供的

`grade.js` 在一个没有界面的隔离环境里运行，当前不能访问页面、网络和文件；自动评分必须只依赖收到的数据，不能读取 `practice.js` 的 DOM 或页面状态。需要 AI 评分时，题型拓展负责理解自己的题目数据，并为当前评分对象组装上下文；可以按需纳入共享材料、当前小题，以及相关小题的题干、作答或答案解析。拓展只能经宿主提供的受控 AI 评分能力提交上下文，不得自行联网或取得模型密钥；后端负责调用模型、校验结构化结果并持久化。

```js
QF.grader.register({
  grade(question, solution, answer, item) {
    const correct = answer?.selected === solution.selected;
    return { score: correct ? item.maxScore : 0 };
  }
});
```

`answer` 可能是 `null`（用户没有作答就提交）。单题提交和集中评分共用这个入口；宿主按拓展版本（`artifactId`）分组，在未打开题目页面时也能加载 Worker 评分。当前每组内逐题执行，完成练习时各组也是依次等待结果。

**需要 AI 的题型（D61、D62、D69，待实现）。** AI 评分以评分对象为单位。没有小题时评分对象是整道大题；有小题时每次针对一个小题。拓展负责组装当前评分对象的上下文，并可选择相关小题内容；宿主只提供受控调用入口，后端负责模型调用、结构化结果校验、分数约束校验和保存。拓展不接收模型原始回答后自行定分。

```js
// 示意：具体 API 名称和参数将在第 5 阶段接口设计中确定。
const context = buildContextForPart({
  sharedMaterial,
  currentPart,
  relatedParts,
  currentAnswer,
  referenceAnswer
});
const savedGrade = await QF.ai.grade({ partId, context });
// savedGrade 是后端已校验并保存后返回的评分结果。
```

上下文由拓展按题目实际关系组装，不要求后端理解题目 JSON，也不要求所有题型使用相同的小题结构。后端必须从当前题库大纲与提交凭证核实评分对象 ID、满分和 `scoreStep`，不能信任拓展/模型自报的分数上限。单个小题可独立重新评分；AI 失败不自动重试，允许用户重试或人工接管。

### 4.2 返回值

| 情况 | 返回 |
|---|---|
| 能评分，没有小题 | `{ score: 数字 }` |
| 能评分，有小题 | `{ score: 数字, parts: { 小题id: 数字 } }`，各小题得分合计等于 `score` |
| 需要人工或 AI 评分 | `{ score: null }` |
| 评不了（数据有误等） | 直接抛出错误，错误信息会作为说明保存下来 |

`score` 必须在 0 到满分之间。分数超出范围、小题得分合计与总分不符，都会被记为“无法评分”。当前评分批次默认超时 10 秒（含源码加载）；以后 AI 请求的等待时长及超时区分按 D62 另行实现。`grade()` 必须明确 `return` 结果：`{ score: null }` 表示正常等待人工或 AI 评分，漏写 `return` 导致 `undefined` 则是无效结果。

**当前实现**：`grade.js` 返回值只允许 `score` 和可选的 `parts`，带 `message` 会被判为无效；宿主在规整后添加 `message: null`，发生错误时由宿主填入原因。有分数的结果，后端当前也只接受 `message: null`。**后续 D60–D62**：人工评分备注和 AI 评语将通过结果的 `message` 保存，届时需同步放宽宿主与后端校验，不得误认为现已支持。

做题页面和评分模块互相不通信。评分结果由宿主保存后，再通过 `load` 交给页面显示。

得满分的小题在大纲上显示为"对"，否则为"错"，由宿主判断，你不用处理。

做题页面通过 `load(context)` 接收宿主返回的已保存评分状态。D67 已将评分与评语粒度调整为单个评分对象；有小题时每个小题独立保存结果。现有 `{ score, parts, message }` 不能表达每个小题独立的分数、评语、来源和待评分状态，最终上下文/持久化结构待第 5 阶段设计。

### 4.3 人工评分（D60，待实现）

人工评分是**题目页面交互**，不需要加载或执行后台评分模块。题型作者在 `practice.js` 绘制评分输入（分数以及未来可选的评语），仅在宿主允许且本题已提交锁定时调用：

```js
QF.page.grade({ score: 8, parts: null, message: null });
```

页面与宿主通过既有 iframe 消息机制通信。Vue 宿主接到评分请求后负责校验及持久化；后端再次检查锁定凭证、请求版本、分数范围和小题分数合计。保存成功后宿主以**后端返回的结果**调用页面 `load(context)`，更新显示；手动输入的分数不能先行作为已保存结果展示。允许对已有自动评分的分数进行人工改分。

后端**拟复用**现有 `PUT /api/v2/banks/{bankId}/questions/{questionId}/result`：计划在 `source: 'grader'` 之外增加 `source: 'manual'`，并沿用 `snapshotId`、`requestId`、`submissionId`、`expectedRevision` 以防止过期、重复或越权写入。**目前前端 `QF.page.grade` 尚未实现，后端也仅接受 `source: 'grader'`**；此处是待实施协议，不是当前可调用的 API。人工评语也要等后端支持非空 `message` 后才能保存。

## 5. 完整示例：单选题

`practice.js`：

```js
QF.page.register({
  async load(context) {
    const views = [QFRichText.render(document.getElementById('stem'), context.question.stem)];

    const options = document.getElementById('options');
    options.replaceChildren();
    for (const option of context.question.options) {
      const label = document.createElement('label');
      const input = document.createElement('input');
      const content = document.createElement('div');
      input.type = 'radio';
      input.name = 'choice';
      input.value = option.id;
      input.checked = context.answer?.selected === option.id;
      input.disabled = context.locked;
      input.addEventListener('change', () => QF.page.changed({ kind: 'choice', answered: true }));
      label.append(input, content);
      options.append(label);
      views.push(QFRichText.render(content, option.content));
    }

    const submit = document.getElementById('submit');
    submit.hidden = !context.can.submit;
    submit.onclick = () => QF.page.submit();

    const retry = document.getElementById('retry');
    retry.hidden = !context.can.retry;
    retry.onclick = () => QF.page.retry();

    const result = document.getElementById('result');
    result.hidden = !context.result;
    if (context.result) {
      result.textContent = typeof context.result.score === 'number'
        ? `${context.result.score} / ${context.item.maxScore} 分`
        : (context.result.message ?? '待评分');
    }

    const explanation = document.getElementById('explanation');
    explanation.hidden = !context.locked;
    if (context.locked) views.push(QFRichText.render(explanation, context.solution.explanation));

    await Promise.all(views.map(view => view.ready));
  },

  getAnswer() {
    return { selected: document.querySelector('input:checked')?.value ?? null };
  }
});
```

`grade.js` 见 4.1。

## 6. 历史回看

一轮练习归档时，程序会把当时使用的拓展文件夹复制一份，和题库、作答存在一起。历史轮次保留归档时的题库与拓展文件。

但归档文件存在不等于永久保证可回放。按 D66，V2 题库、拓展或公共组件升级可能影响旧记录的保存或读取时，不迁移旧历史；V2 不保留旧 SDK 供历史回放，因此旧历史不保证继续能够打开。新创建的历史记录使用归档时对应的新题库格式和 SDK。旧 SDK 文件若仍被 V1 宿主引用，只因 V1 暂时保留，不构成 V2 历史兼容承诺；物理删除留第 7 阶段 V1 旧链清理。

你不需要为历史写任何代码。可回放的历史中，宿主照常调用 `load`，给出的事实是 `locked` 为真、`can.submit` 和 `can.retry` 为假，按 3.5 节照着画即可。

## 7. 不在本文范围

- 题型的编辑界面（第 6 段另定）。
- 答题区和手写作答：行为与数据已定（D55–D59，见总体设计决定表和数据结构说明书 1.2、2.5 节）；评分接口已定（D60–D62，见 3.3、4.1）；答题区组件的调用方式、评分环境里怎么取得答题区截图，实现前写入本文。
- 听力：由宿主根据大纲处理，不经过拓展。

## 8. 兼容承诺

在仍受支持的 `apiVersion: 2` 接口范围内，新增能力优先以可选函数和字段提供，不改变既有字段含义。题目数据格式变化必须升级拓展主版本号。

本节不承诺永久保留所有旧拓展或公共 SDK 版本。按 D66，当 V2 题库、拓展或公共组件升级可能影响既有记录的保存或读取时，默认不迁移当前练习、正在进行的考试或已归档历史；V2 新格式启用后停止使用旧 SDK，旧历史保留原始文件但不保证继续可回放。若旧 SDK 文件仍被 V1 宿主引用，仅暂时保留供 V1 使用，物理删除留第 7 阶段 V1 旧链清理。
