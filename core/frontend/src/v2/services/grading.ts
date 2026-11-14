// The host supplies only answers returned by a successful submit/lock request.
// Author code is evaluated only inside the opaque iframe's dedicated Worker.
export interface GradingInput {
  questionId: string;
  question: unknown;
  solution: unknown;
  answer: unknown;
  item: unknown;
}
import type { GradeResult } from '../../../../shared/v2/state.js';
export type { GradeResult } from '../../../../shared/v2/state.js';
export interface GradingOutput {
  questionId: string;
  result: GradeResult;
}
interface Environment {
  frame: HTMLIFrameElement;
  ready: Promise<void>;
  run(items: GradingInput[]): Promise<GradingOutput[]>;
  destroy(): void;
}
export interface GradingOptions {
  loadSource(artifactId: string, signal: AbortSignal): Promise<string>;
  document?: Document;
  timeoutMs?: number;
  idleMs?: number;
  /** Trusted host boot-script nonce, so srcdoc also satisfies the parent CSP. */
  scriptNonce?: string;
}

export const ungradable = (message: string): GradeResult => ({ score: null, parts: null, message });
const unavailable = (items: GradingInput[], reason: string): GradingOutput[] =>
  items.map(({ questionId }) => ({
    questionId,
    result: ungradable(reason),
  }));
// Worker messages are untrusted. A grade function can return only a score and
// optional parts; the host assigns the error message and the server checks scores.
function normalize(items: GradingInput[], results: unknown): GradingOutput[] {
  return items.map(({ questionId }) => {
    const entries = Array.isArray(results)
      ? results.filter(
          (entry) => entry && typeof entry === 'object' && entry.questionId === questionId,
        )
      : [];
    const entry = entries.length === 1 ? entries[0] : null;
    const result = entry?.result;
    if (typeof entry?.error === 'string' && entry.error.trim()) {
      return { questionId, result: ungradable(entry.error) };
    }
    const invalid = () => ({ questionId, result: ungradable('题型返回的评分结果无效。') });
    if (
      !result ||
      typeof result !== 'object' ||
      Array.isArray(result) ||
      !Object.hasOwn(result, 'score') ||
      Object.keys(result).some((key) => key !== 'score' && key !== 'parts')
    ) {
      return invalid();
    }
    if (result.score === null) {
      return Object.hasOwn(result, 'parts')
        ? invalid()
        : { questionId, result: { score: null, parts: null, message: null } };
    }
    if (typeof result.score !== 'number' || !Number.isFinite(result.score)) {
      return invalid();
    }
    const parts = Object.hasOwn(result, 'parts') ? result.parts : null;
    if (
      Object.hasOwn(result, 'parts') &&
      (!parts ||
        typeof parts !== 'object' ||
        Array.isArray(parts) ||
        !Object.values(parts).every(Number.isFinite))
    ) {
      return invalid();
    }
    return { questionId, result: { score: result.score, parts, message: null } };
  });
}
const literal = (value: unknown) => JSON.stringify(value).replaceAll('<', '\\u003c');
// getRandomValues also works on the HTTP LAN pages used by phones.
const randomId = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (value) =>
    value.toString(16).padStart(2, '0'),
  ).join('');

