# Windows 桌面启动器

`windows/` 是轻量 Windows Forms 托盘启动器源码。业务、数据存储、规则执行及网页仍由 Node 后端负责；用户入口是产品根目录的 `QuizForge.exe`，不新增网页窗口外壳。

需要 Windows 10/11 x64、系统 .NET Framework 4.8。构建使用 Windows Framework 自带 `csc.exe`，无需安装 .NET SDK。源码运行可查找系统 Node.js 24；预览包优先使用 `runtime/node.exe`，不需要全局 Node。

在产品根目录构建：

```powershell
& ./core/scripts/build/build-windows-launcher.ps1
node ./core/scripts/build/build-windows-preview.mjs
```

EXE 输出到根目录；ZIP 输出到 `dist/`，已有同版本文件时拒绝覆盖。可用 `--output` 指定另一输出目录，`--version` 指定发布版本，`--node` 指定 Node.js 24 可执行文件，`--node-license` 提供该版本的本地 LICENSE 以离线构建；未提供 LICENSE 时从 Node 官方仓库对应版本下载。正式发布时从已提交源码构建，用 `--source-commit` 将40位提交摘要写入 RELEASE.json；本地未提交构建默认留空，不声称对应当前 Git 提交。依赖复制自当前 `core/node_modules`，保留许可证，不在打包时升级版本。

发布包按名单包含后端、网页、富文本 SDK、运行依赖、技能和文档、基础题型展示库及四种基础拓展。排除根目录人工测试、自动测试、开发启动脚本、其他题库/拓展、个人 `.state`、临时及回收数据。`RELEASE.json` 记录版本、Node 版本、托盘摘要和依赖列表；生成的二进制及 ZIP 不提交 Git。

源码目录（有 `core/package-lock.json`、没有 `RELEASE.json`）启动时，后端在加载第三方包之前对照锁文件与 `core/node_modules/.package-lock.json`；不一致则不启动，并经 `--desktop` 标准输出的 `failed` 消息把“缺少依赖或版本不符：包名。请在应用根目录运行 npm --prefix core ci 后重新启动。”交给托盘状态、“运行情况”和通知。托盘没有控制台窗口，`npm ci` 会重建 `node_modules` 且可能需要联网，因此托盘只提示命令，不自动安装；`Start-QuizForge-Web.cmd` 在可见窗口中自动运行 `npm ci`。预览包不做锁文件比对、不运行 npm；模块加载失败时提示缺少的包名并要求重新解压。原因只含包名或文件名，不含完整路径。

正常首次启动等待后端专用标准输出 ready 消息后才打开浏览器。左键打开网页；右键提供状态、运行情况和退出。进程内用同目录互斥量防重复，第二个 EXE 通过仅当前 Windows 用户可访问的命名管道请求原托盘打开网页。`--root`、`--port`、`--no-browser` 用于隔离验证；`--status` 输出托盘状态 JSON，`--quit` 请求原托盘退出。

后端 `--desktop` 只监听父进程专用 stdin 的 `quit` 或 EOF，不注册 HTTP 关闭路由。正常退出停止接收新请求，等待已接收的 HTTP 请求与数据事务，再关闭规则、AI、服务及目录锁；尚在浏览器中且未发出的输入仍需用户确认已保存。Windows Job Object 管理自己启动的进程树，托盘异常结束时回收后台进程。其他启动方式的现存服务不会被自动接管或终止。

自动验证：`node --test core/test/desktop/windows-tray.test.mjs`（Windows x64）；后端控制及保存退出检查在 `server/host/http/desktop-control.test.mjs`、`server.test.mjs`；依赖检查与失败原因在 `server/host/platform/dependencies.test.mjs`。这些流程验证不能代替托盘真实鼠标点击、系统默认浏览器打开和原生窗口人工验收。
