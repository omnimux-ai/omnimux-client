import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { assertReleaseSource, releaseMac, type MacReleaseOptions } from '../scripts/release-mac.ts'

const DEVELOPER_ID_OUTPUT = `
  1) 0123456789ABCDEF "Developer ID Application: Mengxin Yang (TEAM123456)"
     1 valid identities found
`

interface CommandCall {
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly env: NodeJS.ProcessEnv
}

function baseOptions(
  env: NodeJS.ProcessEnv,
  calls: CommandCall[],
  identityEnvironments: NodeJS.ProcessEnv[] = [],
  logs: string[] = [],
): MacReleaseOptions {
  return {
    env,
    platform: 'darwin',
    desktopRoot: '/repo/dsh-plugin-desktop',
    outputDir: '/repo/dsh-plugin-desktop/dist/mac-release',
    releaseArch: 'universal',
    resetOutput: () => undefined,
    listCodeSigningIdentities: identityEnv => {
      identityEnvironments.push({ ...identityEnv })
      return DEVELOPER_ID_OUTPUT
    },
    run: (command, args, cwd, commandEnv) => {
      calls.push({ command, args: [...args], cwd, env: { ...commandEnv } })
    },
    log: message => logs.push(message),
    prepareRuntime: () => undefined,
    verifySource: () => undefined,
  }
}

describe('macOS release command boundary', () => {
  it('runs checks without credentials, then gives credentials only to the DMG builder', () => {
    const calls: CommandCall[] = []
    const identityEnvironments: NodeJS.ProcessEnv[] = []
    const logs: string[] = []
    const resetOutput = vi.fn()
    const prepareRuntime = vi.fn()
    const appPassword = 'notary-password-that-must-not-be-logged'

    releaseMac({
      ...baseOptions({
        PATH: '/usr/bin',
        SAFE_BUILD_VALUE: 'kept',
        APPLE_ID: 'developer@example.test',
        APPLE_APP_SPECIFIC_PASSWORD: appPassword,
        APPLE_TEAM_ID: 'TEAM123456',
      }, calls, identityEnvironments, logs),
      resetOutput,
      prepareRuntime,
    })

    expect(resetOutput).toHaveBeenCalledOnce()
    expect(prepareRuntime).toHaveBeenCalledOnce()
    expect(identityEnvironments).toEqual([{ PATH: '/usr/bin', SAFE_BUILD_VALUE: 'kept' }])
    expect(calls).toHaveLength(5)
    expect(calls[0]).toEqual({
      command: process.execPath,
      args: ['scripts/prepare-agents-anywhere-release.mjs', '--verify-release'],
      cwd: resolve('/repo/dsh-plugin-desktop', '..'),
      env: { PATH: '/usr/bin', SAFE_BUILD_VALUE: 'kept' },
    })
    expect(calls[1]).toEqual({
      command: process.execPath,
      args: ['scripts/prepare-dsh-market.mjs', '--check'],
      cwd: resolve('/repo/dsh-plugin-desktop', '..'),
      env: { PATH: '/usr/bin', SAFE_BUILD_VALUE: 'kept' },
    })
    expect(calls[2]).toEqual({
      command: 'yarn',
      args: ['run', 'check'],
      cwd: resolve('/repo/dsh-plugin-desktop', '..'),
      env: { PATH: '/usr/bin', SAFE_BUILD_VALUE: 'kept' },
    })
    expect(calls[3]).toEqual({
      command: 'yarn',
      args: [
        'exec', 'electron-builder', '--mac', 'dmg', '--universal',
        '--config.forceCodeSigning=true', '--config.mac.notarize=true',
        '--config.npmRebuild=false', '--publish', 'never',
        '--config.directories.output=/repo/dsh-plugin-desktop/dist/mac-release',
      ],
      cwd: '/repo/dsh-plugin-desktop',
      env: {
        PATH: '/usr/bin',
        SAFE_BUILD_VALUE: 'kept',
        APPLE_ID: 'developer@example.test',
        APPLE_APP_SPECIFIC_PASSWORD: appPassword,
        APPLE_TEAM_ID: 'TEAM123456',
        DSH_BUILD_CHANNEL: 'release',
        DSH_RELEASE_BUILD: '1',
        DSH_ELECTRON_BUILDER_TRAVERSAL_ONLY: '1',
      },
    })
    expect(calls[4]).toEqual({
      command: process.execPath,
      args: [
        'scripts/verify-mac-release.ts',
        '/repo/dsh-plugin-desktop/dist/mac-release',
      ],
      cwd: '/repo/dsh-plugin-desktop',
      env: { PATH: '/usr/bin', SAFE_BUILD_VALUE: 'kept' },
    })
    expect(logs).toHaveLength(2)
    expect(logs[0]).toContain('signing via keychain; notarization via apple-id')
    expect(logs[0]).not.toContain(appPassword)
    expect(logs[1]).toContain('macOS release target: universal')
    expect(logs[1]).not.toContain(appPassword)
  })

  it('adapts the existing P12 variables only for electron-builder', () => {
    const calls: CommandCall[] = []
    const p12Password = 'p12-password-that-must-not-be-logged'
    const p12 = Buffer.from([0x30, 0x03, 0x02, 0x01, 0x00]).toString('base64')
    const options: MacReleaseOptions = {
      ...baseOptions({
        PATH: '/usr/bin',
        APPLE_API_KEY: '/private/AuthKey.p8',
        APPLE_API_KEY_ID: 'KEY123',
        APPLE_API_ISSUER: 'issuer-id',
        CSC_KEY_PASSWORD: p12Password,
        MAC_CERT_P12_BASE64: p12,
        MACOS_SIGN_IDENTITY: 'Developer ID Application: Mengxin Yang (TEAM123456)',
      }, calls),
      listCodeSigningIdentities: () => {
        throw new Error('P12 signing must not depend on a Keychain identity')
      },
    }

    releaseMac(options)

    expect(calls).toHaveLength(5)
    expect(calls[2]?.env).toEqual({ PATH: '/usr/bin' })
    expect(calls[3]?.env.CSC_LINK).toBe(`data:application/x-pkcs12;base64,${p12}`)
    expect(calls[3]?.env.CSC_NAME).toBe('Mengxin Yang (TEAM123456)')
    expect(calls[3]?.env.CSC_KEY_PASSWORD).toBe(p12Password)
    expect(calls[3]?.env.DSH_BUILD_CHANNEL).toBe('release')
    expect(calls[3]?.env.DSH_RELEASE_BUILD).toBe('1')
    expect(calls[3]?.env.MAC_CERT_P12_BASE64).toBeUndefined()
    expect(calls[3]?.env.MACOS_SIGN_IDENTITY).toBeUndefined()
    expect(calls[3]?.env.DSH_ELECTRON_BUILDER_TRAVERSAL_ONLY).toBe('1')
    expect(calls[4]?.env).toEqual({ PATH: '/usr/bin' })
  })

  it('rejects development signing before running any command', () => {
    const calls: CommandCall[] = []
    const options = baseOptions({
      APPLE_KEYCHAIN_PROFILE: 'dsh-notary',
      CSC_NAME: 'Apple Development: Developer (TEAM123456)',
    }, calls)

    expect(() => releaseMac(options)).toThrow('Developer ID Application')
    expect(calls).toEqual([])
  })

  it('does not clear output or build when AA freshness verification fails', () => {
    const calls: CommandCall[] = []
    const resetOutput = vi.fn()
    const options: MacReleaseOptions = {
      ...baseOptions({
        APPLE_KEYCHAIN_PROFILE: 'dsh-notary',
      }, calls),
      resetOutput,
      run: (command, args, cwd, commandEnv) => {
        calls.push({ command, args: [...args], cwd, env: { ...commandEnv } })
        throw new Error('AA release check failed')
      },
    }

    expect(() => releaseMac(options)).toThrow('AA release check failed')
    expect(calls).toHaveLength(1)
    expect(calls[0]?.args).toEqual(['scripts/prepare-agents-anywhere-release.mjs', '--verify-release'])
    expect(calls[0]?.cwd).toBe(resolve('/repo/dsh-plugin-desktop', '..'))
    expect(resetOutput).not.toHaveBeenCalled()
  })
})

