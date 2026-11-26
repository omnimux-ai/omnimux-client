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
        naturalWidth: 320,
        naturalHeight: 180,
        videoWidth: 320,
        videoHeight: 180,
        duration: 4,
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

    const slowVideo = loadCoverThumbnail({ kind: 'video', mediaUrl: '/slow-video.mp4', sourceRevision: 'slow-vid' });

    const cacheHit = await Promise.race([
      loadCoverThumbnail(cachedCover).then(() => 'hit'),
      new Promise((resolve) => setTimeout(() => resolve('blocked'), 100)),
    ]);
    assert.equal(cacheHit, 'hit', 'Cache API hit must not be head-of-line blocked by slow video');

    const batch = await Promise.all(
      Array.from({ length: 40 }, (_, i) =>
        loadCoverThumbnail({ kind: 'image', mediaUrl: `/batch-${i}.png`, sourceRevision: `batch-${i}` }),
      ),
    );
    assert.equal(batch.length, 40);
    assert.ok(batch.every((blob) => blob instanceof Blob));

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
    releaseCoverObjectUrl(coverA);

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

test('queued pool abort, shared waiter isolation, and immediate post-abort re-request without poisoning', async () => {
  const originals = {
    caches: Object.getOwnPropertyDescriptor(globalThis, 'caches'),
    createImageBitmap: Object.getOwnPropertyDescriptor(globalThis, 'createImageBitmap'),
    document: Object.getOwnPropertyDescriptor(globalThis, 'document'),
  };
  const startedUrls = [];
  const pendingLoads = new Map();
  Object.defineProperty(globalThis, 'caches', { configurable: true, value: undefined });
  globalThis.createImageBitmap = async () => ({ close() {} });
  globalThis.document = {
    createElement(tag) {
      if (tag === 'canvas') {
        return {
          getContext: () => ({ drawImage() {} }),
          toBlob: (cb) => cb(new Blob(['thumb'], { type: 'image/webp' })),
        };
      }
      return {
        naturalWidth: 100,
        naturalHeight: 100,
        removeAttribute() {},
        set src(value) {
          if (!value) return;
          startedUrls.push(value);
          const list = pendingLoads.get(value) || [];
          list.push(this);
          pendingLoads.set(value, list);
        },
      };
    },
  };
  const resolveImage = (url) => {
    const list = pendingLoads.get(url) || [];
    while (list.length > 0) list.shift().onload?.();
  };
  try {
    const slotPromises = [0, 1, 2, 3].map((i) =>
      loadCoverThumbnail({ kind: 'image', mediaUrl: `/slot-${i}.png`, sourceRevision: `slot-${i}` }),
    );
    await new Promise((r) => setTimeout(r, 10));
    const queuedController = new AbortController();
    const queuedPromise = loadCoverThumbnail(
      { kind: 'image', mediaUrl: '/queued-abort.png', sourceRevision: 'queued-abort' },
      { signal: queuedController.signal },
    );
    await new Promise((r) => setTimeout(r, 10));
    queuedController.abort();
    await assert.rejects(queuedPromise, { name: 'AbortError' });
    for (let i = 0; i < 4; i += 1) resolveImage(`/slot-${i}.png`);
    await Promise.all(slotPromises);
    assert.equal(startedUrls.includes('/queued-abort.png'), false, 'Aborted queued item must never start image load');

    const sharedCover = { kind: 'image', mediaUrl: '/shared-two.png', sourceRevision: 'shared-two' };
    const c1 = new AbortController();
    const c2 = new AbortController();
    const p1 = loadCoverThumbnail(sharedCover, { signal: c1.signal });
    const p2 = loadCoverThumbnail(sharedCover, { signal: c2.signal });
    await new Promise((r) => setTimeout(r, 10));
    c1.abort();
    await assert.rejects(p1, { name: 'AbortError' });
    resolveImage('/shared-two.png');
    const survivingBlob = await p2;
    assert.ok(survivingBlob instanceof Blob, 'Surviving shared waiter must still resolve');

    const remountCover = { kind: 'image', mediaUrl: '/remount-race.png', sourceRevision: 'remount-race' };
    const firstCtrl = new AbortController();
    const firstReq = loadCoverThumbnail(remountCover, { signal: firstCtrl.signal });
    firstCtrl.abort();
    const secondReq = loadCoverThumbnail(remountCover);
    await assert.rejects(firstReq, { name: 'AbortError' });
    await new Promise((r) => setTimeout(r, 15));
    resolveImage('/remount-race.png');
    const remountBlob = await secondReq;
    assert.ok(remountBlob instanceof Blob, 'Immediate re-request after sole-waiter abort must not be poisoned');
  } finally {
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
