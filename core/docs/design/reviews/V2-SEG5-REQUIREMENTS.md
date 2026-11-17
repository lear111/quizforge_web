# 第 5 段：保留的需求与待决边界

**状态：尚未开工。** 本文件仅把整理前进度页的既有要求迁入独立记录，不是新增设计、开工批准或实现；不得由 G 自动开始。

简答、AI/人工改分、设置待实现；答题区与作答文件按 D55–D59，评分职责按 D60–D62，AI 评分粒度与点评粒度按 D67。独立 `grade.js` 自动/批量评分，`practice.js` 人工评分；纯人工题型暂用 `{ score: null }`。`QF.page.grade`、`/result` 的 manual source 与评分备注尚未接通。AI 评分按大纲决定整题或小题分数，但无论哪种都只保存一段整题综合点评；后端校验格式与分数后写入现有 `{ score, parts, message }`，不增加逐小题点评结构。AI 完整请求、抢占与回滚流程仍需在第 5 段设计中落实。Agent 辅导由负责人以后单独设计，与评分的 `QF.ai.ask` 无关；不从旧原型擅自接入聊天。

出处：[G 前完整快照](../archive/V2_PROGRESS_BEFORE_G.md)。正式决定仍以 [总体设计](../V2_ARCHITECTURE.md)、[数据结构](../V2_DATA_STRUCTURES.md)和[接口速查](../V2_API_AND_STATE.md)为准。
