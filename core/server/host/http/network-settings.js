import path from 'node:path';
import { pbkdf2, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { ApiError, bad, requireObject } from '../platform/errors.js';
import { integralField, jsonBytes } from '../platform/json.js';
import { exists, readJson, replaceFile } from '../platform/files.js';
import { decodeBase64 } from '../resources/resources.js';
import { hostKey, ipv6Bytes } from './network-addresses.js';
import { SerialTransactions } from '../platform/transactions.js';

const derive = promisify(pbkdf2), iterations = 210000;
export function normalizePublicUrl(value) {
  const message = '公网访问地址需为 http:// 或 https:// 域名／公网 IP 地址，IPv6 写成 http://[IPv6地址]:端口/，不包含路径、账号或查询参数。';
  if (typeof value !== 'string') throw new ApiError(400, 'INVALID_PUBLIC_URL', message); if (!value.trim()) return '';
  try {
    if (value.length > 500) throw new Error(); const parsed = new URL(value.trim()), host = parsed.hostname.replace(/^\[|\]$/g, ''), key = hostKey(host), bytes = ipv6Bytes(host);
    if (!['http:', 'https:'].includes(parsed.protocol) || !key || key === hostKey('::1') || key === hostKey('::') || key.startsWith('127.') || key === '0.0.0.0' || host === 'localhost' || host.endsWith('.localhost') || (bytes && (bytes[0] === 0xff || bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80)) || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/' || parsed.port === '0') throw new Error();
    return parsed.origin + '/';
  } catch { throw new ApiError(400, 'INVALID_PUBLIC_URL', message); }
}
function switches(request) { requireObject(request, 'Provide connection switches and a valid port'); if (typeof request.enabled !== 'boolean' || !integralField(request, 'port') || ['publicEnabled', 'httpsEnabled'].some(key => Object.hasOwn(request, key) && typeof request[key] !== 'boolean') || Object.hasOwn(request, 'httpsPort') && !integralField(request, 'httpsPort') || Object.hasOwn(request, 'publicUrl') && typeof request.publicUrl !== 'string') throw bad('Provide connection switches and a valid port'); }
const httpsMessage = 'HTTPS 端口需为 1024–65535，且不能与本机端口或连接端口相同；开启局域网 HTTPS 前请先允许局域网设备连接。';
const config = value => ({ ...value, get remoteEnabled() { return this.enabled || this.publicEnabled; }, get passwordConfigured() { return this.salt !== null && this.hash !== null; } });
export class NetworkSettings {
  constructor(root, defaultPort) {
    this.defaultHttpsPort = defaultPort === 65535 ? 8789 : defaultPort + 1;
    this.file = path.join(root, '.state', 'network-settings.json'); this.sessions = new Map(); this.attempts = new Map(); this.transactions = new SerialTransactions(); this.config = config({ enabled: false, publicEnabled: false, publicUrl: '', port: defaultPort, httpsEnabled: false, httpsPort: this.defaultHttpsPort, salt: null, hash: null });
    if (exists(this.file)) {
      const saved = readJson(this.file, 8192); switches(saved); if (saved.schemaVersion !== 1 || saved.port < 1024 || saved.port > 65535) throw new Error('Invalid network settings'); let salt = null, hash = null;
      if (Object.hasOwn(saved, 'password')) { if (saved.password.algorithm !== 'PBKDF2WithHmacSHA256' || saved.password.iterations !== iterations) throw new Error('Invalid connection password hash'); salt = decodeBase64(saved.password.salt); hash = decodeBase64(saved.password.hash); if (salt.length !== 16 || hash.length !== 32) throw new Error('Invalid connection password hash'); }
      const publicEnabled = saved.publicEnabled ?? false, publicUrl = normalizePublicUrl(saved.publicUrl ?? '');
      const httpsEnabled = saved.httpsEnabled ?? false, httpsPort = saved.httpsPort ?? this.defaultHttpsPort;
      if ((saved.enabled || publicEnabled) && salt === null || httpsPort < 1024 || httpsPort > 65535 || httpsEnabled && (!saved.enabled || httpsPort === saved.port)) throw new Error('Invalid saved remote access configuration');
      this.config = config({ enabled: saved.enabled, publicEnabled, publicUrl, port: saved.port, httpsEnabled, httpsPort, salt, hash });
    }
  }
  async candidate(request, localPort) {
    switches(request); if (request.port < 1024 || request.port > 65535 || request.port === localPort) throw bad('Connection port must be 1024..65535 and different from the local port');
    const publicEnabled = request.publicEnabled ?? this.config.publicEnabled, publicUrl = Object.hasOwn(request, 'publicUrl') ? normalizePublicUrl(request.publicUrl) : this.config.publicUrl;
    // The custom address is optional: detected public IPv6 and Tailscale addresses work without it.
    let salt = this.config.salt, hash = this.config.hash;
    const httpsEnabled = request.httpsEnabled ?? this.config.httpsEnabled, httpsPort = request.httpsPort ?? this.config.httpsPort;
    if (httpsPort < 1024 || httpsPort > 65535 || httpsEnabled && (!request.enabled || httpsPort === localPort || httpsPort === request.port)) throw new ApiError(400, 'INVALID_HTTPS_SETTINGS', httpsMessage);
    if (Object.hasOwn(request, 'password')) {
      if (typeof request.password !== 'string') throw bad('Invalid password'); if (request.password.trim()) { if (request.password.length < 8 || request.password.length > 256) throw bad('Password must contain 8..256 characters'); salt = randomBytes(16); hash = await derive(request.password, salt, iterations, 32, 'sha256'); }
    }
    if ((request.enabled || publicEnabled) && hash === null) throw bad('Set a password before enabling remote access'); return config({ enabled: request.enabled, publicEnabled, publicUrl, port: request.port, httpsEnabled, httpsPort, salt, hash });
  }
  save(replacement) {
    const saved = { schemaVersion: 1, enabled: replacement.enabled, publicEnabled: replacement.publicEnabled, publicUrl: replacement.publicUrl, port: replacement.port, httpsEnabled: replacement.httpsEnabled, httpsPort: replacement.httpsPort };
    if (replacement.passwordConfigured) saved.password = { algorithm: 'PBKDF2WithHmacSHA256', iterations, salt: replacement.salt.toString('base64'), hash: replacement.hash.toString('base64') };
    replaceFile(this.file, jsonBytes(saved)); const before = this.config;
    if (['enabled', 'publicEnabled', 'publicUrl', 'port'].some(key => before[key] !== replacement[key]) || !(before.hash === replacement.hash || before.hash && replacement.hash && before.hash.equals(replacement.hash))) this.sessions.clear(); this.config = replacement;
  }
  limitLogin(peer) {
    const now = Date.now(); for (const [key, value] of this.attempts) if (now - value.start >= 60000) this.attempts.delete(key); const current = this.attempts.get(peer);
    if (current && current.count >= 6 || !current && this.attempts.size >= 256) throw new ApiError(429, 'LOGIN_RATE_LIMITED', 'Too many login attempts; try again in a minute'); this.attempts.set(peer, { start: current?.start ?? now, count: (current?.count ?? 0) + 1 });
  }
  async login(password, peer) {
    const profile = this.config; if (!profile.remoteEnabled || !profile.passwordConfigured) throw new ApiError(401, 'PASSWORD_REQUIRED', 'Remote access is not enabled'); this.limitLogin(peer);
    if (typeof password !== 'string' || password.length > 256 || !timingSafeEqual(profile.hash, await derive(password, profile.salt, iterations, 32, 'sha256')) || profile !== this.config) throw new ApiError(401, 'PASSWORD_REQUIRED', 'Incorrect connection password');
    const now = Date.now(); for (const [key, expires] of this.sessions) if (expires <= now) this.sessions.delete(key); if (this.sessions.size >= 128) this.sessions.clear(); const token = randomBytes(32).toString('base64url'); this.sessions.set(token, now + 12 * 60 * 60 * 1000); return token;
  }
  authenticated(token) { if (!this.config.remoteEnabled || !this.sessions.has(token)) return false; if (this.sessions.get(token) <= Date.now()) { this.sessions.delete(token); return false; } return true; }
  invalidateSessions() { this.sessions.clear(); }
}
