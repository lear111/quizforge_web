import katex from "katex";
import { cloneDocument, safeLink } from "./document.js";
const tags = { paragraph: "p", blockquote: "blockquote", bulletList: "ul", orderedList: "ol", listItem: "li", hardBreak: "br", horizontalRule: "hr", table: "table", tableRow: "tr", tableCell: "td", tableHeader: "th" };
const markTags = { bold: "strong", italic: "em", strike: "s", underline: "u", code: "code", link: "a", textStyle: "span", highlight: "mark", subscript: "sub", superscript: "sup" };
const MATH_OPTIONS = { output: "mathml", throwOnError: false, trust: false, strict: "ignore", maxExpand: 1e3 };
function renderMath(element, latex, displayMode = false) {
  element.className = displayMode ? "qfrt-math qfrt-math-block" : "qfrt-math qfrt-math-inline";
  element.dataset.latex = latex;
  try {
    katex.render(latex, element, { ...MATH_OPTIONS, displayMode });
  } catch {
    element.textContent = latex;
  }
}
function styleImage(element, attrs) {
  element.style.width = attrs.width ? `${attrs.width}px` : "";
  element.dataset.align = attrs.align || "center";
  element.style.marginLeft = attrs.align === "left" ? "0" : "auto";
  element.style.marginRight = attrs.align === "right" ? "0" : "auto";
}
function render(container, doc, { resources } = {}) {
  const value = cloneDocument(doc), root = document.createElement("div");
  root.className = "qfrt-document qfrt-readonly";
  let disposed = false;
  const pending = [];
  function node(source) {
    if (source.type === "text") {
      let current = document.createTextNode(source.text);
      for (const mark of source.marks || []) {
        const wrapper = document.createElement(markTags[mark.type]), attrs2 = mark.attrs || {};
        if (mark.type === "link" && safeLink(attrs2.href)) {
          wrapper.href = attrs2.href;
          wrapper.target = "_blank";
          wrapper.rel = "noopener noreferrer";
          if (attrs2.title) wrapper.title = attrs2.title;
        }
        if (mark.type === "textStyle") {
          if (attrs2.color) wrapper.style.color = attrs2.color;
          if (attrs2.fontFamily) wrapper.style.fontFamily = attrs2.fontFamily;
          if (attrs2.fontSize) wrapper.style.fontSize = attrs2.fontSize;
        }
        if (mark.type === "highlight") wrapper.style.backgroundColor = attrs2.color || "#fff3a3";
        wrapper.append(current);
        current = wrapper;
      }
      return current;
    }
    if (source.type === "image") {
      const image = document.createElement("img");
      image.alt = source.attrs.alt || "题目图片";
      if (source.attrs.title) image.title = source.attrs.title;
      image.dataset.assetId = source.attrs.assetId;
      image.className = "qfrt-image";
      image.loading = "lazy";
      styleImage(image, source.attrs);
      const loading = Promise.resolve().then(() => {
        if (!resources?.get) throw new Error("图片资源接口不可用");
        return resources.get(source.attrs.assetId);
      }).then((asset) => {
        if (disposed) return;
        if (!asset || typeof asset.url !== "string") throw new Error("图片资源无效");
        image.src = asset.url;
      }).catch(() => {
        if (!disposed) {
          image.alt = `${image.alt}（图片无法加载）`;
          image.classList.add("qfrt-image-missing");
        }
      });
      pending.push(loading);
      return image;
    }
    if (source.type === "inlineMath" || source.type === "blockMath") {
      const element2 = document.createElement(source.type === "inlineMath" ? "span" : "div");
      renderMath(element2, source.attrs.latex, source.type === "blockMath");
      return element2;
    }
    const tag = source.type === "heading" ? `h${source.attrs.level}` : source.type === "codeBlock" ? "pre" : tags[source.type], element = document.createElement(tag);
    let childHost = element;
    const attrs = source.attrs || {};
    if (source.type === "codeBlock") {
      childHost = document.createElement("code");
      element.append(childHost);
    }
    if (source.type === "orderedList" && attrs.start) element.start = attrs.start;
    if (attrs.textAlign) element.style.textAlign = attrs.textAlign;
    if (attrs.lineHeight) element.style.lineHeight = attrs.lineHeight;
    if (["tableCell", "tableHeader"].includes(source.type)) {
      if (attrs.colspan) element.colSpan = attrs.colspan;
      if (attrs.rowspan) element.rowSpan = attrs.rowspan;
      if (attrs.colwidth) {
        element.dataset.colwidth = attrs.colwidth.join(",");
        element.style.width = `${attrs.colwidth.reduce((sum, width) => sum + width, 0)}px`;
      }
    }
    if (source.type === "table") {
      childHost = document.createElement("tbody");
      element.append(childHost);
    }
    for (const child of source.content || []) childHost.append(node(child));
    return element;
  }
  for (const child of value.content) root.append(node(child));
  container.replaceChildren(root);
  return { ready: Promise.all(pending).then(() => void 0), destroy() {
    disposed = true;
    root.remove();
  } };
}
export {
  MATH_OPTIONS,
  render,
  renderMath,
  styleImage
};
