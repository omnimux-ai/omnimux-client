import assert from 'node:assert/strict'
import { test } from 'node:test'
import { verifyDesktopBoundaries } from './verify-desktop-boundaries.mjs'

test('allows historical compatibility string literals and package names in dsh-desktop-next', () => {
  assert.deepEqual(verifyDesktopBoundaries([
    ['dsh-desktop-next/src/profiles.ts', "const legacy = new Set(['dsh-plugin-desktop', 'dsh-plugin-desktop-beta'])\n"],
    ['dsh-desktop-next/scripts/packaging-command.ts', "args.map(a => a.replaceAll(/dsh-plugin-desktop(?!-beta)/gu, 'dsh-desktop-next'))\n"],
    ['dsh-desktop-next/tests/update-installer.spec.ts', "expect(() => assert({ name: 'dsh-plugin-desktop', version: '1.0.0' })).toThrow()\n"],
    ['dsh-desktop-next/tests/shared/package-mac.spec.ts', "const fixture = { desktopRoot: '/repo/dsh-plugin-desktop', outputDir: '/repo/dsh-plugin-desktop/dist/mac-smoke' }\n"],
  ]), { fileCount: 4 })
})

test('rejects JS/TS imports, dynamic imports, vi.mock, new URL, CSS, NSIS, and package.json references into dsh-plugin-desktop', () => {
  assert.throws(() => verifyDesktopBoundaries([
    ['dsh-desktop-next/src/main.ts', "import { x } from '../../dsh-plugin-desktop/src/x.ts'\n"],
  ]), /must not reference dsh-plugin-desktop/u)

  assert.throws(() => verifyDesktopBoundaries([
    ['dsh-desktop-next/scripts/package.ts', "const m = await import('../../dsh-plugin-desktop/scripts/package-mac.ts')\n"],
  ]), /must not reference dsh-plugin-desktop/u)

  assert.throws(() => verifyDesktopBoundaries([
    ['dsh-desktop-next/tests/app.spec.ts', "vi.mock('../../dsh-plugin-desktop/src/ui.tsx', () => ({}))\n"],
  ]), /must not reference dsh-plugin-desktop/u)

  assert.throws(() => verifyDesktopBoundaries([
    ['dsh-desktop-next/tests/app.spec.ts', "const s = readFileSync(new URL('../../dsh-plugin-desktop/build/installer.nsh', import.meta.url), 'utf8')\n"],
  ]), /must not reference dsh-plugin-desktop/u)

  assert.throws(() => verifyDesktopBoundaries([
    ['dsh-desktop-next/tests/app-icon.spec.ts', "const sharp = createRequire(join(root, '../dsh-plugin-desktop/package.json'))('sharp')\n"],
  ]), /must not reference dsh-plugin-desktop/u)

  assert.throws(() => verifyDesktopBoundaries([
    ['dsh-desktop-next/src/native-ui/theme.css', "@import '../../../dsh-plugin-desktop/src/native-ui/shared/theme.css';\n"],
  ]), /must not reference dsh-plugin-desktop/u)

  assert.throws(() => verifyDesktopBoundaries([
    ['dsh-desktop-next/src/native-ui/theme.css', "@source '../../../dsh-plugin-desktop/src/native-ui';\n"],
  ]), /must not reference dsh-plugin-desktop/u)

  assert.throws(() => verifyDesktopBoundaries([
    ['dsh-desktop-next/build/installer.nsh', "!include \"../../dsh-plugin-desktop/build/installer-directories.nsh\"\n"],
  ]), /must not reference dsh-plugin-desktop/u)

  assert.throws(() => verifyDesktopBoundaries([
    ['dsh-desktop-next/tests/fixtures/installer-directory-smoke.nsi', '!include "..\\..\\..\\dsh-plugin-desktop\\build\\installer.nsh"\n'],
  ]), /must not reference dsh-plugin-desktop/u)

  assert.throws(() => verifyDesktopBoundaries([
    ['dsh-desktop-next/package.json', JSON.stringify({ build: { nsis: { include: '../dsh-plugin-desktop/build/installer.nsh' } } })],
  ]), /must not reference dsh-plugin-desktop/u)
})
