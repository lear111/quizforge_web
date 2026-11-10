import { timed } from './timing.js';
import { createHash } from 'node:crypto';

// Retain the distinction between Jackson integer and floating-point nodes.
// Metadata never changes the public JSON value or extension schema validation.
const numericSources = new WeakMap();
export function parseJson(input, { maxDepth = 64, maxStringLength = 2_000_000, maxNumberLength = 100 } = {}) {
  const source = typeof input === 'string' ? input : new TextDecoder('utf-8', { fatal: true }).decode(input);
  const numberPattern = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
  let position = 0;
  const invalid = message => { throw new SyntaxError(`${message} at JSON offset ${position}`); };
  const whitespace = () => { while (/[\x20\t\r\n]/.test(source[position] ?? '\0')) position++; };
  function string() {
    const start = position++;
    for (;;) {
      if (position >= source.length) invalid('Unterminated string');
      const char = source[position++];
      if (char === '"') {
        const result = JSON.parse(source.slice(start, position));
        if (result.length > maxStringLength) invalid('String length limit');
        return result;
      }
      if (char.charCodeAt(0) < 32) invalid('Unescaped control character');
      if (char === '\\') {
        if (!/^["\\/bfnrtu]$/.test(source[position] ?? '')) invalid('Invalid string escape');
        if (source[position++] === 'u') {
          if (!/^[a-fA-F0-9]{4}$/.test(source.slice(position, position + 4))) invalid('Invalid Unicode escape');
          position += 4;
        }
      }
    }
  }
  function remember(parent, key, start, result) {
    if (typeof result !== 'number') return;
    const literal = source.slice(start, position);
    const metadata = numericSources.get(parent) ?? new Map();
    metadata.set(String(key), { literal, value: result });
    numericSources.set(parent, metadata);
  }
  function value(depth) {
    whitespace();
    const char = source[position];
    if (char === '"') return string();
    if (char === '{' || char === '[') {
      if (depth >= maxDepth) invalid('Nesting depth limit');
      const object = char === '{', result = object ? {} : [];
      const keys = new Set();
      position++; whitespace();
      const closing = object ? '}' : ']';
      if (source[position] === closing) { position++; return result; }
      for (;;) {
        whitespace();
        let key = result.length;
        if (object) {
          if (source[position] !== '"') invalid('Expected property name');
          key = string();
          if (keys.has(key)) invalid('Duplicate property');
          keys.add(key); whitespace();
          if (source[position++] !== ':') invalid('Expected colon');
          whitespace();
        }
        const start = position, child = value(depth + 1);
        Object.defineProperty(result, key, { value: child, configurable: true, enumerable: true, writable: true });
        remember(result, key, start, child);
        whitespace();
        if (source[position] === closing) { position++; break; }
        if (source[position++] !== ',') invalid('Expected comma');
      }
      return result;
    }
    for (const [literal, result] of [['true', true], ['false', false], ['null', null]]) {
      if (source.startsWith(literal, position)) { position += literal.length; return result; }
    }
    numberPattern.lastIndex = position;
    const number = numberPattern.exec(source);
    if (!number) invalid('Invalid value');
    if (number[0].length > maxNumberLength) invalid('Number length limit');
    position += number[0].length;
    const result = Number(number[0]);
    if (!Number.isFinite(result)) invalid('Non-finite number');
    return result;
  }
  const result = value(0); whitespace();
  if (position !== source.length) invalid('Trailing tokens');
  return result;
}
function javaNumber(number, literal) {
  if (!/[.eE]/.test(literal)) return BigInt(literal).toString();
  if (Object.is(number, -0)) return '-0.0';
  if (number === 0) return '0.0';
  const absolute = Math.abs(number);
  if (absolute >= 0.001 && absolute < 1e7) {
    const output = String(number);
    return output.includes('.') ? output : `${output}.0`;
  }
  const [coefficient, exponent] = number.toExponential().split('e');
  return `${coefficient.includes('.') ? coefficient : coefficient + '.0'}E${Number(exponent)}`;
}
export function stringifyJson(value, { canonical = false } = {}) {
  const seen = new Set();
  function encode(current, parent, key) {
    if (current === null || current === undefined) return 'null';
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) throw new TypeError('Non-finite JSON number');
      const original = parent && numericSources.get(parent)?.get(String(key));
      return original && Object.is(original.value, current) ? javaNumber(current, original.literal) : JSON.stringify(current);
    }
    if (typeof current === 'string' || typeof current === 'boolean') return JSON.stringify(current);
    if (typeof current !== 'object') throw new TypeError('Unsupported JSON value');
    if (seen.has(current)) throw new TypeError('Cyclic JSON value');
    seen.add(current);
    let result;
    if (Array.isArray(current)) result = '[' + current.map((child, index) => encode(child, current, index)).join(',') + ']';
    else {
      const names = Object.keys(current);
      if (canonical) names.sort();
      result = '{' + names.filter(name => current[name] !== undefined).map(name => JSON.stringify(name) + ':' + encode(current[name], current, name)).join(',') + '}';
    }
    seen.delete(current);
    return result;
  }
  return encode(value, null, null);
}
export function jsonBytes(value, options) { return Buffer.from(stringifyJson(value, options), 'utf8'); }
export function cloneJson(value) { return timed('clone', () => value === undefined ? undefined : parseJson(stringifyJson(value))); }
/** Copy selected own fields without losing numeric node kinds. Array fields
 * are projected to consecutive indexes; object fields retain the given order.
 * Child containers are borrowed and must already belong to a frozen graph. */
