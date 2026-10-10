# 用 Agent 制作题库

将产品根目录里的 [skills/quizforge-bank-builder](../../skills/quizforge-bank-builder/) **整个文件夹**交给 Agent（技能压缩包解压后为 `quizforge-bank-builder/`）。支持 SKILL.md 的应用可放到它的技能目录；不支持技能安装的应用也可以让 Agent 先阅读其中的 SKILL.md，再按相对路径读取参考和执行脚本。`agents/openai.yaml` 是可选的 Codex 显示信息，工作流程不依赖它。

同时提供材料、QuizForge Web 产品根目录和输出目录。产品根目录包含同层的 `core/`、`extensions/`、`question-banks/`、`skills/` 和启动入口；核心契约、SDK、规则执行器与依赖分别在 `core/IMPLEMENTATION_CONTRACT.md`、`core/shared/`、`core/server/rules-runner.cjs`、`core/node_modules/`。仅提供 skill 可以分析材料，但不能确认真实可用的拓展，也不能运行项目规则校验。

制作过程中所有临时文件只放在 `C:\Users\wangg\OneDrive\Desktop\QuizForge\quizforge_web\.temp` 及其子目录，包括解包、提取、临时脚本、测试产物和独立临时预览；工具临时目录和缓存也指向此处。实际拓展代码／样例和最终题库／交付报告仍放在各自获准的位置。路径不可用时报告，不自行换到系统临时目录。

校验器 `--project` 始终指向外层产品根目录，不指向 `core/`。脚本需要现有 Node.js 24；没有 `core/` 时兼容旧平铺 fixture，存在但不完整时会报错，不回退到旧副本或安装依赖。制作题库的 Agent 只能修改用户指定的开发目录、授权的新题库和输出文件，并可在指定 `.temp` 内写入临时文件；不得修改 `core/`、根启动脚本、配置、`.state/` 或 `.development/.state/`，不得改其他拓展或覆盖已发布版本。

版本规则见 [API v1 与更新兼容政策](COMPATIBILITY.md)：当前 API 支持 1.0／1.1／1.2，题库顶层格式仅支持 1；旧文件缺少声明时按 v1.0 读取，不补字段、不换绑定。新生成题库填写 `formatVersion:1`，新拓展可声明 `requiresApi`，由只读校验器在跑任何规则之前检查版本与能力。共享题干包含多个小问时，在题库每题的 `outline` 中选择大题自身或有序小题，所有入口继承大题型，原题序优先，再连续同型共用矩阵标题；格式见 [题库说明](QUESTION_BANK_FORMAT.md)。小题定位使用拓展的 [API 1.1 定位回调](SUBQUESTION_OUTLINE.md)，无需再通过 getOutlineItems 生成新题库目录，仍保存父题完整答案并汇总父题分值。大纲小题状态使用 API 1.2 的 getScore 可选 outlineStates，只提供 unanswered/correct/incorrect，不新增方法、不修改宿主；与目录的稳定 ID 匹配，判分细节由拓展保存，历史冻结当轮状态。未提交含草稿为中性，提交后满分为正确，低于满分或仍待评分为错误，但待评分保留 null 分。不要让 Agent 为兼容更新改写旧包、旧题库或核心；接口不足时提供开发者反馈与替代方案。

制作流程与确认条件以技能的 [SKILL.md](../../skills/quizforge-bank-builder/SKILL.md) 为准：功能选择 → 材料与选型 → UI 逐轮访谈及需求概要确认 → 实际三态原型确认 → 真实接口与小样 → 用户验收并许可正式生成 → 整库交付。复用现有拓展也核对期望和实际效果；同意新建、确认概要、确认原型和许可生成不互相替代。样例三项功能默认全开，免问；已有明确决定沿用。技能不能保证外部应用遵守，第一条消息应清楚限定阶段。

