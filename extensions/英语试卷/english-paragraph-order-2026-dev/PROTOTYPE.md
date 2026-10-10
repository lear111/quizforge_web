# UI 原型

本叶只实现显示骨架与标注的本地 UI 演示。规则保存、提交、评分、AI 准备、正式编辑均未实现。默认完整校验应失败；使用 --allow-development --preview-only 仅检查结构。

请使用 .temp/2026-english1-bank/preview/index.html 的本地预览查看三态，或手动开启宿主开发者模式后查看样例。AI 按钮的计划接口是 QF.ai.grade({force:false})，反馈通过既有 Reply/任务状态显示，原型不发起模型调用。正式发布前必须删除演示答案 fixtures、实现并验证全部业务。
