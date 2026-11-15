import type { PageContext, PageSession, Picture } from './types';

export function createSession(
  frame: HTMLIFrameElement,
  channel: string,
  context: PageContext,
): PageSession {
  let resolveReady!: () => void, rejectReady!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  void ready.catch(() => {});
  return {
    frame,
    channel,
    context,
    initialContext: context,
    ready,
    latest: ready,
    resolveReady,
    rejectReady,
    disposed: false,
    faulted: false,
    initialized: false,
    actionRunning: false,
    version: 0,
    sequence: 0,
    sent: new Set(),
    pending: new Map(),
  };
}

export function post(
  session: PageSession,
  kind: string,
  context?: PageContext,
  resources: Picture[] = [],
  request?: number,
) {
  const fresh = resources.filter((row) => !session.sent.has(row.assetId));
  for (const row of fresh) {
    session.sent.add(row.assetId);
  }
  session.frame.contentWindow!.postMessage(
    {
      channel: session.channel,
      version: session.version,
      kind,
      context,
      resources: fresh,
      request,
    },
    '*',
    fresh.map((row) => row.bytes),
  );
}
function checkOpen(session: PageSession) {
  if (session.disposed || session.faulted) {
    throw new Error(session.disposed ? '题目已关闭。' : '题型页面更新失败，请重新打开本题。');
  }
}
async function answer(session: PageSession) {
  await session.latest;
  checkOpen(session);
  return new Promise<unknown>((resolve, reject) => {
    const request = ++session.sequence;
    session.pending.set(request, { kind: 'answer', resolve, reject });
    post(session, 'answer', undefined, [], request);
  });
}
function update(session: PageSession, context: PageContext, resources: Picture[]) {
  session.latest = session.latest.then(() => {
    checkOpen(session);
    session.version++;
    session.context = context;
    for (const entry of session.pending.values()) {
      entry.reject(new Error('题目状态已更新。'));
    }
    session.pending.clear();
    return new Promise<void>((resolve, reject) => {
      const request = ++session.sequence;
      session.pending.set(request, { kind: 'updated', resolve: () => resolve(), reject });
      post(session, 'context', context, resources, request);
    });
  });
  void session.latest.catch(() => {});
  return session.latest;
}
function destroy(session: PageSession, handler: (event: MessageEvent) => void) {
  if (session.disposed) {
    return;
  }
  post(session, 'dispose');
  session.disposed = true;
  window.removeEventListener('message', handler);
  session.rejectReady(new Error('题目已关闭。'));
  for (const request of session.pending.values()) {
    request.reject(new Error('题目已关闭。'));
  }
  session.pending.clear();
  session.frame.remove();
}
export function pageHandle(session: PageSession, handler: (event: MessageEvent) => void) {
  return {
    ready: session.ready,
    frame: session.frame,
    answer: () => answer(session),
    hasResource: (assetId: string) => session.sent.has(assetId),
    get can() {
      return { ...session.context.can };
    },
    get faulted() {
      return session.faulted;
    },
    update: (context: PageContext, resources: Picture[] = []) =>
      update(session, context, resources),
    destroy: () => destroy(session, handler),
  };
}