function createEnvironment(doc: Document, source: string, scriptNonce?: string): Environment {
  const view = doc.defaultView!;
  const channel = randomId(),
    nonce = scriptNonce ?? randomId();
  const nonceAttribute = nonce
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;');
  const frame = doc.createElement('iframe');
  frame.hidden = true;
  frame.title = '题型评分环境';
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.setAttribute('aria-hidden', 'true');
  const workerSource = `
    let grader;
    const QF = Object.freeze({grader: Object.freeze({register(value) { grader = value; }})});
    ${source}
    self.onmessage = async ({data}) => {
      const results = [];
      for (const entry of data.items) {
        try {
          const result = structuredClone(await grader.grade(entry.question, entry.solution, entry.answer, entry.item));
          results.push({questionId: entry.questionId, result});
        } catch (error) {
          results.push({questionId: entry.questionId, error: typeof error?.message === 'string' && error.message.trim() ? error.message : '该题评分失败。'});
        }
      }
      self.postMessage({job: data.job, results});
    };
    self.postMessage({ready:true});`;
  frame.srcdoc = `<!doctype html><meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonceAttribute}'; worker-src blob:; connect-src 'none'; form-action 'none'; base-uri 'none'">
    <script nonce="${nonceAttribute}">
      const channel = ${literal(channel)};
      const send = value => parent.postMessage({...value, channel}, '*');
      let worker;
      try {
        const url = URL.createObjectURL(new Blob([${literal(workerSource)}], {type:'text/javascript'}));
        worker = new Worker(url); URL.revokeObjectURL(url);
        worker.onmessage = ({data}) => send(data);
        worker.onerror = event => { event.preventDefault(); send({error:true}); };
        addEventListener('message', event => {
          if (event.source === parent && event.data?.channel === channel) worker.postMessage(event.data);
        });
      } catch { send({error:true}); }
    </script>`;
  let resolveReady!: () => void, rejectReady!: (error: Error) => void;
  let pending: {
    job: string;
    resolve(value: GradingOutput[]): void;
    reject(error: Error): void;
  } | null = null;
  let disposed = false;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  // Creation and caller attachment occur in the same turn, but disposal can
  // reject a not-yet-awaited handshake. Keep that rejection observed.
  void ready.catch(() => {});
  const receive = (event: MessageEvent) => {
    if (disposed || event.source !== frame.contentWindow || event.data?.channel !== channel) {
      return;
    }
    if (event.data.error) {
      rejectReady(new Error('评分环境未能启动。'));
      pending?.reject(new Error('评分环境执行失败。'));
    } else if (event.data.ready === true) {
      resolveReady();
    } else if (pending && event.data.job === pending.job) {
      const task = pending;
      pending = null;
      task.resolve(event.data.results);
    }
  };
  view.addEventListener('message', receive);
  doc.body.append(frame);
  return {
    frame,
    ready,
    async run(items) {
      await ready;
      if (disposed) {
        throw new Error('评分环境已关闭。');
      }
      return new Promise((resolve, reject) => {
        const job = randomId();
        pending = { job, resolve, reject };
        try {
          frame.contentWindow!.postMessage({ channel, job, items }, '*');
        } catch (error) {
          pending = null;
          reject(error);
        }
      });
    },
    destroy() {
      if (disposed) {
        return;
      }
      disposed = true;
      view.removeEventListener('message', receive);
      // Removing the owning frame terminates its Worker, including a busy loop.
      frame.remove();
      rejectReady(new Error('评分环境已关闭。'));
      pending?.reject(new Error('评分环境已关闭。'));
      pending = null;
    },
  };
}

export function createGradingService(options: GradingOptions) {
  const doc = options.document ?? document;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const idleMs = options.idleMs ?? 60_000;
  const slots = new Map<
    string,
    {
      environment: Environment | null;
      tail: Promise<unknown>;
      cancel: (() => void) | null;
      idleTimer: ReturnType<typeof setTimeout> | null;
    }
  >();
  let closed = false;
  return {
    grade(artifactId: string, items: GradingInput[]): Promise<GradingOutput[]> {
      if (closed) {
        return Promise.resolve(unavailable(items, '评分环境已关闭。'));
      }
      let slot = slots.get(artifactId);
      if (!slot) {
        slot = { environment: null, tail: Promise.resolve(), cancel: null, idleTimer: null };
        slots.set(artifactId, slot);
      }
      const current = slot;
      const task = current.tail.then(
        () =>
          new Promise<GradingOutput[]>((resolve) => {
            if (closed) {
              resolve(unavailable(items, '评分环境已关闭。'));
              return;
            }
            if (current.idleTimer !== null) {
              clearTimeout(current.idleTimer);
              current.idleTimer = null;
            }
            const controller = new AbortController();
            let done = false;
            const finish = (value: GradingOutput[], destroy = false) => {
              if (done) {
                return;
              }
              done = true;
              clearTimeout(timer);
              current.cancel = null;
              controller.abort();
              if (destroy) {
                current.environment?.destroy();
                current.environment = null;
              }
              if (!closed) {
                current.idleTimer = setTimeout(() => {
                  current.environment?.destroy();
                  current.environment = null;
                  if (slots.get(artifactId) === current) {
                    slots.delete(artifactId);
                  }
                }, idleMs);
              }
              resolve(value);
            };
            const timer = setTimeout(
              () => finish(unavailable(items, '评分超时，请重新评分。'), true),
              timeoutMs,
            );
            current.cancel = () => finish(unavailable(items, '评分环境已关闭。'), true);
            void (async () => {
              try {
                if (!current.environment) {
                  const source = await options.loadSource(artifactId, controller.signal);
                  if (done) {
                    return;
                  }
                  current.environment = createEnvironment(doc, source, options.scriptNonce);
                }
                const result = await current.environment.run(items);
                finish(normalize(items, result));
              } catch {
                finish(unavailable(items, '评分环境执行失败，请重试。'), true);
              }
            })();
          }),
      );
      current.tail = task.catch(() => {});
      return task;
    },
    dispose() {
      closed = true;
      for (const slot of slots.values()) {
        slot.cancel?.();
        if (slot.idleTimer !== null) {
          clearTimeout(slot.idleTimer);
        }
        slot.environment?.destroy();
      }
      slots.clear();
    },
  };
}
