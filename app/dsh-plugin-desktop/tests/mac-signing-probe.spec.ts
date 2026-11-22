import { spawnSync } from 'node:child_process'
import { afterEach, expect, it, vi } from 'vitest'
import { probeMacRelease } from '../scripts/mac-signing-probe.ts'

vi.mock('node:child_process', async importOriginal => ({ ...await importOriginal<typeof import('node:child_process')>(), spawnSync: vi.fn() }))
vi.mock('node:fs', async importOriginal => ({ ...await importOriginal<typeof import('node:fs')>(), copyFileSync: vi.fn() }))

const env = { APPLE_KEYCHAIN_PROFILE: 'fixture-profile' }
const identity = 'A'.repeat(40) + ' "Developer ID Application: Example (EXAMPLE123)"'
const valid = `Matching identities\n  1) ${identity}\n     1 identities found\n\nValid identities only\n  1) ${identity}\n     1 valid identities found\n`
const missing = 'Matching identities\n     0 identities found\n\nValid identities only\n     0 valid identities found\n'
const expired = `Matching identities\n  1) ${identity} (CSSMERR_TP_CERT_EXPIRED)\n     1 identities found\n\nValid identities only\n     0 valid identities found\n`

function result(stdout = '', stderr = '', status: number | null = 0, error?: NodeJS.ErrnoException) {
  return { stdout, stderr, status, signal: null, pid: 1, output: [null, stdout, stderr], ...(error === undefined ? {} : { error }) }
}

afterEach(() => vi.resetAllMocks())

it.each([
  { output: missing, message: /no usable Developer ID Application identity/iu },
  { output: expired, message: /certificate has expired/iu },
])('diagnoses an unusable identity during discovery without invoking the signer', async ({ output, message }) => {
  vi.mocked(spawnSync).mockReturnValueOnce(result(output))
  await expect(probeMacRelease(env, 'darwin')).rejects.toThrow(message)
  expect(spawnSync).toHaveBeenCalledExactlyOnceWith('/usr/bin/security', ['find-identity', '-p', 'codesigning'], expect.objectContaining({
    killSignal: 'SIGKILL', timeout: expect.any(Number),
  }))
})

it.each([
  { response: result('', 'User interaction is not allowed.', 1), diagnostic: /Keychain is locked/iu },
  { response: result('', '', null, Object.assign(new Error('private command'), { code: 'ETIMEDOUT' })), diagnostic: /timed out.*unlock/iu },
])('stops immediately when codesign cannot use the key', async ({ response, diagnostic }) => {
  const spawn = vi.mocked(spawnSync)
  spawn.mockReturnValueOnce(result(valid)).mockReturnValueOnce(response)
  await expect(probeMacRelease(env, 'darwin')).rejects.toThrow(diagnostic)
  expect(spawn).toHaveBeenCalledTimes(2)
  const [command, args, options] = spawn.mock.calls[1]!
  expect(command).toBe('/usr/bin/codesign')
  expect(args).toEqual(expect.arrayContaining(['--sign', 'A'.repeat(40), '--timestamp=none']))
  expect(options).toMatchObject({ killSignal: 'SIGKILL', timeout: expect.any(Number), env: { LC_ALL: 'C' } })
  expect(options).toHaveProperty('timeout')
  expect((options as { timeout: number }).timeout).toBeLessThanOrEqual(1500)
})
