# V2 一次性格式整理：完整长度警告清单

本表为 `chore/v2-format-once` 的 ESLint 实际输出，共 49 条，0 条错误。仅记录，不在本 PR 拆函数、重命名或改逻辑。行数跳过空行和注释；普通文件 300 行、Vue 文件 150 行、函数 50 行；测试不计这两项。行号对应整理后的源码。

| 文件 | 行:列 | 规则 | 文件 / 函数与长度 |
|---|---|---|---|
| core/frontend/src/v2/App.vue | 153:1 | max-lines | File has too many lines (370). Maximum allowed is 150. |
| core/frontend/src/v2/completion.ts | 7:8 | max-lines-per-function | Function 'createCompletionGrader' has too many lines (101). Maximum allowed is 50. |
| core/frontend/src/v2/completion.ts | 26:5 | max-lines-per-function | Async method 'run' has too many lines (80). Maximum allowed is 50. |
| core/frontend/src/v2/grading.ts | 92:1 | max-lines-per-function | Function 'createEnvironment' has too many lines (107). Maximum allowed is 50. |
| core/frontend/src/v2/grading.ts | 203:8 | max-lines-per-function | Function 'createGradingService' has too many lines (99). Maximum allowed is 50. |
| core/frontend/src/v2/grading.ts | 218:5 | max-lines-per-function | Method 'grade' has too many lines (71). Maximum allowed is 50. |
| core/frontend/src/v2/grading.ts | 229:12 | max-lines-per-function | Arrow function has too many lines (56). Maximum allowed is 50. |
| core/frontend/src/v2/grading.ts | 230:50 | max-lines-per-function | Arrow function has too many lines (55). Maximum allowed is 50. |
| core/frontend/src/v2/page.ts | 38:8 | max-lines-per-function | Function 'mountQuestionPage' has too many lines (292). Maximum allowed is 50. |
| core/frontend/src/v2/page.ts | 157:41 | max-lines-per-function | Arrow function has too many lines (99). Maximum allowed is 50. |
| core/frontend/src/v2/page.ts | 304:1 | max-lines | File has too many lines (328). Maximum allowed is 300. |
| core/frontend/src/v2/save-policy.ts | 43:8 | max-lines-per-function | Function 'createSaveController' has too many lines (113). Maximum allowed is 50. |
| core/frontend/src/v2/save-policy.ts | 70:3 | max-lines-per-function | Function 'flush' has too many lines (63). Maximum allowed is 50. |
| core/frontend/src/v2/source-cache.ts | 9:8 | max-lines-per-function | Function 'createPageSourceCache' has too many lines (94). Maximum allowed is 50. |
| core/frontend/src/v2/source-cache.ts | 36:5 | max-lines-per-function | Method 'load' has too many lines (61). Maximum allowed is 50. |
| core/frontend/src/v2/use-practice-page.ts | 19:8 | max-lines-per-function | Function 'usePracticePage' has too many lines (782). Maximum allowed is 50. |
| core/frontend/src/v2/use-practice-page.ts | 174:3 | max-lines-per-function | Async function 'reloadAfterConflict' has too many lines (95). Maximum allowed is 50. |
| core/frontend/src/v2/use-practice-page.ts | 269:3 | max-lines-per-function | Async function 'show' has too many lines (189). Maximum allowed is 50. |
| core/frontend/src/v2/use-practice-page.ts | 303:1 | max-lines | File has too many lines (799). Maximum allowed is 300. |
| core/frontend/src/v2/use-practice-page.ts | 348:7 | max-lines-per-function | Method 'prepare' has too many lines (77). Maximum allowed is 50. |
| core/frontend/src/v2/whiteboard.ts | 7:8 | max-lines-per-function | Function 'mountScratch' has too many lines (73). Maximum allowed is 50. |
| core/scripts/dev/measure-v2-bank-return.mjs | 96:34 | max-lines-per-function | Async arrow function has too many lines (91). Maximum allowed is 50. |
| core/scripts/dev/measure-v2-bank-return.mjs | 305:1 | max-lines | File has too many lines (305). Maximum allowed is 300. |
| core/scripts/dev/measure-v2-overview.mjs | 32:1 | max-lines-per-function | Async function 'countFiles' has too many lines (58). Maximum allowed is 50. |
| core/scripts/dev/probe-v2-grading.mjs | 67:55 | max-lines-per-function | Async arrow function has too many lines (137). Maximum allowed is 50. |
| core/scripts/dev/probe-v2-page-contract.mjs | 303:1 | max-lines | File has too many lines (315). Maximum allowed is 300. |
| core/scripts/dev/probe-v2-page-review.mjs | 50:1 | max-lines-per-function | Function 'instrument' has too many lines (76). Maximum allowed is 50. |
| core/scripts/dev/probe-v2-page.mjs | 309:1 | max-lines | File has too many lines (335). Maximum allowed is 300. |
| core/scripts/dev/probe-v2-practice.mjs | 30:1 | max-lines-per-function | Async function 'probeNetwork' has too many lines (102). Maximum allowed is 50. |
| core/scripts/dev/probe-v2-practice.mjs | 312:1 | max-lines | File has too many lines (427). Maximum allowed is 300. |
| core/scripts/dev/stage-v2-basic-demo.mjs | 6:8 | max-lines-per-function | Function 'basicDemo' has too many lines (62). Maximum allowed is 50. |
| core/scripts/dev/v2-bank-return-probe-bundle.mjs | 13:8 | max-lines-per-function | Async function 'buildPhaseUi' has too many lines (80). Maximum allowed is 50. |
| core/scripts/dev/v2-bank-return-probe-bundle.mjs | 23:9 | max-lines-per-function | Method 'transform' has too many lines (59). Maximum allowed is 50. |
| core/server/host/v2/bank-reader.js | 14:8 | max-lines-per-function | Function 'readBank' has too many lines (155). Maximum allowed is 50. |
| core/server/host/v2/server.js | 39:3 | max-lines-per-function | Constructor has too many lines (51). Maximum allowed is 50. |
| core/server/host/v2/server.js | 250:3 | max-lines-per-function | Async method 'handleRequest' has too many lines (188). Maximum allowed is 50. |
| core/server/host/v2/server.js | 306:1 | max-lines | File has too many lines (434). Maximum allowed is 300. |
| core/server/host/v2/snapshots.js | 121:3 | max-lines-per-function | Method 'open' has too many lines (161). Maximum allowed is 50. |
| core/server/host/v2/snapshots.js | 232:43 | max-lines-per-function | Arrow function has too many lines (52). Maximum allowed is 50. |
| core/server/host/v2/snapshots.js | 306:1 | max-lines | File has too many lines (513). Maximum allowed is 300. |
| core/server/host/v2/state.js | 152:3 | max-lines-per-function | Method 'load' has too many lines (76). Maximum allowed is 50. |
| core/server/host/v2/state.js | 314:1 | max-lines | File has too many lines (566). Maximum allowed is 300. |
| core/server/host/v2/state.js | 321:3 | max-lines-per-function | Method 'finish' has too many lines (57). Maximum allowed is 50. |
| core/server/host/v2/state.js | 380:3 | max-lines-per-function | Method 'results' has too many lines (74). Maximum allowed is 50. |
| core/server/host/v2/state.js | 456:3 | max-lines-per-function | Method 'apply' has too many lines (94). Maximum allowed is 50. |
| core/server/host/v2/type-registry.js | 36:3 | max-lines-per-function | Method 'resolve' has too many lines (90). Maximum allowed is 50. |
| examples/v2/extensions/基础题型/判断题/practice.js | 2:3 | max-lines-per-function | Async method 'load' has too many lines (57). Maximum allowed is 50. |
| examples/v2/extensions/基础题型/单选题/practice.js | 2:3 | max-lines-per-function | Async method 'load' has too many lines (60). Maximum allowed is 50. |
| examples/v2/extensions/基础题型/多选题/practice.js | 2:3 | max-lines-per-function | Async method 'load' has too many lines (61). Maximum allowed is 50. |

来源：`npm --prefix core run lint`；配置及本清单随整理 PR 提交，后续可读性任务逐项处理，不将本次警告改成错误。
