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
  "id": "136832c4-69e0-4ef9-9b72-e86ce4317405",
  "version": "1.0.0",
  "title": "我的练习",
  "description": "可选的说明",
  "questions": [
    {
      "id": "q-001",
      "title": "题目的简短名称",
      "extension": {"path": "extensions/我的题库组/single-choice"},
      "data": {}
    }
  ]
}
```

`data` 按对应拓展 schema 填写。根默认 `extension` 与逐题覆盖均用 `{path}`，path 相对数据根目录；无默认时每题必须声明。不支持 latest、版本范围、只填 id、typeId 或 extensionGroup。题型 data 参考已有基础样例，再按实际 Schema 填写；混合库逐题绑定，不另建技能样例库。见[独立拓展与分组](extension-development.md)。

旧 `{id,version}` 和 `extension:{"development":"叶名"}` 兼容读取，多个候选时应改为准确路径。新题库用 `{path}`。管理入口不影响加载，导出在暂存副本规范化绑定。`--preview-only` 不代表真实保存、评分或界面验收。

- bank/question id：`^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$`，同题库题 ID 唯一。
- 顶层 `formatVersion` 当前只支持数字整数 `1`；旧文件缺省按 `1` 读取，不补写。仅为新题库和新拓展示例显式添加；与题型内部 `data.formatVersion` 相互独立。
- 标题非空，最长 300；简答也需要元数据 title，即使 UI 不单独显示题名。
- 每库 1–10000 题，bank JSON 不超过 8 MiB。
- 题目顺序由 `questions` 数组决定，不按类型重新排序。单选、简答、单选就是三个连续分组。
- 修改已练习题库涉及内容指纹和历史一致性。材料转换优先创建新 ID、新目录，已有库的修改交给应用编辑功能。

## 题库分组与交付

在材料与选型阶段确定题库分组名及输出位置，已有明确名称／路径直接沿用；未指定时建议将本次相关题库放入一个清楚命名的分组，需用户决定的分组选择随该阶段问题一起确认，不为每本题库重复询问。用户明确要求未分组时允许保留根层题库，但共享导出前必须移入分组。

```text
question-banks/
  我的题库组/                      # 一层物理分组
    第一份练习/
      bank.json
      assets/
    第二份练习/
      bank.json
extensions/
  我的题库组/                       # 一层物理分组
    choice/
      manifest.json
      examples/bank.json
    reading/
      ...
