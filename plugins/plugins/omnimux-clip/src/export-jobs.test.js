import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createExportJobs } from './export-jobs.js'
import { ensureClipDirs, resolveClipPaths } from './paths.js'

// Two synthetic H.264 frames, 16×16 at 2 fps, with the moov box before mdat.
const MP4 = Buffer.from(`
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
const projectId = 'clip_node_source'
const binding = { workspaceId: 'ws_canvas', nodeId: 'source-composition', projectId }

function setup(t, getWorkflowClip) {
  const homeDir = realpathSync(mkdtempSync(join(tmpdir(), 'clip-export-jobs-')))
  const paths = ensureClipDirs(resolveClipPaths({ homeDir }))
  t.after(() => {
    assert.equal(realpathSync(homeDir), homeDir)
    rmSync(homeDir, { recursive: true, force: true })
  })
  const open = () => createExportJobs({ paths, getWorkflowClip })
  const jobs = open()
  const begin = (requestId, projectRevision, canvas = binding) => jobs.begin({ requestId, projectId, projectRevision, binding: canvas })
  const temp = (name, bytes = MP4) => {
    const tempPath = join(paths.tmpDir, `${name}.bin`)
    writeFileSync(tempPath, bytes)
    return tempPath
  }
  const upload = (job, tempPath) => jobs.upload({ exportJobId: job.exportJobId, uploadToken: job.uploadToken, projectId: job.projectId, tempPath })
  return { homeDir, paths, open, jobs, begin, temp, upload }
}

test('trusted reservation is durable, monotonic and omits proof on lookup and replay', async (t) => {
  const h = setup(t)
  const args = { requestId: 'fixed-request', projectId: 'standalone', projectRevision: 1 }
  const first = h.jobs.begin(args)
  assert.equal(Buffer.from(first.uploadToken, 'base64url').length, 32)
  assert.equal(first.status, 'awaiting-upload')
  const restarted = h.open()
  const status = restarted.get(String(first.exportJobId))
  assert.deepEqual(restarted.begin(args), status)
  assert.equal('uploadToken' in status, false)
  assert.equal('uploadDigest' in status, false)
  assert.equal(readFileSync(join(h.paths.exportsDir, 'jobs', 'requests.json'), 'utf8').includes(first.uploadToken), false)
  assert.throws(() => restarted.begin({ ...args, projectRevision: 2 }), { code: 'export-request-mismatch' })
  assert.throws(() => restarted.begin({ ...args, requestId: 'invalid-canvas', binding }), { code: 'invalid-json' })
  assert.throws(() => restarted.get('1/../../2'), { code: 'invalid-id' })
  assert.throws(() => restarted.get(12345), { code: 'not-found' })
  const second = restarted.begin({ ...args, requestId: 'next-request' })
  assert.equal(second.exportJobId, first.exportJobId + 1)

  const saved = await restarted.upload({
    exportJobId: first.exportJobId, projectId: args.projectId, uploadToken: first.uploadToken, tempPath: h.temp('restart'),
  })
  assert.equal(saved.canvasCommitted, false)
  assert.equal(saved.status, 'file-saved')
  assert.deepEqual(restarted.begin(args), saved)
  assert.deepEqual(h.open().get(first.exportJobId), saved)
})

test('raw upload matches the original project and caller proof, once within its deadline', async (t) => {
  t.mock.method(Date, 'now', () => 1_000)
  const h = setup(t)
  const job = h.begin('verified', 1)
  const foreignProof = h.begin('foreign', 1).uploadToken
  const tempPath = h.temp('authenticated-upload')
  assert.throws(() => h.jobs.authorizeUpload({ ...job, uploadToken: foreignProof }), { code: 'path-denied' })
  assert.equal(h.jobs.authorizeUpload(job), undefined)
  await assert.rejects(h.upload({ ...job, uploadToken: foreignProof }, tempPath), { code: 'path-denied' })
  await assert.rejects(h.upload({ ...job, projectId: 'other-project' }, tempPath), { code: 'path-denied' })
  const outside = join(h.homeDir, 'outside.mp4')
  writeFileSync(outside, MP4)
  await assert.rejects(h.upload(job, outside), { code: 'path-denied' })
  if (process.platform !== 'win32') {
    const link = join(h.paths.tmpDir, 'symbolic-upload.bin')
    symlinkSync(outside, link)
    await assert.rejects(h.upload(job, link), { code: 'path-denied' })
  }
  const inProgress = h.upload(job, tempPath)
  await assert.rejects(h.upload(job, h.temp('concurrent-replay')), { code: 'export-upload-used' })
  const saved = await inProgress
  assert.deepEqual(readFileSync(saved.output.videoPath), MP4)
  await assert.rejects(h.upload(job, h.temp('replay')), { code: 'export-upload-used' })
  const expires = h.begin('expires', 2)
  t.mock.restoreAll()
  t.mock.method(Date, 'now', () => expires.uploadExpiresAt)
  await assert.rejects(h.upload(expires, h.temp('expired')), { code: 'path-denied' })
  assert.equal(h.jobs.get(expires.exportJobId).status, 'expired')
})

test('manual cancellation keeps its proof scope and survives the Host restarting', async (t) => {
  const calls = []
  const h = setup(t, () => ({ commitExport: (request) => {
    calls.push(request)
    return { status: 'committed', canvasCommitted: true, workspaceVersion: 4 }
  } }))
  const beginManual = requestId => h.jobs.begin({ requestId, projectId, projectRevision: 1, binding, manualWindowId: 'editor-window' })
  const job = beginManual('cancel-during-probe')
  const other = beginManual('saves-before-cancel')
  const agent = h.begin('agent', 1)
  assert.throws(() => h.jobs.cancel({ ...job, uploadToken: other.uploadToken }), { code: 'path-denied' })
  assert.throws(() => h.jobs.cancel({ ...job, projectId: 'another-project' }), { code: 'path-denied' })
  assert.throws(() => h.jobs.cancel(agent), { code: 'path-denied' })

  const pending = h.upload(job, h.temp('cancel-in-flight'))
  const cancelled = h.jobs.cancel(job)
  assert.equal(cancelled.status, 'cancelled')
  assert.equal(cancelled.fileSaved, false)
  assert.equal(cancelled.canvasCommitted, false)
  await assert.rejects(pending, { code: 'export-cancelled' })
  const restarted = h.open()
  assert.deepEqual(restarted.get(job.exportJobId), cancelled)
  assert.deepEqual(restarted.cancel(job), cancelled)
  assert.deepEqual(await restarted.retryCanvas(job.exportJobId), cancelled)
  assert.throws(() => restarted.authorizeUpload(job), { code: 'export-cancelled' })
  assert.equal(calls.length, 0)

  const finished = await h.upload(other, h.temp('already-saved'))
  assert.equal(finished.status, 'committed')
  assert.deepEqual(restarted.cancel(other), finished)
  assert.equal(calls.length, 1)
})

test('export generation survives Host restart, editor recreation and an old writer making a later reservation', async (t) => {
  const calls = []
  const h = setup(t, () => ({ commitExport: (request) => {
    calls.push(request)
    return { status: 'committed', canvasCommitted: true, workspaceVersion: calls.length }
  } }))
  const reserve = (requestId, projectRevision, draftWriterId, revisionEpoch, editorInstanceId = draftWriterId) =>
    h.open().begin({ requestId, projectId, projectRevision, revisionEpoch, draftWriterId, editorInstanceId, binding })
  const older = reserve('discarded-5', 5, 'writer-a', 0)
  const unseen = reserve('still-old-6', 6, 'writer-b', 0)
  const adopted = reserve('adopted-2', 2, 'writer-a', 1)
  const advanced = reserve('advanced-3', 3, 'writer-c', 0)
  const reopened = reserve('reopened-2', 2, 'writer-a', 1, 'recreated-editor')
  const late = reserve('still-old-7', 7, 'writer-b', 0)
  const publish = job => h.open().upload({ ...job, tempPath: h.temp(job.requestId) })

  assert.equal((await publish(older)).status, 'committed')
  assert.equal((await publish(adopted)).status, 'committed')
  assert.equal((await publish(advanced)).status, 'committed')
  for (const dropped of [unseen, reopened, late]) {
    assert.ok(dropped.exportJobId > older.exportJobId)
    assert.equal((await publish(dropped)).status, 'superseded')
  }
  assert.deepEqual(calls.map(({ projectRevision, revisionEpoch, exportGeneration }) =>
    [projectRevision, revisionEpoch, exportGeneration]), [[5, 0, 0], [2, 1, 1], [3, 0, 1]])
})

test('MP4 validation rejects an incomplete structural tail and a fake header', async (t) => {
  const h = setup(t, () => ({ commitExport: () => assert.fail('Malformed bytes reached the canvas') }))
  for (const [name, bytes] of [
    ['truncated-media', MP4.subarray(0, -5)],
    ['magic-only', MP4.subarray(0, 32)],
    ['arbitrary', Buffer.from('This is not a video')],
  ]) {
    const job = h.begin(name, 1)
    await assert.rejects(h.upload(job, h.temp(name, bytes)), { code: 'invalid-export-media' })
    const status = h.open().get(job.exportJobId)
    assert.equal(status.status, 'upload-failed')
    assert.equal(status.fileSaved, false)
    assert.equal(status.canvasCommitted, false)
    assert.equal('output' in status, false)
    await assert.rejects(h.upload(job, h.temp(`${name}-again`)), { code: 'export-upload-used' })
  }
})

test('canvas failure preserves the MP4 and retries the original binding without uploading or encoding', async (t) => {
  const calls = []
  const h = setup(t, () => ({ commitExport: (request) => {
    calls.push(request)
    if (calls.length === 1) throw new Error('simulated failure')
    return { status: 'committed', canvasCommitted: true, workspaceVersion: 4 }
  } }))
  const job = h.begin('retry-canvas', 7)
  const failed = await h.upload(job, h.temp('canvas'))
  assert.equal(failed.status, 'canvas-failed')
  assert.equal(failed.fileSaved, true)
  assert.equal(failed.canvasCommitted, false)
  assert.equal(failed.bytes, MP4.length)
  assert.deepEqual(failed.output, {
    videoPath: failed.output.videoPath, revision: failed.output.revision, durationMs: 1000, width: 16, height: 16,
  })
  assert.deepEqual(readFileSync(failed.output.videoPath), MP4)
  const rebooted = h.open()
  assert.deepEqual(rebooted.get(job.exportJobId), failed)
  const committed = await rebooted.retryCanvas(job.exportJobId)
  assert.equal(committed.status, 'committed')
  assert.equal(committed.canvasCommitted, true)
  assert.equal(committed.workspaceVersion, 4)
  const request = { ...binding, exportJobId: job.exportJobId, projectRevision: 7, output: failed.output }
  assert.deepEqual(calls, [request, request])
  assert.deepEqual(await h.jobs.retryCanvas(job.exportJobId), committed)
  assert.equal(calls.length, 2)
})

test('late uploads preserve their own bytes and cannot supersede a newer job or source revision', async (t) => {
  const committed = []
  const h = setup(t, () => ({ commitExport: (request) => {
    committed.push(request)
    return { status: 'committed', canvasCommitted: true, workspaceVersion: committed.length }
  } }))
  const older = h.begin('old', 8)
  const newer = h.begin('new', 9)
  const newestFile = await h.upload(newer, h.temp('new'))
  const late = await h.upload(older, h.temp('old'))
  const staleRevision = h.begin('stale-revision', 8)
  const stale = await h.upload(staleRevision, h.temp('stale-revision'))
  assert.deepEqual(committed.map((entry) => entry.exportJobId), [newer.exportJobId])
  for (const result of [late, stale]) {
    assert.equal(result.status, 'superseded')
    assert.equal(result.fileSaved, true)
    assert.equal(result.canvasCommitted, false)
    assert.notEqual(result.output.videoPath, newestFile.output.videoPath)
    assert.deepEqual(readFileSync(result.output.videoPath), MP4)
    assert.deepEqual(await h.open().retryCanvas(result.exportJobId), result)
  }
  assert.deepEqual(h.open().get(newer.exportJobId), newestFile)
  assert.deepEqual(readFileSync(newestFile.output.videoPath), MP4)
})

test('a newer committed upload also supersedes a prior failed canvas retry', async (t) => {
  const calls = []
  const h = setup(t, () => ({ commitExport: ({ exportJobId }) => {
    calls.push(exportJobId)
    if (calls.length === 1) return { status: 'committed', canvasCommitted: false }
    return { status: 'committed', canvasCommitted: true, workspaceVersion: 19 }
  } }))
  const first = h.begin('initial-failure', 1)
  assert.equal((await h.upload(first, h.temp('first'))).status, 'canvas-failed')
  const second = h.begin('later', 1)
  assert.equal((await h.upload(second, h.temp('second'))).status, 'committed')
  const retry = await h.open().retryCanvas(first.exportJobId)
  assert.equal(retry.status, 'superseded')
  assert.equal(retry.fileSaved, true)
  assert.equal(retry.canvasCommitted, false)
  assert.deepEqual(calls, [first.exportJobId, second.exportJobId])
})
