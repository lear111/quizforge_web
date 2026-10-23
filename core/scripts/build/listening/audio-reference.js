// Inline audio belongs to one question, so imports never mutate a shared extension.
(function (global) {
  'use strict';
  const prefix = 'data:audio/mpeg;base64,';
  const maxBytes = 1024 * 1024;
  function isInline(value) {
    if (typeof value !== 'string' || !value.startsWith(prefix)) return false;
    const data = value.slice(prefix.length);
    if (!data.length || data.length > Math.ceil(maxBytes / 3) * 4 || data.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return false;
    const bytes = data.length / 4 * 3 - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0);
    if (bytes < 4 || bytes > maxBytes) return false;
    // MP3 frame sync or an ID3 tag; never allow arbitrary data URL MIME types.
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const first = (alphabet.indexOf(data[0]) << 2) | (alphabet.indexOf(data[1]) >> 4);
    const second = ((alphabet.indexOf(data[1]) & 15) << 4) | (alphabet.indexOf(data[2]) >> 2);
    return data.startsWith('SUQz') || first === 255 && (second & 224) === 224 && (second & 6) !== 0;
  }
  function isReference(value) {
    return typeof value === 'string' && (/^assets\/[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.(?:wav|mp3|m4a|aac|ogg|oga|flac)$/.test(value) || isInline(value));
  }
  global.QFListeningAudio = { isInline, isReference, maxBytes };
})(globalThis);
