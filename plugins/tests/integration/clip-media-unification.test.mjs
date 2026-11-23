import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'
import { createMediaResolver } from '../../plugins/omnimux/src/host/media-resolver.js'
import { createLibraryStore } from '../../plugins/omnimux-assets/src/library.js'
import { resolveAssetsPaths } from '../../plugins/omnimux-assets/src/paths.js'
import { createLibraryMediaProvider } from '../../plugins/omnimux-assets/src/media-provider.js'
import { createProjectStore as createWorkflowProjectStore } from '../../plugins/omnimux-workflow/src/projects/ProjectStore.ts'
import { createWorkspaceStore } from '../../plugins/omnimux-workflow/src/workflow/workspace/WorkspaceStore.ts'
import { createProjectAssetsStore } from '../../plugins/omnimux-workflow/src/workflow/workspace/ProjectAssetsStore.ts'
import { createWorkflowMediaSupport } from '../../plugins/omnimux-workflow/src/workflow/media/workflowMediaProviders.ts'
import { createWorkflowClipService } from '../../plugins/omnimux-workflow/src/workflow/clip/workflowClip.ts'
import { createEditorSession } from '../../plugins/omnimux-clip/src/client/live/editor-session.js'
import { createExportJobs } from '../../plugins/omnimux-clip/src/export-jobs.js'
import { createClipDispatcher, registerClipRoutes } from '../../plugins/omnimux-clip/src/http/routes.js'
import { createClipVaultMediaProvider } from '../../plugins/omnimux-clip/src/media/clipVault.js'
import { ensureClipDirs, resolveClipPaths } from '../../plugins/omnimux-clip/src/paths.js'
import { createProjectStore as createClipProjectStore } from '../../plugins/omnimux-clip/src/store/projectStore.js'

const temps = []
const servers = []

afterEach(async () => {
  while (servers.length) {
    const srv = servers.pop()
    await new Promise((resolve) => srv.close(resolve))
  }
  while (temps.length) rmSync(temps.pop(), { recursive: true, force: true })
})

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

