import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { DesktopControl, reportDesktopFailure } from './desktop-control.js';

test('desktop failure reason is one bounded line for the launcher status', () => {
  const output = new PassThrough(); let messages = '';
  output.on('data', chunk => messages += chunk);
  reportDesktopFailure('缺少依赖：qrcode-generator\r\n第二行' + 'x'.repeat(400), output);
  assert.equal(messages.split('\n').length, 2);
  const failed = JSON.parse(messages.trim().slice('QUIZFORGE_DESKTOP '.length));
  assert.equal(failed.event, 'failed'); assert.equal(failed.pid, process.pid);
  assert.equal(failed.reason.length, 300); assert.ok(failed.reason.startsWith('缺少依赖：qrcode-generator 第二行x'));
});

test('desktop readiness waits for service start; a chunked exit is idempotent and private to stdin', () => {
  const input = new PassThrough(), output = new PassThrough(); let stops = 0, messages = '';
  output.on('data', chunk => messages += chunk);
  const desktop = new DesktopControl(() => stops++, { input, output });
  assert.equal(messages, ''); desktop.arm({ port: () => 12345 });
  const ready = JSON.parse(messages.trim().slice('QUIZFORGE_DESKTOP '.length));
  assert.equal(ready.event, 'ready'); assert.equal(ready.port, 12345);
  input.write('unknown\nqu'); assert.equal(stops, 0);
  input.write('it\nquit\n'); assert.equal(stops, 1); desktop.dispose();
});

test('exit requested during startup is deferred until the host is ready to close', () => {
  const input = new PassThrough(), output = new PassThrough(); let stops = 0, messages = '';
  output.on('data', chunk => messages += chunk);
  const desktop = new DesktopControl(() => stops++, { input, output });
  input.write('quit\n'); assert.equal(stops, 0);
  desktop.arm({ port: () => 12345 }); assert.equal(stops, 1); assert.equal(messages, ''); desktop.dispose();
});

test('launcher pipe loss requests shutdown instead of leaving a background host', async () => {
  const input = new PassThrough(), output = new PassThrough(); let stops = 0;
  const desktop = new DesktopControl(() => stops++, { input, output });
  desktop.arm({ port: () => 12345 }); input.end();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(stops, 1); desktop.dispose();
});
