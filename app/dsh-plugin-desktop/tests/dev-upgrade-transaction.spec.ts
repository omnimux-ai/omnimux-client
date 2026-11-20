import { spawnSync } from 'node:child_process'
import { chmodSync, closeSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readlinkSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync, writeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { acceptDevUpgrade, inspectDevUpgrade, recoverDevFromArchive, upgradeDevWithRecovery } from '../src/dev-upgrade-transaction.ts'
import { MANAGED_GRAPH_ENTRIES } from '../src/managed-profile.ts'

const disposable: string[] = []
afterEach(() => {
  for (const root of disposable.splice(0)) rmSync(root, { recursive: true, force: true })
})

function makeFixture() {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'omnimux-nas-test-'))
  disposable.push(root)
  const paths = {
    appPath: join(root, 'OmniMux Dev.app'),
    homeDir: join(root, '.dev-home'),
    userDataDir: join(root, 'OmniMux Dev User Data'),
  }
  const profileDir = join(paths.homeDir, 'profiles', 'omnimux')
  const candidateApp = join(root, 'Test New Dev.app')
  const candidateDir = join(root, '.graph-candidate')
  const share = join(root, 'remote recovery')
  const recoveryDir = join(share, 'unique-batch')
  for (const directory of [paths.appPath, profileDir, paths.userDataDir, candidateApp, candidateDir, share]) {
    mkdirSync(directory, { recursive: true })
  }
  writeFileSync(join(paths.appPath, 'binary'), 'old-app')
  writeFileSync(join(candidateApp, 'binary'), 'new-app')
  writeFileSync(join(paths.homeDir, 'conversation'), 'original session')
  writeFileSync(join(paths.userDataDir, 'preferences'), 'original preferences')
  const packageFile = join(candidateDir, 'package.json')
  for (const location of [profileDir, candidateDir]) {
    for (const entry of MANAGED_GRAPH_ENTRIES) {
      const path = join(location, entry)
      if (entry === 'node_modules' || entry === '.materialize-snapshots') mkdirSync(path)
      else writeFileSync(path, location === profileDir ? 'old-graph' : 'new-graph')
    }
  }
  const hooks = {
    requireNetworkMount: (path: string) => expect(path).toBe(share),
    verifyApp: (path: string) => expect(existsSync(join(path, 'binary'))).toBe(true),
  }
  const graph = { candidateDir, entries: MANAGED_GRAPH_ENTRIES, verify: () => undefined as void }
  return {
    root, packageFile, paths, candidateApp, recoveryDir, profileDir, graph, hooks,
    confirmStopped: () => undefined as void,
  }
}

