import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute } from 'node:path'
import { VideoError } from '../errors.js'

/**
 * Resolve the Hub-owned `headlessSkill` seam. Plugins never reach `ctx.llm`
 * themselves (enforced by `verify-plugin-boundaries`); this is the only
 * background-inference entry, and it may be unmounted in isolated unit tests.
 *
 * @param {unknown} source direct service, getter, or plugin ctx
 * @returns {{ run: (request: object) => Promise<any> } | undefined}
 */
export function resolveHeadlessSkill(source) {
  const candidate = typeof source === 'function' ? source() : source
  if (candidate && typeof candidate === 'object' && typeof candidate.run === 'function') {
    return /** @type {{ run: (request: object) => Promise<any> }} */ (candidate)
  }
  return undefined
}

/**
 * Write an absolute `dest` file, creating parent directories.
 *
 * @param {string} dest
 * @param {string} body
 */
export async function writeDest(dest, body) {
  const target = String(dest || '').trim()
  if (!isAbsolute(target)) {
    throw new VideoError('video-invalid-input', 'dest path must be absolute')
  }
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, body, 'utf8')
}
