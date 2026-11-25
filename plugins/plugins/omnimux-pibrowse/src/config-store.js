import { randomUUID } from 'node:crypto'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { PibrowseError } from './errors.js'
import { validateUserPath } from './paths.js'

const DEFAULT_CONFIG = Object.freeze({
  version: 1,
  agentPath: null,
  corePath: null,
  geoipPath: null,
  teamServerUrl: null,
  machineId: null,
  rememberOrgKey: false,
  orkGenerationsByServer: {},
  autoStartSidecar: true,
})

/**
 * Atomic JSON write using tmp file + rename with restricted `0600` file mode.
 * @param {string} filePath
 * @param {unknown} data
 */
export async function writeJsonAtomic(filePath, data) {
  const dir = dirname(filePath)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const tmpPath = join(dir, `.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`)
  const text = `${JSON.stringify(data, null, 2)}\n`
  await writeFile(tmpPath, text, { encoding: 'utf8', mode: 0o600 })
  await rename(tmpPath, filePath)
}

/**
 * Async configuration store under `$DSH_HOME/omnimux/pibrowse/config.json`.
 * Zero synchronous filesystem I/O so the Host event loop is never blocked.
 *
 * @param {{ configFile: string, logger?: { warn?: Function } }} opts
 */
export function createConfigStore(opts) {
  let cache = null
  let writeChain = Promise.resolve()

  async function load() {
    if (cache) return structuredClone(cache)
    let parsed = null
    try {
      const raw = await readFile(opts.configFile, 'utf8')
      parsed = JSON.parse(raw)
    } catch (err) {
      if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
        parsed = null
      } else {
        opts.logger?.warn?.('omnimux-pibrowse: failed to parse config.json, resetting defaults', {
          error: err instanceof Error ? err.message : String(err),
        })
        parsed = null
      }
    }
    const merged = {
      ...DEFAULT_CONFIG,
      ...(parsed && typeof parsed === 'object' ? parsed : {}),
      orkGenerationsByServer: {
        ...(parsed && typeof parsed.orkGenerationsByServer === 'object' && parsed.orkGenerationsByServer
          ? parsed.orkGenerationsByServer
          : {}),
      },
    }
    if (!merged.machineId || typeof merged.machineId !== 'string') {
      merged.machineId = randomUUID()
    }
    cache = merged
    return structuredClone(cache)
  }

  /**
   * Patch config atomically in serialized order.
   * @param {Record<string, unknown>} patch
   */
  function update(patch) {
    const run = writeChain.then(async () => {
      const current = await load()
      const next = { ...current }
      if ('agentPath' in patch) {
        next.agentPath = patch.agentPath === null || patch.agentPath === ''
          ? null
          : validateUserPath(patch.agentPath, { label: 'agentPath' })
      }
      if ('corePath' in patch) {
        next.corePath = patch.corePath === null || patch.corePath === ''
          ? null
          : validateUserPath(patch.corePath, { label: 'corePath' })
      }
      if ('geoipPath' in patch) {
        next.geoipPath = patch.geoipPath === null || patch.geoipPath === ''
          ? null
          : validateUserPath(patch.geoipPath, { label: 'geoipPath' })
      }
      if ('teamServerUrl' in patch) {
        if (patch.teamServerUrl === null || patch.teamServerUrl === '') {
          next.teamServerUrl = null
        } else if (typeof patch.teamServerUrl === 'string') {
          next.teamServerUrl = patch.teamServerUrl.trim()
        } else {
          throw new PibrowseError('invalid-url', 'teamServerUrl must be a string or null')
        }
      }
      if ('rememberOrgKey' in patch) {
        next.rememberOrgKey = Boolean(patch.rememberOrgKey)
      }
      if ('autoStartSidecar' in patch) {
        next.autoStartSidecar = Boolean(patch.autoStartSidecar)
      }
      if ('orkGenerationsByServer' in patch && patch.orkGenerationsByServer && typeof patch.orkGenerationsByServer === 'object') {
        next.orkGenerationsByServer = {
          ...current.orkGenerationsByServer,
          ...patch.orkGenerationsByServer,
        }
      }
      await writeJsonAtomic(opts.configFile, next)
      cache = next
      return structuredClone(next)
    })
    writeChain = run.catch(() => {})
    return run
  }

  /**
   * Monotonic org key generation high-water mark per Team Server (anti-rollback).
   * @param {string} serverUrl
   * @param {number} generation
   */
  async function assertAndRecordOrkGeneration(serverUrl, generation) {
    if (!Number.isInteger(generation) || generation < 1) {
      throw new PibrowseError('invalid-input', `Invalid key generation: ${String(generation)}`)
    }
    const current = await load()
    const seen = Number(current.orkGenerationsByServer?.[serverUrl] || 0)
    if (seen > 0 && generation < seen) {
      throw new PibrowseError(
        'rollback-detected',
        `Server returned older key generation ${generation} than previously seen ${seen}`,
        { seen, received: generation, serverUrl },
      )
    }
    if (generation > seen) {
      await update({
        orkGenerationsByServer: { [serverUrl]: generation },
      })
    }
    return generation
  }

  return {
    load,
    update,
    assertAndRecordOrkGeneration,
  }
}
