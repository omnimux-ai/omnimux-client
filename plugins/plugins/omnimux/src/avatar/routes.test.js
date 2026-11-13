import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { renderAvatarUri } from './avatar.js'
import { createAvatarDispatcher, sendAvatarJson } from './routes.js'
import { createAvatarStore } from './store.js'

function signedIdentity(profile = { id: 3, username: 'ada' }) {
  return {
    async status() {
      return { logged_in: true, ...profile }
    },
  }
}

describe('avatar http dispatcher', () => {
  it('sends a data URI that contains the substring sk-', () => {
    const seen = { chunks: [] }
    const res = {
      writeHead(status) { seen.status = status },
      end(chunk) { seen.chunks.push(String(chunk)) },
    }
    sendAvatarJson(res, 200, { avatar: { uri: 'data:image/png;base64,sk-not-a-token' } })
    assert.equal(seen.status, 200)
    assert.match(seen.chunks.join(''), /sk-not-a-token/)
  })

  it('returns 401 when unsigned and 404/405 for other paths or methods', async () => {
    const dispatcher = createAvatarDispatcher({
      store: createAvatarStore({ home: mkdtempSync(join(tmpdir(), 'omnimux-avatar-un-')) }),
      identity: { async status() { return { logged_in: false } } },
    })
    const denied = await dispatcher.dispatch({ method: 'GET', url: '/omnimux/avatar' })
    assert.equal(denied.status, 401)
    assert.equal(denied.body.error, 'needs-omnimux')
    const missing = await dispatcher.dispatch({ method: 'GET', url: '/omnimux/other' })
    assert.equal(missing.status, 404)
    const method = await createAvatarDispatcher({
      store: createAvatarStore({ home: mkdtempSync(join(tmpdir(), 'omnimux-avatar-m-')) }),
      identity: signedIdentity(),
    }).dispatch({ method: 'POST', url: '/omnimux/avatar' })
    assert.equal(method.status, 405)
  })

  it('renders a default avatar from the username and persists a customization', async () => {
    const home = mkdtempSync(join(tmpdir(), 'omnimux-avatar-ok-'))
    const store = createAvatarStore({ home })
    const dispatcher = createAvatarDispatcher({ store, identity: signedIdentity() })
    try {
      const first = await dispatcher.dispatch({ method: 'GET', url: '/omnimux/avatar' })
      assert.equal(first.status, 200)
      assert.equal(first.body.avatar.using_default, true)
      assert.equal(first.body.avatar.name, 'ada')
      assert.equal(first.body.avatar.uri, renderAvatarUri('ada'))
      assert.match(JSON.stringify(first.body), /^((?!access_token)(?!sk-).)*$/)

      const hue = await dispatcher.dispatch({
        method: 'PATCH',
        url: '/omnimux/avatar',
        body: { hue: 210 },
      })
      assert.equal(hue.status, 200)
      assert.equal(hue.body.avatar.using_default, false)
      assert.equal(hue.body.avatar.opts.hue, 210)
      assert.equal(hue.body.avatar.uri, renderAvatarUri('ada', { hue: 210 }))

      const again = await dispatcher.dispatch({ method: 'GET', url: '/omnimux/avatar' })
      assert.equal(again.body.avatar.uri, hue.body.avatar.uri)
      assert.equal(again.body.avatar.using_default, false)

      const reroll = await dispatcher.dispatch({
        method: 'PATCH',
        url: '/omnimux/avatar',
        body: { reroll: true },
      })
      assert.equal(reroll.status, 200)
      assert.equal(reroll.body.avatar.using_default, false)
      assert.notEqual(reroll.body.avatar.name, 'ada')
      assert.notEqual(reroll.body.avatar.uri, hue.body.avatar.uri)

      const reset = await dispatcher.dispatch({
        method: 'PATCH',
        url: '/omnimux/avatar',
        body: { reset: true },
      })
      assert.equal(reset.body.avatar.using_default, true)
      assert.equal(reset.body.avatar.uri, renderAvatarUri('ada'))
      assert.equal(store.read('3'), undefined)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('rejects an invalid patch and keeps the stored row', async () => {
    const home = mkdtempSync(join(tmpdir(), 'omnimux-avatar-bad-'))
    const store = createAvatarStore({ home })
    const dispatcher = createAvatarDispatcher({ store, identity: signedIdentity() })
    try {
      await dispatcher.dispatch({ method: 'PATCH', url: '/omnimux/avatar', body: { hue: 12 } })
      const bad = await dispatcher.dispatch({
        method: 'PATCH',
        url: '/omnimux/avatar',
        body: { hue: 999 },
      })
      assert.equal(bad.status, 400)
      assert.match(String(bad.body.error), /hue/)
      assert.equal(store.read('3').hue, 12)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('persists an uploaded image and clears generated options', async () => {
    const home = mkdtempSync(join(tmpdir(), 'omnimux-avatar-up-'))
    const store = createAvatarStore({ home })
    const dispatcher = createAvatarDispatcher({ store, identity: signedIdentity() })
    const png = `data:image/png;base64,${Buffer.from('fake-png-bytes').toString('base64')}`
    try {
      await dispatcher.dispatch({ method: 'PATCH', url: '/omnimux/avatar', body: { hue: 210 } })
      const uploaded = await dispatcher.dispatch({
        method: 'PATCH',
        url: '/omnimux/avatar',
        body: { upload: png },
      })
      assert.equal(uploaded.status, 200)
      assert.equal(uploaded.body.avatar.uri, png)
      assert.equal(uploaded.body.avatar.using_default, false)
      assert.deepEqual(uploaded.body.avatar.opts, {})
      assert.equal(store.read('3').hue, undefined)
      assert.equal(store.read('3').snapshot_uri, png)

      const again = await dispatcher.dispatch({ method: 'GET', url: '/omnimux/avatar' })
      assert.equal(again.body.avatar.uri, png)

      const badType = await dispatcher.dispatch({
        method: 'PATCH',
        url: '/omnimux/avatar',
        body: { upload: 'data:image/svg+xml;base64,PHN2Zy8+' },
      })
      assert.equal(badType.status, 400)
      const tooBig = await dispatcher.dispatch({
        method: 'PATCH',
        url: '/omnimux/avatar',
        body: { upload: `data:image/png;base64,${Buffer.alloc(210 * 1024, 1).toString('base64')}` },
      })
      assert.equal(tooBig.status, 400)
      assert.match(String(tooBig.body.error), /200KB/)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})
