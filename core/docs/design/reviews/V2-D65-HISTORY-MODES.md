# D65：历史回看的作答态与草稿态

## 原因与改动

依据 [D65](../V2_ARCHITECTURE.md) 和[工作流程](../V2_WORKFLOW.md)，修复历史标志强制开启固定坐标白板的问题。历史默认与普通练习一样居中显示题卡并隐藏区外草稿；只有顶部「草稿」开启后才显示和编辑历史笔迹，「返回作答」恢复居中布局。

| 文件 | 改动 |
|---|---|
| `core/frontend/src/v2/services/whiteboard.ts` | 布局、白板模式和 `v2-drafting` 仅取决于草稿开关；保留历史作答态的白板只读约束 |
| `core/frontend/src/v2/views/PracticePage.css` | 移除旧的历史工具条隐藏规则，显隐统一沿用白板已有 practice/draft 模式 |
| `core/test/v2/whiteboard-mode.test.mjs` | 新增两个适配层回归：模式切换、相机不影响作答布局、切题保留模式、切换不改写笔迹 |
| `core/scripts/dev/probe-v2-history-checks.mjs` | 历史默认检查改为居中且隐藏画布；作答态和草稿态均验证题型写操作被拒绝 |
| `core/scripts/dev/probe-v2-history-layout.mjs` | 桌面/手机的布局、画布像素、工具可用性、切题与返回原练习模式检查 |
| `core/scripts/dev/probe-v2-history-ink.mjs` | 保存后切回作答再进草稿、刷新后恢复笔迹；保留全部保存失败、同请求重试、冲突、切题和退出前 flush 断言 |

未修改后端、API、历史存储、归档/删除事务、评分、题型协议或历史答案只读权限。仅切换宿主区外白板模式，不隐藏题型 iframe 内的正式答案。原历史默认显示画布的断言按 D65 改为默认隐藏；原像素绘制检查移至草稿态，未删除。

## 验证

- 新增的两个适配测试在未修复代码上均失败（期望 `practice`，实际 `draft`），修复后通过；隔离 V1 白板边界，实际测试 V2 适配代码。完整 V2 单元测试 **365 通过、0 失败**。
- 真实 Chromium 的完成练习/归档/历史探针通过：1440×900 和 390×844；题卡居中误差不超过 1px；默认隐藏画布和工具；草稿态显示已有笔迹且可新增；两个模式切题均保留模式；返回作答后再次进入保留笔迹。
- 探针断言历史 `state.json`、当前 `practice/state.json` 和整个 `practice/` 字节不变；请求只写指定历史题目的 `ink`，没有题型作答、提交、重做或评分请求。
- 前后端类型检查、ESLint **0 错误/0 警告**、格式检查 **0 差异**、UI 构建与 `--check` 通过；性能 **2 通过、0 失败**。
- 本机 Windows、Node 24.13.0、Chrome 157.0.8103.39，全部 **11 项浏览器探针通过、0 失败**：page、page-contract、grading、page-review、practice、save-recovery、whiteboard、basic-types、completion（含历史）、router、exam。全部使用隔离合成题库和临时回环服务，未访问真实作答。跨平台 CI 结果随 PR 同步。

## 边界与遗留

历史打开和刷新默认作答态；同一宿主会话返回当前练习，恢复进入历史前的作答/草稿状态（桌面测试作答态，手机测试草稿态）。浏览器刷新后宿主内存重建，按原行为重新打开当前练习，不新增跨刷新视图模式持久化。浏览器覆盖为 Chromium 手机尺寸，未替代真实手机验收。未新增已知产品问题；正式设计文档中的旧 J 默认显示表述由 D65 覆盖，本 PR 不改写设计。
