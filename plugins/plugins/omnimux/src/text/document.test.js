import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { OmnimuxError } from '../media/errors.js'
import { probeRemoteDocument } from './document.js'

describe('APIMart document URL probe', () => {
  it('uses a HEAD fixture to derive official format and size offline', async () => {
    let request
    const result = await probeRemoteDocument('https://cdn.example.com/brief.pptx', {
      maxDocumentBytes: 100 * 1024 * 1024,
      fetcher: async (url, init) => {
        request = { url, init }
        return {
          ok: true,
          status: 200,
          headers: { get: (name) => name === 'content-length' ? '4096' : null },
        }
      },
    })
    assert.equal(request.init.method, 'HEAD')
    assert.equal(result.mime, 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
    assert.equal(result.sizeBytes, 4096)
  })

  it('rejects unknown formats and missing size metadata', async () => {
    await assert.rejects(
      () => probeRemoteDocument('https://cdn.example.com/archive.zip', { fetcher: async () => ({ ok: true, headers: { get: () => '1' } }) }),
      (error) => error instanceof OmnimuxError,
    )
    await assert.rejects(
      () => probeRemoteDocument('https://cdn.example.com/brief.pdf', { fetcher: async () => ({ ok: true, status: 200, headers: { get: () => null } }) }),
      (error) => error instanceof OmnimuxError && error.message.includes('Content-Length'),
    )
  })
})
