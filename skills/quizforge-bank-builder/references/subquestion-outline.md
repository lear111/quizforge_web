# 组合题与子题大纲（Extension API v1.1）

材料含共享题干和多个小问时，优先让一个能承载整组题的拓展保存一个父题。子题大纲提供父题内部的定位入口；父题仍只有一份完整答案、草稿、提交状态、历史快照和总分。不要为了加入大纲把小问复制成顶层题目，或让宿主重复累加小问得分。

基础页面、保存、判分和富文本接口仍见 [拓展接口](extension-api.md)。本节补充 API v1.1 的可选能力，题库格式仍为 v1；不用此功能的旧拓展及旧题库无需修改。

## 声明能力

新拓展 manifest 在实际需要的能力中加入 `outline-items`，同时声明 `minMinor:1`：

```json
{
  "requiresApi": {
    "major": 1,
    "minMinor": 1,
    "capabilities": ["practice", "editor", "score", "outline-items", "lifecycle"]
  }
}
```

这是 manifest 的相关字段示例，完整包仍需 entry/script/style/rules/schema/examples 和可选 editor.json。富文本需求继续单独用 `requiresRichText` 声明。不声明此能力时不得注册 `getOutlineItems`；`minMinor:0` 与 `outline-items` 不兼容。仅声明能力但没有提供此方法时，宿主视为没有子题入口。

## 规则提供顺序与标识

在自己的纯规则对象中增加同步方法：

```js
QF.defineType({
  // project、grade、getScore 及其他实际需要的方法仍按基础契约实现。
  getOutlineItems(data) {
    return data.parts.map(part => ({id: part.id, label: part.number}));
  }
});
```

以上只展示新增方法，不能把这个缺少 project/grade 的片段当作完整 rules.js。`data.parts` 属于这个示例题型自己的数据设计，不是宿主新增的通用题库字段；schema、project、编辑器和判分规则应一致地处理它。

返回值必须是按材料顺序排列的数组，每个父题最多 100 项。同一题库所有题型的子题目录编码总量最多 8 MiB；超限时缩短标签或拆分题库，不静默截断。每项**仅**允许 `id`、`label` 两个字段；id 长度为 1–128，label 长度为 1–80，均为去除首尾空白后不变的非空纯文本字符串，不含控制字符或 `<`、`>`。id 在同一父题内唯一，允许不同父题复用相同子题 id。没有小问时返回 `[]`，不返回 null 或 Promise。

使用稳定的子题 id，例如 `part-method`，不要在重排后根据新数组下标重新生成 id。label 使用“（1）”“（2）”或简短中性标题；不要携带 HTML、富文本、标准答案、评分细则或分值。该方法读取私有原题，但返回值会成为提交前可见的大纲，必须主动避免泄露答案。它不读取答案/状态，不判分，也不改变题目。

## 页面响应定位

练习/提交后/历史页面通过 `QF.page.register`，编辑页面通过 `QF.editor.register`，增加可选回调 `onOutlineNavigate(itemId)`。回调可为 async；它只负责父题内部的滚动或聚焦：

```js
const targets = new Map(); // 渲染时以稳定子题 id 登记本 iframe 的 DOM 元素。

QF.page.register({
  async onLoad(context) {
    await renderQuestion(context); // 自己实现；渲染后填充 targets。
  },
  async onOutlineNavigate(itemId) {
    const target = targets.get(itemId);
    if (!target) return false;
    target.scrollIntoView({block: "center", behavior: "auto"});
    target.focus({preventScroll: true});
    return true;
  },
  onDispose() {
    targets.clear();
    // 继续清理自己的 renderer/editor、监听器、timer 和资源。
  }
});
```

登记用于聚焦的容器时可设置 `tabIndex=-1`。回调返回 undefined 或 true 表示完成定位；false 表示目标不存在，宿主会报告 `OUTLINE_ITEM_NOT_FOUND`。其他失败可抛出 Error，并可携带 code。等待异步渲染、图片和所需编辑组件就绪后再定位；目标失效时明确返回 false，不跳到另一父题。编辑页保留原有 getDocument/exportDraft/importDraft/hasChanges 等钩子，不能为了加入定位删掉保存屏障。若定位需要切换当前活动富文本字段，先 flush 并处理上传失败，再销毁旧 editor；同一 iframe 仍只能有一个活动富文本 editor。

宿主负责校验 `(父题 id, 子题 id)`，需要时先切到父题，再调用其回调。同一父题内部定位不销毁或重建 iframe，不重置答案或白板。不要自己发送私有 postMessage、访问宿主 DOM，或把子题 id 传给现有 `goToQuestion`；该 action 仍只接受顶层题目 id。

历史模式只允许阅读定位，不保存、上传、启动评分或创建作答编辑器。历史子题列表来自当轮冻结的大纲，不能用当前题库或新安装拓展重建。编辑模式的大纲以已保存题目为准；新增、删除或重排小问的未保存草稿可能尚未反映在大纲中，保存后才更新。当前草稿缺少原定位目标时回调返回 false。

## 生成与验证

题库只写父题的顶层 `questions[]` 条目，子题结构遵从该拓展自己的 schema。保存完整父题 answer；`grade/review/getScore` 返回整道父题的分值，小问的评分细节可由拓展放入 feedback。宿主不另建子题 state，也不另算子题总分。

只读校验器会检查 v1.1 声明，并在隔离规则进程中验证样例及正式题目的 getOutlineItems 输出；输出顺序保留。它不验证浏览器滚动与聚焦效果，因此 UI 原型与实际验证应包含：从其他父题进入小问、同父题连续定位、未保存编辑内容保留、只读历史定位，以及没有子题钩子的旧拓展仍正常使用。

如果应用缺少 API v1.1，向用户说明缺口，可先在拓展自己的题卡内提供小问导航；不能提高声明假装兼容，也不能由题库制作 Agent 修改宿主。新拓展仍按技能流程先确认练习未提交、提交后和编辑三个 UI，再实现功能。
