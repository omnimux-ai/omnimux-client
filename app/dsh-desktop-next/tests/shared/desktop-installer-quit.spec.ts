import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DESKTOP_INSTALLER_QUIT_FLAG,
  isDesktopBackgroundNodeRequest,
  isDesktopInstallerQuitRequest,
} from '../../src/desktop-installer-quit.ts'

describe('Desktop installer quit request', () => {
  it('accepts only the dedicated flag on Windows', () => {
    expect(DESKTOP_INSTALLER_QUIT_FLAG).toBe('--dsh-installer-quit')
    expect(isDesktopInstallerQuitRequest(
      ['DSH Desktop.exe', DESKTOP_INSTALLER_QUIT_FLAG],
      'win32',
    )).toBe(true)
    expect(isDesktopInstallerQuitRequest(['DSH Desktop.exe', '--quit'], 'win32')).toBe(false)
    expect(isDesktopInstallerQuitRequest(
      ['DSH Desktop', DESKTOP_INSTALLER_QUIT_FLAG],
      'darwin',
    )).toBe(false)
  })

  it('distinguishes background Node re-entry from an explicit application launch', () => {
    expect(isDesktopBackgroundNodeRequest(['DSH Desktop.exe'])).toBe(false)
    expect(isDesktopBackgroundNodeRequest(['DSH Desktop.exe', '--profile', 'desktop'])).toBe(false)
    expect(isDesktopBackgroundNodeRequest(['DSH Desktop.exe', 'C:\\app\\pnpm\\bin\\pnpm.mjs', 'install'])).toBe(true)
    expect(isDesktopBackgroundNodeRequest(['DSH Desktop.exe', '--require', 'C:\\runtime\\clear-env.cjs'])).toBe(true)
    expect(isDesktopBackgroundNodeRequest(['DSH Desktop.exe', '--import=file:///runtime/clear-env.mjs'])).toBe(true)
    expect(isDesktopBackgroundNodeRequest(['DSH Desktop.exe', '--expose-internals', 'desktop-cli.js'])).toBe(true)
  })

  it('handles first- and second-instance requests without showing a window', () => {
    const main = readFileSync(join(process.cwd(), 'src', 'main.ts'), 'utf8')
    const singleInstance = readFileSync(join(process.cwd(), 'src', 'single-instance.ts'), 'utf8')
    const claimCall = main.indexOf('claimDesktopSingleInstance(app, openMain)')
    const runtimeCreate = main.indexOf('new NextDesktopRuntime(')
    expect(claimCall).toBeGreaterThanOrEqual(0)
    expect(runtimeCreate).toBeGreaterThan(claimCall)

    const lock = singleInstance.indexOf('if (!application.requestSingleInstanceLock())')
    const earlyQuit = singleInstance.indexOf(
      'if (isDesktopInstallerQuitRequest(invocation.argv, invocation.platform))',
    )
    const secondInstance = singleInstance.indexOf("application.on('second-instance', (_event, argv = []) => {")
    const secondQuit = singleInstance.indexOf(
      'if (isDesktopInstallerQuitRequest(argv, invocation.platform)) application.quit()',
      secondInstance,
    )
    const focus = singleInstance.indexOf('focusOwner()', secondInstance)

    expect(lock).toBeGreaterThanOrEqual(0)
    expect(earlyQuit).toBeGreaterThan(lock)
    expect(secondInstance).toBeGreaterThan(earlyQuit)
    expect(secondQuit).toBeGreaterThan(secondInstance)
    expect(focus).toBeGreaterThan(secondQuit)
  })
})
