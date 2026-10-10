# 题库格式与题型能力

读取用途：材料分析、题型匹配、生成 bank.json 与资源。写入范围和阶段条件见 SKILL.md，真实字段以安装的 Schema／规则为准。

## 材料分析与保真

使用现有文档工具提取文字、图表和公式，并核对复杂页面：DOCX 内容可能分属不同 XML，PDF 提取顺序可能不同于视觉顺序；扫描件 OCR 后对照原图核查题号、选项、否定词、负号／小数点、单位、上下标和答案。无法读取时报告，不能凭文件名生成题库。

恢复跨页题、栏式排版、共享材料与连续小问的关联，排除页眉页脚、目录和答案附录；独立答案页按原题号对应，不按提取行随意配对。报告记录来源位置／题号、内容资源、题型、答案与评分来源、分值、输出 ID／拓展版本、疑点与转换损失；区分材料提供、Agent 推断、用户确认，不给 schema 添加未经允许的溯源字段。

同时检查展示、作答、判分能力。近似替代须说明损失并按流程确认；缺答案、分值或辨识疑点可给候选解读，但未经确认不能写成正式依据。模糊内容保留原图，不猜字符或造替代图。只有用户接受影响时才拆分无法承载的组合题。逐题核对数量、顺序、题意、资源、答案及来源映射，剩余关键疑点不能标为可正式评分。中间产物只放指定 `.temp`，确认交付的图片才复制到 assets。

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
  "formatVersion": 1,
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

`data` 必须按对应独立拓展的 schema 填写。根对象可以有 `extension` 作为默认绑定，每题的 `extension` 优先；没有根绑定时每题都必须有绑定。正式引用是精确 `{id,version}`，不支持 `latest`、范围或只填 id。不同题可以引用同组或跨组的独立拓展，物理分组名和路径不进入绑定，不使用 `typeId` 或 `extensionGroup`。见 [独立拓展与分组](extension-development.md)，绑定形状可参考 [最小混合题库](../assets/minimal-mixed-bank/bank.json)，实际 data 按各题型填写。

开发测试题库可显式用 `extension:{"development":"new-type-dev"}` 引用全局唯一的开发叶目录名，不包含分组路径，可与正式绑定混用；仅在开发者模式开启时可用。开发绑定始终使用同一 QF 管线和隔离状态，尚未实现的动作显式报错。完整校验加 `--allow-development`；骨架预览另加 `--preview-only`，不执行规则或验收分值。正式交付改为该叶拓展已发布的精确 `id/version`，详见 [开发版拓展](extension-development.md)。

- bank/question id：`^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$`，同题库题 ID 唯一。
- 顶层 `formatVersion` 当前只支持数字整数 `1`；旧文件缺省按 `1` 读取，不补写。仅为新题库和新拓展示例显式添加；与题型内部 `data.formatVersion` 相互独立。
- 标题非空，最长 300；简答也需要元数据 title，即使 UI 不单独显示题名。
- 每库 1–10000 题，bank JSON 不超过 8 MiB。
- 题目顺序由 `questions` 数组决定，不按类型重新排序。单选、简答、单选就是三个连续分组。
- 修改已练习题库涉及内容指纹和历史一致性。材料转换优先创建新 ID、新目录，已有库的修改交给应用编辑功能。

## 整库功能开关

根 features 只作用本题库，缺省全开；功能选择步骤见 SKILL.md：

```json
"features": {"editing": true, "whiteboard": true, "history": false}
```

对象只允许这三个 boolean，缺项为 true，不能给每题覆盖。`editing:false` 禁用题目编辑；`whiteboard:false` 禁用白板但不阻止未提交答案的自动更新。`history:false` 关闭答案、得分、白板内容、完成状态和历史的全部练习持久化，练习上传图片与 AI 任务也只驻内存。这些数据在当前浏览器页面会话中有效，刷新页面或关闭浏览器标签后不能恢复；在同一页面关闭题库标签再打开可以临时保留。编辑仍开启时，题目文件和编辑图片可以照常保存。

样例采用相同题库格式，其自绑定、功能默认与受控编辑规范只见 [拓展开发](extension-development.md#每叶一本样例)。

## 矩阵大纲与显示编号

新题库为每道顶层题在 `id/title/extension/data` 同层填写可选的 `outline`。显示大题或普通题用 `{"level":"question","label":"三"}`；显示小题用 `{"level":"parts","items":[{"id":"part-a","label":"21"},{"id":"part-b","label":"22"}]}`。两种形式互斥，不能列出大题自身后又列出其小题，也不能在根对象另造一份大纲列表。

`question` 对象仅含 level/label；`parts` 对象仅含 level/items，items 为 1–100 项，每项仅含 id/label。同一大题的 id 唯一且稳定，长度 1–128；label 长度 1–80。字符串无首尾空白、控制字符或 `< >`，不放标准答案、分值或 HTML。目录总量最多 8 MiB。小题 id 必须与该拓展页面定位回调能识别的 ID 相同；label 只用于显示，不是跳转键。

宿主先按大题 `questions` 顺序展开自身入口或小题 `items`，再将相邻的相同**大题拓展 ID/version** 放在一个矩阵中，共用题型名称。物理分组不改变分类；小题样式不单独分类，后面隔开的同型不提前合并。显示小题时不显示大题按钮及其占位列。现有题库和历史也统一用修正后的单层矩阵。

显式 `parts` 要求对应拓展已声明 API 1.1 `outline-items` 并有练习/历史和编辑定位回调；无需实现目录生成 `getOutlineItems`。显式配置不会被该方法覆盖。缺配置的现有文件仍可由原生成方法提供目录。题库制作或用户明确要求的结构调整涉及增删题目、修改显示编号时，必须同步维护显式目录；只改大纲不改变父题答案/计分。这属于题库结构维护，不要求题型编辑页提供题号或大纲编辑控件；`getDocument()` 按现有接口返回 title/data，显式 outline 由宿主保留。详细格式见产品的 `core/docs/QUESTION_BANK_FORMAT.md`，定位接口见 [组合题与子题大纲](extension-api.md#子题导航与状态)。

## 题型数据示例

这张表是能力示例，不是安装清单。先检查用户项目实际 manifest。

| 绑定 | 内容能力 | 作答与判分 | 不适合直接承载 |
| --- | --- | --- | --- |
| `quizforge.single-choice@1.0.0` | 纯文本题干、2–26 个纯文本选项、纯文本解析 | 选一个选项，自动判分 | 必须保留图片/表格排版的选项、多选、排序等专用交互 |
| `quizforge.short-answer@1.3.0` | 富文本题干、参考答案、评分标准；富文本回答 | 提交默认 0 分，人工 0.5 分滑条自动保存；支持可选 AI 评分 | 要求精确选择/拖拽等专用交互且不接受简答替代的题 |

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

## 校验边界

按 SKILL.md 运行只读 validator：结构、绑定、Schema、validateQuestion、初始 getScore 和资源检查不代替材料核对、浏览器三态或提交／review 测试。宿主拥有整库分值卡和历史统计，不在题库增造总分字段来代替评分接口。
