# B7a：原生 CRC 与导出压缩策略

任务卡：B7a，仅 ARCHITECTURE_REFACTOR_PLAN.md 的 B7 第 1、3 项。基于 main `a31b08412bc64db533b9cc7259fa782269c41f9d`（#48 已合并），与 S1 PR #49 互不依赖。B2b 仍暂停，候选 B 未实施。

## 改了什么

1. library-archive.js 的逐位 JavaScript crcUpdate 改为 Node 24 内置 node:zlib.crc32，使用标准 CRC 初值 0、逐块续算、直接比较无符号最终值。不是跳过校验：CRC 不匹配仍为 422 INVALID_LIBRARY_ARCHIVE，文案仍为“压缩包文件校验失败”。空内容、跨流块以及 stored/deflate 两种输入均有用例。
2. yazl.addFile 对现有图片/听力白名单中已压缩的 `.png/.jpg/.jpeg/.webp/.gif/.mp3/.m4a/.ogg`（大小写无关）显式 compress:false。WAV、JSON、JS、CSS、HTML、文本和不在该集合的后缀仍用原默认 deflate。没有把 FLAC/AAC 等格式加入产品资源白名单；图片来自 resources.js / 原 imageTypes，听力格式来自 resources/listening.js（mp3/wav/ogg/m4a）。
3. 增加只生成合成资源的约 40 MB 分组脚本、独立全链路计时脚本、旧新代码同输入安全对照脚本及六项回归测试。脚本不是生产诊断开关，不进入服务启动流程。

## 明确没改什么

没有改任何 HTTP 响应 JSON、状态码约定、规则输入、版本号、回执、状态持久化格式、SDK/拓展协议或四份标准答案。题库包版本仍 **3**，题库文件版本不变；本 PR 不承担其他分支的格式 4 工作。

没有改事务锁范围、全局/题库锁、目录复制流程、私有路径规则、符号链接/路径检查、单文件/展开/上传上限、安装和回滚、校验次数、校验缓存或前端加载。没有宣称导入期间其他题库读写不排队；这些留给 B4、B7b/B7c。Library、library-package、import-validation、server、前端均未改。

只在本机隔离工作树和合成目录运行，不访问正式/测试站、不读取 SSH、凭据或作者题库，不重启日常服务，不生成安装包。本 PR 不自行合并。

## 文件清单

| 文件 | 改动 |
|---|---|
| core/server/host/library/library-archive.js | 两处生产修复，7 行增加/4 行删除 |
| core/server/host/library/library-archive-integrity.test.mjs | 原生 CRC、ZIP method 和恶意包回归，6 项 |
| core/scripts/dev/create-archive-perf-fixture.mjs | 500 个真 PNG、3 段实际编码音频、3 本题库、真实内置单选规则/页面/声明，输出不存在的新目录 |
| core/scripts/dev/measure-archive-perf.mjs | 前后各三次真实 Library 调用、交替顺序、种子不变校验、双向兼容验证 |
| core/scripts/dev/verify-archive-safety.mjs | 同一批恶意 ZIP 对旧新检出分别运行，核对原错误码/状态和清理 |
| core/docs/design/reviews/B7a-data.json | 全部计时样本/哈希/运行环境/兼容与安全结果，不含题目正文或答案 |
| core/docs/design/reviews/B7a.md | 完整 PR 描述和证据表 |
| core/docs/design/ARCHITECTURE_REFACTOR_PLAN.md | 本次 B7a 范围及进度；B2b 暂停不变 |

## 兼容性与标准答案

- 旧状态文件/冻结历史：生产只改 ZIP 读写，StateStore、history、资源身份及标准答案不改；默认完整 CI 的旧状态/历史/四份 Buffer.equals 用例继续执行。
- 旧拓展：格式 3 的拓展/题库目录与声明原样打包，仅 ZIP compression method 改变；专项原有混合题型、同名拓展重映射、图片导出、原规则校验全部保留。
- **基线检出**：单独 detached worktree 在 `a31b084`，npm ci --ignore-scripts；既有 tracked 文件未改。用新代码导出的 41,470,079 字节包，通过基线的真实 Library.importPackage，完整安装 3 本题库和 1 个拓展；逐本打开并确认听力配置仍在。
- 旧代码导出的 41,366,079 字节包，通过新代码同一路径导入成功，同为 3 本/1 拓展，逐本打开后听力配置保留。这不是仅 unzip 或空 validator 的“成功”。基线和新代码均运行真实规则/资源校验。
- 所有 500 个 PNG 已由 @napi-rs/canvas 完整解码为 128×128；三段 MP3/OGG/M4A 各 150 秒，ffprobe 核对并由 ffmpeg 完整解码无错误。该验证不等同于浏览器实际播放验收；本次没有改播放器。

