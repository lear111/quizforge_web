'use strict';
// Local administrator supplied extensions only. vm and Node permissions are
// defense in depth; they are not a complete hostile-code OS sandbox.
const fs = require('node:fs');
const vm = require('node:vm');
const Ajv = require('ajv');
const LIMIT = 8 * 1024 * 1024;
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  input += chunk;
  if (Buffer.byteLength(input) > LIMIT) { process.stderr.write('Input limit exceeded'); process.exit(2); }
});
process.stdin.on('end', () => {
  try {
    const request = JSON.parse(input);
    const read = path => {
      const stat = fs.statSync(path);
      if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error('Rule asset exceeds limit');
      return fs.readFileSync(path, 'utf8');
    };
    const ajv = new Ajv({ allErrors: false, strict: true, validateFormats: false });
    const validQuestion = ajv.compile(JSON.parse(read(request.questionSchema)));
    const validAnswer = ajv.compile(JSON.parse(read(request.answerSchema)));
    const context = vm.createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false } });
    const run = code => vm.runInContext(code, context, { timeout: 650, displayErrors: false });
    run(`globalThis.__type = null; globalThis.QF = Object.freeze({defineType(type) {
      if (__type || !type || typeof type.project !== 'function' || typeof type.grade !== 'function') throw Error('Invalid rule registration');
      for (const name of ['validateQuestion','validateAnswer','getScore','review','prepareAiGrading']) if (type[name] != null && typeof type[name] !== 'function') throw Error('Invalid validator');
      globalThis.__type = type;
    }});`);
    new vm.Script(read(request.rules), { filename: 'extension-rules.js' }).runInContext(context, { timeout: 650, displayErrors: false });
    if (!run('Boolean(__type)')) throw new Error('Missing rule registration');
    const set = value => run(`globalThis.__input = JSON.parse(${JSON.stringify(JSON.stringify(value))});`);
    const invoke = expression => JSON.parse(run(`JSON.stringify(${expression})`));
    const validateQ = data => {
      if (!validQuestion(data)) throw new Error('Question schema validation failed');
      set({ data });
      if (run('__type.validateQuestion ? __type.validateQuestion(__input.data) === false : false')) throw new Error('Question validation failed');
    };
    const validateResult = (result, allowPending = true) => {
      const status = result?.gradingStatus ?? 'graded';
      if (!result || typeof result !== 'object' || Array.isArray(result) || (Object.hasOwn(result, 'gradingStatus') && typeof result.gradingStatus !== 'string') || !['pending','graded'].includes(status) || !Number.isFinite(result.maxScore) || result.maxScore < 0 || !Object.hasOwn(result, 'feedback')) throw new Error('Invalid grade result');
      if (status === 'pending') {
        if (!allowPending || result.score !== null || result.correct !== null) throw new Error('Invalid pending grade result');
      } else if (!Number.isFinite(result.score) || result.score < 0 || result.score > result.maxScore || typeof result.correct !== 'boolean') throw new Error('Invalid grade result');
      return status;
    };
    const validateAiScore = (score, result) => {
      if (!score || typeof score !== 'object' || Array.isArray(score) || score.score !== result.score || score.maxScore !== result.maxScore
          || Object.hasOwn(score, 'gradingStatus') && score.gradingStatus !== (result.gradingStatus ?? 'graded')) {
        const error = new Error('AI grading getScore must match the submitted result'); error.code = 'SCORE_UNAVAILABLE'; throw error;
      }
    };
    let output;
    if (request.op === 'capabilities') {
      output = { canAiGrade: run('typeof __type.prepareAiGrading === "function" && typeof __type.review === "function"') };
    } else if (request.op === 'validateBank') {
      if (!Array.isArray(request.questions) || request.questions.length > 10000) throw new Error('Invalid question list');
      for (const question of request.questions) validateQ(question);
      output = { valid: true };
    } else if (request.op === 'scoreBatch') {
      if (!Array.isArray(request.questions) || request.questions.length > 10000) throw new Error('Invalid scoring list');
      const scores = [];
      for (const question of request.questions) {
        if (!question || !question.state || !['unanswered','draft','submitted'].includes(question.state.status)) throw new Error('Invalid scoring state');
        validateQ(question.data);
        const state = { ...question.state, submitted: question.state.status === 'submitted' };
        const gradingStatus = state.submitted ? validateResult(state.result) : 'unsubmitted';
        set({ data: question.data, state });
        // The host never knows a type's grading rules or private question shape.
        // Existing types may expose maxScore in their public projection until they implement getScore.
        const score = run('typeof __type.getScore === "function"')
          ? invoke('__type.getScore(__input.data, __input.state)')
          : state.submitted ? { score: state.result?.score, maxScore: state.result?.maxScore }
          : { score: 0, maxScore: invoke('__type.project(__input.data, {submitted:false,result:null})')?.maxScore };
        if (!score || !Number.isFinite(score.maxScore) || score.maxScore < 0 || (gradingStatus === 'pending' ? score.score !== null : !Number.isFinite(score.score) || score.score < 0 || score.score > score.maxScore)) {
          const error = new Error('Extension must provide finite score and maxScore through getScore'); error.code = 'SCORE_UNAVAILABLE'; throw error;
        }
        scores.push({ score: score.score, maxScore: score.maxScore, gradingStatus });
      }
      output = { scores };
    } else if (request.op === 'projectBatch') {
      if (!Array.isArray(request.questions) || request.questions.length > 10000) throw new Error('Invalid projection list');
      const projected = []; let bytes = 64;
      for (const question of request.questions) {
        if (!question || !question.state || typeof question.state.submitted !== 'boolean') throw new Error('Invalid projection state');
        validateQ(question.data); set({ data: question.data, state: question.state });
        const value = invoke('__type.project(__input.data, __input.state)');
        bytes += Buffer.byteLength(JSON.stringify(value)) + 1;
        if (bytes > 2 * 1024 * 1024) throw new Error('Output limit exceeded');
        projected.push(value);
      }
      output = { projected };
    } else {
      validateQ(request.data);
      if (request.op === 'submit' || request.op === 'validateAnswer' || request.op === 'review' || request.op === 'prepareAiGrading') {
        if (!validAnswer(request.answer)) throw new Error('Answer schema validation failed');
        set({ data: request.data, answer: request.answer });
        if (run('__type.validateAnswer ? __type.validateAnswer(__input.answer, __input.data) === false : false')) throw new Error('Answer validation failed');
      }
      if (request.op === 'prepareAiGrading') {
        if (!run('typeof __type.prepareAiGrading === "function" && typeof __type.review === "function"')) throw new Error('AI grading is unavailable');
        validateResult(request.state?.result);
        set({ data: request.data, answer: request.answer, state: request.state });
        const gradingInput = invoke('__type.prepareAiGrading(__input.data, __input.answer)');
        const score = run('typeof __type.getScore === "function"') ? invoke('__type.getScore(__input.data, __input.state)') : {score:request.state.result.score,maxScore:request.state.result.maxScore};
        validateAiScore(score, request.state.result);
        output = { gradingInput, maxScore: score?.maxScore };
      } else if (request.op === 'submit' || request.op === 'review') {
        if (request.op === 'review' && (!request.review || typeof request.review !== 'object' || Array.isArray(request.review) || !Number.isFinite(request.review.score) || !run('typeof __type.review === "function"'))) throw new Error('Invalid review request');
        set({ data: request.data, answer: request.answer, review: request.review });
        const result = invoke(request.op === 'review' ? '__type.review(__input.data, __input.answer, __input.review)' : '__type.grade(__input.data, __input.answer)');
        validateResult(result, request.op !== 'review');
        set({ data: request.data, state: { submitted: true, result } });
        if (request.op === 'review' && run('typeof __type.prepareAiGrading === "function"')) {
          const score = run('typeof __type.getScore === "function"') ? invoke('__type.getScore(__input.data, __input.state)') : result;
          validateAiScore(score, result);
        }
        output = { result, projected: invoke('__type.project(__input.data, __input.state)') };
      } else if (request.op === 'project') {
        set({ data: request.data, state: request.state });
        output = { projected: invoke('__type.project(__input.data, __input.state)') };
      } else if (request.op === 'validateAnswer') output = { valid: true };
      else throw new Error('Unknown rule operation');
    }
    if (request.withCapabilities === true) output.capabilities = {canAiGrade:run('typeof __type.prepareAiGrading === "function" && typeof __type.review === "function"')};
    const encoded = JSON.stringify({ ok: true, data: output });
    if (Buffer.byteLength(encoded) > 2 * 1024 * 1024) throw new Error('Output limit exceeded');
    process.stdout.write(encoded);
  } catch (error) {
    // Error stacks and paths stay inside the process. Java returns a bounded generic error.
    process.stdout.write(JSON.stringify({ ok: false, code: error.code === 'SCORE_UNAVAILABLE' ? error.code : undefined, error: String(error.message || error).slice(0, 200) }));
    process.exitCode = 1;
  }
});
