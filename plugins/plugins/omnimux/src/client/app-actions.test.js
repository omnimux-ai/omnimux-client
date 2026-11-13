import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { canOpen, hasOverflowMenu, needsIdentity, primaryActionFor } from './app-actions.js'

describe('primary action slot', () => {
  it('maps each state to its single primary action', () => {
    const cases = [
      ['available', 'install'],
      ['update', 'update'],
      ['installed', null],
      ['', null],
    ]
    for (const [state, expected] of cases) {
      assert.equal(primaryActionFor(state), expected, `state ${JSON.stringify(state)}`)
    }
  })
})

describe('overflow menu slot', () => {
  it('appears only for installed and update cards', () => {
    const cases = [
      ['available', false],
      ['installed', true],
      ['update', true],
      ['', false],
    ]
    for (const [state, expected] of cases) {
      assert.equal(hasOverflowMenu(state), expected, `state ${JSON.stringify(state)}`)
    }
  })
})

describe('canOpen', () => {
  it('accepts installed and update, rejects the rest', () => {
    const cases = [
      [{ state: 'installed', client: true }, false, true],
      [{ state: 'update', client: true }, false, true],
      [{ state: 'available', client: true }, false, false],
      [{ state: 'installed', client: false }, false, false],
      [{ state: 'installed', client: true }, true, false],
      [{ state: 'update', client: true }, true, false],
      [{ state: undefined, client: true }, false, false],
      [null, false, false],
      [{}, false, false],
    ]
    for (const [app, pendingRestart, expected] of cases) {
      assert.equal(
        canOpen(app, pendingRestart),
        expected,
        `app ${JSON.stringify(app)} pendingRestart ${String(pendingRestart)}`,
      )
    }
  })
})

describe('needsIdentity', () => {
  it('only fires for the identity capability', () => {
    assert.equal(needsIdentity({ capabilities: ['identity'] }), true)
    assert.equal(needsIdentity({ capabilities: ['official'] }), false)
    assert.equal(needsIdentity({ capabilities: [] }), false)
    assert.equal(needsIdentity({ capabilities: 'identity' }), false)
    assert.equal(needsIdentity({}), false)
    assert.equal(needsIdentity(null), false)
  })
})
