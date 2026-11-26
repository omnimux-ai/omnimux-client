import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createVideoExtractionService } from './service.ts';
import { assertSafeRemoteVideoUrl, isBlockedIpAddress } from './urlGuard.ts';

function makeStore() {
  return {
    get(id) {
      return { id };
    },
  };
}

test('videoExtraction security: blocks loopback, private, metadata, numeric IPv4, IPv6, and non-HTTP URLs', async () => {
  const blockedUrls = [
    'http://127.0.0.1/video.mp4',
    'http://localhost/video.mp4',
    'http://localhost./video.mp4',
    'http://sub.localhost/video.mp4',
    'http://169.254.169.254/latest/meta-data/video.mp4',
    'http://10.0.0.1/internal.mp4',
    'http://172.16.0.1/internal.mp4',
    'http://192.168.1.10/internal.mp4',
    'http://100.64.0.1/cgnat.mp4',
    'http://0.0.0.0/video.mp4',
    'http://2130706433/video.mp4',
    'http://[::1]/video.mp4',
    'http://[::ffff:127.0.0.1]/video.mp4',
    'http://[fc00::1]/video.mp4',
    'http://[fe80::1]/video.mp4',
    'http://[64:ff9b::7f00:1]/video.mp4',
    'http://metadata.google.internal/video.mp4',
    'file:///etc/passwd',
    'https://user:pass@cdn.example.com/video.mp4',
  ];

  for (const url of blockedUrls) {
    await assert.rejects(
      () => assertSafeRemoteVideoUrl(url, { skipDns: true }),
      (err) => err?.code === 'unsafe-url' && err?.status === 400,
      `Expected blocked URL: ${url}`,
    );
  }

  assert.equal(isBlockedIpAddress('8.8.8.8'), false);
  assert.equal(isBlockedIpAddress('2606:4700:4700::1111'), false);
  assert.equal(isBlockedIpAddress('fec0::1'), true);
  assert.equal(isBlockedIpAddress('ff02::1'), true);
  assert.equal(isBlockedIpAddress('2002:7f00:0001::1'), true);
});

test('videoExtraction security: DNS resolving to private/loopback IP or failing fails closed before fetch', async () => {
  const mediaDir = mkdtempSync(join(tmpdir(), 'video-sec-dns-'));
  try {
    let fetchCalled = false;
    const extractPrivate = createVideoExtractionService({
      store: makeStore(),
      mediaDir,
      lookup: async () => [{ address: '127.0.0.1', family: 4 }],
      fetcher: async () => {
        fetchCalled = true;
        return new Response('video', { status: 200, headers: { 'Content-Type': 'video/mp4' } });
      },
    });
    await assert.rejects(
      () => extractPrivate('ws_1', { url: 'https://rebind.example.net/clip.mp4', nodeId: 'n1' }),
      (err) => err?.code === 'unsafe-url' && err?.status === 400,
    );
    assert.equal(fetchCalled, false);

    const extractDnsFail = createVideoExtractionService({
      store: makeStore(),
      mediaDir,
      lookup: async () => {
        throw new Error('ENOTFOUND');
      },
      fetcher: async () => {
        fetchCalled = true;
        return new Response('video', { status: 200, headers: { 'Content-Type': 'video/mp4' } });
      },
    });
    await assert.rejects(
      () => extractDnsFail('ws_1', { url: 'https://missing.example.net/clip.mp4', nodeId: 'n1' }),
      (err) => err?.code === 'unsafe-url' && err?.status === 400,
    );
    assert.equal(fetchCalled, false);
  } finally {
    rmSync(mediaDir, { recursive: true, force: true });
  }
});

