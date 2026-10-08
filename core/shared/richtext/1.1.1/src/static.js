import { render as renderDocument } from "./render.js";
import { EMPTY_DOCUMENT, cloneDocument, validateDocument, isEmpty, fromEditorDocument, IMAGE_TYPES, FONT_FAMILIES, FONT_SIZES, LINE_HEIGHTS } from "./document.js";
const configuration = { resources: null, loadEditor: null, setExpanded: null };
let editorLoading = null, activeEditor = null;
function configure(options = {}) {
  for (const name of ["resources", "loadEditor", "setExpanded"]) if (options[name]) configuration[name] = options[name];
}
function render(container, doc, options = {}) {
  return renderDocument(container, doc, { resources: options.resources || configuration.resources });
}
function createEditor(container, options = {}) {
  if (activeEditor) throw new Error("请先结束当前富文本字段的编辑。");
  let value = cloneDocument(options.doc || EMPTY_DOCUMENT), instance = null, disposed = false, wantsFocus = false;
  const api = { getDocument: () => instance ? instance.getDocument() : cloneDocument(value), setDocument(doc) {
    value = cloneDocument(doc);
    if (instance) instance.setDocument(value);
  }, focus() {
    wantsFocus = true;
    instance?.focus();
  }, async flush() {
    await api.ready;
    if (instance) await instance.flush();
  }, isUploading: () => !!instance?.isUploading(), async setAdvanced(expanded) {
    await api.ready;
    return instance?.setAdvanced(expanded);
  }, isAdvanced: () => !!instance?.isAdvanced(), destroy() {
    disposed = true;
    instance?.destroy();
    instance = null;
    if (activeEditor === api) activeEditor = null;
  } };
  activeEditor = api;
  api.ready = Promise.resolve().then(async () => {
    if (!globalThis.QFRichText._createEditor) {
      if (!configuration.loadEditor) throw new Error("富文本编辑组件不可用。");
      editorLoading ??= Promise.resolve().then(configuration.loadEditor).catch((error) => {
        editorLoading = null;
        throw error;
      });
      await editorLoading;
    }
    if (disposed) return;
    if (!globalThis.QFRichText._createEditor) throw new Error("富文本编辑组件加载失败。");
    instance = globalThis.QFRichText._createEditor(container, { ...options, doc: value, resources: options.resources || configuration.resources, setExpanded: options.setExpanded || configuration.setExpanded, onChange: (doc) => {
      value = cloneDocument(doc);
      options.onChange?.(cloneDocument(value));
    } });
    await instance.ready;
    if (wantsFocus) instance.focus();
  }).catch((error) => {
    if (activeEditor === api) activeEditor = null;
    throw error;
  });
  return api;
}
globalThis.QFRichText = { version: "1.1.1", configure, render, createEditor, cloneDocument, validateDocument, isEmpty, fromEditorDocument, EMPTY_DOCUMENT, IMAGE_TYPES, FONT_FAMILIES, FONT_SIZES, LINE_HEIGHTS };