export function projectJson(value, fields) {
  return timed('clone', () => {
    const result = Array.isArray(value) ? [] : {}, metadata = new Map(), source = numericSources.get(value);
    for (const field of fields) {
      if (!Object.hasOwn(value, field)) continue;
      const key = Array.isArray(result) ? String(result.length) : String(field);
      let child = value[field];
      if (typeof child === 'number') {
        if (!Number.isFinite(child)) throw new TypeError('Non-finite JSON number');
        const original = source?.get(String(field));
        // Refresh this node exactly as cloneJson's serialize/parse boundary:
        // stale literals cannot reappear after a later assignment, integer -0
        // becomes 0, and newly computed exponent numbers gain their node kind.
        const literal = original && Object.is(original.value, child) ? javaNumber(child, original.literal) : JSON.stringify(child);
        child = Number(literal); metadata.set(key, { literal, value: child });
      }
      Object.defineProperty(result, key, { value: child, enumerable: true, configurable: true, writable: true });
    }
    if (metadata.size) numericSources.set(result, metadata);
    return result;
  });
}
export function shallowCopyJson(value) { return projectJson(value, Object.keys(value)); }
/** Committed state is deeply immutable. Incremental walks may stop at nodes
 * previously frozen by this boundary; full loads also inspect frozen roots. */
export function freezeJson(value, { incremental = true } = {}) {
  if (value !== null && typeof value === 'object' && (!incremental || !Object.isFrozen(value))) {
    for (const child of Object.values(value)) freezeJson(child, { incremental });
    Object.freeze(value);
  }
  return value;
}
export function fingerprint(value, namespace) {
  return createHash('sha256').update(namespace, 'utf8').update(Buffer.from([0])).update(jsonBytes(value, { canonical: true })).digest('hex');
}
export function hash(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
export function jsonEqual(left, right) { return stringifyJson(left, { canonical: true }) === stringifyJson(right, { canonical: true }); }
export function integralField(parent, key) {
  const value = parent?.[key], source = parent && numericSources.get(parent)?.get(String(key));
  return typeof value === 'number' && Number.isSafeInteger(value) && (!source || !Object.is(source.value, value) || !/[.eE]/.test(source.literal));
}
/** Sum finite decimal JSON numbers without binary floating point accumulation. */
export function decimalSum(values) {
  let total = 0n, scale = 0;
  for (const value of values) {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError('Invalid decimal');
    const [mantissa, exponent = '0'] = String(value).toLowerCase().split('e');
    const digits = mantissa.replace('.', ''), places = (mantissa.split('.')[1]?.length ?? 0) - Number(exponent);
    const nextScale = Math.max(scale, places, 0);
    total = total * 10n ** BigInt(nextScale - scale) + BigInt(digits) * 10n ** BigInt(nextScale - places);
    scale = nextScale;
  }
  const result = Number(`${total}e-${scale}`);
  if (!Number.isFinite(result)) throw new TypeError('Decimal total exceeds range');
  return result;
}
