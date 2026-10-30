# 独立拓展、分组与开发

一题型一独立叶拓展、一本同题型样例。不同独立作答／判分流程分别建叶；组合题可在一个父题内包含不同小问控件，仍由父题管理。禁止 `manifest.types`、`packageFormatVersion`、`typeId`、组身份／版本，或用 `data.kind` 假注册多个独立题型；合法组合题可用私有字段表示内部结构。

## 分组与绑定

~~~text
extensions/
  我的题库组/
    choice/
      manifest.json
      practice.html / practice.js / practice.css
      rules.js / question.schema.json / answer.schema.json
      editor.json / editor.html / editor.js
      examples/bank.json
      examples/assets/
    reading/
      ...
~~~

题库与拓展都支持一层物理分组，叶目录名就是界面名称；不维护逻辑分组表。文件声明相对本叶，不用 ../ 访问其他叶。普通界面不提供拓展改名、移动、代码编辑，有题库引用时无法删除。

新普通题库绑定 {path:"extensions/<分组>/<拓展>"}，相对数据根目录；可选 id 随 path 核对；旧 {id,version} 和 development 绑定、根平铺拓展已退役，不能作为当前题库打开。每次导入新包都生成独立物理分组和路径引用，不要求作者维护 UUID，不复用其他已安装副本。

不创建或修改 .state/extension-groups.json；也不把宿主生成的 .instance.json/.bundle.json 放进交付包。旧项目个人数据迁移须另行授权。详见[宿主导入导出约定](../../../core/docs/reference/LIBRARY_PACKAGES.md)。

## 基础题型与已有样例

源码和已有样例统一在产品的 [单选题](../../../extensions/基础题型/单选题) 与 [简答题](../../../extensions/基础题型/简答题) 基础拓展中。先读 manifest/schema/rules 及声明的 examples，不再维护技能内 scaffold 或最小混合题库。基础题型按准确路径读取；同组复用已有副本，跨组复制到本组配套拓展目录并同步绑定；仅在用户授权范围内修改，更新前备份并保持答案结构兼容。

复用现有叶不新建样例；确需新题型且已获许可时复制合适叶到授权目录，赋予独立身份，维护复制过来的 examples 并改为新叶精确自绑定。不得让新叶跨目录引用参考样例或修改原基础叶。

## 提交与后台保存

提交按钮不要因后台草稿保存而禁用；提交时先 flush 等保存完成，并用 submitting 标志防止重复提交。 重做同样先等待组件和保存队列，并在执行期间防止重复点击。题目已提交或无保存权限时，flush 应丢弃遗留草稿，不重放旧草稿或沿用旧草稿错误；仍可保存时的失败必须继续抛出。

## 从 UI 到真实功能

完成 SKILL.md 的设计许可和 UI 访谈概要确认后才制作原型，在同一获准叶目录迭代。管理入口开关只影响入口，Agent 不改设置。

新叶使用普通 manifest，不新建旧 development 标记，从、`QF.page.register`、公开 `project`、`getScore` 返回的真实 `maxScore` 及少量代表题开始。manifest 计划 ID／版本和文件声明见 [API](extension-api.md#清单与公共服务声明)。未完成规则／Schema可做显示预览，但真实提交、评分、保存、编辑必须显式报 `DEVELOPMENT_NOT_IMPLEMENTED`，不能伪造成功；本地演示按 UI 文档标注。UI 获准后补齐同叶规则、Schema、编辑器及公共接口，处理 flush/dispose 和失败。

显示骨架用 `--allow-development --preview-only`，仅预览结构；完整检查只加 `--allow-development`，缺业务实现仍失败。校验、实际功能验收与整库生成的确认条件只按 SKILL.md。普通宿主只读完整 Manifest，旧标记不再补齐页面、样例、编辑器或静态资源；只读原型工具接受旧材料不代表它能在宿主运行。

## 每叶一本样例

`manifest.examples` 指向普通题库格式的 UTF-8 JSON，ID 为 `examples`；可含多道同题型变体，必须通过准确的 {path} 自引用本叶目录；不能引用其他叶或建组级混合样例。普通题库使用 `{path}`。图片在相邻 assets，用内容哈希引用，格式见 [题库](bank-format.md)。

新样例一律省略 features 或四项 true，免问；已有显式 false 可读，validator 仅警告 `EXAMPLE_FEATURES_SHOULD_BE_ENABLED`。样例和普通题库共用切题、编辑、大纲、白板及历史流程，状态独立。编辑开启时宿主可受控修改样例数据及专属图片，不修改版本代码；功能开关的持久化语义只见题库文档。

## 统一状态（2026-10-13 起）

题库与拓展没有开发版和正式版区分，不需要发布、复制版本或 development.json。可在用户授权范围内原位修改，先备份并保持答案结构和稳定 ID 兼容。新包使用格式 3、物理分组及准确路径引用，每次独立导入。ID/版本元数据不参与去重；本地安装目录也须升级，旧包由制作者升级后重新提供。不擅自搬动已有个人目录。
