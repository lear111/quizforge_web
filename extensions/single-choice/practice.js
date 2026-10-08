(function () {
  "use strict";

  const elements = {
    title: document.getElementById("question-title"),
    modeHint: document.getElementById("mode-hint"),
    scoreHint: document.getElementById("score-hint"),
    stem: document.getElementById("stem"),
    fieldset: document.getElementById("option-fieldset"),
    options: document.getElementById("option-list"),
    result: document.getElementById("result-panel"),
    score: document.getElementById("result-score"),
    feedback: document.getElementById("result-feedback"),
    reference: document.getElementById("reference-answer"),
    explanation: document.getElementById("explanation"),
    progress: document.getElementById("progress-label"),
    notice: document.getElementById("save-notice"),
    submit: document.getElementById("submit-button"),
    retry: document.getElementById("retry-button")
  };

  let context = null;
  let questionId = null;
  let selectedOptionId = null;
  let selectionVersion = 0;
  let acknowledgedVersion = 0;
  let pendingDrafts = 0;
  let busyAction = null;
  let notice = "选择后自动保存，提交后可查看解析。";
  let noticeIsError = false;
  let renderedOptions = [];

  const letter = (index) => String.fromCharCode(65 + index);
  const answerFrom = (value) => value && typeof value.selectedOptionId === "string" ? value.selectedOptionId : null;
  const submitted = () => !!context && context.status === "submitted";
  const capabilities = () => context && context.capabilities ? context.capabilities : {};

  function setNotice(message, error) {
    notice = message;
    noticeIsError = !!error;
    updateControls();
  }

  function updateControls() {
    const locked = submitted();
    const caps = capabilities();
    elements.fieldset.disabled = !context || locked || !!busyAction || (!caps.canSave && !caps.canSubmit);
    for (const item of renderedOptions) {
      item.radio.checked = item.id === selectedOptionId;
      item.row.classList.toggle("is-selected", item.radio.checked);
    }
    elements.submit.hidden = locked;
    elements.submit.disabled = !context || !selectedOptionId || !caps.canSubmit || !!busyAction || pendingDrafts > 0;
    elements.submit.textContent = busyAction === "submit" ? "正在提交…" : "提交答案";
    elements.retry.hidden = !locked;
    elements.retry.disabled = !caps.canRetry || !!busyAction;
    elements.retry.textContent = busyAction === "retry" ? "正在准备…" : "再答一次";
    elements.progress.textContent = locked ? "已提交 · 可查看解析" : selectedOptionId ? "已选答案 · 尚未提交" : "待作答";
    elements.notice.textContent = pendingDrafts > 0 && !noticeIsError ? "正在保存选择…" : notice;
    elements.notice.classList.toggle("is-error", noticeIsError);
    if (window.QF && QF.ui && typeof QF.ui.resize === "function") QF.ui.resize();
  }

  function buildOptions(data) {
    elements.options.replaceChildren();
    renderedOptions = [];
    (data.options || []).forEach((option, index) => {
      const row = document.createElement("label");
      row.className = "option";
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "single-choice-answer";
      radio.value = option.id;
      const marker = document.createElement("span");
      marker.className = "option-letter";
      marker.textContent = letter(index);
      marker.setAttribute("aria-hidden", "true");
      const text = document.createElement("span");
      text.className = "option-text";
      text.textContent = option.text;
      row.append(radio, marker, text);
      radio.addEventListener("change", () => {
        if (radio.checked) choose(option.id);
      });
      elements.options.append(row);
      renderedOptions.push({ id: option.id, text: option.text, row, radio });
    });
  }

  function renderResult(data) {
    elements.result.hidden = !submitted();
    if (!submitted()) {
      elements.score.textContent = "";
      elements.feedback.textContent = "";
      elements.reference.textContent = "";
      elements.explanation.textContent = "";
      return;
    }
    const result = context.result || {};
    elements.score.textContent = `${result.score ?? 0} / ${result.maxScore ?? data.maxScore ?? 1} 分`;
    elements.feedback.textContent = typeof result.feedback === "string" ? result.feedback : "本题已提交，可结合标准答案和解析回顾。";
    const index = (data.options || []).findIndex((option) => option.id === data.correctOptionId);
    elements.reference.textContent = index >= 0 ? `${letter(index)}. ${data.options[index].text}` : "标准答案正在加载。";
    elements.explanation.textContent = typeof data.explanation === "string" ? data.explanation : "解析正在加载。";
  }

  function loadContext(nextContext) {
    if (!nextContext || !nextContext.question) return;
    const changedQuestion = questionId !== nextContext.question.id;
    const resetAfterRetry = submitted() && nextContext.status !== "submitted";
    context = nextContext;
    if (changedQuestion || resetAfterRetry) {
      questionId = context.question.id;
      selectionVersion = 0;
      acknowledgedVersion = 0;
      selectedOptionId = answerFrom(context.answer);
      notice = resetAfterRetry ? "已开始重新作答，选择后自动保存。" : "选择后自动保存，提交后可查看解析。";
      noticeIsError = false;
    } else if (submitted() || selectionVersion <= acknowledgedVersion) {
      // Keep a newer local choice while an earlier save confirmation arrives.
      selectedOptionId = answerFrom(context.answer);
    }
    const data = context.question.data || {};
    elements.title.textContent = context.question.title || "单选练习";
    elements.modeHint.textContent = context.mode === "example" ? "示例练习 · 选择一个最合适的答案。" : "读题后，选择一个最合适的答案。";
    elements.scoreHint.textContent = `每题 ${data.maxScore ?? 1} 分`;
    elements.stem.textContent = data.stem || "";
    // Preserve the radio focus when only the answer state changed.
    if (changedQuestion || renderedOptions.length !== (data.options || []).length || renderedOptions.some((item, index) => item.id !== data.options[index].id || item.text !== data.options[index].text)) {
      buildOptions(data);
    }
    if (submitted()) {
      notice = "答案已提交。可以查看解析，或再答一次。";
      noticeIsError = false;
    }
    renderResult(data);
    updateControls();
  }

  function failureMessage(reply, action) {
    const code = String(reply && reply.error && reply.error.code || "").toLowerCase();
    if (code.includes("revision") || code.includes("conflict")) {
      return "题目状态已更新，本次操作未完成；当前选择已保留，请重试。";
    }
    if (action === "retry") return "重新作答未成功，请稍后再试。";
    if (action === "submit") return "提交未成功，当前选择已保留，请重试。";
    return "保存未成功，当前选择已保留；可以重新选择或提交时重试。";
  }

  function choose(id) {
    if (!context || submitted() || busyAction) return;
    selectedOptionId = id;
    const version = ++selectionVersion;
    const forQuestion = questionId;
    noticeIsError = false;
    notice = "已选择答案。";
    updateControls();
    if (!capabilities().canSave) return;

    pendingDrafts += 1;
    updateControls();
    let saving;
    try {
      // Call immediately in the choice handler so the host can queue it before navigation.
      saving = QF.save({ purpose: "draft", data: { answer: { selectedOptionId: id } } });
    } catch (error) {
      saving = Promise.resolve({ ok: false });
    }
    Promise.resolve(saving).then((reply) => {
      if (forQuestion !== questionId) return;
      if (reply && reply.ok) {
        acknowledgedVersion = Math.max(acknowledgedVersion, version);
        if (version === selectionVersion) {
          notice = "选择已保存，确认后即可提交。";
          noticeIsError = false;
        }
      } else if (version === selectionVersion) {
        notice = failureMessage(reply, "draft");
        noticeIsError = true;
      }
    }).catch(() => {
      if (forQuestion === questionId && version === selectionVersion) {
        notice = failureMessage(null, "draft");
        noticeIsError = true;
      }
    }).finally(() => {
      pendingDrafts = Math.max(0, pendingDrafts - 1);
      updateControls();
    });
  }

  async function submitAnswer() {
    if (!context || !selectedOptionId || submitted() || busyAction || pendingDrafts > 0 || !capabilities().canSubmit) return;
    busyAction = "submit";
    setNotice("正在提交答案…", false);
    try {
      const reply = await QF.save({ purpose: "submit", data: { answer: { selectedOptionId } } });
      if (!reply || !reply.ok) setNotice(failureMessage(reply, "submit"), true);
      else {
        acknowledgedVersion = selectionVersion;
        setNotice("答案已提交。可以查看解析，或再答一次。", false);
        elements.result.focus({ preventScroll: true });
      }
    } catch (error) {
      setNotice(failureMessage(null, "submit"), true);
    } finally {
      busyAction = null;
      updateControls();
    }
  }

  async function retryQuestion() {
    if (!submitted() || busyAction || !capabilities().canRetry) return;
    busyAction = "retry";
    let didRetry = false;
    setNotice("正在准备重新作答…", false);
    try {
      const reply = await QF.requestAction({ action: "retry" });
      if (!reply || !reply.ok) setNotice(failureMessage(reply, "retry"), true);
      else {
        didRetry = true;
        setNotice("已开始重新作答，选择后自动保存。", false);
      }
    } catch (error) {
      setNotice(failureMessage(null, "retry"), true);
    } finally {
      busyAction = null;
      updateControls();
      if (didRetry && renderedOptions[0]) renderedOptions[0].radio.focus({ preventScroll: true });
    }
  }

  elements.result.tabIndex = -1;
  elements.submit.addEventListener("click", submitAnswer);
  elements.retry.addEventListener("click", retryQuestion);
  if (window.QF && QF.page && typeof QF.page.register === "function") {
    QF.page.register({ onLoad: loadContext });
  } else {
    setNotice("练习接口尚未就绪，请在 QuizForge 中打开本题。", true);
  }
})();
