import test from 'node:test';
import assert from 'node:assert/strict';
import {
  acquireCoverObjectUrl,
  clearCoverObjectUrlCache,
  loadCoverThumbnail,
  peekCoverObjectUrl,
  releaseCoverObjectUrl,
  retainCoverObjectUrl,
} from './coverThumbnail.js';

test('thumbnail decoding deduplicates, bounds dimensions and recovers corrupt cache and bad poster', async () => {
  const originals = Object.fromEntries(['document', 'location', 'caches', 'createImageBitmap'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let loads = 0, removed = 0;
  const entries = new Map();
  const dimensions = [];
  const cache = { match: async (request) => entries.get(request.url)?.clone(), put: async (request, response) => entries.set(request.url, response), keys: async () => [...entries.keys()].map((url) => new Request(url)), delete: async (request) => { removed++; return entries.delete(request.url); } };
  globalThis.location = { origin: 'http://localhost' };
  globalThis.caches = { open: async () => cache };
  globalThis.createImageBitmap = async (blob) => { if (await blob.text() === 'corrupt') throw new Error('corrupt'); return { close() {} }; };
  globalThis.document = { createElement(type) {
    if (type === 'canvas') return { width: 0, height: 0, getContext() { return { drawImage() {} }; }, toBlob(callback) { dimensions.push([this.width, this.height]); callback(new Blob(['valid'], { type: 'image/webp' })); } };
    return { naturalWidth: 2400, naturalHeight: 1200, videoWidth: 1920, videoHeight: 1080, duration: 5,
      removeAttribute() {}, pause() {}, load() {},
      set currentTime(value) { queueMicrotask(() => this.onseeked?.()); },
      set src(value) { loads++; queueMicrotask(() => { if (value.includes('broken')) this.onerror?.(); else if (type === 'video') this.onloadedmetadata?.(); else this.onload?.(); }); },
    };
  } };
  try {
    const cover = { kind: 'image', mediaUrl: '/image.png', sourceRevision: 'test-image' };
    const [a, b] = await Promise.all([loadCoverThumbnail(cover), loadCoverThumbnail(cover)]);
    assert.equal(a, b); assert.equal(loads, 1); assert.deepEqual(dimensions[0], [640, 320]);
    await loadCoverThumbnail(cover); assert.equal(loads, 1);
    for (const key of entries.keys()) entries.set(key, new Response(new Blob(['corrupt']), { headers: { 'x-cover-created': String(Date.now()) } }));
    await loadCoverThumbnail(cover); assert.equal(loads, 2); assert.equal(removed, 1);
    await loadCoverThumbnail({ kind: 'video', mediaUrl: '/movie.mp4', thumbnailUrl: '/broken.png', sourceRevision: 'test-video' });
    assert.equal(loads, 4); assert.deepEqual(dimensions.at(-1), [640, 360]);
    await assert.rejects(loadCoverThumbnail({ kind: 'image', mediaUrl: '/broken.png', sourceRevision: 'test-failure' }));
    const failedLoads = loads;
    await assert.rejects(loadCoverThumbnail({ kind: 'image', mediaUrl: '/broken.png', sourceRevision: 'test-failure' }), /retry-later/);
    assert.equal(loads, failedLoads);
  } finally {
    for (const [key, descriptor] of Object.entries(originals)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  }
});

test('cache hits bypass slow video decode, 40+ cards do not hit queue-full, and AbortSignal cancels queued work', async () => {
  const originals = Object.fromEntries(['document', 'location', 'caches', 'createImageBitmap'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const entries = new Map();
  let startedUrls = [];
  const cache = {
    match: async (request) => entries.get(request.url)?.clone(),
    put: async (request, response) => entries.set(request.url, response),
    keys: async () => [...entries.keys()].map((url) => new Request(url)),
    delete: async (request) => entries.delete(request.url),
  };
  globalThis.location = { origin: 'http://localhost' };
  globalThis.caches = { open: async () => cache };
  globalThis.createImageBitmap = async () => ({ close() {} });
  let releaseBlocker;
  const blockerGate = new Promise((resolve) => { releaseBlocker = resolve; });
  globalThis.document = {
    createElement(type) {
      if (type === 'canvas') {
        return {
          width: 0,
          height: 0,
          getContext() { return { drawImage() {} }; },
          toBlob(callback) { callback(new Blob(['valid'], { type: 'image/webp' })); },
        };
      }
      return {
        naturalWidth: 800,
        naturalHeight: 600,
        videoWidth: 1280,
        videoHeight: 720,
        duration: 5,
        removeAttribute() {},
        pause() {},
        load() {},
        set currentTime(_v) { queueMicrotask(() => this.onseeked?.()); },
        set src(value) {
          startedUrls.push(value);
          if (value.includes('slow-video')) {
            blockerGate.then(() => this.onloadedmetadata?.());
          } else {
            setTimeout(() => this.onload?.(), 5);
          }
        },
      };
    },
  };
  try {
    const cachedCover = { kind: 'image', mediaUrl: '/warm-cached.png', sourceRevision: 'warm-1' };
    await loadCoverThumbnail(cachedCover);

    // Start a slow video decode that stays pending until releaseBlocker().
    const slowVideo = loadCoverThumbnail({ kind: 'video', mediaUrl: '/slow-video.mp4', sourceRevision: 'slow-vid' });

    // A cache hit must finish immediately without waiting for slowVideo.
    const cacheHit = await Promise.race([
      loadCoverThumbnail(cachedCover).then(() => 'hit'),
      new Promise((resolve) => setTimeout(() => resolve('blocked'), 100)),
    ]);
    assert.equal(cacheHit, 'hit', 'Cache API hit must not be head-of-line blocked by slow video');

    // 40 concurrent images must all fulfill without throwing thumbnail-queue-full.
    const batch = await Promise.all(
      Array.from({ length: 40 }, (_, i) =>
        loadCoverThumbnail({ kind: 'image', mediaUrl: `/batch-${i}.png`, sourceRevision: `batch-${i}` }),
      ),
    );
    assert.equal(batch.length, 40);
    assert.ok(batch.every((blob) => blob instanceof Blob));

    // An already-aborted signal must reject immediately without starting media load.
    const preAborted = new AbortController();
    preAborted.abort();
    const beforeCount = startedUrls.length;
    await assert.rejects(
      loadCoverThumbnail({ kind: 'image', mediaUrl: '/never-load.png', sourceRevision: 'abort-1' }, { signal: preAborted.signal }),
      { name: 'AbortError' },
    );
    assert.equal(startedUrls.length, beforeCount);

    releaseBlocker();
    await slowVideo;
  } finally {
    for (const [key, descriptor] of Object.entries(originals)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  }
});

test('session LRU ObjectURL cache reuses active URLs and only revokes unreferenced evicted items', () => {
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  let seq = 0;
  const revoked = [];
  URL.createObjectURL = () => `blob:test-${++seq}`;
  URL.revokeObjectURL = (u) => { revoked.push(u); };
  clearCoverObjectUrlCache();
  try {
    const coverA = { kind: 'image', mediaUrl: '/a.png', sourceRevision: 'rev-a' };
    const urlA = acquireCoverObjectUrl(coverA, new Blob(['a']));
    assert.equal(peekCoverObjectUrl(coverA), urlA);
    assert.equal(retainCoverObjectUrl(coverA), urlA);
    // Still refCount = 2 -> releasing once leaves refCount = 1 (active).
    releaseCoverObjectUrl(coverA);

    // Fill beyond LRU cap (96) with released covers.
    for (let i = 0; i < 105; i += 1) {
      const c = { kind: 'image', mediaUrl: `/evict-${i}.png`, sourceRevision: `rev-${i}` };
      acquireCoverObjectUrl(c, new Blob([String(i)]));
      releaseCoverObjectUrl(c);
    }
    assert.equal(revoked.includes(urlA), false, 'Active referenced URL must not be revoked during LRU eviction');
    assert.ok(revoked.length >= 9, 'Unreferenced overflow entries must be evicted and revoked');
    releaseCoverObjectUrl(coverA);
  } finally {
    clearCoverObjectUrlCache();
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  }
});