根 `features:{editing?,whiteboard?,history?}` 只接受 boolean，缺项为 true，不支持逐题覆盖。关闭 history 同时关闭答案、分数、白板、完成状态、历史、练习上传图片及 AI 任务的持久化，只在当前浏览器页面会话有效；刷新或关闭浏览器标签后不能恢复。editing 仍开时题目文件和编辑图片仍可以保存。新样例三项必须全开，但现存显式 false 样例应用仍允许，validator 仅警告制作规范。具体语义见 [题库说明](QUESTION_BANK_FORMAT.md#整库功能开关)。

多个相关题型分别制作成独立拓展，可由 Agent 放入用户指定物理分组中；每个叶拥有独立 ID/版本、Schema、页面、规则，以及一本仅本题型的普通格式样例题库。规则见 [独立拓展与分组](EXTENSION_GROUPS.md) 和技能的 [extension-development.md](../../skills/quizforge-bank-builder/references/extension-development.md)。普通题库通过逐题 `{id,version}` 混用同组或跨组拓展；开发绑定用全局唯一叶名 `{development}`。禁止 manifest.types、packageFormatVersion、typeId 或用私有 kind 切换多个独立题型；合法组合题的小问仍由大题型管理。每个题型保持 UI 确认门，组授权不允许修改同组其他拓展。

新题型获得设计许可并完成 UI 访谈、概要获准后，才在 `extensions/<开发目录>/` 建立显示骨架。用户开启开发者模式、普通启动即可；开发和正式共用 QF 管线。开发叶加 `development.json:{}`，用普通 manifest、页面注册、公开投影、真实 maxScore 和代表题样例预览，不切 ui/runtime 或创建 QF_PREVIEW。缺真实动作明确报错，本地演示标注，不伪造保存或评分。分组、样例及开发规则见技能的 [拓展开发](../../skills/quizforge-bank-builder/references/extension-development.md)。

第一条消息可直接用下面的提示，替换路径：

> 请完整阅读 `<技能目录>/SKILL.md`，按它的流程制作题库。材料见附件，产品根目录在 `<包含 core 和 extensions 的目录>`，最终题库与报告到 `<输出目录>`。先确认功能开关并分析材料，再按 `references/ui-design.md` 逐轮问清三态与编辑项目；让我确认概要后才做实际原型，原型确认后才接业务。功能验收并获正式生成许可前不要批量制作，不修改应用核心、设置、状态或已有正式代码。

看过全部题型原型后，可回复“确认这些题型的 UI 与交互方案，请完善真实接口交互并制作少量小样验证，完成后展示实际功能，先不要生成完整题库”。有调整时先指出布局／交互问题，让 Agent 修改原型。没有可视化或运行工具时先看清验证缺口，再决定是否接受替代评审；结构校验通过不代表 UI 已验证。具体评审要求见技能中的 [ui-design.md](../../skills/quizforge-bank-builder/references/ui-design.md)。

所有题型 UI 与接口交互完成并展示小样验证结果后，再进行功能验收。认可后可回复“确认小样的实际界面与功能，同意按此方案正式生成完整题库”。这是与需求概要和实际 UI 分别独立的生成确认：UI 确认只授权实现和小样验证，小样通过不能自动进入批量生成。接受验证缺口也不自动等于同意生成；拓展正式发布仍需另外确认。

确认 UI 后，在同一开发叶逐步完善真实业务和 Schema/规则/编辑器。样例从开始就精确自引用 manifest 的计划 ID/版本；普通测试题库可用 `extension:{development:"叶名"}`，由宿主隔离状态。完整校验加 `--allow-development`，缺实现仍失败；骨架可另加 `--preview-only`，不执行题型规则、不验收总分，必须报告 preview / full 区别。结构校验不能代替实际三态、交互和历史验证。

默认交付形态：

```text
输出目录/
  question-banks/新题库/bank.json
  question-banks/新题库/assets/       # 有图片时
  制作报告.md

产品目录/extensions/指定开发目录/   # 从显示骨架到完整业务，同一 QF 管线
产品目录/extensions/新正式版本/     # 用户确认后人工移除标记的完整版本
```

将生成的新题库目录复制到项目 `question-banks/`，在应用刷新列表。开发叶直接位于项目中，可见样例自动刷新。更新旧正式代码必须先复制为新唯一开发叶并加标记，旧版保留；只修改正式样例题目及专属图片可以不升版本。当前无发布按钮，Skill 不调用发布 API；完整验证并得到用户发布确认后，人工移除标记，确认样例精确自 ID/版本及声明完整，重新做正式完整校验。其他题库不自动改绑，复制题库时保留 assets。上述文件边界是书面规范，不是新增程序写锁。

验收时注意：数量与顺序对应材料；未提交时不会泄露答案；提交后评分正确或进入待批改；富文本与图片可见；编辑保存能恢复；混合题型大纲按连续顺序分组。校验脚本通过只代表结构和部分规则检查，不代表这些浏览器行为已经验证。

技能里的版本示例不是安装清单。Agent 必须检查你实际安装的包，不应自动下载插件、安装依赖、改源码或填写 API Key。缺少解析、预览或运行能力时停在分析／设计／小样阶段，说明具体缺口；用户明确接受替代评审或未运行验证的交付后才能继续，不直接制作整库再标成草案。
