# V2 进度

功能顺序与协作按 [工作流程](V2_WORKFLOW.md)。本页只保留状态和索引；历史说明、实测数据与决定见各任务记录；[G 前完整快照](archive/V2_PROGRESS_BEFORE_G.md)保留全部旧文。

## 功能总表

| 段与名称 | 当前状态 | 对应 PR | 独立记录 |
|---|---|---|---|
| 1 · 打开题库与单选评分 | 已审查合并，负责人试用确认 | [#60](https://github.com/lear111/quizforge_web/pull/60)、[#63](https://github.com/lear111/quizforge_web/pull/63)、[#64](https://github.com/lear111/quizforge_web/pull/64) | [记录](reviews/V2-P1-1.md)、[记录](reviews/V2-SEG1-PRACTICE.md) |
| 2 · 多题型、自动保存、白板与刷新 | 已完成，负责人 2026-11-13 试用确认 | [#69](https://github.com/lear111/quizforge_web/pull/69)、[#73](https://github.com/lear111/quizforge_web/pull/73)、[#76](https://github.com/lear111/quizforge_web/pull/76)、[#83](https://github.com/lear111/quizforge_web/pull/83)、[#85](https://github.com/lear111/quizforge_web/pull/85)、[#91](https://github.com/lear111/quizforge_web/pull/91) | [记录](reviews/V2-SEG2-DESIGN.md)、[记录](reviews/V2-SEG2-BASIC.md) |
| 2.5 · V1 清点与切库测量 | 已审查合并；后续旧链清理留第 7 段 | [#98](https://github.com/lear111/quizforge_web/pull/98)、[#101](https://github.com/lear111/quizforge_web/pull/101)、[#102](https://github.com/lear111/quizforge_web/pull/102)、[#108](https://github.com/lear111/quizforge_web/pull/108)、[#109](https://github.com/lear111/quizforge_web/pull/109) | [记录](reviews/V2-SEG2-5-V1-INVENTORY.md)、[记录](reviews/V2-SEG2-5-BANK-RETURN.md)、[记录](reviews/V2-SEG2-5-V1-RETIREMENT.md) |
| 3 · 完成练习、汇总、历史 | 完成与汇总已试用确认；归档/历史待 J | [#107](https://github.com/lear111/quizforge_web/pull/107)、[#110](https://github.com/lear111/quizforge_web/pull/110)、[#112](https://github.com/lear111/quizforge_web/pull/112) | [记录](reviews/V2-SEG3-KICKOFF.md)、[记录](reviews/V2-SEG3-WORKSPACE.md)、[记录](reviews/V2-SEG3-FINISH.md) |
| 4 · 考试 | 设计定稿，尚未实现（K） | — | [记录](reviews/V2-K-EXAM.md) |
| 5 · 简答、AI/人工评分与设置 | 尚未开始；已确认边界保留，复杂答题区后续单独设计 | [#153](https://github.com/lear111/quizforge_web/pull/153)（仅文档） | [记录](reviews/V2-SEG5-REQUIREMENTS.md) |
| 6 · 导入导出、Hub、编辑器与开发模式 | 尚未开始 | — | [记录](reviews/V2-SEG6-REQUIREMENTS.md) |
| 7 · 删除旧代码、打包与性能复测 | 尚未开始 | — | [记录](reviews/V2-SEG7-REQUIREMENTS.md) |

## 任务表（保持既定顺序）

| 任务编号与名称 | 当前状态 | 对应 PR | 独立记录 |
|---|---|---|---|
| A · 后端搬家 | 已审查合并 | [#126](https://github.com/lear111/quizforge_web/pull/126) | [记录](reviews/V2-BACKEND-LAYOUT.md) |
| B · 浏览器检查进入 CI | 已审查合并 | [#127](https://github.com/lear111/quizforge_web/pull/127) | [记录](reviews/V2-BROWSER-CI.md) |
| C · 后端拆分与精简 | 已审查合并 | [#129](https://github.com/lear111/quizforge_web/pull/129)、[#133](https://github.com/lear111/quizforge_web/pull/133) | [记录](reviews/V2-BACKEND-SPLIT.md)、[记录](reviews/V2-OUTLINE-DIAGNOSTICS.md) |
| D · Vue / Pinia / Router 重组 | 已审查合并；启动不自动打开题库（D63） | [#136](https://github.com/lear111/quizforge_web/pull/136)、[#137](https://github.com/lear111/quizforge_web/pull/137)、[#138](https://github.com/lear111/quizforge_web/pull/138)、[#139](https://github.com/lear111/quizforge_web/pull/139)、[#140](https://github.com/lear111/quizforge_web/pull/140) | [记录](reviews/V2-FRONTEND-LAYOUT.md)、[记录](reviews/V2-FRONTEND-API.md)、[记录](reviews/V2-FRONTEND-PINIA.md)、[记录](reviews/V2-FRONTEND-ROUTER.md)、[记录](reviews/V2-FRONTEND-COMPONENTS.md) |
| E · 共享类型与后端严格检查 | 已完成、已审查合并 | [#142](https://github.com/lear111/quizforge_web/pull/142)、[#143](https://github.com/lear111/quizforge_web/pull/143)、[#149](https://github.com/lear111/quizforge_web/pull/149) | [记录](reviews/V2-SHARED-TYPES.md)、[记录](reviews/V2-SHARED-CONTRACTS.md)、[记录](reviews/V2-SERVER-TYPES.md) |
| I · 界面原型第 1 版 | 已审查合并；保留题卡阴影、去掉当前题库题数 | [#150](https://github.com/lear111/quizforge_web/pull/150) | [记录](reviews/V2-WORKSPACE-UI.md) |
| F · 沙箱、保存与类型安全整理 | F①–F⑧ 全部已完成并合并；无额外 F 子任务 | 见以下各行 | 见以下各行 |
| F① · 题页装载 | 已审查合并，CI 通过 | [#151](https://github.com/lear111/quizforge_web/pull/151) | [记录](reviews/V2-F-PAGE.md) |
| F② · 评分环境 | 已审查合并，CI 通过 | [#152](https://github.com/lear111/quizforge_web/pull/152) | [记录](reviews/V2-F-GRADING.md) |
| F③ · 保存机制 | 已审查合并，CI 通过 | [#154](https://github.com/lear111/quizforge_web/pull/154) | [记录](reviews/V2-F-SAVING.md) |
| F④ · 拓展文件缓存 | 已审查合并，CI 通过 | [#158](https://github.com/lear111/quizforge_web/pull/158) | [记录](reviews/V2-F-SOURCE-CACHE.md) |
| F⑤ · 完成与批量评分 | 已审查合并，CI 通过 | [#160](https://github.com/lear111/quizforge_web/pull/160) | [记录](reviews/V2-F-COMPLETION.md) |
| F⑥ · Store 动作与依赖 | 已审查合并，CI 通过 | [#162](https://github.com/lear111/quizforge_web/pull/162) | [记录](reviews/V2-F-STORE-ACTIONS.md) |
| F⑦ · 完成状态与路由 | 已审查合并，CI 通过 | [#165](https://github.com/lear111/quizforge_web/pull/165) | [记录](reviews/V2-F-COMPLETION-ROUTING.md) |
| F⑧ · 后端断言及 health 清理 | 已审查合并，CI 通过 | [#167](https://github.com/lear111/quizforge_web/pull/167) | [记录](reviews/V2-F-SERVER-ASSERTIONS.md) |
| I② · 第三版界面（D64） | **代码已合并，待负责人试用**；不视为试用通过 | [#170](https://github.com/lear111/quizforge_web/pull/170)、[#171](https://github.com/lear111/quizforge_web/pull/171) | [记录](reviews/V2-I2-UI-PROTOTYPE.md) |
| G · 测试与文档整理 | 已审查合并（CI 五项通过，`b32e4bf`） | [#172](https://github.com/lear111/quizforge_web/pull/172) | [记录](reviews/V2-G-ENGINEERING.md) |
| H · 长度规则强制 | 已审查合并，CI 五项通过；两处精确浏览器闭包例外已批准（`b3f7c16`） | [#174](https://github.com/lear111/quizforge_web/pull/174) | [记录](reviews/V2-H-LENGTH-POLICY.md) |
| J · 归档与历史 | 前置性能测量 CI 五项通过，待审查；迁移、归档与历史尚未实现 | [#176](https://github.com/lear111/quizforge_web/pull/176) | [记录](reviews/V2-J-HISTORY.md) |
| K · 考试（D49–D52） | 尚未开始 | — | [记录](reviews/V2-K-EXAM.md) |
| L · 受限 HTML 富文本（D54） | 尚未开始，先提交设计说明 | — | [记录](reviews/V2-L-RICHTEXT.md) |
