# F②：评分环境拆分

**状态：实现待审查，目标 `v2`；不自行合并，不开始 F③。** 基于已合并 #151 的 `43cfb7e`，只落实进度页 F 的评分环境拆分。

**改动 / 文件。** `services/grading.ts` 保留原公开工厂、方法、类型出口及 `ungradable`，298 → 21 行；私有实现放在 `services/grading/`：`types.ts`（43 行）声明每服务、题型槽与环境类型；`document.ts`（51 行）原文装配 Worker / srcdoc；`environment.ts`（100 行）管理每 iframe 的握手、来源/channel/job 校验、单次请求与销毁；`pool.ts`（34 行）按题型串行排队、跨题型并行及整体关闭；`task.ts`（90 行）管理每批源码加载、期限、取消、回收与完成；`results.ts`（53 行）保留原结果规整。函数最长 43 行（AST 起止行，含脚本文本）；lint 警告 33 → 28，无新增警告或规则放宽。状态仍归各服务/iframe 实例所有。内部 Worker 结果类型由误标的 `GradingOutput[]` 改为 `unknown`，仍由原 normalizer 处理，无新增断言或 any。

**保持的语义 / 明确没改什么。** 未改后端、API/状态码/响应 JSON、题型、评分结果格式、版本号、回执、持久化、规则输入、锁定、solution 发送、保存时机或异常文案。保留无同源权限的 `allow-scripts` iframe、nonce CSP、`connect-src 'none'`、Blob Worker、来源/channel/job 检查和 error → ready → result 优先级；nonce 转义仍先于创建 iframe，脚本仍先于监听/挂载构建。每题异常隔离与 structuredClone 原文不动。期限仍涵盖源码加载和握手，默认 10 秒；空闲回收默认 60 秒；完成仍先标 done、清期限、取消加载，再按需销毁/安排回收、返回结果。没有新增恢复策略、校验、依赖、缓存限制或生产诊断开关。分数范围/小题合计仍由后端检查。本项不优化性能，不声称速度收益；未部署、打包、操作真实题库或重启日常服务，生成成品不提交。

**一致性与新增回归。** 从未改动 `43cfb7e` 构建入口，在 JSDOM 中固定 `crypto.getRandomValues` 第 i 项为 i，经公开 `grade` 生成 `fixtures/grading-srcdoc.txt`：1,794 字节，SHA-256 `588b1a369d939b8e607bc08ba70dacc9afcf45e4548279ddabd080ab53314c15`。输入 `grading-srcdoc.mjs` 仅有合成源码、结束 script 标记及需转义 nonce；无真实内容。`grading.test.mjs` 原 8 项不变，新增 5 项：完整 srcdoc（含 Worker/引导脚本）Buffer.equals；消息优先级；postMessage 抛错后的排队恢复；源码加载超时后的迟到结果隔离；错误文本/待评 parts/非有限数与服务端范围校验职责。整组在基线及拆分后均 13 通过 / 0 失败。没有更新任何既有标准答案。宿主 bundle 因模块拆分变化，不声称宿主整包逐字节相同。

**本机验证。** Windows 11、Node 24.13.0。UI/后端类型、格式、lint、源码构建与 `--check` 通过。完整测试、十个既有 Chrome 探针及性能回归结果待填。仅使用合成数据、独立回环服务；JSDOM 不代表真实 Worker 验收，桌面/手机浏览器视口不代表真实设备。

**CI / 风险。** 待首次运行。主要回归风险是异步回收与迟到消息，已用原测试及新增回归覆盖；真实浏览器沿用既有沙箱/超时/并发探针。F 的保存、源码缓存、完成评分、store 与后端断言收口均留后续独立 PR。
