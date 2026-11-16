# L：受限 HTML 富文本（D54）

**状态：设计提案，待负责人确认；尚未开工。** 本文只确定实现选型与影响评估，不授权 Codex 开始编码。正式行为仍以 [D54](../V2_ARCHITECTURE.md)、[数据结构说明书 1.1](../V2_DATA_STRUCTURES.md) 为准。

## 目标与范围

题干、选项、答案解析等富文本字段改为 HTML 字符串；显示时按 D54 白名单清洗。公式继续使用 `$…$` / `$$…$$`，图片继续使用 `qf-asset:路径`。只迁移 V2 基础题型展示库的 7 道示例题及单选、多选、判断三个题型。**不做编辑器**（排在第 6 段），不改后端对题目内容的原样存取，也不改评分流程。

## 实现选型

### HTML 清洗：DOMPurify 3.4.18

建议在浏览器题型 iframe 内使用 DOMPurify，固定版本，不自行编写 HTML 清洗器。该版本在 2026-11-14 发布；DOMPurify 本身使用浏览器 DOM 解析 HTML，适合当前隔离 iframe 的运行位置。

- 显式配置 D54 的 `ALLOWED_TAGS` 与 `ALLOWED_ATTR`，不采用库默认的宽泛 HTML/SVG/MathML 范围。
- 标签、属性严格按 [数据结构说明书 1.1](../V2_DATA_STRUCTURES.md)；未知标签、属性直接剔除，不报错。
- `style` 属性再用浏览器 CSSOM 解析，只重建 D54 列出的十种 CSS 属性；不允许其他 CSS 属性或自定义属性。
- URL 按元素分别限制：`img[src]` 只接受 `qf-asset:`；`a[href]` 只接受 `http:`、`https:`、`mailto:`。不允许远程图片地址。
- 清洗后再解析为 DOM；`qf-asset:` 图片通过现有 `QF.resources.get(reference)` 取资源，不把题库路径直接拼成 URL。

