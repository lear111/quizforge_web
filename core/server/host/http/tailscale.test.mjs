import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTailscale, TailscaleProbe, tailscaleCommand } from './tailscale.js';

const status = (overrides = {}) => JSON.stringify({ BackendState: 'Running', Self: { DNSName: 'WGS.tailfa563c.ts.net.', TailscaleIPs: ['100.66.52.108', 'fd7a:115c:a1e0::2e:346d', '192.168.1.5'] }, ...overrides });
const serve = (proxy, address = 'wgs.tailfa563c.ts.net:443') => JSON.stringify({ TCP: { 443: { HTTPS: true } }, Web: { [address]: { Handlers: { '/': { Proxy: proxy } } } } });

test('a running client with an HTTPS forward to the connection port gives its ts.net address', () => {
  assert.deepEqual(parseTailscale(status(), serve('http://127.0.0.1:8788'), 8788), { state: 'running', name: 'wgs.tailfa563c.ts.net', ips: ['100.66.52.108', 'fd7a:115c:a1e0::2e:346d'], url: 'https://wgs.tailfa563c.ts.net/', otherPort: null });
  assert.equal(parseTailscale(status(), serve('localhost:8788', 'wgs.tailfa563c.ts.net:8443'), 8788).url, 'https://wgs.tailfa563c.ts.net:8443/');
});

test('a forward to another port, another host or a non-local target is not used', () => {
  assert.deepEqual(parseTailscale(status(), serve('http://127.0.0.1:8795'), 8788), { state: 'running', name: 'wgs.tailfa563c.ts.net', ips: ['100.66.52.108', 'fd7a:115c:a1e0::2e:346d'], url: null, otherPort: 8795 });
  assert.equal(parseTailscale(status(), serve('http://127.0.0.1:8788', 'other.tailfa563c.ts.net:443'), 8788).url, null);
  assert.equal(parseTailscale(status(), serve('http://192.168.1.9:8788'), 8788).url, null);
  assert.equal(parseTailscale(status(), '{}', 8788).url, null);
  assert.equal(parseTailscale(status(), 'not json', 8788).url, null);
});

test('stopped, logged-out and malformed clients have no address', () => {
  assert.deepEqual(parseTailscale(status({ BackendState: 'Stopped' }), '{}', 8788), { state: 'stopped' });
  assert.deepEqual(parseTailscale(status({ BackendState: 'NeedsLogin' }), '{}', 8788), { state: 'stopped' });
  assert.deepEqual(parseTailscale(status({ Self: { DNSName: 'evil.example.com.' } }), '{}', 8788), { state: 'stopped' });
  assert.deepEqual(parseTailscale('garbage', '{}', 8788), { state: 'unavailable' });
});

test('the probe caches per port, re-reads when forced and reports a missing client', async () => {
  const calls = [];
  const probe = new TailscaleProbe({ command: 'tailscale', execute: async (command, args) => { calls.push(args.join(' ')); return { stdout: args[0] === 'status' ? status() : serve('http://127.0.0.1:8788') }; } });
  assert.equal((await probe.read(8788)).url, 'https://wgs.tailfa563c.ts.net/');
  await probe.read(8788); assert.equal(calls.length, 2, 'cached');
  await probe.read(8788, { force: true }); assert.equal(calls.length, 4);
  assert.equal((await probe.read(9000)).url, null, 'a new port re-reads'); assert.equal(calls.length, 6);
  const missing = new TailscaleProbe({ execute: async () => { throw Object.assign(new Error('spawn tailscale ENOENT'), { code: 'ENOENT' }); } });
  assert.deepEqual(await missing.read(8788), { state: 'missing' });
  const failing = new TailscaleProbe({ execute: async () => { throw Object.assign(new Error('exit 1'), { code: 1 }); } });
  assert.deepEqual(await failing.read(8788), { state: 'stopped' });
  assert.equal(tailscaleCommand('linux', () => true), 'tailscale');
  assert.equal(tailscaleCommand('win32', () => true), 'C:\\Program Files\\Tailscale\\tailscale.exe');
  assert.equal(tailscaleCommand('win32', () => false), 'tailscale');
});
