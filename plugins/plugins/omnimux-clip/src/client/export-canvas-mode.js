import { getActiveClipSession, getActiveClipStageStore } from './stage-store.js'

const EXPORT_UPLOAD = /^\/omnimux-clip\/api\/projects\/([A-Za-z0-9][A-Za-z0-9._-]{0,127})\/save-export$/

async function observeExportResponse(input, init, recordReceipt) {
  let receipt
  try {
    const response = await globalThis.fetch(input, init)
    if (response.ok) receipt = await response.clone().json()
    return response
  } finally {
    recordReceipt(receipt)
  }
}

/** Bundle-local fetch adapter for the legacy OpenReel export callback. */
export function fetch(input, init) {
  const upload = typeof input === 'string' && init?.method === 'POST' && init.body instanceof Blob
    ? EXPORT_UPLOAD.exec(input)
    : null
  const recordReceipt = upload && getActiveClipStageStore()?.beginCanvasExportUpload(upload[1])
  return recordReceipt ? observeExportResponse(input, init, recordReceipt) : globalThis.fetch(input, init)
}

/**
 * Canvas-embedded clip editor: Export must run immediately and persist
 * through the host + canvas node, never via a native Save dialog.
 */
export function isCanvasClipExportSession() {
  return getActiveClipSession()?.source === 'canvas'
}

function toBytes(data) {
  if (data instanceof ArrayBuffer) return new Uint8Array(data.slice(0))
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength))
  }
  return null
}

/**
 * In-memory writable. Canvas exports must never open showSaveDialog /
 * showSaveFilePicker; encoded bytes are captured here then POSTed to /save-export.
 */
export function createSilentCanvasWritable(mime = 'video/mp4') {
  const chunks = []
  let cursor = 0
  return {
    async seek(position) {
      cursor = position
    },
    async write(data) {
      if (data instanceof Blob) {
        const buf = await data.arrayBuffer()
        chunks.push(new Uint8Array(buf))
        cursor += buf.byteLength
        return
      }
      const bytes = toBytes(data)
      if (bytes) {
        chunks.push(bytes)
        cursor += bytes.byteLength
      }
    },
    async close() {
      this.__blob = new Blob(chunks, { type: mime })
    },
    async abort() {
      chunks.length = 0
    },
    async truncate() {},
    getCapturedBlob() {
      return this.__blob || (chunks.length ? new Blob(chunks, { type: mime }) : null)
    },
  }
}
