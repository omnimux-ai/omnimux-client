import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'
import { createClipDispatcher, registerClipRoutes } from '../http/routes.js'
import { resolveClipPaths } from '../paths.js'
import { createProjectStore } from '../store/projectStore.js'
import { createEditorSession } from '../client/live/editor-session.js'

const temps = []
const servers = []

afterEach(async () => {
  while (servers.length) {
    const srv = servers.pop()
    await new Promise((resolve) => srv.close(resolve))
  }
  while (temps.length) rmSync(temps.pop(), { recursive: true, force: true })
})

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

function createDiskMediaResolver(registry) {
  return {
    async stat(handle) {
      const entry = registry.get(JSON.stringify([handle.scope, handle.workspaceId ?? '', handle.rel ?? '', handle.libraryAssetId ?? '', handle.fileId ?? '', handle.nodeId ?? '', handle.outputIndex ?? 0]))
      if (!entry) return { status: 'not_found', exists: false }
      const bytes = readFileSync(entry.filePath)
      const currentSha256 = sha256(bytes)
      const canonicalHandle = { ...handle, sha256: currentSha256 }
      if (handle.sha256 && handle.sha256 !== currentSha256) {
        return { status: 'digest_mismatch', exists: true, currentSha256, canonicalHandle, size: bytes.length, mimeType: entry.mimeType }
      }
      return { status: 'ok', exists: true, currentSha256, canonicalHandle, size: bytes.length, mimeType: entry.mimeType }
    },
    async open(handle) {
      const st = await this.stat(handle)
      if (st.status === 'digest_mismatch') {
        throw Object.assign(new Error('digest mismatch'), { code: 'media-version-mismatch' })
      }
      if (st.status !== 'ok') {
        throw Object.assign(new Error('not found'), { code: 'media-not-found' })
      }
      const entry = registry.get(JSON.stringify([handle.scope, handle.workspaceId ?? '', handle.rel ?? '', handle.libraryAssetId ?? '', handle.fileId ?? '', handle.nodeId ?? '', handle.outputIndex ?? 0]))
      const bytes = readFileSync(entry.filePath)
      return {
        canonicalHandle: st.canonicalHandle,
        sha256: st.currentSha256,
        size: bytes.length,
        mimeType: entry.mimeType,
        displayName: entry.name,
        async *openRange(start, end) {
          yield bytes.subarray(start, end + 1)
        },
      }
    },
  }
}

