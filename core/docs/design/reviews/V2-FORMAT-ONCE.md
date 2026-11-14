# V2 一次性格式整理（待审查）

## 范围与不变项

#115 已按批准合入 `v2`（`f2a5771`）；紧接着从该提交建立 `chore/v2-format-once`，无其他功能插入。**本 PR 无行为变化**。Express、概览优化、Pinia、可读性重构、D45、归档与历史均未开始。

- 75 个范围内文件运行 Prettier；74 个 JS / TS / Vue 文件运行 ESLint 机械修复。包括 V2 后端、前端、共享模块、测试、示例与开发脚本；重建 `core/web/ui/quizforge-{ui.js,web-local.css}`。没有改 V1 模块、题库 JSON、manifest、标准答案、依赖或 CI 步骤。
- 三处审查调整：纳入 `core/frontend/src/v2/**/*.css`；`max-len` 放过 URL / 字符串 / 模板字符串 / 正则；函数 50 行、文件 300 行、Vue 150 行只警告，跳过空行/注释，测试排除。`lint` 保留警告输出，仅错误阻断。新增 1 项配置用例，原用例及浏览器断言不变。
- 机械修正：补大括号、拆语句、移除冗余转义；只删 `measure-v2-completion` 的未用 fs 导入、`probe-v2-save-recovery` 的未用 repo、`submit.test` 的未用解构绑定（bankId / directory / server）；确认均非模板/动态引用，初始化的 setup 与 core 绑定保留。
- 五处逐行注明例外：3 个 `no-control-regex` 保留既有控制字符拒绝；2 个 `preserve-caught-error` 保留既有异常形状与诊断文案，不新增 cause。未关闭全局规则，未改变正则、消息、响应、状态码、存储、评分、锁定、时序或沙箱。

## 验证与证据

Windows / Node 24.13.0 / Chromium 157.0.8103.39；合成目录与独立回环服务，不访问真实数据、不重启日常服务。

- `format:check`：75 文件、0 差异；`lint`：74 文件、0 错误、49 警告。全部文件/函数及行数见 [完整清单](../archive/V2-FORMAT-WARNINGS.md)，本次只记录。
- 类型检查、重建与产物一致检查通过；产物 JS 251.13 kB（gzip 87.08 kB），CSS 14.79 kB（gzip 3.76 kB）。这是构建体积，不是速度收益。
- 本地 V2 最终整组 111/111 通过；首次 110 通过 / 1 失败（`submit.test.mjs` 的 D19 private records，`fetch failed` / `ECONNRESET`），原文件单独复测 10/10 通过，未改断言或超时。独立性能测试 2/2 通过；完整默认测试由下表两个系统的 CI 验证。
- 原八脚本 `page / page-contract / grading / page-review / practice / save-recovery / whiteboard / basic-types` 及新增覆盖的 `completion` 全部 exit 0；Chrome 桌面/手机视口，不是真机或 AI 质量验收。诊断用 phase bundle 重建成功。
- 以 `f2a5771` 比较 69 个非配置/工具测试文件：JS/TS 语法树一致（排除上述未用绑定，等价的数字/字符串属性键统一）；Vue 脚本一致，模板编译结果只需归一化格式折行带来的文本首尾空白；CSS 用同一 Prettier 配置归一化后相同。不是声称编译字节或 DOM 文本空白完全不变。

| CI job | 实际结果 / 耗时 | 失败用例 |
|---|---|---|
| Checks / Ubuntu | 待运行 | 待确认 |
| Checks / Windows | 待运行 | 待确认 |
| Performance / Ubuntu | 待运行 | 待确认 |
| V2 code quality / Ubuntu | 待运行 | 待确认 |

## 存疑与交付边界

示例拓展源码字节因格式改变而变化，既有 D27 指纹规则仍生效，打开已记录的开发演示可能按内容变化清空本轮；没有增加迁移/兼容，也没有触碰现有作答文件。没有测量或声称应用提速。四项 CI 通过后仍停在本 PR 等审查，不自行合并或继续下一步。
