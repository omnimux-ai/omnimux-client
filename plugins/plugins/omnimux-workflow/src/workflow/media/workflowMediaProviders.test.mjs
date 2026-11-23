import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { createWorkspaceStore } from '../workspace/WorkspaceStore.ts';
import { createProjectAssetsStore } from '../workspace/ProjectAssetsStore.ts';
import { createWorkflowClipService } from '../clip/workflowClip.ts';
import { createWorkflowMediaSupport } from './workflowMediaProviders.ts';

const temps = [];
afterEach(() => {
  while (temps.length) rmSync(temps.pop(), { recursive: true, force: true });
});

async function collectBytes(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function createFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'workflow-media-providers-'));
  temps.push(dir);
  const projectRoot = join(dir, 'project');
  const workspacesDir = join(dir, 'workspaces');
  const mediaDir = join(dir, 'media');
  mkdirSync(join(projectRoot, '.omnimux', 'canvases'), { recursive: true });
  mkdirSync(join(projectRoot, 'artifacts'), { recursive: true });
  mkdirSync(join(projectRoot, 'assets', 'imported'), { recursive: true });
  mkdirSync(workspacesDir, { recursive: true });
  mkdirSync(mediaDir, { recursive: true });

  const wsId = 'ws_demo_clip';
  const resolveProjectRoot = (id) => (id === wsId ? { path: projectRoot } : null);
  const store = createWorkspaceStore({ workspacesDir, resolveProjectRoot });
  const created = store.create('Clip Test', wsId);
  const assetsStore = createProjectAssetsStore({ workspacesDir, resolveProjectRoot });
  const canAccessWorkspace = (id, sessionId) => id === wsId && sessionId === 'sess-allowed';
  const support = createWorkflowMediaSupport({
    store,
    assetsStore,
    resolveAssetsRoot: resolveProjectRoot,
    mediaDir,
    canAccessWorkspace,
  });
  const workflowClip = createWorkflowClipService({
    store,
    canAccessWorkspace,
    resolveNodeSources: support.resolveNodeSources,
  });
  return { dir, projectRoot, mediaDir, wsId, created, store, assetsStore, support, workflowClip };
}

