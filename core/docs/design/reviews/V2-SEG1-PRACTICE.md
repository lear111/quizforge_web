# 第 1 段：单选题完整流程（#64 修订，等待复审，不合并）

目标 `v2`；评分组件 #63 已按授权合并（3915092），并同步已合并 #65 的 D19/D20。main 和真实数据不动，第 2 段未开始。

- **原有改动**：复用 Vue LibraryList/OutlinePanel 和视觉；每题独立 opaque iframe，POST submit 原子保存锁定后才发 solution，PUT result 检查锁凭证、版本、分数、完整小题及精确合计。COW、冻结、幂等、失败不替换缓存；只按题目记录/大纲变更清活跃状态。H5P 职责对照结论保留：页面收集/恢复，独立 Worker 评分，不引入框架/xAPI。
- **评论 1：外发复现与修复**：未改动 page.ts 的真实 Chrome 探针收到 **1 次**外部脚本请求，包含合成 question/answer/solution。修复后 SDK/作者代码改用 blob 脚本；运行时先删除自身 script 和含 nonce 的 meta，并在私有闭包内执行。考虑 CSP 违规事件仍可能暴露原策略中的 nonce，执行作者代码前再加不可放宽的 `script-src blob:` 策略，与既有策略取交集。宿主只增加 blob:，script-src 无 unsafe-inline/unsafe-eval；评分 Worker 隔离策略不变。18 种方式 × 锁前/锁后共 **36 场景收到 0 请求**，包括 DOM nonce、违规事件恢复 nonce、fetch/XHR/beacon、图片/CSS/媒体、frame/object/form、导航/弹窗、动态 import/Worker/WebSocket/EventSource；无 Playwright abort 拦截探针流量。不能据有限探针宣称覆盖所有未来浏览器/协议，保证依赖 CSP 和浏览器 sandbox。
- **评论 2 与 #63 补充：评分隔离**：宿主按输入题号、顺序、数量投影 Worker 结果，非数组、缺项、非对象或重复题号转 ungradable，多余题号丢弃。仅 INVALID_RESULT 改报 ungradable，网络/版本/写盘错误保留锁定待评分；重开对每题（含首题）分别捕获错误、继续其余题。真实 App+Worker+HTTP 四题测试结果依次为：写失败仍待评 / 越界分数无法评分 / 伪造非数组无法评分 / 健康题 2 分，全部答案保持锁定。
- **评论 3（D19）**：作答改为 `<题库文件夹>/.qf-v2/state.json`，文件不写/校验 bankId；接口仍用运行时 bankId。缓存按实际文件定位，改名/移动重开恢复，复制带进度后各自写入。读题、内容指纹、遍历计数排除 `.qf-v2/`；任何大小写/层级的该保留路径不能用于题目素材或本地听力。测试在其中放 1005 文件不影响快照与限额，记录不能由素材接口取出。无自动搬移旧实验全局状态；D20 仅同步接口速查，历史实现留第 3 段。
- **文件**：原 `server/host/v2/{state,server,snapshots}.js`、前端入口与产物、示例及启动脚本；本轮增量为 state/server/io、App/page/grading 与新增 scoring.ts、四组原 V2 测试和新增 scoring.test.mjs、保留探针、进度/贡献/接口说明。
- **没改什么**：未实现草稿/白板/重做/历史/考试/AI/编辑/导入导出；未改 V1 规则、依赖、标准答案、鉴权、遍历上限或 32 MiB。只按 D19 更新本 PR 的 V2 持久化标准向量（去 bankId）；其他保护/格式规则不扩展。原基础题型演示、回执上限、资源展示、坏文件策略、题型缓存/更新和标题遗留已登记进度页，不在本次夹带实现。
- **新增用例（5）**：Worker 伪造结果形状；无效分数与连接/版本错误分类；首题/后续错误不阻塞其余题；D19 改名/移动/复制；D19 私有目录不计指纹/限额且禁止资源/听力读取。既有锁前保密、重放、冲突、冻结、写失败、嵌套/数字字面量、页面迟到消息断言保留，另补宿主脚本 CSP 和 nonce 私有化检查；未加跳过、重试或放宽超时。

| 检查 | 结果 / 失败名单 |
|---|---|
| 本地 V2 | 33 通过 / 0 失败 / 0 跳过；类型和构建检查通过 |
| 本地完整测试 | 1278 通过、16 失败、0 跳过，1118.6 秒；本次 V2 全通过，失败定位见下方，未据此宣称本机全绿 |
| 本轮 CI：b20aadc / 43212012902 | Windows 1294 通过、0 失败/跳过，3分51秒；Ubuntu 1260 通过、0 失败、34 既有平台跳过，1分15秒；性能 4 通过、0 失败/跳过，26秒。失败用例：无 |

本地失败定位（均在未改动的 V1 路径，未另跑基线，不断言全部是既有缺陷）：`server/host/ai/hub-connection.test.mjs:68,88,96,114,133,160` 与 `settings-provider.test.mjs:32,54` 为访问保护失败；`server/host/http/server.test.mjs:290` 返回 503；`server/host/extensions/rule-engine.test.mjs:99` 前台排队断言；`server/host/library/library-archive.test.mjs:30` rename EPERM；`test/desktop/hub-import.test.mjs:192,217`、`test/desktop/windows-tray.test.mjs:117,191` 为导入失败/启动 EPERM；`test/extensions/bank-builder-validator.test.mjs:139` 为 RULE_TIMEOUT。同一提交的两系统 CI 均通过；本次不修改这些用例、权限或时限。

真实 Chrome 157.0.8103.39 / Windows 11 10.0.26200 / Node 24.13.0，独立合成数据/回环端口：桌面、390×844 手机尺寸（非真机）各 10 次正确/错误提交、失败保留输入、刷新重开恢复、首题损坏可导航与补评隔离；pageerror 0。

| 可感知操作 | 桌面 | 手机尺寸 |
|---|---:|---:|
| 首次打开（各一次） | 439 ms | 382 ms |
| 提交见分数（n=10，中位数 / P95） | 289 / 475 ms | 366 / 530 ms |

复现：`node core/scripts/dev/probe-v2-practice.mjs <临时 Playwright index.mjs> chrome`；`--network-only` 仅跑外发探针。修改前的单通道基线是在原 page.ts 上运行 `--network-only --network-baseline`，改后该参数不用于旧行为模拟。截图/报告只在忽略的 `.temp/v2-practice/`。服务/浏览器/合成数据已清理，未碰日常端口。

试用：安装 Node 24 和依赖 → 根目录“启动 V2 单选题演示.cmd” → `http://127.0.0.1:8794/` → 展开/作答/提交 → 重开确认恢复锁定。Ctrl+C 停止；进度位于演示题库内部 `.qf-v2/`。#64 保持开放等待复审，不合并、不打包，负责人正式试用后才标记完成。
