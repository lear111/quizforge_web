import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { V2Server } from '../../server/v2/app.js';
import { createReadFixture, SOLUTION_MARKER } from '../fixtures/v2-banks.mjs';

function hashes(directory, prefix = '') {
  return fs
    .readdirSync(directory)
    .sort()
    .flatMap((name) => {
      const file = path.join(directory, name),
        id = prefix + '/' + name;
      return fs.lstatSync(file).isDirectory()
        ? hashes(file, id)
        : [[id, createHash('sha256').update(fs.readFileSync(file)).digest('hex')]];
    });
}

async function running(t, options = {}) {
  const fixture = createReadFixture();
  t.after(() => fixture.cleanup());
  const server = await new V2Server({ ...fixture, ...options }).start();
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.port()}`;
  const get = async (route, init = {}) => {
    const response = await fetch(url + route, init),
      bytes = Buffer.from(await response.arrayBuffer()),
      text = bytes.toString('utf8');
    assert.ok(!text.includes(SOLUTION_MARKER), `solution leaked from ${route}`);
    return {
      response,
      bytes,
      text,
      body: response.headers.get('content-type')?.startsWith('application/json')
        ? JSON.parse(text)
        : null,
    };
  };
  const catalog = await get('/api/v2/catalog'),
    bankId = catalog.body.groups[0].items[0].bankId;
  const base = '/api/v2/banks/' + bankId;
  const open = async (questionId) =>
    get(base + '/overview' + (questionId ? '?questionId=' + questionId : ''));
  return { fixture, server, get, open, bankId, base, url };
}

export { hashes, running };
