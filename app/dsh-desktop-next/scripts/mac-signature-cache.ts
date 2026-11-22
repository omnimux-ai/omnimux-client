/** A private cache of verified Developer ID signatures for standalone Mach-O files. */
import { createHash, randomUUID } from 'node:crypto'
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, renameSync } from 'node:fs'
import { chmod, lstat, mkdir, mkdtemp, open, readFile, readdir, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

const CACHE_LIMIT_BYTES = 1024 ** 3
const DIGEST_BYTES = 32
const CACHE_ENTRY = /^[a-f0-9]{64}$/u

export interface MacSignaturePolicy {
  readonly mode: 'developer-id-hardened-timestamped'
  readonly leafSha256: string
  readonly identifier: string
  readonly entitlementsSha256: string | null
  readonly codesignSha256: string
  readonly policySha256: string
  readonly macOSVersion: string
}

export function signatureCacheKey(contentSha256: string, fileMode: number, policy: MacSignaturePolicy): string {
  return createHash('sha256').update(JSON.stringify([
    contentSha256, fileMode, policy.mode, policy.leafSha256, policy.identifier, policy.entitlementsSha256,
    policy.codesignSha256, policy.policySha256, policy.macOSVersion,
  ])).digest('hex')
}

function entryDigest(key: string, body: Buffer): Buffer {
  return createHash('sha256').update(key).update(body).digest()
}

function readSigningInput(file: string): { bytes: Buffer; sha256: string; mode: number } {
  const input = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const opened = fstatSync(input)
    if (!opened.isFile()) throw new Error('macOS signing cache requires a regular Mach-O file')
    const bytes = readFileSync(input)
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const current = lstatSync(file)
    if (current.dev !== opened.dev || current.ino !== opened.ino || current.mode !== opened.mode
      || current.size !== opened.size || current.size !== bytes.length
      || current.mtimeMs !== opened.mtimeMs || current.ctimeMs !== opened.ctimeMs) {
      throw new Error(`macOS signing cache: input changed while reading ${file}`)
    }
    return { bytes, sha256, mode: opened.mode & 0o7777 }
  } finally { closeSync(input) }
}

export class MacSignatureCache {
  readonly directory: string
  readonly limit: number
  hits = 0
  misses = 0
  rejected = 0
  evicted = 0

  constructor(directory: string, limit = CACHE_LIMIT_BYTES) {
    this.directory = directory
    this.limit = limit
  }

  async prepare(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    const stat = await lstat(this.directory)
    if (!stat.isDirectory() || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0) {
      throw new Error('The macOS signing cache must be a private directory owned by the build user.')
    }
  }

  /** Sign or restore a sibling copy, then replace the input only if it still matches the snapshot. */
  async sign(file: string, policy: MacSignaturePolicy, sign: (candidate: string) => Promise<void>, verify: (candidate: string) => Promise<void>, reusable = true): Promise<void> {
    const { bytes, sha256, mode } = readSigningInput(file)
    const key = reusable && bytes.length + DIGEST_BYTES <= this.limit
      ? signatureCacheKey(sha256, mode, policy)
      : undefined
    const stage = await mkdtemp(join(dirname(file), '.presigned-'))
    const candidate = join(stage, basename(file))
    try {
      if (key !== undefined && await this.#restore(candidate, key, mode, verify)) {
        this.hits++
      } else {
        this.misses++
        await writeFile(candidate, bytes, { mode, flag: 'wx' })
        await chmod(candidate, mode)
        await sign(candidate)
        await verify(candidate)
        if (key !== undefined) await this.#store(key, candidate)
      }
      // Keep revalidation and replacement in the same synchronous turn as in pinned DSH.
      const current = readSigningInput(file)
      if (current.sha256 !== sha256 || current.mode !== mode) {
        throw new Error(`macOS signing cache: input changed during signing: ${file}`)
      }
      renameSync(candidate, file)
    } finally { await rm(stage, { recursive: true, force: true }) }
  }

  async #restore(candidate: string, key: string, mode: number, verify: (candidate: string) => Promise<void>): Promise<boolean> {
    const entry = await open(join(this.directory, key), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK).catch(() => undefined)
    if (entry === undefined) return false
    try {
      const stat = await entry.stat()
      if (!stat.isFile() || stat.size <= DIGEST_BYTES || stat.size > this.limit) throw new Error('Invalid signing cache entry')
      const bytes = await entry.readFile()
      const body = bytes.subarray(DIGEST_BYTES)
      if (!entryDigest(key, body).equals(bytes.subarray(0, DIGEST_BYTES))) throw new Error('Invalid signing cache digest')
      await writeFile(candidate, body, { mode, flag: 'wx' })
      await chmod(candidate, mode)
      await verify(candidate)
      const now = new Date()
      await entry.utimes(now, now).catch(() => {})
      return true
    } catch {
      this.rejected++
      await rm(candidate, { force: true })
      return false
    } finally { await entry.close() }
  }

  async #store(key: string, file: string): Promise<void> {
    if ((await lstat(file)).size + DIGEST_BYTES > this.limit) return
    const pending = join(this.directory, `.pending-${randomUUID()}`)
    try {
      const bytes = await readFile(file)
      const entry = await open(pending, 'wx', 0o600)
      try {
        await entry.writeFile(entryDigest(key, bytes))
        await entry.writeFile(bytes)
      } finally { await entry.close() }
      // Readers only see complete entries. Concurrent signers may replace this entry with another verified signature.
      await rename(pending, join(this.directory, key))
    } finally { await rm(pending, { force: true }) }
  }

  /** Trim least recently used entries after all local workers settle. Other builds may evict concurrently. */
  async prune(): Promise<void> {
    const entries = []
    for (const name of await readdir(this.directory)) {
      if (!CACHE_ENTRY.test(name)) continue
      const path = join(this.directory, name)
      const stat = await lstat(path).catch(() => undefined)
      if (stat?.isFile() === true) entries.push({ path, stat })
    }
    let bytes = entries.reduce((sum, entry) => sum + entry.stat.size, 0)
    for (const { path, stat } of entries.sort((a, b) => a.stat.mtimeMs - b.stat.mtimeMs)) {
      if (bytes <= this.limit) break
      try {
        await unlink(path)
        this.evicted++
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      bytes -= stat.size
    }
  }
}
