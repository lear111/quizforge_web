# V2 单选题演示

此处是可公开的独立演示数据，不是原题库的迁移副本。题库文件为 `formatVersion:2`，题型声明为 `apiVersion:2`。请勿与根目录旧题型混装，同 id/主版本存在多个匹配时会报歧义错误。

在仓库根目录双击“启动 V2 单选题演示.cmd”，或执行：

```powershell
node core/server/v2-main.mjs --root examples/v2 --port 8794
```

打开 `http://127.0.0.1:8794/`，展开“基础题型”，选择展示库。提交后显示分数和解析；再次打开会恢复已提交状态。用 Ctrl+C 停止。作答仅保存在本目录的 `.qf-v2/state/`（git 忽略）。本段没有自动保存、白板、重做、历史或考试；原 V1 题库、记录与设置均不读取或迁移。

## 本段题型约定

- manifest 的 `entries.practice` 分别指定 html/js/css，`entries.grade` 指定评分脚本；`type` 按 id + 主版本匹配。
- 页面入口调用 `QF.page.register({load(context), getAnswer()})`。load 可返回 Promise，完成后宿主才允许读取答案；getAnswer 返回可 JSON 保存的作答值。
- context 字段：`mode:'practice'`、`question`、`item`、`answer`、`locked`、`solution`、`result`。锁前 solution/result 为 null。页面只渲染和收集答案；宿主按钮负责提交和评分。切题创建新页面，不复用题目状态。
- 本例复用富文本 SDK 1.0.0 的 `QFRichText.render`，内容格式仍为文档对象；没有将题目内容作为 HTML 字符串插入。
- 评分入口调用 `QF.grader.register({grade(question, solution, answer, item)})`，只能在浏览器隔离 Worker 中执行。本例返回 `{status:'graded', score, feedback}`，满分取自 item.maxScore。后端只检查结果的结构与分数，不运行该脚本。
- 页面与评分环境都没有宿主同源权限、存储或网络访问。后端先写入并锁定答案，才返回 solution；宿主之后才能把它送入评分环境。评分中断后已提交答案保持锁定，重开题库会自动补评；页面也保留继续评分入口。

完整设计和当前边界见 [总体设计](../../core/docs/design/V2_ARCHITECTURE.md)、[接口速查](../../core/docs/design/V2_API_AND_STATE.md) 与 [本次审查记录](../../core/docs/design/reviews/V2-SEG1-PRACTICE.md)。
