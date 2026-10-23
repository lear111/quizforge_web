/* Local-only import. The original file is never uploaded or overwritten. */
(function (global) {
  'use strict';
  const maxInputBytes = 32 * 1024 * 1024, maxSeconds = 180, sampleRate = 16000;
  function checkCancelled(signal) { if (signal?.aborted) throw new DOMException('已取消音频导入', 'AbortError'); }
  function durationOf(file, signal) {
    return new Promise((resolve, reject) => {
      const audio = new Audio(), url = URL.createObjectURL(file);
      let timer;
      const done = (error, value) => {
        clearTimeout(timer); audio.onloadedmetadata = audio.onerror = null;
        signal?.removeEventListener('abort', abort);
        audio.removeAttribute('src'); audio.load(); URL.revokeObjectURL(url);
        error ? reject(error) : resolve(value);
      };
      const abort = () => done(new DOMException('已取消音频导入', 'AbortError'));
      audio.preload = 'metadata';
      audio.onloadedmetadata = () => {
        const value = audio.duration;
        done(!Number.isFinite(value) || value <= 0 || value > maxSeconds ? new Error('请选择不超过 3 分钟的完整音频') : null, value);
      };
      audio.onerror = () => done(new Error('无法读取音频，请选择浏览器支持的 WAV、MP3、M4A、OGG 或 FLAC 文件'));
      timer = setTimeout(() => done(new Error('音频读取超时，请换一个文件重试')), 15000);
      signal?.addEventListener('abort', abort, { once: true });
      audio.src = url;
    });
  }
  async function encodePcm(buffer, { signal, onProgress = () => {} } = {}) {
    checkCancelled(signal);
    if (buffer.sampleRate !== sampleRate || !buffer.length || !buffer.numberOfChannels || buffer.duration > maxSeconds) throw new Error('音频时长或采样率无效');
    const encoder = new global.lamejs.Mp3Encoder(1, sampleRate, 40);
    const channels = Array.from({length: buffer.numberOfChannels}, (_, index) => buffer.getChannelData(index));
    const chunks = []; let total = 0, sliceStarted = performance.now();
    const append = bytes => { if (bytes.length) { total += bytes.length; if (total > QFListeningAudio.maxBytes) throw new Error('压缩后音频仍超过 1 MiB，请截短后重试'); chunks.push(new Uint8Array(bytes)); } };
    for (let offset = 0; offset < buffer.length; offset += 1152) {
      checkCancelled(signal);
      const pcm = new Int16Array(Math.min(1152, buffer.length - offset));
      for (let index = 0; index < pcm.length; index++) {
        let value = 0;
        for (const channel of channels) value += channel[offset + index];
        value = Math.max(-1, Math.min(1, value / channels.length));
        pcm[index] = Math.round(value * (value < 0 ? 32768 : 32767));
      }
      append(encoder.encodeBuffer(pcm));
      if (performance.now() - sliceStarted > 25) {
        onProgress(Math.min(99, Math.round((offset + pcm.length) / buffer.length * 100)));
        await new Promise(resolve => setTimeout(resolve, 0)); sliceStarted = performance.now();
      }
    }
    append(encoder.flush()); checkCancelled(signal); onProgress(100);
    return new Blob(chunks, { type: 'audio/mpeg' });
  }
  async function importFile(file, {signal, onProgress = () => {}} = {}) {
    checkCancelled(signal);
    if (!file?.size || file.size > maxInputBytes) throw new Error('请选择不超过 32 MiB 的音频文件');
    if (!/\.(wav|mp3|m4a|aac|ogg|oga|flac)$/i.test(file.name)) throw new Error('请选择 WAV、MP3、M4A、AAC、OGG 或 FLAC 音频');
    onProgress('正在读取音频…'); await durationOf(file, signal); checkCancelled(signal);
    const Decoder = global.OfflineAudioContext || global.webkitOfflineAudioContext;
    if (!Decoder) throw new Error('此浏览器不支持本地音频转换，请使用新版 Edge 或 Chrome');
    const decoder = new Decoder(1, 1, sampleRate);
    const decoded = await decoder.decodeAudioData(await file.arrayBuffer()); checkCancelled(signal);
    const blob = await encodePcm(decoded, {signal, onProgress: value => onProgress(`正在压缩音频… ${value}%`)});
    checkCancelled(signal);
    const data = await new Promise((resolve,reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('无法保存转换后的音频')); reader.readAsDataURL(blob); });
    checkCancelled(signal);
    if (!QFListeningAudio.isInline(data)) throw new Error('转换后的 MP3 无效，请换一个音频重试');
    return {data, bytes: blob.size, originalBytes: file.size, duration: decoded.duration};
  }
  global.QFListeningImport = { importFile, encodePcm };
})(globalThis);
