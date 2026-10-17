# 开发与架构

## 运行与测试

需要 Node.js 24。在产品根目录安装依赖并启动：

```powershell
npm --prefix core ci
node core/server/main.mjs --root . --port 8787
```

Windows 也可运行 `Start-QuizForge-Web.cmd`，自动安装依赖并打开浏览器。`--root` 指向含 `question-banks/`、`extensions/` 的产品根目录；按 Ctrl+C 停止服务。同一数据目录只能运行一个写入服务。

在 `core/` 执行：

| 命令 | 用途 |
| --- | --- |
| `npm start` | 使用上一级产品目录启动，默认端口 8080 |
| `npm test` | 递归运行后端、规则及前端测试 |
| `npm run test:host` | 后端测试 |
| `npm run test:rules` | 规则进程测试 |
| `npm run build:richtext-advanced -- --version <新版本>` | 构建新的高级富文本组件 |

后端测试使用隔离目录与真实 HTTP；`test/fixtures/` 保存旧协议、旧包及旧数据，不参与正式目录扫描。修改公共接口时同时检查旧拓展、混合题库、历史与重启恢复。构建组件不能覆盖已发布的同版本文件。

## 模块职责

目录均相对于 `core/`，完整目录树见 [源码目录](../../README.md)。

| 功能 | 后端 | 浏览器 |
| --- | --- | --- |
| 入口与网络 | `server/main.mjs`、`server/host/http/` | `web/app.js`、`web/shell/` |
| 题库、分组、导入导出 | `server/host/library/` | `web/library/` |
| 拓展解析与规则执行 | `server/host/extensions/`、`server/rules-runner.cjs` | `web/bridge/`、`web/development/` |
| 作答、草稿与大纲 | `server/host/practice/` | `web/practice/`、`web/draft/`、`web/outline/` |
| 冻结历史 | `server/host/history/` | `web/history/` |
| 考试 | `server/host/exam/` | `web/exam/` |
| 题目编辑与事务 | `server/host/editor/` | `web/editor/` |
| 图片与富文本 | `server/host/resources/`、`shared/richtext/` | 富文本公共 SDK |
| AI 评分 | `server/host/ai/` | `web/ai/` |
| 文件、缓存与事务工具 | `server/host/platform/` | `web/shared/` |

宿主管理权限、数据保存、历史、考试、AI 通信和分值汇总；拓展拥有题型数据、题目投影、答案校验、评分规则及页面。宿主不解释拓展私有答案，也不按选项数量推算分数。

## 加载与保存

目录列表只读取元数据。打开题库时才校验该库及其关联拓展，生成投影与大纲；首题页面就绪前显示加载提示，失败时保留原页面。规则按拓展身份分组、有界批处理，再恢复原题序。校验和批量投影最多并行两个拓展组，同组批次仍串行，失败时等待已启动的工作退出再返回错误。手动刷新目录及当前开发版的热刷新保留独立检查路径。

成功校验缓存绑定题库内容、拓展身份与规则运行环境；失败结果不缓存。后端集合、状态缓存与浏览器题目缓存分开管理，上限见 [宿主说明](../../server/README.md)。这些缓存的编码大小预算不等于完整堆内存占用。

读取已打开的题库或题型页面时，只复核该库文件、资源及关联拓展目录，不重新扫描整个目录；文件移动、缺失或内容变化时回到完整加载。新增同 ID 题库或更高版本拓展，在下一次完整扫描（目录列表、刷新、导入）时生效。修改开发者模式会清空后端集合缓存。

服务就绪后在后台准备规则运行环境的文件摘要，与浏览器读取目录重叠，不加载或校验题库。读取题库和题型页面时复用 30 秒内检查过的环境摘要；首次加载、写入和导入校验仍重新检查运行环境文件身份。

