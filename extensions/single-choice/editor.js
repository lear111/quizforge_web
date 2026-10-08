(function () {
  "use strict";

  const elements = {
    form: document.getElementById("question-editor"),
    fields: document.getElementById("editor-fields"),
    title: document.getElementById("edit-title"),
    stem: document.getElementById("edit-stem"),
    options: document.getElementById("edit-options"),
    count: document.getElementById("option-count"),
    add: document.getElementById("add-option"),
    correct: document.getElementById("edit-correct"),
    score: document.getElementById("edit-score"),
    explanation: document.getElementById("edit-explanation"),
    error: document.getElementById("editor-error"),
    notice: document.getElementById("editor-notice")
  };
  let loaded = false;
  let canEdit = false;
  let rows = [];
  let original = "";
  const letter = (index) => String.fromCharCode(65 + index);
  const resize = () => { if (window.QF && QF.ui && typeof QF.ui.resize === "function") QF.ui.resize(); };

  function clearError() {
    elements.error.hidden = true;
    elements.error.textContent = "";
    for (const input of [elements.title, elements.stem, elements.correct, elements.score, elements.explanation, ...rows.map((row) => row.input)]) {
      input.removeAttribute("aria-invalid");
    }
  }

  function changed() {
    clearError();
    elements.notice.textContent = "点击页面上的保存按钮后，修改才会写入题库。";
    resize();
  }

  function readDocument() {
    return {
      title: elements.title.value,
      data: {
        stem: elements.stem.value,
        options: rows.map((row) => ({ id: row.id, text: row.input.value })),
        correctOptionId: elements.correct.value,
        explanation: elements.explanation.value,
        maxScore: elements.score.value.trim() === "" ? null : Number(elements.score.value)
      }
    };
  }

  function failure(message, input) {
    elements.error.textContent = message;
    elements.error.hidden = false;
    if (input) {
      input.setAttribute("aria-invalid", "true");
      input.focus({ preventScroll: false });
    }
    resize();
    throw new Error(message);
  }

  function requireText(value, name, maximum, input) {
    if (typeof value !== "string" || !value.trim()) failure(`请填写${name}。`, input);
    if (value.length > maximum) failure(`${name}不能超过 ${maximum} 个字符。`, input);
  }

  function getDocument() {
    if (!loaded || !canEdit) failure("当前题目不能编辑。");
    clearError();
    const result = readDocument();
    requireText(result.title, "题名", 300, elements.title);
    requireText(result.data.stem, "题干", 20000, elements.stem);
    if (rows.length < 2 || rows.length > 26) failure("选项数量应为 2 至 26 个。");
    const ids = new Set();
    result.data.options.forEach((option, index) => {
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(option.id) || ids.has(option.id)) failure("选项标识无效，请重新打开本题。", rows[index].input);
      ids.add(option.id);
      requireText(option.text, `选项 ${letter(index)}`, 10000, rows[index].input);
    });
    if (!ids.has(result.data.correctOptionId)) failure("请选择一个正确答案。", elements.correct);
    requireText(result.data.explanation, "解析", 20000, elements.explanation);
    if (!Number.isFinite(result.data.maxScore) || result.data.maxScore <= 0 || result.data.maxScore > 100000) {
      failure("分值应大于 0，且不超过 100000。", elements.score);
    }
    return result;
  }

  function updateCorrectChoices(selectedId = elements.correct.value) {
    elements.correct.replaceChildren();
    rows.forEach((row, index) => {
      const option = document.createElement("option");
      option.value = row.id;
      const preview = row.input.value.trim().replace(/\s+/g, " ");
      option.textContent = `${letter(index)}. ${preview ? preview.slice(0, 50) : "（未填写）"}`;
      elements.correct.append(option);
    });
    elements.correct.value = rows.some((row) => row.id === selectedId) ? selectedId : (rows[0]?.id || "");
  }

  function updateOptionControls() {
    elements.count.textContent = `${rows.length} / 26`;
    elements.add.disabled = !canEdit || rows.length >= 26;
    rows.forEach((row, index) => {
      row.marker.textContent = letter(index);
      row.input.setAttribute("aria-label", `选项 ${letter(index)}`);
      row.remove.setAttribute("aria-label", `删除选项 ${letter(index)}`);
      row.remove.title = `删除选项 ${letter(index)}`;
      row.remove.disabled = !canEdit || rows.length <= 2;
    });
  }

  function deleteIcon() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.7");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7M14 10v7");
    svg.append(path);
    return svg;
  }

  function appendOption(option) {
    const container = document.createElement("div");
    container.className = "option-row";
    const marker = document.createElement("span");
    marker.className = "option-letter";
    marker.setAttribute("aria-hidden", "true");
    const input = document.createElement("textarea");
    input.className = "option-input";
    input.rows = 1;
    input.maxLength = 10000;
    input.required = true;
    input.value = option.text;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "delete-option";
    remove.append(deleteIcon());
    const row = { id: option.id, container, marker, input, remove };
    input.addEventListener("input", () => {
      updateCorrectChoices();
      changed();
    });
    remove.addEventListener("click", () => {
      if (!canEdit || rows.length <= 2) return;
      const selectedId = elements.correct.value;
      const index = rows.indexOf(row);
      rows.splice(index, 1);
      container.remove();
      updateCorrectChoices(selectedId);
      updateOptionControls();
      changed();
      if (selectedId === row.id) {
        elements.notice.textContent = "原正确选项已删除，请确认新的正确答案。";
        elements.correct.focus({ preventScroll: true });
      } else {
        (rows[Math.min(index, rows.length - 1)]?.input || elements.add).focus({ preventScroll: true });
      }
    });
    container.append(marker, input, remove);
    elements.options.append(container);
    rows.push(row);
    return row;
  }

  function loadContext(context) {
    const question = context && context.question;
    if (!question || !question.data) failure("题目数据尚未就绪，请重新打开编辑模式。");
    const data = question.data;
    canEdit = context.mode === "edit" && !!context.capabilities?.canEdit;
    elements.title.value = question.title || "";
    elements.stem.value = data.stem || "";
    elements.score.value = String(data.maxScore ?? "");
    elements.explanation.value = data.explanation || "";
    elements.options.replaceChildren();
    rows = [];
    (data.options || []).forEach(appendOption);
    updateCorrectChoices(data.correctOptionId);
    updateOptionControls();
    elements.fields.disabled = !canEdit;
    clearError();
    loaded = true;
    original = JSON.stringify(readDocument());
    elements.notice.textContent = canEdit ? "点击页面上的保存按钮后，修改才会写入题库。" : "当前题目不能编辑。";
    resize();
  }

  function exportDraft() {
    // Keep unfinished fields exactly as typed; exporting a draft never validates
    // the authoring form or converts an empty score into a number.
    return {formatVersion: 1, title: elements.title.value, stem: elements.stem.value,
      options: rows.map((row) => ({id: row.id, text: row.input.value})),
      correctOptionId: elements.correct.value, explanation: elements.explanation.value,
      scoreText: elements.score.value};
  }

  function importDraft(draft) {
    if (!draft || draft.formatVersion !== 1 || !Array.isArray(draft.options) || draft.options.length < 2 || draft.options.length > 26
      || ['title', 'stem', 'correctOptionId', 'explanation', 'scoreText'].some((key) => typeof draft[key] !== 'string')
      || draft.options.some((option) => !option || typeof option.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(option.id) || typeof option.text !== 'string')
      || new Set(draft.options.map((option) => option.id)).size !== draft.options.length) throw new Error('编辑草稿格式无效。');
    elements.title.value = draft.title;
    elements.stem.value = draft.stem;
    elements.score.value = draft.scoreText;
    elements.explanation.value = draft.explanation;
    elements.options.replaceChildren(); rows = [];
    draft.options.forEach(appendOption);
    updateCorrectChoices(draft.correctOptionId); updateOptionControls(); changed();
  }

  elements.form.addEventListener("submit", (event) => event.preventDefault());
  for (const input of [elements.title, elements.stem, elements.correct, elements.score, elements.explanation]) {
    input.addEventListener("input", changed);
    input.addEventListener("change", changed);
  }
  elements.add.addEventListener("click", () => {
    if (!canEdit || rows.length >= 26) return;
    const used = new Set(rows.map((row) => row.id));
    const id = Array.from({ length: 26 }, (_, index) => letter(index)).find((value) => !used.has(value));
    const selectedId = elements.correct.value;
    const row = appendOption({ id, text: "" });
    updateCorrectChoices(selectedId);
    updateOptionControls();
    changed();
    row.input.focus({ preventScroll: false });
  });

  if (window.QF && QF.editor && typeof QF.editor.register === "function") {
    QF.editor.register({ onLoad: loadContext, getDocument, hasChanges: () => loaded && JSON.stringify(readDocument()) !== original,
      exportDraft, importDraft, onFlush() {}, onDispose() {} });
  } else {
    elements.notice.textContent = "编辑接口尚未就绪，请在 QuizForge 编辑模式中打开本题。";
  }
})();
