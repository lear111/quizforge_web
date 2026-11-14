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

`manifest.json`：

```json
{
  "id": "quizforge.single-choice",
  "version": "2.0.0",
  "name": "单选题",
  "apiVersion": 2,
  "entries": {
    "practice": { "html": "practice.html", "js": "practice.js", "css": "practice.css" },
    "grade": "grade.js"
  },
  "sdkVersions": { "richtext": "1.0.0" }
}
```

题库里用 `"type": "quizforge.single-choice@2"` 指向它，`@` 后面是 `version` 的主版本号。改了 `question`、`solution` 或 `answer` 的数据格式，必须升主版本号。

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
| `QF.page.grade({ score, parts, message })` | **待实现（D60）。** 用户人工打分或改分。只在本题已锁定时有效；宿主检查分数后保存，再用新的 `context` 调用 `load`。写法同 4.2 的返回值 |
| `QF.page.regrade()` | **待实现（D62）。** 请求宿主重新调用评分函数。只在本题已锁定时有效 |
| `QF.resources.get(引用)` | 把题库里的 `qf-asset:路径` 换成可以显示的地址 |
| `QFRichText.render(节点, 文档)` | 显示富文本。返回对象的 `ready` 在显示完成时结束 |

> 已决定（D54，尚未实现）：富文本内容将改为受限的 HTML 字符串，`render` 的第二个参数届时传这段字符串，调用方式不变。允许的标签和样式见[数据结构说明书](../design/V2_DATA_STRUCTURES.md) 1.1 节。

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

`grade.js` 在一个没有界面的隔离环境里运行，不能访问页面、网络和文件，必须是纯计算。

```js
QF.grader.register({
  grade(question, solution, answer, item) {
    const correct = answer?.selected === solution.selected;
    return { score: correct ? item.maxScore : 0 };
  }
});
```

`answer` 可能是 `null`（用户没有作答就提交）。

**需要 AI 的题型（待实现，D61、D62）。** `grade` 可以是异步函数，在里面请求 AI：

```js
QF.grader.register({
  async grade(question, solution, answer, item) {
    const reply = await QF.ai.ask({ prompt: '……', images: [ … ] });
    return { score: 解读(reply.text), message: '评语……' };
  }
});
```

| 调用 | 作用 |
|---|---|
| `QF.ai.ask({ prompt, images })` | 请宿主问一次 AI，返回 `{ text }`，内容是 AI 的原始回答。只能在 `grade` 运行期间调用。最多等 2 分钟；超时、断网、未配置等情况会抛出错误，错误的 `message` 是可以给用户看的原因 |

提示词怎么写、回答怎么解读、最后给几分，都由你决定。请求失败时，你可以接住错误并返回 `{ score: null, message: 原因 }`，也可以不接；两种做法的结果相同：这道题停在"已提交、没有分数"，用户可以重新评分或人工打分。宿主不会自动重试。

### 4.2 返回值

| 情况 | 返回 |
|---|---|
| 能评分，没有小题 | `{ score: 数字 }` |
| 能评分，有小题 | `{ score: 数字, parts: { 小题id: 数字 } }`，各小题得分合计等于 `score` |
| 需要人工或 AI 评分 | `{ score: null }` |
| 评不了（数据有误等） | 直接抛出错误，错误信息会作为说明保存下来 |

`score` 必须在 0 到满分之间。分数超出范围、小题得分合计与总分不符、评分超过 10 秒（等待 AI 的时间不计入），都会被记为"无法评分"。

返回值里可以带 `message`。有分数时它是给用户看的评语（如 AI 的点评）；没有分数时是原因说明。它随分数一起保存，之后出现在做题页面的 `context.result.message` 里。

做题页面和评分模块互相不通信。评分结果由宿主保存后，再通过 `load` 交给页面显示。

得满分的小题在大纲上显示为"对"，否则为"错"，由宿主判断，你不用处理。

做题页面的 `context.result` 是 `{ score, parts, message }`：`score` 为数字表示已评分；为 `null` 表示还没有分数，这时 `message` 里可能有原因说明。没有评过分时 `context.result` 为 `null`。

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

一轮练习归档时，程序会把你的拓展文件夹复制一份，和当时的题库、作答存在一起。以后回看这一轮，用的是这份副本，所以你之后修改或卸载拓展都不影响已有的历史。

你不需要为历史写任何代码。回看时宿主照常调用 `load`，给出的事实是 `locked` 为真、`can.submit` 和 `can.retry` 为假，按 3.5 节照着画即可。

## 7. 不在本文范围

- 题型的编辑界面（第 6 段另定）。
- 答题区和手写作答：行为与数据已定（D55–D59，见总体设计决定表和数据结构说明书 1.2、2.5 节）；评分接口已定（D60–D62，见 3.3、4.1）；答题区组件的调用方式、评分环境里怎么取得答题区截图，实现前写入本文。
- 听力：由宿主根据大纲处理，不经过拓展。

## 8. 兼容承诺

apiVersion 2 之内只会增加可选的函数和字段，不改变已有内容的含义。历史里保存着旧版本的拓展，这条承诺保证它们以后仍能运行。你在 `manifest.json` 里声明的公共组件版本也会被长期保留。
