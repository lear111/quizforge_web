# 独立拓展、分组与开发

一题型一独立叶拓展、一本同题型样例。不同独立作答／判分流程分别建叶；组合题可在一个父题内包含不同小问控件，仍由父题管理。禁止 `manifest.types`、`packageFormatVersion`、`typeId`、组身份／版本，或用 `data.kind` 假注册多个独立题型；合法组合题可用私有字段表示内部结构。

## 分组与绑定

```text
extensions/
  我的英语题型/                 # 物理分组，无 manifest 或开发标记
    choice-dev/                # 全局唯一开发叶名
      development.json
      manifest.json
      practice.html / practice.js / practice.css
      rules.js / question.schema.json / answer.schema.json
      editor.json / editor.html / editor.js
      examples/bank.json
      examples/assets/         # 必要时
    reading-dev/               # 另一独立题型
      ...
  single-choice/               # 根层叶目录也支持
    manifest.json
```

最多四层分组、叶深度五，1000 个目录节点／200 个叶。发现 `manifest.json` 或 `development.json` 即为叶并停止下探；分组不放标记、规则、混合样例或共同版本，普通 README／说明图片不参与发现。文件声明相对本叶，不能用 `../` 访问其他叶。

正式绑定为精确 `{id,version}`，开发测试绑定 `{development:"全局唯一叶名"}`；不写组路径或 `extensionGroup`。移动完整叶而保持正式身份／开发叶名不变，不改变绑定。普通题库可混用同组或跨组叶，分组仅管理目录和列表，不决定题型或大纲分类。

## 从 UI 到真实功能

完成 SKILL.md 的设计许可和 [UI 访谈概要确认](ui-design.md) 后才复制模板／写显示骨架；始终在同一个获准的 `extensions/<开发叶>/` 内迭代。开发版共用正式 QF 管线，多开发标签、热刷新和测试隔离，不新增 ui/runtime 模式或 `QF_PREVIEW`。用户通过本机开发者设置开启显示，正常启动；Agent 不改设置。

新叶写 `development.json:{}`，从普通 manifest、`QF.page.register`、公开 `project`、`getScore` 返回的真实 `maxScore` 及少量代表题开始。manifest 计划 ID／版本和文件声明见 [API](extension-api.md#清单与公共服务声明)。未完成规则／Schema可做显示预览，但真实提交、评分、保存、编辑必须显式报 `DEVELOPMENT_NOT_IMPLEMENTED`，不能伪造成功；本地演示按 UI 文档标注。UI 获准后补齐同叶规则、Schema、编辑器及公共接口，处理 flush/dispose 和失败。

显示骨架用 `--allow-development --preview-only`，仅预览结构；完整检查只加 `--allow-development`，缺业务实现仍失败。校验、实际功能验收与整库生成的确认条件只按 SKILL.md。旧标记中 entry/script/style/examples/editor/assets 仅只读补缺兼容，manifest 优先，不为新叶创建旧协议。

## 每叶一本样例

`manifest.examples` 指向普通题库格式的 UTF-8 JSON，ID 为 `examples`；可含多道同题型变体，所有有效绑定必须精确自引用本叶计划正式 ID／版本。不能引用同组其他叶、用开发绑定替代样例自绑定或建组级混合样例；开发绑定留给普通测试库。图片在相邻 assets，用内容哈希引用，格式见 [题库](bank-format.md)。

新正式／开发样例一律省略 features 或三项 true，免问；已有显式 false 可读，validator 仅警告 `EXAMPLE_FEATURES_SHOULD_BE_ENABLED`。样例和普通题库共用切题、编辑、大纲、白板及历史流程，状态独立。编辑开启时宿主可受控修改样例数据及专属图片，不修改版本代码；功能开关的持久化语义只见题库文档。

## 更新与发布

正式代码禁止原地改：更新先完整复制为新唯一开发叶并加标记，旧正式叶及其他题库绑定保留；发布前使用新的 version。新题型使用独立 ID。只维护获准的正式样例题目与专属资源可不升代码版本；manifest.assets 声明资源仍属于代码。

当前无发布按钮，不调用发布 API。完整校验和实际效果获用户明确发布确认后，人工移除开发标记，检查新的 ID／版本、样例精确自绑定、manifest/editor 声明与资源完整，再跑正式完整校验。获准生成整库不授权发布，不自动迁移旧绑定或改同组其他叶。把旧多型包拆分或迁移现有题库需另获明确授权。

写入边界、临时路径和阶段条件以 SKILL.md 为唯一规则；此规范不声称程序已实施文件写锁。
