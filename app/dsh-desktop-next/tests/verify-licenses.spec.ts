import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  isFirstPartyWorkspacePlugin,
  licenseAccepted,
  licenseNeedsNotice,
} from '../scripts/verify-licenses.mjs'

const packageRoot = fileURLToPath(new URL('..', import.meta.url))

describe('verify-licenses SPDX expression handling', () => {
  it('accepts safe single, OR, AND, and BlueOak-1.0.0 licenses while rejecting unknown or malformed terms', () => {
    expect(licenseAccepted('MIT')).toBe(true)
    expect(licenseAccepted('BlueOak-1.0.0')).toBe(true)
    expect(licenseAccepted('(MIT OR CC0-1.0)')).toBe(true)
    expect(licenseAccepted('MIT AND MPL-2.0')).toBe(true)
    expect(licenseAccepted('Apache-2.0 AND LGPL-3.0-or-later AND MIT')).toBe(true)
    expect(licenseAccepted('(MIT OR Apache-2.0) AND LGPL-3.0-or-later')).toBe(true)

    expect(licenseAccepted('MIT OR GPL-3.0-only')).toBe(false)
    expect(licenseAccepted('GPL-3.0-only')).toBe(false)
    expect(licenseAccepted('(MIT OR Apache-2.0')).toBe(false)
    expect(licenseAccepted('()')).toBe(false)
    expect(licenseAccepted('MIT AND')).toBe(false)
    expect(licenseAccepted('')).toBe(false)
  })

  it('tracks notice-required terms across parenthesized AND/OR precedence accurately', () => {
    expect(licenseNeedsNotice('LGPL-3.0-or-later')).toBe(true)
    expect(licenseNeedsNotice('Apache-2.0 AND LGPL-3.0-or-later AND MIT')).toBe(true)
    expect(licenseNeedsNotice('(MIT OR Apache-2.0) AND LGPL-3.0-or-later')).toBe(true)
    expect(licenseNeedsNotice('LGPL-3.0-or-later OR (Apache-2.0 AND LGPL-3.0-or-later)')).toBe(true)

    expect(licenseNeedsNotice('MIT AND MPL-2.0')).toBe(false)
    expect(licenseNeedsNotice('MIT OR LGPL-3.0-or-later')).toBe(false)
    expect(licenseNeedsNotice('(MIT AND Apache-2.0) OR (BSD-3-Clause)')).toBe(false)
    expect(licenseNeedsNotice('(MIT OR Apache-2.0')).toBe(false)
  })
})

describe('isFirstPartyWorkspacePlugin boundary', () => {
  it('matches only actual repo plugins/plugins/<name> workspace targets', () => {
    const repoPluginManifest = resolve(packageRoot, '..', '..', 'plugins', 'plugins', 'omnimux', 'package.json')
    expect(isFirstPartyWorkspacePlugin('omnimux', 'link:../../plugins/plugins/omnimux')).toBe(true)
    expect(isFirstPartyWorkspacePlugin('omnimux', repoPluginManifest)).toBe(true)
    expect(isFirstPartyWorkspacePlugin('omnimux-assets', 'link:../../plugins/plugins/omnimux-assets')).toBe(true)

    expect(isFirstPartyWorkspacePlugin('omnimux', '/tmp/other/plugins/plugins/omnimux/package.json')).toBe(false)
    expect(isFirstPartyWorkspacePlugin('omnimux', 'link:../../plugins/plugins/omnimux-other')).toBe(false)
    expect(isFirstPartyWorkspacePlugin('third-party', repoPluginManifest)).toBe(false)
    expect(isFirstPartyWorkspacePlugin('omnimux', join(packageRoot, 'package.json'))).toBe(false)
  })
})
