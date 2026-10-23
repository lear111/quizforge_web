import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pageAssets, staticAssets } from './extension-packages.js';

function fixture(manifest, files) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qf-extension-assets-'));
  fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest));
  fs.writeFileSync(path.join(directory, 'practice.html'), '<main></main>');
  fs.writeFileSync(path.join(directory, 'practice.js'), '// script');
  fs.writeFileSync(path.join(directory, 'practice.css'), '/* style */');
  for (const [relative, bytes] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(directory, relative)), { recursive: true });
    fs.writeFileSync(path.join(directory, relative), bytes);
  }
  return directory;
}

const config = { entry: 'practice.html', script: 'practice.js', style: 'practice.css' };

test('音频资源可以内联进题型页面，并带上正确的 MIME', () => {
  const directory = fixture({ assets: ['assets/clip.mp3', 'assets/clip.wav', 'assets/poster.png'] }, {
    'assets/clip.mp3': Buffer.from([0xff, 0xfb, 0x90, 0x64]),
    'assets/clip.wav': Buffer.from('RIFF0000WAVE', 'ascii'),
    'assets/poster.png': Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  });
  const media = staticAssets(directory, JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8')));
  assert.deepEqual(media, ['assets/clip.mp3', 'assets/clip.wav', 'assets/poster.png']);
  const page = pageAssets(directory, config, media);
  assert.deepEqual(page.assets.map((asset) => [asset.path, asset.mime]), [
    ['assets/clip.mp3', 'audio/mpeg'],
    ['assets/clip.wav', 'audio/wav'],
    ['assets/poster.png', 'image/png'],
  ]);
  assert.equal(Buffer.from(page.assets[1].base64, 'base64').toString('ascii'), 'RIFF0000WAVE');
});

test('只有图片、字体与音频可以作为静态资源', () => {
  const directory = fixture({}, { 'assets/clip.txt': Buffer.from('hello') });
  assert.throws(() => pageAssets(directory, config, ['assets/clip.txt']), /image, font and audio/);
  assert.throws(() => pageAssets(directory, config, ['assets/missing.mp3']));
});

test('音频单文件上限为 4 MiB，图片仍是 1 MiB', () => {
  const directory = fixture({}, {
    'assets/large.mp3': Buffer.alloc(4 * 1024 * 1024 + 1),
    'assets/large.png': Buffer.alloc(1024 * 1024 + 1),
    'assets/ok.mp3': Buffer.alloc(2 * 1024 * 1024),
  });
  assert.throws(() => pageAssets(directory, config, ['assets/large.mp3']));
  assert.throws(() => pageAssets(directory, config, ['assets/large.png']));
  const page = pageAssets(directory, config, ['assets/ok.mp3']);
  assert.equal(page.assets[0].mime, 'audio/mpeg');
});

test('静态资源总量仍受 8 MiB 限制', () => {
  const directory = fixture({}, {
    'assets/a.mp3': Buffer.alloc(3 * 1024 * 1024),
    'assets/b.mp3': Buffer.alloc(3 * 1024 * 1024),
    'assets/c.mp3': Buffer.alloc(3 * 1024 * 1024),
  });
  assert.throws(() => pageAssets(directory, config, ['assets/a.mp3', 'assets/b.mp3', 'assets/c.mp3']), /8 MiB/);
});
