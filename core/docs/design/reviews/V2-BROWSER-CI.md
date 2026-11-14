# 任务 B · 浏览器检查接入 CI

**改动。** 新增 Ubuntu 的 `V2 browser checks` job，覆盖目标为 `v2` 的 PR 和 `v2` 的推送。固定 Playwright 版本，并用其配套 Chromium 无窗口运行；工具安装在运行器临时目录，运行前重新构建前端。依次执行 `page`、`page-contract`、`grading`、`page-review`、`practice`、`save-recovery`、`whiteboard`、`basic-types`、`completion`。各脚本沿用合成夹具与独立临时端口，不共用题库状态。

**失败处理。** 每项只跑一次；有一个失败也会让 job 失败，并保留后续检查结果。失败时上传安装、构建、各探针日志及截图（仍有打开的页面时在关闭浏览器前截取；启动失败等没有页面的情况保留日志），保留 7 天。

**未改动。** 无用户侧变化；不改生产代码、接口、持久化、探针原有断言或超时。不改变其他四个 CI job，不修改 npm 项目的依赖。任务 C 不在本 PR 范围。

**验证。** 等待首次 Ubuntu CI 及本地检查。浏览器视口覆盖以各探针原有场景为准，不等同于手机真机验收。
