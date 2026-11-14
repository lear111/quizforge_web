import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { jsonBytes } from '../platform/json.js';
import { problem, publicError } from './errors.js';
import { READ_LIMITS } from './io.js';
import { measureResponseSerialization, timingHeader } from './timing.js';

const mime = (file) =>
  ({
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.mp3': 'audio/mpeg',
    '.m4a': 'audio/mp4',
    '.ogg': 'audio/ogg',
    '.wav': 'audio/wav',
    '.woff2': 'font/woff2',
  })[path.extname(file).toLowerCase()] ?? 'application/octet-stream';

export function json(response, status, value) {
  const bytes = measureResponseSerialization(() => jsonBytes(value));
  const timing = timingHeader();
  if (timing) {
    response.setHeader('Server-Timing', timing);
  }
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': bytes.length,
  });
  response.end(bytes);
}

export function immutable(response) {
  response.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  response.setHeader('Vary', 'X-QuizForge-Token');
}

function byteRange(range, response, headers, length) {
  let start = 0,
    end = length - 1,
    status = 200;
  if (range !== undefined) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    const reject = () => {
      response.setHeader('Content-Range', `bytes */${length}`);
      throw problem('RANGE_NOT_SATISFIABLE', '请求的音频范围无效。', {}, 416);
    };
    if (!match || !length || (!match[1] && !match[2])) {
      reject();
    }
    if (!match[1]) {
      const suffix = Number(match[2]);
      if (!Number.isSafeInteger(suffix) || suffix <= 0) {
        reject();
      }
      start = Math.max(0, length - suffix);
    } else {
      start = Number(match[1]);
      end = match[2] ? Number(match[2]) : end;
    }
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start >= length ||
      start > end
    ) {
      reject();
    }
    end = Math.min(end, length - 1);
    status = 206;
    headers['Content-Range'] = `bytes ${start}-${end}/${length}`;
  }
  return { start, end, status };
}

export function writeBinary(
  server,
  request,
  response,
  file,
  { executable = false, expectedHash } = {},
) {
  const entry = server.library.cache.entry(file, READ_LIMITS.assetBytes),
    bytes = entry.content;
  const headers = { 'Content-Type': mime(file), 'Accept-Ranges': 'bytes' };
  // A direct browser navigation to an extension HTML must not gain host origin.
  if (executable || /\.(?:html|svg)$/i.test(file)) {
    headers['Content-Security-Policy'] =
      "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; worker-src blob:; frame-ancestors 'self'";
  }
  const { start, end, status } = byteRange(request.headers.range, response, headers, bytes.length);
  headers['Content-Length'] = Math.max(0, end - start + 1);
  // An external edit can change the bytes before the next bank refresh.
  // Do not assign those bytes to the immutable URL of the older snapshot.
  if (expectedHash === entry.hash) {
    server.immutable(response);
  }
  response.writeHead(status, headers);
  response.end(request.method === 'HEAD' ? undefined : bytes.subarray(start, end + 1));
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

export function rootPage(request, response) {
  if (response.locals.target.pathname !== '/') {
    throw problem('RESOURCE_NOT_FOUND', '页面或资源不存在。', {}, 404);
  }
  const nonce = randomBytes(18).toString('base64');
  response.setHeader(
    'Content-Security-Policy',
    `default-src 'none'; script-src 'nonce-${nonce}' blob:; style-src 'self' 'unsafe-inline'; img-src data: blob:; connect-src 'self'; frame-src 'self'; worker-src blob:; base-uri 'none'; frame-ancestors 'none'`,
  );
  const bytes = Buffer.from(
    `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>QuizForge V2</title><link rel="stylesheet" href="/ui/quizforge-web-local.css"><div id="app"></div><script nonce="${nonce}" src="/ui/quizforge-ui.js"></script><script nonce="${nonce}">QuizForgeUI.mountV2App(document.getElementById('app'),${JSON.stringify(nonce)});</script></html>`,
  );
  response.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': bytes.length,
  });
  response.end(request.method === 'HEAD' ? undefined : bytes);
}
