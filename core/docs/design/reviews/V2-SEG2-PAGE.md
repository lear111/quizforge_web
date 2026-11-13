# 第 2 段②：页面保存、图片与加载（#73，等待复审）

① #69 已审查合并（9fabbf1）；本 PR 目标 `v2`，不自行合并。按 [审查意见](https://github.com/lear111/quizforge_web/pull/73#issuecomment-6843684409) 修订。

**改动与文件**：`save-policy.ts` 集中 0/1000/1500/10000 ms 保存时机，网络/5xx/STATE_WRITE_FAILED 保留原 ID、正文和 revision 重试；409/404 放弃冻结请求及本地未存输入，只重读，不再重发旧请求；重读失败仍可重试读取。`App.vue` 串行保存、离开前 flush、hidden/unload、动态题型标题、图片白名单 ArrayBuffer transfer、同题确认式 update。冲突时同一绑定用 update 载入最新内容并提示“本题已在别处修改，已载入最新内容”；快照变化重新取概览和绑定，题目消失则释放页面并说明已放弃输入，允许切题/切库。flush 后重新检查当前题/锁定状态和快照，避免继续使用冲突前对象。`source-cache.ts` 复用题型/SDK Promise，失败移除、失效取消；`page.ts` 同 iframe 更新、旧消息隔离、图片 BlobURL。`examples/v2/.../practice.js` 上报选择变更；`core/web/ui/quizforge-ui.js` 同步构建。

**未改**：后端、持久化/回执/solution 发送条件、五份 V1 标准答案、32 MiB、CSP/权限/网络边界、公共 SDK、总体设计、main、安装包、真实数据、日常服务。③白板/位置/重做与④基础库迁移均未开始。③笔迹必须共用同一串行写队列，在实际发送时取当时 revision（原请求失败重试仍保持原样），不另开保存通道。

**兼容与新增测试**：原 9 项页面/缓存/图片测试全部保留；`core/test/v2/save-policy.test.mjs` 新增 3 项：错误分类、冲突丢弃全部本地输入并解除退出等待、重读失败仅重试读。先失败 3 项再修复，现控制器 8/0、V2 总计 61/0；类型、构建一致、diff 检查通过。未跳过、删除或放宽断言。

**浏览器检查**：Windows 11 10.0.26200 / Node 24.13.0 / Chrome 157.0.8103.39，临时合成根、随机回环端口，结束关闭；非真机或整段验收。`node core/scripts/dev/probe-v2-page-review.mjs .temp/v2-browser/node_modules/playwright/index.mjs chrome`（忽略目录的 Playwright，不新增依赖）：A 保存→B 冲突后载入 A、同 iframe、能切题；A 提交→B 显示锁定；过期快照/移除当前题后能离开；补评先占写队列、旧 revision 笔记随后发送→明确丢弃→新笔记保存成功并能切题。原 `probe-v2-page.mjs` 桌面 1440×900/手机 390×844 检查保留，包括网络失败原正文重试、切题/切库拦截、图片、文字/笔记、同题更新；通过。原 practice 探针另测锁前/后网络边界，外部接收 0，桌面/手机尺寸练习流程通过，页面错误为空。

**193 ms 的说明与页面内重测**：旧单次数据包围 Playwright 的 check+等待，包含驱动/定位/轮询，不能事后准确拆分；撤回其作为页面保存耗时的口径。新脚本在 iframe 的原生 change、宿主消息/0ms 调度/fetch/JSON、DOM 保存确认及下一帧打点，统一 timeOrigin+now。预热 2 次，交替选择 30 次；下表阶段不重叠，中位数不可直接相加。探针额外开销未量化；仅合成小状态、前台桌面 Chrome。下表为全套测试启动前一轮；同机全套测试并行时复跑（n=30），总计 50.5/114.4 ms、PUT 38.1/97.0 ms、外层探针 252.9/445.0 ms（中位数/P95），两轮功能检查均通过，不能把驱动耗时当保存耗时。

| 阶段（n=30，ms） | 中位数 | P95 |
|---|---:|---:|
| 输入→宿主变更消息 | 1.3 | 2.1 |
| 0ms 调度 | 0.8 | 1.5 |
| 读取 answer/getDraft 消息往返 | 2.2 | 4.2 |
| 组装/队列→发出 PUT | 0.1 | 0.2 |
| PUT→响应头（服务端+回环，不另估算） | 30.8 | 37.2 |
| 响应 JSON 解析 | 0.7 | 1.6 |
| 宿主更新→保存 DOM 确认 | 1.2 | 1.6 |
| 下一帧 | 1.3 | 3.7 |
| 输入→下一帧（总计） | 39.9 | 48.2 |
| 外层 Playwright check+等待（独立口径） | 110.3 | 131.4 |

**本机完整测试**：`npm --prefix core test` 共 1322 项，1310 通过/12 失败/0 跳过取消，944.46 秒，exit 1；V2 全部通过。失败名单：`core/server/host/ai/hub-connection.test.mjs:68/88/96/114/133/160`、`settings-provider.test.mjs:32/54`、`core/server/host/http/server.test.mjs:290` 共 9 项为已记录设置访问保护 503；另有 `core/server/host/extensions/rule-engine.test.mjs:99` 前后台顺序、`core/server/host/library/library-package.test.mjs:215` rename EPERM、`core/test/desktop/hub-import.test.mjs:217` 导入条件 false。后 3 项按原超时、并发 1 隔离重跑 2/1（43.96 秒）：package、hub-import 通过，规则队列仍失败并有结束后异步拒绝；不宣称全部稳定或已解决。上一轮托盘/简答超时本轮未重现，失败总数相同但名单不同。未修旧代码、增重试或放宽断言。

**CI**：运行 **43368923873**，代码 **d9a4f5a**，三项全绿；失败用例名单均为空。本次收尾提交仅文档，记录与 PR 描述同步。

| job | 通过/失败/跳过 | 总耗时 |
|---|---|---|
| Windows Checks | 1322 / 0 / 0 | 3 分 50 秒 |
| Ubuntu Checks | 1288 / 0 / 34（原平台条件） | 1 分 26 秒 |
| Ubuntu Performance | 4 / 0 / 0 | 28 秒 |

**待办**：等待复审；②不合并、不开始③，无新增产品待决事项。
