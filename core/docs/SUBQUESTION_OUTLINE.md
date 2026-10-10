# 大题内的小题导航

目录数据和页面定位是两件事。新题库在 `questions[].outline` 中明确选择显示大题或小题；小题定位使用 Extension API **1.1** 的 `outline-items` 能力。大纲统一为按原题序和大题题型连续分组的单层矩阵，现有题库及历史也不再显示重复的大题按钮或占位列。完整题库格式见 [题库说明](QUESTION_BANK_FORMAT.md)。

## 题库提供目录

在顶层题目的 `id/title/extension/data` 同层填写两种互斥形式之一：

```json
"outline": {"level": "question", "label": "三"}
```

```json
"outline": {"level": "parts", "items": [{"id": "part-a", "label": "21"}, {"id": "part-b", "label": "22"}]}
```

第一种只显示大题自身，第二种只显示小题。`question` 仅有 level/label；`parts` 仅有 level/items，items 为 1–100 项。标签与 ID 的纯文本约束见下文。每题显式配置都会跳过它的 `getOutlineItems(data)` 调用，拓展不能覆盖题库选择。显式 parts 要求该拓展声明 API 1.1 的 `outline-items` 并实现页面定位，缺能力会报 `OUTLINE_CAPABILITY_REQUIRED`。

宿主先按 questions 顺序展开每题的自身入口或有序 items，再合并相邻的大题题型 ID/版本。小题全部继承其大题的题型名称，不因交互样式不同另行分类；被其他题型隔开的同型仍保持原位置。相邻同型大题的所有入口共享同一个矩阵，不为每道大题强制换行。

## 拓展声明与规则

Manifest 声明最小宿主接口与能力：

```json
"requiresApi": {
  "major": 1,
  "minMinor": 1,
  "capabilities": ["practice", "editor", "score", "outline-items"]
}
```

没有显式题库 outline 的现有文件，可以继续通过以下可选同步纯函数提供目录。新题库已声明目录时不需要实现它；需要保留的是下节的页面定位回调：

```js
QF.defineType({
  project, grade, getScore,
  getOutlineItems(data) {
    return data.parts.map(part => ({id: part.id, label: part.number}));
  }
});
```

返回数组的顺序就是小题顺序。每项仅允许 `id`、`label`：非空、无首尾空白、无控制字符或 `< >` 的纯文本字符串。`id` 长度最多 128，`label` 最多 80，一道大题最多 100 个小题，ID 在该大题内唯一。ID 应稳定地标识小题，不应随重新编号改变。不要在标签中包含正确答案或尚未提交时不该公开的信息。未声明能力却注册该钩子会被拒绝；声明能力但省略钩子或返回空数组时仍显示普通大题按钮。

`label` 一般直接用题号，如 `1`、`2`，也可以用 `1a`。规则仍然只接收大题数据；宿主不解释 `parts` 等私有字段。仅对缺少显式配置的题目批量生成并缓存这些元数据，不挂载其他题卡或富文本编辑器，后续读取大纲不再逐题启动规则进程。派生的小题也按修复后的单层矩阵显示。

## 练习、提交后与编辑页面

单个集合派生的大纲元数据总量上限为 8 MiB（JSON 的 UTF-8 大小）。超过时会明确拒绝加载，制作者需拆分题库或减少小题与标签；原题库保留。

练习页面和编辑页面分别增加可选的定位钩子：

```js
QF.page.register({
  onLoad(context) { renderQuestion(context); },
  onOutlineNavigate(itemId) { focusPart(itemId); }
});

QF.editor.register({
  onLoad(context) { renderEditor(context); },
  getDocument, hasChanges, exportDraft, importDraft,
  onOutlineNavigate(itemId) { focusEditorPart(itemId); }
});
```

钩子允许返回 Promise；返回 `undefined` 或 `true` 表示成功，返回 `false` 表示小题已不存在，宿主保留之前的选中项。拓展应根据 ID 滚动到对应内容，练习和编辑时可聚焦输入框；历史状态只定位，不修改答案。不存在或暂时被编辑删除的小题应抛出清楚的错误。已提交状态也应能定位只读答案和评分反馈。宿主先打开父题并等待页面注册，再调用定位钩子；同一父题内切换小题复用当前 iframe。缺失钩子、钩子异常或超时会显示错误并保留当前页面。离开父题仍执行原有保存和编辑草稿流程。

