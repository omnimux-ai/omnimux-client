import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isQuotaFailure, selectQuotaTurn, walletUrl } from './quota-failure.js'

describe('isQuotaFailure', () => {
  it('accepts an explicit QUOTA code', () => {
    assert.equal(isQuotaFailure({ code: 'QUOTA', message: 'nope' }), true)
  })

  it('accepts the OmniMux pre-deduct 403 even when coded AUTH', () => {
    assert.equal(isQuotaFailure({
      code: 'AUTH',
      message: '403: {"message":"预扣费额度失败, 用户剩余额度: Credits0.09","code":"insufficient_user_quota"}',
    }), true)
  })

  it('rejects a real bad-key AUTH', () => {
    assert.equal(isQuotaFailure({ code: 'AUTH', message: '401: Invalid token' }), false)
  })

  it('rejects non-objects', () => {
    assert.equal(isQuotaFailure(null), false)
    assert.equal(isQuotaFailure('insufficient_quota'), false)
  })
})

describe('walletUrl', () => {
  it('joins /wallet onto the signed-in site', () => {
    assert.equal(walletUrl('https://omnimux.ai'), 'https://omnimux.ai/wallet')
    assert.equal(walletUrl('https://omnimux.ai/'), 'https://omnimux.ai/wallet')
  })

  it('falls back to the public site', () => {
    assert.equal(walletUrl(undefined), 'https://omnimux.ai/wallet')
  })
})

describe('selectQuotaTurn', () => {
  it('mounts only when the turn ended on a quota miss', () => {
    assert.equal(selectQuotaTurn({
      turn: { end: { data: { reason: { kind: 'error', error: { code: 'QUOTA' } } } } },
    }), true)
    assert.equal(selectQuotaTurn({
      turn: { end: { data: { reason: { kind: 'error', error: { code: 'AUTH', message: '401' } } } } },
    }), null)
    assert.equal(selectQuotaTurn({ turn: { end: { data: { reason: { kind: 'stop' } } } } }), null)
    assert.equal(selectQuotaTurn({}), null)
  })
})
