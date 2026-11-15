import { gradingDocument, nonceAttribute, randomId } from './document.js';
import type { Environment, GradingInput } from './types.js';

interface Session {
  frame: HTMLIFrameElement;
  channel: string;
  ready: Promise<void>;
  resolveReady(): void;
  rejectReady(error: Error): void;
  pending: { job: string; resolve(value: unknown): void; reject(error: unknown): void } | null;
  disposed: boolean;
}

function createSession(frame: HTMLIFrameElement, channel: string): Session {
  let resolveReady!: () => void, rejectReady!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  // Disposal can reject a not-yet-awaited handshake. Keep that rejection observed.
  void ready.catch(() => {});
  return { frame, channel, ready, resolveReady, rejectReady, pending: null, disposed: false };
}

function receive(session: Session, event: MessageEvent): void {
  if (
    session.disposed ||
    event.source !== session.frame.contentWindow ||
    event.data?.channel !== session.channel
  ) {
    return;
  }
  if (event.data.error) {
    session.rejectReady(new Error('评分环境未能启动。'));
    session.pending?.reject(new Error('评分环境执行失败。'));
  } else if (event.data.ready === true) {
    session.resolveReady();
  } else if (session.pending && event.data.job === session.pending.job) {
    const task = session.pending;
    session.pending = null;
    task.resolve(event.data.results);
  }
}

async function run(session: Session, items: GradingInput[]): Promise<unknown> {
  await session.ready;
  if (session.disposed) {
    throw new Error('评分环境已关闭。');
  }
  return new Promise((resolve, reject) => {
    const job = randomId();
    session.pending = { job, resolve, reject };
    try {
      session.frame.contentWindow!.postMessage({ channel: session.channel, job, items }, '*');
    } catch (error) {
      session.pending = null;
      reject(error);
    }
  });
}

function destroy(session: Session, view: Window, listener: (event: MessageEvent) => void): void {
  if (session.disposed) {
    return;
  }
  session.disposed = true;
  view.removeEventListener('message', listener);
  // Removing the owning frame terminates its Worker, including a busy loop.
  session.frame.remove();
  session.rejectReady(new Error('评分环境已关闭。'));
  session.pending?.reject(new Error('评分环境已关闭。'));
  session.pending = null;
}

export function createEnvironment(
  doc: Document,
  source: string,
  scriptNonce?: string,
): Environment {
  const view = doc.defaultView!;
  const channel = randomId(),
    nonce = scriptNonce ?? randomId();
  const attribute = nonceAttribute(nonce);
  const frame = doc.createElement('iframe');
  frame.hidden = true;
  frame.title = '题型评分环境';
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.setAttribute('aria-hidden', 'true');
  frame.srcdoc = gradingDocument(source, channel, attribute);
  const session = createSession(frame, channel);
  const listener = (event: MessageEvent) => receive(session, event);
  view.addEventListener('message', listener);
  doc.body.append(frame);
  return {
    frame,
    ready: session.ready,
    run: (items) => run(session, items),
    destroy: () => destroy(session, view, listener),
  };
}
