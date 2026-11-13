/**
 * Local imported-media helpers: URL derivation, probe, MIME whitelist.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  applyLocalMediaProbe,
  buildImportedMediaData,
  collectRealPaths,
  detectMimeFromFile,
  isAllowedImportedMedia,
  isBlobUrl,
  isLocalFileUrl,
  localFileMediaUrl,
  localFilePathFromUrl,
  looksAbsolutePath,
  materialTypeFromFilename,
  sniffMediaExtension,
  sniffMimeType,
} from './localMedia.ts';

test('localFileMediaUrl 编码绝对路径，禁止 blob', () => {
  const url = localFileMediaUrl('/Users/me/a b.png');
  assert.match(url, /^\/omnimux-workflow\/api\/local-file\?path=/);
  assert.equal(url.includes(' '), false);
  assert.equal(localFilePathFromUrl(url), '/Users/me/a b.png');
  assert.equal(isBlobUrl('blob:http://localhost/x'), true);
  assert.equal(isBlobUrl(url), false);
  assert.equal(isLocalFileUrl(url), true);
  assert.equal(isLocalFileUrl('blob:http://localhost/x'), false);
});

test('MIME / 扩展名白名单：媒体放行，pdf 拒绝', () => {
  assert.equal(materialTypeFromFilename('hero.png'), 'image');
  assert.equal(materialTypeFromFilename('clip.mp4'), 'video');
  assert.equal(materialTypeFromFilename('voice.wav'), 'audio');
  assert.equal(isAllowedImportedMedia('notes.pdf'), false);
  assert.equal(looksAbsolutePath('/tmp/a.png'), true);
  assert.equal(looksAbsolutePath('relative.png'), false);
  assert.equal(looksAbsolutePath('C:\\clips\\a.mp4'), true);
});

test('buildImportedMediaData 写入 realPath 且 mediaUrl 派生', () => {
  const data = buildImportedMediaData({
    realPath: '/Users/me/hero.png',
    name: 'hero.png',
    materialType: 'image',
    mime: 'image/png',
    size: 12,
  });
  assert.equal(data.realPath, '/Users/me/hero.png');
  assert.equal(data.status, 'ready');
  assert.equal(data.isMissing, false);
  assert.equal(data.mediaUrl.includes('blob:'), false);
  assert.equal(data.mediaAssets[0].path, '/Users/me/hero.png');
});

test('applyLocalMediaProbe：缺失 → offline，找回 → ready', () => {
  const nodes = [
    { id: 'n1', data: { realPath: '/gone.png', status: 'ready', isMissing: false } },
    { id: 'n2', data: { realPath: '/ok.png', status: 'offline', isMissing: true } },
    { id: 'n3', data: { mediaUrl: '/media/x.png' } },
  ];
  const next = applyLocalMediaProbe(nodes, [
    { path: '/gone.png', exists: false },
    { path: '/ok.png', exists: true, size: 8 },
  ]);
  assert.equal(next[0].data.status, 'offline');
  assert.equal(next[0].data.isMissing, true);
  assert.equal(next[1].data.status, 'ready');
  assert.equal(next[1].data.isMissing, false);
  assert.equal(next[2], nodes[2]);
  assert.deepEqual(collectRealPaths(nodes), ['/gone.png', '/ok.png']);
});

function u8(...bytes) {
  return Uint8Array.from(bytes);
}

test('sniffMimeType 识别常见媒体魔数', () => {
  assert.equal(sniffMimeType(u8(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a)), 'image/png');
  assert.equal(sniffMimeType(u8(0xff, 0xd8, 0xff, 0xe0)), 'image/jpeg');
  assert.equal(sniffMimeType(Buffer.from('GIF89a')), 'image/gif');
  const webp = Buffer.alloc(12);
  webp.write('RIFF', 0);
  webp.write('WEBP', 8);
  assert.equal(sniffMimeType(webp), 'image/webp');
  const wav = Buffer.alloc(12);
  wav.write('RIFF', 0);
  wav.write('WAVE', 8);
  assert.equal(sniffMimeType(wav), 'audio/wav');
  const mp4 = Buffer.alloc(8);
  mp4.write('ftyp', 4);
  assert.equal(sniffMimeType(mp4), 'video/mp4');
  assert.equal(sniffMimeType(u8(0x1a, 0x45, 0xdf, 0xa3, 0x01)), 'video/webm');
  assert.equal(sniffMimeType(Buffer.from('ID3\x03\x00')), 'audio/mpeg');
  assert.equal(sniffMimeType(u8(0xff, 0xfb, 0x90, 0x00)), 'audio/mpeg');
  assert.equal(
    sniffMimeType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')),
    'image/svg+xml',
  );
  assert.equal(
    sniffMimeType(Buffer.from('<?xml version="1.0"?><svg></svg>')),
    'image/svg+xml',
  );
  assert.equal(sniffMimeType(u8()), undefined);
  assert.equal(sniffMimeType(Buffer.from('hello world')), undefined);
});

test('sniffMediaExtension 返回对应扩展名', () => {
  assert.equal(sniffMediaExtension(u8(0x89, 0x50, 0x4e, 0x47)), 'png');
  assert.equal(sniffMediaExtension(u8(0xff, 0xd8, 0xff)), 'jpg');
  assert.equal(sniffMediaExtension(Buffer.from('GIF8')), 'gif');
  const webp = Buffer.alloc(12);
  webp.write('RIFF', 0);
  webp.write('WEBP', 8);
  assert.equal(sniffMediaExtension(webp), 'webp');
  assert.equal(sniffMediaExtension(Buffer.from('<svg/>')), 'svg');
  const mp4 = Buffer.alloc(8);
  mp4.write('ftyp', 4);
  assert.equal(sniffMediaExtension(mp4), 'mp4');
  assert.equal(sniffMediaExtension(Buffer.from('ID3')), 'mp3');
  const wav = Buffer.alloc(12);
  wav.write('RIFF', 0);
  wav.write('WAVE', 8);
  assert.equal(sniffMediaExtension(wav), 'wav');
  assert.equal(sniffMediaExtension(Buffer.from('not-media')), undefined);
});

test('detectMimeFromFile：魔数优先于错误扩展名，未知内容回退文件名', () => {
  const dir = mkdtempSync(join(tmpdir(), 'local-media-sniff-'));
  try {
    const pngNamedSvg = join(dir, 'artifact.svg');
    writeFileSync(pngNamedSvg, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    assert.equal(detectMimeFromFile(pngNamedSvg), 'image/png');

    const jpegNamedBin = join(dir, 'photo.bin');
    writeFileSync(jpegNamedBin, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]));
    assert.equal(detectMimeFromFile(jpegNamedBin, 'application/octet-stream'), 'image/jpeg');

    const realSvg = join(dir, 'icon.svg');
    writeFileSync(realSvg, '<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'utf8');
    assert.equal(detectMimeFromFile(realSvg), 'image/svg+xml');

    const namedPngUnknown = join(dir, 'plain.png');
    writeFileSync(namedPngUnknown, 'not a png', 'utf8');
    assert.equal(detectMimeFromFile(namedPngUnknown, 'application/octet-stream'), 'image/png');

    const unknown = join(dir, 'notes.bin');
    writeFileSync(unknown, 'zzzz', 'utf8');
    assert.equal(detectMimeFromFile(unknown, 'application/octet-stream'), 'application/octet-stream');
    assert.equal(detectMimeFromFile(unknown), 'application/octet-stream');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
