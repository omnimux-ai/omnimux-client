import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { writeAppBuildInfo } from '../scripts/build-info.mjs'
import { verifyAppBuildInfo } from '../scripts/verify-build-info.ts'

const roots: string[] = []

function makeRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'omnimux-build-info-'))
  roots.push(root)
  execFileSync('git', ['init', '--quiet'], { cwd: root })
  execFileSync('git', ['config', 'user.email', 'release@example.test'], { cwd: root })
  execFileSync('git', ['config', 'user.name', 'Release Test'], { cwd: root })
  mkdirSync(join(root, 'dsh-desktop-next'), { recursive: true })
  writeFileSync(join(root, 'dsh-desktop-next', 'package.json'), JSON.stringify({ name: 'dsh-desktop-next', version: '9.9.9' }))
  writeFileSync(join(root, 'tracked.txt'), 'clean\n')
  execFileSync('git', ['add', '.'], { cwd: root })
  execFileSync('git', ['commit', '--quiet', '-m', 'initial'], { cwd: root })
  execFileSync('git', ['update-ref', 'refs/remotes/origin/main', 'HEAD'], { cwd: root })
  return root
}

function makeApp(root: string): string {
  const appPath = join(root, 'OmniMux.app')
  mkdirSync(join(appPath, 'Contents', 'Resources'), { recursive: true })
  return appPath
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('release build-info verification', () => {
  it('accepts a clean origin/main build with the expected version', () => {
    const root = makeRepo()
    const appPath = makeApp(root)
    writeAppBuildInfo(appPath, 'release', { repoRoot: root, packageDir: 'dsh-desktop-next' })
    const info = verifyAppBuildInfo(appPath, { repoRoot: root, packageDir: 'dsh-desktop-next' })
    expect(info.repo?.dirty).toBe(false)
    expect(info.version).toBe('9.9.9')
  })

  it('rejects a dirty build tree', () => {
    const root = makeRepo()
    const appPath = makeApp(root)
    writeAppBuildInfo(appPath, 'release', { repoRoot: root, packageDir: 'dsh-desktop-next' })
    writeFileSync(join(root, 'tracked.txt'), 'dirty\n')
    expect(() => verifyAppBuildInfo(appPath, { repoRoot: root, packageDir: 'dsh-desktop-next' })).toThrow('dirty')
  })
})

describe('build-info provenance safety', () => {
  it('never records remote URLs or credentials', () => {
    const root = makeRepo()
    const fakeCredential = ['fake', 'credential'].join('-')
    execFileSync('git', ['remote', 'add', 'origin', `https://fakeuser:${fakeCredential}@private.example.test/secret/repo.git`], { cwd: root })
    const appPath = makeApp(root)
    writeAppBuildInfo(appPath, 'release', { repoRoot: root, packageDir: 'dsh-desktop-next' })
    const serialized = readFileSync(join(appPath, 'Contents', 'Resources', 'build-info.json'), 'utf8')
    expect(serialized).not.toContain('private.example.test')
    expect(serialized).not.toContain(fakeCredential)
    const info = JSON.parse(serialized) as { repo: Record<string, unknown> }
    expect(info.repo).not.toHaveProperty('origin')
    expect(info.repo).not.toHaveProperty('fork')
  })

  it('fails closed when git status cannot be inspected', () => {
    const root = mkdtempSync(join(tmpdir(), 'omnimux-build-info-nogit-'))
    roots.push(root)
    mkdirSync(join(root, 'dsh-desktop-next'), { recursive: true })
    writeFileSync(join(root, 'dsh-desktop-next', 'package.json'), JSON.stringify({ name: 'dsh-desktop-next', version: '9.9.9' }))
    const appPath = makeApp(root)
    expect(() => writeAppBuildInfo(appPath, 'release', { repoRoot: root, packageDir: 'dsh-desktop-next' })).toThrow('cannot inspect git status')
  })
})
