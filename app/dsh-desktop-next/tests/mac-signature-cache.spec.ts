import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { chmod, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MacSignatureCache, signatureCacheKey, type MacSignaturePolicy } from '../scripts/mac-signature-cache.ts'
import { preSignedIgnore, unpackedMachOFiles } from '../scripts/sign-packaged.ts'
import { isThinMachOExecutable } from '../scripts/primary-runtime.ts'

const directories: string[] = []
const policy: MacSignaturePolicy = {
  mode: 'developer-id-hardened-timestamped', leafSha256: 'fixture-certificate', identifier: 'example.tool', entitlementsSha256: 'fixture-plist',
  codesignSha256: 'fixture-codesign', policySha256: 'fixture-script', macOSVersion: 'fixture-os',
}

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'next-signature-cache-'))
  directories.push(directory)
  return { directory, file: join(directory, 'binary'), cacheDir: join(directory, 'cache') }
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

it('addresses files by their bytes, file mode and all signing policy inputs', () => {
  const original = signatureCacheKey('file', 0o755, policy)
  expect(signatureCacheKey('changed file', 0o755, policy)).not.toBe(original)
  expect(signatureCacheKey('file', 0o644, policy)).not.toBe(original)
  for (const key of Object.keys(policy) as Array<keyof MacSignaturePolicy>) {
    expect(signatureCacheKey('file', 0o755, { ...policy, [key]: 'other value' })).not.toBe(original)
  }
})

