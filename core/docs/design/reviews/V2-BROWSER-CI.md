# 任务 B · 浏览器检查接入 CI

**改动。** 新增 Ubuntu 的 `V2 browser checks` job，覆盖目标为 `v2` 的 PR 和 `v2` 的推送。Playwright 固定为 1.65.0，使用配套 Chromium（本轮 158.0.8127.18）；安装在运行器临时目录，不加入项目依赖，运行前重新构建前端。依次运行 `page`、`page-contract`、`grading`、`page-review`、`practice`、`save-recovery`、`whiteboard`、`basic-types`、`completion`，各自使用合成数据与临时回环服务。

**失败处理。** 每次 job 各探针只跑一次；任一失败使 job 失败，仍收集后续结果。失败上传安装、构建、探针日志与关闭浏览器前的截图，保留 7 天；没有已打开页面时只能提供日志。本机通过测试专用加载钩子主动抛错，确认退出码 1、保留原始错误，并生成 13,672 字节失败截图；未提交注入脚本。

**首次失败与修正。** [首次 Ubuntu 运行](https://github.com/lear111/quizforge_web/actions/runs/43568829583) 的 `whiteboard` 在提交评分后再次画笔迹时等待保存超时。两次诊断确认：绘图区非 inert、宿主非 busy，DOM 命中为白板输入层，但失败的一笔只有 pointerup、没有到达宿主文档的 pointerdown，因而没有新笔迹和保存请求。原探针模式切换后直接使用鼠标坐标，不等待输入层可接收事件。改为先用 locator.hover 的正常可见性、稳定性及命中检查定位同一点，再执行原来的按下、移动、松开；随后 Ubuntu 九项全部通过。没有重跑失败探针的机制、固定 sleep、放宽断言或延长超时；临时诊断日志已撤除。现有失败运行和截图保留，不把它们算作通过。

**未改动。** 无用户侧变化；生产代码、接口、持久化、探针原有断言与超时、其他四个 job 均不变，npm 依赖与锁文件不变。任务 A 的 #126 已合并；任务 C 未开始。

**实测。** 代码提交 `2f5301c` 的 [CI 43571101589](https://github.com/lear111/quizforge_web/actions/runs/43571101589) 五项全绿，失败用例名单为空：

| Job | 结果 | 总耗时 |
|---|---|---|
| Checks · Windows | 1376 通过 / 0 失败 / 0 跳过；类型与构建检查通过 | 4m30s |
| Checks · Ubuntu | 1342 通过 / 0 失败 / 34 既有平台跳过；类型与构建检查通过 | 1m21s |
| Performance · Ubuntu | 2 通过 / 0 失败 | 17s |
| V2 code quality · Ubuntu | 格式 0 差异；lint 0 错误 / 47 既有警告 | 28s |
| V2 browser checks · Ubuntu | 九项探针全部通过 | 2m46s |

本机 Windows / Node 24.13.0 的九项 Chrome 探针通过，修改后的白板探针另在配套 Chromium 通过；不接触真实题库或日常服务。浏览器视口沿用各探针已有场景，不等同于手机真机验收。本 PR 保持未合并，等待审查。
