# H：代码长度规则强制化

**状态：实现完成，待代码审查；不自行合并。** 基线 `v2` / `90b8d57`，分支 `chore/v2-enforce-length`。仅执行 H，不启动 J/K/L 或 AI Agent。PR 正文与本记录同步。

## 规则与基线

在未修改的最新 `v2` 上执行 `npm --prefix core run lint`：218 文件，**0 错误 / 20 警告**，退出 0。下表行号与行数均为该次 ESLint 输出（按既有跳过空行/注释的口径）；F = `max-lines-per-function`，L = `max-lines`。全部默认 F 仍为 50、L 仍为 300，Vue L 仍为 150，仅级别改为 error；保留 `skipBlankLines` / `skipComments` 和 `core/test/v2/**` 的原有两条明确豁免，未扩大测试规则范围。

| 基线文件:行号 | 规则 | 实际 / 限制 | 本次处理 |
|---|---|---|---|
| core/frontend/src/v2/services/whiteboard.ts:7 | F | 75 / 50 | 分离画布布局与公开控制方法 |
| core/frontend/src/v2/stores/practice/page.ts:86 | F | 80 / 50 | 提取页面变更回调与动作回调工厂 |
| core/frontend/src/v2/stores/practice/recovery.ts:6 | F | 95 / 50 | 分开取最新题、刷新绑定恢复、应用恢复结果 |
| core/scripts/dev/compare-v2-http.mjs:314 | L | 304 / 300 | 纯响应规范化移至 v2-http-normalize.mjs |
| core/scripts/dev/measure-v2-bank-return.mjs:96 | F | 91 / 50 | 浏览器计时起止与读取移至 probe-v2-bank-return-marks.mjs |
| 同上:305 | L | 305 / 300 | 同上 |
| core/scripts/dev/measure-v2-overview.mjs:32 | F | 60 / 50 | 分离 manifest 读取观测安装与恢复 |
| core/scripts/dev/probe-v2-grading.mjs:70 | F | 137 / 50 | 保留序列化闭包，申请精确文件例外，见下 |
| core/scripts/dev/probe-v2-page-contract.mjs:303 | L | 319 / 300 | 合成题库与拓展写入移至 probe-v2-page-contract-fixture.mjs |
| core/scripts/dev/probe-v2-page-review.mjs:51 | F | 76 / 50 | 保留注入计时闭包，申请精确文件例外，见下 |
| core/scripts/dev/probe-v2-page.mjs:309 | L | 337 / 300 | Buffer 传输独立场景移至 probe-v2-picture-transfer.mjs |
| core/scripts/dev/probe-v2-practice-flow.mjs:6 | F | 152 / 50 | 分离提交失败、十题提交、评分中断、恢复检查与响应观测 |
| core/scripts/dev/probe-v2-practice-network.mjs:9 | F | 102 / 50 | 分离攻击输入表、测试主机、浏览器逐案执行与资源生命周期 |
| core/scripts/dev/probe-v2-practice-recovery.mjs:4 | F | 74 / 50 | 分离合成待评分题库准备与浏览器恢复验收 |
| core/scripts/dev/stage-v2-basic-demo.mjs:6 | F | 62 / 50 | 富文本素材适配独立递归函数，素材集合显式传递 |
| core/scripts/dev/v2-bank-return-probe-bundle.mjs:13 | F | 84 / 50 | 分离探针注入转换与 Vite 构建 |
| 同上:23 | F | 63 / 50 | 按题库/题目/创建/文档四个注入边界拆分 |
| examples/v2/extensions/基础题型/判断题/practice.js:2 | F | 57 / 50 | 提取本文件的提交/重做按钮绑定 |
| examples/v2/extensions/基础题型/单选题/practice.js:2 | F | 60 / 50 | 同上 |
| examples/v2/extensions/基础题型/多选题/practice.js:2 | F | 61 / 50 | 同上 |

## 两处待审查的浏览器例外

只对下列**两个完整文件路径**配置 F，仍为 error，L 仍为 300；没有新增任何 disable/全局忽略或改动测试豁免。上限等于现有有效行数，没有预留扩张空间：

