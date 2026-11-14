# D48 · 第 5 步：后端目录迁移

**范围。** `core/server/host/v2/` 移到 `core/server/v2/`。`app.js` 组装 Express：题库、题目、拓展与系统路由分文件，注册顺序不变；中间件统一处理请求和错误；控制器把磁盘资源的查找与读取交给 service / repository。原有 `host/platform/` 通用工具留在原处。同步入口、测试、探针与 lint 范围；CI 本身通过这些命令取文件，无写死的旧路径。

**无行为变化。** 未改路由、鉴权、请求体、状态码、响应格式、评分、锁定、草稿或笔迹存储；未改前端或示例题库。`state.js` 整体迁入 `practice.service.js`，按进度页 A–J 顺序，C 步才加入分层依赖检查、拆出 `state.repository.js`、拆开 `bank.service.js` 的长流程并按 D46 精简题库读取，本次保留全部检查。旧数据、依赖和安装包不变。

**格式化后行数（含空行）。** `app.js` 140；routes（system / bank / question / extension / paths）8 / 15 / 14 / 8 / 4；`http.middleware.js` 167、`http.controller.js` 144；services（bank / practice / resource）518 / 586 / 27；repositories（bank / extension / ink / resource / shared-sdks）201 / 224 / 209 / 27 / 54；utils（errors / http-response / io / limits / receipts / timing）18 / 126 / 151 / 2 / 49 / 70。过长的原有函数暂未拆分。

**验证。** Windows、Node 24.13.0。以 `c617e31` 的独立检出为基线，同一套合成数据比较 74 个回环请求：状态码、响应头与正文归一后 0 差异（仅剔除请求固有的动态值；摘要 `87751079acacc007e570ecd923ac082f513da6322599746257a51d2b1c29c53b`）。性能测试 2 通过、0 失败；类型检查、构建一致性、格式检查通过，lint 0 错误、47 条既有大小警告。本次未做性能收益比较。

**浏览器。** Windows Chrome 跑通 9 个现有探针：`grading`、`page`、`page-contract`、`page-review`、`practice`、`save-recovery`、`whiteboard`、`basic-types`、`completion`。仅更新探针的模块路径，未改验收断言；没有启动日常服务或使用真实题库。

**CI。** [代码提交 `979297a` 的四个 job 全通过](https://github.com/lear111/quizforge_web/actions/runs/43567195088)，没有失败用例：Windows Checks 1376 通过，4 分 37 秒；Ubuntu Checks 1342 通过、34 项既有平台跳过，1 分 28 秒；Ubuntu Performance 2 通过，18 秒；Ubuntu V2 code quality 格式 0 差异、lint 0 错误，16 秒。等待审查，下一步 B（浏览器检查进 CI）未开始。
