import { V2Server } from '../../server/v2/app.js';
import { createReadFixture } from '../fixtures/v2-banks.mjs';

async function setup(t) {
  const fixture = createReadFixture();
  t.after(() => fixture.cleanup());
  const server = await new V2Server(fixture).start();
  t.after(() => server.close());
  const api = async (route, body, method = 'GET', headers = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.port()}${route}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...headers,
      },
      ...(body === undefined
        ? {}
        : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
    });
    const text = await response.text();
    return { status: response.status, text, value: JSON.parse(text) };
  };
  const bankId = (await api('/api/v2/catalog')).value.groups[0].items[0].bankId,
    base = `/api/v2/banks/${bankId}`;
  const opened = (await api(base + '/overview')).value,
    snapshotId = opened.snapshotId;
  const store = server.library.stateStore,
    snapshot = server.library.opened.get(bankId),
    file = store.file(fixture.directory);
  const write = (op, input, id = '1') =>
    api(
      `${base}/questions/${id}/${op}`,
      { snapshotId, ...input },
      ['answer', 'ink', 'result'].includes(op) ? 'PUT' : 'POST',
    );
  return { fixture, server, api, base, snapshotId, store, snapshot, file, write };
}

export { setup };
