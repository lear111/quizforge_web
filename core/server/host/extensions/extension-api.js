import { ApiError } from '../platform/errors.js';
import { integralField } from '../platform/json.js';

const CAPABILITIES = new Set(['practice', 'editor', 'editor-drafts', 'score', 'manual-review', 'ai-grading', 'resources', 'richtext', 'navigation', 'lifecycle', 'outline-items', 'answer-state', 'appearance']);
const integer = (parent, key, minimum) => integralField(parent, key) && parent[key] >= minimum && parent[key] <= 2147483647;
export const apiVersion = () => ({ major: 1, minor: 4 });
export function answerStateDeclared(manifest) {
  return manifest.requiresApi?.major === 1 && manifest.requiresApi.minMinor >= 3 && manifest.requiresApi.capabilities?.includes('answer-state') === true;
}
export function outlineItemsDeclared(manifest) {
  const requirement = manifest.requiresApi;
  return requirement?.major === 1 && requirement.minMinor >= 1 && requirement.capabilities?.includes('outline-items') === true;
}
export function requireManifestApi(manifest) {
  if (!Object.hasOwn(manifest, 'requiresApi')) return;
  const requirement = manifest.requiresApi;
  if (!requirement || typeof requirement !== 'object' || Array.isArray(requirement) || !integer(requirement, 'major', 1) || !integer(requirement, 'minMinor', 0) || Object.keys(requirement).some(key => !['major', 'minMinor', 'capabilities'].includes(key))) throw new ApiError(422, 'INVALID_API_REQUIREMENT', '拓展 requiresApi 必须包含整数 major 和 minMinor，且仅允许 major、minMinor、capabilities 字段；旧拓展可省略该声明并使用 API v1.0。');
  if (requirement.major !== 1 || requirement.minMinor > 4) throw new ApiError(422, 'UNSUPPORTED_EXTENSION_API', `拓展需要 API v${requirement.major}.${requirement.minMinor}，本应用支持 API v1.4。请安装兼容的拓展版本，或在应用支持该接口后再升级。`);
  if (!Object.hasOwn(requirement, 'capabilities')) return;
  const capabilities = requirement.capabilities;
  if (!Array.isArray(capabilities) || capabilities.length > 100) throw new ApiError(422, 'INVALID_API_REQUIREMENT', 'requiresApi.capabilities 必须是能力名称数组，请修正拓展声明。');
  const seen = new Set();
  for (const capability of capabilities) {
    if (typeof capability !== 'string' || !capability.trim() || seen.has(capability)) throw new ApiError(422, 'INVALID_API_REQUIREMENT', 'requiresApi.capabilities 必须包含不重复的非空字符串，请修正拓展声明。');
    seen.add(capability);
    if (!CAPABILITIES.has(capability)) throw new ApiError(422, 'UNSUPPORTED_API_CAPABILITY', `本应用的 API v${requirement.major} 不支持能力「${capability}」。请使用兼容拓展，或向开发者反馈所需能力。`);
    if (capability === 'outline-items' && requirement.minMinor < 1) throw new ApiError(422, 'INVALID_API_REQUIREMENT', 'outline-items 能力需要明确声明 requiresApi.minMinor 至少为 1。');
    if (capability === 'answer-state' && requirement.minMinor < 3) throw new ApiError(422, 'INVALID_API_REQUIREMENT', 'answer-state 能力需要明确声明 requiresApi.minMinor 至少为 3。');
    if (capability === 'appearance' && requirement.minMinor < 4) throw new ApiError(422, 'INVALID_API_REQUIREMENT', 'appearance 能力需要明确声明 requiresApi.minMinor 至少为 4。');
  }
}
export function requireBankFormat(bank) {
  if (!Object.hasOwn(bank, 'formatVersion')) return;
  if (!integer(bank, 'formatVersion', 1)) throw new ApiError(422, 'INVALID_BANK_FORMAT', '题库 formatVersion 必须为正整数；现有题库可省略并按格式 v1 读取。原文件未修改。');
  if (bank.formatVersion !== 1) throw new ApiError(422, 'UNSUPPORTED_BANK_FORMAT', `题库使用格式 v${bank.formatVersion}，本应用仅支持 v1。请安装支持该格式的应用，或由制作者导出兼容格式；原文件未修改。`);
}
export function requireHistoryApi(document) {
  if (!Object.hasOwn(document, 'apiVersion')) return;
  const version = document.apiVersion;
  if (!version || typeof version !== 'object' || Array.isArray(version) || !integer(version, 'major', 1) || !integer(version, 'minor', 0)) throw new ApiError(409, 'INVALID_HISTORY_API', '历史记录的 apiVersion 声明无效，无法安全打开。原记录保留，请从备份恢复或向开发者反馈。');
  if (version.major !== 1 || version.minor > 4) throw new ApiError(409, 'UNSUPPORTED_HISTORY_API', `历史记录需要 API v${version.major}.${version.minor}，本应用支持 v1.4 及旧版 v1.3、v1.2、v1.1、v1.0。请使用支持该接口的应用打开；原记录未修改。`);
}
export function declareApi(document) { document.apiVersion = apiVersion(); return document; }
export function normalizeHistoryApi(document) {
  requireHistoryApi(document);
  document.apiVersion ??= { major: 1, minor: 0 };
  for (const page of [document.page, ...Object.values(document.pages ?? {}), ...(document.questions ?? []).map(question => question.page)]) {
    if (!page || typeof page !== 'object' || Array.isArray(page)) continue;
    requireHistoryApi(page); page.apiVersion ??= { major: 1, minor: 0 };
  }
}
