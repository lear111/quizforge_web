# 富文本服务与编辑器实现

拓展通过 `QF.content` 使用应用的富文本服务，当前实现仍为 Tiptap。拓展只绑定公共接口、文档格式和文档能力约定；Tiptap 的 npm 版本、组件发布版本、工具栏和内部编辑器实例由应用管理。

## 新拓展的声明

```json
"requiresRichText": {
  "major": 1,
  "minMinor": 0,
  "documentFormat": 1,
  "documentProfile": "advanced-v1",
  "capabilities": ["basic-formatting", "images", "tables", "math"]
}
```

`major`、`minMinor`、`documentFormat`、`documentProfile` 必填，`capabilities` 可省略或为空。能力必须为不重复的字符串；不支持的接口版本、格式、文档约定、能力或未知字段明确拒绝。不能同时填写新声明与旧 `dependencies`。不使用富文本的拓展可省略两者。

当前公共接口为 1.0，文档格式为 1：

| 文档约定 | 允许的内容与能力 |
| --- | --- |
| `basic-v1` | 基础格式、段落、标题、列表、引用、代码、链接、图片；能力 `basic-formatting`、`images` |
| `advanced-v1` | 基础内容及字体、字号、颜色、高亮、上下标、段落布局、图片宽度与对齐、表格和公式；另有 `advanced-formatting`、`tables`、`math`、`image-resize` |

能力声明说明拓展需要哪些功能，不会把高级文档限制为这些功能的子集。拓展的 Schema、规则和编辑草稿必须能够处理所选文档约定。旧基础规则不能通过仅声明 `images` 来接受高级编辑器输出。文档约定的含义不能在同名下改变；增加不兼容的持久化节点须提供新的约定及适配。

## 公共接口与应用实现

`QF.content.api` 提供只读 `{major,minor,documentFormat,documentProfile,capabilities}`；未登记文档约定的旧精确依赖保留原方法，但该元数据为 `null`，不猜测其兼容范围。现有 `render`、`createEditor`、`validateDocument`、`cloneDocument`、`isEmpty`、`fromEditorDocument` 和文档常量继续使用。编辑器句柄保留 `ready/getDocument/setDocument/focus/flush/isUploading/destroy`；高级约定还支持 `setAdvanced/isAdvanced`。拓展不得调用 Tiptap、`QFRichText`、`configure` 或 `_createEditor` 等实现细节。

保存的是 QuizForge 文档 JSON 和图片资源哈希，不能保存 Tiptap 实例、临时 Blob URL、任意 HTML 或编辑器私有状态。接口层接收、输出相同的文档约定；未来换编辑器应实现这个适配层，而不是更改题库格式。规则中的题型校验、评分与 AI 输入转换仍由拓展负责。

应用在 `core/shared/richtext/service.json` 中维护各约定的已验证实现，以及旧精确依赖的兼容映射。该配置属于核心，制作题型的 Agent 不得修改。当前 `basic-v1` 使用组件 1.0.0，`advanced-v1` 使用组件 1.1.2。新拓展无需知道这个组件版本。

## 旧拓展、当前作答和历史

- 原 Manifest 中的 `quizforge.richtext@1.0.0` 保留基础实现；`1.1.0/1.1.1/1.1.2` 在当前练习和编辑页面使用应用指定的高级兼容实现。未知旧版本按原精确依赖读取，不猜测兼容性。
- 不改写已发布拓展、题库、作答、笔迹或编辑草稿。实现更新不改变题目内容版本和编辑草稿身份，只改变页面资源版本，使浏览器重新加载相应页面。
- 历史记录固定创建时实际选择的组件版本和接口元数据；已经存在的历史继续读取原引用，不经过当前兼容映射。所有已使用的组件仍在 `.state/sdk/` 中按版本固定保存。
- 同一组件版本不可原地重建。公开接口与文档约定不变的实现修复只发布组件，并更新应用的已验证实现选择，无须发布题型新版本。题型行为、数据结构、规则或页面自身发生变化时才发布新的拓展版本。

## 维护和验证

在新组件版本目录准备 `src/` 与 `richtext.css`，修改该新目录内的实现版本，然后在 `core/` 执行，例如：

```sh
npm run build:richtext-advanced -- --version 1.1.3
```

这是发布新版本的命令示例，1.1.3 当前并未提供。构建只处理富文本组件，不编译或改写拓展。已存在输出的目录拒绝重建。基础组件使用 `build:richtext`，同样传入新版本。

选择新的实现前，用原样旧拓展验证只读渲染、编辑保存、草稿恢复、图片和高级节点、评分及 AI 输入；再验证当前答案与笔迹保留、资源缓存更新，以及旧历史重启后仍按原组件显示。基础与高级约定分别验证，不能从高级约定通过推断基础也兼容。
