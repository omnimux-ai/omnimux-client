import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadClientModule } from '../../tests/helpers/client-esm-loader.mjs'

function loadApply(extraContext = {}) {
  const runtime = {
    plazaKeepAlive: true,
    plazaSessions: null,
    plazaUiWorkspace: null,
    plazaWorkspaces: null,
    plazaRemote: null,
  }
  const mod = loadClientModule('./apply.js', {
    globals: {
      setTimeout,
      clearInterval,
      console,
      ...extraContext,
    },
    modules: {
      './boot.js': {
        SkillShelf: { findPresetSkill: () => null },
        createWorkbenchSidebarEntry: () => () => {},
        h: () => null,
      },
      './css.js': { ensureCss: () => () => {} },
      './i18n.js': { EN: {}, ZH: {}, lookup: (k) => k },
      './runtime-state.js': { marketRuntime: runtime },
      './tool-views.js': { PlazaSearchToolView: () => null, SearchToolView: () => null },
      './list-view.js': { ListToolView: () => null },
      './settings.js': { ConfigCard: () => null },
      './skill-plaza.js': { DEFAULT_MARKET_EXPERTS: [], buildExpertStartersLookup: () => null, renderPlazaIcon: () => null },
      './skill-picker.js': { SkillPickerButton: () => null },
      './plaza-shell.js': { PLAZA_TAB_ID: 'omnimux-market:plaza', PlazaView: () => null },
    },
  })
  return { ...mod, runtime }
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
  assert.equal(mod.runtime.plazaUiWorkspace, ui)
})
