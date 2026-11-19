import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'

const source = readFileSync(new URL('./apply.js', import.meta.url), 'utf8')

function loadApply(extraContext = {}) {
  const sandbox = {
    plazaSessions: null,
    plazaUiWorkspace: null,
    plazaWorkspaces: null,
    plazaRemote: null,
    setTimeout,
    clearInterval,
    console,
    ...extraContext,
  }
  const mod = runInNewContext(`${source}\n({ inject, apply })`, sandbox)
  return { ...mod, sandbox }
}

function makeContext({ services = {} } = {}) {
  const slotCalls = []
  const injectCalls = []
  const ctx = {
    slots: {
      inject: (...args) => slotCalls.push(args),
      register: () => () => {},
    },
    sessions: {},
    effect: () => () => {},
    inject: (deps, cb) => {
      injectCalls.push(deps)
      if (deps.every(dep => Object.hasOwn(services, dep))) cb(services)
    },
    get: name => services[name] ?? null,
  }
  return { ctx, slotCalls, injectCalls }
}

test('顶层 inject 不硬依赖 uiWorkspace，apply 在缺失时仍执行', () => {
  const mod = loadApply()
  assert.deepEqual([...mod.inject], ['slots', 'sessions'])
  assert.equal(mod.inject.includes('uiWorkspace'), false)

  const { ctx, slotCalls, injectCalls } = makeContext()
  assert.doesNotThrow(() => mod.apply(ctx))
  assert.ok(slotCalls.length > 0, 'apply 必须继续执行并注册 slot')
  assert.ok(
    injectCalls.some(deps => deps.length === 1 && deps[0] === 'uiWorkspace'),
    'uiWorkspace 必须走可选 ctx.inject',
  )
})

test('uiWorkspace 服务可用时懒挂到 plazaUiWorkspace', () => {
  const ui = { openSession() {} }
  const { ctx } = makeContext({ services: { uiWorkspace: ui } })
  const mod = loadApply()
  assert.doesNotThrow(() => mod.apply(ctx))
  assert.equal(mod.sandbox.plazaUiWorkspace, ui)
})
