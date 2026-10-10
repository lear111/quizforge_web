(function () {
  "use strict";

  const validId = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);
  const nonempty = (value) => typeof value === "string" && value.trim().length > 0;

  QF.defineType({
    validateQuestion(data) {
      if (!data || typeof data !== "object" || Array.isArray(data)) return false;
      if (!nonempty(data.stem) || !nonempty(data.explanation)) return false;
      if (!Number.isFinite(data.maxScore) || data.maxScore <= 0 || data.maxScore > 100000) return false;
      if (!Array.isArray(data.options) || data.options.length < 2 || data.options.length > 26) return false;
      const ids = new Set();
      for (const option of data.options) {
        if (!option || !validId(option.id) || !nonempty(option.text) || ids.has(option.id)) return false;
        ids.add(option.id);
      }
      return validId(data.correctOptionId) && ids.has(data.correctOptionId);
    },

    validateAnswer(answer, data) {
      return !!answer && typeof answer === "object" && !Array.isArray(answer) && validId(answer.selectedOptionId)
        && !!data && Array.isArray(data.options) && data.options.some((option) => option.id === answer.selectedOptionId);
    },

    project(data, context) {
      // Build the public object explicitly so future private fields also stay private.
      const projected = {
        stem: data.stem,
        options: data.options.map((option) => ({ id: option.id, text: option.text })),
        maxScore: data.maxScore
      };
      if (context && context.submitted === true) {
        projected.correctOptionId = data.correctOptionId;
        projected.explanation = data.explanation;
      }
      return projected;
    },

    grade(data, answer) {
      if (!answer || !data.options.some((option) => option.id === answer.selectedOptionId)) {
        throw new Error("请选择题目提供的一个选项。");
      }
      const correct = answer.selectedOptionId === data.correctOptionId;
      return {
        score: correct ? data.maxScore : 0,
        maxScore: data.maxScore,
        correct,
        feedback: correct ? "回答正确，已获得本题全部分数。" : "本次回答未得分，可以结合解析再思考一次。"
      };
    }
  });
})();
