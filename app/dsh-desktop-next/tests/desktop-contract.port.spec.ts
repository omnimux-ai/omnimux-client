import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

it('derives DEFAULT_PREFERENCES.port from the launch channel while keeping safe mode at 0', async () => {
  vi.stubEnv('OMNIMUX_CHANNEL', 'dev')
  vi.stubEnv('OMNIMUX_DEV', '')
  vi.stubEnv('NODE_ENV', 'test')
  vi.stubEnv('DSH_DESKTOP_DEV', '')
  vi.resetModules()
  const dev = await import('../src/desktop-contract.ts')
  expect(dev.DEFAULT_PREFERENCES.port).toBe(45_120)
  expect(dev.SAFE_MODE_PREFERENCES.port).toBe(0)

  vi.stubEnv('OMNIMUX_CHANNEL', 'prod')
  vi.resetModules()
  const prod = await import('../src/desktop-contract.ts')
  expect(prod.DEFAULT_PREFERENCES.port).toBe(44_120)
  expect(prod.SAFE_MODE_PREFERENCES.port).toBe(0)

  // Explicit saved preferences still override either channel default.
  const preferences = await import('../src/desktop-preferences.ts')
  expect(preferences.parsePreferences({ port: 43_210 }).port).toBe(43_210)
  expect(preferences.parsePreferences({ port: 0 }).port).toBe(0)
})
