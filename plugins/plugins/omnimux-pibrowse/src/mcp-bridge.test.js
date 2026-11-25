import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { apply } from './index.js'

test('mcpBridge matches real DSH mcpManager/tools contracts, neutralizes FURY_API_PORT, and withdraws on dispose', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'pb-mcp-'))
  try {
    const binDir = join(tmp, 'bin')
    await mkdir(binDir, { recursive: true })
    const fakeAgent = join(binDir, 'fury-agent')
    await writeFile(fakeAgent, '#!/bin/sh\necho ok\n')
    await chmod(fakeAgent, 0o755)

    const registeredTools = new Map()
    const effects = []
    const mcpRegistrations = new Map()
    const listeners = new Map()
    let systemPromptSection = null

    // Exact @deepseek-ai/dsh-mcp-manager shape: register() + list() (no getStatus())
    const mcpManager = {
      register(name, cfg) {
        mcpRegistrations.set(name, cfg)
        registeredTools.set(`mcp__${name}__fury_list`, { name: `mcp__${name}__fury_list` })
        registeredTools.set(`mcp__${name}__fury_launch`, { name: `mcp__${name}__fury_launch` })
        return () => {
          mcpRegistrations.delete(name)
          registeredTools.delete(`mcp__${name}__fury_list`)
          registeredTools.delete(`mcp__${name}__fury_launch`)
        }
      },
      list() {
        return [...mcpRegistrations.keys()].map((n) => ({ name: n, status: 'connected' }))
      },
    }

    // Exact @deepseek-ai/dsh-tools shape: register() + definitions() (no list())
    const ctx = {
      logger: { info() {}, warn() {} },
      tools: {
        register(def) {
          registeredTools.set(def.name, def)
          return () => registeredTools.delete(def.name)
        },
        definitions() {
          return [...registeredTools.values()]
        },
      },
      mcpManager,
      systemPrompt: {
        section(sec) {
          systemPromptSection = sec
          return () => {
            systemPromptSection = null
          }
        },
      },
      get(service) {
        if (service === 'mcpManager') return mcpManager
        if (service === 'tools') return ctx.tools
        if (service === 'systemPrompt') return ctx.systemPrompt
        return undefined
      },
      on(event, fn) {
        if (!listeners.has(event)) listeners.set(event, new Set())
        listeners.get(event).add(fn)
        return () => listeners.get(event)?.delete(fn)
      },
      effect(fn) {
        const dispose = fn()
        if (typeof dispose === 'function') effects.push(dispose)
      },
      inject(deps, cb) {
        if (deps.includes('mcpManager') || deps.includes('systemPrompt')) {
          cb(ctx)
        }
      },
    }

    const instance = apply(ctx, {
      rootDir: tmp,
      socketDir: tmp,
      platform: 'darwin',
      arch: 'arm64',
      autoRegisterMcp: false,
    })

    const syncStatus = await instance.mcpBridge.sync()
    assert.equal(syncStatus.registered, true)
    assert.equal(syncStatus.state, 'connected')
    assert.equal(syncStatus.mountedToolsCount, 2)
    assert.ok(syncStatus.registeredTools.includes('mcp__pibrowse__fury_list'))
    assert.equal(systemPromptSection?.name, 'pibrowse:ops')

    const regCfg = mcpRegistrations.get('pibrowse')
    assert.equal(regCfg.transport, 'stdio')
    assert.equal(regCfg.command, fakeAgent)
    assert.deepEqual(regCfg.args, ['mcp'])
    assert.equal(regCfg.env.FURY_HOME, instance.paths.dataDir)
    assert.equal(regCfg.env.FURY_SOCKET, instance.paths.socketPath)
    assert.equal(regCfg.env.FURY_API_PORT, '')
    assert.equal(regCfg.env.FURY_API_TOKEN, '')

    // Real DSH 2-arg mcp-manager/status event: (name, statusObj)
    for (const fn of listeners.get('mcp-manager/status') || []) {
      fn('other-server', { status: 'error', error: 'unrelated' })
      fn('pibrowse', { status: 'ready', error: null })
    }
    assert.equal(instance.mcpBridge.getStatus().state, 'ready')

    // Dispose all plugin effects and verify MCP tools are withdrawn
    for (const dispose of effects.reverse()) dispose()
    assert.equal(mcpRegistrations.has('pibrowse'), false)
    assert.equal(registeredTools.has('mcp__pibrowse__fury_list'), false)
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})
