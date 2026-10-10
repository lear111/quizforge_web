# QuizForge Web 题库说明

题库是 UTF-8 的 `bank.json`，放在产品根的 `question-banks/<目录>/`，所需图片放同目录的 `assets/`。也可以使用 `question-banks/*.json`。题库保存题目定义，作答、草稿、评分和历史由应用另行保存；应用内的受控编辑会更新题库定义。

## 基本结构

```json
{
  "formatVersion": 1,
  "id": "my-practice",
  "title": "我的练习",
  "description": "可选说明",
  "questions": [
    {
      "id": "q1",
      "title": "整数除法",
      "extension": {"id": "quizforge.single-choice", "version": "1.0.0"},
      "outline": {"level": "question", "label": "1"},
      "data": {
        "stem": "Java 中 7 / 2 的结果是什么？",
        "options": [{"id": "A", "text": "3"}, {"id": "B", "text": "3.5"}],
        "correctOptionId": "A",
        "explanation": "整数相除时舍去小数部分。",
        "maxScore": 1
      }
    }
  ]
}
```

- `id` 是稳定身份，不是显示题号。题库和顶层题目 ID 满足 `^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$`；同题库的顶层题目 ID 不重复。
- `title` 非空，最长 300 字符；每题仍需元数据标题，即使拓展只显示题干。
- `questions` 按材料顺序排列，1–10000 项。每项是独立保存、提交和评分的顶层题目；组合题的小题留在它的 `data` 内，不能为了大纲重复添加到顶层。
- `extension` 引用已安装独立拓展的精确 `{id,version}`。根级 `extension` 可以作为默认绑定，每题的绑定优先；没有根绑定时每题都需声明。一本普通题库可以混用同组或跨组的多个独立拓展，分组路径不进入绑定，不使用 `typeId` 或 `extensionGroup`。每个拓展自身的样例也用本格式，但仅允许绑定本拓展。见 [独立拓展与分组](EXTENSION_GROUPS.md)。
- `data` 完全遵循对应拓展的 question schema 和规则。宿主不规定组合题内部一定使用 `parts`、`sections` 等字段。
- 顶层 `formatVersion` 为整数 `1`，与拓展内部的数据版本、富文本版本无关。单份 JSON 最多 8 MiB。

## 整库功能开关

可选根 `features` 控制这一整本题库（含混合题库），默认三项全开，不支持每题覆盖：

```json
"features": {"editing": true, "whiteboard": false, "history": false}
```

仅允许 `editing/whiteboard/history` 三个 boolean，省略对象或某一项等于 true。未知字段、非布尔值及 `questions[].features` 均拒绝。collection 响应返回归一后的 `features`，拓展协议版本及独立绑定不变。

- `editing:false`：关闭该库的题目编辑，服务端同时拒绝编辑请求。
- `whiteboard:false`：关闭白板和对应写入；不关闭答案的自动更新。
- `history:false`：关闭全部练习数据持久化，包括答案、得分、白板内容、完成状态、历史、练习上传图片及 AI 评分任务。当前页面仍可答题判分，但仅在浏览器页面会话中有效，刷新页面或关闭浏览器标签后不能恢复；同一页面关闭题库标签再打开可临时保留。

`history:false` 和 `editing:true` 可同时使用：题目数据及编辑图片仍可保存到题库文件，练习数据不持久化。关闭历史不代表删除原有持久数据；Agent 不得自行读写或清理状态目录。

正式及开发拓展样例使用相同 features 和 QF 管线，已实现的编辑可受控保存 examples 题目文件；未完善的操作明确报错，不能假保存。新制作样例省略 features 或全部 true，默认开放编辑、白板和历史，不需功能选择询问；已存在的显式 false 仍允许，validator 提醒制作规范而不硬拦。

普通题库制作应第一步一次询问需要关闭哪几项（默认全开），用户确认后再分析材料、选型、评审 UI 和生成，见 [Agent 工作流](AGENT_BANK_WORKFLOW.md)。

## 矩阵大纲

每道顶层题的可选 `outline` 明确选择**显示大题自身，或者显示小题**，不能同时选择两者。新制作题库应显式填写，以保留材料中的实际题号。

显示大题或普通题：

```json
"outline": {"level": "question", "label": "三"}
```

显示小题：

```json
"outline": {
  "level": "parts",
  "items": [
    {"id": "part-reading-a", "label": "21"},
    {"id": "part-reading-b", "label": "22"}
  ]
}
```

这两段是 `questions[]` 单项的字段片段，不是完整题库。`outline` 与 `id/title/extension/data` 同层，不能放进拓展私有的 `data` 中，也不在题库根增加另一份大纲列表。

