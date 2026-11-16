import fs from 'node:fs';
import path from 'node:path';
import { createReadFixture } from './v2-banks.mjs';
import { V2Server } from '../../server/v2/app.js';

export async function restartFixture(t, count = 6) {
  const fixture = createReadFixture({ count });
  t.after(() => fixture.cleanup());
  const server = await new V2Server(fixture).start();
  t.after(() => server.close());
  const api = async (route, body, method = 'POST') => {
    const response = await fetch(`http://127.0.0.1:${server.port()}` + route,
      body === undefined ? {} : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, value: await response.json() };
  };
  const catalog = (await api('/api/v2/catalog')).value;
  const bankId = catalog.groups[0].items[0].bankId;
  const base = `/api/v2/banks/${bankId}`;
  const opened = (await api(base + '/overview')).value;
  const input = { requestId: 'restart-once', snapshotId: opened.snapshotId };
  const library = server.library;
  const snapshot = library.opened.get(bankId);
  const finish = () => api(base + '/finish', { requestId: 'finish', snapshotId: opened.snapshotId });
  const restart = (body = input) => api(base + '/restart', body);
  const rounds = () => {
    const root = path.join(fixture.directory, '.qf-v2', 'rounds');
    return fs.existsSync(root) ? fs.readdirSync(root).map(id => path.join(root, id)) : [];
  };
  return { ...fixture, api, server, library, snapshot, base, bankId, input, finish, restart, rounds };
}
