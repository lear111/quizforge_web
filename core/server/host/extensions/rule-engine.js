import { timeMethods } from '../platform/timing.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ApiError } from '../platform/errors.js';
import { cloneJson, fingerprint, hash, jsonBytes, parseJson } from '../platform/json.js';
import { readBytes, safeFile, walkEntries } from '../platform/files.js';
import { apiVersion } from './extension-api.js';
import { fileIdentity, statIdentity } from '../platform/file-cache.js';

// Persistent runners: one per extension permission set, two at most while
// busy plus one kept for foreground work while both run background batches,
// recycled after idling or serving many requests.
const backgroundWork = new AsyncLocalStorage();
const WORKER_IDLE_MS = 60 * 1000, WORKER_REQUESTS = 500, WORKERS_PER_KEY = 2, WORKER_LIMIT = 12;
const ENVIRONMENT = new Set(['SYSTEMROOT', 'WINDIR', 'PATH', 'TEMP', 'TMP', 'COMSPEC', 'PATHEXT']);
const messages = {
  DEVELOPMENT_NOT_IMPLEMENTED: '开发版拓展尚未实现当前操作，请补齐对应规则、数据结构或评分接口；当前输入已保留。',
  SCORE_UNAVAILABLE: '题型拓展尚未提供有效的分值接口，请实现 getScore 并返回 score、maxScore。',
  INVALID_OUTLINE_ITEMS: '题型拓展的小题目录无效，请检查 outline-items 声明及 getOutlineItems 返回的唯一 id 和纯文本 label。',
  INVALID_OUTLINE_STATES: '题型拓展的 getScore 返回了无效的小题状态，请检查 outlineStates 的唯一 id 和 status。',
};
export function ruleEnvironment() { return Object.fromEntries(Object.entries(process.env).filter(([key]) => ENVIRONMENT.has(key.toUpperCase()))); }
export class RuleEngine {
  constructor(codeRoot, { node = process.execPath, deadline = 8000 } = {}) {
    this.codeRoot = path.resolve(codeRoot); this.node = node; this.deadline = deadline;
    this.children = new Set(); this.closed = false; this.permissions = false;
    this.fileDigests = new Map(); this.pools = new Map();
    timeMethods(this, 'rules', ['run']);
  }
  static async create(codeRoot, options) { const result = new RuleEngine(codeRoot, options); await result.initialize(); return result; }
  async initialize() {
    try {
      const probe = await this.process(['--permission', '-e', "process.stdout.write('ok')"], null, 3000);
      this.permissions = probe.code === 0 && probe.stdout.toString() === 'ok';
    } catch { this.permissions = false; }
    const response = await this.process(['-e', 'process.stdout.write(JSON.stringify({path:process.execPath,version:process.version,modules:process.versions.modules}))'], null, 3000);
    if (response.code !== 0) throw new Error('Node identity unavailable');
    const identity = parseJson(response.stdout);
    if (typeof identity.path !== 'string') throw new Error('Node executable identity unavailable');
    this.nodeExecutable = identity.path;
    this.nodeMetadata = fingerprint(identity, 'quizforge-node-runtime-v1');
  }
  async validationEnvironment() {
    try {
      const files = [this.nodeMetadata];
      const hashFile = async (file, checked = null) => {
        const identity = checked ? statIdentity(checked) : fileIdentity(file), cached = this.fileDigests.get(file);
        if (cached?.identity === identity) return cached.hash;
        const digest = createHash('sha256');
        for await (const chunk of fs.createReadStream(file)) digest.update(chunk);
        if (fileIdentity(file) !== identity) throw new Error('Runtime file changed while hashing');
        const value = digest.digest('hex'); this.fileDigests.delete(file); this.fileDigests.set(file, { identity, hash: value });
        while (this.fileDigests.size > 2048) this.fileDigests.delete(this.fileDigests.keys().next().value);
        return value;
      };
      files.push(await hashFile(this.nodeExecutable));
      const configured = path.resolve(this.node);
      if (configured !== path.resolve(this.nodeExecutable) && fs.existsSync(configured)) files.push(await hashFile(configured));
      files.push(hash(readBytes(safeFile(path.join(this.codeRoot, 'server'), 'rules-runner.cjs'))));
      for (const dependency of ['ajv', 'fast-uri', 'fast-deep-equal', 'json-schema-traverse', 'require-from-string']) {
        const directory = path.join(this.codeRoot, 'node_modules', dependency);
        for (const { file, stat } of walkEntries(directory, 10000).sort((a, b) => a.file < b.file ? -1 : a.file > b.file ? 1 : 0)) {
          if (!stat.isFile()) continue;
          files.push(dependency + '/' + path.relative(directory, file));
          if (stat.size > 8n * 1024n * 1024n) throw new Error('Dependency file limit');
          files.push(await hashFile(file, stat));
        }
      }
      return fingerprint(files, 'quizforge-validation-environment-v1');
    } catch { return 'unavailable'; }
  }
  // Rule requests started inside fn (startup validation) yield to foreground work.
  background(fn) { return backgroundWork.run(true, fn); }
  async run(extension, input) {
    const request = cloneJson(input), development = extension.development != null;
    request.development = development;
    if (development && !extension.rules) return this.developmentProjection(request);
    Object.assign(request, { apiVersion: apiVersion(), outlineItemsDeclared: extension.outlineItemsDeclared === true, answerStateDeclared: extension.answerStateDeclared === true, rules: extension.rules, questionSchema: extension.questionSchema ?? null, answerSchema: extension.answerSchema ?? null });
    const encoded = jsonBytes(request);
    if (encoded.length > 8 * 1024 * 1024) throw new ApiError(413, 'RULE_INPUT_TOO_LARGE', 'Rule input exceeds the size limit');
    const runner = path.join(this.codeRoot, 'server', 'rules-runner.cjs');
    const args = ['--max-old-space-size=96', '--disable-proto=throw'];
    if (this.permissions) {
      args.push('--permission');
      for (const allowed of [runner, path.join(this.codeRoot, 'node_modules'), extension.rules, extension.questionSchema, extension.answerSchema].filter(Boolean)) {
        args.push('--allow-fs-read=' + allowed);
        try {
          const resolved = fs.realpathSync.native(allowed);
          if (resolved !== path.resolve(allowed)) {
            args.push('--allow-fs-read=' + resolved);
            if (process.platform === 'win32') args.push('--allow-fs-read=\\\\?\\' + resolved);
          }
        } catch { /* Missing paths are rejected by the runner. */ }
      }
    }
    args.push(runner);
    try {
      const result = await this.serve(args, encoded, this.deadline, fs.statSync(runner, { bigint: true }).mtimeNs, backgroundWork.getStore() !== true);
      const response = parseJson(result.stdout);
      if (messages[response?.code] && (response.code !== 'DEVELOPMENT_NOT_IMPLEMENTED' || development)) throw new ApiError(422, response.code, messages[response.code]);
      if (result.code !== 0 || !response?.ok) throw new ApiError(422, 'RULE_REJECTED', 'Extension rules rejected or could not process this data');
      return response.data;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(503, 'RULE_UNAVAILABLE', 'Rule engine unavailable; verify Node and installed dependencies', { cause: error });
    }
  }
  process(args, input, deadline) {
    if (this.closed) return Promise.reject(new ApiError(503, 'RULE_UNAVAILABLE', 'Rule execution interrupted'));
    return new Promise((resolve, reject) => {
      const child = spawn(this.node, args, { cwd: this.codeRoot, env: ruleEnvironment(), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      this.children.add(child);
      const stdout = [], stderr = []; let outputSize = 0, errorSize = 0, failure = null;
      const stop = error => { failure ??= error; child.kill('SIGKILL'); };
      const timer = setTimeout(() => stop(new ApiError(422, 'RULE_TIMEOUT', 'Extension rules exceeded their execution deadline')), deadline);
      child.stdout.on('data', chunk => {
        outputSize += chunk.length;
        if (outputSize > 2 * 1024 * 1024) stop(new ApiError(422, 'RULE_OUTPUT_LIMIT', 'Extension rules exceeded their output limit'));
        else stdout.push(chunk);
      });
      child.stderr.on('data', chunk => {
        errorSize += chunk.length;
        if (errorSize > 64 * 1024) stop(new ApiError(422, 'RULE_OUTPUT_LIMIT', 'Extension rules exceeded their output limit'));
        else stderr.push(chunk);
      });
      child.stdin.on('error', () => {});
      child.once('error', error => { failure ??= error; });
      child.once('close', code => {
        clearTimeout(timer); this.children.delete(child);
        if (this.closed) failure ??= new ApiError(503, 'RULE_UNAVAILABLE', 'Rule execution interrupted');
        if (failure) reject(failure);
        else resolve({ code, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) });
      });
      child.stdin.end(input);
    });
  }
  // Each request still gets a fresh AJV instance and VM context inside the
  // runner; only Node startup and module loading are shared. A timeout, an
  // oversized reply or a crash kills the worker; the next request starts anew.
  serve(args, input, deadline, revision = '', priority = true) {
    if (this.closed) return Promise.reject(new ApiError(503, 'RULE_UNAVAILABLE', 'Rule execution interrupted'));
    const key = [String(revision), ...args].join('\0');
    let pool = this.pools.get(key);
    if (!pool) { pool = { key, args, workers: new Set(), queue: [] }; this.pools.set(key, pool); }
    return new Promise((resolve, reject) => { pool.queue.push({ input, deadline, priority, resolve, reject, retried: false, timer: null }); this.dispatch(pool); });
  }
  dispatch(pool) {
    while (pool.queue.length && !this.closed) {
      const index = Math.max(0, pool.queue.findIndex(job => job.priority)), job = pool.queue[index], busy = [...pool.workers].filter(item => item.job);
      // Background batches never hold more than the usual two workers.
      if (!job.priority && busy.filter(item => !item.job.priority).length >= WORKERS_PER_KEY) return;
      let worker = [...pool.workers].find(item => !item.job);
      if (!worker) {
        const limit = job.priority && !busy.some(item => item.job.priority) ? WORKERS_PER_KEY + 1 : WORKERS_PER_KEY;
        if (pool.workers.size >= limit) return;
        this.trimWorkers();
        worker = this.startWorker(pool);
      }
      pool.queue.splice(index, 1); this.assign(worker, job);
    }
    if (!pool.workers.size && !pool.queue.length && this.pools.get(pool.key) === pool) this.pools.delete(pool.key);
  }
  workers() { return [...this.pools.values()].flatMap(pool => [...pool.workers]); }
  trimWorkers() {
    const idle = this.workers().filter(worker => !worker.job).sort((a, b) => a.lastUsed - b.lastUsed);
    while (this.workers().length >= WORKER_LIMIT && idle.length) this.release(idle.shift());
  }
  startWorker(pool) {
    const child = spawn(this.node, [...pool.args, '--serve'], { cwd: this.codeRoot, env: ruleEnvironment(), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const worker = { child, pool, job: null, served: 0, chunks: [], size: 0, errorSize: 0, idle: null, lastUsed: Date.now(), done: false };
    this.children.add(child); pool.workers.add(worker);
    child.stdout.on('data', chunk => this.receive(worker, chunk));
    child.stderr.on('data', chunk => { worker.errorSize += chunk.length; if (worker.errorSize > 64 * 1024) this.retire(worker, new ApiError(422, 'RULE_OUTPUT_LIMIT', 'Extension rules exceeded their output limit')); });
    child.stdin.on('error', () => {});
    child.once('error', error => this.retire(worker, error));
    child.once('close', () => { this.children.delete(child); this.retire(worker, new Error('Rule worker exited')); });
    return worker;
  }
  setReferenced(worker, referenced) {
    for (const handle of [worker.child, worker.child.stdin, worker.child.stdout, worker.child.stderr]) (referenced ? handle?.ref : handle?.unref)?.call(handle);
  }
  assign(worker, job) {
    clearTimeout(worker.idle); worker.idle = null; worker.job = job; worker.chunks = []; worker.size = 0; worker.errorSize = 0;
    this.setReferenced(worker, true);
    job.timer = setTimeout(() => this.retire(worker, new ApiError(422, 'RULE_TIMEOUT', 'Extension rules exceeded their execution deadline')), job.deadline);
    worker.child.stdin.write(Buffer.concat([Buffer.from(job.input), Buffer.from('\n')]));
  }
  receive(worker, chunk) {
    const job = worker.job;
    if (!job) { this.retire(worker, new Error('Unexpected rule worker output')); return; }
    worker.size += chunk.length;
    if (worker.size > 2 * 1024 * 1024 + 1) { this.retire(worker, new ApiError(422, 'RULE_OUTPUT_LIMIT', 'Extension rules exceeded their output limit')); return; }
    const newline = chunk.indexOf(10);
    if (newline < 0) { worker.chunks.push(chunk); return; }
    const stdout = Buffer.concat([...worker.chunks, chunk.subarray(0, newline)]), extra = newline + 1 < chunk.length;
    clearTimeout(job.timer); worker.job = null; worker.chunks = []; worker.served++; worker.lastUsed = Date.now();
    job.resolve({ code: 0, stdout });
    // A worker owes exactly one reply line per request.
    if (extra) { this.retire(worker, new Error('Unexpected rule worker output')); return; }
    if (worker.served >= WORKER_REQUESTS) this.release(worker);
    else { this.setReferenced(worker, false); worker.idle = setTimeout(() => this.release(worker), WORKER_IDLE_MS); worker.idle.unref?.(); }
    this.dispatch(worker.pool);
  }
  release(worker) {
    if (worker.done) return;
    worker.done = true; clearTimeout(worker.idle); worker.pool.workers.delete(worker);
    worker.child.stdin.end();
    const kill = setTimeout(() => worker.child.kill('SIGKILL'), 2000); kill.unref?.();
    this.dispatch(worker.pool);
  }
  retire(worker, error) {
    if (worker.done) return;
    worker.done = true; clearTimeout(worker.idle); worker.pool.workers.delete(worker);
    worker.child.kill('SIGKILL');
    const job = worker.job; worker.job = null;
    if (job) {
      clearTimeout(job.timer);
      if (this.closed) job.reject(new ApiError(503, 'RULE_UNAVAILABLE', 'Rule execution interrupted'));
      // A reused worker can die between requests; give its job one fresh worker.
      else if (!(error instanceof ApiError) && worker.served > 0 && !job.retried) { job.retried = true; worker.pool.queue.unshift(job); }
      else job.reject(error);
    }
    this.dispatch(worker.pool);
  }
  developmentProjection(request) {
    let result;
    switch (request.op) {
      case 'validateBank': result = { valid: true }; break;
      case 'project': result = { projected: cloneJson(request.data) }; break;
      case 'projectBatch': result = { projected: request.questions.map(question => cloneJson(question.data)) }; break;
      case 'outlineBatch': result = { outlineItems: request.questions.map(() => []) }; break;
      case 'capabilities': result = { canAiGrade: false, canOutlineItems: false }; break;
      default: throw new ApiError(422, 'DEVELOPMENT_NOT_IMPLEMENTED', messages.DEVELOPMENT_NOT_IMPLEMENTED);
    }
    if (request.withCapabilities === true) result.capabilities = { canAiGrade: false, canOutlineItems: false };
    if (jsonBytes(result).length > 2 * 1024 * 1024) throw new ApiError(422, 'RULE_OUTPUT_LIMIT', 'Development projection exceeded the rule output limit');
    return result;
  }
  close() {
    this.closed = true;
    for (const pool of this.pools.values()) for (const job of pool.queue.splice(0)) job.reject(new ApiError(503, 'RULE_UNAVAILABLE', 'Rule execution interrupted'));
    for (const worker of this.workers()) this.retire(worker, new ApiError(503, 'RULE_UNAVAILABLE', 'Rule execution interrupted'));
    this.pools.clear();
    for (const child of this.children) child.kill('SIGKILL');
  }
}