| 文件（core/scripts/dev/） | 原上限 → 新上限 | 原因 |
|---|---|---|
| probe-v2-grading.mjs | 50 → 137 | page.evaluate 的完整评分验收闭包被序列化到真实页面；局部 service、loads、输入构造与检查跨多个连续评分步骤共享。拆成 Node 辅助函数不能直接在浏览器执行，改为多次 evaluate 或另加注入打包会改变探针执行边界。该文件内容未修改。 |
| probe-v2-page-review.mjs | 50 → 76 | addInitScript 的计时闭包在页面/iframe 的不同域内执行，row 与原始 timer/fetch 必须在同一次注入中共享；引入全局状态或二次注入会改变观测方法。该文件内容未修改。 |

其他 18 条警告均通过职责拆分消除，未提高其他上限。新增质量用例核对两处例外、普通探针仍为 50、文件仍为 300。若审查不接受这两处例外，需另评估保持浏览器执行边界的拆分方式；本 PR 不自行视为批准。

## 行为一致性与新增验证

三个宿主模块的原有导出、签名与调用顺序保持：图片/源码并行获取成功后才销毁旧页面；页面回调仍检查题目代际与提交/重做权限；冲突恢复仍按获取原题、重新读取概览、检查移除/暂不可用、应用上下文或重建的顺序处理；白板初始化、加载期间抑制回调、模式与销毁顺序不变。没有修改 API、Pinia 保存计时/队列、评分、URL、iframe 协议、白板数据、状态格式或 G 的构建/发现器/CI 流程。

对改动的 10 个原脚本及 4 个新辅助脚本做 TypeScript AST 比较：**95 条 assert 调用多重集完全一致**，摘要 `a420bb4ba16ea52e89a0763af197a8dd20fa8f29a7d0f5b65b4ccbc27c4463aa`；只忽略排版和尾逗号，保留表达式与字面量。原断言、请求/报告字段、等待条件、超时、跳过与重试均保留。源码规范化、采样和注入提取不修改服务端。

`code-quality.test.mjs` 原“长度警告”用例改为严格断言 error；新增两项：文件上限/跳过空行注释不变，以及浏览器例外不外溢。实际在 quality scope 内临时加入 53 行函数并执行 npm lint：**退出 1，max-lines-per-function error（53 > 50）**；finally 撤销该临时文件后重新 lint 退出 0。没有提交这个违规文件。

## 实际验证

Windows 11 / Node 24.13.0，合成数据、独立临时目录与回环端口；日常服务和真实题库未访问。浏览器使用外置 Playwright 与 Chrome，桌面/手机视口不等于真实移动设备验收。

| 检查 | 结果 |
|---|---|
| ESLint | 222 文件，0 错误 / 0 警告（基线 20 警告） |
| Prettier | 232 文件，0 差异 |
| 前端/后端 TypeScript | 均通过 |
| UI 构建与 --check | 均通过；成品继续忽略、不提交 |
| 完整 V2 | 最终 241 通过 / 0 失败 / 0 跳过，93.20s；基线 239 项保留，新增长度配置回归 2 项 |
| 十项浏览器探针 | 原十入口全部通过：page / page-contract / grading / page-review / practice / save-recovery / whiteboard / basic-types / completion / router；无固定 sleep、超时或断言调整 |
| 性能组 | 2 通过 / 0 失败 / 0 跳过；16.97s；与其他回归并行，数值不作性能优化或负载结论 |
| 本机完整默认回归 | 运行中，待补；保留可能的既有环境失败 |
| Windows / Ubuntu / 质量 / 浏览器 / 性能 CI | 推送后补全五项结果、耗时与失败名单 |

## 风险与范围

主要风险是提取闭包时丢失局部状态/改变异步错误边界，以现有冲突恢复、快速切题、白板、评分、完成练习与路由测试覆盖。三份示例题型源码字节变化会改变 artifact 指纹，仍按既有刷新规则处理示例的活跃记录；没有新增清理行为，也没有操作用户记录。两处浏览器长度例外仍等待本 PR 审查。没有新依赖、新抽象框架、缓存或保护机制；不生成安装包，不自行合并，不开始后续任务。
