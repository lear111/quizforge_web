# 题库格式与题型能力

读取用途：选择题型、生成 `bank.json` 和资源、核对评分。本文路径均相对于 QuizForge Web 产品根目录；运行时以 `core/IMPLEMENTATION_CONTRACT.md`、根层安装包 schema/rules 和 `core/shared/` SDK 为准。没有 `core/` 的旧平铺 fixture 使用对应根层文件。

## 存放与身份

目录题库便于携带图片：

```text
question-banks/my-exam/
  bank.json
  assets/
    <sha256>.png
```

应用也读取 `question-banks/*.json`，但带资源的新题库优先用目录。JSON 使用 UTF-8。

```json
{
  "id": "my-exam-2026",
  "title": "我的练习",
  "description": "可选的说明",
  "questions": [
    {
      "id": "q-001",
      "title": "题目的简短名称",
      "extension": {"id": "quizforge.single-choice", "version": "1.0.0"},
      "data": {}
    }
  ]
}
```

`data` 必须按对应拓展的 schema 填写。根对象可以有 `extension` 作为默认绑定，每题的 `extension` 优先；没有根绑定时每题都必须有绑定。版本是精确匹配，不支持 `latest`、范围或只填 id。不同题可以绑定不同 id/version。

- bank/question id：`^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$`，同题库题 ID 唯一。
- 标题非空，最长 300；简答也需要元数据 title，即使 UI 不单独显示题名。
- 每库 1–10000 题，bank JSON 不超过 8 MiB。
- 题目顺序由 `questions` 数组决定，不按类型重新排序。单选、简答、单选就是三个连续分组。
- 修改已练习题库涉及内容指纹和历史一致性。材料转换优先创建新 ID、新目录，已有库的修改交给应用编辑功能。

## 当前可用的两个题型

这张表是能力示例，不是安装清单。先检查用户项目实际 manifest。

| 绑定 | 内容能力 | 作答与判分 | 不适合直接承载 |
| --- | --- | --- | --- |
| `quizforge.single-choice@1.0.0` | 纯文本题干、2–26 个纯文本选项、纯文本解析 | 选一个选项，自动判分 | 必须保留图片/表格排版的选项、多选、排序等专用交互 |
| `quizforge.short-answer@1.2.1` | 富文本题干、参考答案、评分标准；富文本回答 | 提交后待评分，人工 0.5 分步长；应用已有可选 AI 评分 | 要求精确选择/拖拽等专用交互且不接受简答替代的题 |

### 单选 data

```json
{
  "stem": "Java 中 7 / 2 的结果是什么？",
  "options": [
    {"id": "A", "text": "3"},
    {"id": "B", "text": "3.5"}
  ],
  "correctOptionId": "A",
  "explanation": "两个整数相除时，小数部分被舍去。",
  "maxScore": 1
}
```

字段均必填，拒绝额外属性。stem 1–20000 字符；每项 text 1–10000；explanation 1–20000。选项 ID 为 `^[A-Za-z0-9_-]+$`，最长 64，不能重复，正确答案必须属于这些 ID。maxScore 大于 0、最大 100000。

材料无解析时可以根据已确认的答案编写解析，制作报告注明“生成解析”；材料答案本身缺失或矛盾则不能静默生成标准答案。

### 简答 data

```json
{
  "formatVersion": 1,
  "stem": {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "说明缓存的作用及数据更新后的处理方式。"}]}]},
  "referenceAnswer": {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "复用已读取或计算的数据；原数据变化后更新或使缓存失效。"}]}]},
  "rubric": {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "解释复用数据减少读取或计算得 2 分；说明更新或失效得 2 分。可按 0.5 分调整。"}]}]},
  "maxScore": 4
}
```

字段均必填，拒绝额外属性。maxScore 大于 0、最大 100000，必须为 0.5 的倍数。三个文档均需有效内容。参考答案与 rubric 用于评分，不放进练习未提交的可见题干。

回答由页面保存为 `{ "formatVersion": 1, "document": <富文本文档> }`，不预写进题库。人工/AI 评分、练习进度及历史由宿主保存，题库制作不写 `.state`。

## 富文本与资源

富文本是结构化 JSON 文档，不是任意 HTML。当前节点包括 paragraph、heading、blockquote、bulletList、orderedList、listItem、codeBlock、hardBreak、horizontalRule、image、text、table/tableRow/tableCell/tableHeader、inlineMath/blockMath；文档根为 doc。schema 与共享 SDK 的语义校验共同限制节点、属性和 marks，不能把富文本字段当作任意 JSON 容器。

基础形式：

```json
{"type":"paragraph","content":[{"type":"text","text":"重要内容","marks":[{"type":"bold"}]}]}
```

公式用 math 节点的 `attrs.latex`；当前共享 SDK 的标题用 heading 的 `attrs.level`（1–3）。表格与样式请参考安装的简答 schema、examples 和 `core/shared/richtext/<版本>` 的公共接口，不猜测属性。正常练习与完整编辑使用相同文档格式及内容宽度。

图片形式：

```json
{"type":"image","attrs":{"assetId":"<图片字节的64位小写SHA256>","alt":"图示说明"}}
```

`<...>` 是说明占位，不能原样写入题库。计算图片实际字节 SHA-256，将相同文件保存为 `assets/<sha256>.<扩展名>`，在该题库或对应拓展的 assets 中确保可找到。文件内容必须是 PNG/JPEG/WebP/GIF，每张最多 4 MiB；页面资源总量还有限制（16 MiB）。扩展名不能掩盖不支持的格式。

不引用材料原位置、`file://`、远程临时 URL、data URL 或 `.state/resources`。从源文档提取所需图片即可；必要裁剪属于材料转换，保留图例、标尺、标签等作答信息。相同内容哈希可复用，禁止修改该哈希对应的字节。

## 校验与能力边界

技能内的 `scripts/validate-bank.mjs` 使用产品根的 `extensions/`、`core/node_modules` 已装 AJV、`core/server/rules-runner.cjs` 和 `core/shared/` SDK，检查 schema、`validateQuestion` 与未作答的 `getScore`。`--project` 指向产品根；没有 `core/` 时兼容旧平铺 fixture，存在但不完整时明确报错。它不验证材料真实性、实际浏览器渲染、编辑器交互、AI 输出或全部已作答状态。

新拓展需要补充提交、review、编辑、历史的针对性验证；不能只依靠初始分值校验。评分必须经拓展规则接口输出，宿主拥有全库得分卡、完成练习与历史统计，不在 bank.json 增加自定义总分字段来代替接口。
