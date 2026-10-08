# QuizForge 富文本 1.0.0

本地公共依赖 `quizforge.richtext@1.0.0`。静态渲染包 `richtext.js` 不载入 Tiptap；首次 `createEditor` 通过 host 提供的 `loadEditor` 载入 `richtext-editor.js`。同一页面最多一个完整编辑实例，编辑其他字段前应 `flush()`、读取文档、`destroy()`。撤销栈仅在当前编辑实例内保留。

```js
QFRichText.configure({resources: QF.resources, loadEditor: async () => {/* host 注入重包 */}});
const view = QFRichText.render(container, contentDoc, {resources});
const editor = QFRichText.createEditor(container, {doc: contentDoc, resources, onChange(doc) {}, placeholder: '写下答案…'});
await editor.ready;
await editor.flush(); // 等待图片上传；失败时拒绝，调用者应保留当前输入。
const savedDoc = editor.getDocument();
editor.destroy();
view.destroy();
```

`render` 返回 `{ready,destroy}`；`createEditor` 返回 `{ready,getDocument,setDocument,focus,flush,isUploading,destroy}`。`ready` 和 `flush` 都是 Promise。另有 `validateDocument(doc,{requireContent:false})`、`cloneDocument(doc)`、`isEmpty(doc)`。host 提供 `QF.content` 包装并自动注入资源接口。

内容为 Tiptap JSON，根节点 `type: "doc"`。支持段落、三级标题、引用、无序／有序列表、代码块、换行、分割线、图片，以及粗体、斜体、下划线、删除线、行内代码、HTTP(S)／mailto 链接。节点数最多 5000，层级最多 32，总文字最多 100000 字，图片最多 40 张。外层题目／答案对象带 `formatVersion: 1`。

图片只保存 `attrs.assetId`（小写 SHA-256）及可选 `alt/title`，不保存 URL、base64 或 `src`。`resources.get(id)` 返回 `{url,mime,size}`；`resources.put(file)` 返回 `{id,mime,size}`。仅允许不超过 4 MiB 的 PNG/JPEG/WebP/GIF。静态组件和编辑 NodeView 各自取消销毁后的异步 DOM 写入；blob URL 的创建与回收归资源 host 管理。

运行 `npm run build:richtext` 生成三个本地包（静态、重编辑、简答规则），无需 CDN。运行 `node scripts/create-short-answer-demo.mjs` 重建代码绘制的演示 PNG、JSON 样例和 schema；不会修改 `.state`。

编辑组件采用官方 Tiptap 3.31.4 与 ProseMirror，依据 [Vanilla JavaScript 安装文档](https://tiptap.dev/docs/editor/getting-started/install/vanilla-javascript)及 [Node API](https://tiptap.dev/docs/editor/extensions/custom-extensions/create-new/node)。依赖和版本锁在项目 package-lock.json，产物内保留第三方许可注释。