`question` 仅允许 `level` 和 `label`；`parts` 仅允许 `level` 和 `items`。`items` 必须包含 1–100 项，每项仅含 `id/label`。`id` 为 1–128 字符的稳定小题标识，在该大题内唯一；`label` 为 1–80 字符的显示题号。两者均是非空、无首尾空白、无控制字符、无 `< >` 的纯文本。不要把答案、分值或富文本写进导航标签。显示编号变化时不要随之更改定位 ID。全库导航元数据最多 8 MiB。

宿主按以下顺序形成大纲：

1. 按 `questions` 的原顺序遍历大题。
2. `question` 展开为一个编号；`parts` 按 `items` 顺序展开为多个编号，不生成大题编号或左侧占位列。
3. 所有展开入口继承**大题所绑定独立拓展的 ID、版本和题型名称**。目录分组及小题的交互样式不产生新的大纲题型。
4. 仅相邻的同一题型、版本共用标题和一个矩阵。遇到其他题型后，后面再次出现的同型另起一组，不移动题目、不按题号重新排序。

例如，阅读理解 A、阅读理解 B、综合题 C、阅读理解 D，会得到“阅读理解矩阵 → 综合题矩阵 → 阅读理解矩阵”。A、B 的编号共用标题；C 的小题即使有多种样式，也统一归属综合题。

未填写 `outline` 的现有题库仍可读取已有目录数据，但也使用上述修复后的单层矩阵布局，不保留原来的父子两列展示。若目录存在小题，显示小题入口；否则显示顶层题顺序编号。要让组合题只显示自身，填写 `level:"question"`。

## 跳转与编辑

大题入口通过顶层 `questions[].id` 打开题卡；小题入口通过“顶层题目 ID + `items[].id`”定位。`label` 只负责显示。显式小题配置要求拓展声明 API 1.1 的 `outline-items` 能力，并在练习、提交后/历史及编辑页面提供 `onOutlineNavigate(itemId)`。宿主先打开大题并等待就绪，再让拓展定位自己的内容。同一大题内切换小题复用当前页面。

新题库已经给出显式 `outline` 时，不再调用该题的 `getOutlineItems(data)` 生成目录。该旧生成方法保留供缺少显式配置的现有文件读取；它不能覆盖题库写明的编号或入口选择。定位回调仍不可省略，详见 [小题导航接口](SUBQUESTION_OUTLINE.md)。

当前应用编辑器修改题目标题和拓展数据时保留显式 `outline`。若增删小题、改变定位 ID 或显示编号，制作者需同步维护此配置，并验证实际跳转；宿主不会根据私有 `data` 猜测新的目录。只改变大纲编号或入口选择不会重置作答。题干、答案、绑定或判分数据的修改仍应通过应用受控编辑完成。

每轮历史保存当时题序、显示编号、小题列表及页面资源；后续目录修改不会替换旧快照。旧历史也使用修正后的矩阵布局，定位仍以当时保存的内容为准。

## 富文本、资源和校验

富文本字段使用拓展支持的结构化文档，不能直接塞 HTML。图片使用内容 SHA-256 的 `assetId`，保存为题库 `assets/<sha256>.<扩展名>`；支持 PNG/JPEG/WebP/GIF，单张最多 4 MiB。题库不存实际作答，不写 `.state`。具体文档节点、样式和评分字段以所选拓展的 schema 为准，参考 [富文本服务](RICHTEXT_SERVICE.md) 和 [制作技能中的完整格式说明](../../skills/quizforge-bank-builder/references/bank-format.md)。

用技能的只读校验器检查结构、精确绑定、题型 schema、规则、资源和显式大纲：

```powershell
node skills/quizforge-bank-builder/scripts/validate-bank.mjs --project . --bank question-banks/my-practice/bank.json
```

校验器不能证明小题 ID 对应的页面位置存在。交付前仍需在练习、编辑和只读历史中验证小题跳转。新建拓展要先按技能完成三态 UI 与交互评审，题库制作 Agent 不得为大纲需求修改宿主源码。

小题状态不写入题库目录。需要显示对错时，由 API 1.2 的 `getScore` 返回可选 `outlineStates:[{id,status}]`，匹配目录的稳定 ID；仅使用 unanswered/correct/incorrect 三种状态。未提交含草稿均为 unanswered，提交后满分为 correct，低于满分或仍待评分为 incorrect；待评分仍保存 null 分，不将按钮颜色当作零分。宿主保存历史快照，不重新判题。详见 [小题状态接口](SUBQUESTION_OUTLINE.md#保存评分与历史)。
