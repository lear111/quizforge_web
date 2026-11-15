import { mergeAnswered } from '../../../../../shared/v2/answered.js';
import type { Answered } from '../../../../../shared/v2/answered.js';
import { post } from './channel';
import type { InputKind, PageAction, PageMessage, PageOptions, PageSession } from './types';

const inputKinds: readonly unknown[] = ['choice', 'text', 'ink'];
const actions: readonly unknown[] = ['submit', 'retry'];
function inputKind(value: unknown): value is InputKind {
  return inputKinds.includes(value);
}
function pageAction(value: unknown): value is PageAction {
  return actions.includes(value);
}

function changed(session: PageSession, data: PageMessage, options: PageOptions) {
  if (!inputKind(data.inputKind)) {
    return;
  }
  let answered: Answered | undefined;
  try {
    if (Object.hasOwn(data, 'answered')) {
      answered = mergeAnswered(data.answered, session.context.item);
    }
  } catch {
    return;
  }
  options.onChanged?.(data.inputKind, answered);
}
function actionReply(session: PageSession, scope: number, request: unknown, error?: string) {
  if (!session.disposed) {
    session.frame.contentWindow?.postMessage(
      {
        channel: session.channel,
        version: scope,
        kind: 'action-result',
        request,
        ...(error ? { error } : {}),
      },
      '*',
    );
  }
}
function action(session: PageSession, data: PageMessage, options: PageOptions) {
  if (!pageAction(data.action) || !Number.isSafeInteger(data.request)) {
    return;
  }
  const scope = session.version,
    request = data.request;
  const reply = (error?: string) => actionReply(session, scope, request, error);
  const callback = data.action === 'submit' ? options.onSubmit : options.onRetry;
  if (
    session.faulted ||
    session.actionRunning ||
    !session.context.can?.[data.action] ||
    !callback
  ) {
    reply('当前不允许此操作。');
    return;
  }
  session.actionRunning = true;
  void Promise.resolve()
    .then(callback)
    .then(
      () => reply(),
      () => reply('操作未完成，请查看宿主提示并重试。'),
    )
    .finally(() => {
      session.actionRunning = false;
    });
}
function response(session: PageSession, data: PageMessage) {
  const request = session.pending.get(data.request);
  if (!request || request.kind !== data.kind) {
    return;
  }
  session.pending.delete(data.request);
  if (data.error) {
    if (data.kind === 'updated') {
      session.faulted = true;
    }
    request.reject(
      new Error(
        data.kind === 'updated' ? '题型页面更新失败，请重新打开本题。' : '无法读取作答，请重试。',
      ),
    );
  } else {
    request.resolve(data.value);
  }
}
function lifecycle(session: PageSession, data: PageMessage, options: PageOptions) {
  if (data.kind === 'initialized' && !session.initialized) {
    session.initialized = true;
    post(session, 'load', session.initialContext, options.resources ?? []);
  }
  if (data.kind === 'ready') {
    session.resolveReady();
  }
  if (data.kind === 'error') {
    session.faulted = true;
    session.rejectReady(new Error('题型页面未能加载，请重新打开本题。'));
  }
}
export function messageHandler(session: PageSession, options: PageOptions) {
  return (event: MessageEvent<PageMessage | null>) => {
    const data = event.data;
    if (
      session.disposed ||
      event.source !== session.frame.contentWindow ||
      data?.channel !== session.channel ||
      data.version !== session.version
    ) {
      return;
    }
    lifecycle(session, data, options);
    if (data.kind === 'changed') {
      changed(session, data, options);
    }
    if (
      data.kind === 'height' &&
      typeof data.height === 'number' &&
      Number.isFinite(data.height) &&
      data.height > 0
    ) {
      session.frame.style.height = `${Math.ceil(data.height)}px`;
    }
    if (data.kind === 'action') {
      action(session, data, options);
    }
    if (data.kind === 'answer' || data.kind === 'updated') {
      response(session, data);
    }
  };
}