describe.skipIf(process.platform !== 'darwin')('macOS Dev archive cutover', () => {
  test('preflight is read-only and rejects a local recovery directory', () => {
    const fixture = makeFixture()
    expect(inspectDevUpgrade(fixture).recoveryDir).toBe(fixture.recoveryDir)
    expect(existsSync(fixture.recoveryDir)).toBe(false)
    expect(readdirSync(fixture.root).some(name => name.endsWith('-upgrade-control'))).toBe(false)
    expect(() => inspectDevUpgrade({ paths: fixture.paths, recoveryDir: fixture.recoveryDir })).toThrow(/mounted SMB or NFS/)
    expect(readFileSync(join(fixture.paths.appPath, 'binary'), 'utf8')).toBe('old-app')
  })

  test('keeps an accepted archive without allowing it to replace subsequent Dev work', async () => {
    const fixture = makeFixture()
    await upgradeDevWithRecovery(fixture)
    expect(readFileSync(join(fixture.paths.appPath, 'binary'), 'utf8')).toBe('new-app')
    expect(readFileSync(join(fixture.profileDir, 'package.json'), 'utf8')).toBe('new-graph')
    expect(readFileSync(join(fixture.paths.homeDir, 'conversation'), 'utf8')).toBe('original session')
    expect(readdirSync(fixture.root).some(name => name.startsWith('.omnimux-dev-candidate'))).toBe(false)
    expect(() => inspectDevUpgrade({ ...fixture, recoveryDir: fixture.recoveryDir + '-new' })).toThrow(/existing Dev upgrade/)
    acceptDevUpgrade(fixture)
    expect(existsSync(join(fixture.recoveryDir, 'appPath.tar'))).toBe(true)
    expect(() => inspectDevUpgrade(fixture)).toThrow(/already exists/)
    await expect(recoverDevFromArchive(fixture)).rejects.toThrow(/not the active Dev upgrade/)
  })

  test('restores interrupted publication, including files, permissions, hard links, symlinks, and xattrs', async () => {
    const fixture = makeFixture()
    const project = join(fixture.paths.homeDir, 'project')
    writeFileSync(project, 'original project')
    chmodSync(project, 0o751)
    symlinkSync('project', join(fixture.paths.homeDir, 'project-alias'))
    linkSync(project, join(fixture.paths.homeDir, 'project-hardlink'))
    expect(spawnSync('/usr/bin/xattr', ['-w', 'com.omnimux.test', 'metadata', project]).status).toBe(0)
    fixture.graph.verify = () => {
      expect(existsSync(fixture.paths.appPath)).toBe(false)
      throw new Error('injected publication failure')
    }
    await expect(upgradeDevWithRecovery(fixture)).rejects.toThrow(/injected publication failure/)

    rmSync(fixture.candidateApp, { recursive: true })
    writeFileSync(join(fixture.paths.userDataDir, 'preferences'), 'failed launch changed settings')
    let recoveryChecks = 0
    await recoverDevFromArchive({
      ...fixture,
      confirmStopped: () => {
        recoveryChecks++
        if (recoveryChecks === 3) {
          expect(existsSync(fixture.paths.appPath)).toBe(false)
          expect(readFileSync(join(fixture.profileDir, 'package.json'), 'utf8')).toBe('old-graph')
        }
      },
    })
    expect(recoveryChecks).toBe(3)
    await recoverDevFromArchive(fixture)
    expect(readFileSync(join(fixture.paths.appPath, 'binary'), 'utf8')).toBe('old-app')
    expect(readFileSync(join(fixture.profileDir, 'package.json'), 'utf8')).toBe('old-graph')
    expect(readFileSync(join(fixture.paths.userDataDir, 'preferences'), 'utf8')).toBe('original preferences')
    expect(lstatSync(project).mode & 0o777).toBe(0o751)
    expect(readlinkSync(join(fixture.paths.homeDir, 'project-alias'))).toBe('project')
    expect(lstatSync(join(fixture.paths.homeDir, 'project-hardlink')).ino).toBe(lstatSync(project).ino)
    expect(spawnSync('/usr/bin/xattr', ['-p', 'com.omnimux.test', project], { encoding: 'utf8' }).stdout.trim()).toBe('metadata')
  })

  test('leaves live state alone when NAS is unavailable before cutover', async () => {
    const fixture = makeFixture()
    const hooks = { ...fixture.hooks, requireNetworkMount: () => { throw new Error('synthetic NAS unavailable') } }
    await expect(upgradeDevWithRecovery({ ...fixture, hooks })).rejects.toThrow(/synthetic NAS unavailable/)
    expect(existsSync(fixture.recoveryDir)).toBe(false)
    expect(readFileSync(join(fixture.paths.appPath, 'binary'), 'utf8')).toBe('old-app')
    expect(readFileSync(join(fixture.profileDir, 'package.json'), 'utf8')).toBe('old-graph')
  })

  test('verifies and recovers sparse Chromium cache files', async () => {
    const fixture = makeFixture()
    const path = join(fixture.paths.userDataDir, 'chromium-cache')
    const offset = 2 * 1024 * 1024
    const tail = Buffer.from('cache payload')
    const descriptor = openSync(path, 'wx', 0o600)
    try {
      writeSync(descriptor, tail, 0, tail.length, offset)
    } finally {
      closeSync(descriptor)
    }
    const original = readFileSync(path)
    expect(original.length).toBe(offset + tail.length)
    await upgradeDevWithRecovery(fixture)
    writeFileSync(path, 'changed by the new process')
    await recoverDevFromArchive(fixture)
    expect(readFileSync(path).equals(original)).toBe(true)
    expect(lstatSync(path).mode & 0o777).toBe(0o600)
  })

  test('rejects a changed NAS archive before replacing any live path', async () => {
    const fixture = makeFixture()
    let checks = 0
    const confirmStopped = () => {
      checks++
      if (checks === 3) writeFileSync(join(fixture.recoveryDir, 'appPath.tar'), 'changed verified archive')
    }
    await expect(upgradeDevWithRecovery({ ...fixture, confirmStopped })).rejects.toThrow(/archive changed before cutover/)
    expect(readFileSync(join(fixture.paths.appPath, 'binary'), 'utf8')).toBe('old-app')
    expect(readFileSync(join(fixture.profileDir, 'package.json'), 'utf8')).toBe('old-graph')
  })

  test('rejects a corrupted archive before restoring any live path', async () => {
    const fixture = makeFixture()
    await upgradeDevWithRecovery(fixture)
    writeFileSync(join(fixture.recoveryDir, 'userDataDir.tar'), 'unreadable archive')
    await expect(recoverDevFromArchive(fixture)).rejects.toThrow(/archive checksum/)
    expect(readFileSync(join(fixture.paths.appPath, 'binary'), 'utf8')).toBe('new-app')
    expect(readFileSync(join(fixture.profileDir, 'package.json'), 'utf8')).toBe('new-graph')
  })
})
