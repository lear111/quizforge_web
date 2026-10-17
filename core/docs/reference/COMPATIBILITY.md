# 兼容与迁移

## 版本声明

应用版本、拓展 `id@version`、Extension API、题库格式及富文本接口独立管理。当前支持 Extension API 1.0–1.3、题库格式 1；未实现 API 2、题库格式 2 或通用题型迁移。

```json
"requiresApi": {
  "major": 1,
  "minMinor": 3,
  "capabilities": ["practice", "score", "lifecycle", "answer-state"]
}
```

整个 requiresApi 省略时按 1.0 读取。显式声明只允许 major/minMinor/capabilities：前两项必填整数，当前接受 major=1、minMinor=0–3；能力可省略或为空，必须是不重复的已支持非空字符串。未知字段、版本或能力明确拒绝。

| 能力 | 含义 |
| --- | --- |
| `practice` | 页面注册、恢复、保存和提交 |
| `score` | 拓展评分与宿主汇总，1.2 起可带小题评分状态 |
| `editor`、`editor-drafts` | 编辑文档及未完成表单恢复 |
| `manual-review`、`ai-grading` | 人工评分与 AI 任务 |
| `resources`、`richtext` | 图片资源与公共富文本服务 |
| `navigation`、`lifecycle` | 切题请求、flush/dispose |
| `outline-items` | 小题定位，minMinor 至少 1 |
| `answer-state` | 即时作答进度，minMinor 至少 3 |

能力声明不授予写权限，页面仍须检查 `context.capabilities`。页面响应与 `QF.api` 提供实际 API 版本；历史使用冻结页面自己的版本，缺省按 1.0 读取。完整参数见[API 文档](API.md)。

API 1.3 使用 `reportAnswerState` 与关联的 draft 保存提供未提交进度；`getScore` 负责分值与已提交小题状态。API 1.0–1.2 未声明 answer-state 的旧拓展保留原查询路径，旧历史不注入新方法。具体约定见[大纲接口](SUBQUESTION_OUTLINE.md)。

题库 `formatVersion` 省略按 1 读取，不补写文件；显式值仅支持整数 1。根 features 允许 editing/whiteboard/history/exam，默认全开，语义见[题库格式](QUESTION_BANK_FORMAT.md#整库功能开关)。富文本新声明使用 requiresRichText，旧 dependencies 保留读取，见[富文本服务](RICHTEXT_SERVICE.md)。

## 更新边界

- 同一 API 主版本保留既有参数含义、返回结构和行为；破坏性变更需新的主版本及兼容运行层。
- 新题库精确绑定拓展 UUID 与实际路径，旧 ID/version 绑定兼容。安装新实体不改已有题库，导入只重映射本次安装题库的路径。拓展可在授权范围内原位修改；公共 SDK 与冻结历史快照仍不可变，保留其依赖。见[导入导出约定](LIBRARY_PACKAGES.md)。
- 受控样例编辑只修改题目及专属图片，不改 Manifest、规则、Schema、页面、SDK 或 manifest.assets 静态资源。
- 普通读取不改写题库文件；旧作答首次使用时带备份复制到统一存储。旧标记兼容说明见[拓展开发](EXTENSIONS.md)。
- 历史使用冻结的题目、页面、答案、评分、笔迹及组件版本，不以当前题库或规则补齐。缺依赖或不支持的版本明确报错。
- 更新核心前停止服务并备份产品目录，保留题库、全部拓展及 .state。回退需同时恢复匹配的程序和数据。

## 草稿布局

普通练习使用整个中间视口宽度，由拓展排版，笔迹只在草稿模式显示。草稿格式增加可选 `layout:{width,padding,top}`：首次进入新草稿保存固定760逻辑像素宽度，之后题目与笔迹共同缩放和平移；缩放和平移为设备本地视图，不同步到其他设备，不随侧栏或窗口重新换行。保存的 `viewport` 字段保留兼容但不再决定显示位置：每题按默认位置打开，本次打开期间记住各题视角。

无 layout 的旧草稿沿用 width=760、padding=26、top=34；不迁移旧笔迹，也不改冻结历史。拓展自己的 max-width 仍由拓展负责，无需升级 API。

## 显式简答迁移

普通启动不执行迁移。迁移前保存编辑、关闭同目录服务并备份产品目录；目标版本必须已安装。

| 参数 | 范围与行为 |
| --- | --- |
| `--upgrade-short-answer` | 已知简答 1.0.0/1.1.0/1.2.0/1.2.1 → 1.2.2；保留旧状态及历史。混合库备份题库和状态并通过编辑事务更新，完成轮当前答案转为草稿 |
| `--upgrade-short-answer-auto` | 1.2.2 → 1.3.0；保持 data/outline/ID、答案草稿、正式成绩与完成状态，已提交 pending 简答变为正式 0 分 |
| `--upgrade-only` | 配合上述任一参数，迁移完成后退出 |

在产品根目录执行，例如：

```powershell
node core/server/main.mjs --root . --port 8787 --upgrade-short-answer-auto --upgrade-only
```

迁移先绑定端口，已有服务时拒绝执行；未保存编辑草稿、目标状态冲突或内容校验失败时保留原文件。事务备份位于 `.state/upgrade-backups/`，冻结历史不改写。实现见 `core/server/host/practice/short-answer-upgrade.js`；这些专用迁移不适用于任意拓展。

## 统一拓展状态

开发版／正式版区分已取消，允许授权范围内原位编辑。版本和 API 声明仍保留；新包按分组/题库 UUID、版本选择保留或替换，拓展 UUID/哈希去重并按实际路径绑定，旧包保留旧冲突保护。旧叶名绑定和标记只为读取兼容，不影响加载和导出。旧作答按内容签名迁移到统一 .state，原文件与备份保留；现有 layout 和冻结历史保持原样。源码改变时受影响的当前答案重置前备份；这不代表任意新答案结构自动兼容旧结构。