DOMPurify 的项目说明与版本：[npm](https://www.npmjs.com/package/dompurify)。其 3.4.15 版本的浏览器构建测量约 28.3 kB minified / 11.0 kB gzip；3.4.18 的最终增量以实际构建结果为准：[bundlewhys 测量](https://zachleat.github.io/bundlewhys/?package=dompurify)。

### 公式与图片

- 复用现有 KaTeX 0.16.43，不再引入第二个公式库。当前富文本静态组件已经打包 KaTeX，并使用 MathML 输出、`trust: false`；沿用锁定的 0.16.43 版本，不新增公式库依赖。新 SDK 自己的静态文件仍需包含 KaTeX 运行时代码。
- 清洗后遍历普通文本节点识别行内与独立公式；`\# L：受限 HTML 富文本（D54）

**状态：设计提案，待负责人确认；尚未开工。** 本文只确定实现选型与影响评估，不授权 Codex 开始编码。正式行为仍以 [D54](../V2_ARCHITECTURE.md)、[数据结构说明书 1.1](../V2_DATA_STRUCTURES.md) 为准。

## 目标与范围

题干、选项、答案解析等富文本字段改为 HTML 字符串；显示时按 D54 白名单清洗。公式继续使用 `$…$` / `$$…$$`，图片继续使用 `qf-asset:路径`。只迁移 V2 基础题型展示库的 7 道示例题及单选、多选、判断三个题型。**不做编辑器**（排在第 6 段），不改后端对题目内容的原样存取，也不改评分流程。

## 实现选型

### HTML 清洗：DOMPurify 3.4.18

建议在浏览器题型 iframe 内使用 DOMPurify，固定版本，不自行编写 HTML 清洗器。该版本在 2026-11-14 发布；DOMPurify 本身使用浏览器 DOM 解析 HTML，适合当前隔离 iframe 的运行位置。

- 显式配置 D54 的 `ALLOWED_TAGS` 与 `ALLOWED_ATTR`，不采用库默认的宽泛 HTML/SVG/MathML 范围。
- 标签、属性严格按 [数据结构说明书 1.1](../V2_DATA_STRUCTURES.md)；未知标签、属性直接剔除，不报错。
- `style` 属性再用浏览器 CSSOM 解析，只重建 D54 列出的十种 CSS 属性；不允许其他 CSS 属性或自定义属性。
- URL 按元素分别限制：`img[src]` 只接受 `qf-asset:`；`a[href]` 只接受 `http:`、`https:`、`mailto:`。不允许远程图片地址。
- 清洗后再解析为 DOM；`qf-asset:` 图片通过现有 `QF.resources.get(reference)` 取资源，不把题库路径直接拼成 URL。

DOMPurify 的项目说明与版本：[npm](https://www.npmjs.com/package/dompurify)。其 3.4.15 版本的浏览器构建测量约 28.3 kB minified / 11.0 kB gzip；3.4.18 的最终增量以实际构建结果为准：[bundlewhys 测量](https://zachleat.github.io/bundlewhys/?package=dompurify)。

### 公式与图片

- 复用现有 KaTeX 0.16.43，不再引入第二个公式库。当前富文本静态组件已经打包 KaTeX，并使用 MathML 输出、`trust: false`；沿用锁定的 0.16.43 版本，不新增公式库依赖。新 SDK 自己的静态文件仍需包含 KaTeX 运行时代码。
- 清洗后遍历普通文本节点识别行内与独立公式； 保留为普通美元符号。公式不在 `code` / `pre` 内解析。
- 图片只允许 D54 的 `qf-asset:` 引用，通过现有资源通道加载；资源缺失沿用现有图片缺失提示，不回退到任意网络 URL。
- `QFRichText.render(container, htmlString)` 保持函数调用形式，第二个参数由树形 JSON 文档改为 HTML 字符串；返回对象仍提供 `ready` 与 `destroy`。

## 版本兼容与示例迁移

现有 `core/shared/richtext/1.1.3` 已发布，不原地修改。建议新增不可变的 `quizforge.richtext@2.0.0`，专门接收 HTML 字符串；旧的 1.1.3 继续供旧题库与历史快照使用。

V2 拓展规范规定：`question` / `solution` 数据格式变化必须升级拓展主版本。因此三个示例拓展从 `2.0.0` 升至 `3.0.0`，题库 `type` 从 `@2` 升至 `@3`，并将 `sdkVersions.richtext` 指向 `2.0.0`。拓展内 `QFRichText.render(element, value)` 的调用形式不变，只把 value 换成 HTML 字符串。

7 道示例题只转换富文本字段：
- 单选、多选：`question.stem`、`question.options[].content`、`solution.explanation`。
- 判断：`question.stem`、`solution.explanation`。
- 选择答案等非富文本字段（例如 `solution.selected`）保持原结构。

不修改 V1 的 `extensions/`、V1 富文本服务文档、现有 1.1.3 SDK 或其他用户题库。V2 的旧题型与冻结历史继续按各自声明的 SDK 版本读取。

## 体积影响

当前 `core/shared/richtext/1.1.3/richtext.js` 为 276,916 bytes，`richtext.css` 为 7,031 bytes；公式渲染已在该静态 JS 中。按 DOMPurify 3.4.15 的公开构建测量估算，新静态 JS 增加约 28.3 kB minified（约 11.0 kB gzip），即约 10% 的未压缩体积增幅；不新增 KaTeX 依赖，新版本仍需在自己的静态 JS 中打包锁定的 KaTeX 运行时代码。新版本实际 minified、gzip、CSS 体积必须在实现 PR 中实测记录，不能把估算当成最终值。

## 验证要求

1. 白名单正向测试覆盖 D54 全部标签、属性、样式；负向测试覆盖 script、事件属性、危险 URL、非白名单 CSS、SVG/MathML 等内容。
2. 公式测试覆盖行内、独立、转义美元符号、非法 LaTeX；图片测试覆盖 qf-asset 成功、缺失与拒绝远程 src。
3. 七道示例题在桌面与手机视口验证段落、表格、图片、公式显示；提交前不泄露 solution。
4. 历史快照继续使用原 SDK 版本；V1 原有富文本编辑与显示测试不受影响。
5. 实测新 SDK 的 JS minified/gzip、CSS 体积，并与当前 1.1.3 对比。

## 本次提案不包含

富文本编辑器、题库编辑器改造、Word 粘贴、HTML 写入时校验、后端清洗、题目数据自动迁移、V1 组件升级。以上不属于 D54 当前任务范围。

参考：[DOMPurify npm](https://www.npmjs.com/package/dompurify)、[DOMPurify 构建体积测量](https://zachleat.github.io/bundlewhys/?package=dompurify)、[V2 拓展版本规则](../reference/V2_EXTENSIONS.md)。