describe.skipIf(process.platform === 'win32')('macOS signing cache', () => {
  it('restores a verified cache hit atomically and re-signs corrupt or rejected entries', async () => {
    const { file, cacheDir } = fixture()
    const cache = new MacSignatureCache(cacheDir)
    const sign = vi.fn(async (candidate: string) => writeFileSync(candidate, 'signed input'))
    const verify = vi.fn(async (candidate: string) => {
      expect(readFileSync(candidate, 'utf8')).toBe('signed input')
      expect(readFileSync(file, 'utf8')).toBe('input')
    })
    const restoreInput = () => {
      writeFileSync(file, 'input')
      chmodSync(file, 0o755)
    }
    await cache.prepare()
    restoreInput()
    await cache.sign(file, policy, sign, verify)
    const entry = join(cacheDir, readdirSync(cacheDir)[0]!)
    restoreInput()
    await cache.sign(file, policy, sign, verify)
    expect(cache).toMatchObject({ hits: 1, misses: 1 })
    expect(sign).toHaveBeenCalledTimes(1)
    expect(verify).toHaveBeenCalledTimes(2)
    expect(statSync(file).mode & 0o777).toBe(0o755)
    expect(readFileSync(file, 'utf8')).toBe('signed input')

    restoreInput()
    await cache.sign(file, policy, sign, verify.mockRejectedValueOnce(new Error('signature policy mismatch')))
    writeFileSync(entry, 'truncated cache entry')
    restoreInput()
    await cache.sign(file, policy, sign, verify)
    expect(cache).toMatchObject({ hits: 1, misses: 3, rejected: 2 })

    restoreInput()
    await expect(cache.sign(file, { ...policy, identifier: 'another.tool' }, sign.mockRejectedValueOnce(new Error('TSA unavailable')), verify)).rejects.toThrow('TSA unavailable')
    expect(readFileSync(file, 'utf8')).toBe('input')
    expect(readdirSync(cacheDir)).toHaveLength(1)
  })

  const inputChanges = [
    { change: 'bytes', update: (file: string) => writeFile(file, 'replacement'), contents: 'replacement', mode: 0o755 },
    { change: 'mode', update: (file: string) => chmod(file, 0o644), contents: 'input', mode: 0o644 },
  ]

  it.each(inputChanges)('preserves changed input $change during cold signing', async ({ update, contents, mode }) => {
    const { directory, file, cacheDir } = fixture()
    const cache = new MacSignatureCache(cacheDir)
    await cache.prepare()
    writeFileSync(file, 'input', { mode: 0o755 })
    const sign = vi.fn(async (candidate: string) => {
      expect(readFileSync(candidate, 'utf8')).toBe('input')
      expect(statSync(candidate).mode & 0o777).toBe(0o755)
      await writeFile(candidate, 'signed input')
      await update(file)
    })

    await expect(cache.sign(file, policy, sign, async () => {})).rejects.toThrow('input changed during signing')
    expect(sign).toHaveBeenCalledTimes(1)
    expect(cache).toMatchObject({ hits: 0, misses: 1 })
    expect(readFileSync(file, 'utf8')).toBe(contents)
    expect(statSync(file).mode & 0o777).toBe(mode)
    expect(readdirSync(directory).sort()).toEqual(['binary', 'cache'])
  })

  it.each(inputChanges)('preserves changed input $change during cached signature verification', async ({ update, contents, mode }) => {
    const { directory, file, cacheDir } = fixture()
    const cache = new MacSignatureCache(cacheDir)
    await cache.prepare()
    writeFileSync(file, 'input', { mode: 0o755 })
    const sign = vi.fn(async (candidate: string) => writeFile(candidate, 'signed input'))
    await cache.sign(file, policy, sign, async () => {})
    writeFileSync(file, 'input')
    const verify = vi.fn(async (candidate: string) => {
      expect(readFileSync(candidate, 'utf8')).toBe('signed input')
      await update(file)
    })

    await expect(cache.sign(file, policy, sign, verify)).rejects.toThrow('input changed during signing')
    expect(sign).toHaveBeenCalledTimes(1)
    expect(verify).toHaveBeenCalledTimes(1)
    expect(cache).toMatchObject({ hits: 1, misses: 1, rejected: 0 })
    expect(readFileSync(file, 'utf8')).toBe(contents)
    expect(statSync(file).mode & 0o777).toBe(mode)
    expect(readdirSync(directory).sort()).toEqual(['binary', 'cache'])
  })

  it('touches read entries and evicts the least recently used verified signature', async () => {
    const { file, cacheDir } = fixture()
    const cache = new MacSignatureCache(cacheDir, 100)
    const sign = async (candidate: string) => writeFileSync(candidate, 'signed!')
    const verify = async () => {}
    await cache.prepare()
    const save = async (id: string) => {
      writeFileSync(file, 'input')
      await cache.sign(file, { ...policy, identifier: id }, sign, verify)
    }
    await save('one')
    const older = join(cacheDir, readdirSync(cacheDir)[0]!)
    utimesSync(older, 1000, 1000)
    await save('two')
    const lessRecent = join(cacheDir, readdirSync(cacheDir).find(name => join(cacheDir, name) !== older)!)
    utimesSync(lessRecent, 2000, 2000)
    await save('one')
    await save('three')
    await cache.prune()
    expect(cache).toMatchObject({ hits: 1, misses: 3, evicted: 1 })
    expect(readdirSync(cacheDir)).toHaveLength(2)
    expect(readFileSync(older).subarray(32).toString()).toBe('signed!')
    expect(() => statSync(lessRecent)).toThrow()
  })
})

it('selects standalone Mach-O and bypasses Builder only for exact verified paths', () => {
  const { directory } = fixture()
  const execute = join(directory, 'spawn-helper')
  const native = join(directory, 'sample.node')
  writeFileSync(execute, Buffer.from('cffaedfe0c0000010000000002000000', 'hex'))
  writeFileSync(native, Buffer.from('cffaedfe0c0000010000000008000000', 'hex'))
  writeFileSync(join(directory, 'shell-script'), '#!/bin/sh\n', { mode: 0o755 })
  const nestedBundle = join(directory, 'Nested.app')
  mkdirSync(nestedBundle)
  writeFileSync(join(nestedBundle, 'sample.node'), readFileSync(native))
  expect(unpackedMachOFiles(directory).sort()).toEqual(['sample.node', 'spawn-helper'])
  expect(isThinMachOExecutable(execute)).toBe(true)
  expect(isThinMachOExecutable(native)).toBe(false)
  const ignore = preSignedIgnore((path: string) => path.endsWith('.pak'), new Set([native]))
  expect(ignore(native)).toBe(true)
  expect(ignore(execute)).toBe(false)
  expect(ignore(join(nestedBundle, 'sample.node'))).toBe(false)
  expect(ignore(join(directory, 'resource.pak'))).toBe(true)
})