作答先留在拓展页面内存。API 1.3 的 `reportAnswerState` 先反馈大纲，随后关联的 `QF.save` 原子保存答案与进度；保存成功才更新 revision 和已保存标记。提交、切题、汇总和交卷前通过 `onFlush` 排空待保存输入与上传，失败则保留输入及恢复入口。接口见 [大纲与作答状态](../reference/SUBQUESTION_OUTLINE.md)。

状态写入采用临时文件、刷盘和原子替换，并检查 revision、内容版本及幂等 requestId。题目编辑通过可恢复事务同时更新题库与状态，只重置内容变化题目的当前作答；历史不变。`features.history:false` 时练习数据仅存在当前页面会话，题目编辑仍可持久保存。

## 页面与规则边界

浏览器只保留一个活动拓展 iframe。桥接层校验来源、会话、请求及权限；练习、编辑、考试、历史采用各自的 context 能力。规则在独立、限时的 Node 子进程运行，同步读取 JSON 并返回 JSON；文件权限限制不能替代完整的恶意代码隔离。读取权限相同（同一拓展）的请求复用常驻规则进程，只共享 Node 启动和模块加载：每个请求仍新建 AJV 实例与 VM 上下文，并重新读取规则及 Schema 文件。每组忙时最多两个进程、全局最多 12 个；启动后的后台校验让位于前台请求，两个进程都在执行后台批次时为前台请求额外启动一个。进程空闲 60 秒或处理 500 个请求后退出；单个请求超时、输出超限或进程崩溃时结束该进程，下一请求重新启动。

