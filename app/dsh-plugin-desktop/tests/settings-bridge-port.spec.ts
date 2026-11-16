import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

it('defaults DesktopSettingsSchema and DesktopShellConfig ports from the launch channel', async () => {
  vi.stubEnv('OMNIMUX_CHANNEL', 'dev')
  vi.stubEnv('OMNIMUX_DEV', '')
  vi.stubEnv('NODE_ENV', 'test')
  vi.stubEnv('DSH_DESKTOP_DEV', '')
  vi.resetModules()
  const dev = await import('../src/settings-bridge.ts')
  expect(dev.DesktopSettingsSchema({} as never).port).toBe(45_120)
  expect(dev.DesktopShellConfig({}).port.get()).toBe(45_120)
  expect(dev.DesktopSettingsSchema({ port: 0 } as never).port).toBe(0)
  expect(dev.DesktopSettingsSchema({ port: 43_210 } as never).port).toBe(43_210)

  vi.stubEnv('OMNIMUX_CHANNEL', 'prod')
  vi.resetModules()
  const prod = await import('../src/settings-bridge.ts')
  expect(prod.DesktopSettingsSchema({} as never).port).toBe(44_120)
  expect(prod.DesktopShellConfig({}).port.get()).toBe(44_120)
})
