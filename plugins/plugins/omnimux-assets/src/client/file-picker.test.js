import assert from 'node:assert/strict'
import test from 'node:test'
import { pickPath } from './api.js'

test('asset folder chooser keeps the Desktop selection order and sends no Web request', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('unexpected Web request')
  })
  const directories = ['/fixtures/素材二', '/fixtures/素材 一']
  let request
  globalThis.dshDesktop = {
    protocolVersion: 1,
    filePicker: {
      version: 1,
      open: async options => {
        request = options
        return { ok: true, path: directories[0], paths: directories }
      },
    },
  }
  t.after(() => { delete globalThis.dshDesktop })

  const result = await pickPath('directory')
  assert.deepEqual(request, { kind: 'directory', multiple: true, prompt: '选择要添加的文件夹' })
  assert.deepEqual(result, { ok: true, status: 200, body: { path: directories[0], paths: directories } })
  assert.equal(fetch.mock.callCount(), 0)
})

test('asset file chooser keeps the Web request and cancellation contract', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({ path: null, paths: [] }))
  const result = await pickPath('file')
  const [route, options] = fetch.mock.calls[0].arguments
  assert.equal(route, '/omnimux/assets/pick')
  assert.equal(options.method, 'POST')
  assert.deepEqual(JSON.parse(options.body), { kind: 'file' })
  assert.deepEqual(result, { ok: true, status: 200, body: { path: null, paths: [] } })
})
