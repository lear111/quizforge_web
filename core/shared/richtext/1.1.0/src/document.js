const EMPTY_DOCUMENT = { type: "doc", content: [{ type: "paragraph" }] };
const IMAGE_TYPES = /* @__PURE__ */ new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const FONT_FAMILIES = ["Arial", "Verdana", "Georgia", "Times New Roman", "Consolas", "Microsoft YaHei", "SimSun", "sans-serif", "serif", "monospace"];
const FONT_SIZES = ["10px", "12px", "14px", "15px", "16px", "18px", "20px", "24px", "28px", "32px", "40px", "48px"];
const LINE_HEIGHTS = ["1", "1.2", "1.5", "1.8", "2", "2.5", "3"];
const hash = /^[a-f0-9]{64}$/, color = /^#[a-fA-F0-9]{6}$/;
const blocks = /* @__PURE__ */ new Set(["paragraph", "heading", "blockquote", "bulletList", "orderedList", "codeBlock", "horizontalRule", "image", "table", "blockMath"]);
const inlines = /* @__PURE__ */ new Set(["text", "hardBreak", "inlineMath"]);
const marks = /* @__PURE__ */ new Set(["bold", "italic", "strike", "underline", "code", "link", "textStyle", "highlight", "subscript", "superscript"]);
const object = (value) => value && typeof value === "object" && !Array.isArray(value);
const keys = (value, allowed) => Object.keys(value).every((key) => allowed.includes(key));
const bounded = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
function normalizedColor(value) {
  if (typeof value !== "string") return null;
  if (color.test(value)) return value.toLowerCase();
  const rgb = value.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/);
  if (rgb && rgb.slice(1).every((component) => Number(component) <= 255)) return `#${rgb.slice(1).map((component) => Number(component).toString(16).padStart(2, "0")).join("")}`;
  return null;
}
function safeLink(value) {
  return typeof value === "string" && value.length <= 2048 && /^(https?:\/\/|mailto:)/i.test(value) && !/[\u0000-\u0020]/.test(value);
}
function validateDocument(doc, { requireContent = false } = {}) {
  let count = 0, textSize = 0, images = 0, meaningful = false;
  function layout(attrs, heading = false) {
    return keys(attrs, heading ? ["level", "textAlign", "lineHeight"] : ["textAlign", "lineHeight"]) && (attrs.textAlign === void 0 || ["left", "center", "right", "justify"].includes(attrs.textAlign)) && (attrs.lineHeight === void 0 || LINE_HEIGHTS.includes(attrs.lineHeight));
  }
  function visit(node, depth, parent) {
    if (!object(node) || depth > 32 || ++count > 5e3 || !keys(node, ["type", "attrs", "content", "text", "marks"])) return false;
    const type = node.type, attrs = node.attrs || {};
    if (typeof type !== "string" || !object(attrs)) return false;
    if (parent === "doc" && !blocks.has(type) || parent === "list" && type !== "listItem" || parent === "inline" && !inlines.has(type) || parent === "code" && type !== "text" || parent === "block" && !blocks.has(type) || parent === "table" && type !== "tableRow" || parent === "row" && !["tableCell", "tableHeader"].includes(type)) return false;
    if (type === "text") {
      if (typeof node.text !== "string" || !node.text.length || node.content || Object.keys(attrs).length || (textSize += node.text.length) > 1e5) return false;
      if (node.text.trim()) meaningful = true;
      if (node.marks !== void 0) {
        if (!Array.isArray(node.marks) || node.marks.length > 10) return false;
        const used = /* @__PURE__ */ new Set();
        for (const mark of node.marks) {
          if (!object(mark) || !keys(mark, ["type", "attrs"]) || !marks.has(mark.type) || used.has(mark.type)) return false;
          used.add(mark.type);
          const ma = mark.attrs || {};
          if (!object(ma)) return false;
          if (mark.type === "link") {
            if (!keys(ma, ["href", "title"]) || !safeLink(ma.href) || ma.title !== void 0 && (typeof ma.title !== "string" || ma.title.length > 500)) return false;
          } else if (mark.type === "textStyle") {
            if (!keys(ma, ["color", "fontFamily", "fontSize"]) || !Object.keys(ma).length || ma.color !== void 0 && !color.test(ma.color) || ma.fontFamily !== void 0 && !FONT_FAMILIES.includes(ma.fontFamily) || ma.fontSize !== void 0 && !FONT_SIZES.includes(ma.fontSize)) return false;
          } else if (mark.type === "highlight") {
            if (!keys(ma, ["color"]) || ma.color !== void 0 && !color.test(ma.color)) return false;
          } else if (Object.keys(ma).length) return false;
        }
        if (parent === "code" && node.marks.length) return false;
      }
      return true;
    }
    if (node.text !== void 0 || node.marks !== void 0) return false;
    if (type === "image") {
      if (!keys(attrs, ["assetId", "alt", "title", "width", "align"]) || !hash.test(attrs.assetId) || ++images > 40 || node.content !== void 0) return false;
      if (["alt", "title"].some((key) => attrs[key] !== void 0 && (typeof attrs[key] !== "string" || attrs[key].length > 500)) || attrs.width !== void 0 && !bounded(attrs.width, 24, 2400) || attrs.align !== void 0 && !["left", "center", "right"].includes(attrs.align)) return false;
      meaningful = true;
      return true;
    }
    if (type === "inlineMath" || type === "blockMath") {
      if (!keys(attrs, ["latex"]) || typeof attrs.latex !== "string" || !attrs.latex.trim() || attrs.latex.length > 2e3 || node.content !== void 0) return false;
      meaningful = true;
      return true;
    }
    if (type === "heading") {
      if (!layout(attrs, true) || ![1, 2, 3].includes(attrs.level)) return false;
    } else if (type === "paragraph") {
      if (!layout(attrs)) return false;
    } else if (type === "orderedList") {
      if (!keys(attrs, ["start"]) || attrs.start !== void 0 && !bounded(attrs.start, 1, 9999)) return false;
    } else if (type === "codeBlock") {
      if (!keys(attrs, ["language"]) || attrs.language !== void 0 && attrs.language !== null && (typeof attrs.language !== "string" || attrs.language.length > 40)) return false;
    } else if (type === "tableCell" || type === "tableHeader") {
      if (!keys(attrs, ["colspan", "rowspan", "colwidth"]) || attrs.colspan !== void 0 && !bounded(attrs.colspan, 1, 30) || attrs.rowspan !== void 0 && !bounded(attrs.rowspan, 1, 30) || attrs.colwidth !== void 0 && attrs.colwidth !== null && (!Array.isArray(attrs.colwidth) || attrs.colwidth.length !== (attrs.colspan || 1) || attrs.colwidth.some((width) => !bounded(width, 24, 2400)))) return false;
    } else if (Object.keys(attrs).length) return false;
    if (type === "hardBreak" || type === "horizontalRule") return node.content === void 0;
    const content = node.content || [];
    if (!Array.isArray(content)) return false;
    if (type === "doc") {
      if (depth !== 0 || !content.length) return false;
      return content.every((child) => visit(child, depth + 1, "doc"));
    }
    if (type === "paragraph" || type === "heading") return content.every((child) => visit(child, depth + 1, "inline"));
    if (type === "codeBlock") return content.every((child) => visit(child, depth + 1, "code"));
    if (type === "bulletList" || type === "orderedList") return !!content.length && content.every((child) => visit(child, depth + 1, "list"));
    if (type === "blockquote" || type === "tableCell" || type === "tableHeader") return !!content.length && content.every((child) => visit(child, depth + 1, "block"));
    if (type === "listItem") return !!content.length && content[0].type === "paragraph" && content.every((child) => visit(child, depth + 1, "block"));
    if (type === "table") return content.length > 0 && content.length <= 30 && content.every((child) => visit(child, depth + 1, "table"));
    if (type === "tableRow") return content.length > 0 && content.reduce((sum, cell) => sum + (cell.attrs?.colspan || 1), 0) <= 30 && content.every((child) => visit(child, depth + 1, "row"));
    return false;
  }
  try {
    return object(doc) && doc.type === "doc" && visit(doc, 0, null) && (!requireContent || meaningful);
  } catch {
    return false;
  }
}
function cloneDocument(doc) {
  if (!validateDocument(doc)) throw new Error("富文本内容格式无效。");
  return JSON.parse(JSON.stringify(doc));
}
const isEmpty = (doc) => !validateDocument(doc, { requireContent: true });
function fromEditorDocument(doc) {
  function copy(node) {
    const value = { type: node.type };
    if (node.text !== void 0) value.text = node.text;
    if (node.content?.length) value.content = node.content.map(copy);
    const attrs = node.attrs || {}, out = {};
    if (node.type === "image") {
      out.assetId = attrs.assetId;
      for (const key of ["alt", "title", "width", "align"]) if (attrs[key] !== void 0 && attrs[key] !== null && attrs[key] !== "") out[key] = attrs[key];
    }
    if (node.type === "heading") out.level = attrs.level;
    if (["paragraph", "heading"].includes(node.type)) {
      for (const key of ["textAlign", "lineHeight"]) if (attrs[key]) out[key] = attrs[key];
    }
    if (node.type === "orderedList" && attrs.start !== 1 && attrs.start !== void 0) out.start = attrs.start;
    if (node.type === "codeBlock" && attrs.language) out.language = attrs.language;
    if (["inlineMath", "blockMath"].includes(node.type)) out.latex = attrs.latex;
    if (["tableCell", "tableHeader"].includes(node.type)) {
      if (attrs.colspan > 1) out.colspan = attrs.colspan;
      if (attrs.rowspan > 1) out.rowspan = attrs.rowspan;
      if (attrs.colwidth) out.colwidth = attrs.colwidth;
    }
    if (Object.keys(out).length) value.attrs = out;
    if (node.marks?.length) {
      value.marks = node.marks.map((mark) => {
        const ma = mark.attrs || {}, attrs2 = {};
        if (mark.type === "link") {
          attrs2.href = ma.href;
          if (ma.title) attrs2.title = ma.title;
        } else if (mark.type === "textStyle") {
          const tint = normalizedColor(ma.color), family = typeof ma.fontFamily === "string" ? ma.fontFamily.replace(/^['"]|['"]$/g, "") : null;
          if (tint) attrs2.color = tint;
          if (FONT_FAMILIES.includes(family)) attrs2.fontFamily = family;
          if (FONT_SIZES.includes(ma.fontSize)) attrs2.fontSize = ma.fontSize;
        } else if (mark.type === "highlight") {
          const tint = normalizedColor(ma.color);
          if (tint) attrs2.color = tint;
        }
        return Object.keys(attrs2).length ? { type: mark.type, attrs: attrs2 } : { type: mark.type };
      }).filter((mark) => mark.type !== "textStyle" || mark.attrs);
      if (!value.marks.length) delete value.marks;
    }
    return value;
  }
  return cloneDocument(copy(doc));
}
export {
  EMPTY_DOCUMENT,
  FONT_FAMILIES,
  FONT_SIZES,
  IMAGE_TYPES,
  LINE_HEIGHTS,
  cloneDocument,
  fromEditorDocument,
  isEmpty,
  safeLink,
  validateDocument
};
