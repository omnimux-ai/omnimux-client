import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createVideoExtractionExecutor } from './videoExtractionExecutor.ts';

test('video-extraction executor resolves upstream text and emits a video artifact', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'omnimux-video-extract-'));
  try {
    const executor = createVideoExtractionExecutor({
      store: { get: () => ({}) },
      extractVideo: async () => ({
        videoPath: '/tmp/video.mp4',
        mediaUrl: '/omnimux-workflow/media/videos/video.mp4',
        previewUrl: '/omnimux-workflow/media/videos/video.mp4',
      }),
    });
    const output = await executor.execute(
      { id: 'node-b', type: 'material', data: { outputCapabilityId: 'video-extraction' } },
      {
        workspaceId: 'ws-1',
        mediaDir: dir,
        upstreamOutputs: new Map([
          ['node-a', { text: 'https://www.tiktok.com/@creator/video/123' }],
        ]),
        persistGenerated: async () => ({
          url: '/omnimux-workflow/media/executions/test/video.mp4',
          relativePath: 'executions/test/video.mp4',
          assetId: 'asset-1',
          mimeType: 'video/mp4',
          sizeBytes: 14,
          durationSec: 8,
        }),
      },
    );
    assert.equal(output.mediaAssets?.[0]?.type, 'video');
    assert.equal(output.mediaAssets?.[0]?.url, '/omnimux-workflow/media/executions/test/video.mp4');
    assert.equal(output.relativePath, 'executions/test/video.mp4');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('video-extraction executor rejects a missing URL', async () => {
  const executor = createVideoExtractionExecutor({
    store: { get: () => ({}) },
    fetcher: async () => new Response('', { status: 200 }),
  });
  await assert.rejects(
    () => executor.execute(
      { id: 'node-b', type: 'material', data: {} },
      { workspaceId: 'ws-1', mediaDir: '/tmp', upstreamOutputs: new Map() },
    ),
    /未检测到有效的社媒视频链接/,
  );
});
