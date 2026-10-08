# 大题内的小题导航

这是 Extension API **1.1** 的可选能力。原有 API 1.0 拓展继续按一个题目一个导航按钮显示，无需更新包、题库绑定或历史。只有要提供小题导航的拓展需要发布新版本；不能覆盖已发布的相同 `id@version`。

## 拓展声明与规则

Manifest 声明最小宿主接口与能力：

```json
"requiresApi": {
  "major": 1,
  "minMinor": 1,
  "capabilities": ["practice", "editor", "score", "outline-items"]
}
```

规则注册增加可选的同步纯函数 `getOutlineItems(data)`：

```js
QF.defineType({
  project, grade, getScore,
  getOutlineItems(data) {
    return data.parts.map(part => ({id: part.id, label: part.number}));
  }
});
```

返回数组的顺序就是小题顺序。每项仅允许 `id`、`label`：非空、无首尾空白、无控制字符或 `< >` 的纯文本字符串。`id` 长度最多 128，`label` 最多 80，一道大题最多 100 个小题，ID 在该大题内唯一。ID 应稳定地标识小题，不应随重新编号改变。不要在标签中包含正确答案或尚未提交时不该公开的信息。未声明能力却注册该钩子会被拒绝；声明能力但省略钩子或返回空数组时仍显示普通大题按钮。

宿主按父题型、版本及原题序分组，大题按钮旁边显示小题矩阵。`label` 一般直接用题号，如 `1`、`2`，也可以用 `1a`。规则仍然只接收大题数据；宿主不解释 `parts` 等私有字段。目录加载时批量生成并缓存这些元数据，不挂载其他题卡或富文本编辑器，后续读取大纲不再逐题启动规则进程。

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

大纲来自已保存题目。编辑期间新增、删除、重排小题，在保存题目并刷新集合元数据后才更新大纲；编辑草稿仍由拓展拥有。这一版不提供滚动位置反向同步选中项，选中状态跟随大纲点击。

## 保存、评分与历史

小题只是父题内的位置：不会成为独立题目，也不会单独产生当前作答、历史行或分值。`grade`、`review`、`getScore` 仍由复合题拓展处理和汇总整道大题的评分；宿主分值卡只累加父题输出。小题按钮只表示位置和当前选中状态，不表示独立作答完成情况；大题按钮继续表示整题状态。

集合响应中父题行可包含 `outlineItems:[{id,label}]`，空数组时省略该字段。每轮历史冻结当时整库的父题顺序、小题顺序及标签，配合当时的页面资源定位。旧历史没有这个字段时保持原样，不调用当前规则去补小题，也不读取当前题库覆盖历史元数据。

新增小题导航不改变题库格式 v1、父题 ID、当前作答结构和富文本接口。支持该能力的应用仍能运行 API 1.0；旧应用会明确拒绝要求 API 1.1 的新拓展，不会尝试错误运行它。
