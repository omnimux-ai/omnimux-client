import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BOOT_WINDOW_KEY, DEFAULT_CONFIG } from './defaults.js'
import { injectBrandBoot } from './inject-index.js'

test('injectBrandBoot writes the config after body', () => {
  const html = '<!doctype html><html><body><div id="root"></div></body></html>'
  const next = injectBrandBoot(html, DEFAULT_CONFIG)
  assert.match(next, /<body><script>window\.__OMNIMUX_BRAND__=/)
  assert.ok(next.includes(JSON.stringify(DEFAULT_CONFIG)))
  assert.equal(next.includes(BOOT_WINDOW_KEY), true)
})

test('injectBrandBoot appends when the fragment has no body', () => {
  const next = injectBrandBoot('<div></div>', DEFAULT_CONFIG)
  assert.ok(next.startsWith('<div></div><script>'))
})