```

- 分组和实体名称取实际文件夹名，不维护另一份逻辑显示名称。题库元数据 id 可使用普通字符串，不要求 UUID/全局唯一；题目和小题 ID 保持稳定。
- 普通题库用 {path:"extensions/<分组>/<拓展>"} 引用；移动题库不改变路径。普通界面禁止拓展改名、移动和代码编辑。复制新叶仅在授权位置进行，原拓展不改。
- 交付一个格式 3 .qbank，包含 question-banks/<组>/<题库>/ 与 extensions/<组>/<拓展>/。清单为 {format:"quizforge-bank-group",formatVersion:3,group:"组名"}，由宿主导出器收集依赖、重映射路径并保留资源，源文件不变。
- 可以按分组导出，也可只导出一本题库。单题库包在清单增加 scope:"bank"，恰好包含一本题库及其实际依赖；包内沿用暂存分组结构，导入时该题库直接放到题库根目录，名称取下载文件基名，拓展仍有独立物理分组。省略 scope 的整组包不会因只有一本题库而变成根目录题库。使用宿主导出器，不手动混用两种语义；接口见宿主 API 的 Package import HTTP。
- 导入每次新增独立副本，不比较 UUID、版本或哈希，重名自动编号；作答和历史不共享。旧包格式 1/2 不支持导入，需要重新导出新版。
- 不包含作答、白板、历史、设置、旧逻辑分组表及宿主内部 .instance.json/.bundle.json。不自行编造内部保存身份。
- 不能实际导出时交付校验目录和操作步骤，不把普通 ZIP 改后缀称为已验证题库包。完整规则见[宿主导入导出约定](../../../core/docs/reference/LIBRARY_PACKAGES.md)。

逐本运行 validator，核对整组题库的所有依赖及资源；单本通过不等于整组已验证。实际生成包后核对其结构与分组、题库数量和依赖，并如实说明是否在隔离位置验证导入。交付报告列出分组名、每库路径／ID、依赖精确版本、包路径及检查结果。所有暂存／解包与验证中间文件仍只放 SKILL.md 指定的 `.temp`，最终目录与包放用户确认的交付位置。

## 整库功能开关

根 features 只作用本题库；编辑、白板、历史、考试缺省全开。功能选择步骤见 SKILL.md：

```json
"features": {"history": false, "exam": false}
```

对象只允许 `editing/whiteboard/history/exam` 四个 boolean；四项缺项均为 true，仅显式 false 关闭对应功能，不能给每题覆盖。`editing:false` 禁用题目编辑；`whiteboard:false` 禁用白板但不阻止未提交答案的自动更新。`history:false` 关闭答案、得分、白板内容、完成状态和历史的全部练习持久化，练习上传图片与 AI 任务也只驻内存。这些数据在当前浏览器页面会话中有效，刷新页面或关闭浏览器标签后不能恢复；在同一页面切换题库再返回可以临时保留。编辑仍开启时，题目文件和编辑图片可以照常保存。

考试默认保留练习并显示宿主“开始考试”入口；只有用户明确不要考试时才在题库文件根 features 写 `"exam":false`，不在列表编辑窗口设置；开始前选择 1–1440 分钟或不限时。限时到点自动交卷，不继续延长作答；不限时显示已用时间。考试与练习状态分开，交卷后统一评分，AI 失败可重试或人工评分。历史开启时从“开始考试”对话框继续未完成考试，已完成考试统一在带“考试”标记的历史中查看，题目与拓展快照固定；历史关闭时考试答案、图片、AI 任务和结果仅属于原浏览器页面会话，不持久保存。

样例采用相同题库格式，其自绑定、功能默认与受控编辑规范只见 [拓展开发](extension-development.md#每叶一本样例)。

## 矩阵大纲与显示编号

新题库为每道顶层题在 `id/title/extension/data` 同层填写可选的 `outline`。显示大题或普通题用 `{"level":"question","label":"三"}`；显示小题用 `{"level":"parts","items":[{"id":"part-a","label":"21"},{"id":"part-b","label":"22"}]}`。两种形式互斥，不能列出大题自身后又列出其小题，也不能在根对象另造一份大纲列表。

`question` 对象仅含 level/label；`parts` 对象仅含 level/items，items 为 1–100 项，每项仅含 id/label。同一大题的 id 唯一且稳定，长度 1–128；label 长度 1–80。字符串无首尾空白、控制字符或 `< >`，不放标准答案、分值或 HTML。目录总量最多 8 MiB。小题 id 必须与该拓展页面定位回调能识别的 ID 相同；label 只用于显示，不是跳转键。

宿主先按大题 `questions` 顺序展开自身入口或小题 `items`，再将相邻的相同**大题拓展 ID/version** 放在一个矩阵中，共用题型名称。物理分组不改变分类；小题样式不单独分类，后面隔开的同型不提前合并。显示小题时不显示大题按钮及其占位列。现有题库和历史也统一用修正后的单层矩阵。

显式 `parts` 要求对应拓展已声明 API 1.1 `outline-items` 并有练习/历史和编辑定位回调；无需实现目录生成 `getOutlineItems`。显式配置不会被该方法覆盖。缺配置的现有文件仍可由原生成方法提供目录。题库制作或用户明确要求的结构调整涉及增删题目、修改显示编号时，必须同步维护显式目录；只改大纲不改变父题答案/计分。这属于题库结构维护，不要求题型编辑页提供题号或大纲编辑控件；`getDocument()` 按现有接口返回 title/data，显式 outline 由宿主保留。详细格式见产品的 `core/docs/reference/QUESTION_BANK_FORMAT.md`，定位接口见 [组合题与子题大纲](extension-api.md#子题导航与状态)。

## 基础题型与实际 Schema

题型数据示例统一读取产品基础拓展，不在本技能重复定义私有 Schema 或维护独立样例。

| 参考叶 | 查看内容 |
| --- | --- |
| [单选题](../../../extensions/基础题型/单选题) | 富文本题干、选项、正确选项 ID、答案与解析、满分，以及已有文字/图片/公式/表格样例 |
| [简答题](../../../extensions/基础题型/简答题) | 可选共享材料、稳定小题 ID、富文本题干与答案解析、各小题满分，以及单问/多问样例 |

读取 manifest.examples 对应文件及 question.schema.json、answer.schema.json、rules.js；按实际文件核对必填项、资源、答案结构、分值范围与步长，不把旧纯文本单选或旧简答 referenceAnswer/rubric 结构套给新题型。

当前基础参考叶为正式 2.0.0，支持真实保存、评分和编辑；简答支持人工及按小问 AI 评分。按实际 manifest 的精确绑定与 Schema 使用。其他已安装版本保持自己的数据契约，旧兼容 fixture 不当作当前安装清单。

材料无解析时可根据已确认答案编写解析并在报告注明；材料答案缺失或矛盾须先确认，不静默生成正式评分依据。回答由页面按拓展答案结构保存，不预写进 bank.json，也不直接写状态目录。

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


## 宿主听力（可选）

支持宿主听力的Web版本可在题库根配置 `listening.materials` 和 `examMaterialId`，在题卡 `data` 同层配置 `listening:{materialId}`。音频归题库 `media/`，多题可共用材料；考试配置一条整卷音轨。复用原有单选等拓展，不往题型里加播放器、不把音频Base64写入data。正式字段/8MiB单文件限制/示例见 [宿主听力文档](../../../core/docs/reference/LISTENING.md)，真实演示位于 `question-banks/基础题型/听力组件演示`。只配置经核对的题意、答案及评分；Web之外的端须确认已同步能力再交付。
