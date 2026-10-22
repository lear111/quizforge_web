import { randomInt } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { ApiError } from '../platform/errors.js';
import { parseJson } from '../platform/json.js';
import { AiProviderError } from './ai-provider.js';

// A small embedded bitmap font makes the randomized visual probe independent of
// installed fonts, browser canvases, Java AWT and native image dependencies.
const font = {
  A: '01110 10001 10001 11111 10001 10001 10001', B: '11110 10001 10001 11110 10001 10001 11110', C: '01111 10000 10000 10000 10000 10000 01111', D: '11110 10001 10001 10001 10001 10001 11110', E: '11111 10000 10000 11110 10000 10000 11111', F: '11111 10000 10000 11110 10000 10000 10000', G: '01111 10000 10000 10111 10001 10001 01111', H: '10001 10001 10001 11111 10001 10001 10001', J: '00111 00010 00010 00010 10010 10010 01100', K: '10001 10010 10100 11000 10100 10010 10001', M: '10001 11011 10101 10101 10001 10001 10001', N: '10001 11001 11001 10101 10011 10011 10001', P: '11110 10001 10001 11110 10000 10000 10000', Q: '01110 10001 10001 10001 10101 10010 01101', R: '11110 10001 10001 11110 10100 10010 10001', S: '01111 10000 10000 01110 00001 00001 11110', T: '11111 00100 00100 00100 00100 00100 00100', U: '10001 10001 10001 10001 10001 10001 01110', V: '10001 10001 10001 10001 10001 01010 00100', W: '10001 10001 10001 10101 10101 10101 01010', X: '10001 10001 01010 00100 01010 10001 10001', Y: '10001 10001 01010 00100 00100 00100 00100', Z: '11111 00001 00010 00100 01000 10000 11111', '2': '01110 10001 00001 00010 00100 01000 11111', '3': '11110 00001 00001 01110 00001 00001 11110', '4': '00010 00110 01010 10010 11111 00010 00010', '5': '11111 10000 10000 11110 00001 00001 11110', '6': '01110 10000 10000 11110 10001 10001 01110', '7': '11111 00001 00010 00100 01000 01000 01000', '8': '01110 10001 10001 01110 10001 10001 01110', '9': '01110 10001 10001 01111 00001 00001 01110'
};
function crc32(bytes) { let crc = 0xffffffff; for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); } return (crc ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const name = Buffer.from(type), length = Buffer.alloc(4), crc = Buffer.alloc(4); length.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([name, data]))); return Buffer.concat([length, name, data, crc]); }
export function challenge() {
  const alphabet = Object.keys(font).join(''), expected = Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join(''), width = 520, height = 150, stride = width * 3 + 1, pixels = Buffer.alloc(stride * height, 255);
  for (let y = 0; y < height; y++) pixels[y * stride] = 0;
  for (let character = 0; character < expected.length; character++) {
    const rows = font[expected[character]].split(' ');
    for (let y = 0; y < 7; y++) for (let x = 0; x < 5; x++) if (rows[y][x] === '1') for (let dy = 0; dy < 10; dy++) for (let dx = 0; dx < 10; dx++) pixels.fill(0, (40 + y * 10 + dy) * stride + 1 + (85 + character * 60 + x * 10 + dx) * 3, (40 + y * 10 + dy) * stride + 1 + (85 + character * 60 + x * 10 + dx) * 3 + 3);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]); return { expected, dataUrl: 'data:image/png;base64,' + png.toString('base64') };
}
export function parseModelOutput(output) {
  if (typeof output !== 'string' || output.length > 24000) return null; let text = output.trim();
  if (text.startsWith('```')) { const match = /^```(?:json)?[ \t]*\r?\n([\s\S]*)\r?\n?```$/i.exec(text); if (!match) return null; text = match[1].trim(); }
  try { const value = parseJson(text); if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 2 || typeof value.score !== 'number' || !Number.isFinite(value.score) || typeof value.feedback !== 'string' || !value.feedback.trim() || value.feedback.length > 18000) return null; return value; } catch { return null; }
}
// Compares a read-out with the expected characters, ignoring case, spaces and separators,
// and allowing one wrong, missing or extra character (edit distance at most 1).
export function closeEnough(read, expected) {
  const a = String(read).toUpperCase().replace(/[^A-Z0-9]/g, ''), b = expected.toUpperCase();
  if (Math.abs(a.length - b.length) > 1) return false;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    previous = row;
  }
  return previous[b.length] <= 1;
}
export async function runDiagnostics(settings, probe, challenges = challenge) {
  const original = settings.profile; if (!original.baseUrl || !original.model.trim()) throw new AiProviderError('AI_NOT_CONFIGURED'); const started = performance.now(); let calls = 0, mode = 'json', text = null, failure = null;
  const report = { testedAt: new Date().toISOString(), model: original.model, checks: [] }, connection = { id: 'connection', label: '文字连接' }, format = { id: 'gradingFormat', label: '评分输出' }, vision = { id: 'vision', label: '图片识别' }; report.checks.push(connection, format, vision);
  const profile = () => ({ ...original, vision: true, outputMode: mode, maxOutputTokens: 2048, timeoutSeconds: Math.min(35, original.timeoutSeconds) }), mark = (check, status, message) => Object.assign(check, { status, message });
  const content = [{ type: 'text', text: '这是显式模型测试，不包含用户题库或答案。maxScore=5，scoreStep=0.5。请仅返回 JSON：{"score":2.5,"feedback":"文字与评分输出正常"}。' }];
  try { calls++; text = await probe(profile(), content); }
  catch (error) { if (!(error instanceof AiProviderError)) throw error; if (error.code === 'AI_CONFIG') { mode = 'text'; try { calls++; text = await probe(profile(), content); } catch (second) { if (!(second instanceof AiProviderError)) throw second; failure = second; } } else failure = error; }
  if (failure || !text) { mark(connection, 'failed', failure?.message ?? '模型未返回可用响应。'); mark(format, 'skipped', '连接未通过，暂未验证评分输出。'); mark(vision, 'skipped', '连接未通过，暂时无法判断图片能力。'); }
  else {
    mark(connection, 'passed', '模型已成功返回文字响应。'); const value = parseModelOutput(text.output), formatOk = value?.score === 2.5; mark(format, formatOk ? 'passed' : 'failed', formatOk ? '返回了符合要求的分数与反馈。' : '模型已响应，但评分结果格式或测试分数不符合要求。');
    if (formatOk) {
      const image = challenges(), content = [{ type: 'text', text: '这是图片识别测试。请读取图片中唯一一行大写字母与数字，保持原顺序和大小写。仅返回 JSON：score 固定为 0，feedback 只填写读出的字符，不添加解释。正确字符仅存在于图片中。' }, { type: 'image_url', image_url: { url: image.dataUrl, detail: 'auto' } }];
      try {
        calls++; const output = parseModelOutput((await probe(profile(), content)).output), read = output ? output.feedback.trim() : '';
        // Spaces, separators and case do not matter, and one wrong, missing or extra character is allowed.
        const recognized = !!output && closeEnough(read, image.expected), shown = `读出 ${read.slice(0, 40) || '（空）'}，实际 ${image.expected}`;
        mark(vision, recognized ? 'passed' : 'failed', !output ? '模型没有按要求返回 JSON，图片评分暂未启用。' : recognized ? `成功读出随机测试图片（${shown}），可用于图片评分。` : `未能正确读出测试图片（${shown}），图片评分暂未启用。`);
      }
      catch (error) { if (!(error instanceof AiProviderError)) throw error; mark(vision, 'unknown', '图片测试未完成：' + error.message); }
    } else mark(vision, 'skipped', '评分输出未通过，暂未验证图片能力。');
  }
  const usable = connection.status === 'passed' && format.status === 'passed', supportsVision = vision.status === 'passed';
  Object.assign(report, { ok: usable, status: !usable ? 'failed' : supportsVision ? 'passed' : 'partial', summary: !usable ? '模型测试未通过，请查看下方结果。' : supportsVision ? '文字评分与基础图片识别均通过。' : '文字评分可用，图片识别尚未通过。', calls, elapsedMs: Math.floor(performance.now() - started), note: '图片通过仅代表基础识别测试成功，复杂图表及手写内容仍需实际验证。' });
  try { report.settings = await settings.saveTest(original, report, supportsVision, mode); } catch (error) { if (error instanceof ApiError) throw error; throw new ApiError(503, 'AI_TEST_SAVE_FAILED', '测试结果未能保存，请重试；已有配置保留。'); } return report;
}
