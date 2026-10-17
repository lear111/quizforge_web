# QuizForge

免费的本地刷题工具：适配各种题型，手机、平板、电脑都能刷，题库和作答都保存在你自己的电脑上。

**[下载预览版](https://github.com/lear111/quizforge_web/releases)** · **[使用教程](https://fork-pyjama-ddc.notion.site/QuizForge-3faeacdb658180ca9c16f6c47091ba73?source=copy_link)** · [使用手册](core/docs/guides/USER_GUIDE.md) · [功能清单](FEATURES.md)

![QuizForge 主界面：左侧题库列表，中间作答区，右侧题目大纲](core/docs/images/main-window.png)

当前版本 **0.1.0-preview.2**（预览版）。第一版功能范围已确定，后续以修复和发布验证为主；发布范围与已知问题见 [预览版说明](core/docs/releases/0.1.0-preview.2.md)。

## 功能

- **各种题型**：单选、多选、判断、简答开箱即用；完形、阅读、翻译、作文等由独立拓展提供，一本题库可以混排多种题型，也可以按开放接口设计新题型。
- **多端刷题**：电脑运行服务，手机、平板用浏览器访问，共用当前作答和草稿；支持局域网、IPv6 与公网连接，远程访问需要密码。
- **白板草稿**：触控笔书写、压感线宽、橡皮、撤销重做、框选笔迹、区域截图，草稿直接写在题目旁边。
- **评分与考试**：客观题自动判分；主观题可人工评分，也可接入 OpenAI 兼容服务由 AI 评分；限时考试到点自动交卷、统一评分。
- **历史快照**：每轮练习和考试冻结当时的题目、答案、评分和笔迹，后来改题也不会变。
- **AI 制作题库**：内置题库制作 skill，把 Word、PDF、图片或文本交给 AI 助手，按步骤确认后生成题库。
- **题库打包**：`.qbank` 文件带走题目、图片和所需题型，导入即可使用。
- **数据在本地**：题库、作答、草稿、历史和设置都保存在应用目录，核心功能不依赖云端服务。

## 快速开始

### Windows

1. 从 [GitHub Releases](https://github.com/lear111/quizforge_web/releases) 下载完整 ZIP（国内也可用[夸克网盘](https://pan.quark.cn/s/21e9f828118b)，提取码 `Me99`）。
2. 解压**完整文件夹**，双击 `QuizForge.exe`。
3. 服务就绪后自动打开 `http://127.0.0.1:8787/`。之后可从托盘图标打开网页或退出。

需要 Windows 10/11 64 位。运行环境已内置，不需要安装 Node.js；托盘使用系统自带的 .NET Framework 4.8。关闭浏览器后服务仍在运行，退出请用托盘菜单的“退出 QuizForge”。

### 从源码运行

需要 **Node.js 24**。在项目根目录双击 `Start-QuizForge-Web.cmd`，或运行：

```powershell
.\Start-QuizForge-Web.cmd
```

首次启动会自动安装依赖。其他系统可执行 `node core/server/main.mjs --root . --port 8787`。启动参数、单实例规则等细节见 [使用手册](core/docs/guides/USER_GUIDE.md#启动与停止)。

## 获取题库

预览包只带一套基础题型示例。已整理好的考研题库可在[夸克网盘](https://pan.quark.cn/s/21e9f828118b)（提取码 `Me99`）下载：

| 题库包 | 内容 |
| --- | --- |
| `考研数学.qbank` | 2013–2026 年真题，数一、数二、数三 |
| `考研英语.qbank` | 1997–2026 年真题，英语一、英语二 |

在运行应用的电脑上，点左侧“我的题库”旁的导入按钮，选择 `.qbank` 文件即可。也可以用 AI 助手制作自己的题库，见下文。

## 手机和平板

在电脑上打开设置 → **网络连接**，开启局域网或公网连接并设置密码（至少 8 位），其他设备用设置里显示的地址访问并输入密码。电脑需要保持运行；各设备共用同一份题库、作答和草稿。

想在手机上像应用一样从主屏幕打开（独立窗口、没有地址栏），需要用 **HTTPS** 地址访问：Chrome、Edge 不会在 `http://局域网IP:端口` 这类地址上提供“安装应用”，只能添加在浏览器标签页里打开的快捷方式。最简单的做法是在同一设置里开启 **局域网 HTTPS**：手机扫码下载并信任本机根证书（先核对指纹），之后用 `https://局域网IP:8789/` 访问并安装；也可以用 Caddy 等反向代理配上手机信任的证书。见 [使用手册 · 安装到手机主屏幕](core/docs/guides/USER_GUIDE.md#安装到手机主屏幕)。

连接端口本身是 HTTP；公网访问需自行配置端口映射、反向代理或 IPv6 防火墙。详细步骤与安全注意事项见 [使用手册 · 网络连接](core/docs/guides/USER_GUIDE.md#网络连接)。

## AI 评分

设置 → **AI 评分**，填写 OpenAI 兼容服务的地址、模型名称和 API Key，开启并保存；可用“测试模型”检查连接和图片识别。调用模型可能产生费用；密钥只保存在本机后端，不会发给拓展或远程设备。详见 [使用手册 · AI 辅助评分](core/docs/guides/USER_GUIDE.md#ai-辅助评分)。

## 用 AI 助手制作题库

把 [quizforge-bank-builder](skills/quizforge-bank-builder) 技能文件夹交给 AI 助手（例如 Codex），同时提供材料、项目根目录和输出位置。流程为：

确认功能开关 → 分析材料与选型 → 访谈界面细节 → 确认原型 → 验证小样 → 你验收并同意生成 → 批量生成、校验、交付

制作过程不修改应用核心和你的练习数据。使用说明见 [题库制作技能](skills/quizforge-bank-builder/SKILL.md)。

## 文档

| 文档 | 内容 |
| --- | --- |
| [使用手册](core/docs/guides/USER_GUIDE.md) | 启动参数、目录管理、练习与历史、白板、编辑、导入导出、网络、AI、更新兼容的完整说明 |
| [功能清单](FEATURES.md) | 用户可见的功能、操作入口与测试预期 |
| [考试模式](core/docs/reference/EXAM_MODE.md) | 考试生命周期、交卷与评分 |
| [题库格式](core/docs/reference/QUESTION_BANK_FORMAT.md) | 题库结构与功能开关 |
| [拓展开发](core/docs/reference/EXTENSIONS.md) · [API 文档](core/docs/reference/API.md) | 自定义题型的文件组织与接口 |
| [导入导出](core/docs/reference/LIBRARY_PACKAGES.md) | `.qbank` 包格式与导入规则 |
| [更新兼容](core/docs/reference/COMPATIBILITY.md) | 升级与迁移政策 |
| [文档索引](core/docs/README.md) | 全部开发文档 |

## 开发

开发环境、测试要求与 PR 流程见 [贡献指南](CONTRIBUTING.md)，代码布局见 [core/README.md](core/README.md)。在项目根目录运行检查：

```powershell
Push-Location .\core
npm ci --cache ../.temp/npm-cache --no-audit --no-fund
npm test
npm run test:host
Pop-Location
```

自动化测试使用隔离目录，不操作用户数据；结构与规则检查不代替真实浏览器、手机或真实模型验收。

## 说明

- 更新前请停止服务并备份整个应用目录（尤其是 `question-banks/`、`extensions/`、`.state/`）；`.qbank` 不包含作答和历史，不能代替备份。
- 这是个人跨设备使用的工具，不是多账户系统；暂不支持音视频题型。`.qbank` 内含可运行的题型代码，应用不提供完整的操作系统级沙箱，请只导入可信来源的题库包。
- QuizForge Web 独立于 QuizForge V2，数据和包格式不互通。
