# D48 · 第 5 步：后端目录迁移

**范围。** `core/server/host/v2/` 移到 `core/server/v2/`。`app.js` 组装 Express：题库、题目、拓展与系统路由分文件，注册顺序不变；中间件统一处理请求和错误；控制器把磁盘资源的查找与读取交给 service / repository。原有 `host/platform/` 通用工具留在原处。同步入口、测试、探针与 lint 范围；CI 本身通过这些命令取文件，无写死的旧路径。

**分层检查。** `npm --prefix core run lint` 拒绝反向与跳层的本地模块引用（静态导入、再导出与字面量动态导入）。路由只依赖同层和控制器；其余业务层可访问同层、下一层和通用 `utils`。`platform` / `core/shared/v2` 仅供中间件、服务、仓库和工具使用；`app.js` 负责组装。新增用例覆盖允许方向、反向、跳层、绕过中间件组装与引用旧后端。

**无行为变化。** 未改路由、鉴权、请求体、状态码、响应格式、评分、锁定、草稿或笔迹存储；未改前端或示例题库。`state.js` 整体迁入 `practice.service.js`，下一小 PR 才拆出 `state.repository.js`、拆开 `bank.service.js` 的长流程并按 D46 精简题库读取，本次保留全部检查。旧数据、依赖和安装包不变。

**格式化后行数（含空行）。** `app.js` 140；routes（system / bank / question / extension / paths）8 / 15 / 14 / 8 / 4；`http.middleware.js` 167、`http.controller.js` 144；services（bank / practice / resource）518 / 586 / 27；repositories（bank / extension / ink / resource / shared-sdks）201 / 224 / 209 / 27 / 54；utils（errors / http-response / io / limits / receipts / timing）18 / 126 / 151 / 2 / 49 / 70。过长的原有函数暂未拆分。

**验证。** Windows、Node 24.13.0。以 `c617e31` 的独立检出为基线，同一套合成数据比较 74 个回环请求：状态码、响应头与正文归一后 0 差异（仅剔除请求固有的动态值；摘要 `87751079acacc007e570ecd923ac082f513da6322599746257a51d2b1c29c53b`）。本地 V2 测试 116 通过、0 失败，性能测试 2 通过、0 失败；类型检查、构建一致性、格式检查通过，lint 0 错误、47 条既有大小警告。本次未做性能收益比较。

**浏览器。** Windows Chrome 跑通 9 个现有探针：`grading`、`page`、`page-contract`、`page-review`、`practice`、`save-recovery`、`whiteboard`、`basic-types`、`completion`。仅更新探针的模块路径，未改验收断言；没有启动日常服务或使用真实题库。

**CI。** Windows / Ubuntu Checks、Ubuntu Performance、Ubuntu V2 code quality 待运行；结果与失败名单完成后回填。不自行合并。
