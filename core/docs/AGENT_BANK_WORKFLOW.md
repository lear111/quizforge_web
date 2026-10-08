# 用 Agent 制作题库

将产品根目录里的 [skills/quizforge-bank-builder](../../skills/quizforge-bank-builder/) **整个文件夹**交给 Agent（技能压缩包解压后为 `quizforge-bank-builder/`）。支持 SKILL.md 的应用可放到它的技能目录；不支持技能安装的应用也可以让 Agent 先阅读其中的 SKILL.md，再按相对路径读取参考和执行脚本。`agents/openai.yaml` 是可选的 Codex 显示信息，工作流程不依赖它。

同时提供材料、QuizForge Web 产品根目录和输出目录。产品根目录包含同层的 `core/`、`extensions/`、`question-banks/`、`skills/` 和启动入口；核心契约、SDK、规则执行器与依赖分别在 `core/IMPLEMENTATION_CONTRACT.md`、`core/shared/`、`core/server/rules-runner.cjs`、`core/node_modules/`。仅提供 skill 可以分析材料，但不能确认真实可用的拓展，也不能运行项目规则校验。

校验器 `--project` 始终指向外层产品根目录，不指向 `core/`。脚本需要现有 Node.js 24；没有 `core/` 时兼容旧平铺 fixture，存在但不完整时会报错，不回退到旧副本或安装依赖。制作题库的 Agent 只能新增外部题库和经确认的拓展，不得修改 `core/`、根启动脚本或 `.state/`。

可以直接使用这段提示，替换路径：

> 请阅读 `<技能目录>/SKILL.md`，用这个技能把所附材料生成 QuizForge Web 题库。产品根目录在 `<包含 core 和 extensions 的目录>`，输出到 `<输出目录>`。先分析全部题目并匹配已安装拓展。缺少题型时先向我申请；同意新建后先展示未提交、提交后、编辑三个 UI 状态，等我确认再实现。只能创建题库和外部拓展，不得修改 core、启动脚本或已有数据。请以产品根目录作为 --project 实际运行校验并说明验证范围。

默认交付形态：

```text
输出目录/
  question-banks/新题库/bank.json
  question-banks/新题库/assets/       # 有图片时
  extensions/新拓展版本/             # 经过确认、确有新拓展时
  制作报告.md
```

将生成的新题库目录复制到项目 `question-banks/`，新拓展目录复制到 `extensions/`。在应用刷新列表；运行中的服务若未载入新内容，重启后查看。复制时保留 assets 与完整拓展文件，不覆盖相同 id/version 的旧包。

验收时注意：数量与顺序对应材料；未提交时不会泄露答案；提交后评分正确或进入待批改；富文本与图片可见；编辑保存能恢复；混合题型大纲按连续顺序分组。校验脚本通过只代表结构和部分规则检查，不代表这些浏览器行为已经验证。

技能里的版本示例对应单选 1.0.0、简答 1.2.1、富文本 SDK 1.1.1。Agent 必须检查你实际安装的包，不应自动下载插件、安装依赖、改源码或填写 API Key。缺少解析或预览能力时，应交付明确标注验证缺口的草案。
