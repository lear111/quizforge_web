# L：受限 HTML 富文本（D54）

**状态：设计提案，待负责人确认；尚未开工。** 本文只确定实现选型与影响评估，不授权 Codex 开始编码。正式行为仍以 [D54](../V2_ARCHITECTURE.md)、[数据结构说明书 1.1](../V2_DATA_STRUCTURES.md) 为准。

## 目标与范围

题干、选项、答案解析等富文本字段改为 HTML 字符串；显示时按 D54 白名单清洗。公式继续使用 `$…# L：受限 HTML 富文本（D54）

**状态：设计提案，待负责人确认；尚未开工。** 本文只确定实现选型与影响评估，不授权 Codex 开始编码。正式行为仍以 [D54](../V2_ARCHITECTURE.md)、[数据结构说明书 1.1](../V2_DATA_STRUCTURES.md) 为准。

## 目标与范围

 / `$…$`，图片继续使用 `qf-asset:路径`。本阶段以 V2 基础题型展示库的 7 道示例题和单选、多选、判断三个示例题型完成实现与验证；新格式确认后，再由负责人安排 Codex 对其余现有 V2 题库内容及随附拓展做一次性迁移。**不做编辑器**（排在第 6 段），不改后端对题目内容的原样存取，也不改评分流程。

## 实现选型

### HTML 清洗：DOMPurify 3.4.18

建议在浏览器题型 iframe 内使用 DOMPurify，固定版本，不自行编写 HTML 清洗器。该版本在 2026-11-14 发布；DOMPurify 本身使用浏览器 DOM 解析 HTML，适合当前隔离 iframe 的运行位置。

- 显式配置 D54 的 `ALLOWED_TAGS` 与 `ALLOWED_ATTR`，不采用库默认的宽泛 HTML/SVG/MathML 范围。
- 标签、属性严格按 [数据结构说明书 1.1](../V2_DATA_STRUCTURES.md)；未知标签、属性直接剔除，不报错。
- `style` 属性再用浏览器 CSSOM 解析，只重建 D54 列出的十种 CSS 属性；不允许其他 CSS 属性或自定义属性。
- URL 按元素分别限制：`img[src]` 只接受 `qf-asset:`；`a[href]` 只接受 `http:`、`https:`、`mailto:`。不允许远程图片地址。
- 清洗后再解析为 DOM；`qf-asset:` 图片通过现有 `QF.resources.get(reference)` 取资源，不把题库路径直接拼成 URL。
- 后端仍原样存取题目 HTML，不做内容改写；但为了沿用现有素材权限检查与预加载，`visibleAssets` 必须从 HTML 富文本字段中提取 `<img src="qf-asset:…">` 引用。该步骤只收集资源引用，不解释题意；实现时使用标准 HTML parser，避免用正则表达式解析 HTML，并只在 solution 可见时扫描 solution。

DOMPurify 的项目说明与版本：[npm](https://www.npmjs.com/package/dompurify)。其 3.4.15 版本的浏览器构建测量约 28.3 kB minified / 11.0 kB gzip；3.4.18 的最终增量以实际构建结果为准：[bundlewhys 测量](https://zachleat.github.io/bundlewhys/?package=dompurify)。

### 公式与图片

- 复用现有 KaTeX 0.16.43，不再引入第二个公式库。当前富文本静态组件已经打包 KaTeX，并使用 MathML 输出、`trust: false`；沿用锁定的 0.16.43 版本，不新增公式库依赖。新 SDK 自己的静态文件仍需包含 KaTeX 运行时代码。
- 清洗后遍历普通文本节点识别行内与独立公式；反斜杠转义的美元符号按普通文本保留。公式不在 `code` / `pre` 内解析。
- 图片只允许 D54 的 `qf-asset:` 引用，通过现有资源通道加载；资源缺失沿用现有图片缺失提示，不回退到任意网络 URL。
- `QFRichText.render(container, htmlString)` 保持函数调用形式，第二个参数由树形 JSON 文档改为 HTML 字符串；返回对象仍提供 `ready` 与 `destroy`。

## 版本兼容与示例迁移

新增不可变的 `quizforge.richtext@2.0.0`，专门接收 HTML 字符串。新版本确认后，负责人再安排 Codex 对现有 V2 题库内容及随附拓展做一次性迁移；不开发独立迁移工具。该次迁移不处理任何作答数据。迁移完成后删除旧的 V2 富文本 SDK 版本及其旧版本映射，不保留旧 JSON 格式的运行时兼容。

V2 拓展规范规定：`question` / `solution` 数据格式变化必须升级拓展主版本。因此三个示例拓展从 `2.0.0` 升至 `3.0.0`，题库 `type` 从 `@2` 升至 `@3`，并将 `sdkVersions.richtext` 指向 `2.0.0`。拓展内 `QFRichText.render(element, value)` 的调用形式不变，只把 value 换成 HTML 字符串。

7 道示例题只转换富文本字段：
- 单选、多选：`question.stem`、`question.options[].content`、`solution.explanation`。
- 判断：`question.stem`、`solution.explanation`。
- 选择答案等非富文本字段（例如 `solution.selected`）保持原结构。

不迁移任何既有作答记录，包括 `.qf-v2/practice/` 中正在进行的练习、`.qf-v2/exam/` 中正在进行的考试，以及 `.qf-v2/rounds/` 中已经归档的历史轮次。题库/拓展升级后，当前练习和考试按 D27 现有规则失效或中断；归档历史保留原始文件、不做格式转换，但不保证在删除旧 SDK 后仍能打开。无需为旧历史保留旧 SDK、旧题型拓展或兼容渲染路径。升级后新开始的练习/考试及其新归档使用 HTML 格式和新 SDK。V1 的拓展及运行路径不属于本次 V2 改造范围。

## 体积影响

当前 `core/shared/richtext/1.1.3/richtext.js` 为 276,916 bytes，`richtext.css` 为 7,031 bytes；公式渲染已在该静态 JS 中。按 DOMPurify 3.4.15 的公开构建测量估算，新静态 JS 增加约 28.3 kB minified（约 11.0 kB gzip），即约 10% 的未压缩体积增幅；不新增 KaTeX 依赖，新版本仍需在自己的静态 JS 中打包锁定的 KaTeX 运行时代码。新版本实际 minified、gzip、CSS 体积必须在实现 PR 中实测记录，不能把估算当成最终值。

## 验证要求

1. 白名单正向测试覆盖 D54 全部标签、属性、样式；负向测试覆盖 script、事件属性、危险 URL、非白名单 CSS、SVG/MathML 等内容。
2. 公式测试覆盖行内、独立、转义美元符号、非法 LaTeX；图片测试覆盖 qf-asset 成功、缺失与拒绝远程 src。
3. 七道示例题在桌面与手机视口验证段落、表格、图片、公式显示；提交前不泄露 solution。
4. 新创建的历史快照使用 HTML 格式和新 SDK；不迁移、不验证旧练习、旧考试或旧历史记录。V1 原有富文本路径不受本次 V2 改造影响。
5. 实测新 SDK 的 JS minified/gzip、CSS 体积，并与当前 1.1.3 对比。

## 本次提案不包含

富文本编辑器、题库编辑器改造、Word 粘贴、HTML 写入时校验、后端清洗，以及旧 V2 题库的一次性迁移执行。题库迁移在新格式正式确认后由负责人另行安排 Codex 执行；不迁移当前练习、正在进行的考试或已归档历史。V1 组件升级不属于本次 V2 改造范围。

参考：[DOMPurify npm](https://www.npmjs.com/package/dompurify)、[DOMPurify 构建体积测量](https://zachleat.github.io/bundlewhys/?package=dompurify)、[V2 拓展版本规则](../reference/V2_EXTENSIONS.md)。
