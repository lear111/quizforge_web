# V1-FINAL：停止 v1 渐进优化并留档

任务卡：V1-FINAL（项目负责人第0步）。

改了什么：K2 #56 已按批准合并（d080b81）；在旧计划顶部加入负责人指定的原文状态说明，进度表取消全部未实施任务，已完成任务与测量记录保留。

明确没改什么：不改生产代码、依赖、测试、响应 JSON、状态码、规则输入、版本号、回执、持久化格式；不读取真实题库或 .state，不启动或停止日常服务。不是V2实现。

兼容性：纯文档，v1程序及四份标准答案均未改。

计时：不适用，未改业务实现。

测试：git diff --check；CI沿用现有Windows、Ubuntu与Performance三job，结果在合并前核对。没有新增业务用例。CI失败用例名单在本次运行完成后补充。

未解决或存疑：文档原文在附件获得后将逐字节复制到长期v2分支。旧计划引用的V2_ARCHITECTURE.md仅在v2分支加入，main保留v1归档。此PR合并后给main打v1-final标签，再从该标签建立v2；不提前移动标签、不直接推main。

文件清单：core/docs/design/ARCHITECTURE_REFACTOR_PLAN.md、core/docs/design/reviews/V1-FINAL.md。
