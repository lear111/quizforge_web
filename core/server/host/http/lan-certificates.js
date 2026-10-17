import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { X509Certificate, createHash, createPrivateKey, generateKeyPair, randomBytes, sign } from 'node:crypto';
import { jsonBytes } from '../platform/json.js';
import { exists, readBytes, readJson, replaceFile, safeDirectory } from '../platform/files.js';
import { ipv6Bytes } from './network-addresses.js';

// Node's crypto signs but cannot build X.509, so this file encodes the small
// DER subset a root CA and a TLS server certificate need.
const length = size => { if (size < 0x80) return Buffer.from([size]); const bytes = []; for (let value = size; value; value = Math.floor(value / 256)) bytes.unshift(value & 0xff); return Buffer.from([0x80 | bytes.length, ...bytes]); };
const tlv = (tag, ...parts) => { const body = Buffer.concat(parts); return Buffer.concat([Buffer.from([tag]), length(body.length), body]); };
const sequence = (...parts) => tlv(0x30, ...parts), set = (...parts) => tlv(0x31, ...parts), octets = bytes => tlv(0x04, bytes), utf8 = value => tlv(0x0c, Buffer.from(value, 'utf8'));
function integer(bytes) { let value = Buffer.from(bytes); while (value.length > 1 && value[0] === 0 && !(value[1] & 0x80)) value = value.subarray(1); if (value[0] & 0x80) value = Buffer.concat([Buffer.alloc(1), value]); return tlv(0x02, value); }
function oid(text) {
  const [first, second, ...rest] = text.split('.').map(Number), bytes = [40 * first + second];
  for (const part of rest) { const chunk = [part & 0x7f]; for (let value = part >>> 7; value; value >>>= 7) chunk.unshift(0x80 | value & 0x7f); bytes.push(...chunk); }
  return tlv(0x06, Buffer.from(bytes));
}
const time = date => { const text = date.toISOString().replace(/[-:T]/g, '').slice(0, 14) + 'Z'; return date.getUTCFullYear() < 2050 ? tlv(0x17, Buffer.from(text.slice(2))) : tlv(0x18, Buffer.from(text)); };
const extension = (id, critical, value) => sequence(oid(id), ...critical ? [tlv(0x01, Buffer.from([0xff]))] : [], octets(value));
const name = (common) => sequence(set(sequence(oid('2.5.4.10'), utf8('QuizForge'))), set(sequence(oid('2.5.4.3'), utf8(common))));
const algorithm = sequence(oid('1.2.840.113549.1.1.11'), tlv(0x05));
const keyId = publicKey => createHash('sha1').update(publicKey.export({ type: 'spki', format: 'der' })).digest();
const ipBytes = address => net.isIP(address) === 4 ? Buffer.from(address.split('.').map(Number)) : ipv6Bytes(address);
const dns = value => tlv(0x82, Buffer.from(value, 'ascii')), ip = bytes => tlv(0x87, bytes);
const day = 24 * 60 * 60 * 1000, generate = promisify(generateKeyPair);

export const LEAF_DAYS = 397, ROOT_YEARS = 10, RENEW_DAYS = 30;
// Root constraints: only loopback and private LAN ranges plus the names below.
export const PERMITTED_RANGES = [['127.0.0.0', 8], ['10.0.0.0', 8], ['172.16.0.0', 12], ['192.168.0.0', 16], ['::1', 128], ['fc00::', 7]];
function inRange(address, [base, prefix]) {
  const left = ipBytes(address), right = ipBytes(base); if (!left || !right || left.length !== right.length) return false;
  for (let bit = 0; bit < prefix; bit++) { const mask = 0x80 >> bit % 8; if ((left[bit >> 3] & mask) !== (right[bit >> 3] & mask)) return false; }
  return true;
}
export const permittedAddress = address => typeof address === 'string' && net.isIP(address) !== 0 && PERMITTED_RANGES.some(range => inRange(address, range));
export function hostNames(hostname = os.hostname()) {
  const value = String(hostname).trim().toLowerCase().replace(/\.$/, '');
  if (!value || value.length > 200 || !value.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) || value === 'localhost') return [];
  return value.includes('.') ? [value] : [value, value + '.local'];
}
const randomSerial = () => { const bytes = randomBytes(16); bytes[0] = bytes[0] & 0x7f | 0x10; return bytes; };
const second = value => new Date(Math.floor(value / 1000) * 1000);

