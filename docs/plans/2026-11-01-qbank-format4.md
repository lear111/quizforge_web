# Windows 格式 4 实施计划（实现前）

依据：`lear111/quizforge-v2` main `c0d003021684d7a4b73bdaf1edb7bd3e1694c10f`，设计 06 v0.7 与 `tools/qbank-upgrade/README.md` 规则 1–8。V2 只读副本在 Web 仓库外，既有两个工作目录均不改动。

## 当前存储与入口

- `question-banks/<组>/<题库>/bank.json`（或根目录题库文件夹），相邻 `assets/`、旧听力 `media/`；`.instance.json` 是独立的本机练习身份，不是作者 UUID。
- `extensions/<组>/<拓展>/manifest.json` 的 `examples` 指向示例 JSON；示例及资源同样需要升级。
- `core/server/host/library/library-archive.js` 负责 ZIP 边界、文件复制；`library-package.js` 负责格式 3 导入/导出和路径重绑定；`library.js` 管理串行写入及缓存。
- `LibraryManagement.change` 仅支持新建分组，无新建题库/另存为。`prepareEdit` 保存题目。`collections.js`、`practice/outline.js` 读取逐题大纲；`web/outline/` 按连续拓展推导分节。

## 实施顺序

1. 用原生 Node 模块实现严格、保留数字 token 的格式 3 转换和格式 4 校验；移植参考工具规则，不引入运行时 Python 依赖。UUID 唯一差异为随机小写 v4，首次落盘后固定。
2. 支持题库文件格式 2、集中大纲排序/筛选/分组、assets 音频与自由图片名。新建及另存为提供明确入口；UUID 与本地实例身份分开。
3. 导出仅输出格式 4；未升级的源要求先执行本地升级，避免每次导出重新生成身份。格式 3 导入先在隔离暂存转换，再按既有独立副本导入流程安装，提示升级。
4. 本机批量升级：独立备份目录、每个实体完整备份、暂存目录验证、目录交换与失败回滚；题库及拓展示例独立结果，已升级跳过。无正文报告包含结果、位置、备份与需重新审核拓展。
5. 合成包自动测试覆盖转换拒绝、字节保留、UUID 永久性、失败隔离/重复执行、导入导出与编辑；用 Python 参考实现做差分。
6. 独立 Compose 项目 `qf-web-format4` 本机验证 Windows 导出包导入、集中大纲和听力；结束 `down`。不访问任何部署站点，不读取 SSH 配置，不读取真实题库作为夹具。

## 边界与选择

采用原生 JS 共用转换层；Python 仅作验证基准，避免要求 Windows 用户另装 Python。严格拒绝格式 4 无定义的 WAV/OGG、未知字段与碰撞，不下载、不转码、不静默丢弃。拓展 JS/manifest/Schema/Bridge 不因升级改动；示例变化需 V2 重新审核。当前未提交的 PDF/Word 等开发功能不进入本 PR。不生成安装包，不合并 PR。

## 网络音频补充（v0.8）

V2 `docs/listening-url@bdbced2fa0c217d605578fa67946d447c54cc745` 第 4.2.1 节已经定义 URL。纳入原有未提交网络音频代码，格式 3→4 及格式 4 导入导出保留 URL。按作者要求先报告差异，不自行更改地址契约；详细矩阵见 ../reports/format4-network-audit.md。Python 参考工具及 V2 main 尚未接入此变更，含 URL 的差分与 V2 网络播放验证不能冒充通过。
