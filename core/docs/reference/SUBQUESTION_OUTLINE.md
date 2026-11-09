# 大纲与作答状态

小题是父题内的导航位置，不独立产生答案、历史行或分值。宿主只累加父题的评分结果；拓展负责内部小题的作答与评分。

## 大纲与稳定 ID

格式 2 通过顶层 `outline[].items[]` 选择父题或小题入口；旧格式 1 的逐题 outline 仅供兼容读取，升级时转换。格式见[题库说明](QUESTION_BANK_FORMAT.md#大纲)。

| 形式 | 字段 |
| --- | --- |
| 父题 | `{question:"q1",label:"三"}` |
| 小题 | `{question:"q1",parts:[{id:"part-a",label:"21"}]}` |

父题形式仅允许 question/label，小题形式仅允许 question/parts。parts 为 1–100 项；每项仅有 id/label，均为非空、无首尾空白、控制字符或 `< >` 的纯文本。小题 ID 最长 128 字符且在父题内唯一，label 最长 80；全库目录元数据最多 8 MiB。

ID 用于定位、即时状态及评分结果匹配，label 仅用于显示。重新编号不能改变稳定 ID，不在标签中公开答案。显式 parts 要求 Manifest 声明 `outline-items` 且 minMinor 至少 1，缺能力返回 `OUTLINE_CAPABILITY_REQUIRED`。显式目录不调用或接受拓展覆盖。

无显式 outline 的旧题库可由同步纯函数 `getOutlineItems(data)` 返回有序 `[{id,label}]`，注册前须声明 outline-items。省略钩子或返回空数组时显示普通父题入口；派生元数据按集合缓存，不挂载其他题目页面。

## 页面定位

```js
QF.page.register({
  onLoad(context) { renderQuestion(context); },
  onOutlineNavigate(itemId) { return focusPart(itemId); }
});
QF.editor.register({
  onLoad, getDocument,
  onOutlineNavigate(itemId) { return focusEditorPart(itemId); }
});
```

回调可返回 Promise；undefined/true 表示成功，false 表示目标不存在并保留之前选中项，异常或超时显示错误。宿主先加载父题并等待注册，同父题切小题复用 iframe。历史只定位，不修改答案；已提交页也应能定位反馈。

编辑接口保留已保存的显式目录，不推断私有 data 变化；增删小题或改号需同步维护 outline 并验证定位。选中项跟随大纲点击，不根据页面滚动反向更新。

## 即时反馈与保存（API 1.3）

```json
"requiresApi": {
  "major": 1,
  "minMinor": 3,
  "capabilities": ["practice", "score", "outline-items", "answer-state", "lifecycle"]
}
```

普通题也可使用 answer-state，只有需要小题定位时才声明 outline-items。输入变化时先报告进度，再将同一快照保存：

```js
const snapshot = structuredClone(answer);
const report = await QF.page.reportAnswerState({targetId: "part-a", status: "draft"});
if (!report.ok) throw new Error(report.error.message);
const saved = await QF.save({
  purpose: "draft",
  data: {answer: snapshot},
  answerStateId: report.data.stateId
});
if (!saved.ok) throw new Error(saved.error.message);
```

| 参数/返回 | 约定 |
| --- | --- |
| `status` | 仅 unanswered/draft；draft 表示已填写未提交 |
| `targetId?` | 省略报告当前父题；填写时必须匹配该父题大纲的小题 ID，不用题号或跨题 ID |
| 成功 | `{ok:true,data:{status:"reported",stateId}}` |
| 失败 | 标准 `{ok:false,error:{code,message}}` |

每次只更新一个入口，其余小题保持原状态；初始默认 unanswered，无需逐项初始化，清空已填答案必须显式报告 unanswered。小题变化时父题填写反馈按当前小题状态聚合。

报告立即更新大纲，本身不落盘、不计分或显示对错。stateId 是不透明的快照编号；debounce/队列必须保留其对应答案，不能把新编号用于旧答案。最多保留 256 个未确认快照，失效编号拒绝保存。

关联 draft 保存将 `{status,outlineStates}` 写入 HTTP `data.answerState`，与答案原子持久化；answerStateId 不作为 HTTP 字段。`state.status` 是作答生命周期，`answerState.status` 是填写进度。服务器成功后才更新 revision 与已保存标记；旧确认不能清除新反馈。重载恢复已保存快照，仅报告未保存的反馈不进入历史。

练习与考试作答中允许报告，交卷、已提交、编辑与历史拒绝。保存失败保留本地反馈与恢复入口；切题、汇总和交卷仍须 onFlush 成功。普通题仅使用旧 QF.save 草稿请求时也会即时显示父题已填写，宿主不会从父题答案推断小题进度。

## 评分状态与旧接口

`getScore(data,state)` 接收原题数据及含 status/answer/result/revision/submitted 的状态，返回 score/maxScore 和可选 outlineStates。新拓展只用它取分和读取已提交的小题评分状态，不判断未提交填写进度。例如：

```js
getScore(data, state) {
  if (!state.submitted) return {score: 0, maxScore: data.maxScore};
  return {
    score: state.result.score,
    maxScore: state.result.maxScore,
    ...(state.result.feedback?.outlineStates
      ? {outlineStates: state.result.feedback.outlineStates} : {})
  };
}
```

示例 feedback 存储结构由拓展自行定义；grade/review 保存细节，getScore 读取结果，不重新判分。AI 校验可能只传 submitted/result，不能依赖 answer 一定存在。maxScore 为有限非负数；待评分 score 为 null，其余为有限数值，宿主不限制实际得分在 0–maxScore。

outlineStates 每项严格为 `{id,status}`，最多 100 个唯一小题 ID。已提交仅允许 unanswered/correct/incorrect，不允许 draft；评分颜色由拓展给出，宿主不根据父题成绩猜小题结果。未提供细节时保持中性，目录外 ID 不着色，pending 分数保持 null。

API 1.2 起支持评分状态字段；API 1.0–1.2 未声明 answer-state 的旧拓展仍保留 getScore 未提交进度查询（仅 unanswered/draft）。新拓展未提交时保存、重载、刷新大纲与笔迹操作不调用 getScore 推断进度；分值汇总仍可读取满分，忽略其未提交 outlineStates。

## 响应与历史

当前响应在 `state.outlineStates` 中提供匹配状态，汇总父题行可带同名数组。集合父题行可带互斥的 outlineLabel 或 `outlineItems:[{id,label}]`，空小题列表省略。练习、考试、历史共用显示状态，考试交卷前不显示对错。

历史冻结当时题序、标签、入口、已保存状态及页面资源，读取时不调用当前 getScore 或当前题库补数据。旧记录缺小题状态时保持中性。仅修改大纲不重置当前作答，题库格式仍为 1。
