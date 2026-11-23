import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import type { BridgeServer } from '../src/server.ts'
import { BROWSER_TOOL_NAMES, createBrowserToolRegistrar, type BrowserToolsOptions } from '../src/tools.ts'
import { browserBridgePrompt } from '../src/index.ts'

const OPTIONS: BrowserToolsOptions = {
  toolTimeoutMs: 1_000,
  snapshotMaxChars: 12_000,
  maxInteractiveItems: 60,
}

function fakeContext(): { ctx: Context; registered: Map<string, unknown> } {
  const registered = new Map<string, unknown>()
  const ctx = {
    tools: {
      register(tool: { name: string }) {
        registered.set(tool.name, tool)
        return () => { registered.delete(tool.name) }
      },
    },
  } as unknown as Context
  return { ctx, registered }
}

test('browserBridgePrompt renders guidance only while an extension is connected', () => {
  assert.equal(browserBridgePrompt(false), '', 'disconnected prompt must not suggest browser_* calls')
  const connected = browserBridgePrompt(true)
  assert.match(connected, /browser_snapshot/)
  assert.match(connected, /Reuse that injected snapshot/)
  assert.match(connected, /Never assume page content you have not snapshotted/)
  assert.doesNotMatch(connected, /\p{Script=Han}/u)
})

test('browser tool registrar exposes all 15 tools only while connected and survives reconnect', () => {
  const { ctx, registered } = fakeContext()
  const bridge = {} as unknown as BridgeServer
  const registrar = createBrowserToolRegistrar(ctx, bridge, OPTIONS)

  registrar.sync(false)
  assert.equal(registered.size, 0, 'disconnected: no browser tool may be registered')

  registrar.sync(true)
  assert.deepEqual([...registered.keys()].sort(), [...BROWSER_TOOL_NAMES].sort())
  assert.equal(registered.size, 15)

  registrar.sync(true)
  assert.equal(registered.size, 15, 'repeat connected sync is idempotent')

  registrar.sync(false)
  assert.equal(registered.size, 0, 'disconnect: every browser tool is released')

  registrar.sync(true)
  assert.equal(registered.size, 15, 'reconnect: the full set is registered again')

  registrar.dispose()
  assert.equal(registered.size, 0, 'dispose releases the live registrations')
})
