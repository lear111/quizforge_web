(function () {
  'use strict';
  const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const id = v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v);
  const audioPath = v => QFListeningAudio.isReference(v);
  function validDoc(doc) {
    if (!object(doc) || doc.type !== 'doc' || !Array.isArray(doc.content)) return false;
    let count = 0, meaningful = false;
    function visit(node, depth) {
      if (!object(node) || ++count > 10000 || depth > 64) return false;
      if (node.type === 'text') {
        if (typeof node.text !== 'string' || !node.text.length) return false;
        if (node.text.trim()) meaningful = true;
      }
      if (node.type === 'image') {
        if (!/^[a-f0-9]{64}$/.test(node.attrs?.assetId || '')) return false;
        meaningful = true;
      }
      if (['inlineMath','blockMath'].includes(node.type)) {
        if (typeof node.attrs?.latex !== 'string' || !node.attrs.latex.trim()) return false;
        meaningful = true;
      }
      return !node.content || Array.isArray(node.content) && node.content.every(child => visit(child, depth + 1));
    }
    return visit(doc, 0) && meaningful;
  }
  function validAudio(data) {
    if (!audioPath(data.audio)) return false;
    if (Object.hasOwn(data, 'audioTitle') && (typeof data.audioTitle !== 'string' || data.audioTitle.length > 200)) return false;
    return !Object.hasOwn(data, 'playLimit') || Number.isInteger(data.playLimit) && data.playLimit >= 0 && data.playLimit <= 5;
  }
  function validAnswer(answer, data) {
    if (!object(answer)) return false;
    const ids = new Set(data.options.map(option => option.id));
    const keys = Object.keys(answer);
    if (keys.some(key => key !== 'selectedOptionId' && key !== 'plays')) return false;
    if (!Object.hasOwn(answer, 'selectedOptionId')) return false;
    if (Object.hasOwn(answer, 'plays') && !(Number.isInteger(answer.plays) && answer.plays >= 0 && answer.plays <= 5)) return false;
    return answer.selectedOptionId === null || ids.has(answer.selectedOptionId);
  }
  QF.defineType({
    validateQuestion(data) {
      if (!object(data) || data.formatVersion !== 1 || !validAudio(data) || !validDoc(data.stem) || !validDoc(data.answerAndExplanation) || !Number.isFinite(data.maxScore) || data.maxScore <= 0 || data.maxScore > 100000) return false;
      if (!Array.isArray(data.options) || data.options.length < 2 || data.options.length > 26 || !data.options.every(option => object(option) && id(option.id) && validDoc(option.content)) || new Set(data.options.map(option => option.id)).size !== data.options.length) return false;
      return data.options.some(option => option.id === data.correctOptionId);
    },
    validateAnswer: validAnswer,
    project(data, state) {
      const result = {formatVersion:1,audio:data.audio,stem:data.stem,maxScore:data.maxScore,options:data.options};
      if (Object.hasOwn(data, 'audioTitle')) result.audioTitle = data.audioTitle;
      if (Object.hasOwn(data, 'playLimit')) result.playLimit = data.playLimit;
      if (state?.submitted) {
        result.answerAndExplanation = data.answerAndExplanation;
        result.correctOptionId = data.correctOptionId;
      }
      return result;
    },
    grade(data, answer) {
      if (!validAnswer(answer, data)) throw new Error('作答包含无效选项');
      if (answer.selectedOptionId === null) return {gradingStatus:'graded',score:0,maxScore:data.maxScore,correct:false,feedback:'未作答'};
      const correct = answer.selectedOptionId === data.correctOptionId;
      return {gradingStatus:'graded',score:correct ? data.maxScore : 0,maxScore:data.maxScore,correct,feedback:correct ? '回答正确' : '回答错误'};
    },
    getScore(data, state) {
      return {score:state?.submitted || state?.status === 'submitted' ? state.result.score : 0,maxScore:data.maxScore};
    }
  });
})();
