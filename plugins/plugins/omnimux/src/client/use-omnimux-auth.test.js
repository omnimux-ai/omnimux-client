import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'
import { decideAuthPhase } from './use-omnimux-auth.js'

const here = dirname(fileURLToPath(import.meta.url))

describe('decideAuthPhase', () => {
  it('marks ready when the body says logged_in', () => {
    assert.equal(
      decideAuthPhase({ ok: true, status: 200, body: { logged_in: true, quota_usd: 1.5 } }),
      'ready',
    )
  })

  it('non-verify path signs out on any non-login picture', () => {
    assert.equal(
      decideAuthPhase({ ok: true, status: 200, body: { logged_in: false } }, { verify: false }),
      'need-login',
    )
    assert.equal(
      decideAuthPhase({ ok: false, status: 502, body: {} }, { verify: false, hadReady: true }),
      'need-login',
    )
  })

  it('verify path keeps a cached ready row on transient /self failure', () => {
    assert.equal(
      decideAuthPhase(
        { ok: false, status: 502, body: { logged_in: false } },
        { verify: true, hadReady: true },
      ),
      'keep',
    )
    assert.equal(
      decideAuthPhase(
        { ok: false, status: 500, body: {} },
        { verify: true, hadReady: true },
      ),
      'keep',
    )
  })

  it('verify path signs out on 401 even when a cache was painted', () => {
    assert.equal(
      decideAuthPhase(
        { ok: false, status: 401, body: { logged_in: false } },
        { verify: true, hadReady: true },
      ),
      'need-login',
    )
  })

  it('verify path signs out when there was no prior ready row', () => {
    assert.equal(
      decideAuthPhase(
        { ok: false, status: 502, body: {} },
        { verify: true, hadReady: false },
      ),
      'need-login',
    )
  })
})

describe('profile quota refresh contract', () => {
  it('ProfileSection mounts with verifyOnMount so each tab click hits /self', () => {
    const source = readFileSync(join(here, 'ProfileSection.jsx'), 'utf8')
    assert.match(source, /useOmnimuxAuth\(\{\s*verifyOnMount:\s*true\s*\}\)/)
    assert.doesNotMatch(source, /verifyOnMount:\s*false/)
    // Login resume also re-verifies so post-login quota is live, not disk cache.
    assert.match(source, /recheck\(\{\s*verify:\s*true\s*\}\)/)
  })

  it('verifyOnMount path paints cache then live-verifies without false sign-out', () => {
    const source = readFileSync(join(here, 'use-omnimux-auth.js'), 'utf8')
    assert.match(source, /getStatus\(false\)/)
    assert.match(source, /getStatus\(true\)/)
    assert.match(source, /decideAuthPhase/)
    assert.match(source, /hadReady/)
    // Must not collapse every verify failure into need-login when cache painted.
    assert.match(source, /'keep'/)
  })
})
