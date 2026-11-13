import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolvePlugin } from './mapper.js'
import { DEFAULT_PLUGIN_MAP } from './config.js'

test('maps every product plugin tool prefix', () => {
  assert.equal(resolvePlugin('video_process', DEFAULT_PLUGIN_MAP), 'omnimux-video')
  assert.equal(resolvePlugin('assets_list', DEFAULT_PLUGIN_MAP), 'omnimux-assets')
  assert.equal(resolvePlugin('assets_upload', DEFAULT_PLUGIN_MAP), 'omnimux-assets')
  assert.equal(resolvePlugin('plaza_search', DEFAULT_PLUGIN_MAP), 'omnimux-market')
  assert.equal(resolvePlugin('plaza_summon', DEFAULT_PLUGIN_MAP), 'omnimux-market')
  assert.equal(resolvePlugin('plaza_install', DEFAULT_PLUGIN_MAP), 'omnimux-market')
  assert.equal(resolvePlugin('plugin_uninstall', DEFAULT_PLUGIN_MAP), 'omnimux-market')
  assert.equal(resolvePlugin('connector_install', DEFAULT_PLUGIN_MAP), 'omnimux-market')
  assert.equal(resolvePlugin('esc_search', DEFAULT_PLUGIN_MAP), 'other')
  assert.equal(resolvePlugin('workflow_run', DEFAULT_PLUGIN_MAP), 'omnimux-workflow')
  assert.equal(resolvePlugin('workflow_list', DEFAULT_PLUGIN_MAP), 'omnimux-workflow')
  assert.equal(resolvePlugin('omnimux_text_complete', DEFAULT_PLUGIN_MAP), 'omnimux')
})

test('plaza_ prefix maps to omnimux-market, not gallery', () => {
  assert.equal(resolvePlugin('plaza_search', DEFAULT_PLUGIN_MAP), 'omnimux-market')
  assert.equal(resolvePlugin('plaza_summon', DEFAULT_PLUGIN_MAP), 'omnimux-market')
})

test('plugin_ and connector_ prefixes map to omnimux-market', () => {
  assert.equal(resolvePlugin('plugin_search', DEFAULT_PLUGIN_MAP), 'omnimux-market')
  assert.equal(resolvePlugin('plugin_uninstall', DEFAULT_PLUGIN_MAP), 'omnimux-market')
  assert.equal(resolvePlugin('connector_install', DEFAULT_PLUGIN_MAP), 'omnimux-market')
  assert.equal(resolvePlugin('connector_list', DEFAULT_PLUGIN_MAP), 'omnimux-market')
  assert.equal(resolvePlugin('esc_search', DEFAULT_PLUGIN_MAP), 'other')
})

test('skillhub prefix matches both bare and underscored tool names', () => {
  assert.equal(resolvePlugin('skillhub', DEFAULT_PLUGIN_MAP), 'omnimux-market')
  assert.equal(resolvePlugin('skillhub_search', DEFAULT_PLUGIN_MAP), 'omnimux-market')
  assert.equal(resolvePlugin('skillhub_uninstall', DEFAULT_PLUGIN_MAP), 'omnimux-market')
})

test('unknown tools land in the fallback, not lost', () => {
  assert.equal(resolvePlugin('some_future_tool', DEFAULT_PLUGIN_MAP), 'other')
  assert.equal(resolvePlugin('x', DEFAULT_PLUGIN_MAP), 'other')
})

test('longest prefix wins', () => {
  const map = { a: 'short', ab: 'long' }
  assert.equal(resolvePlugin('abc', map), 'long')
  assert.equal(resolvePlugin('a_xyz', map), 'short')
})

test('empty and unknown prefixes are ignored', () => {
  const map = { '': 'empty', z: 'z' }
  assert.equal(resolvePlugin('abc', map), 'other')
  assert.equal(resolvePlugin('z1', map), 'z')
})

test('custom map overrides attribution', () => {
  const map = { ...DEFAULT_PLUGIN_MAP, custom_: 'my-custom' }
  assert.equal(resolvePlugin('custom_init_project', map), 'my-custom')
})
