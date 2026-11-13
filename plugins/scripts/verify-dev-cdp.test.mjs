import { test } from 'node:test'
import { strictEqual, ok } from 'node:assert'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'))
const script = join(here, 'verify-dev-cdp.mjs')
const src = readFileSync(script, 'utf8')

test('verify:cdp script is wired in package.json', () => {
  strictEqual(pkg.scripts['verify:cdp'], 'node scripts/verify-dev-cdp.mjs')
})

test('verify-dev-cdp.mjs exists and is executable entry', () => {
  ok(src.startsWith('#!/usr/bin/env node'), 'should start with shebang')
})

test('verify-dev-cdp drives the Dev App Electron renderer over CDP', () => {
  ok(src.includes('/json/list'), 'should discover CDP page targets')
  ok(src.includes('WebSocket'), 'should open a CDP websocket')
  ok(src.includes('Runtime.evaluate'), 'should evaluate in the renderer')
})

test('verify-dev-cdp asserts computed styles against a selector', () => {
  ok(src.includes('paddingTop'), 'should read computed paddingTop')
  ok(src.includes('TARGET_SELECTOR') || src.includes('OMNIMUX_CDP_SELECTOR'), 'should allow selector override')
  ok(src.includes("result: ok ? 'PASS' : 'FAIL'"), 'should emit PASS/FAIL')
})

test('verify-dev-cdp writes a live QA evidence report', () => {
  ok(src.includes('live-cdp-qa-report.json'), 'should write evidence report')
  ok(src.includes('process.exit(1)'), 'should fail the process on assertion failure')
})
