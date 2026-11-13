import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseJson, jsonBytes, freezeJson, patchJson } from '../../server/host/platform/json.js';

test('JSON field patches retain unchanged numeric kinds, replace overwritten kinds and borrow frozen children', () => {
  const before = freezeJson(parseJson('{"answer":1.0,"ink":2.0,"draft":{"n":3.0},"removed":4.0}'));
  const fields = freezeJson(parseJson('{"ink":2,"removed":null,"__proto__":{"safe":true}}'));
  const after = patchJson(before, fields);
  assert.equal(jsonBytes(after).toString(), '{"answer":1.0,"ink":2,"draft":{"n":3.0},"removed":null,"__proto__":{"safe":true}}');
  assert.equal(after.draft, before.draft); assert.equal(after.__proto__, fields.__proto__);
  assert.equal(Object.getPrototypeOf(after), Object.prototype); assert.equal(Object.prototype.safe, undefined);
  assert.equal(jsonBytes(before).toString(), '{"answer":1.0,"ink":2.0,"draft":{"n":3.0},"removed":4.0}');
  assert.equal(jsonBytes(fields).toString(), '{"ink":2,"removed":null,"__proto__":{"safe":true}}');
});
