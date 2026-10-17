'use strict';
// Local administrator supplied extensions only. vm and Node permissions are
// defense in depth; they are not a complete hostile-code OS sandbox.
const fs = require('node:fs');
const vm = require('node:vm');
const Ajv = require('ajv');
const LIMIT = 8 * 1024 * 1024;
// Public rule contracts evolve independently of application releases. Retain
// this v1 registration when a later major adds a separate implementation.
const ruleApis = new Map([[1, {
  minor: 4,
  register(run, development = false) {
    run(`globalThis.__type = null; globalThis.QF = Object.freeze({
      api:Object.freeze({major:1,minor:4,capabilities:Object.freeze([
        'practice','editor','editor-drafts','score','manual-review','ai-grading',
        'resources','richtext','navigation','lifecycle','outline-items','answer-state','appearance'
      ])}),
      defineType(type) {
        if (__type || !type || typeof type !== 'object' || Array.isArray(type) || (${development ? 'false' : "typeof type.project !== 'function' || typeof type.grade !== 'function'"})) throw Error('Invalid rule registration');
        for (const name of ['project','grade','validateQuestion','validateAnswer','getScore','review','prepareAiGrading']) if (type[name] != null && typeof type[name] !== 'function') throw Error('Invalid validator');
        if (type.getOutlineItems != null && typeof type.getOutlineItems !== 'function') { const error = new Error('Invalid outline hook'); error.code = 'INVALID_OUTLINE_ITEMS'; throw error; }
        globalThis.__type = type;
      }
    });`);
  }
}]]);
function selectRuleApi(value) {
  if (value === undefined) value = {major:1,minor:0};
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || !Number.isInteger(value.major) || value.major < 1 || value.major > 2147483647
      || !Number.isInteger(value.minor) || value.minor < 0 || value.minor > 2147483647) {
    const error = new Error('Invalid rule API version'); error.code = 'INVALID_API_VERSION'; throw error;
  }
  const api = ruleApis.get(value.major);
  if (!api || value.minor > api.minor) {
    const error = new Error('Unsupported rule API version; this runner supports v1.4, v1.3, v1.2, v1.1 and v1.0'); error.code = 'UNSUPPORTED_API_VERSION'; throw error;
  }
  return api;
}
let development = false;
// Every request builds its own AJV instance and VM context; only the Node
// startup and loaded modules are shared between requests of one worker.
function handle(input) {
  development = false;
  try {
    const request = JSON.parse(input);
    development = request.development === true;
    const api = selectRuleApi(request.apiVersion);
    const requestedMinor = request.apiVersion === undefined ? 0 : request.apiVersion.minor;
    const read = path => {
      const stat = fs.statSync(path);
      if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error('Rule asset exceeds limit');
      return fs.readFileSync(path, 'utf8');
    };
    const ajv = new Ajv({ allErrors: false, strict: true, validateFormats: false });
    const validQuestion = ajv.compile(development && !request.questionSchema ? true : JSON.parse(read(request.questionSchema)));
    const validAnswer = ajv.compile(development && !request.answerSchema ? true : JSON.parse(read(request.answerSchema)));
    let context;
    const run = code => vm.runInContext(code, context, { timeout: 650, displayErrors: false });
    const source = new vm.Script(read(request.rules), { filename: 'extension-rules.js' });
    const resetContext = () => {
      context = vm.createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false } });
      api.register(run, development);
      source.runInContext(context, { timeout: 650, displayErrors: false });
    };
    resetContext();
    if (!run('Boolean(__type)')) throw new Error('Missing rule registration');
    const canOutlineItems = run('typeof __type.getOutlineItems === "function"');
    const outlineError = () => { const error = new Error('Invalid outline items or undeclared outline-items capability'); error.code = 'INVALID_OUTLINE_ITEMS'; throw error; };
    if (canOutlineItems && (request.outlineItemsDeclared !== true || requestedMinor < 1)) outlineError();
    const set = value => run(`globalThis.__input = JSON.parse(${JSON.stringify(JSON.stringify(value))});`);
    const invoke = expression => JSON.parse(run(`JSON.stringify(${expression})`));
    const notImplemented = name => {
      const error = new Error(`Development extension has not implemented ${name}`);
      error.code = 'DEVELOPMENT_NOT_IMPLEMENTED'; throw error;
    };
    const requireHook = name => {
      if (development && !run(`typeof __type[${JSON.stringify(name)}] === "function"`)) notImplemented(name);
    };
    const project = expression => development && !run('typeof __type.project === "function"')
      ? invoke('__input.data') : invoke(expression);
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
      } else if (!Number.isFinite(result.score) || typeof result.correct !== 'boolean') throw new Error('Invalid grade result');
      return status;
    };
    const validateAiScore = (score, result) => {
      if (!score || typeof score !== 'object' || Array.isArray(score) || score.score !== result.score || score.maxScore !== result.maxScore
          || Object.hasOwn(score, 'gradingStatus') && score.gradingStatus !== (result.gradingStatus ?? 'graded')) {
        const error = new Error('AI grading getScore must match the submitted result'); error.code = 'SCORE_UNAVAILABLE'; throw error;
      }
      if (Object.hasOwn(score, 'outlineStates')) validateOutlineStates(score.outlineStates, true);
    };
    const validateOutlineStates = (items, submitted) => {
      const invalid = () => { const error = new Error('Invalid outlineStates returned by getScore'); error.code = 'INVALID_OUTLINE_STATES'; throw error; };
      if (!Array.isArray(items) || items.length > 100) invalid();
      const ids = new Set(), statuses = new Set(['unanswered','draft','correct','incorrect']);
      for (const item of items) {
        if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).length !== 2
            || !Object.hasOwn(item, 'id') || !Object.hasOwn(item, 'status')
            || typeof item.id !== 'string' || item.id.length === 0 || item.id.length > 128 || item.id !== item.id.trim()
            || /[\u0000-\u001f\u007f-\u009f<>]/u.test(item.id) || ids.has(item.id)
            || !statuses.has(item.status) || !submitted && !['unanswered','draft'].includes(item.status)
            || submitted && item.status === 'draft') invalid();
        ids.add(item.id);
      }
      return items;
    };
    let output;
    if (request.op === 'capabilities') {
      output = { canAiGrade: run('typeof __type.prepareAiGrading === "function" && typeof __type.review === "function"'), canOutlineItems };
    } else if (request.op === 'validateBank') {
      if (!Array.isArray(request.questions) || request.questions.length > 10000) throw new Error('Invalid question list');
      // Catalog startup may share Node/AJV across original bank chunks, but
      // each chunk must retain the fresh VM globals of its former process.
      const offsets = request.contextResetOffsets ?? [];
      if (!Array.isArray(offsets) || offsets.length > request.questions.length
          || offsets.some((offset, index) => !Number.isInteger(offset) || offset <= 0 || offset >= request.questions.length || index > 0 && offset <= offsets[index - 1])) throw new Error('Invalid validation boundaries');
      let nextReset = 0;
      for (let index = 0; index < request.questions.length; index++) {
        if (index === offsets[nextReset]) { resetContext(); nextReset++; }
        validateQ(request.questions[index]);
      }
      output = { valid: true };
    } else if (request.op === 'outlineBatch') {
      if (requestedMinor < 1 || request.outlineItemsDeclared !== true) outlineError();
      if (!Array.isArray(request.questions) || request.questions.length > 10000) outlineError();
      const offsets = request.contextResetOffsets ?? [];
      if (!Array.isArray(offsets) || offsets.length > request.questions.length
          || offsets.some((offset, index) => !Number.isInteger(offset) || offset <= 0 || offset >= request.questions.length || index > 0 && offset <= offsets[index - 1])) throw new Error('Invalid outline boundaries');
      let nextReset = 0;
      const outlineItems = [];
      const plain = (value, maximum) => typeof value === 'string' && value.length > 0 && value.length <= maximum && value === value.trim() && !/[\u0000-\u001f\u007f-\u009f<>]/u.test(value);
      for (let index = 0; index < request.questions.length; index++) {
        if (index === offsets[nextReset]) { resetContext(); nextReset++; }
        const question = request.questions[index];
        validateQ(question); set({ data: question });
        let items;
        try { items = canOutlineItems ? invoke('__type.getOutlineItems(__input.data)') : []; }
        catch { outlineError(); }
        if (!Array.isArray(items) || items.length > 100) outlineError();
        const ids = new Set();
        for (const item of items) {
          if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).length !== 2 || !plain(item.id, 128) || !plain(item.label, 80) || ids.has(item.id)) outlineError();
          ids.add(item.id);
        }
        outlineItems.push(items);
      }
      output = { outlineItems };
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
          : { score: 0, maxScore: project('__type.project(__input.data, {submitted:false,result:null})')?.maxScore };
        if (!score || typeof score !== 'object' || Array.isArray(score) || !Number.isFinite(score.maxScore) || score.maxScore < 0 || (gradingStatus === 'pending' ? score.score !== null : !Number.isFinite(score.score))) {
          if (development && !run('typeof __type.getScore === "function"')) notImplemented('getScore');
          const error = new Error('Extension must provide finite score and maxScore through getScore'); error.code = 'SCORE_UNAVAILABLE'; throw error;
        }
        const value = { score: score.score, maxScore: score.maxScore, gradingStatus };
        // Active reporting replaces pre-submit outline polling for API 1.3 types.
        if (Object.hasOwn(score, 'outlineStates') && (state.submitted || request.answerStateDeclared !== true)) value.outlineStates = validateOutlineStates(score.outlineStates, state.submitted);
        scores.push(value);
      }
      output = { scores };
    } else if (request.op === 'projectBatch') {
      if (!Array.isArray(request.questions) || request.questions.length > 10000) throw new Error('Invalid projection list');
      const projected = []; let bytes = 64;
      for (const question of request.questions) {
        if (!question || !question.state || typeof question.state.submitted !== 'boolean') throw new Error('Invalid projection state');
        validateQ(question.data); set({ data: question.data, state: question.state });
        const value = project('__type.project(__input.data, __input.state)');
        bytes += Buffer.byteLength(JSON.stringify(value)) + 1;
        if (bytes > 2 * 1024 * 1024) throw new Error('Output limit exceeded');
        projected.push(value);
      }
      output = { projected };
    } else {
      validateQ(request.data);
      if (request.op === 'submit' || request.op === 'validateAnswer' || request.op === 'review' || request.op === 'prepareAiGrading') {
        if (development && !request.answerSchema) notImplemented('answer schema');
        if (request.op === 'submit') requireHook('grade');
        if (request.op === 'review') requireHook('review');
        if (request.op === 'prepareAiGrading') requireHook('prepareAiGrading');
        if (!validAnswer(request.answer)) throw new Error('Answer schema validation failed');
        set({ data: request.data, answer: request.answer });
        if (run('__type.validateAnswer ? __type.validateAnswer(__input.answer, __input.data) === false : false')) throw new Error('Answer validation failed');
      }
      if (request.op === 'prepareAiGrading') {
        if (!run('typeof __type.prepareAiGrading === "function" && typeof __type.review === "function"')) throw new Error('AI grading is unavailable');
        validateResult(request.state?.result);
        set({ data: request.data, answer: request.answer, state: request.state, context: {state: request.state, ...(request.targetId == null ? {} : {targetId: request.targetId}), ...(request.automatic === true ? {automatic:true} : {})} });
        const gradingInput = invoke('__type.prepareAiGrading(__input.data, __input.answer, __input.context)');
        // AI input is independent of the parent score; review owns adoption.
        output = { gradingInput };
      } else if (request.op === 'submit' || request.op === 'review') {
        if (request.op === 'review' && (!request.review || typeof request.review !== 'object' || Array.isArray(request.review) || !Number.isFinite(request.review.score) || !run('typeof __type.review === "function"'))) throw new Error('Invalid review request');
        set({ data: request.data, answer: request.answer, review: request.review, context: {state: request.state} });
        const result = invoke(request.op === 'review' ? '__type.review(__input.data, __input.answer, __input.review, __input.context)' : '__type.grade(__input.data, __input.answer)');
        validateResult(result, request.op !== 'review');
        set({ data: request.data, state: { submitted: true, result } });
        if (request.op === 'review' && run('typeof __type.prepareAiGrading === "function"')) {
          const score = run('typeof __type.getScore === "function"') ? invoke('__type.getScore(__input.data, __input.state)') : result;
          validateAiScore(score, result);
        }
        output = { result, projected: project('__type.project(__input.data, __input.state)') };
      } else if (request.op === 'project') {
        set({ data: request.data, state: request.state });
        output = { projected: project('__type.project(__input.data, __input.state)') };
      } else if (request.op === 'validateAnswer') {
        output = { valid: true };
        if (request.projectAfterValidation === true) {
          // Answer validation and public projection formerly ran in separate Node
          // processes. Keep their VM globals separate while paying startup/AJV once.
          resetContext();
          validateQ(request.data);
          set({ data: request.data, state: { submitted: false, result: null } });
          output.projected = project('__type.project(__input.data, __input.state)');
        }
        if (request.outlineAfterValidation === true && request.answerStateDeclared !== true) try {
          // Preserve the fresh scoring VM used by scoreBatch while sharing the
          // Node/AJV startup with draft validation and public projection.
          resetContext();
          validateQ(request.data);
          set({ data: request.data, state: { status: 'draft', submitted: false, ...(request.outlineRevision===undefined?{}:{revision:request.outlineRevision}), answer: request.answer, result: null } });
          const score = run('typeof __type.getScore === "function"')
            ? invoke('__type.getScore(__input.data, __input.state)')
            : { score: 0, maxScore: project('__type.project(__input.data, {submitted:false,result:null})')?.maxScore };
          if (!score || typeof score !== 'object' || Array.isArray(score) || !Number.isFinite(score.maxScore) || score.maxScore < 0 || !Number.isFinite(score.score)) {
            if (development && !run('typeof __type.getScore === "function"')) notImplemented('getScore');
            const error = new Error('Extension must provide finite score and maxScore through getScore'); error.code = 'SCORE_UNAVAILABLE'; throw error;
          }
          output.outlineScore = { score: score.score, maxScore: score.maxScore, gradingStatus: 'unsubmitted' };
          if (Object.hasOwn(score, 'outlineStates')) output.outlineScore.outlineStates = validateOutlineStates(score.outlineStates, false);
        } catch (error) {
          // Partial development types could already save an answer without a
          // working score hook. Keep that behavior; never invent child states.
          if (!development || error.code !== 'DEVELOPMENT_NOT_IMPLEMENTED') throw error;
        }
      }
      else throw new Error('Unknown rule operation');
    }
    if (request.withCapabilities === true) output.capabilities = {canAiGrade:run('typeof __type.prepareAiGrading === "function" && typeof __type.review === "function"'),canOutlineItems};
    const encoded = JSON.stringify({ ok: true, data: output });
    if (Buffer.byteLength(encoded) > 2 * 1024 * 1024) throw new Error('Output limit exceeded');
    return { text: encoded, ok: true };
  } catch (error) {
    // Error stacks and paths stay inside the process. Java returns a bounded generic error.
    return { ok: false, text: JSON.stringify({ ok: false, code: ['SCORE_UNAVAILABLE','INVALID_API_VERSION','UNSUPPORTED_API_VERSION','INVALID_OUTLINE_ITEMS','INVALID_OUTLINE_STATES', ...(development ? ['DEVELOPMENT_NOT_IMPLEMENTED'] : [])].includes(error.code) ? error.code : undefined, error: String(error.message || error).slice(0, 200) }) };
  }
}
process.stdin.setEncoding('utf8');
if (process.argv[2] === '--serve') {
  // Persistent worker for one extension: the host keys workers by their
  // read permissions, sends one JSON request per line and reads one reply line.
  let pending = '';
  process.stdin.on('data', chunk => {
    pending += chunk;
    for (let newline = pending.indexOf('\n'); newline >= 0; newline = pending.indexOf('\n')) {
      const line = pending.slice(0, newline); pending = pending.slice(newline + 1);
      process.stdout.write(handle(line).text + '\n');
    }
    if (Buffer.byteLength(pending) > LIMIT) { process.stderr.write('Input limit exceeded'); process.exit(2); }
  });
  process.stdin.on('end', () => process.exit(0));
} else {
  let input = '';
  process.stdin.on('data', chunk => {
    input += chunk;
    if (Buffer.byteLength(input) > LIMIT) { process.stderr.write('Input limit exceeded'); process.exit(2); }
  });
  process.stdin.on('end', () => {
    const response = handle(input);
    process.stdout.write(response.text);
    if (!response.ok) process.exitCode = 1;
  });
}
