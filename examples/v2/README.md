# V2 基础题型演示

示例来自仓库公开的原基础题型展示库：原编号 1、2、3（单选），7、8（多选），9、10（判断），共 7 题。保留题干、选项、解析、满分、表格、公式和图片；简答与答题区待后续迁移。原 V1 题库、作答与设置不读取、不覆盖。

在仓库根目录双击“启动 V2 基础题型演示.cmd”（旧的“启动 V2 单选题演示.cmd”也可），或运行：

```powershell
node core/server/v2-main.mjs --root examples/v2 --port 8794
```

打开 http://127.0.0.1:8794/ ，展开“基础题型”，选择“基础题型展示库”。点选即保存；题内提交后显示分数与解析，仍能在草稿模式写笔记；重做清空本题答案与笔迹。切库/刷新可恢复作答位置。Ctrl+C 停止。记录在该题库内部的 `.qf-v2/`（git 忽略）。历史、考试、听力、AI、编辑器、安装包尚未接入。

## 题型与数据

- 题库 `formatVersion:2`，题型 `apiVersion:2`；`type` 为 id@主版本，勿与根目录旧题型混装。
- 页面按 [题型拓展开发说明](../../core/docs/reference/V2_EXTENSIONS.md) 使用 `QF.page.register/load/getAnswer/changed/submit/retry`。提交、重做、得分在题型内部显示；锁前无 solution，锁定后才显示解析。评分后更新同一页面。
- 单选 `answer:{selected:选项id或null}`、`solution:{selected:正确id,explanation:富文本}`；多选 selected 为 id 数组，顺序不影响评分，漏选/错选 0 分，完全一致得满分；判断 `answer:{value:true/false/null}`，solution.value 为布尔值。false 是已作答，null 是未作答。各题满分取自大纲。
- 富文本使用已发布 SDK 1.1.3，保留数学/表格与对应样式，图片通过宿主读取并以 ArrayBuffer/对象 URL 交给页面。题型与评分 Worker 均不能联网。
- `node core/scripts/dev/stage-v2-basic-demo.mjs` 仅从公开原展示库再生成上述 7 题和引用素材，不是通用转换器，不读取或迁移任何作答。原简化 3 题只保留为测试夹具。

进度见 [V2_PROGRESS](../../core/docs/design/V2_PROGRESS.md)，前后端接口见 [速查](../../core/docs/design/V2_API_AND_STATE.md)。
