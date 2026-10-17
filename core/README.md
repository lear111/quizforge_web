# 核心代码目录

应用只使用 Node.js 24。Java 源码、Java 测试与 Maven 配置已移除；旧数据格式的兼容样本仍保留，用于验证历史、签名和评分行为。

```text
core/
  package.json                # 启动、构建、测试命令
  server/
    main.mjs                  # 服务启动入口
    rules-runner.cjs          # 独立规则进程入口
    host/
      http/                   # HTTP 路由、网络连接与服务生命周期
      platform/               # 文件、JSON、错误、缓存和事务基础工具
      library/                # 题库目录、分组管理和导入导出
      extensions/             # 拓展包、API 能力、规则执行与校验缓存
      practice/               # 作答、状态、大纲、草稿存储和旧数据升级
      history/                # 练习轮次与冻结历史
      exam/                   # 考试和临时考试
      editor/                 # 编辑草稿与编辑事务
      resources/              # 图片资源和富文本服务注册
      ai/                     # 模型设置、评分任务、诊断与凭据保护
  web/
    index.html, app.js        # 页面入口与宿主协调
    shell/                    # 外壳样式、网络设置与外观主题
    bridge/                   # iframe、拓展接口与页面资源
    practice/                 # 作答反馈、缓存、加载、汇总和保存恢复
    draft/                    # 白板笔迹、选择、截图、比例布局与全屏
    library/, outline/        # 列表与大纲
    history/, editor/, exam/  # 历史、编辑、考试
    ai/, development/        # AI 设置与开发版预览
    shared/                   # HTTP 客户端和写入队列
    assets/                   # 图标等静态资源
  test/                       # 按对应功能分组的前端与集成测试
    fixtures/                 # 稳定的旧拓展、旧数据和协议样本
  scripts/
    build/, dev/              # 构建和隔离预览工具
    launcher/, test/          # 启动辅助与测试发现
  shared/richtext/             # 基础与高级文档约定的当前富文本实现
  docs/
    README.md                 # 文档索引
    reference/                # 当前接口、格式和兼容规范
    guides/                   # 开发与架构说明
```

后端测试与对应模块放在同一个功能目录；前端测试放在 `test/<功能>/`。新增代码优先放入已有功能目录，不在入口目录堆放模块。模块间使用相对路径引用，用户题库、拓展和状态仍位于产品根目录。

从 `core/` 执行：

- `npm start`：启动服务。
- `npm test`：递归发现并运行所有正式测试，不执行 fixtures 内的示例代码。
- `npm run test:host`：后端测试。
- `npm run test:rules`：规则进程测试。

文档入口见 [docs/README.md](docs/README.md)。接口与持久化约束见 [API.md](docs/reference/API.md)，模块职责见 [CORE_SOURCE.md](docs/guides/CORE_SOURCE.md)。
