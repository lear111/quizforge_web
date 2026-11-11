import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const core = fileURLToPath(new URL('../../', import.meta.url));
export const ARCHIVE_PERF_GROUP = 'ArchivePerf';
const reference = { path: 'extensions/ArchivePerf/choice' };
const document = text => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const write = (file, bytes) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes); };
const json = (file, value) => write(file, JSON.stringify(value));
function png(index) {
  function chunk(type, data) {
    const body = Buffer.concat([Buffer.from(type), data]), size = Buffer.alloc(4), crc = Buffer.alloc(4);
    size.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(body)); return Buffer.concat([size, body, crc]);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(128, 0); header.writeUInt32BE(128, 4); header[8] = 8; header[9] = 6;
  const pixels = Buffer.alloc((1 + 128 * 4) * 128); let next = index + 1;
  for (let y = 0; y < 128; y++) for (let x = 1; x <= 128 * 4; x++) {
    next ^= next << 13; next ^= next >>> 17; next ^= next << 5; pixels[y * 513 + x] = next & 255;
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
export function createArchivePerfFixture(destination, { ffmpeg = 'ffmpeg' } = {}) {
  const root = path.resolve(destination);
  // Exclusive mkdir: never mix synthetic data into an existing application root.
  fs.mkdirSync(root);
  const source = path.resolve(core, '../extensions/基础题型/单选题'), extension = path.join(root, reference.path);
  fs.cpSync(source, extension, { recursive: true, filter: file => !['assets', 'examples'].includes(path.relative(source, file).split(path.sep)[0]) });
  const manifest = JSON.parse(fs.readFileSync(path.join(extension, 'manifest.json'), 'utf8'));
  // Retain the real installed UI/rules/schema/SDK declarations, with a tiny valid example.
  const question = index => ({ id: 'q' + String(index + 1).padStart(3, '0'), title: 'Synthetic image ' + (index + 1),
    data: { formatVersion: 1, stem: document('Synthetic picture question ' + (index + 1)),
      options: ['A', 'B', 'C', 'D'].map(id => ({ id, content: document('Option ' + id) })),
      correctOptionId: 'A', answerAndExplanation: document('Synthetic explanation'), maxScore: 3 } });
  json(path.join(extension, manifest.examples), { formatVersion: 1, id: 'examples', title: 'Synthetic example', extension: reference, questions: [question(0)] });
  let imageBytes = 0, audioBytes = 0;
  const audio = [['mp3', 'libmp3lame'], ['ogg', 'libvorbis'], ['m4a', 'aac']];
  for (let bank = 0; bank < 3; bank++) {
    const directory = path.join(root, 'question-banks', ARCHIVE_PERF_GROUP, 'Bank' + (bank + 1)), questions = [];
    for (let index = bank; index < 500; index += 3) {
      const bytes = png(index), id = createHash('sha256').update(bytes).digest('hex'), row = question(index);
      row.data.stem.content.push({ type: 'image', attrs: { assetId: id, alt: 'Synthetic noise image', width: 128 } });
      row.listening = { materialId: 'track' }; questions.push(row);
      write(path.join(directory, 'assets', id + '.png'), bytes); imageBytes += bytes.length;
    }
    const [suffix, codec] = audio[bank], file = path.join(directory, 'media', 'track.' + suffix);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // Actual decodable audio, not a magic signature plus random padding.
    const made = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `anoisesrc=color=white:sample_rate=44100:seed=${bank + 1}:duration=150`,
      '-map_metadata', '-1', '-ac', '1', '-c:a', codec, '-b:a', '128k', '-n', file], { encoding: 'utf8', windowsHide: true });
    if (made.error || made.status !== 0) throw new Error('Audio fixture requires ffmpeg with libmp3lame/libvorbis/AAC: ' + (made.error?.message ?? made.stderr));
    audioBytes += fs.statSync(file).size;
    json(path.join(directory, 'bank.json'), { formatVersion: 1, id: 'archive-perf-' + (bank + 1), title: 'Synthetic bank ' + (bank + 1), extension: reference,
      listening: { materials: [{ id: 'track', title: 'Synthetic noise ' + (bank + 1), file: 'media/track.' + suffix }], examMaterialId: 'track' }, questions });
  }
  const files = fs.readdirSync(root, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile()).map(entry => path.join(entry.parentPath, entry.name));
  const report = { fixture: 'quizforge-archive-b7a-v1', group: ARCHIVE_PERF_GROUP, banks: 3, images: 500, audio: 3,
    imageBytes, audioBytes, sourceBytes: files.reduce((sum, file) => sum + fs.statSync(file).size, 0), files: files.length,
    audioSecondsEach: 150, audioFormats: audio.map(row => row[0]) };
  json(path.join(root, 'archive-perf-fixture.json'), report); return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.length !== 3) throw new Error('Usage: node core/scripts/dev/create-archive-perf-fixture.mjs <new-directory>');
  console.log(JSON.stringify(createArchivePerfFixture(process.argv[2]), null, 2));
}
