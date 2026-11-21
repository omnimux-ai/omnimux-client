import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('Clip bundles worker modules without absolute machine paths', () => {
  const bundle = readFileSync(new URL('../../lib/client.js', import.meta.url), 'utf8')
  const workerIds = [...bundle.matchAll(/"(?:clip-worker|worker&url):([^"\r\n]+)"(?=[:(])/g)]
    .map(([, id]) => id)
  assert.ok(workerIds.length > 0, 'Expected inline worker modules in the client bundle')
  assert.ok(workerIds.every(id => !/^(?:[\\/]|[A-Za-z]:)|\\|(?:^|\/)\.\.\//.test(id)),
    'Worker module IDs must use forward-slash vendor paths or package identifiers')
  for (const id of ['web/workers/whisper-worker.ts', 'core/audio/repair/repair-worklet.ts', '@ffmpeg/ffmpeg/worker']) {
    assert.ok(workerIds.includes(id), `Expected bundled worker module ${id}`)
  }
})
