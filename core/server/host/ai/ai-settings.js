import fs from 'node:fs';
import path from 'node:path';
import dns from 'node:dns/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ApiError, bad, requireObject } from '../platform/errors.js';
import { cloneJson, integralField, jsonBytes } from '../platform/json.js';
import { exists, readJson, replaceFile, safeDirectory } from '../platform/files.js';
import { privateAddress } from '../http/network-addresses.js';
import { SerialTransactions } from '../platform/transactions.js';
import { HUB_ORIGIN, OFFICIAL_MODEL } from './hub-connection.js';

const defaults = () => ({ useOfficial: false, useCustom: false, enabled: false, baseUrl: null, model: '', apiKey: '', vision: false, outputMode: 'json', maxOutputTokens: 8192, timeoutSeconds: 90, autoGrade: false });
function boolean(value, key, fallback) { if (!Object.hasOwn(value, key)) return fallback; if (typeof value[key] !== 'boolean') throw bad('Invalid AI ' + key); return value[key]; }
function string(value, key, fallback, max) { if (!Object.hasOwn(value, key)) return fallback; if (typeof value[key] !== 'string' || value[key].length > max) throw bad('Invalid AI ' + key); return value[key].trim(); }
function number(value, key, fallback, min, max) { if (!Object.hasOwn(value, key)) return fallback; if (!integralField(value, key) || value[key] < min || value[key] > max) throw bad('Invalid AI ' + key); return value[key]; }
function baseUri(value) {
  try { const url = new URL(value); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.port === '0' || /(?:^|\/)\.{1,2}(?:\/|$)/.test(value.split('://')[1]?.slice(value.split('://')[1]?.indexOf('/')) ?? '')) throw new Error(); return value.endsWith('/') ? value.slice(0, -1) : value; }
  catch { throw bad('Model base URL must be HTTP(S) without credentials, query or fragment'); }
}
function parse(request, previous, stored) {
  requireObject(request, 'Invalid AI settings'); const fields = ['schemaVersion', 'source', 'useOfficial', 'useCustom', 'enabled', 'autoGrade', 'provider', 'baseUrl', 'model', 'apiKey', 'clearApiKey', 'vision', 'outputMode', 'maxOutputTokens', 'timeoutSeconds', 'testReport'];
  if (Object.keys(request).some(field => !fields.includes(field) || !stored && ['schemaVersion', 'testReport'].includes(field)) || stored && request.schemaVersion !== 1) throw bad('Invalid AI settings field');
  if (Object.hasOwn(request, 'provider') && request.provider !== 'openai-compatible') throw bad('Unsupported AI provider');
  const enabled = boolean(request, 'enabled', previous.enabled), autoGrade = boolean(request, 'autoGrade', previous.autoGrade), vision = boolean(request, 'vision', previous.vision), clear = boolean(request, 'clearApiKey', false), url = string(request, 'baseUrl', previous.baseUrl ?? '', 2048), model = string(request, 'model', previous.model, 200); let apiKey = string(request, 'apiKey', '', 4096);
  if (/[^\x20-\x7e]/.test(apiKey) || clear && apiKey) throw bad('Invalid AI credential'); if (!stored && !apiKey && !clear) apiKey = previous.apiKey; if (clear) apiKey = '';
  const outputMode = string(request, 'outputMode', previous.outputMode, 20); if (!['schema', 'json', 'text'].includes(outputMode)) throw bad('Invalid AI output mode');
  // Two grading sources may be on together: the free quota of the connected Hub
  // account (tried first) and the user's own model. Older files saved one 'source',
  // and the oldest none at all, which meant the user's own model.
  const baseUrl = url ? baseUri(url) : null;
  let useOfficial = boolean(request, 'useOfficial', previous.useOfficial), useCustom = boolean(request, 'useCustom', previous.useCustom);
  const legacy = stored && !Object.hasOwn(request, 'useOfficial') && !Object.hasOwn(request, 'useCustom');
  if (Object.hasOwn(request, 'source') || legacy) {
    if (Object.hasOwn(request, 'useOfficial') || Object.hasOwn(request, 'useCustom')) throw bad('Invalid AI settings field');
    const source = string(request, 'source', 'custom', 20); if (!['custom', 'official'].includes(source)) throw bad('Invalid AI source');
    useOfficial = source === 'official'; useCustom = source === 'custom' && !!baseUrl;
  }
  if (enabled && useCustom && (!baseUrl || !model)) throw bad('AI address and model are required when enabled');
  return { useOfficial, useCustom, enabled, baseUrl, model, apiKey, vision, outputMode, maxOutputTokens: number(request, 'maxOutputTokens', previous.maxOutputTokens, 256, 8192), timeoutSeconds: number(request, 'timeoutSeconds', previous.timeoutSeconds, 10, 120), autoGrade };
}
const sameConnection = (left, right) => ['baseUrl', 'model', 'apiKey'].every(key => left[key] === right[key]);
export async function validateModelAddress(profile) {
  if (!profile.baseUrl || new URL(profile.baseUrl).protocol !== 'http:') return;
  try { const host = new URL(profile.baseUrl).hostname.replace(/^\[|\]$/g, ''), addresses = await dns.lookup(host, { all: true }); if (!addresses.length || addresses.some(({ address }) => !privateAddress(address))) throw bad('HTTP model endpoints must be localhost or a private network'); }
  catch (error) { if (error instanceof ApiError) throw error; throw bad('Local model host cannot be resolved'); }
}
export function restrictPrivate(file, directory) { restrict(file, directory); }
function restrict(file, directory) {
  if (process.platform !== 'win32') { fs.chmodSync(file, directory ? 0o700 : 0o600); return; }
  const helper=fileURLToPath(new URL('./protect-credential.ps1', import.meta.url));
  if(!exists(helper))throw new ApiError(409,'AI_HOST_RESTART_REQUIRED','后端文件已更新，请保存作答并重启应用服务后重试。');
  try{execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper, '-LiteralPath', file, ...(directory ? ['-Directory'] : [])], { windowsHide: true, timeout: 15000, stdio: ['ignore', 'ignore', 'pipe'] });}
  catch{throw new ApiError(503,'AI_SETTINGS_SAVE_FAILED','无法完成 AI 设置文件的访问保护，设置未确认保存，请重启服务后重试。');}
}
export class AiSettings {
  constructor(root) {
    this.directory = path.join(root, '.state', 'ai'); this.file = path.join(this.directory, 'profile.json'); this.profile = defaults(); this.testReport = null; this.transactions = new SerialTransactions(); safeDirectory(this.directory);
    if (exists(this.file)) { const stored = readJson(this.file, 32768); this.profile = parse(stored, this.profile, true); if (stored.testReport && typeof stored.testReport === 'object' && !Array.isArray(stored.testReport)) this.testReport = cloneJson(stored.testReport); restrict(this.directory, true); restrict(this.file, false); }
  }
  credential() { return { apiKey: this.profile.apiKey }; }
  attachHub(hub) { this.hub = hub; }
  // The profiles model calls use, in order: the free quota through the Hub gateway
  // with this device's token, then the user's own model. Custom fields stay untouched.
  effectiveProfiles() {
    const profile = this.profile, list = [];
    if (profile.useOfficial) list.push({ official: true, enabled: profile.enabled, autoGrade: profile.autoGrade, baseUrl: (this.hub?.origin ?? HUB_ORIGIN) + '/api/ai/v1', model: OFFICIAL_MODEL, apiKey: this.hub?.token() ?? '', vision: true, outputMode: 'json', maxOutputTokens: 8192, timeoutSeconds: 120 });
    if (profile.useCustom) list.push(profile);
    return list;
  }
  status() { const { apiKey, ...profile } = this.profile; return { ...profile, provider: 'openai-compatible', baseUrl: profile.baseUrl ?? '', apiKeyConfigured: !!apiKey, testReport: cloneJson(this.testReport) }; }
  update(request) {
    return this.transactions.run(async () => { let replacement = parse(request, this.profile, false); await validateModelAddress(replacement); const changed = !sameConnection(this.profile, replacement) || this.profile.outputMode !== replacement.outputMode; if (changed && !Object.hasOwn(request, 'vision')) replacement = { ...replacement, vision: false }; this.persist(replacement, changed ? null : this.testReport); return this.status(); });
  }
  saveTest(tested, report, vision, outputMode) {
    return this.transactions.run(() => { if (!sameConnection(this.profile, tested) || this.profile.outputMode !== tested.outputMode) throw new ApiError(409, 'AI_CONFIG_CHANGED', '测试期间模型配置已修改，请重新测试当前配置。'); this.persist({ ...this.profile, vision, outputMode }, report); return this.status(); });
  }
  persist(replacement, report) { safeDirectory(this.directory, true); restrict(this.directory, true); const stored = { schemaVersion: 1, provider: 'openai-compatible', ...replacement, baseUrl: replacement.baseUrl ?? '', ...(report ? { testReport: report } : {}) }; replaceFile(this.file, jsonBytes(stored)); restrict(this.file, false); this.profile = replacement; this.testReport = cloneJson(report); }
}