基线 archive 源 SHA-256：`d42f54813201ca13838975f8a9671d489ac58796dc8a0dcdf89d59828094426b`；新源码：`3179c6860e7fcec828d1392ee8d1cede28d2947de2f89c2194786c11e22df070`。其他生产文件不在 diff 内。

## 计时对比与复现

Windows 11 Pro x64 10.0.26200，Node v24.13.0，13th Gen Intel Core i5-13500H。隔离本机工作树，无文件系统沙箱。未同时跑本机测试/其他压测；不是生产负载或浏览器端耗时。FFmpeg 8.1.1-full_build-www.gyan.dev 用于生成和验证实际编码音频，不是应用新增运行依赖，CI 测试无需 FFmpeg。

合成源：**41,813,498 字节（39.8765 MiB）**，517 个文件，500 张各 65,752 字节的真实 PNG（32,876,000 字节）及 3 段音频（8,389,693 字节）。题目引用所有图片；三本分别绑定一段音频；复制仓库真实内置单选 schema/rules/页面/声明，替换示例为小型合法数据，未复制旧示例图片。没有无效魔数文件、无意义填充或真实内容。

脚本复现（从当前分支仓库根目录，事先安装 Node 24、锁文件依赖和 FFmpeg）：

```powershell
git worktree add --detach C:/dev/qf-b7a-control a31b08412bc64db533b9cc7259fa782269c41f9d
npm --prefix C:/dev/qf-b7a-control/core ci --ignore-scripts
node core/scripts/dev/create-archive-perf-fixture.mjs C:/dev/qf-b7a-seed
node core/scripts/dev/measure-archive-perf.mjs C:/dev/qf-b7a-seed C:/dev/qf-b7a-control/core C:/dev/qf-b7a-results
node core/scripts/dev/verify-archive-safety.mjs C:/dev/qf-b7a-control/core
```

seed/results 都要求是不存在的目录；不向应用目录生成。benchmark 每次使用独立的 OS 临时副本，finally 检查绝对路径在自有临时父目录内才清理；保留结果 JSON 和两份合成包供复查，不提交生成物。

时钟为 performance.now。测量边界为完整 Library.exportGroup / Library.importPackage 方法调用（含锁、复制、规则校验、组装和 ZIP），不含引擎初始化、准备源副本、输出文件读取/另存、返回后的 close 清理；没有发 HTTP，不能冒充 Server-Timing 或 socket 写出时间。导入两版本都用**同一个旧压缩包 Buffer**，隔离 CRC 的收益；导出各用自己的策略。每次新 Library/RuleEngine/空目标，保留默认校验/缓存行为。第 1、3 轮 before→after，第 2 轮 after→before；初始共同旧输入准备不计入样本，未择优删数据。

| 操作 | n（每组） | 基线中位 ms | 新版中位 ms | 变化 |
|---|---:|---:|---:|---:|
| 导入，共同旧包输入 | 3 | 11996.502 | 11059.323 | -7.8121% |
| 导出 | 3 | 4783.028 | 3834.217 | -19.8370% |
| 导出包字节 | 3 | 41,366,079 | 41,470,079 | +104,000（+0.251414%） |

| 轮 | 顺序 | 基线导入 ms | 新版导入 ms | 基线导出 ms | 新版导出 ms |
|---|---|---:|---:|---:|---:|
| 1 | before→after | 11967.659 | 11059.323 | 5216.518 | 4152.276 |
| 2 | after→before | 15481.030 | 11526.970 | 4783.028 | 3159.298 |
| 3 | before→after | 11996.502 | 10944.402 | 4327.683 | 3834.217 |

所有基线导出大小相同，所有新版导出大小相同。旧包 SHA-256 `0d57e39b084277b442aae88045541fad01685bf9ac63f4939d3515fafb3e4414`；新包 `23e9e77f4d51a988a8765eb5b130e90850870e7a97ce52bfd74894a1306f1e36`。seed 树摘要前后都是 `12f7bf252cafb01472fd85284370409fbd36b8a5c4db492fd61e0ac3cb41058b`。导出 ZIP 时间戳会使其他时刻重做的包摘要不同，不要求跨机器/FFmpeg 版本重生成相同音频字节；三轮对照使用同一份冻结种子。

