import { closeSync, fsyncSync, mkdirSync, openSync, renameSync, rmSync, writeSync, chmodSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

/**
 * Atomically writes content to a file.
 * Creates parent directory with mode 0700.
 * Writes to a temporary file in the same directory, fsyncs, chmods to 0600, then renames to target.
 *
 * @param {string} filePath - Absolute or resolved path to target file
 * @param {string | Buffer} content - Text or binary content
 * @param {{ mode?: number, dirMode?: number }} [opts]
 */
export function atomicWriteFileSync(filePath, content, opts = {}) {
  const dir = dirname(filePath)
  const dirMode = opts.dirMode ?? 0o700
  const fileMode = opts.mode ?? 0o600

  mkdirSync(dir, { recursive: true, mode: dirMode })

  const base = basename(filePath)
  const nonce = `${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`
  const tmpPath = join(dir, `.${base}.${nonce}.tmp`)

  try {
    const fd = openSync(tmpPath, 'w', fileMode)
    try {
      const buffer = Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8')
      writeSync(fd, buffer, 0, buffer.length, 0)
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    chmodSync(tmpPath, fileMode)
    renameSync(tmpPath, filePath)
  } catch (error) {
    try {
      rmSync(tmpPath, { force: true })
    } catch {
      // ignore cleanup error
    }
    throw error
  }
}
