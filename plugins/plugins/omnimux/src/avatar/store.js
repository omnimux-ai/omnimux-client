/** Per-profile avatar overrides, one JSON document under $DSH_HOME/omnimux. */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * @param {string} home
 */
export function avatarFile(home) {
  return join(home, 'omnimux', 'avatar.json')
}

/**
 * File-backed map of profile id → avatar overrides. Same write discipline as
 * the apps catalog cache: 0o700 dir, 0o600 file, whole-document rewrite.
 * @param {{ home: string }} deps
 */
export function createAvatarStore(deps) {
  const path = avatarFile(deps.home)
  const dir = join(deps.home, 'omnimux')

  function readAll() {
    try {
      const raw = JSON.parse(readFileSync(path, 'utf8'))
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) return /** @type {Record<string, Record<string, unknown>>} */ (raw)
    } catch {
      // absent or corrupt — treat as empty
    }
    return {}
  }

  function writeAll(doc) {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    writeFileSync(path, `${JSON.stringify(doc, undefined, 2)}\n`, { mode: 0o600 })
  }

  /**
   * @param {string} id
   * @returns {Record<string, unknown> | undefined}
   */
  function read(id) {
    const row = readAll()[id]
    if (row && typeof row === 'object' && !Array.isArray(row)) return row
    return undefined
  }

  /**
   * Deep-merges the patch into the profile's row and persists. A patch value
   * of null removes that key.
   * @param {string} id
   * @param {Record<string, unknown>} patch
   * @returns {Record<string, unknown>}
   */
  function update(id, patch) {
    const doc = readAll()
    const current = doc[id] && typeof doc[id] === 'object' && !Array.isArray(doc[id])
      ? { ...doc[id] }
      : {}
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) delete current[key]
      else current[key] = value
    }
    doc[id] = current
    writeAll(doc)
    return current
  }

  /**
   * @param {string} id
   */
  function reset(id) {
    const doc = readAll()
    delete doc[id]
    writeAll(doc)
  }

  return { read, update, reset, path }
}