describe('release source guard', () => {
  const roots: string[] = []

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  function makeRepo(): { root: string; work: string; appDir: string } {
    const root = mkdtempSync(join(tmpdir(), 'omnimux-release-source-'))
    roots.push(root)
    const remote = join(root, 'remote.git')
    execFileSync('git', ['init', '--bare', '--quiet', remote])
    const work = join(root, 'work')
    mkdirSync(work)
    execFileSync('git', ['init', '--quiet', '-b', 'main'], { cwd: work })
    execFileSync('git', ['config', 'user.email', 'release@example.test'], { cwd: work })
    execFileSync('git', ['config', 'user.name', 'Release Test'], { cwd: work })
    writeFileSync(join(work, 'tracked.txt'), 'clean\n')
    execFileSync('git', ['add', '.'], { cwd: work })
    execFileSync('git', ['commit', '--quiet', '-m', 'initial'], { cwd: work })
    execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: work })
    execFileSync('git', ['push', '--quiet', '-u', 'origin', 'main'], { cwd: work })
    const appDir = join(work, 'app')
    mkdirSync(appDir, { recursive: true })
    return { root, work, appDir }
  }

  it('accepts a real clean origin/main checkout', () => {
    const { work } = makeRepo()
    expect(() => assertReleaseSource(work)).not.toThrow()
  })

  it('rejects a dirty tree before any build command runs', () => {
    const { work, appDir } = makeRepo()
    mkdirSync(join(appDir, 'dsh-desktop-next'), { recursive: true })
    writeFileSync(join(work, 'tracked.txt'), 'dirty\n')
    const calls: CommandCall[] = []
    const { verifySource, ...base } = baseOptions({ APPLE_KEYCHAIN_PROFILE: 'dsh-notary' }, calls)
    void verifySource
    const options: MacReleaseOptions = {
      ...base,
      desktopRoot: join(appDir, 'dsh-desktop-next'),
    }
    expect(() => releaseMac(options)).toThrow('dirty')
    expect(calls).toEqual([])
  })

  it('runs the default source check before building a clean checkout', () => {
    const { appDir } = makeRepo()
    mkdirSync(join(appDir, 'dsh-desktop-next'), { recursive: true })
    const calls: CommandCall[] = []
    const { verifySource, ...base } = baseOptions({ APPLE_KEYCHAIN_PROFILE: 'dsh-notary' }, calls)
    void verifySource
    const options: MacReleaseOptions = {
      ...base,
      desktopRoot: join(appDir, 'dsh-desktop-next'),
    }
    expect(() => releaseMac(options)).not.toThrow()
    expect(calls).toHaveLength(5)
  })
})
