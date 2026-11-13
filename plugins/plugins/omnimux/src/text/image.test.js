import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { mediaFromMagic, probeTextImage } from './image.js'

describe('official APIMart image formats', () => {
  const samples = [
    ['image/bmp', Buffer.from([0x42, 0x4d, 0, 0])],
    ['image/tiff', Buffer.from([0x49, 0x49, 0x2a, 0x00])],
    ['image/heic', Buffer.from([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63])],
    ['image/heif', Buffer.from([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x69, 0x66, 0x31])],
  ]

  for (const [mime, bytes] of samples) {
    it(`recognizes ${mime} from bytes`, async () => {
      assert.equal(mediaFromMagic(bytes), mime)
      const result = await probeTextImage(`data:${mime};base64,${bytes.toString('base64')}`, {
        attachments: { imageLimits: { maxImageBytes: 1024 } },
      })
      assert.equal(result.mediaType, mime)
    })
  }
})
