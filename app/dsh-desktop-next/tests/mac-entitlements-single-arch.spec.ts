import { expect, it, vi } from 'vitest'
import { NEXT_MAC_REQUIRED_ENTITLEMENTS, verifyNextMacEntitlements } from '../scripts/verify-mac-entitlements.ts'

const granted = Object.fromEntries(NEXT_MAC_REQUIRED_ENTITLEMENTS.map(key => [key, true]))

// A single-CPU macOS package carries only its own architecture slice, so the
// verifier must probe just that slice instead of failing on the missing one.
it('checks only the slice a single-CPU package carries', () => {
  const read = vi.fn((_path: string, arch: string) => {
    if (arch !== 'arm64') throw new Error('object file format unrecognized, invalid, or unsuitable')
    return granted
  })
  verifyNextMacEntitlements('/mounted/DSH NEXT.app', read, ['arm64'])
  expect(read).toHaveBeenCalledTimes(5)
  expect(read.mock.calls.every(([, arch]) => arch === 'arm64')).toBe(true)
})
