import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { pickAppsView, pickPublic } from './api.js'

describe('client auth payload filter', () => {
  it('keeps public fields and drops tokens', () => {
    const picked = pickPublic({
      logged_in: true,
      username: 'ada',
      access_token: 'pat-nope',
      email: 'x@y.z',
    })
    assert.equal(picked.logged_in, true)
    assert.equal(picked.username, 'ada')
    assert.equal('access_token' in picked, false)
    assert.equal('email' in picked, false)
  })
})

describe('client apps view filter', () => {
  it('keeps shelf fields and drops unknown keys', () => {
    const picked = pickAppsView({
      schema: 1,
      source: 'bundled',
      stale: false,
      apps: [{
        id: 'accounts',
        title: '账号',
        install_spec: 'omnimux-accounts@0.1.0',
        token: 'pat-nope',
      }],
      secret: 'sk-nope',
    })
    assert.equal(picked.schema, 1)
    assert.equal(picked.apps[0].id, 'accounts')
    assert.equal(picked.apps[0].install_spec, 'omnimux-accounts@0.1.0')
    assert.equal('token' in picked.apps[0], false)
    assert.equal('secret' in picked, false)
  })
})
