# F①：题目页装载、消息与生命周期拆分

**状态：[#151](https://github.com/lear111/quizforge_web/pull/151) 实现待审查，不自行合并。** #150 已按评论去掉当前题库题数、五项 CI 全绿后合并；本 PR 基于 `5c4eacc`，目标 `v2`。F 按小 PR 逐项审查：本项题目页 → 评分环境 → 保存时机与 saving 请求/答复联合 → 文件缓存、完成评分 → store 动作/转发表/catalog 注入/空参数/completedAt 地址同步 → 后端断言收口及 health.phase 删除；后续各项尚未实施，不开始 G/J。实现为 `55a68b2`，测试与诊断适配为 `1e80bec`。

**改了什么 / 文件清单。** `services/page.ts` 保留公开入口与原类型出口，从 334 行降至 29 行；内部模块放在 `services/page/`。`channel.ts` 120 行：每实例状态、请求表、资源转移、串行更新和销毁；`messages.ts` 134 行：来源/通道/代际检查后分别处理生命周期、作答状态、尺寸、动作及答复；`document.ts` 116 行：原子脚本分为前置/QF 能力、宿主消息、作者页面加载三段，原文拼接，CSP/HTML 装配不变；`types.ts` 70 行：原页面类型与私有状态，外来消息字段仍为 unknown。各函数最长 40 行（AST 起止行，含内部脚本文本）；原挂载函数为 292 行。私有状态归当前 iframe 实例，无新增全局作答状态。`v2-bank-return-probe-bundle.mjs` 只跟随文件位置调整计时插入点，仍逐个断言唯一锚点，诊断构建通过。

**保持的语义。** 初始 load 使用原初始 context，同题更新替换当前 context；来源、channel、version、动作许可和互斥仍按原顺序检查。answer 等待最新更新；context 更新递增版本、拒绝旧请求；资源仍按 assetId 去重并转移原 ArrayBuffer；action-result 保留动作开始时的版本；销毁先发 dispose，再移除监听、拒绝未完成请求并移除 iframe。返回的 can 仍为副本，公开方法与错误文案不变。脚本构建仍先于宿主注册监听，nonce 转义仍在注册之后，不新增异常路径或恢复策略。

**明确没改什么。** 不改后端、共享 API、状态码/响应 JSON、规则输入、版本号、回执、持久化格式、数字字面量、写盘/冻结、保存时机/锁定/评分、solution 发送、题型代码或 iframe 权限。不做跨题 iframe 复用，不改子脚本逻辑/格式，不加校验、重试、超时、依赖或生产诊断开关；不部署、打包、操作真实题库或重启日常服务。宿主 bundle 会因模块拆分改变，不声称整包逐字节相同；生成成品不提交。此前 80 处后端断言在本项中未动，F 的最终目标仍为少于 30；saving 三处及 health.phase 留后续 PR。此项没有新增类型断言或 any，原两个 Promise resolver 的确定赋值和一处 contentWindow 非空断言保留，原 action 类型断言改为既有成员判断的类型守卫。

**逐字节证据与新增用例。** 从未改动的 `5c4eacc` 以 esbuild 构建页面入口，在 JSDOM 中固定 `crypto.getRandomValues` 为第 i 项等于 i，使用纯合成 HTML/CSS/SDK 与带 `</script>` 的题目生成 `fixtures/page-srcdoc.txt`（7,466 字节，SHA-256 `1262eaf5da191e6e5453c7f7434dc35ffde8fb6ff67ed5953f4c2d17228094f8`）；输入在 `fixtures/page-srcdoc.mjs`，无真实内容/凭据。`page.test.mjs` 新增三项：当前 srcdoc 与基线 Buffer.equals；初始错误拒绝就绪/读取且重复销毁无副作用；更新失败拒绝后续排队并保证权限副本不修改内部状态。原 6 项断言全部保留；新的三项加入后 9/0。未更新任何既有持久化标准答案。

**本机检查。** Windows 11、Node 24.13.0；V2 完整回归 184 通过 / 0 失败 / 0 跳过（97.12 s，与浏览器检查并行，不作速度对比）；UI/后端类型检查、格式通过。lint 167 文件 0 错误，既有大小警告从 36 减为 33，无规则放宽。十个既有 Chrome 探针全部通过（包含沙箱网络限制、nonce/Blob 脚本、图片转移、同题更新、评分与白板、失败保存与汇总路由）；性能回归 2/0（7.11 s）；只用合成基础题型与独立回环服务，浏览器桌面/手机尺寸不代表真实设备验收。此项不做性能优化，不声称速度收益。

**CI。** 实施提交 `13097ea` 的[运行 43676766199](https://github.com/lear111/quizforge_web/actions/runs/43676766199) 五项全绿，失败用例名单为空；Ubuntu 的 34 项跳过为既有 Windows 专项，未新增跳过。以下记录后只补文档，推送后再核对最终提交。

| CI job | 通过 / 失败 / 跳过与结果 | Job 总耗时 |
|---|---|---|
| Checks · Windows | 1445 / 0 / 0；UI/后端类型、源码构建和一致性通过 | 289 s |
| Checks · Ubuntu | 1411 / 0 / 34；同上 | 74 s |
| Performance · Ubuntu | 2 / 0 / 0 | 20 s |
| V2 code quality · Ubuntu | 格式 176 文件无差异；lint 167 文件，0 错误/33 既有警告 | 18 s |
| V2 browser checks · Ubuntu | 十个既有探针全部通过 | 169 s |