describe('4-plugin cross-seam media unification (omnimux + assets + workflow + clip)', () => {
  it('reconciles unsigned legacy canvas nodes + global asset library handles through real mediaResolver and streams verified bytes over HTTP', async () => {
    const home = mkdtempSync(join(tmpdir(), 'clip-media-unification-e2e-'))
    temps.push(home)

    // 1. Hub stateless mediaResolver seam
    const mediaResolver = createMediaResolver()

    // 2. Real omnimux-assets store + library-file provider
    const assetsPaths = resolveAssetsPaths({ homeDir: home })
    const library = createLibraryStore({ paths: assetsPaths })
    mediaResolver.registerProvider(createLibraryMediaProvider({ library }))

    const libSourcePath = join(home, 'library-bgm.mp3')
    const libBytes = Buffer.from('ID3\x03\x00\x00\x00\x00\x00\x00real-library-audio-bytes')
    const libSha = sha256(libBytes)
    writeFileSync(libSourcePath, libBytes)
    const libAsset = await library.add({
      name: 'Library BGM',
      type: 'custom',
      files: [{ real_path: libSourcePath, original_name: 'library-bgm.mp3' }],
    })
    const libFileId = libAsset.files[0].id

    // 3. Real omnimux-workflow stores + project-asset & canvas-node providers + workflowClip seam
    const libraryRoot = join(home, 'projects-library')
    mkdirSync(libraryRoot, { recursive: true })
    const wfProjects = createWorkflowProjectStore({ libraryRoot })
    const wfProject = wfProjects.create('Social Media Ops', { canvasWorkspaceIds: ['ws_social_e2e'] })
    const wsId = wfProject.pages[0].canvasWorkspaceId
    const resolveProjectRoot = (id) => wfProjects.findByCanvasWorkspaceId(id)
    const wfStore = createWorkspaceStore({ workspacesDir: join(home, 'workspaces'), resolveProjectRoot })
    const createdCanvas = wfStore.create('Social Media Ops', wsId)
    const wfAssets = createProjectAssetsStore({ workspacesDir: wfStore.workspacesDir, resolveProjectRoot })
    const wfMediaDir = join(home, 'wf-media')
    mkdirSync(wfMediaDir, { recursive: true })
    mkdirSync(join(wfProject.path, 'artifacts'), { recursive: true })

    const shot1Bytes = Buffer.from('\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom-shot-one')
    const shot1Sha = sha256(shot1Bytes)
    const shot1Rel = 'artifacts/shot_1.mp4'
    writeFileSync(join(wfProject.path, shot1Rel), shot1Bytes)
    wfAssets.registerGenerated(wsId, {
      relative_path: shot1Rel,
      name: 'shot_1.mp4',
      type: 'video',
      size: shot1Bytes.length,
      mimeType: 'video/mp4',
      sha256: shot1Sha,
    })

    const externalLocalPath = join(home, 'external-shot-2.mp4')
    const shot2Bytes = Buffer.from('\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom-shot-two')
    const shot2Sha = sha256(shot2Bytes)
    writeFileSync(externalLocalPath, shot2Bytes)

    const nodeCompId = 'node_comp_e2e'
    const clipProjectId = 'clip_node_e2e_1'
    const binding = { workspaceId: wsId, nodeId: nodeCompId, projectId: clipProjectId }

    wfStore.save(wsId, {
      expectedVersion: createdCanvas.version,
      nodes: [
        {
          id: 'node_shot_1',
          type: 'material',
          position: { x: 0, y: 0 },
          data: {
            materialType: 'video',
            label: '视频分镜 1',
            // Unsigned legacy URL (no rev=sha256:...)
            mediaUrl: `/omnimux-workflow/api/workspaces/${wsId}/file?rel=${encodeURIComponent(shot1Rel)}`,
            durationSec: 5.0,
          },
        },
        {
          id: 'node_shot_2',
          type: 'material',
          position: { x: 0, y: 200 },
          data: {
            materialType: 'video',
            label: '视频分镜 2',
            mediaUrl: `/omnimux-workflow/api/local-file?path=${encodeURIComponent(externalLocalPath)}`,
            durationSec: 5.0,
          },
        },
        {
          id: nodeCompId,
          type: 'video_composition',
          position: { x: 400, y: 100 },
          data: { title: '视频合成', projectId: clipProjectId },
        },
      ],
      edges: [
        { id: 'e1', source: 'node_shot_1', target: nodeCompId, sourceHandle: 'out', targetHandle: 'in' },
        { id: 'e2', source: 'node_shot_2', target: nodeCompId, sourceHandle: 'out', targetHandle: 'in' },
      ],
    })

    const canAccessWorkspace = (id, sessionId) => id === wsId && sessionId === 'sess-e2e'
    const wfMediaSupport = createWorkflowMediaSupport({
      store: wfStore,
      assetsStore: wfAssets,
      resolveAssetsRoot: resolveProjectRoot,
      mediaDir: wfMediaDir,
      canAccessWorkspace,
    })
    for (const provider of wfMediaSupport.providers) mediaResolver.registerProvider(provider)
    const workflowClip = createWorkflowClipService({
      store: wfStore,
      canAccessWorkspace,
      resolveNodeSources: wfMediaSupport.resolveNodeSources,
    })

    // 4. Real omnimux-clip store + HTTP dispatcher + HTTP server
    const clipPaths = resolveClipPaths({ homeDir: home })
    const clipStore = createClipProjectStore({ paths: clipPaths })
    clipStore.materialize(clipProjectId, { binding, title: '视频合成' })
    const initial = clipStore.load(clipProjectId)
    clipStore.save(clipProjectId, {
      ...initial.project,
      omnimuxCanvasInitialized: true,
      mediaLibrary: {
        items: [
          {
            id: 'm_shot1',
            name: '视频分镜 1',
            type: 'video',
            metadata: { duration: 5.0, width: 720, height: 1280, frameRate: 30, codec: '', sampleRate: 0, channels: 0, fileSize: shot1Bytes.length },
            sourceRef: { kind: 'legacy' },
            missing: true,
            isPlaceholder: true,
          },
          {
            id: 'm_shot2',
            name: '视频分镜 2',
            type: 'video',
            metadata: { duration: 5.0, width: 720, height: 1280, frameRate: 30, codec: '', sampleRate: 0, channels: 0, fileSize: shot2Bytes.length },
            sourceRef: { kind: 'legacy' },
            missing: true,
            isPlaceholder: true,
          },
          {
            id: 'm_lib_bgm',
            name: 'Library BGM',
            type: 'audio',
            metadata: { duration: 10.0, width: 0, height: 0, frameRate: 0, codec: '', sampleRate: 48000, channels: 2, fileSize: libBytes.length },
            omnimuxSource: {
              id: `${libAsset.id}:${libFileId}`,
              version: `sha256:${libSha}`,
              digest: libSha,
              handle: { v: 1, scope: 'library-file', libraryAssetId: libAsset.id, fileId: libFileId, sha256: libSha },
            },
            sourceRef: { kind: 'indexeddb', key: 'm_lib_bgm', digest: libSha },
            missing: true,
            isPlaceholder: true,
          },
        ],
      },
    }, { expectedRevision: initial.revision, revision: initial.revision + 1, binding })

    const dispatcher = createClipDispatcher({
      paths: clipPaths,
      store: clipStore,
      getWorkflowClip: () => workflowClip,
      getMediaResolver: () => mediaResolver,
    })
    const routes = []
    registerClipRoutes({ register(route) { routes.push(route); return () => {} } }, dispatcher, {
      getConnection: () => ({ requestRejection: () => undefined }),
      getHubEvents: () => ({
        authorizeWindow: (req) => req.headers['x-win'] === 'ok'
          ? { windowInstanceId: 'ok', isAlive: () => true, getViewport: () => ({ ok: true, sessionId: 'sess-e2e' }) }
          : null,
      }),
    })
    const server = createServer((req, res) => {
      const route = routes.find((r) => req.url.startsWith(r.path))
      if (!route) { res.writeHead(404); res.end(); return }
      void route.handler(req, res)
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    servers.push(server)
    const base = `http://127.0.0.1:${server.address().port}`

    // Reconcile apply upgrades both legacy canvas nodes via real Workflow providers and keeps library item online_exact.
    const recRes = await fetch(`${base}/omnimux-clip/api/projects/${clipProjectId}/media/reconcile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-win': 'ok' },
      body: JSON.stringify({ mode: 'apply', binding }),
    })
    assert.equal(recRes.status, 200)
    const rec = await recRes.json()
    assert.deepEqual(rec.upgradedMediaIds.sort(), ['m_shot1', 'm_shot2'])
    assert.equal(rec.items.every((row) => row.reconcileState === 'online_exact'), true)
    assert.ok(readdirSync(join(clipPaths.projectsDir, '.backups')).some((f) => f.startsWith(`${clipProjectId}.revision-`)))

    // Stream all 3 items (project-asset, canvas-node, library-file) through the single Clip Host HTTP endpoint!
    for (const [mediaId, expectedBytes, expectedSha] of [
      ['m_shot1', shot1Bytes, shot1Sha],
      ['m_shot2', shot2Bytes, shot2Sha],
      ['m_lib_bgm', libBytes, libSha],
    ]) {
      const res = await fetch(`${base}/omnimux-clip/api/projects/${clipProjectId}/media/${mediaId}/bytes`, {
        headers: { 'x-win': 'ok' },
      })
      assert.equal(res.status, 200, `expected 200 for ${mediaId}`)
      assert.equal(res.headers.get('x-content-sha256'), expectedSha)
      assert.deepEqual(Buffer.from(await res.arrayBuffer()), expectedBytes)
    }

    // Tamper shot 1 on disk -> HTTP 409 media-version-mismatch, never silent substitution!
    writeFileSync(join(wfProject.path, shot1Rel), Buffer.from('\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom-TAMPERED'))
    const tamperRes = await fetch(`${base}/omnimux-clip/api/projects/${clipProjectId}/media/m_shot1/bytes`, {
      headers: { 'x-win': 'ok' },
    })
    assert.equal(tamperRes.status, 409)
    assert.equal((await tamperRes.json()).error, 'media-version-mismatch')
  })

  it('AC-CMU-04: persists canvas-bound local uploads to ProjectRoot/assets/imported and standalone/free-canvas uploads to clip-vault', async () => {
    const home = mkdtempSync(join(tmpdir(), 'clip-media-cmu04-'))
    temps.push(home)

    const mediaResolver = createMediaResolver()
    const clipPaths = resolveClipPaths({ homeDir: home })
    mediaResolver.registerProvider(createClipVaultMediaProvider({ paths: clipPaths }))

    const libraryRoot = join(home, 'projects-library')
    mkdirSync(libraryRoot, { recursive: true })
    const wfProjects = createWorkflowProjectStore({ libraryRoot })
    const wfProject = wfProjects.create('Bound Project', { canvasWorkspaceIds: ['ws_bound'] })
    const boundWsId = wfProject.pages[0].canvasWorkspaceId
    const freeWsId = 'ws_free_unbound'
    const resolveProjectRoot = (id) => wfProjects.findByCanvasWorkspaceId(id)
    const wfStore = createWorkspaceStore({ workspacesDir: join(home, 'workspaces'), resolveProjectRoot })
    const boundCanvas = wfStore.create('Bound Canvas', boundWsId)
    const freeCanvas = wfStore.create('Free Canvas', freeWsId)
    const wfAssets = createProjectAssetsStore({ workspacesDir: wfStore.workspacesDir, resolveProjectRoot })
    const wfMediaDir = join(home, 'wf-media')
    mkdirSync(wfMediaDir, { recursive: true })

    const boundClipId = 'clip_bound_1'
    const freeClipId = 'clip_free_1'
    const studioClipId = 'clip_studio_1'
    wfStore.save(boundWsId, {
      expectedVersion: boundCanvas.version,
      nodes: [{ id: 'n_bound', type: 'video_composition', position: { x: 0, y: 0 }, data: { title: 'Bound', projectId: boundClipId } }],
      edges: [],
    })
    wfStore.save(freeWsId, {
      expectedVersion: freeCanvas.version,
      nodes: [{ id: 'n_free', type: 'video_composition', position: { x: 0, y: 0 }, data: { title: 'Free', projectId: freeClipId } }],
      edges: [],
    })

    const canAccessWorkspace = (id, sessionId) => (id === boundWsId || id === freeWsId) && sessionId === 'sess-cmu04'
    const wfMediaSupport = createWorkflowMediaSupport({
      store: wfStore,
      assetsStore: wfAssets,
      resolveAssetsRoot: resolveProjectRoot,
      mediaDir: wfMediaDir,
      canAccessWorkspace,
    })
    mediaResolver.registerProvider(wfMediaSupport.projectAssetProvider)
    mediaResolver.registerProvider(wfMediaSupport.canvasNodeProvider)
    const workflowClip = createWorkflowClipService({
      store: wfStore,
      assetsStore: wfAssets,
      resolveProjectRoot,
      resolveNodeSources: wfMediaSupport.resolveNodeSources,
      canAccessWorkspace,
    })

    const clipStore = createClipProjectStore({ paths: clipPaths })
    const boundBinding = { workspaceId: boundWsId, nodeId: 'n_bound', projectId: boundClipId }
    const freeBinding = { workspaceId: freeWsId, nodeId: 'n_free', projectId: freeClipId }
    clipStore.save(boundClipId, {
      id: boundClipId,
      name: 'Bound Clip',
      settings: { width: 720, height: 1280, frameRate: 30 },
      timeline: { tracks: [], duration: 0 },
      mediaLibrary: { items: [] },
    }, { binding: boundBinding, expectedRevision: 0 })
    clipStore.save(freeClipId, {
      id: freeClipId,
      name: 'Free Clip',
      settings: { width: 720, height: 1280, frameRate: 30 },
      timeline: { tracks: [], duration: 0 },
      mediaLibrary: { items: [] },
    }, { binding: freeBinding, expectedRevision: 0 })

    const dispatcher = createClipDispatcher({
      store: clipStore,
      paths: clipPaths,
      getWorkflowClip: () => workflowClip,
      getMediaResolver: () => mediaResolver,
    })

    let routeHandler
    const webServer = { register(def) { routeHandler = def.handler; return () => {} } }
    registerClipRoutes(webServer, dispatcher, {
      paths: clipPaths,
      getConnection: () => ({ requestRejection: () => undefined }),
      getHubEvents: () => ({
        authorizeWindow: (req) => {
          const sess = req.headers['x-session']
          if (!sess) return null
          return { windowInstanceId: String(sess), isAlive: () => true, getViewport: () => ({ ok: true, sessionId: String(sess) }) }
        },
      }),
    })

    const server = createServer((req, res) => routeHandler(req, res))
    servers.push(server)
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${server.address().port}`

    const localVideoBytes = Buffer.from('\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom-local-drag')
    const localVideoSha = sha256(localVideoBytes)
    const studioWavBytes = Buffer.from('RIFF\x24\x00\x00\x00WAVEfmt studio-mic-recording')
    const studioWavSha = sha256(studioWavBytes)
    const freePngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52])
    const freePngSha = sha256(freePngBytes)

    // 1. Unauthorized session cannot upload into a bound canvas project
    const deniedRes = await fetch(`${base}/omnimux-clip/api/projects/${boundClipId}/media/m_local/bytes`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream', 'x-clip-media-name': 'local.mp4', 'x-session': 'other-sess' },
      body: localVideoBytes,
    })
    assert.equal(deniedRes.status, 403)

    // 2. Authorized canvas-bound upload lands in <ProjectRoot>/assets/imported/ + .omnimux/assets.json
    const boundUp = await fetch(`${base}/omnimux-clip/api/projects/${boundClipId}/media/m_local/bytes`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream', 'x-clip-media-name': encodeURIComponent('拍摄素材.mp4'), 'x-session': 'sess-cmu04' },
      body: localVideoBytes,
    })
    assert.equal(boundUp.status, 200)
    const boundBody = await boundUp.json()
    assert.equal(boundBody.sha256, localVideoSha)
    assert.equal(boundBody.handle.scope, 'project-asset')
    assert.equal(boundBody.handle.workspaceId, boundWsId)
    assert.ok(boundBody.handle.rel.startsWith('assets/imported/'))
    assert.equal(existsSync(join(wfProject.path, boundBody.handle.rel)), true)
    const manifest = JSON.parse(readFileSync(join(wfProject.path, '.omnimux', 'assets.json'), 'utf8'))
    assert.ok(manifest.items.some(entry => entry.relative_path === boundBody.handle.rel && entry.sha256 === localVideoSha))

    // Dedup: uploading identical bytes returns the same asset rel without creating a second file
    const boundDup = await fetch(`${base}/omnimux-clip/api/projects/${boundClipId}/media/m_local2/bytes`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream', 'x-clip-media-name': 'copy.mp4', 'x-session': 'sess-cmu04' },
      body: localVideoBytes,
    })
    assert.equal(boundDup.status, 200)
    assert.equal((await boundDup.json()).handle.rel, boundBody.handle.rel)

    // Save handle on Host project, then verify GET .../bytes streams exact bytes (surviving IDB clear)
    clipStore.save(boundClipId, {
      id: boundClipId,
      name: 'Bound Clip',
      settings: { width: 720, height: 1280, frameRate: 30 },
      timeline: { tracks: [], duration: 0 },
      mediaLibrary: {
        items: [{
          id: 'm_local',
          name: '拍摄素材.mp4',
          type: 'video',
          omnimuxSource: { id: 'local:1', version: `sha256:${localVideoSha}`, digest: localVideoSha, handle: boundBody.handle },
        }],
      },
    }, { binding: boundBinding, expectedRevision: 1 })
    const boundDown = await fetch(`${base}/omnimux-clip/api/projects/${boundClipId}/media/m_local/bytes`, {
      headers: { 'x-session': 'sess-cmu04' },
    })
    assert.equal(boundDown.status, 200)
    assert.deepEqual(Buffer.from(await boundDown.arrayBuffer()), localVideoBytes)

    // 3. Standalone Studio first-save upload (project not yet on Host) lands in clip-vault
    const studioUp = await fetch(`${base}/omnimux-clip/api/projects/${studioClipId}/media/m_mic/bytes`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream', 'x-clip-media-name': 'mic.wav' },
      body: studioWavBytes,
    })
    assert.equal(studioUp.status, 200)
    const studioBody = await studioUp.json()
    assert.equal(studioBody.handle.scope, 'clip-vault')
    assert.equal(studioBody.handle.sha256, studioWavSha)
    clipStore.save(studioClipId, {
      id: studioClipId,
      name: 'Studio Clip',
      settings: { width: 720, height: 1280, frameRate: 30 },
      timeline: { tracks: [], duration: 0 },
      mediaLibrary: {
        items: [{
          id: 'm_mic',
          name: 'mic.wav',
          type: 'audio',
          omnimuxSource: { id: `vault:${studioWavSha}`, version: `sha256:${studioWavSha}`, digest: studioWavSha, handle: studioBody.handle },
        }],
      },
    }, { expectedRevision: 0 })
    const studioDown = await fetch(`${base}/omnimux-clip/api/projects/${studioClipId}/media/m_mic/bytes`)
    assert.equal(studioDown.status, 200)
    assert.deepEqual(Buffer.from(await studioDown.arrayBuffer()), studioWavBytes)

    // 4. Unbound free canvas falls back cleanly to clip-vault and streams back
    const freeUp = await fetch(`${base}/omnimux-clip/api/projects/${freeClipId}/media/m_png/bytes`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream', 'x-clip-media-name': 'overlay.png', 'x-session': 'sess-cmu04' },
      body: freePngBytes,
    })
    assert.equal(freeUp.status, 200)
    const freeBody = await freeUp.json()
    assert.equal(freeBody.handle.scope, 'clip-vault')
    assert.equal(freeBody.handle.sha256, freePngSha)
    clipStore.save(freeClipId, {
      id: freeClipId,
      name: 'Free Clip',
      settings: { width: 720, height: 1280, frameRate: 30 },
      timeline: { tracks: [], duration: 0 },
      mediaLibrary: {
        items: [{
          id: 'm_png',
          name: 'overlay.png',
          type: 'image',
          omnimuxSource: { id: `vault:${freePngSha}`, version: `sha256:${freePngSha}`, digest: freePngSha, handle: freeBody.handle },
        }],
      },
    }, { binding: freeBinding, expectedRevision: 1 })
    const freeDown = await fetch(`${base}/omnimux-clip/api/projects/${freeClipId}/media/m_png/bytes`, {
      headers: { 'x-session': 'sess-cmu04' },
    })
    assert.equal(freeDown.status, 200)
    assert.deepEqual(Buffer.from(await freeDown.arrayBuffer()), freePngBytes)
  })

  it('AC-CMU-04: editor-session flush uploads local blobs before writeHost and blocks synchronization on upload failure', async () => {
    const localBlob = new Blob([Buffer.from('RIFF\x24\x00\x00\x00WAVEfmt live-flush')], { type: 'audio/wav' })
    const expectedSha = sha256(Buffer.from(await localBlob.arrayBuffer()))
    const callOrder = []
    let failUpload = false
    let currentProject = {
      id: 'proj_flush_1',
      name: 'Flush Studio',
      mediaLibrary: {
        items: [{ id: 'm_drag', name: 'drag.wav', type: 'audio', missing: false, sourceRef: { kind: 'indexeddb', key: 'm_drag' } }],
      },
    }
    let hostRecord = {
      projectId: 'proj_flush_1',
      revision: 1,
      project: { id: 'proj_flush_1', name: 'Flush Studio', mediaLibrary: { items: [] } },
    }
    let listener = null
    const native = {
      projectId: () => currentProject.id,
      capture: () => ({
        project: structuredClone(currentProject),
        fingerprint: JSON.stringify(currentProject),
        media: { m_drag: localBlob },
      }),
      attachMediaHandle: (projectId, mediaId, omnimuxSource) => {
        if (projectId !== currentProject.id) return false
        currentProject = {
          ...currentProject,
          mediaLibrary: {
            items: currentProject.mediaLibrary.items.map(item => item.id === mediaId ? { ...item, omnimuxSource } : item),
          },
        }
        return true
      },
      subscribe: (cb) => { listener = cb; return () => { listener = null } },
      load: async (record) => { currentProject = structuredClone(record.project) },
      welcome: async () => {},
      suspend: () => {},
      isEditorReady: () => true,
      projection: (revision) => ({ projectId: currentProject.id, revision }),
    }
    const localDrafts = new Map()
    const storage = {
      writerId: 'w-test',
      readLocal: async (id) => localDrafts.get(id) ?? null,
      writeLocal: async (record) => { localDrafts.set(record.project.id, structuredClone(record)) },
      readHost: async () => structuredClone(hostRecord),
      uploadMediaBytes: async (projectId, mediaId, blob) => {
        callOrder.push(`upload:${projectId}:${mediaId}:${blob.size}`)
        if (failUpload) throw Object.assign(new Error('disk full'), { code: 'internal-error' })
        return {
          sha256: expectedSha,
          size: blob.size,
          mimeType: 'audio/wav',
          handle: { v: 1, scope: 'clip-vault', sha256: expectedSha, mimeType: 'audio/wav', size: blob.size },
        }
      },
      writeHost: async (record) => {
        callOrder.push(`writeHost:${record.project.mediaLibrary.items[0]?.omnimuxSource?.handle?.scope ?? 'none'}`)
        hostRecord = { projectId: record.project.id, revision: record.revision, project: structuredClone(record.project) }
        return { revision: record.revision }
      },
    }

    const session = createEditorSession({
      storage,
      native,
      debounceMs: 60_000,
      workbench: () => ({ getActiveSurface: () => ({ tabId: 'omnimux-clip', instanceId: 'studio-1', sessionId: 'sess-1', panelOpen: true }) }),
    })
    session.add({
      id: 'studio-1',
      mode: 'standalone',
      tabId: 'omnimux-clip',
      isVisible: () => true,
      getStudioRequest: () => ({ projectId: 'proj_flush_1', key: 'req-1' }),
      getCanvas: () => null,
      getCanvasAnchor: () => null,
      setState: () => {},
    })
    session.reconcile()
    await session.getWaiting()

    // Simulate user importing a local blob in OpenReel -> upload fails first, writeHost must NOT run
    failUpload = true
    currentProject = {
      id: 'proj_flush_1',
      name: 'Flush Studio',
      mediaLibrary: {
        items: [{ id: 'm_drag', name: 'drag.wav', type: 'audio', missing: false, sourceRef: { kind: 'indexeddb', key: 'm_drag' } }],
      },
    }
    listener?.()
    const failedSave = await session.save()
    assert.equal(failedSave.synchronized, false)
    assert.deepEqual(callOrder, [`upload:proj_flush_1:m_drag:${localBlob.size}`])

    // Now upload succeeds -> upload runs strictly before writeHost, and host receives the clip-vault handle
    failUpload = false
    const okSave = await session.save()
    assert.equal(okSave.synchronized, true)
    assert.deepEqual(callOrder, [
      `upload:proj_flush_1:m_drag:${localBlob.size}`,
      `upload:proj_flush_1:m_drag:${localBlob.size}`,
      'writeHost:clip-vault',
    ])
    assert.equal(hostRecord.project.mediaLibrary.items[0].omnimuxSource.handle.sha256, expectedSha)
    assert.equal(currentProject.mediaLibrary.items[0].omnimuxSource.handle.scope, 'clip-vault')
    session.dispose()
  })

  it('AC-CMU-06 & AC-CMU-07: canvas export lands in ProjectRoot/artifacts with clip_export lineage, reclaims staging MP4, supports secondary composition, idempotent retryCanvas, and legacy /api/local-file in-place upgrade', async () => {
    const validMp4 = Buffer.from(`
AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAMobW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAA+gAAQAA
AQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAgAAAlN0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAA+gAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAA
AAAAAAABAAAAAAAAAAAAAAAAAABAAAAAABAAAAAQAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAPoAAAAAAABAAAAAAHL
bWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAABAAAAAQABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRl
b0hhbmRsZXIAAAABdm1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAA
AQAAATZzdGJsAAAAtnN0c2QAAAAAAAAAAQAAAKZhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAABAAEABIAAAASAAAAAAA
AAABFExhdmM2My4xLjEwMiBsaWJ4MjY0AAAAAAAAAAAAAAAAGP//AAAALGF2Y0MBQsAK/+EAFWdCwAraewEQAAADABAAAAMA
SPEiagEABGjOD8gAAAAQcGFzcAAAAAEAAAABAAAAFGJ0cnQAAAAAAAABAAAAAAAAAAAYc3R0cwAAAAAAAAABAAAAAgAAIAAA
AAAUc3RzcwAAAAAAAAABAAAAAQAAABxzdHNjAAAAAAAAAAEAAAABAAAAAgAAAAEAAAAcc3RzegAAAAAAAAAAAAAAAgAAABcA
AAAJAAAAFHN0Y28AAAAAAAAAAQAAA1gAAABhdWR0YQAAAFltZXRhAAAAAAAAACFoZGxyAAAAAAAAAABtZGlyYXBwbAAAAAAA
AAAAAAAAACxpbHN0AAAAJKl0b28AAAAcZGF0YQAAAAEAAAAATGF2ZjYzLjEuMTAyAAAACGZyZWUAAAAobWRhdAAAABNliIQ6
EYoAAjFxwABDyjgACAXgAAAABUGaIBKl
`, 'base64')
    const validMp4Sha = sha256(validMp4)
    const home = mkdtempSync(join(tmpdir(), 'clip-export-unification-'))
    temps.push(home)

    const mediaResolver = createMediaResolver({ logger: { warn: () => {} } })
    const projectsRoot = join(home, 'projects')
    const workspacesDir = join(home, 'workspaces')
    const mediaDir = join(home, 'workflow-media')
    mkdirSync(projectsRoot, { recursive: true })
    mkdirSync(workspacesDir, { recursive: true })
    mkdirSync(mediaDir, { recursive: true })

    const wfProjects = createWorkflowProjectStore({ libraryRoot: projectsRoot })
    const wfProject = wfProjects.create('导出闭环项目', { canvasWorkspaceIds: ['ws_export_ac67'] })
    const wsId = wfProject.pages[0].canvasWorkspaceId
    const resolveProjectRoot = (id) => wfProjects.findByCanvasWorkspaceId(id)
    const rawStore = createWorkspaceStore({ workspacesDir, resolveProjectRoot })
    const assetsStore = createProjectAssetsStore({ workspacesDir: rawStore.workspacesDir, resolveProjectRoot })
    const ws = rawStore.create('导出画布', wsId)

    // Seed a legacy /api/local-file downstream node with custom user-dragged coordinates to verify AC-CMU-07 in-place upgrade
    const comp1Id = 'node_comp_1'
    const comp1ClipId = 'clip_node_export_1'
    const comp2Id = 'node_comp_2'
    const comp2ClipId = 'clip_node_export_2'
    const legacyDownstreamId = 'node_mat_legacy_out'
    const draggedPos = { x: 777, y: 333 }
    rawStore.save(ws.id, {
      expectedVersion: 0,
      nodes: [
        { id: comp1Id, type: 'video_composition', position: { x: 100, y: 100 }, data: { title: '一级合成', projectId: comp1ClipId } },
        {
          id: legacyDownstreamId,
          type: 'material',
          position: draggedPos,
          data: {
            materialType: 'video',
            label: '一级合成_成片',
            origin: 'clip_export',
            sourceCompositionNodeId: comp1Id,
            mediaUrl: '/omnimux-workflow/api/local-file?path=%2Flegacy%2Fold-export.mp4',
          },
        },
        { id: comp2Id, type: 'video_composition', position: { x: 1200, y: 333 }, data: { title: '二级合成', projectId: comp2ClipId } },
      ],
      edges: [
        { id: 'edge_c1_out', source: comp1Id, target: legacyDownstreamId, sourceHandle: 'out', targetHandle: 'in' },
        { id: 'edge_out_c2', source: legacyDownstreamId, target: comp2Id, sourceHandle: 'out', targetHandle: 'in' },
      ],
    })

    // Wrap WorkspaceStore.save to inject one failure on first export commit (AC-CMU-07)
    let failNextSave = true
    const store = {
      get: (id) => rawStore.get(id),
      save: (id, patch) => {
        if (failNextSave) {
          failNextSave = false
          throw new Error('injected-workspace-save-failure')
        }
        return rawStore.save(id, patch)
      },
    }

    const mediaSupport = createWorkflowMediaSupport({
      store: rawStore,
      assetsStore,
      resolveAssetsRoot: resolveProjectRoot,
      mediaDir,
      canAccessWorkspace: (wsId, sid) => wsId === ws.id && sid === 'sess-export',
    })
    mediaResolver.registerProvider(mediaSupport.projectAssetProvider)
    mediaResolver.registerProvider(mediaSupport.canvasNodeProvider)

    const workflowClip = createWorkflowClipService({
      store,
      assetsStore,
      resolveProjectRoot,
      canAccessWorkspace: (wsId, sid) => wsId === ws.id && sid === 'sess-export',
      resolveNodeSources: mediaSupport.resolveNodeSources,
    })

    const clipPaths = ensureClipDirs(resolveClipPaths({ homeDir: home }))
    const exportJobs = createExportJobs({ paths: clipPaths, getWorkflowClip: () => workflowClip })
    const binding1 = { workspaceId: ws.id, nodeId: comp1Id, projectId: comp1ClipId }
    const begun = exportJobs.begin({
      requestId: 'req-export-ac67',
      projectId: comp1ClipId,
      projectRevision: 1,
      binding: binding1,
    })
    const tempUpload = join(clipPaths.tmpDir, 'export-upload.mp4')
    writeFileSync(tempUpload, validMp4)
    const stagingPath = join(clipPaths.exportsDir, 'jobs', String(begun.exportJobId), 'video.mp4')

    // First attempt fails WorkspaceStore.save -> canvas-failed, staging MP4 MUST be retained
    const firstReceipt = await exportJobs.upload({
      exportJobId: begun.exportJobId,
      uploadToken: begun.uploadToken,
      projectId: comp1ClipId,
      tempPath: tempUpload,
    })
    assert.equal(firstReceipt.status, 'canvas-failed')
    assert.equal(firstReceipt.canvasCommitted, false)
    assert.equal(existsSync(stagingPath), true, 'staging MP4 must stay on disk when canvas commit fails')

    // Retry commit -> succeeds idempotently with NO duplicate artifacts or assets.json entries, and reclaims staging MP4
    const retried = await exportJobs.retryCanvas(begun.exportJobId)
    assert.equal(retried.status, 'committed')
    assert.equal(retried.canvasCommitted, true)
    assert.equal(existsSync(stagingPath), false, 'duplicate staging MP4 must be reclaimed after artifact commit')
    assert.ok(retried.output.relativePath.startsWith('artifacts/'))
    assert.equal(retried.output.sha256, validMp4Sha)
    assert.equal(retried.output.mediaHandle.scope, 'project-asset')
    assert.equal(retried.output.mediaHandle.sha256, validMp4Sha)
    assert.match(retried.output.mediaUrl, new RegExp(`/omnimux-workflow/api/workspaces/${ws.id}/file\\?.*rev=sha256%3A${validMp4Sha}`))

    // Verify single artifact file on disk & single assets.json entry with clip_export lineage
    const artifactFiles = readdirSync(join(wfProject.path, 'artifacts'))
    assert.equal(artifactFiles.length, 1, 'retryCanvas must not create duplicate artifact files')
    assert.deepEqual(readFileSync(join(wfProject.path, retried.output.relativePath)), validMp4)
    const assetsDoc = assetsStore.get(ws.id)
    const clipExportEntries = assetsDoc.items.filter(item => item.sha256 === validMp4Sha)
    assert.equal(clipExportEntries.length, 1, 'retryCanvas must not create duplicate assets.json entries')
    assert.equal(clipExportEntries[0].lineage.kind, 'clip_export')
    assert.equal(clipExportEntries[0].lineage.sourceCompositionNodeId, comp1Id)

    // Verify legacy /api/local-file downstream node was upgraded in-place preserving dragged position & ID
    const graphAfter = rawStore.get(ws.id)
    const downstream = graphAfter.nodes.find(n => n.id === legacyDownstreamId)
    assert.ok(downstream, 'legacy downstream node ID must be preserved')
    assert.deepEqual(downstream.position, draggedPos, 'user-dragged coordinates must be preserved')
    assert.equal(downstream.data.mediaUrl, retried.output.mediaUrl)
    assert.equal(downstream.data.relativePath, retried.output.relativePath)
    assert.deepEqual(downstream.data.mediaHandle, retried.output.mediaHandle)
    assert.equal('realPath' in downstream.data, false)

    // Secondary composition (AC-CMU-06): comp2 connects to downstream成片 -> reconcile imports & streams verified bytes
    const clipStore = createClipProjectStore({ paths: clipPaths })
    const binding2 = { workspaceId: ws.id, nodeId: comp2Id, projectId: comp2ClipId }
    clipStore.materialize(comp2ClipId, { binding: binding2, title: '二级合成' })
    const dispatcher = createClipDispatcher({
      store: clipStore,
      paths: clipPaths,
      getWorkflowClip: () => workflowClip,
      getMediaResolver: () => mediaResolver,
    })
    let routeHandler
    const webServer = { register(def) { routeHandler = def.handler; return () => {} } }
    registerClipRoutes(webServer, dispatcher, {
      paths: clipPaths,
      getConnection: () => ({ requestRejection: () => undefined }),
      getHubEvents: () => ({
        authorizeWindow: () => ({ windowInstanceId: 'win-exp', isAlive: () => true, getViewport: () => ({ ok: true, sessionId: 'sess-export' }) }),
      }),
    })
    const server = createServer((req, res) => routeHandler(req, res))
    servers.push(server)
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${server.address().port}`

    const inspect2 = await fetch(`${base}/omnimux-clip/api/projects/${comp2ClipId}/media/reconcile`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'inspect', binding: binding2 }),
    })
    assert.equal(inspect2.status, 200)
    const inspectBody = await inspect2.json()
    assert.equal(inspectBody.unimportedUpstreams.length, 1)
    assert.equal(inspectBody.unimportedUpstreams[0].sourceNodeId, legacyDownstreamId)
    assert.equal(inspectBody.unimportedUpstreams[0].canonicalHandle.scope, 'project-asset')

    const import2 = await fetch(`${base}/omnimux-clip/api/projects/${comp2ClipId}/media/reconcile`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        mode: 'apply',
        binding: binding2,
        actions: [{ action: 'import_upstream', sourceNodeId: legacyDownstreamId, outputIndex: 0 }],
      }),
    })
    assert.equal(import2.status, 200)
    const importedId = (await import2.json()).importedMediaIds[0]
    const stream2 = await fetch(`${base}/omnimux-clip/api/projects/${comp2ClipId}/media/${importedId}/bytes`)
    assert.equal(stream2.status, 200)
    assert.equal(stream2.headers.get('x-content-sha256'), validMp4Sha)
    assert.deepEqual(Buffer.from(await stream2.arrayBuffer()), validMp4)
  })
})