完整数字证据直接在 git 的 [B7a-data.json](B7a-data.json)，SHA-256 `b52895d0dacbaa73b8aee47dfbc41856d176b135438fcc13db02ca445c8e0c54`；审查所需表和结论也全部在本文，不依赖外部附件。

## 测试：新增、原有及基线对照

新增六项（现有所有测试原样保留）：

1. stored 流：跨块 CRC 与空条目通过；
2. stored CRC 错误：原 422/code/中文错误原样；
3. deflate 流：跨块 CRC 与空条目通过；
4. deflate CRC 错误：原 422/code/中文错误原样；
5. 从 ZIP 中央目录核对既有已压缩后缀 method=0，WAV/文本/非白名单后缀 method=8，并解压比文件；
6. 路径越界、大小写重复、超 8 MiB：原错误，未进入 validator、不安装任何分组、不遗留暂存。

将同一新增测试临时放入基线检出执行（之后移除，仅测试文件，tracked 源完全不改），结果 **6 项：5 通过、1 失败、0 跳过**。唯一失败是第 5 项 asset.MP3 的 ZIP method 实际 8、预期 0，准确暴露本次要改的旧压缩策略；其余 CRC/安全行为旧实现本来就通过。新实现六项全部通过。没有改断言去迁就产品。

同一批恶意包另在旧/新真实 importPackage 中比较，均在 validator 前拒绝，且暂存清理完成：

| 输入 | 基线 status / code | 新版 status / code |
|---|---|---|
| 路径 `../` | 422 / INVALID_LIBRARY_ARCHIVE | 相同 |
| 大小写重复路径 | 422 / INVALID_LIBRARY_ARCHIVE | 相同 |
| 8 MiB+1 单条目 | 413 / LIBRARY_ARCHIVE_LIMIT | 相同 |
| stored CRC 错误 | 422 / INVALID_LIBRARY_ARCHIVE，原 CRC 文案 | 相同 |
| deflate CRC 错误 | 422 / INVALID_LIBRARY_ARCHIVE，原 CRC 文案 | 相同 |

| 本机检查 | 结果 |
|---|---|
| npm --prefix core ci --ignore-scripts | 退出 0；基线依赖同样安装成功 |
| npm --prefix core run typecheck:ui | 退出 0 |
| npm --prefix core run build:ui -- --check | 退出 0，源码/构建/许可证一致 |
| node --test core/server/host/library/library-archive-integrity.test.mjs core/server/host/library/library-archive.test.mjs core/server/host/library/library-package.test.mjs core/server/host/library/library-export-images.test.mjs core/server/host/library/import-validation.test.mjs core/test/library/library-transfer.test.mjs | **54 项，54 通过，0 失败/跳过；38707.7776 ms** |
| node core/scripts/dev/verify-archive-safety.mjs C:/dev/quizforge-web-b7a-baseline/core | 5 类同输入，旧新各一次，10 次均为预期拒绝且清理 |
| 双向真实导入/打开 | 新→旧、旧→新均 3 本/1 拓展成功 |

默认全套与 perf 三个干净 CI job 的实际结果/用时及完整失败名单在推送后补齐本文件，PR 描述同步；不把本机专项称为全套件通过。本机既有 ACL 相关失败不修、不用跳过掩盖。

## 未解决或存疑

- 三样本有限，文件系统/防病毒/后台调度会波动；导入第 2 轮基线偏高，原样保留，未用它算平均放大收益。
- PNG/有损音频并非数学意义不可压缩，放弃其 deflate 可能略增包体；此分组 +0.25%，其他真实素材可能不同。WAV 特别保留压缩。
- 导入仍约 11 秒，复制、fsync、规则/资源检查、全局事务没有改；不是解决全部导入卡顿。没有测或声称另一本题库保存不受影响。
- 包格式版本不变，无需用户迁移或回退状态；回退仅恢复旧算法，旧 ZIP 解码器支持 method 0。
- 用户浏览器实际操作及正式部署不在本次验收；不发布安装包、不自行合并，不开始 B7b/B7c 或恢复 B2b。