普通练习提供整个中间视口宽度，拓展自行排版；笔迹只在草稿模式显示。草稿固定初次布局宽度，题目与笔迹一起缩放和平移，窗口变化不重新排版。布局持久化及旧坐标兼容见 [兼容说明](../reference/COMPATIBILITY.md#草稿布局)。

## 安装为应用

`web/manifest.webmanifest` 由静态服务以 `application/manifest+json` 返回，与其他页面资源一样无需访问口令、带 `Cache-Control: no-store`。`start_url`、`scope` 和 `id` 均为 `/`，不含 `#token=`；`shared/api.js` 读取口令后立即从地址中移除，并只存入当前窗口的 `sessionStorage`，所以安装的应用每次启动都需要重新登录。图标为 `web/assets/` 中的 192／512 PNG，maskable 版本由 `quizforge-maskable.svg` 生成。

应用刻意不注册 Service Worker：Chrome（移动版 108、桌面版 112 起）和 Edge 安装不再需要它，加了离线缓存反而可能让旧页面或旧拓展资源继续写入数据。浏览器只在 HTTPS 或 localhost 上提供安装，HTTP 局域网地址只能添加快捷方式；可开启下节的局域网 HTTPS，或用外部反向代理提供 HTTPS，部署说明见 [使用手册](USER_GUIDE.md#安装到手机主屏幕)。

## 局域网 HTTPS

`server/host/http/lan-certificates.js` 生成并维护本机根证书和服务器证书，文件在数据目录 `.state/lan-https/`（`root-ca.key`、`root-ca.crt`、`root-ca.json`、`server.key`、`server.crt`）。目录首次创建时，POSIX 设为 `0700`、Windows 用 `icacls` 去掉继承权限只授权当前用户；文件经 `replaceFile` 以 `0600` 写入。

- 根证书：RSA 2048、SHA-256、10 年，`basicConstraints CA:TRUE, pathlen:0`、`keyUsage keyCertSign/cRLSign`，并带关键的 `nameConstraints`：只允许 `127.0.0.0/8`、`10.0.0.0/8`、`172.16.0.0/12`、`192.168.0.0/16`、`::1/128`、`fc00::/7` 以及 `localhost`、生成时的主机名和 `主机名.local`。
- 服务器证书：397 天（iOS 上限 825 天），`serverAuth`，SAN 为 `localhost`、主机名、当前所有落在上述范围内的局域网地址、`127.0.0.1`、`::1`。`ensure()` 在地址不再被覆盖、距到期不足 30 天或文件缺失时换发；HTTPS 端口通过 `setSecureContext` 热替换，根证书不变。服务每 60 秒及每次读取网络设置时检查一次。
- 名称约束的取舍：Chrome（BoringSSL 与 Chrome 自带校验器）、Android 系统校验和 Apple 的 Security 框架都按 RFC 5280 执行 `nameConstraints`，包括 IP 约束；OpenSSL 同样执行，自动测试用它确认越界证书被拒绝。代价是公网 IPv6 前缀会变，无法预先约束，因此不写入 SAN；修改电脑名称后需重新生成根证书才能使用新名称。手机端实际行为需真机确认。

`server.js` 在局域网连接端口之外开一个 HTTPS 监听（`networkSettings.config.httpsPort`，默认连接端口 + 1，TLS ≥ 1.2）。它与连接端口共用 `remote` 处理：`validateHost` 要求局域网开关、私有对端地址和局域网 Host（另接受证书里的主机名，不接受公网地址配置），Host 端口按 443 默认值比较；`validateOrigin` 比较 `https:` 来源；`canManage` 始终为 false，需要连接密码。HTTPS 只在局域网开关打开时可开启，关闭时停止监听但保留证书。

`GET /quizforge-lan-ca.crt` 是唯一读取 `.state` 的页面路径：只在 HTTPS 运行时返回根证书 DER（`application/x-x509-ca-cert`），路径精确匹配，不经过静态文件解析，也不需要密码。`POST /api/settings/network/https/regenerate` 仅限本机，重新生成根证书和服务器证书。

依赖选型：

| 方案 | 结论 |
| --- | --- |
| Node 内置 `crypto` + 自写 DER 编码（采用） | 无新依赖；`generateKeyPair`／`sign` 负责密钥和签名，`X509Certificate` 负责解析、校验和 `checkIP`／`checkHost`。只需编码固定的证书结构，`nameConstraints` 完全可控。 |
| `@peculiar/x509` 2.x（MIT） | API 完整，但依赖 `tsyringe`、`tslib`、`pvtsutils` 及 8 个 `@peculiar/asn1-*` 包，打包体积和供应链面明显增大。 |
| `node-forge` 1.x（BSD-3-Clause 或 GPL-2.0） | 单包，但纯 JS RSA，内置扩展不含 `nameConstraints`，需手写原始 DER；历史上多次出现签名校验相关漏洞。 |

二维码在后端用 `qrcode-generator@2.0.4`（MIT，Kazuhiko Arase，无依赖，许可证写在 `dist/` 文件头）生成 SVG，以 `data:image/svg+xml;base64,` 返回，前端只接受这一前缀；版本锁定在 `package.json`，并由 `scripts/build/runtime-dependencies.mjs` 打包。

## 评分、考试与历史

`grade/review/getScore` 由拓展实现，宿主保存结果并汇总父题分值。AI 流程为：拓展 `prepareAiGrading` 提供材料 → 宿主请求模型并校验输出 → 拓展 `review` 合并结果 → 宿主保存。可选 `targetId` 路由小题任务，自动评分可返回多个目标；完整参数见 [API 文档](../reference/API.md)。

考试开始时冻结整库和页面，交卷后锁定答案再统一评分，详见 [考试模式](../reference/EXAM_MODE.md)。历史冻结题目、投影、页面、答案、分数、大纲、笔迹及实际组件版本，读取时不调用当前规则补数据。应用更新与数据升级边界见 [兼容说明](../reference/COMPATIBILITY.md)。

## 统一题库／拓展状态

目录索引不按旧development标记过滤题库或拓展；管理开关只控制入口。旧绑定解析到Manifest身份，旧状态按需带备份迁移，冻结历史不改。源码可原位编辑，内容签名仍用于缓存失效及当前作答适配；公共SDK快照保持不可变。完成练习使用已有规则提交已保存答案。草稿固定760逻辑像素，视图缩放和平移不进入共享笔迹数据。此前条件GET、读取绑定复用、规则分组并行及启动摘要预热保留。
