import assert from 'node:assert/strict';
import { posix, win32 } from 'node:path';
import test from 'node:test';
import { fetchLibraryMedia, filterLibraryMedia, readLibraryMedia } from './openreel/web/components/editor/asset-library-media.ts';

const library = '/omnimux/assets/library';
const localFile = '/omnimux-workflow/api/local-file';
const audioPath = posix.join('/', 'qa-library', 'test voice #2.WAV');
const file = (id, kind, original_name, extra = {}) => ({ id, kind, original_name, visible: true, ...extra });

const payload = {
  lrev: 2,
  assets: [{
    id: 'ast_film', name: '海风合集', type: 'custom', cover_file_id: 'fil_cover',
    files: [
      file('fil_video', 'video', 'Sea Film.mp4', { real_path: 'ignored', uri: 'ignored' }),
      file('fil_cover', 'image', 'Sea.png', { real_path: 'ignored' }),
      file('fil_audio', 'audio', 'Voice.WAV', { real_path: audioPath }),
      file('fil_folder', 'directory', 'Folder'),
      file('fil_script', 'image', 'Example.svg'),
      file('fil_unknown', 'pdf', 'Story.pdf'),
      file('fil_invisible', 'video', 'Offline.webm', { visible: false }),
      file('x:injected', 'video', 'Wrong.mp4'),
      file('fil_video', 'video', 'Duplicate.mp4'),
    ],
  }, {
    id: 'ast_other', name: '山景', cover_file_id: 'fil_cover',
    files: [file('fil_video', 'video', 'Mountain.webm')],
  }, {
    id: 'fake/file', name: 'Invalid', files: [file('fil_fake', 'image', 'Invalid.png')],
  }, null],
};

test('library projection uses individual visible file identities and same-asset image covers', () => {
  const cards = readLibraryMedia(payload);
  assert.deepEqual(cards, [
    { id: 'library:ast_film:fil_video', assetName: '海风合集', name: 'Sea Film.mp4', type: 'video',
      url: `${library}/preview?id=ast_film&file=fil_video`, coverUrl: `${library}/preview?id=ast_film&file=fil_cover` },
    { id: 'library:ast_film:fil_cover', assetName: '海风合集', name: 'Sea.png', type: 'image',
      url: `${library}/preview?id=ast_film&file=fil_cover` },
    { id: 'library:ast_film:fil_audio', assetName: '海风合集', name: 'Voice.WAV', type: 'audio',
      url: `${localFile}?path=${encodeURIComponent(audioPath)}` },
    { id: 'library:ast_other:fil_video', assetName: '山景', name: 'Mountain.webm', type: 'video',
      url: `${library}/preview?id=ast_other&file=fil_video` },
  ]);
  assert.deepEqual(filterLibraryMedia(cards, 'all', ' SEA ').map(card => card.name), ['Sea Film.mp4', 'Sea.png']);
  assert.deepEqual(filterLibraryMedia(cards, 'audio', '海风').map(card => card.name), ['Voice.WAV']);
  assert.deepEqual(filterLibraryMedia(cards, 'image', 'Voice'), []);
});

test('library audio requires a supported absolute path and keeps it out of display and identity', () => {
  const windows = win32.join('Z:\\', 'qa-library', 'voice.ogg');
  const badPaths = [undefined, 'relative.wav', 'https://invalid.test/voice.wav', '/voice.aiff', '/voice\u0000.wav', '/voice\n.wav', '/voice\ud800.wav'];
  const cards = readLibraryMedia({ assets: [{ id: 'ast_audio', files: [
    file('fil_windows', 'audio', windows, { real_path: windows }),
    ...badPaths.map((path, index) => file(`fil_bad_${index}`, 'audio', 'voice.wav', { real_path: path })),
  ] }] });
  assert.deepEqual(cards.map(({ id, name, url }) => ({ id, name, url })), [
    { id: 'library:ast_audio:fil_windows', name: 'voice.ogg', url: `${localFile}?path=${encodeURIComponent(windows)}` },
  ]);
});

test('library fetch makes a same-origin abortable GET and treats invalid payloads as failures', async () => {
  const controller = new AbortController();
  const read = async (url, init) => {
    assert.equal(url, library);
    assert.deepEqual(init, { method: 'GET', mode: 'same-origin', credentials: 'same-origin', redirect: 'error', cache: 'no-store', signal: controller.signal });
    return Response.json(payload);
  };
  assert.equal((await fetchLibraryMedia(controller.signal, read)).length, 4);
  assert.deepEqual(await fetchLibraryMedia(controller.signal, async () => Response.json({ assets: [] })), []);
  await assert.rejects(fetchLibraryMedia(controller.signal, async () => new Response('', { status: 503 })), /503/);
  await assert.rejects(fetchLibraryMedia(controller.signal, async () => Response.json({ assets: [], error: 'failed' })), /Invalid asset library/);
  await assert.rejects(fetchLibraryMedia(controller.signal, async () => Response.json({})), /Invalid asset library/);
});
