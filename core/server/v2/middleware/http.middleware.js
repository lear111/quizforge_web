import { timingSafeEqual } from 'node:crypto';
import { parseJson } from '../../host/platform/json.js';
import { problem, publicError } from '../utils/errors.js';
import { json } from '../utils/http-response.js';
import { STATE_BYTES } from '../utils/limits.js';
import { withSaveTiming, measureSave } from '../utils/timing.js';

export function saveTiming(server) {
  return (request, _response, next) =>
    withSaveTiming(server.timings && ['PUT', 'POST'].includes(request.method), next);
}

export function defaultHeaders(_request, response, next) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  next();
}

function validatedUrl(server, request) {
  let authority;
  try {
    if (typeof request.headers.host !== 'string' || /[\s/\\@?#]/.test(request.headers.host)) {
      throw new Error();
    }
    authority = new URL('http://' + request.headers.host);
    const hostname = authority.hostname.replace(/^\[|\]$/g, '');
    if (!server.hosts.has(hostname) || Number(authority.port || 80) !== server.port()) {
      throw new Error();
    }
    if (
      Object.keys(request.headers).some(
        (name) => name === 'forwarded' || name.startsWith('x-forwarded-'),
      )
    ) {
      throw new Error();
    }
  } catch {
    throw problem('HOST_REJECTED', '请通过本机或已启用的连接地址访问。', {}, 403);
  }
  // Express can add a slash to a non-origin-form URL while processing middleware.
  const target = request.originalUrl;
  if (!target.startsWith('/') || target.startsWith('//')) {
    throw problem('INVALID_REQUEST', '请求地址无效。', {}, 400);
  }
  if (
    (request.headers.origin !== undefined && request.headers.origin !== authority.origin) ||
    (request.headers['sec-fetch-site'] &&
      !['same-origin', 'none'].includes(request.headers['sec-fetch-site']))
  ) {
    throw problem('ORIGIN_REJECTED', '请从应用自身页面访问接口。', {}, 403);
  }
  return new URL(target, authority);
}

function authenticate(server, request) {
  if (!server.token) {
    return;
  }
  const supplied = request.headers['x-quizforge-token'];
  const a = Buffer.from(typeof supplied === 'string' ? supplied : ''),
    b = Buffer.from(server.token);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw problem('AUTH_REQUIRED', '请输入有效的连接令牌。', {}, 401);
  }
}

function decodePath(pathname) {
  return pathname
    .split('/')
    .filter(Boolean)
    .map((part) => {
      let decoded;
      try {
        decoded = decodeURIComponent(part);
      } catch {
        throw problem('INVALID_REQUEST', '地址编码无效。', {}, 400);
      }
      // eslint-disable-next-line no-control-regex -- URL fields reject decoded control bytes.
      if (/[\x00-\x1f/\\]/.test(decoded) || ['.', '..'].includes(decoded)) {
        throw problem('INVALID_REQUEST', '地址字段无效。', {}, 400);
      }
      return decoded;
    });
}

export function checkTarget(server) {
  return (request, response, next) => {
    const url = validatedUrl(server, request);
    const parts = decodePath(url.pathname);
    response.locals.target = url;
    response.locals.parts = parts;
    // Preserve the old URL normalization and decode each segment exactly once.
    // Express matches this canonical path and decodes its parameters itself.
    request.url = '/' + parts.map(encodeURIComponent).join('/');
    next();
  };
}

export function apiAccess(server) {
  return (request, response, next) => {
    const parts = response.locals.parts;
    if (parts[0] === 'api') {
      authenticate(server, request);
      if (parts[1] !== 'v2') {
        throw problem(
          'V1_API_REMOVED',
          'V2 不提供旧作答接口，请使用 V2 页面或 v1-final。',
          {},
          410,
        );
      }
    }
    next();
  };
}

export function requireJson(request, _response, next) {
  if (request.headers['content-type']?.split(';')[0] !== 'application/json') {
    throw problem('INVALID_REQUEST', '请发送 JSON 请求。', {}, 400);
  }
  next();
}

export async function readJson(request, response, next) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > STATE_BYTES) {
      throw problem(
        'STATE_SIZE_LIMIT',
        '请求超过 32 MiB，本次未保存。',
        { details: { limit: STATE_BYTES } },
        413,
      );
    }
    chunks.push(chunk);
  }
  try {
    response.locals.input = measureSave('parse', () => parseJson(Buffer.concat(chunks)));
  } catch {
    throw problem('INVALID_REQUEST', '请求 JSON 无效或包含重复字段。', {}, 400);
  }
  next();
}

export function fallback(request, response) {
  if (response.locals.parts[0] !== 'api') {
    throw problem('RESOURCE_NOT_FOUND', '页面或资源不存在。', {}, 404);
  }
  if (['GET', 'HEAD'].includes(request.method)) {
    throw problem('FEATURE_NOT_IMPLEMENTED', '此接口尚未实现。', {}, 501);
  }
  request.resume();
  throw problem('FEATURE_NOT_IMPLEMENTED', '此功能将在后续阶段开放。', {}, 501);
}

// eslint-disable-next-line no-unused-vars -- Express expects four parameters here.
export function writeError(error, _request, response, _next) {
  if (!response.headersSent && !response.destroyed) {
    response.setHeader('Cache-Control', 'no-store');
    json(response, error.status ?? 503, { error: publicError(error) });
  } else {
    response.destroy();
  }
}
