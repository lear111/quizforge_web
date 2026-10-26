# 开发者文档

运行环境为 Node.js 24，Extension API 为 1.5，题库格式为 1。路径示例相对于产品根目录。

| 文档 | 内容 |
| --- | --- |
| [使用手册](guides/USER_GUIDE.md) | 启动、目录管理、练习、白板、编辑、导入导出、网络、AI 与更新的完整说明 |
| [产品功能清单](../../FEATURES.md) | 用户可见功能、操作入口及功能测试预期 |
| [API 文档](reference/API.md) | 页面 SDK、规则、HTTP 与保存约定 |
| [宿主悬浮听力](reference/LISTENING.md) | 题库音频、共享播放器、考试快照、拖动缩放及演示题库 |
| [手写答题区](reference/ANSWER_AREAS.md) | 可选 API 1.5 组件、笔迹保存、提交出图、AI 与独立样例 |
| [答题区至单题编辑同步交接](guides/ANSWER_AREA_SYNC_2026-10-21.md) | 本轮最终规则、共享源码基线、Hub／Android 适配清单与验收边界 |
| [开发与架构](guides/CORE_SOURCE.md) | 启动、测试、模块职责及数据流 |
| [Windows 启动与安装构建](../desktop/README.md) | 托盘、程序与数据分离、ZIP/安装包及安装验收 |
| [拓展开发](reference/EXTENSIONS.md) | 文件组织、分组、绑定、样例与兼容 |
| [题库格式](reference/QUESTION_BANK_FORMAT.md) | bank.json、功能开关、资源及 .qbank |
| [导入导出与迁移交接](reference/LIBRARY_PACKAGES.md) | 物理分组、路径绑定、独立副本导入和包格式 3 |
| [大纲与作答状态](reference/SUBQUESTION_OUTLINE.md) | 稳定 ID、定位、即时反馈及评分状态 |
| [富文本服务](reference/RICHTEXT_SERVICE.md) | 文档约定、编辑器、图片与拍照 |
| [考试模式](reference/EXAM_MODE.md) | 计时、交卷、权限与历史 |
| [兼容与迁移](reference/COMPATIBILITY.md) | 版本声明、冻结历史及显式数据升级 |

完整页面、规则、AI 和 HTTP 接口见 [API 文档](reference/API.md)；后端路由与存储细节见 [宿主说明](../server/README.md)；源码目录见 [core/README.md](../README.md)。
