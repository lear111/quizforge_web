# 独立题型拓展与目录分组

产品采用一个题型、一个独立拓展、一本同题型样例题库。相关拓展可以放入 `extensions/` 下的物理分组文件夹，分组只组织目录及列表展示，不是包协议，也没有 ID、版本、清单、规则或混合样例入口。题型 SDK 继续使用现有 API 1.0/1.1/1.2，题库格式仍为 v1。

## 当前目录与扫描

```text
extensions/
  基础题型/                         # 目录分组
    single-choice/                  # quizforge.single-choice@1.0.0
      manifest.json
      examples.json
      practice.*、rules.js、*.schema.json、editor.*
    short-answer-1.3.0/              # quizforge.short-answer@1.3.0
      manifest.json
      examples.json
      ...
  kaoyan-english-2026-dev/           # 独立组合题开发叶
    development.json
    ...
  ui-preview-dev/                   # 旧 UI 开发叶，只读兼容
    development.json
    ...
```

扫描最多四层分组、相对 `extensions` 深度五的叶目录，最多 1000 个目录节点和 200 个叶拓展；禁止符号链接与路径逃逸。遇到 `manifest.json` 或 `development.json` 时作为叶拓展，不继续扫描叶内源码/资源文件夹。分组层不要放这些标记。

分组中的 README、desktop.ini 等普通文件忽略，不因为保留说明文件而拒绝整组。

每个正式叶目录都沿用独立 `manifest.json` 的 ID、精确版本、名称、页面、规则、Schema、样例和可选编辑器/公共服务声明。声明路径相对本叶目录，不能读取其他叶目录。移动完整叶目录而不改变内部文件和身份，不改变题库绑定及内容指纹。

## 绑定和样例

正式绑定始终是 `{id,version}`，开发绑定是 `{development:"叶目录名"}`。题库不绑定分组路径，不需要 `extensionGroup`。普通题库可在逐题绑定中混用同组、跨组拓展，也可用根默认绑定。见 [题库说明](QUESTION_BANK_FORMAT.md)。

所有开发叶目录名在 `extensions` 中全局唯一，移动分组但保留叶名不会改变绑定；重复开发叶名会导致开发目录解析拒绝，不应靠完整组路径绕过冲突。关闭开发者模式时开发叶隐藏，正式拓展继续使用。

每个拓展的 `examples` 是一本普通格式题库，ID 为 `examples`，可以包含多道同题型内容或变体，但仅允许有效引用本拓展的精确 ID/版本。根默认绑定和每题绑定均可；样例不能引用同组其他拓展。带图片可使用 `examples/bank.json` 和相邻 `examples/assets/`，或现有 `examples.json` 与叶根 `assets/`。样例和普通题库共用题卡、编辑、大纲、富文本及切题流程，作答和历史独立保存。

开发叶也使用普通 manifest、页面注册与公开投影，样例直接精确绑定本叶计划正式 ID/版本，不通过新 QF_PREVIEW 流程。普通测试题库另用本叶 `{development}` 绑定。旧 mode 与 marker 声明仅兼容读取，不重写旧用户目录。

所有新制作的正式/开发样例默认 features 三项全开，无需询问，省略字段或写全 true；不能因为某本用户题库关闭了功能就同步关闭拓展样例。正式和开发样例在 editing 开启且接口已实现时可受控保存 examples 题目及专属图片；缺实现应明确报错，界面演示不能假保存。普通混合题库可在根 features 控制整库编辑、白板及历史含练习持久化，不支持逐题或分组覆盖，绑定与目录组织保持不变。

宿主不支持 `manifest.types`、`packageFormatVersion` 或绑定 `typeId`。一个叶拓展不能用 `data.kind` 切换为多个独立题型；确实属于一套组合题的内部小问可以有不同控件与结构，由大题型管理，保持父题答案、评分和小题定位接口。大纲仍先保持题序，再按连续同一拓展 ID/版本共用题型名称标题。

## 开发与发布

Agent 可直接在指定分组中的新开发叶目录制作 UI，通过现有拓展样例预览；用户确认对应题型的界面与交互后才实现真实接口。每个叶在同一 QF 管线逐步完善功能，标签和测试状态独立；不切 ui/runtime 模式。组授权不会授予修改同组其他拓展的权限。

更新正式代码先复制新开发叶并加标签，旧正式代码保留。用户确认完整验收后人工移除标记，不调用发布 API、不覆盖同 ID/版本、不自动改其他题库绑定。样例题目及专属资源可维护而不升代码版本。预览校验不执行规则，不能当作完整验收。公共富文本实现升级属于应用服务维护，无需改变拓展版本。只读 validator 递归发现分组、核对单题型清单、绑定、样例、Schema/规则及图片；它不能判断题型的业务边界或代替浏览器 UI/交互验证。完整约束见 [开发版拓展](DEVELOPMENT_EXTENSIONS.md)、[Agent 工作流](AGENT_BANK_WORKFLOW.md) 和 [技能分组参考](../../skills/quizforge-bank-builder/references/extension-development.md)。
