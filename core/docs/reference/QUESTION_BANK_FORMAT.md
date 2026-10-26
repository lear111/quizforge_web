# 题库格式

题库是 UTF-8 JSON，可放在 `question-banks/<题库>/bank.json`、`question-banks/<分组>/<题库>/bank.json` 或根目录下的独立 JSON 文件。分组只有一层，图片位于题库相邻的 `assets/`。题库定义题目，不保存用户作答、评分、笔迹或历史。

## 基本结构

```json
{
  "formatVersion": 1,
  "id": "136832c4-69e0-4ef9-9b72-e86ce4317405",
  "version": "1.0.0",
  "title": "我的练习",
  "questions": [{
    "id": "q1",
    "title": "整数除法",
    "extension": {"path": "extensions/我的题库组/single-choice"},
    "outline": {"level": "question", "label": "1"},
    "data": {
      "stem": "Java 中 7 / 2 的结果是什么？",
      "options": [{"id": "A", "text": "3"}, {"id": "B", "text": "3.5"}],
      "correctOptionId": "A",
      "explanation": "整数相除时舍去小数部分。",
      "maxScore": 1
    }
  }]
}
```

| 字段              | 约束                                                                                                                       |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `formatVersion` | 整数 1；旧文件省略时按 1 读取                                                                                              |
| `id`            | 来源元数据，不要求 UUID/全局唯一，不参与导入冲突；题目 ID 匹配`^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$`，同库唯一；旧字符串题库 ID 兼容读取  |
| `version`       | 可选作者版本，仅展示，不用于导入覆盖或去重                                                                         |
| `title`         | 题库名称取目录/文件名，title 保留元数据；每题 title 非空，最多 300 字符                                                                                    |
| `description`   | 可选说明                                                                                                                   |
| `questions`     | 按题序排列，1–10000 项；每项独立保存和提交，组合题小问留在父题 data 内                                                    |
| `extension`     | 绑定`{path}`（id 可选并核对），path 为 extensions/分组/拓展，相对数据根目录；旧无路径绑定拒绝并提示升级，逐题声明优先于根默认绑定 |
| `data`          | 对应拓展的 question schema 与规则定义，宿主不规定内部字段                                                                  |

单份 JSON 最多 8 MiB。无根默认绑定时，每题必须声明拓展；可混用不同实际目录的拓展，移动题库不改变绑定。物理目录、包格式和独立副本导入要求见[导入导出约定](LIBRARY_PACKAGES.md)。拓展样例只引用自身，见[拓展开发](EXTENSIONS.md)。

## 整库功能开关

```json
"features": {"editing": true, "whiteboard": true, "history": true, "exam": false}
```

仅允许这四个布尔字段。对象或字段省略时默认 true；仅显式 false 关闭，不支持题目级覆盖。

| 开关           | 关闭后的行为                                                                        |
| -------------- | ----------------------------------------------------------------------------------- |
| `editing`    | 禁止题目编辑及对应服务端写请求                                                      |
| `whiteboard` | 禁止草稿白板及对应写入，答案自动保存不受影响                                        |
| `history`    | 练习答案、得分、笔迹、完成状态、图片、AI 任务及考试仅留当前页面会话，不生成持久历史 |
| `exam`       | 隐藏开始考试入口，普通练习保留                                                      |

关闭 history 不删除原有持久数据；若 editing 仍开启，题目及编辑图片仍可写入题库。拓展样例采用相同语义，默认四项全开。考试细节见[考试模式](EXAM_MODE.md)。

## 大纲

`questions[].outline` 与 id/title/extension/data 同层，选择两种互斥形式之一：

```json
"outline": {"level": "question", "label": "三"}
```

```json
"outline": {
  "level": "parts",
  "items": [{"id": "part-a", "label": "21"}, {"id": "part-b", "label": "22"}]
}
```

前者仅显示父题，后者仅显示小题。宿主保留题序和 items 顺序，将相邻的同拓展 ID/版本合并为矩阵；被其他题型隔开的同型不合并。小题沿用父题题型名称。

显式 outline 优先于旧 `getOutlineItems(data)`；parts 要求 `outline-items` 能力及页面定位回调。ID/标签限制、定位、评分状态见[大纲接口](SUBQUESTION_OUTLINE.md)。编辑接口保留显式 outline，不从私有 data 推断小题增删或改号，结构调整需同步维护目录。只改大纲不重置当前作答；历史使用当时冻结的目录。

## 图片与校验

富文本保存结构化文档，不存任意 HTML。图片以 SHA-256 `assetId` 引用，文件为 `assets/<sha256>.<扩展名>`；支持 PNG/JPEG/WebP/GIF，单张最多 4 MiB。节点与题型字段以所选拓展 Schema 为准，见[富文本服务](RICHTEXT_SERVICE.md)。

在产品根目录运行：

```powershell
node skills/quizforge-bank-builder/scripts/validate-bank.mjs --project . --bank question-banks/my-practice/bank.json
```

校验覆盖结构、绑定、Schema、规则、资源与显式大纲；开发及预览参数见[拓展开发](EXTENSIONS.md#校验与发布)。还需在真实页面验证小题定位和作答保存。作答状态不写入 bank.json，由拓展接口上报并由宿主另存。

## 题库交换格式 .qbank

支持整个分组或单题库导出。`.qbank` 是带格式标识的 ZIP，包含：

```text
quizforge-package.json
question-banks/<分组名>/<题库>/bank.json
question-banks/<分组名>/<题库>/assets/
extensions/<分组名>/<拓展>/...
```

格式 3 整组清单为 `{"format":"quizforge-bank-group","formatVersion":3,"group":"组名"}`。单题库清单增加 `"scope":"bank"`，恰好包含一本题库，只收集它实际需要的拓展和资源；导入到题库根目录，配套拓展仍有独立物理组。包内题库与拓展均有一层同名暂存分组，各实体为独立文件夹；不含作答、历史、设置或内部保存身份。旧包格式 1/2 不支持导入，当前安装目录也须完成物理分组和路径绑定升级；冻结历史读取不变。完整约定见[导入导出](LIBRARY_PACKAGES.md)。

导入检查格式标识、目录、路径、资源和完整题库规则，自动分配新目录名称并同步拓展路径后成套安装；不能只按 ZIP 后缀直接解压。上限为上传 64 MiB、解压 128 MiB、单文件 8 MiB、10000 个条目。实现见 `core/server/host/library/library-archive.js`。


## 宿主听力材料（可选）

题库根可声明 `listening:{materials:[{id,title,file}],examMaterialId?}`，题卡在 `data` 同层用 `listening:{materialId}` 标记听力和材料绑定。音频放在题库 `media/` 目录，不写入题目JSON、不由拓展私有播放器承担。字段、大小限制和完整示例见 [宿主悬浮听力](LISTENING.md)。
