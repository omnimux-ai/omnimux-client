import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

it.skipIf(process.platform === 'win32')('uses physical files for archive verification in Electron Node mode', () => {
  const root = mkdtempSync(join(tmpdir(), 'omnimux-profile-asar-'))
  try {
    const bundle = join(root, 'Frozen Dev.app')
    const executable = join(bundle, 'Contents', 'MacOS', 'OmniMux')
    mkdirSync(dirname(executable), { recursive: true })
    writeFileSync(executable, '#!/bin/sh\nprintf "%s %s\\n" "$ELECTRON_RUN_AS_NODE" "$ELECTRON_NO_ASAR"\n', { mode: 0o755 })
    const result = spawnSync(process.execPath, [
      fileURLToPath(new URL('../../scripts/omnimux.mjs', import.meta.url)), 'profile',
      'upgrade-dev', '--app', bundle, '--recovery-dir', join(root, 'network-batch'),
    ], { encoding: 'utf8', env: { ...process.env, ELECTRON_NO_ASAR: '0' } })
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe('1 1')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
