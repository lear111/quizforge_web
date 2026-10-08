import { Editor, Node, Extension, mergeAttributes } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { TextStyle, Color, FontFamily, FontSize } from "@tiptap/extension-text-style";
import Highlight from "@tiptap/extension-highlight";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import TextAlign from "@tiptap/extension-text-align";
import { Table, TableRow, TableCell, TableHeader } from "@tiptap/extension-table";
import { InlineMath, BlockMath } from "@tiptap/extension-mathematics";
import { cloneDocument, fromEditorDocument, IMAGE_TYPES, FONT_FAMILIES, FONT_SIZES, LINE_HEIGHTS, safeLink } from "./document.js";
import { renderMath, styleImage, MATH_OPTIONS } from "./render.js";
let current = null;
function createEditor(container, { doc, onChange, resources, setExpanded, contentWidth, placeholder = "在这里输入内容…" } = {}) {
  if (current) throw new Error("一个页面同时只能编辑一个富文本字段。");
  let disposed = false, editor, epoch = 0, expanded = false, transition = Promise.resolve(), uploadFailure = null, width = null, dialog = null;
  const uploads = /* @__PURE__ */ new Set(), buttons = [];
  const root = document.createElement("div");
  root.className = "qfrt-editor";
  const toolbar = document.createElement("div");
  toolbar.className = "qfrt-toolbar";
  toolbar.setAttribute("role", "toolbar");
  toolbar.setAttribute("aria-label", "基础富文本工具");
  const ribbon = document.createElement("div");
  ribbon.className = "qfrt-ribbon";
  ribbon.hidden = true;
  ribbon.setAttribute("role", "toolbar");
  ribbon.setAttribute("aria-label", "完整富文本工具");
  const body = document.createElement("div");
  body.className = "qfrt-body";
  const message = document.createElement("p");
  message.className = "qfrt-message";
  message.hidden = true;
  root.append(toolbar, ribbon, body, message);
  container.replaceChildren(root);
  const report = (error) => {
    if (disposed) return;
    message.textContent = error?.message || String(error);
    message.hidden = false;
  };
  const clean = () => fromEditorDocument(editor.getJSON());
  function changed() {
    try {
      const value = clean();
      message.hidden = true;
      onChange?.(value);
    } catch (error) {
      report(error);
    }
  }
  const chain = () => editor.chain().focus();
  function button(host, label, text, run, active) {
    const element = document.createElement("button");
    element.type = "button";
    element.title = label;
    element.setAttribute("aria-label", label);
    element.textContent = text;
    element.addEventListener("mousedown", (event) => event.preventDefault());
    element.addEventListener("click", () => {
      if (disposed) return;
      try {
        Promise.resolve(run()).catch(report);
      } catch (error) {
        report(error);
      }
    });
    host.append(element);
    if (active) buttons.push({ element, active });
    return element;
  }
  function group(label) {
    const host = document.createElement("div");
    host.className = "qfrt-tool-group";
    const caption = document.createElement("div");
    caption.className = "qfrt-tool-group-label";
    caption.textContent = label;
    ribbon.append(host);
    return { host, finish: () => host.append(caption) };
  }
  function select(host, label, options, run) {
    const control = document.createElement("select");
    control.title = label;
    control.setAttribute("aria-label", label);
    for (const [value, text] of options) {
      const item = document.createElement("option");
      item.value = value;
      item.textContent = text;
      control.append(item);
    }
    control.addEventListener("change", () => {
      try {
        run(control.value);
      } catch (error) {
        report(error);
      }
    });
    host.append(control);
    return control;
  }
  function colorControl(host, label, initial, run) {
    const control = document.createElement("input");
    control.type = "color";
    control.value = initial;
    control.title = label;
    control.setAttribute("aria-label", label);
    control.addEventListener("input", () => {
      try {
        run(control.value);
      } catch (error) {
        report(error);
      }
    });
    host.append(control);
    return control;
  }
  function inheritedTextColor() {
    const components = getComputedStyle(root).color.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    return components ? `#${components.slice(1).map(value => Number(value).toString(16).padStart(2,"0")).join("")}` : "#000000";
  }
  function selection() {
    return editor.state.selection.getBookmark();
  }
  function restore(bookmark) {
    if (disposed) return;
    try {
      editor.view.dispatch(editor.state.tr.setSelection(bookmark.resolve(editor.state.doc)));
    } catch {
    }
    editor.commands.focus(void 0, { scrollIntoView: false });
  }
  function requestFields(title, fields, apply) {
    dialog?.remove();
    const saved = selection();
    dialog = document.createElement("dialog");
    dialog.className = "qfrt-field-dialog";
    dialog.setAttribute("aria-label", title);
    const form = document.createElement("form"), heading = document.createElement("h3");
    heading.textContent = title;
    form.append(heading);
    const controls = {};
    for (const spec of fields) {
      const label = document.createElement("label");
      label.textContent = spec.label;
      const input2 = document.createElement(spec.multiline ? "textarea" : "input");
      if (!spec.multiline) input2.type = spec.type || "text";
      input2.value = spec.value ?? "";
      input2.required = !!spec.required;
      if (spec.min !== void 0) input2.min = spec.min;
      if (spec.max !== void 0) input2.max = spec.max;
      if (spec.maxLength) input2.maxLength = spec.maxLength;
      if (spec.multiline) input2.rows = 4;
      label.append(input2);
      form.append(label);
      controls[spec.name] = input2;
    }
    const actions = document.createElement("div");
    actions.className = "qfrt-dialog-actions";
    const cancel = document.createElement("button"), save = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "取消";
    save.type = "button";
    save.textContent = "确定";
    actions.append(cancel, save);
    form.append(actions);
    dialog.append(form);
    root.append(dialog);
    const close = () => {
      dialog?.remove();
      dialog = null;
      restore(saved);
    };
    cancel.addEventListener("click", close);
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      close();
    });
    const applyFields = (event) => {
      event?.preventDefault();
      if (!form.reportValidity()) return;
      const values = Object.fromEntries(Object.entries(controls).map(([key, input2]) => [key, input2.value]));
      try {
        restore(saved);
        apply(values);
        close();
      } catch (error) {
        report(error);
      }
    };
    // The extension iframe intentionally disallows native form submissions.
    save.addEventListener("click", applyFields);
    form.addEventListener("submit", applyFields);
    form.addEventListener("keydown", event => {
      if (event.key === "Enter" && !event.isComposing && event.target.tagName === "INPUT") applyFields(event);
    });
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    Object.values(controls)[0]?.focus();
  }
  function formula(block = false, existing) {
    const selected = editor.state.selection;
    if (!existing && selected.node?.type.name === (block ? "blockMath" : "inlineMath")) {
      existing = {node:selected.node,pos:selected.from};
    }
    requestFields(block ? "独立公式" : "行内公式", [{ name: "latex", label: "LaTeX 公式", multiline: true, value: existing?.node.attrs.latex || "", required: true, maxLength: 2e3 }], (values) => {
      if (!values.latex.trim() || values.latex.length > 2e3) throw new Error("公式须为 1 至 2000 个字符。");
      if (existing) editor.commands.command(({ tr }) => {
        tr.setNodeMarkup(existing.pos, void 0, { latex: values.latex });
        return true;
      });
      else chain().insertContent({ type: block ? "blockMath" : "inlineMath", attrs: { latex: values.latex } }).run();
    });
  }
  const mathView = (block) => ({ node, getPos }) => {
    const element = document.createElement(block ? "div" : "span");
    element.contentEditable = "false";
    element.setAttribute("role", "button");
    element.setAttribute("aria-label", "编辑公式");
    let live = true;
    const show = (value) => renderMath(element, value.attrs.latex, block);
    show(node);
    element.addEventListener("dblclick", () => {
      if (live && !disposed && typeof getPos === "function") formula(block, { node: editor.state.doc.nodeAt(getPos()), pos: getPos() });
    });
    return { dom: element, update(value) {
      if (value.type.name !== (block ? "blockMath" : "inlineMath")) return false;
      node = value;
      show(value);
      return true;
    }, destroy() {
      live = false;
    } };
  };
  const Image = Node.create({ name: "image", group: "block", atom: true, draggable: true, addAttributes() {
    return { assetId: { default: null }, alt: { default: null }, title: { default: null }, width: { default: null }, align: { default: null } };
  }, parseHTML() {
    return [{ tag: "img[data-asset-id]", getAttrs: (element) => /^[a-f0-9]{64}$/.test(element.getAttribute("data-asset-id")) ? { assetId: element.getAttribute("data-asset-id"), alt: element.getAttribute("alt"), title: element.getAttribute("title") } : false }];
  }, renderHTML({ node }) {
    return ["img", { "data-asset-id": node.attrs.assetId, alt: node.attrs.alt || "", title: node.attrs.title || "" }];
  }, addNodeView() {
    return ({ node }) => {
      const image = document.createElement("img");
      image.className = "qfrt-image";
      let live = true, version = 0;
      const load = (value) => {
        const token = ++version;
        image.dataset.assetId = value.attrs.assetId;
        image.alt = value.attrs.alt || "图片";
        styleImage(image, value.attrs);
        Promise.resolve().then(() => resources.get(value.attrs.assetId)).then((asset) => {
          if (live && !disposed && token === version) image.src = asset.url;
        }).catch(() => {
          if (live && !disposed && token === version) {
            image.removeAttribute("src");
            image.alt = "图片无法加载";
          }
        });
      };
      load(node);
      return { dom: image, update(value) {
        if (value.type.name !== "image") return false;
        load(value);
        return true;
      }, destroy() {
        live = false;
        version++;
        image.removeAttribute("src");
      } };
    };
  } });
  const LineHeight = Extension.create({ name: "qfLineHeight", addGlobalAttributes() {
    return [{ types: ["paragraph", "heading"], attributes: { lineHeight: { default: null, parseHTML: (element) => LINE_HEIGHTS.includes(element.style.lineHeight) ? element.style.lineHeight : null, renderHTML: (attrs) => attrs.lineHeight ? { style: `line-height: ${attrs.lineHeight}` } : {} } } }];
  } });
  const StableTable = Table.extend({ renderHTML({ HTMLAttributes }) {
    return ["table", mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), ["tbody", 0]];
  } });
  const cell = (Base) => Base.extend({ renderHTML({ node, HTMLAttributes }) {
    const attrs = mergeAttributes(this.options.HTMLAttributes, HTMLAttributes);
    delete attrs.align;
    if (node.attrs.colwidth) {
      attrs["data-colwidth"] = node.attrs.colwidth.join(",");
      attrs.style = `width: ${node.attrs.colwidth.reduce((sum, value) => sum + value, 0)}px`;
      delete attrs.colwidth;
    }
    return [this.name === "tableHeader" ? "th" : "td", attrs, 0];
  } });
  const basic = [["粗体", "B", "bold", () => chain().toggleBold().run()], ["斜体", "I", "italic", () => chain().toggleItalic().run()], ["下划线", "U", "underline", () => chain().toggleUnderline().run()], ["无序列表", "• ≡", "bulletList", () => chain().toggleBulletList().run()], ["有序列表", "1 ≡", "orderedList", () => chain().toggleOrderedList().run()]];
  for (const [label, text, name, run] of basic) button(toolbar, label, text, run, () => editor.isActive(name));
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/png,image/jpeg,image/webp,image/gif";
  input.hidden = true;
  root.append(input);
  const imageButtons = [button(toolbar, "插入图片", "▧", () => input.click())];
  button(toolbar, "撤销", "↶", () => chain().undo().run());
  button(toolbar, "重做", "↷", () => chain().redo().run());
  const hint = document.createElement("span");
  hint.className = "qfrt-width-hint";
  hint.hidden = true;
  toolbar.append(hint);
  const advancedButton = button(toolbar, "展开高级编辑", "⛶", () => api.setAdvanced(!expanded));
  advancedButton.className = "qfrt-advanced-toggle";
  advancedButton.setAttribute("aria-expanded", "false");
  const textGroup = group("字体与样式");
  select(textGroup.host, "字体", [["", "默认字体"], ...FONT_FAMILIES.map((value) => [value, value])], (value) => value ? chain().setFontFamily(value).run() : chain().unsetFontFamily().run());
  select(textGroup.host, "字号", [["", "默认字号"], ...FONT_SIZES.map((value) => [value, value.replace("px", "")])], (value) => value ? chain().setFontSize(value).run() : chain().unsetFontSize().run());
  for (const [label, text, name, run] of [...basic.slice(0, 3), ["删除线", "S̶", "strike", () => chain().toggleStrike().run()], ["下标", "x₂", "subscript", () => chain().toggleSubscript().run()], ["上标", "x²", "superscript", () => chain().toggleSuperscript().run()], ["行内代码", "‹/›", "code", () => chain().toggleCode().run()]]) button(textGroup.host, label, text, run, () => editor.isActive(name));
  const textColor = colorControl(textGroup.host, "文字颜色", inheritedTextColor(), (value) => chain().setColor(value).run());
  button(textGroup.host, "恢复文字颜色", "A↺", () => { chain().unsetColor().run(); textColor.value = inheritedTextColor(); });
  colorControl(textGroup.host, "高亮颜色", "#fff3a3", (value) => chain().setHighlight({ color: value }).run());
  button(textGroup.host, "取消高亮", "▱", () => chain().unsetHighlight().run());
  button(textGroup.host, "清除格式", "Tx", () => { chain().unsetAllMarks().resetAttributes("paragraph", ["textAlign","lineHeight"]).resetAttributes("heading", ["textAlign","lineHeight"]).clearNodes().run(); textColor.value = inheritedTextColor(); });
  textGroup.finish();
  const paragraph = group("段落");
  select(paragraph.host, "段落样式", [["p", "正文"], ["1", "标题 1"], ["2", "标题 2"], ["3", "标题 3"]], (value) => value === "p" ? chain().setParagraph().run() : chain().setHeading({ level: Number(value) }).run());
  for (const [value, text] of [["left", "≡←"], ["center", "≡"], ["right", "→≡"], ["justify", "☰"]]) button(paragraph.host, `${{ left: "左", center: "居中", right: "右", justify: "两端" }[value]}对齐`, text, () => chain().setTextAlign(value).run(), () => editor.isActive({ textAlign: value }));
  select(paragraph.host, "行距", [["", "默认行距"], ...LINE_HEIGHTS.map((value) => [value, `${value} 倍`])], (value) => chain().updateAttributes("paragraph", { lineHeight: value || null }).updateAttributes("heading", { lineHeight: value || null }).run());
  for (const [label, text, name, run] of [basic[3], basic[4], ["引用", "❞", "blockquote", () => chain().toggleBlockquote().run()], ["代码块", "</>", "codeBlock", () => chain().toggleCodeBlock().run()]]) button(paragraph.host, label, text, run, () => editor.isActive(name));
  button(paragraph.host, "增加列表层级", "⇥", () => chain().sinkListItem("listItem").run());
  button(paragraph.host, "减少列表层级", "⇤", () => chain().liftListItem("listItem").run());
  paragraph.finish();
  const inserts = group("插入");
  imageButtons.push(button(inserts.host, "插入图片", "▧ 图片", () => input.click()));
  button(inserts.host, "设置选中图片尺寸", "↔ 尺寸", () => {
    if (!editor.isActive("image")) throw new Error("请先点击选中图片。");
    const attrs = editor.getAttributes("image");
    requestFields("图片宽度", [{ name: "width", label: "宽度（像素，24 至 2400；留空恢复原大小）", type: "number", min: 24, max: 2400, value: attrs.width || "" }], (values) => {
      const value = values.width === "" ? null : Number(values.width);
      if (value !== null && (!Number.isInteger(value) || value < 24 || value > 2400)) throw new Error("图片宽度范围为 24 至 2400。");
      chain().updateAttributes("image", { width: value }).run();
    });
  });
  for (const [value, text] of [["left", "←▧"], ["center", "▧"], ["right", "▧→"]]) button(inserts.host, `图片${{ left: "居左", center: "居中", right: "居右" }[value]}`, text, () => {
    if (!editor.isActive("image")) throw new Error("请先点击选中图片。");
    chain().updateAttributes("image", { align: value }).run();
  });
  button(inserts.host, "插入或修改链接", "↗ 链接", () => requestFields("链接", [{ name: "href", label: "网址（https、http 或 mailto）", value: editor.getAttributes("link").href || "", required: true, maxLength: 2048 }], (values) => {
    if (!safeLink(values.href)) throw new Error("链接格式无效。");
    chain().extendMarkRange("link").setLink({ href: values.href }).run();
  }));
  button(inserts.host, "移除链接", "⌁", () => chain().unsetLink().run());
  button(inserts.host, "行内公式", "ƒx", () => formula(false));
  button(inserts.host, "独立公式", "∑", () => formula(true));
  button(inserts.host, "分割线", "―", () => chain().setHorizontalRule().run());
  inserts.finish();
  const tables = group("表格");
  button(tables.host, "插入表格", "▦ 表格", () => requestFields("插入表格", [{ name: "rows", label: "行数（1 至 30）", type: "number", min: 1, max: 30, value: 3, required: true }, { name: "cols", label: "列数（1 至 30）", type: "number", min: 1, max: 30, value: 3, required: true }], (values) => {
    const rows = Number(values.rows), cols = Number(values.cols);
    if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows < 1 || rows > 30 || cols < 1 || cols > 30) throw new Error("表格行列范围为 1 至 30。");
    chain().insertTable({ rows, cols, withHeaderRow: true }).run();
  }));
  function tableCommand(command) {
    const position = editor.state.selection.$from;
    let table = null;
    for (let depth = position.depth; depth > 0; depth--) {
      if (position.node(depth).type.name === "table") {
        table = position.node(depth);
        break;
      }
    }
    if (!table) throw new Error("请先把光标放在表格单元格中。");
    if (command.startsWith("addRow") && table.childCount >= 30) throw new Error("表格最多支持 30 行。");
    if (command.startsWith("addColumn")) {
      let columns = 0;
      table.child(0).forEach((cell2) => columns += cell2.attrs.colspan || 1);
      if (columns >= 30) throw new Error("表格最多支持 30 列。");
    }
    chain()[command]().run();
  }
  for (const [label, text, command] of [["上方插入行", "行↑+", "addRowBefore"], ["下方插入行", "行↓+", "addRowAfter"], ["删除行", "行−", "deleteRow"], ["左侧插入列", "列←+", "addColumnBefore"], ["右侧插入列", "列→+", "addColumnAfter"], ["删除列", "列−", "deleteColumn"], ["合并单元格", "合并", "mergeCells"], ["拆分单元格", "拆分", "splitCell"], ["切换表头行", "表头", "toggleHeaderRow"], ["删除表格", "▦×", "deleteTable"]]) button(tables.host, label, text, () => tableCommand(command));
  tables.finish();
  const edits = group("编辑");
  button(edits.host, "撤销", "↶ 撤销", () => chain().undo().run());
  button(edits.host, "重做", "↷ 重做", () => chain().redo().run());
  button(edits.host, "全选", "全选", () => chain().selectAll().run());
  edits.finish();
  function upload(file) {
    if (!IMAGE_TYPES.has(file?.type) || file.size <= 0 || file.size > 4 * 1024 * 1024) {
      report(new Error("请选择不超过 4 MiB 的 PNG、JPEG、WebP 或 GIF 图片。"));
      return Promise.resolve();
    }
    if (!resources?.put) {
      report(new Error("图片上传接口不可用。"));
      return Promise.resolve();
    }
    const token = epoch;
    for (const button2 of imageButtons) button2.disabled = true;
    message.textContent = "正在保存图片…";
    message.hidden = false;
    const pending = Promise.resolve().then(() => resources.put(file)).then((asset) => {
      if (disposed || token !== epoch) return;
      if (!/^[a-f0-9]{64}$/.test(asset?.id)) throw new Error("图片资源标识无效。");
      chain().insertContent({ type: "image", attrs: { assetId: asset.id, alt: (file.name || "图片").slice(0, 500) } }).run();
      uploadFailure = null;
      message.hidden = true;
    }).catch((error) => {
      if (disposed || token !== epoch) return;
      uploadFailure = error;
      report(error);
    }).finally(() => {
      uploads.delete(pending);
      if (!disposed) for (const button2 of imageButtons) button2.disabled = uploads.size > 0;
    });
    uploads.add(pending);
    return pending;
  }
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    input.value = "";
    if (file) upload(file);
  });
  const capture = (event, files) => {
    const file = [...files].find((value) => value.type.startsWith("image/"));
    if (!file) return false;
    event.preventDefault();
    upload(file);
    return true;
  };
  function updateButtons() {
    for (const { element, active } of buttons) element.setAttribute("aria-pressed", String(active()));
  }
  try {
    editor = new Editor({ element: body, extensions: [StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: { openOnClick: false, autolink: false, protocols: ["http", "https", "mailto"] }, trailingNode: false }), Placeholder.configure({ placeholder }), TextStyle, Color, FontFamily, FontSize, Highlight.configure({ multicolor: true }), Subscript, Superscript, TextAlign.configure({ types: ["heading", "paragraph"], defaultAlignment: null }), LineHeight, StableTable.configure({ resizable: false, renderWrapper: false }), TableRow, cell(TableCell), cell(TableHeader), InlineMath.extend({ addNodeView() {
      return mathView(false);
    } }).configure({ katexOptions: MATH_OPTIONS }), BlockMath.extend({ addNodeView() {
      return mathView(true);
    } }).configure({ katexOptions: MATH_OPTIONS }), Image], content: cloneDocument(doc), onUpdate() {
      changed();
      updateButtons();
    }, onSelectionUpdate: updateButtons, editorProps: { attributes: { class: "qfrt-document", role: "textbox", "aria-multiline": "true", "aria-label": placeholder }, handlePaste(_view, event) {
      return capture(event, event.clipboardData?.files || []);
    }, handleDrop(_view, event) {
      return capture(event, event.dataTransfer?.files || []);
    } } });
  } catch (error) {
    root.remove();
    throw error;
  }
  const api = { getDocument: clean, setDocument(value) {
    epoch++;
    uploadFailure = null;
    editor.commands.setContent(cloneDocument(value), { emitUpdate: false, errorOnInvalidContent: true });
    updateButtons();
  }, focus() {
    editor.commands.focus();
  }, isUploading: () => uploads.size > 0, isAdvanced: () => expanded, async flush() {
    while (uploads.size) await Promise.all([...uploads]);
    if (uploadFailure) throw uploadFailure;
    clean();
  }, setAdvanced(value) {
    const requested = !!value;
    transition = transition.catch(() => {
    }).then(async () => {
      if (disposed || requested === expanded) return;
      await api.flush();
      const bookmark = selection(), dom = editor.view.dom, style = getComputedStyle(dom);
      if (requested) {
        const measured = dom.getBoundingClientRect().width - parseFloat(style.paddingLeft || 0) - parseFloat(style.paddingRight || 0);
        width = Number.isFinite(contentWidth) && contentWidth > 0 ? contentWidth : measured > 0 ? measured : 640;
      }
      advancedButton.disabled = true;
      try {
        await setExpanded?.({ expanded: requested, contentWidth: width });
        if (disposed) {
          if (requested) await setExpanded?.({ expanded: false, contentWidth: width });
          return;
        }
        expanded = requested;
        root.classList.toggle("qfrt-advanced", expanded);
        ribbon.hidden = !expanded;
        hint.hidden = !expanded;
        hint.textContent = `正文宽度 ${Math.round(width)}px · 与练习一致`;
        dom.style.width = expanded ? `${width + parseFloat(style.paddingLeft || 0) + parseFloat(style.paddingRight || 0)}px` : "";
        advancedButton.textContent = expanded ? "↙ 返回" : "⛶";
        advancedButton.title = expanded ? "返回基础编辑" : "展开高级编辑";
        advancedButton.setAttribute("aria-label", advancedButton.title);
        advancedButton.setAttribute("aria-expanded", String(expanded));
        restore(bookmark);
      } finally {
        if (!disposed) advancedButton.disabled = false;
      }
    });
    return transition;
  }, ready: Promise.resolve(), destroy() {
    if (disposed) return;
    const wasExpanded = expanded;
    disposed = true;
    epoch++;
    dialog?.remove();
    dialog = null;
    editor.destroy();
    root.remove();
    if (current === api) current = null;
    if (wasExpanded) Promise.resolve().then(() => setExpanded?.({ expanded: false, contentWidth: width })).catch(() => {
    });
  } };
  current = api;
  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && expanded && !dialog) {
      event.preventDefault();
      api.setAdvanced(false).catch(report);
    }
  });
  updateButtons();
  return api;
}
if (!globalThis.QFRichText) throw new Error("Load the QuizForge rich-text renderer before the editor.");
globalThis.QFRichText._createEditor = createEditor;