test('videoExtraction security: validates redirect hops and rejects redirects to private IPs or >5 hops', async () => {
  const mediaDir = mkdtempSync(join(tmpdir(), 'video-sec-redir-'));
  try {
    const requestedUrls = [];
    const extractRedirectSsrf = createVideoExtractionService({
      store: makeStore(),
      mediaDir,
      lookup: async () => [{ address: '93.184.216.34', family: 4 }],
      fetcher: async (url) => {
        requestedUrls.push(String(url));
        return new Response(null, {
          status: 302,
          headers: { location: 'http://169.254.169.254/latest/meta-data/' },
        });
      },
    });
    await assert.rejects(
      () => extractRedirectSsrf('ws_1', { url: 'https://cdn.example.net/clip.mp4', nodeId: 'n1' }),
      (err) => err?.code === 'unsafe-url' && err?.status === 400,
    );
    assert.deepEqual(requestedUrls, ['https://cdn.example.net/clip.mp4']);

    let hops = 0;
    const extractTooMany = createVideoExtractionService({
      store: makeStore(),
      mediaDir,
      lookup: async () => [{ address: '93.184.216.34', family: 4 }],
      fetcher: async () => {
        hops += 1;
        return new Response(null, {
          status: 302,
          headers: { location: `https://cdn.example.net/hop-${hops}.mp4` },
        });
      },
    });
    await assert.rejects(
      () => extractTooMany('ws_1', { url: 'https://cdn.example.net/start.mp4', nodeId: 'n1' }),
      (err) => err?.code === 'download-failed' && err?.status === 502,
    );
    assert.equal(hops, 6);
  } finally {
    rmSync(mediaDir, { recursive: true, force: true });
  }
});

test('videoExtraction security: rejects non-video Content-Type and enforces max download byte cap', async () => {
  const mediaDir = mkdtempSync(join(tmpdir(), 'video-sec-cap-'));
  try {
    const extractHtml = createVideoExtractionService({
      store: makeStore(),
      mediaDir,
      lookup: async () => [{ address: '93.184.216.34', family: 4 }],
      fetcher: async () => new Response('<html>not a video</html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      }),
    });
    await assert.rejects(
      () => extractHtml('ws_1', { url: 'https://cdn.example.net/fake.mp4', nodeId: 'n1' }),
      (err) => err?.code === 'unsafe-content-type' && err?.status === 415,
    );

    const extractHeaderTooLarge = createVideoExtractionService({
      store: makeStore(),
      mediaDir,
      maxVideoBytes: 1024,
      lookup: async () => [{ address: '93.184.216.34', family: 4 }],
      fetcher: async () => new Response('small', {
        status: 200,
        headers: { 'Content-Type': 'video/mp4', 'Content-Length': '2048' },
      }),
    });
    await assert.rejects(
      () => extractHeaderTooLarge('ws_1', { url: 'https://cdn.example.net/big.mp4', nodeId: 'n1' }),
      (err) => err?.code === 'download-too-large' && err?.status === 413,
    );

    const extractStreamTooLarge = createVideoExtractionService({
      store: makeStore(),
      mediaDir,
      maxVideoBytes: 512,
      lookup: async () => [{ address: '93.184.216.34', family: 4 }],
      fetcher: async () => {
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(300));
            controller.enqueue(new Uint8Array(300));
            controller.close();
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'video/mp4' },
        });
      },
    });
    await assert.rejects(
      () => extractStreamTooLarge('ws_1', { url: 'https://cdn.example.net/stream-big.mp4', nodeId: 'n1' }),
      (err) => err?.code === 'download-too-large' && err?.status === 413,
    );
    const videosDir = join(mediaDir, 'videos');
    const leftover = readdirSync(videosDir);
    assert.deepEqual(leftover, []);
  } finally {
    rmSync(mediaDir, { recursive: true, force: true });
  }
});

test('videoExtraction security: TikTok fallback is restricted to real TikTok hostnames', async () => {
  const mediaDir = mkdtempSync(join(tmpdir(), 'video-sec-host-'));
  try {
    const requested = [];
    const extract = createVideoExtractionService({
      store: makeStore(),
      mediaDir,
      lookup: async () => [{ address: '93.184.216.34', family: 4 }],
      fetcher: async (url) => {
        requested.push(String(url));
        return new Response('', { status: 404 });
      },
    });
    await assert.rejects(
      () => extract('ws_1', { url: 'https://example.net/page?ref=tiktok.com', nodeId: 'n1' }),
      (err) => err?.code === 'no-video-found' && err?.status === 422,
    );
    assert.deepEqual(requested, []);
  } finally {
    rmSync(mediaDir, { recursive: true, force: true });
  }
});
