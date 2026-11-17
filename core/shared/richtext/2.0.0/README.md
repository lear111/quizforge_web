# quizforge.richtext@2.0.0

V2 HTML 字符串显示组件（D54）。不包含编辑器，不接收旧树形 JSON。

```js
const view = QFRichText.render(container, '<p>已知 $x^2=4$。</p>');
await view.ready;
view.destroy();
```

DOMPurify 3.4.18 按 `V2_DATA_STRUCTURES.md` 1.1 清洗标签和属性，CSSOM
仅重建那里的十种样式。图片只接收 `qf-asset:` 相对路径，由
`QF.resources.get(reference)` 取得宿主提供的资源地址；不请求远程图片。
链接只接收 http、https、mailto。资源缺失或解码失败显示“图片无法加载”。

KaTeX 0.16.43 使用 `trust:false`、MathML 输出，由浏览器原生排版，
不依赖远程字体。支持 `$…$`、`$$…$$`；普通文本的 `\$` 显示为美元符号；
`code` / `pre` 内不解析公式。非法公式局部显示错误，不中断其余内容。

`ready` 等待图片成功或失败；`destroy()` 移除本次 DOM、解绑图片事件、
结束等待并丢弃迟到资源结果。资源桥没有取消协议，已经开始的宿主读取不主动中断；
对象 URL 由宿主 iframe 的资源桥持有、销毁时释放，SDK 不撤销借用的 URL。
宿主使用的 `configure({resources})` 仅注入同一资源桥，以保留现有页面适配流程。

从仓库根目录构建与核对：

```powershell
npm --prefix core run build:richtext-html
npm --prefix core run build:richtext-html -- --check
```

构建检查锁定的依赖版本、静态 JS 与第三方许可，并打印 JS、gzip 与 CSS 字节数。
新版本独立发布；不修改旧 SDK 或 V1 的 service.json，不迁移任何用户记录。