大纲来自已保存题库。当前编辑接口保留显式 outline，不推断拓展私有数据中的增删、重排或改号；改变小题结构时需同步维护显式目录并验证定位。仍由规则派生目录的题目在保存并刷新后更新。编辑草稿由拓展拥有。这一版不提供滚动位置反向同步选中项，选中状态跟随大纲点击。

## 保存、评分与历史

小题只是父题内的位置：不会成为独立题目，也不会单独产生当前作答、历史行或分值。`grade`、`review`、`getScore` 仍由复合题拓展处理和汇总整道大题的评分；宿主分值卡只累加父题输出。API 1.2 在现有 `getScore(data,state)` 返回值中增加可选 `outlineStates`，宿主据此显示小题状态；没有新增方法或能力名称。

```js
getScore(data, state) {
  const submitted = state?.submitted || state?.status === 'submitted';
  return {
    score: submitted ? state.result.score : 0,
    maxScore: data.maxScore,
    ...(submitted
      ? (Array.isArray(state.result?.feedback?.outlineStates)
        ? {outlineStates: state.result.feedback.outlineStates}
        : state.result?.gradingStatus === 'pending'
          ? {outlineStates: data.parts.map(part => ({id: part.id, status: 'incorrect'}))} : {})
      : {outlineStates: data.parts.map(part => ({
          id: part.id,
          status: 'unanswered'
        }))})
  };
}
```

示例私有结构是 `data.parts`、`data.maxScore` 和以小题 ID 为键的选项答案。`grade/review` 将逐小题的正式结果保存到 `result.feedback.outlineStates`，`getScore` 读取保存的结果，不重新判分；这个 feedback 字段是示例拓展自己的设计，宿主只读取 getScore 的输出。小题获得满分时输出 correct，其余已评分结果（包括部分得分和零分）输出 incorrect。pending 的整题分数仍为 null。AI 校验路径可能仅提供 submitted/result，此时也应能读取已保存的细节，不能要求 answer 总是存在。

每项严格为 `{id,status}`，最多 100 项，ID 纯文本长度 1–128 且在大题内唯一；与目录的稳定 ID 相匹配，题号 label 不用于匹配。大纲只提供 `unanswered`（中性）、`correct`（正确）、`incorrect`（错误）三种状态。未提交时仅允许 unanswered，即使已保存答案草稿也不显示另一种状态或提前公开正确性。提交后已有满分结果为 correct，低于满分或仍待评分为 incorrect；AI/人工保存实际分数后更新颜色。待评分仍保存 `score:null`，页面保留评分中或失败说明，不能把这种按钮颜色当作已判零分。总分是否 pending 仍由原 result 决定，不由按钮状态推算。

依赖小题状态的新拓展声明 `requiresApi.minMinor:2`，能力仍用已有的 `score` 和定位所需 `outline-items`；旧声明可以继续运行，不必为应用更新改包。数组可省略或为空；没有逐小题细节的入口保持中性，不继承整道大题的对错。只匹配当前父题目录中的 ID；多余 ID 不着色，不影响其他大题。选择只显示大题时，不显示小题状态。

当前响应在 `state.outlineStates` 中提供匹配的状态，分值卡每个父题汇总行可带同名数组。宿主按题目/拓展内容、答案、result 缓存，笔迹和视口变化不重新计算；缓存最多 512 个父题、2 MiB，超限释放较早使用的项。批量刷新仍按拓展分组，含小题定位能力的拓展每批评分最多 24 个父题，普通题型保持原有批量上限，不为每个小题启动进程。重做、改答案或更新评分会使对应缓存失效。

集合响应中父题行可包含显式父题的 `outlineLabel`，或小题的 `outlineItems:[{id,label}]`；两者互斥，空小题目录省略字段。每轮历史冻结当时整库的父题顺序、小题顺序及标签，配合当时的页面资源定位。历史展示统一采用新矩阵，但不调用当前规则去补小题，也不读取当前题库覆盖历史元数据。只修改导航标签/入口选择不影响题目内容指纹，不重置当前作答。

小题状态在历史的 payload.state 与完成汇总中冻结，打开只读历史不调用当前 getScore 去补状态。旧记录没有该字段时仍保持中性，不凭整题结果猜测小题对错。这个可选字段不改变题库格式 v1、父题 ID 和富文本接口。当前应用支持 API 1.0／1.1／1.2；旧应用会明确拒绝声明要求 API 1.2 的新拓展。
