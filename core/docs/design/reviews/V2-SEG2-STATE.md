# 第 2 段①：保存、缓存、回执与重做（实现，等待审查）

依据 #68 审定设计，只做第一份后端 PR，目标 `v2`；不自行合并。#68 文档已修订合并，后续页面通信、自动保存时钟/离开确认、白板与位置、基础题型迁移仍按②→④实施。

## 改了什么、没改什么

- `v2/state.js`：增加 draft/ink/retry，沿用原子替换、写时复制、冻结及 32 MiB。保留非答案 draft；答案变化递增答案版本，笔记/笔迹只增加 revision；锁后含 answer 的请求一律拒绝，草稿不改锁/结果。重做清全部活跃内容及旧回执，revision/answerVersion 单调增加，保留重做自身回执以幂等，historyIndex 不变。
- 全部写动作共用 4 条签名 FIFO，新增显式 receiptOrder。较早 V2 无顺序文件读取不改写，下一次写按现有键序截断（无法恢复旧数字键真实顺序）；淘汰后旧 revision/评分版本/锁继续拒绝请求。
- 打开/刷新检查完整文件身份；删改/换入后重读，坏文件失效缓存并报错，原文件保留。提交后不把可能属于外部替换文件的 post-stat 配给候选；下一次打开核对身份与字节，内容相同保留冻结对象。普通题目读取不新增扫描。
- `v2/server.js`、`snapshots.js`：接 PUT draft/ink、POST retry/refresh；写信封带 requestId/snapshotId/expectedRevision。refresh 可携 expectedSnapshotId/questionId，题目被删才回退，返回清除/新增/删除题号；清理写入失败不发布新快照。未实现历史中断，activeRoundInterrupted 固定 false。
- `platform/json.js` 新增 patchJson，保留字段所有者的数值元数据，复用已冻结子树并防 __proto__ 赋值；不改变 V1 调用。速查和进度同步更新。
- 未改总体设计、权限/锁前 solution 条件、评分校验、文件限额、包格式、规则执行、前端/沙箱、真实题库、日常服务、main 或安装包。此 PR 后端尚未接通页面，不代表整段可试用。

## 兼容与验证

- 新增用例：不透明 JSON/null/原始数值、笔记不算答案、锁后草稿、重做撤销旧评分、100 次保存与 4 条 FIFO/数字 ID、跨操作淘汰、早期 V2 读取、失败原图/原盘/回执不变与重试、多标签 revision/过期快照/Origin/重复键、外部删改/写后立即替换、坏文件拒写、refresh CAS/删题回退/清理失败。
- 原单题持久化标准向量仅增加审定的 receiptOrder 字段，Buffer.equals 保留；V1 五份标准答案文件未动。只读测试将已实现的 refresh 的旧 501 断言换为尚未实现的 finish，保留 draft 错误方法及未实现功能 501；refresh 有完整成功/失败覆盖。
- 计时：本次无浏览器速度验收，不能把后端测试时间当作用户操作耗时。32 字符宿主 ID 的 100 次合成保存：回执本体 409 B、顺序 141 B，状态文件第 10 次 872 B、第 100 次 873 B（仅 revision 多一位），仍只有 4 条回执。
- 检查：新增测试先复现失败再实现；完整 V2 49/0，类型检查、构建检查通过。没有跳过或放宽断言。仅使用临时合成数据与随机回环端口，均由测试关闭；不读取负责人数据。

## 检查结果与存疑事项

独立只读复核发现并修正了“写成功后外部删除/替换，post-stat 错配缓存”的竞态，新增用例先失败再通过；复核无剩余阻塞项。

CI 43272326911（实现 9efec74）三项全绿；三个 job 失败名单均为空，取消为 0，无新增跳过：

| job | 通过/失败/跳过 | job 总耗时 |
|---|---|---|
| Windows Checks | 1310 / 0 / 0 | 2 分 58 秒 |
| Ubuntu Checks | 1276 / 0 / 34（原平台条件） | 1 分 50 秒 |
| Ubuntu Performance | 4 / 0 / 0 | 25 秒 |

本机 Windows/Node 24.13.0 的默认全套：1310 项，1300 通过、10 失败、0 跳过/取消，776.03 秒，exit 1。失败清单如下，未隐瞒或为变绿修改旧版代码：

| 文件（core/ 下）与失败用例位置 | 首条错误与处理 |
|---|---|
| server/host/ai/hub-connection.test.mjs:68、88、96、114、133、160（6 项） | AI_SETTINGS_SAVE_FAILED：无法完成 AI 设置文件的访问保护；与归档 T2 本地保留组一致 |
| server/host/ai/settings-provider.test.mjs:32、54（2 项） | 同上，属于 T2 本地保留组 |
| server/host/http/server.test.mjs:290（1 项） | 503 != 200（the free quota needs no model address），T2 本地保留组 |
| 同文件 :349（1 项，HTTP imports allocate new physical groups by filename without conflict plans） | 上传 500 != 200；不改代码、并发 1 单独重跑该用例 1/0（13.21 秒），两系统 CI 均通过，首次原因未确定 |

上述文件及 V1 五份标准答案均未改；CI 全绿不能抹去本机失败。坏作答文件的后续处理、听力排期仍待负责人决定，本 PR 不越界处理。