export function encodeCertificate({ subject, issuer, publicKey, signingKey, issuerKey = publicKey, notBefore, notAfter, extensions }) {
  const tbs = sequence(tlv(0xa0, integer([2])), integer(randomSerial()), algorithm, name(issuer), sequence(time(notBefore), time(notAfter)), name(subject), publicKey.export({ type: 'spki', format: 'der' }), tlv(0xa3, sequence(...extensions, extension('2.5.29.14', false, octets(keyId(publicKey))), extension('2.5.29.35', false, sequence(tlv(0x80, keyId(issuerKey)))))));
  return sequence(tbs, algorithm, tlv(0x03, Buffer.alloc(1), sign('sha256', tbs, signingKey)));
}
export function rootCertificate({ privateKey, publicKey, names, now = new Date() }) {
  const subtrees = [...names, 'localhost'].map(value => sequence(dns(value))).concat(PERMITTED_RANGES.map(([base, prefix]) => {
    const bytes = ipBytes(base), mask = Buffer.alloc(bytes.length); for (let bit = 0; bit < prefix; bit++) mask[bit >> 3] |= 0x80 >> bit % 8; return sequence(ip(Buffer.concat([bytes, mask])));
  }));
  const notBefore = second(now.getTime() - day), notAfter = new Date(notBefore); notAfter.setUTCFullYear(notAfter.getUTCFullYear() + ROOT_YEARS);
  const label = names[0] ? ' (' + names[0] + ')' : '';
  return encodeCertificate({ subject: 'QuizForge LAN Root CA' + label, issuer: 'QuizForge LAN Root CA' + label, publicKey, signingKey: privateKey, notBefore, notAfter, extensions: [
    extension('2.5.29.19', true, sequence(tlv(0x01, Buffer.from([0xff])), integer([0]))),
    extension('2.5.29.15', true, tlv(0x03, Buffer.from([1, 0x06]))),
    extension('2.5.29.30', true, sequence(tlv(0xa0, ...subtrees)))
  ] });
}
export function serverCertificate({ publicKey, root, rootKey, names, addresses, now = new Date() }) {
  const notBefore = second(now.getTime() - 60 * 60 * 1000), notAfter = second(Math.min(now.getTime() + LEAF_DAYS * day, new Date(root.validTo).getTime()));
  const alternatives = [...new Set(names)].map(dns).concat([...new Set(addresses)].map(address => ip(ipBytes(address))));
  return encodeCertificate({ subject: 'QuizForge LAN HTTPS', issuer: root.subject.split('\n').find(line => line.startsWith('CN=')).slice(3), publicKey, signingKey: rootKey, issuerKey: root.publicKey, notBefore, notAfter, extensions: [
    extension('2.5.29.19', true, sequence()),
    extension('2.5.29.15', true, tlv(0x03, Buffer.from([5, 0xa0]))),
    extension('2.5.29.37', false, sequence(oid('1.3.6.1.5.5.7.3.1'))),
    extension('2.5.29.17', false, sequence(...alternatives))
  ] });
}
const pem = (label, der) => `-----BEGIN ${label}-----\n${der.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END ${label}-----\n`;
export const colonHex = bytes => bytes.toString('hex').toUpperCase().match(/../g).join(':');

async function restrictDirectory(directory) {
  // Keys live under the user's data directory; also drop inherited access so only this account can read them.
  if (process.platform !== 'win32') { fs.chmodSync(directory, 0o700); return; }
  const user = process.env.USERNAME || os.userInfo().username, account = process.env.USERDOMAIN ? process.env.USERDOMAIN + '\\' + user : user;
  try { await promisify(execFile)('icacls.exe', [directory, '/inheritance:r', '/grant:r', account + ':(OI)(CI)F'], { windowsHide: true, timeout: 10000 }); } catch {}
}

