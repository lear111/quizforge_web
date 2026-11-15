import { childScript, pageChannel, pageDocument } from './page/document';
import { createSession, pageHandle } from './page/channel';
import { messageHandler } from './page/messages';
import type { PageContext, PageOptions, PageSources } from './page/types';
export type { PageContext, PageSources, Picture } from './page/types';

// Each question owns its iframe, channel, promises and transferred resources.
export function mountQuestionPage(
  container: HTMLElement,
  sources: PageSources,
  context: PageContext,
  nonce: string,
  options: PageOptions = {},
) {
  const frame = document.createElement('iframe'),
    channel = pageChannel();
  frame.title = `${options.title ?? '题目'}作答`;
  frame.setAttribute('sandbox', 'allow-scripts');
  const session = createSession(frame, channel, context);
  // Build author input before registering the listener, as in the original path.
  const runtime = childScript(channel, context, sources);
  const handler = messageHandler(session, options);
  window.addEventListener('message', handler);
  // Parent's nonce also applies to srcdoc's inherited CSP. The author receives
  // no host origin, network, forms, popups or top-level navigation capability.
  frame.srcdoc = pageDocument(sources, nonce, runtime);
  container.replaceChildren(frame);
  return pageHandle(session, handler);
}
