import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createMediaResolver, MediaResolverError, validateMediaHandle } from './media-resolver.js'

const VALID_SHA = 'a'.repeat(64)

describe('mediaResolver seam', () => {
  it('validates all v1 handle scopes and rejects unsafe or malformed handles', () => {
    assert.deepEqual(
      validateMediaHandle({ v: 1, scope: 'project-asset', workspaceId: 'ws_demo', assetId: 'ast_1', rel: 'artifacts/clip.mp4', sha256: VALID_SHA }),
      { v: 1, scope: 'project-asset', workspaceId: 'ws_demo', assetId: 'ast_1', rel: 'artifacts/clip.mp4', sha256: VALID_SHA },
    )
    assert.deepEqual(
      validateMediaHandle({ v: 1, scope: 'library-file', libraryAssetId: 'ast_lib', fileId: 'file_1' }),
      { v: 1, scope: 'library-file', libraryAssetId: 'ast_lib', fileId: 'file_1' },
    )
    assert.deepEqual(
      validateMediaHandle({ v: 1, scope: 'clip-vault', sha256: VALID_SHA, mimeType: 'Video/MP4', size: 1024 }),
      { v: 1, scope: 'clip-vault', sha256: VALID_SHA, mimeType: 'video/mp4', size: 1024 },
    )
    assert.deepEqual(
      validateMediaHandle({ v: 1, scope: 'canvas-node', workspaceId: 'ws_demo', nodeId: 'node_1' }),
      { v: 1, scope: 'canvas-node', workspaceId: 'ws_demo', nodeId: 'node_1', outputIndex: 0 },
    )

    for (const bad of [
      null,
      { v: 2, scope: 'project-asset', workspaceId: 'ws_demo', rel: 'artifacts/a.mp4' },
      { v: 1, scope: 'unknown' },
      { v: 1, scope: 'project-asset', workspaceId: 'ws_demo', rel: '../escape.mp4' },
      { v: 1, scope: 'project-asset', workspaceId: 'ws_demo', rel: '/abs/path.mp4' },
      { v: 1, scope: 'project-asset', workspaceId: 'ws_demo', rel: 'artifacts/a.mp4', sha256: 'not-a-sha' },
      { v: 1, scope: 'library-file', libraryAssetId: 'https://evil', fileId: 'file_1' },
      { v: 1, scope: 'clip-vault', sha256: VALID_SHA, mimeType: 'image/svg+xml', size: 12 },
      { v: 1, scope: 'clip-vault', sha256: VALID_SHA, mimeType: 'video/mp4', size: 0 },
      { v: 1, scope: 'canvas-node', workspaceId: 'bad_ws', nodeId: 'node_1' },
    ]) {
      assert.throws(() => validateMediaHandle(bad), (err) => err instanceof MediaResolverError && err.code === 'invalid-media-handle')
    }
  })

  it('dispatches stat/open to registered scope providers and fails with needs-provider when absent', async () => {
    const resolver = createMediaResolver()
    const handle = { v: 1, scope: 'library-file', libraryAssetId: 'ast_1', fileId: 'file_1', sha256: VALID_SHA }

    await assert.rejects(
      () => resolver.stat(handle, { sessionId: 's1' }),
      (err) => err instanceof MediaResolverError && err.code === 'needs-provider',
    )

    const calls = []
    const disposeFirst = resolver.registerProvider({
      scope: 'library-file',
      async stat(h, auth) { calls.push(['stat', h, auth]); return { status: 'ok', exists: true, currentSha256: VALID_SHA } },
      async open(h, auth) { calls.push(['open', h, auth]); return { canonicalHandle: h, sha256: VALID_SHA, size: 4, mimeType: 'video/mp4', displayName: 'a.mp4', openRange: async function* () { yield Buffer.from('test') } } },
    })
    assert.equal(resolver.hasProvider('library-file'), true)
    assert.deepEqual(resolver.scopes(), ['library-file'])

    const st = await resolver.stat(handle, { sessionId: 's1' })
    assert.equal(st.status, 'ok')
    const stream = await resolver.open(handle, { sessionId: 's1' })
    assert.equal(stream.sha256, VALID_SHA)
    assert.equal(calls.length, 2)

    // Replacing a provider must not be accidentally torn down by an older disposer.
    const disposeSecond = resolver.registerProvider({
      scope: 'library-file',
      async stat() { return { status: 'not_found', exists: false } },
      async open() { throw new MediaResolverError('media-not-found', 'missing') },
    })
    disposeFirst()
    assert.equal(resolver.hasProvider('library-file'), true)
    assert.equal((await resolver.stat(handle)).status, 'not_found')

    disposeSecond()
    assert.equal(resolver.hasProvider('library-file'), false)
  })
})
