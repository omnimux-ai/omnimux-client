import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { apply } from '../index.js'

test('publishes startup gateway catalog changes to the Hub event stream', { timeout: 2000 }, async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'catalog-notifications-'))
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  const disposers = []
  t.after(() => {
    for (const dispose of disposers) dispose?.()
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    rmSync(home, { recursive: true, force: true })
  })
  const siteBaseUrl = 'https://catalog-notifications.example.test'
  t.mock.method(globalThis, 'fetch', async (url) => {
    assert.equal(url, `${siteBaseUrl}/api/pricing`)
    return Response.json({
      success: true, group_ratio: { default: 1 }, usable_group: { default: 'Default' },
      data: [{ model_name: 'fixture-notification', enable_groups: ['default'] }],
    })
  })
  const provided = {}
  const updated = Promise.withResolvers()
  apply({
    tools: { register() {} },
    provide(name, api) { provided[name] = api },
    effect(factory) { disposers.push(factory()) },
    emit(type) { if (type === 'omnimux/model-catalog-updated') updated.resolve() },
  }, { siteBaseUrl, catalog: { bundledDir: join(home, 'empty') }, official: { mount: false } })

  await updated.promise
  const [event] = provided.hubEvents.getEventsSince('0')
  assert.equal(event.type, 'omnimux:model-catalog-updated')
  assert.deepEqual(event.payload, {})
})
