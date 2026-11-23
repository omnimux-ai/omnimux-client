import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
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
import { createClipDispatcher, registerClipRoutes } from '../../plugins/omnimux-clip/src/http/routes.js'
import { resolveClipPaths } from '../../plugins/omnimux-clip/src/paths.js'
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
})