export class LanCertificates {
  constructor(root, { now = () => new Date(), hostname = os.hostname() } = {}) {
    this.directory = path.join(root, '.state', 'lan-https'); this.now = now; this.hostname = hostname; this.root = null; this.leaf = null;
    this.files = { rootKey: path.join(this.directory, 'root-ca.key'), root: path.join(this.directory, 'root-ca.crt'), meta: path.join(this.directory, 'root-ca.json'), key: path.join(this.directory, 'server.key'), cert: path.join(this.directory, 'server.crt') };
  }
  async prepareDirectory() { if (!exists(this.directory)) { safeDirectory(this.directory, true); await restrictDirectory(this.directory); } }
  load() {
    if (this.root) return true;
    try {
      if (!exists(this.files.root)) return false;
      const root = new X509Certificate(readBytes(this.files.root, 65536)), rootKey = createPrivateKey(readBytes(this.files.rootKey, 65536)), meta = readJson(this.files.meta, 4096);
      if (meta.schemaVersion !== 1 || !Array.isArray(meta.names) || !meta.names.every(value => typeof value === 'string') || !root.ca || !root.checkPrivateKey(rootKey) || !root.verify(root.publicKey)) return false;
      this.root = root; this.rootKey = rootKey; this.names = meta.names;
      if (exists(this.files.cert)) { const leaf = new X509Certificate(readBytes(this.files.cert, 65536)), key = createPrivateKey(readBytes(this.files.key, 65536)); if (leaf.checkIssued(root) && leaf.verify(root.publicKey) && leaf.checkPrivateKey(key)) this.leaf = { cert: leaf, key }; }
      return true;
    } catch { this.root = null; this.leaf = null; return false; }
  }
  async createRoot() {
    await this.prepareDirectory(); const { privateKey, publicKey } = await generate('rsa', { modulusLength: 2048 }), names = hostNames(this.hostname);
    const root = new X509Certificate(rootCertificate({ privateKey, publicKey, names, now: this.now() }));
    // Write the key first: a certificate without its key is never trusted on reload.
    replaceFile(this.files.rootKey, privateKey.export({ type: 'pkcs8', format: 'pem' })); replaceFile(this.files.root, pem('CERTIFICATE', root.raw)); replaceFile(this.files.meta, jsonBytes({ schemaVersion: 1, names }));
    if (exists(this.files.cert)) fs.unlinkSync(this.files.cert);
    this.root = root; this.rootKey = privateKey; this.names = names; this.leaf = null;
  }
  // Names a fresh server certificate should carry for the current addresses.
  wanted(addresses) {
    const current = hostNames(this.hostname), names = ['localhost', ...this.names.filter(value => current.includes(value))];
    return { names, addresses: [...new Set(['127.0.0.1', '::1', ...addresses.map(value => value.split('%')[0]).filter(permittedAddress)])] };
  }
  stale(wanted) {
    if (!this.leaf) return true; const cert = this.leaf.cert, now = this.now().getTime();
    if (new Date(cert.validFrom).getTime() > now || new Date(cert.validTo).getTime() - now < RENEW_DAYS * day) return true;
    return !wanted.addresses.every(address => cert.checkIP(address) !== undefined) || !wanted.names.every(value => cert.checkHost(value, { wildcards: false }) === value);
  }
  // Returns the current server key pair, creating the root once and reissuing the leaf when addresses or validity change.
  async ensure(addresses) {
    if (!this.load()) await this.createRoot();
    if (new Date(this.root.validTo).getTime() - this.now().getTime() < RENEW_DAYS * day) await this.createRoot();
    const wanted = this.wanted(addresses); let changed = false;
    if (this.stale(wanted)) {
      await this.prepareDirectory(); const { privateKey, publicKey } = await generate('rsa', { modulusLength: 2048 });
      const cert = new X509Certificate(serverCertificate({ publicKey, root: this.root, rootKey: this.rootKey, ...wanted, now: this.now() }));
      replaceFile(this.files.key, privateKey.export({ type: 'pkcs8', format: 'pem' })); replaceFile(this.files.cert, pem('CERTIFICATE', cert.raw));
      this.leaf = { cert, key: privateKey }; changed = true;
    }
    return { key: this.leaf.key.export({ type: 'pkcs8', format: 'pem' }), cert: this.leaf.cert.toString(), changed };
  }
  async regenerate(addresses) { await this.createRoot(); return this.ensure(addresses); }
  // Only the public root certificate ever leaves this object.
  rootDer() { return this.load() ? Buffer.from(this.root.raw) : null; }
  status() {
    if (!this.load()) return null; const leaf = this.leaf?.cert;
    return { fingerprint: colonHex(createHash('sha256').update(this.root.raw).digest()), rootSubject: this.root.subject.split('\n').find(line => line.startsWith('CN='))?.slice(3) ?? '', rootValidTo: new Date(this.root.validTo).toISOString(), names: this.names, ...leaf ? { serverValidTo: new Date(leaf.validTo).toISOString(), serverNames: leaf.subjectAltName.split(', ').map(entry => entry.replace(/^(DNS|IP Address):/, '')) } : {} };
  }
}
