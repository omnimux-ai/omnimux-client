import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { candidateLayout, devAppIsRunning, parseProfileArguments } from '../scripts/rebuild-managed-profile.ts'

describe('managed Profile command', () => {
  const app = '/fixture/Frozen Dev.app'
  const recoveryDir = '/fixture/network/batch'

  it('requires an explicit recovery directory and offers a read-only preflight', () => {
    expect(parseProfileArguments(['upgrade-dev', '--app', app, '--dry-run', '--recovery-dir', recoveryDir])).toEqual({
      command: 'upgrade-dev', app, recoveryDir, dryRun: true,
    })
    expect(() => parseProfileArguments(['upgrade-dev', '--app', app])).toThrow('usage:')
    expect(() => parseProfileArguments(['upgrade-dev', '--app', app, '--recovery-dir', 'local'])).toThrow('usage:')
    expect(() => parseProfileArguments(['upgrade-dev', '--app', app, '--recovery-dir', recoveryDir, '--target', 'prod']))
      .toThrow('usage:')
  })

  it('can recover without the candidate App and keeps the existing rebuild command', () => {
    expect(parseProfileArguments(['recover-dev', '--recovery-dir', recoveryDir])).toEqual({ command: 'recover-dev', recoveryDir })
    expect(parseProfileArguments(['rebuild', '--target', 'prod', '--app', app])).toEqual({ command: 'rebuild', target: 'prod', app })
  })

  it.skipIf(process.platform === 'win32')('uses physical files for archive verification in Electron Node mode', () => {
    const root = mkdtempSync(join(tmpdir(), 'omnimux-profile-asar-'))
    try {
      const bundle = join(root, 'Frozen Dev.app')
      const executable = join(bundle, 'Contents', 'MacOS', 'OmniMux')
      mkdirSync(dirname(executable), { recursive: true })
      writeFileSync(executable, '#!/bin/sh\nprintf "%s %s\\n" "$ELECTRON_RUN_AS_NODE" "$ELECTRON_NO_ASAR"\n', { mode: 0o755 })
      const result = spawnSync(process.execPath, [
        fileURLToPath(new URL('../../scripts/omnimux.mjs', import.meta.url)), 'profile',
        'upgrade-dev', '--app', bundle, '--recovery-dir', recoveryDir,
      ], { encoding: 'utf8', env: { ...process.env, ELECTRON_NO_ASAR: '0' } })
      expect(result.stderr).toBe('')
      expect(result.status).toBe(0)
      expect(result.stdout.trim()).toBe('1 1')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it.each(['app', 'app.asar.unpacked'])('resolves the preset and pnpm under %s', (layout) => {
    const root = mkdtempSync(join(tmpdir(), 'omnimux-profile-cli-'))
    try {
      const bundle = join(root, 'Dev.app')
      const executable = join(bundle, 'Contents', 'MacOS', 'OmniMux')
      const packageRoot = join(bundle, 'Contents', 'Resources', layout)
      const presetDir = join(packageRoot, 'preset')
      const pnpmBinPath = join(packageRoot, 'node_modules', 'pnpm', 'bin', 'pnpm.mjs')
      for (const path of [executable, pnpmBinPath, join(presetDir, 'owned-packages.json')]) {
        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(path, '')
      }
      expect(() => candidateLayout(bundle)).toThrow('complete preset')
      mkdirSync(join(presetDir, 'plugins'))
      expect(candidateLayout(bundle)).toEqual({ executable, presetDir, pnpmBinPath })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('recognizes the bound Dev App and Host executables only', () => {
    const helper = `${app}/Contents/Frameworks/OmniMux Helper.app/Contents/MacOS/OmniMux Helper`
    expect(devAppIsRunning(`/usr/bin/node\n${helper}\n`, app)).toBe(true)
    expect(devAppIsRunning(`/fixture/OmniMux.app/Contents/MacOS/OmniMux\n/usr/bin/osascript ${helper}\n`, app)).toBe(false)
  })
})