async function mountTestServer({ dispatcher, sessionId = 'sess-1' }) {
  const routes = []
  const webServer = {
    register(route) {
      routes.push(route)
      return () => {}
    },
  }
  registerClipRoutes(webServer, dispatcher, {
    getConnection: () => ({ requestRejection: () => undefined }),
    getHubEvents: () => ({
      authorizeWindow: (req) => {
        if (req.headers['x-test-window'] !== 'win-1') return null
        return {
          windowInstanceId: 'win-1',
          isAlive: () => true,
          getViewport: () => ({ ok: true, sessionId }),
        }
      },
    }),
  })
  const server = createServer((req, res) => {
    const route = routes.find((r) => req.url.startsWith(r.path))
    if (!route) { res.writeHead(404); res.end(); return }
    void route.handler(req, res)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  servers.push(server)
  const { port } = server.address()
  return `http://127.0.0.1:${port}`
}

describe('Clip Host media reconcile and verified HTTP byte streaming (AC-CMU-01 ~ AC-CMU-03)', () => {
  it('AC-CMU-01: auto-upgrades 3 unsigned legacy videos + 1 audio with .backups/ snapshot and streams verified bytes with Range & ETag', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'clip-reconcile-ac1-'))
    temps.push(dir)
    const paths = resolveClipPaths({ homeDir: dir })
    const store = createProjectStore({ paths })
    const workspaceId = 'ws_social_ops'
    const nodeId = 'node_comp_1'
    const projectId = 'clip_node_social_1'
    const binding = { workspaceId, nodeId, projectId }

    const mediaFiles = [
      { id: 'm1', nodeId: 'node_v1', name: '视频分镜 1 | 0-5s Hook动作建立', type: 'video', duration: 5.0, mimeType: 'video/mp4', rel: 'artifacts/shot1.mp4', bytes: Buffer.from('mp4-shot-1-content-bytes-0001') },
      { id: 'm2', nodeId: 'node_v2', name: '视频分镜 2 | 5-13s 纠错发力', type: 'video', duration: 5.0, mimeType: 'video/mp4', rel: 'artifacts/shot2.mp4', bytes: Buffer.from('mp4-shot-2-content-bytes-0002') },
      { id: 'm3', nodeId: 'node_v3', name: '视频分镜 3 | 13-20s 顶峰收缩', type: 'video', duration: 5.0, mimeType: 'video/mp4', rel: 'artifacts/shot3.mp4', bytes: Buffer.from('mp4-shot-3-content-bytes-0003') },
      { id: 'm4', nodeId: 'node_a1', name: '卡点电音 BGM | 00:10 重拍Drop', type: 'audio', duration: 22.0, mimeType: 'audio/mpeg', rel: '', bytes: Buffer.from('mp3-bgm-audio-content-bytes-0004') },
    ]

    const registry = new Map()
    const upstreamSources = []
    for (const file of mediaFiles) {
      const abs = join(dir, `${file.id}.bin`)
      writeFileSync(abs, file.bytes)
      const digest = sha256(file.bytes)
      const handle = file.rel
        ? { v: 1, scope: 'project-asset', workspaceId, assetId: `ast_${file.id}`, rel: file.rel, sha256: digest }
        : { v: 1, scope: 'canvas-node', workspaceId, nodeId: file.nodeId, outputIndex: 0, sha256: digest }
      registry.set(JSON.stringify([handle.scope, handle.workspaceId ?? '', handle.rel ?? '', '', '', handle.nodeId ?? '', handle.outputIndex ?? 0]), {
        filePath: abs, mimeType: file.mimeType, name: file.name,
      })
      upstreamSources.push({
        sourceNodeId: file.nodeId,
        outputIndex: 0,
        materialType: file.type,
        name: file.name,
        durationMs: file.duration * 1000,
        canonicalHandle: handle,
        currentSha256: digest,
        size: file.bytes.length,
        mimeType: file.mimeType,
        legacyFingerprints: [file.nodeId, `${workspaceId}:${file.nodeId}:0`],
      })
    }

    // Seed a legacy-like project with 4 unsigned offline placeholders (no sha256, no handle).
    store.materialize(projectId, { binding, title: '视频合成' })
    const initial = store.load(projectId)
    store.save(projectId, {
      ...initial.project,
      omnimuxCanvasInitialized: true,
      mediaLibrary: {
        items: mediaFiles.map((file) => ({
          id: file.id,
          name: file.name,
          type: file.type,
          metadata: { duration: file.duration, width: 720, height: 1280, frameRate: 30, codec: '', sampleRate: 0, channels: 0, fileSize: file.bytes.length },
          sourceRef: { kind: 'legacy', fingerprint: sha256(`old-unsigned-${file.id}`) },
          missing: true,
          isPlaceholder: true,
        })),
      },
    }, { expectedRevision: initial.revision, revision: initial.revision + 1, binding })

    const savedDraftRevisions = []
    const workflowClip = {
      resolveBinding: (b) => ({ ...b, title: '视频合成' }),
      saveDraft: ({ revision }) => { savedDraftRevisions.push(revision); return { revision, workspaceVersion: 2 } },
      listUpstreamSources: async () => ({ workspaceId, nodeId, projectId, sources: upstreamSources }),
    }
    const dispatcher = createClipDispatcher({
      paths,
      store,
      getWorkflowClip: () => workflowClip,
      getMediaResolver: () => createDiskMediaResolver(registry),
    })
    const baseUrl = await mountTestServer({ dispatcher })

    // Unauthenticated request to canvas-bound reconcile must be rejected.
    const unauth = await fetch(`${baseUrl}/omnimux-clip/api/projects/${projectId}/media/reconcile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'inspect', binding }),
    })
    assert.equal(unauth.status, 403)

    // Authenticated reconcile apply upgrades all 4 items, writes backup, and bumps draftRevision.
    const recRes = await fetch(`${baseUrl}/omnimux-clip/api/projects/${projectId}/media/reconcile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-test-window': 'win-1' },
      body: JSON.stringify({ mode: 'apply', binding }),
    })
    assert.equal(recRes.status, 200)
    const reconciled = await recRes.json()
    assert.deepEqual(reconciled.upgradedMediaIds, ['m1', 'm2', 'm3', 'm4'])
    assert.equal(reconciled.items.every((row) => row.reconcileState === 'online_exact' && row.recoverable), true)
    assert.equal(savedDraftRevisions.includes(reconciled.revision), true)

    // Pre-upgrade backup must exist under projects/.backups/.
    const backups = readdirSync(join(paths.projectsDir, '.backups'))
    assert.ok(backups.some((file) => file.startsWith(`${projectId}.revision-`)))

    // Zero raw disk paths leaked in persisted project JSON or reconcile payload.
    const persistedJson = readFileSync(join(paths.projectsDir, `${projectId}.json`), 'utf8')
    assert.equal(persistedJson.includes(dir), false)
    assert.equal(JSON.stringify(reconciled).includes(dir), false)

    // Stream each upgraded item over HTTP and verify X-Content-SHA256, Range (206), and ETag (304).
    for (const file of mediaFiles) {
      const expectedSha = sha256(file.bytes)
      const fullRes = await fetch(`${baseUrl}/omnimux-clip/api/projects/${projectId}/media/${file.id}/bytes`, {
        headers: { 'x-test-window': 'win-1' },
      })
      assert.equal(fullRes.status, 200)
      assert.equal(fullRes.headers.get('x-content-sha256'), expectedSha)
      assert.equal(fullRes.headers.get('etag'), `"${expectedSha}"`)
      assert.equal(fullRes.headers.get('x-content-type-options'), 'nosniff')
      assert.deepEqual(Buffer.from(await fullRes.arrayBuffer()), file.bytes)

      const rangeRes = await fetch(`${baseUrl}/omnimux-clip/api/projects/${projectId}/media/${file.id}/bytes`, {
        headers: { 'x-test-window': 'win-1', Range: 'bytes=4-11' },
      })
      assert.equal(rangeRes.status, 206)
      assert.equal(rangeRes.headers.get('content-range'), `bytes 4-11/${file.bytes.length}`)
      assert.deepEqual(Buffer.from(await rangeRes.arrayBuffer()), file.bytes.subarray(4, 12))

      const cachedRes = await fetch(`${baseUrl}/omnimux-clip/api/projects/${projectId}/media/${file.id}/bytes`, {
        headers: { 'x-test-window': 'win-1', 'If-None-Match': `"${expectedSha}"` },
      })
      assert.equal(cachedRes.status, 304)
    }
  })

  it('AC-CMU-02 & AC-CMU-03: recovers library-file handles and refuses silent substitution on digest drift (409)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'clip-reconcile-ac23-'))
    temps.push(dir)
    const paths = resolveClipPaths({ homeDir: dir })
    const store = createProjectStore({ paths })
    const projectId = 'studio_proj_1'

    const filePath = join(dir, 'asset-video.mp4')
    const originalBytes = Buffer.from('original-library-video-bytes')
    const originalSha = sha256(originalBytes)
    writeFileSync(filePath, originalBytes)

    const registry = new Map([[
      JSON.stringify(['library-file', '', '', 'ast_lib_1', 'file_1', '', 0]),
      { filePath, mimeType: 'video/mp4', name: 'asset-video.mp4' },
    ]])

    store.create(projectId, {
      id: projectId,
      name: 'Studio Project',
      createdAt: 1,
      modifiedAt: 1,
      settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2 },
      timeline: { tracks: [], subtitles: [], markers: [], duration: 0 },
      mediaLibrary: {
        items: [{
          id: 'lib_m1',
          name: 'asset-video.mp4',
          type: 'video',
          metadata: { duration: 3, width: 1920, height: 1080, frameRate: 30, codec: '', sampleRate: 0, channels: 0, fileSize: originalBytes.length },
          omnimuxSource: {
            id: 'ast_lib_1:file_1',
            version: `sha256:${originalSha}`,
            digest: originalSha,
            handle: { v: 1, scope: 'library-file', libraryAssetId: 'ast_lib_1', fileId: 'file_1', sha256: originalSha },
          },
          sourceRef: { kind: 'indexeddb', key: 'lib_m1', digest: originalSha },
          missing: false,
          isPlaceholder: false,
        }],
      },
    })

    const dispatcher = createClipDispatcher({
      paths,
      store,
      getMediaResolver: () => createDiskMediaResolver(registry),
    })
    const baseUrl = await mountTestServer({ dispatcher })

    // AC-CMU-02: Streams library-file handle cleanly even after IndexedDB is empty.
    const okRes = await fetch(`${baseUrl}/omnimux-clip/api/projects/${projectId}/media/lib_m1/bytes`)
    assert.equal(okRes.status, 200)
    assert.equal(okRes.headers.get('x-content-sha256'), originalSha)
    assert.deepEqual(Buffer.from(await okRes.arrayBuffer()), originalBytes)

    // AC-CMU-03: Tamper disk bytes -> GET returns 409, reconcile apply classifies source_drifted and refuses silent upgrade.
    const tamperedBytes = Buffer.from('tampered-different-video-bytes-999')
    writeFileSync(filePath, tamperedBytes)

    const driftBytesRes = await fetch(`${baseUrl}/omnimux-clip/api/projects/${projectId}/media/lib_m1/bytes`)
    assert.equal(driftBytesRes.status, 409)
    const driftErr = await driftBytesRes.json()
    assert.equal(driftErr.error, 'media-version-mismatch')

    const driftRecRes = await fetch(`${baseUrl}/omnimux-clip/api/projects/${projectId}/media/reconcile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'apply' }),
    })
    assert.equal(driftRecRes.status, 200)
    const driftRec = await driftRecRes.json()
    assert.deepEqual(driftRec.upgradedMediaIds, [])
    assert.equal(driftRec.items[0].reconcileState, 'source_drifted')
    assert.equal(driftRec.items[0].recoverable, false)
    assert.equal(driftRec.items[0].expectedSha256, originalSha)
    assert.equal(driftRec.items[0].currentSha256, sha256(tamperedBytes))
  })

  it('keeps legacy items ambiguous when duration drifts > 0.15s or multiple candidates match', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'clip-reconcile-ambig-'))
    temps.push(dir)
    const paths = resolveClipPaths({ homeDir: dir })
    const store = createProjectStore({ paths })
    const workspaceId = 'ws_ambig'
    const nodeId = 'node_comp'
    const projectId = 'clip_node_ambig'
    const binding = { workspaceId, nodeId, projectId }

    store.materialize(projectId, { binding })
    const initial = store.load(projectId)
    store.save(projectId, {
      ...initial.project,
      mediaLibrary: {
        items: [{
          id: 'm_drift_dur',
          name: 'Shot A',
          type: 'video',
          metadata: { duration: 10.0, width: 720, height: 1280, frameRate: 30, codec: '', sampleRate: 0, channels: 0, fileSize: 100 },
          sourceRef: { kind: 'legacy' },
          missing: true,
          isPlaceholder: true,
        }],
      },
    }, { expectedRevision: initial.revision, revision: initial.revision + 1, binding })

    const digest = sha256(Buffer.from('short-shot'))
    const workflowClip = {
      resolveBinding: (b) => ({ ...b, title: 'Comp' }),
      saveDraft: ({ revision }) => ({ revision, workspaceVersion: 2 }),
      listUpstreamSources: async () => ({
        workspaceId,
        nodeId,
        projectId,
        sources: [{
          sourceNodeId: 'node_a',
          outputIndex: 0,
          materialType: 'video',
          name: 'Shot A',
          durationMs: 5000, // 5.0s vs 10.0s -> exceeds 0.15s tolerance
          canonicalHandle: { v: 1, scope: 'canvas-node', workspaceId, nodeId: 'node_a', outputIndex: 0, sha256: digest },
          currentSha256: digest,
          size: 10,
          mimeType: 'video/mp4',
          legacyFingerprints: ['node_a'],
        }],
      }),
    }
    const dispatcher = createClipDispatcher({ paths, store, getWorkflowClip: () => workflowClip })
    const res = await dispatcher.dispatch({
      method: 'POST',
      url: `/omnimux-clip/api/projects/${projectId}/media/reconcile`,
      body: { mode: 'apply', binding },
      window: { getViewport: () => ({ sessionId: 'sess-1' }) },
    })
    assert.equal(res.status, 200)
    assert.deepEqual(res.body.upgradedMediaIds, [])
    assert.equal(res.body.items[0].reconcileState, 'legacy_ambiguous')
  })

  it('editor-session reconciles missing host media before load and preserves CAS baseRevision parity', async () => {
    const projectId = 'clip_node_sync'
    const binding = { workspaceId: 'ws_sync', nodeId: 'node_c', projectId }
    const digest = sha256(Buffer.from('sync-video'))
    const upgradedHandle = { v: 1, scope: 'project-asset', workspaceId: 'ws_sync', rel: 'artifacts/s.mp4', sha256: digest }
    const hostProjectBefore = {
      id: projectId, name: 'Sync', createdAt: 1, modifiedAt: 1,
      settings: { width: 1280, height: 720, frameRate: 30, sampleRate: 48000, channels: 2 },
      timeline: { tracks: [], subtitles: [], markers: [], duration: 0 },
      mediaLibrary: { items: [{ id: 'm1', name: 's.mp4', type: 'video', sourceRef: { kind: 'legacy' }, missing: true, isPlaceholder: true }] },
    }
    const hostProjectAfter = {
      ...hostProjectBefore,
      mediaLibrary: {
        items: [{
          id: 'm1', name: 's.mp4', type: 'video',
          omnimuxSource: { id: 'node_s', version: `sha256:${digest}`, digest, handle: upgradedHandle },
          sourceRef: { kind: 'indexeddb', key: 'm1', digest },
          missing: false, isPlaceholder: false,
        }],
      },
    }

    let loadedRecord
    const writeCalls = []
    const session = createEditorSession({
      document: { visibilityState: 'visible' },
      workbench: () => ({ getActiveSurface: () => ({ panelOpen: true, tabId: 'omnimux-workflow:canvas', instanceId: 'tab-1', sessionId: 'sess-1' }) }),
      storage: {
        readLocal: async () => null,
        writeLocal: async () => {},
        readHost: async () => ({ projectId, revision: 3, updatedAt: 10, binding, project: hostProjectBefore }),
        reconcileMedia: async () => ({ projectId, revision: 4, upgradedMediaIds: ['m1'], project: hostProjectAfter, items: [], unimportedUpstreams: [] }),
        writeHost: async (rec, opts) => { writeCalls.push({ rec, opts }); return { revision: opts?.revision ?? rec.revision } },
      },
      native: {
        load: async (rec) => { loadedRecord = rec },
        capture: () => ({ project: loadedRecord.project, fingerprint: JSON.stringify(loadedRecord.project), media: {} }),
        suspend: () => {},
        projectId: () => projectId,
        subscribe: () => () => {},
      },
    })
    session.add({
      id: 'canvas-entry',
      tabId: 'omnimux-workflow:canvas',
      mode: 'canvas',
      isVisible: () => true,
      getCanvas: () => ({ ...binding, nodeTitle: 'Sync', upstreamInputs: {} }),
    })
    await session.getWaiting()

    assert.ok(loadedRecord)
    assert.equal(loadedRecord.revision, 4)
    assert.equal(loadedRecord.localBaseRevision, 4)
    assert.deepEqual(loadedRecord.project.mediaLibrary.items[0].omnimuxSource.handle, upgradedHandle)
    assert.equal(writeCalls.length, 0)
    session.dispose()
  })
})
