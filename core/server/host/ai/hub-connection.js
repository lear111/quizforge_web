import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { ApiError } from '../platform/errors.js';
import { jsonBytes } from '../platform/json.js';
import { exists, readJson, replaceFile, safeDirectory } from '../platform/files.js';
import { restrictPrivate } from './ai-settings.js';

// Connects this installation to a QuizForge Hub account for official AI grading
// (Hub docs/HUB_CONNECT_AI.md, protocol v1, section 7.1). The Hub origin is fixed;
// it is never read from links, settings or server responses.
export const HUB_ORIGIN = 'https://quizforge.treenewbee.cloud';
export const OFFICIAL_MODEL = 'quizforge-official';
const PENDING_TTL = 600000;
const TOKEN = /^qfd_[A-Za-z0-9_-]{43}$/;
const deviceName = value => Array.from(String(value || '').replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim()).slice(0, 40).join('') || 'QuizForge 电脑';

export class HubConnection {
  constructor(root, { origin = HUB_ORIGIN, fetchImpl = globalThis.fetch, hostname = os.hostname(), now = () => Date.now() } = {}) {
    this.origin = origin; this.fetch = fetchImpl; this.name = deviceName(hostname); this.now = now; this.pending = new Map();
    this.directory = path.join(root, '.state', 'hub'); this.file = path.join(this.directory, 'connection.json'); this.value = null;
    if (exists(this.file)) {
      try { const saved = readJson(this.file, 8192); if (saved.schemaVersion === 1 && TOKEN.test(saved.token) && saved.device && saved.user) this.value = saved; } catch { /* An unreadable connection is the same as being logged out. */ }
    }
  }
  token() { return this.value?.token ?? null; }
  summary() { return this.value ? { connected: true, user: { name: this.value.user.name }, device: { name: this.value.device.name, client: 'web' } } : { connected: false }; }
  // Starts the browser flow: PKCE S256 and a single-use state, valid for ten minutes.
  start(redirectUri) {
    const time = this.now(); for (const [key, entry] of this.pending) if (entry.expires <= time) this.pending.delete(key);
    if (this.pending.size >= 8) this.pending.delete(this.pending.keys().next().value);
    const verifier = randomBytes(48).toString('base64url'), state = randomBytes(24).toString('base64url');
    this.pending.set(state, { verifier, redirectUri, expires: time + PENDING_TTL });
    const query = new URLSearchParams({ v: '1', client: 'web', redirect_uri: redirectUri, state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', device_name: this.name });
    return { authorizeUrl: `${this.origin}/connect/authorize?${query}` };
  }
  async complete(searchParams) {
    const state = searchParams.get('state'), entry = typeof state === 'string' ? this.pending.get(state) : null;
    if (entry) this.pending.delete(state);
    if (!entry || entry.expires <= this.now()) throw new ApiError(400, 'HUB_CONNECT_EXPIRED', '登录请求已过期，请回到 QuizForge 的 AI 设置重新点击“登录”。');
    if (searchParams.get('error') === 'access_denied') throw new ApiError(400, 'HUB_CONNECT_DENIED', '你拒绝了连接，没有登录。可以回到 QuizForge 重新登录。');
    const code = searchParams.get('code');
    if (!/^[A-Za-z0-9_-]{43}$/.test(code || '')) throw new ApiError(400, 'HUB_CONNECT_INVALID', '登录结果无效，请回到 QuizForge 重新登录。');
    let result;
    try {
      const response = await this.fetch(this.origin + '/api/connect/token', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000), headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ v: 1, client: 'web', code, code_verifier: entry.verifier, redirect_uri: entry.redirectUri }) });
      result = await response.json().catch(() => null);
      if (!response.ok) throw new ApiError(400, 'HUB_CONNECT_INVALID', result?.error?.message || '登录没有完成，请回到 QuizForge 重新登录。');
    } catch (error) { if (error instanceof ApiError) throw error; throw new ApiError(502, 'HUB_UNREACHABLE', '无法连接 QuizForge 服务器，请检查网络后重新登录。'); }
    if (!TOKEN.test(result?.token) || typeof result?.user?.name !== 'string' || typeof result?.device?.name !== 'string') throw new ApiError(502, 'HUB_CONNECT_INVALID', '服务器返回的登录结果无效，请稍后重试。');
    this.save({ schemaVersion: 1, token: result.token, user: { name: result.user.name.slice(0, 60) }, device: { id: String(result.device.id ?? ''), name: result.device.name.slice(0, 40) }, connectedAt: new Date(this.now()).toISOString() });
    return this.summary();
  }
  // Account and today's quota from the Hub; a rejected token logs this device out.
  async account() {
    const token = this.token(); if (!token) return { connected: false };
    try {
      const response = await this.fetch(this.origin + '/api/connect/me', { redirect: 'error', signal: AbortSignal.timeout(10000), headers: { Accept: 'application/json', Authorization: 'Bearer ' + token } });
      if (response.status === 401) { this.invalidate(token); return { connected: false, expired: true }; }
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.ai) return { ...this.summary(), unavailable: true };
      const ai = result.ai, number = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
      return { ...this.summary(), ai: { enabled: ai.enabled === true, model: typeof ai.model === 'string' ? ai.model.slice(0, 80) : '', dailyLimit: number(ai.dailyLimit), usedToday: number(ai.usedToday), resetAt: typeof ai.resetAt === 'string' ? ai.resetAt.slice(0, 40) : '' } };
    } catch { return { ...this.summary(), unavailable: true }; }
  }
  async logout() {
    const token = this.token(); if (!token) return this.summary();
    this.clear();
    // Revoking on the Hub is best effort; the local token is gone either way.
    try { await this.fetch(this.origin + '/api/connect/logout', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000), headers: { Authorization: 'Bearer ' + token } }); } catch { /* Offline logout still forgets the token. */ }
    return this.summary();
  }
  invalidate(token) { if (token && this.value?.token === token) this.clear(); }
  save(value) { safeDirectory(this.directory, true); restrictPrivate(this.directory, true); replaceFile(this.file, jsonBytes(value)); restrictPrivate(this.file, false); this.value = value; }
  clear() { this.value = null; try { fs.rmSync(this.file, { force: true }); } catch { /* A leftover file is ignored once the token is rejected. */ } }
}
