# F④：拓展文件缓存拆分

**状态：[#158](https://github.com/lear111/quizforge_web/pull/158) 实现待审查，目标 `v2`；不自行合并，不开始 F⑤ 或 I②。** 从最新 `v2` 的 `4da359b` 建立 `refactor/v2-source-cache`。F①–③ 已合并（#151、#152、#154）；依据 D7/D27 的快照边界、D43 的 SDK 版本约定、架构第 3/4.1.2/4.2 节、接口速查的拓展/SDK 只读 GET、题型说明第 2 节 manifest.sdkVersions，以及进度页 F 顺序。持久化数据结构不涉及；未来 SDK/历史等功能不在本项中实施。

**文件结构与职责。** 原 `services/source-cache.ts` 88 行、工厂函数 86 行：拆为同名入口 52 行（每实例状态、scope/取消/清空、页面 Promise 去重及失败移除）、`source-cache/sources.ts` 52 行（manifest → SDK → 并行页面文件与 SDK → 组装；独立的 sdkSources 函数管理 SDK Promise 复用）、`source-cache/types.ts` 24 行（原加载器与返回结构、私有状态和加载时捕获的 scope）。工厂降至 25 行，全部函数最长 30 行（AST 起止行）。原两张 Map 仍由同一实例拥有，未再引入通用缓存框架或新缓存层。无新增 as/any；原 Map.get 的一处非空断言随 SDK 逻辑移动，未增加断言。

**行为一致性依据。** 对外仍只有 `scope`、`load`、`dispose`，返回字段和顺序仍为 name/html/js/css/sdks；load 保持普通函数，命中返回同一个 Promise 和同一结果对象。范围键仍是 `JSON.stringify([bankId, snapshotId, authorization])`，页面键仍为 artifactId，SDK 键仍为 id@version；只处理原有 richtext。相同范围不清理；变化时仍依次 epoch++ → abort → 新控制器 → 清两张 Map → 更新 key/snapshot。缺失页第一次派发前捕获 epoch/signal/snapshotId；manifest 后和全部资源完成后各检查一次代际。SDK 先发起，随后按 HTML/JS/CSS 顺序发起，仍在同一个 Promise.all 内等待；没有增加 await。SDK CSS 仍放在题型 CSS 前，以换行连接。失败只在 Map 仍持有本次 Promise 时移除，保留原错误对象；页面失败不取消整个范围或清掉成功的 SDK。dispose 仍清 key、取消和清缓存，但不清 snapshot、不设置永久关闭标志，之后可直接重新 load；这个既有行为也有回归覆盖。

**明确没改什么。** 无缓存键/范围/失效条件/容量或过期策略变化；无预加载、持久化、新淘汰策略或请求重试。未改后端、HTTP、题型/SDK 协议、UI/I② 原型、保存、评分、白板、完成练习或数据格式；没有新增防护、依赖或生产诊断开关。调用方与既有测试原文保留，未更新标准答案、跳过或放宽断言。未部署、打包、操作真实题库或重启日常服务；生成成品不提交。不作性能优化，不声称速度收益。

**新增回归。** `source-cache-races.test.mjs` 6 项：① 同页并发 Promise 身份、多题型同版本 SDK 去重、不同版本隔离、无 SDK 与请求顺序；② 三种范围变化、相同范围复用与取消；③ 旧 SDK 迟到拒绝不删新 SDK/同页 Promise；④ 旧资源迟到成功仍拒绝且不替换新内容；⑤ manifest/SDK/文件失败后重试并保留错误对象，文件失败保留成功 SDK；⑥ dispose 取消、清理、key 重置及沿用旧 snapshot 重新加载。测试使用受控 Promise，故意让旧传输忽略取消，以检查代际与身份条件，不加 sleep、超时或重试。原 2 项测试不改，与新增 6 项组成的整组在未改动 `4da359b` 和拆分后均 8 通过 / 0 失败；基线用被忽略目录中的原源码副本，未加生产开关或项目依赖。

**本机检查。** Windows 11、Node 24.13.0。UI/后端类型、格式、lint、源码构建和 `--check` 通过；lint 190 文件 0 错误/22 既有警告（原 24）。完整 V2 201 通过 / 0 失败 / 0 跳过（102.32 s，与浏览器检查并行，不作速度对比）。十个既有 Chrome 探针全部通过。本次不重复本机旧版全仓测试；由 CI 两平台运行完整套件。只用合成数据、独立回环服务；桌面/手机视口不代表真实设备验收。

**风险与边界。** 主要回归面是旧请求回调误删新范围缓存、SDK/页面部分失败后的复用，以及 Promise 身份/执行顺序；已用基线对照和受控交错覆盖。原缓存的生命周期与 dispose 后复用语义全部保留，不借本项调整。进度页仅登记 F④ 待审查；I② 排期及其原型原文不动，其余 F 项留后续独立 PR。


**CI。** 实施提交 `cdec1ca` 的[运行 43700666214](https://github.com/lear111/quizforge_web/actions/runs/43700666214) 五项全绿，失败名单为空；Ubuntu 的 34 项跳过为既有 Windows 专项，未新增跳过、重试或断言放宽。下表记录后只补本文与进度页，推送后再次核对最终提交。

| CI job | 通过 / 失败 / 跳过与结果 | Job 总耗时 |
|---|---|---|
| Checks · Windows | 1462 / 0 / 0；UI/后端类型、构建及一致性通过 | 185 s |
| Checks · Ubuntu | 1428 / 0 / 34；同上 | 108 s |
| Performance · Ubuntu | 2 / 0 / 0 | 14 s |
| V2 code quality · Ubuntu | 格式 199 文件无差异；lint 190 文件，0 错误/22 既有警告 | 20 s |
| V2 browser checks · Ubuntu | 十个既有探针全部通过 | 173 s |
