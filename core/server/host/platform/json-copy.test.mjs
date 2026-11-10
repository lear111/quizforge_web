import test from 'node:test';
import assert from 'node:assert/strict';
import {parseJson, cloneJson, shallowCopyJson, projectJson, freezeJson, stringifyJson, integralField, fingerprint, jsonEqual} from './json.js';

const source = '{"n":1.0,"big":9223372036854775807,"exp":1e7,"negative":-0.0,"integerZero":-0,"child":{"n":2.0},"__proto__":{"safe":true}}';
test('shallow copy preserves numeric source metadata, order, prototype safety and shared children', () => {
  const value=parseJson(source), copy=shallowCopyJson(value), deep=cloneJson(value);
  assert.equal(stringifyJson(copy),stringifyJson(deep));assert.deepEqual(Object.keys(copy),Object.keys(value));
  assert.equal(copy.child,value.child);assert.equal(Object.getPrototypeOf(copy),Object.prototype);assert.ok(Object.hasOwn(copy,'__proto__'));
  for(const key of ['n','big','exp','negative','integerZero'])assert.equal(integralField(copy,key),integralField(deep,key),key);
  assert.equal(Object.is(copy.integerZero,-0),false);assert.equal(Object.is(copy.negative,-0),true);
  copy.n=3;assert.equal(stringifyJson(copy).startsWith('{"n":3,'),true);assert.equal(stringifyJson(value),stringifyJson(deep));
  copy.n=1;assert.equal(integralField(copy,'n'),false);assert.match(stringifyJson(copy),/"n":1\.0/);
});
test('projection remaps numeric metadata when array positions move', () => {
  const value=parseJson('[1.0,9223372036854775807,2e2,-0.0,-0]');
  assert.equal(stringifyJson(shallowCopyJson(value)),stringifyJson(cloneJson(value)));
  const selected=projectJson(value,['4','1','0','3','2']);
  assert.equal(stringifyJson(selected),'[0,9223372036854775807,1.0,-0.0,200.0]');
  assert.equal(integralField(selected,0),true);assert.equal(integralField(selected,2),false);
  const object=projectJson(parseJson(source),['big','n','child']);
  assert.equal(stringifyJson(object),'{"big":9223372036854775807,"n":1.0,"child":{"n":2.0}}');
});
test('freezing retains numericSources/integralField on frozen parent identities', () => {
  const value=freezeJson(parseJson(source));assert.ok(Object.isFrozen(value.child));
  assert.equal(integralField(value,'n'),false);assert.equal(integralField(value,'big'),false);
  assert.equal(integralField(value,'integerZero'),true);assert.equal(integralField(value.child,'n'),false);
  const copy=shallowCopyJson(value);assert.equal(stringifyJson(copy),stringifyJson(value));assert.ok(!Object.isFrozen(copy));
});
test('stringifyJson preserves frozen graphs and repeated shared DAG branches', () => {
  const value=parseJson(source), before=stringifyJson(value);freezeJson(value);assert.equal(stringifyJson(value),before);
  assert.equal(stringifyJson(freezeJson({a:value.child,b:value.child})),'{"a":{"n":2.0},"b":{"n":2.0}}');
});
test('jsonEqual works across frozen graphs and metadata-preserving copies', () => {
  const value=parseJson(source), copy=shallowCopyJson(value);freezeJson(value);freezeJson(copy);
  assert.ok(jsonEqual(value,copy));assert.ok(!jsonEqual(value,{...value}));
});
test('fingerprint is unchanged by full and incremental freeze', () => {
  const value=parseJson(source), before=fingerprint(value,'freeze-test');freezeJson(value);
  assert.equal(fingerprint(value,'freeze-test'),before);assert.equal(fingerprint(freezeJson(shallowCopyJson(value)),'freeze-test'),before);
});
test('incremental freeze stops at deeply frozen nodes and freezes new branches', () => {
  const shared=freezeJson({nested:{value:1}}), next={shared,changed:{points:[1,2]}};
  freezeJson(next);assert.equal(next.shared,shared);assert.ok(Object.isFrozen(next.changed.points));
  assert.throws(()=>{next.shared.nested.value=2;},TypeError);assert.throws(()=>{next.changed.points.push(3);},TypeError);
  const shallow=Object.freeze({child:{n:1}});freezeJson(shallow,{incremental:false});assert.ok(Object.isFrozen(shallow.child));
  let visits=0;const barrier=Object.freeze({get child(){visits++;return shared;}});
  freezeJson({barrier});assert.equal(visits,0,'an already-frozen container is not traversed again');
});