describe('omnimux-workflow media providers & listUpstreamSources', () => {
  it('resolves project-asset handles with sha256 verification, range streaming, and ACL checks', async () => {
    const { dir, wsId, assetsStore, support } = createFixture();
    const rawFile = join(dir, 'clip-in.mp4');
    const bytes = Buffer.from('\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom-demo-bytes');
    const expectedSha = createHash('sha256').update(bytes).digest('hex');
    writeFileSync(rawFile, bytes);

    const doc = await assetsStore.ingest(wsId, { paths: [rawFile] });
    assert.equal(doc.items.length, 1);
    assert.equal(doc.items[0].sha256, expectedSha);

    const handle = {
      v: 1,
      scope: 'project-asset',
      workspaceId: wsId,
      assetId: doc.items[0].id,
      rel: doc.items[0].relative_path,
      sha256: expectedSha,
    };

    // Wrong session is denied.
    const denied = await support.projectAssetProvider.stat(handle, { sessionId: 'sess-other' });
    assert.equal(denied.status, 'access_denied');
    await assert.rejects(
      () => support.projectAssetProvider.open(handle, { sessionId: 'sess-other' }),
      (err) => err.code === 'access-denied',
    );

    // Allowed session resolves and streams exact range.
    const st = await support.projectAssetProvider.stat(handle, { sessionId: 'sess-allowed' });
    assert.equal(st.status, 'ok');
    assert.equal(st.currentSha256, expectedSha);
    assert.equal(st.canonicalHandle.assetId, doc.items[0].id);

    const opened = await support.projectAssetProvider.open(handle, { sessionId: 'sess-allowed' });
    assert.deepEqual(await collectBytes(opened.openRange(4, 11)), bytes.subarray(4, 12));

    // Digest mismatch fails closed.
    const drifted = await support.projectAssetProvider.stat({ ...handle, sha256: 'f'.repeat(64) }, { sessionId: 'sess-allowed' });
    assert.equal(drifted.status, 'digest_mismatch');
    await assert.rejects(
      () => support.projectAssetProvider.open({ ...handle, sha256: 'f'.repeat(64) }, { sessionId: 'sess-allowed' }),
      (err) => err.code === 'media-version-mismatch',
    );
  });

  it('lists authoritative upstream sources for unsigned project assets and local-file nodes without exposing raw paths', async () => {
    const { dir, projectRoot, wsId, created, store, assetsStore, support, workflowClip } = createFixture();
    const vidBytes = Buffer.from('\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom-upstream-video');
    const vidSha = createHash('sha256').update(vidBytes).digest('hex');
    const artifactRel = 'artifacts/legacy_clip_1.mp4';
    writeFileSync(join(projectRoot, artifactRel), vidBytes);
    assetsStore.registerGenerated(wsId, {
      relative_path: artifactRel,
      name: 'legacy_clip_1.mp4',
      type: 'video',
      size: vidBytes.length,
      mimeType: 'video/mp4',
      sha256: vidSha,
    });

    const bgmPath = join(dir, 'bgm.mp3');
    const bgmBytes = Buffer.from('ID3\x03\x00\x00\x00\x00\x00\x00demo-audio-stream');
    const bgmSha = createHash('sha256').update(bgmBytes).digest('hex');
    writeFileSync(bgmPath, bgmBytes);

    store.save(wsId, {
      expectedVersion: created.version,
      nodes: [
        {
          id: 'node_vid_1',
          type: 'material',
          position: { x: 0, y: 0 },
          data: {
            materialType: 'video',
            label: '视频分镜 1',
            // Intentionally unsigned workspace URL (no rev=sha256:...)
            mediaUrl: `/omnimux-workflow/api/workspaces/${wsId}/file?rel=${encodeURIComponent(artifactRel)}`,
            durationSec: 5.0,
          },
        },
        {
          id: 'node_aud_1',
          type: 'material',
          position: { x: 0, y: 200 },
          data: {
            materialType: 'audio',
            label: '卡点电音 BGM',
            mediaUrl: `/omnimux-workflow/api/local-file?path=${encodeURIComponent(bgmPath)}`,
            durationSec: 22.0,
          },
        },
        {
          id: 'node_comp_1',
          type: 'video_composition',
          position: { x: 400, y: 100 },
          data: {
            title: '视频合成',
            projectId: 'clip_node_demo1',
          },
        },
      ],
      edges: [
        { id: 'e1', source: 'node_vid_1', target: 'node_comp_1', sourceHandle: 'out', targetHandle: 'in' },
        { id: 'e2', source: 'node_aud_1', target: 'node_comp_1', sourceHandle: 'out', targetHandle: 'in' },
      ],
    });

    const upstream = await workflowClip.listUpstreamSources(
      { workspaceId: wsId, nodeId: 'node_comp_1', projectId: 'clip_node_demo1' },
      'sess-allowed',
    );
    assert.equal(upstream.sources.length, 2);

    const vid = upstream.sources.find((s) => s.sourceNodeId === 'node_vid_1');
    assert.ok(vid);
    assert.equal(vid.canonicalHandle.scope, 'project-asset');
    assert.equal(vid.canonicalHandle.sha256, vidSha);
    assert.equal(vid.durationMs, 5000);

    const aud = upstream.sources.find((s) => s.sourceNodeId === 'node_aud_1');
    assert.ok(aud);
    assert.equal(aud.canonicalHandle.scope, 'canvas-node');
    assert.equal(aud.canonicalHandle.sha256, bgmSha);
    // Raw host path must never appear anywhere in the returned source object.
    assert.equal(JSON.stringify(aud).includes(bgmPath), false);

    // Opening the canvas-node handle streams verified audio bytes.
    const openedAud = await support.canvasNodeProvider.open(aud.canonicalHandle, { sessionId: 'sess-allowed' });
    assert.deepEqual(await collectBytes(openedAud.openRange(0, bgmBytes.length - 1)), bgmBytes);
  });
});
