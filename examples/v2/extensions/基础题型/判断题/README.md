# 判断题（V2）

apiVersion 2，主版本 2；接口以 core/docs/reference/V2_EXTENSIONS.md 为准。页面在隔离 iframe 中渲染/采集答案、报告 answered；提交、重做与分数在页面内部，保存、锁定及评分调度由宿主完成。grade.js 仅在隔离浏览器 Worker 执行。富文本 SDK 1.1.3 负责公式、表格、图片；页面无网络权限。

answer.value 为 true、false 或 null；solution.value 为布尔值。false 代表已选择“错误”，null 才是未作答。 满分取自大纲 item.maxScore，解析为 solution.explanation。只有锁后才有 solution。完整演示与启动方式见 examples/v2/README.md。
