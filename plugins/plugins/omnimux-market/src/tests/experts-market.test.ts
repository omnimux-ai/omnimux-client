import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { beforeEach, afterEach } from 'node:test'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { withDefaults } from '../config-store.js'
import {
  handleApi,
  DEFAULT_MARKET_EXPERTS,
  ExpertPresetRuntime,
  buildMarketExpertPresetDefinition,
  expertLedgerPath,
  readExpertLedger,
  materializeEnabledMarketExperts,
  healAgentPresetCordis,
  healInstalledAgentPresets,
  setAgentPresetsNotify,
  setAgentPresetsProvider,
  setExpertPresetRuntime,
  reconcileMarketExperts,
  type AgentPresetRegistryLike,
  type DiscoveredPresetRef,
  type DynamicPresetDefinition,
} from '../local-api.js'

let savedDshHome: string | undefined
let tempHome: string

function createFakeOfficialRegistry(initial: DiscoveredPresetRef[] = [
  { id: 'omni-agent', name: 'OmniMux', order: 1, trust: 'system' },
  { id: 'cordis', name: 'cordis', order: 2, trust: 'system' },
], opts: { brokenIds?: Set<string> } = {}) {
  const registered = new Map<string, DiscoveredPresetRef>(initial.map((p) => [p.id, { ...p }]))
  const definitions = new Map<string, DynamicPresetDefinition>()
  let registerCount = 0
  let unregisterCount = 0

  const registry: AgentPresetRegistryLike = {
    async list() {
      return [...registered.values()].map((p) => ({ ...p }))
    },
    async register(def: DynamicPresetDefinition) {
      if (registered.has(def.id)) {
        throw new Error(`Duplicate agent preset: ${def.id}`)
      }
      registerCount += 1
      definitions.set(def.id, def)
      const broken = opts.brokenIds?.has(def.id) ? 'mock broken plugin row' : undefined
      registered.set(def.id, {
        id: def.id,
        name: def.name,
        description: def.description,
        order: def.order,
        ...(broken ? { broken } : {}),
      })
      let disposed = false
      return async () => {
        if (disposed) return
        disposed = true
        unregisterCount += 1
        registered.delete(def.id)
        definitions.delete(def.id)
      }
    },
  }

  return {
    registry,
    registered,
    definitions,
    get registerCount() { return registerCount },
    get unregisterCount() { return unregisterCount },
  }
}

beforeEach(() => {
  savedDshHome = process.env.DSH_HOME
  tempHome = mkdtempSync(join(tmpdir(), 'omx-expert-market-test-'))
  process.env.DSH_HOME = tempHome
  setExpertPresetRuntime(null)
  setAgentPresetsProvider(null)
  setAgentPresetsNotify(null)
})

afterEach(() => {
  setExpertPresetRuntime(null)
  setAgentPresetsProvider(null)
  setAgentPresetsNotify(null)
  if (savedDshHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = savedDshHome
  rmSync(tempHome, { recursive: true, force: true })
})

function mockReq(method: string, url: string, headers: Record<string, string> = {}, body?: unknown): IncomingMessage {
  const bodyStr = body !== undefined ? JSON.stringify(body) : ''
  const stream = new Readable({
    read() {
      if (bodyStr) this.push(Buffer.from(bodyStr))
      this.push(null)
    },
  }) as unknown as IncomingMessage
  stream.method = method
  stream.url = url
  stream.headers = {
    host: '127.0.0.1:3080',
    ...headers,
  }
  return stream
}

function mockRes(): ServerResponse & { _status: number, _body: string, _json: any } {
  const res = {
    statusCode: 200,
    _status: 200,
    _body: '',
    _json: null,
    setHeader() {},
    end(chunk?: string | Buffer) {
      this._status = this.statusCode
      this._body = chunk == null ? '' : Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
      try {
        this._json = JSON.parse(this._body)
      } catch {
        this._json = null
      }
    },
  }
  return res as unknown as ServerResponse & { _status: number, _body: string, _json: any }
}

const SAME_ORIGIN_HEADERS = {
  origin: 'http://127.0.0.1:3080',
  'sec-fetch-site': 'same-origin',
}

test('DEFAULT_MARKET_EXPERTS defines 8 SOP cross-border experts, all default available with zero Topview residue', () => {
  assert.equal(DEFAULT_MARKET_EXPERTS.length, 8)
  const ids = DEFAULT_MARKET_EXPERTS.map((e) => e.id)
  assert.deepEqual(ids, [
    'ecom-market-research',
    'ecom-product-strategy',
    'ecom-listing-copy',
    'ecom-visual-studio',
    'ecom-video-director',
    'ecom-ads-optimizer',
    'ecom-review-voc',
    'ecom-creator-growth',
  ])
  for (const exp of DEFAULT_MARKET_EXPERTS) {
    assert.equal(exp.initialStatus, 'available', `${exp.id} must default to available (never fake enabled)`)
    assert.ok(exp.name && exp.nameEn, `${exp.id} has bilingual names`)
    assert.ok(exp.description && exp.descriptionEn, `${exp.id} has bilingual descriptions`)
    assert.ok(['research', 'production', 'growth'].includes(exp.stage), `${exp.id} has valid SOP stage`)
    assert.ok(Array.isArray(exp.skills) && exp.skills.length >= 2, `${exp.id} links bundled SOP skills`)
    assert.match(exp.avatar, /^data:image\/svg\+xml/, `${exp.id} uses crisp pixel SVG avatar`)
    assert.match(decodeURIComponent(exp.avatar), /shape-rendering="crispEdges"/)
    assert.doesNotMatch(`${exp.name} ${exp.description} ${exp.descriptionEn}`, /topview/i, `${exp.id} has zero Topview residue`)
  }
})

test('truthful state: fresh env & stale .agent-presets dir never show fake enabled; system presets show [system]', async () => {
  // Simulate legacy stale files under $DSH_HOME/.agent-presets/
  const staleDir = join(tempHome, '.agent-presets', 'ecom-market-research')
  mkdirSync(staleDir, { recursive: true })
  writeFileSync(join(staleDir, 'preset.yml'), 'name: stale\n', 'utf8')
  const staleOldDir = join(tempHome, '.agent-presets', 'media-creator')
  mkdirSync(staleOldDir, { recursive: true })
  writeFileSync(join(staleOldDir, 'preset.yml'), 'name: media-creator\n', 'utf8')

  const fake = createFakeOfficialRegistry()
  const runtime = new ExpertPresetRuntime({ home: () => tempHome, registry: fake.registry })
  setExpertPresetRuntime(runtime)

  const cfg = withDefaults({})
  const res = mockRes()
  await handleApi(mockReq('POST', '/api', SAME_ORIGIN_HEADERS, { method: 'expertMarketList' }), res, cfg)

  assert.equal(res._status, 200)
  assert.equal(res._json?.ok, true)
  const items = res._json.items as any[]
  assert.equal(items.length, 10, '2 system presets + 8 SOP market experts')

  const omni = items.find((it) => it.id === 'omni-agent')
  assert.equal(omni?.status, 'system')
  assert.equal(omni?.name, 'OmniMux')

  const cordis = items.find((it) => it.id === 'cordis')
  assert.equal(cordis?.status, 'system')
  assert.equal(cordis?.name, '创建Agent')
  assert.ok(cordis?.description?.length > 10, 'cordis must have rich localized description')

  for (const exp of DEFAULT_MARKET_EXPERTS) {
    const row = items.find((it) => it.id === exp.id)
    assert.equal(row?.status, 'available', `${exp.id} must be available even if stale .agent-presets/ exists`)
  }
})

test('live install -> official register -> disable -> unregister -> restart restore lifecycle', async () => {
  const fake = createFakeOfficialRegistry()
  let notifyCalls = 0
  setAgentPresetsNotify(() => { notifyCalls += 1 })
  const runtime = new ExpertPresetRuntime({
    home: () => tempHome,
    registry: fake.registry,
    onChanged: () => { notifyCalls += 1 },
  })
  setExpertPresetRuntime(runtime)

  const cfg = withDefaults({})
  const targetId = 'ecom-market-research'

  // 1. Install
  const resInstall = mockRes()
  await handleApi(mockReq('POST', '/api', SAME_ORIGIN_HEADERS, { method: 'expertMarketInstall', id: targetId }), resInstall, cfg)
  assert.equal(resInstall._status, 200)
  assert.equal(resInstall._json?.ok, true)
  assert.equal(resInstall._json?.status, 'enabled')
  assert.equal(fake.registerCount, 1)
  assert.equal(notifyCalls, 1, 'install emits exactly one settings/document-updated notification')

  // Verify mounted preset definition has full Agent-plane stack
  const mountedDef = fake.definitions.get(targetId)
  assert.ok(mountedDef, 'definition passed to ctx.agentPresets.register')
  const pluginNames = mountedDef.plugins.map((r) => r.name)
  assert.ok(pluginNames.includes('@deepseek-ai/dsh-persona'))
  assert.ok(pluginNames.includes('@deepseek-ai/dsh-skill-filesystem'))
  assert.ok(pluginNames.includes('@deepseek-ai/dsh-tool-skill'))
  const personaRow = mountedDef.plugins.find((r) => r.id === 'persona')
  assert.ok(typeof (personaRow?.config as any)?.prefix === 'string' && (personaRow?.config as any).prefix.includes('omnimux-ecom-market-research'))

  // Verify ledger persisted installed expert
  assert.deepEqual(readExpertLedger(tempHome).installed, [targetId])

  // Verify list now shows enabled
  const resList1 = mockRes()
  await handleApi(mockReq('POST', '/api', SAME_ORIGIN_HEADERS, { method: 'expertMarketList' }), resList1, cfg)
  assert.equal(resList1._json.items.find((it: any) => it.id === targetId)?.status, 'enabled')

  // 2. Simulate Host restart with fresh registry + restoreInstalled()
  const fakeAfterRestart = createFakeOfficialRegistry()
  const runtime2 = new ExpertPresetRuntime({
    home: () => tempHome,
    registry: fakeAfterRestart.registry,
    onChanged: () => { notifyCalls += 1 },
  })
  const restored = await runtime2.restoreInstalled()
  assert.deepEqual(restored.restored, [targetId])
  assert.deepEqual(restored.failed, [])
  assert.ok(fakeAfterRestart.registered.has(targetId), 'installed expert restored on boot')
  assert.equal(fakeAfterRestart.registered.size, 3, 'uninstalled experts are NOT materialized on boot')

  // 3. Disable
  setExpertPresetRuntime(runtime2)
  const resDisable = mockRes()
  await handleApi(mockReq('POST', '/api', SAME_ORIGIN_HEADERS, { method: 'expertMarketDisable', id: targetId }), resDisable, cfg)
  assert.equal(resDisable._status, 200)
  assert.equal(resDisable._json?.status, 'disabled')
  assert.equal(fakeAfterRestart.unregisterCount, 1)
  assert.ok(!fakeAfterRestart.registered.has(targetId))
  assert.deepEqual(readExpertLedger(tempHome).installed, [])
  assert.deepEqual(readExpertLedger(tempHome).disabled, [targetId])

  const resList2 = mockRes()
  await handleApi(mockReq('POST', '/api', SAME_ORIGIN_HEADERS, { method: 'expertMarketList' }), resList2, cfg)
  assert.equal(resList2._json.items.find((it: any) => it.id === targetId)?.status, 'disabled')

  // 4. Reject disabling system or custom presets
  for (const forbidden of ['omni-agent', 'cordis', 'user-custom-agent']) {
    const resDeny = mockRes()
    await handleApi(mockReq('POST', '/api', SAME_ORIGIN_HEADERS, { method: 'expertMarketDisable', id: forbidden }), resDeny, cfg)
    assert.equal(resDeny._status, 400, `${forbidden} must not be disableable via expert market`)
    assert.equal(resDeny._json?.ok, false)
  }
})

test('broken preset mount rolls back unregister and does NOT mark enabled in ledger', async () => {
  const targetId = 'ecom-visual-studio'
  const fake = createFakeOfficialRegistry(undefined, { brokenIds: new Set([targetId]) })
  const runtime = new ExpertPresetRuntime({ home: () => tempHome, registry: fake.registry })
  setExpertPresetRuntime(runtime)

  const cfg = withDefaults({})
  const res = mockRes()
  await handleApi(mockReq('POST', '/api', SAME_ORIGIN_HEADERS, { method: 'expertMarketInstall', id: targetId }), res, cfg)

  assert.equal(res._status, 500)
  assert.equal(res._json?.ok, false)
  assert.match(res._json?.error || '', /挂载失败|mock broken plugin row/)
  assert.equal(fake.unregisterCount, 1, 'broken mount must immediately unregister')
  assert.ok(!fake.registered.has(targetId))
  assert.deepEqual(readExpertLedger(tempHome).installed, [], 'broken mount must not pollute installed ledger')
})

test('missing ExpertPresetRuntime returns 503 instead of faking success', async () => {
  const cfg = withDefaults({})
  const res = mockRes()
  await handleApi(mockReq('POST', '/api', SAME_ORIGIN_HEADERS, { method: 'expertMarketInstall', id: 'ecom-listing-copy' }), res, cfg)
  assert.equal(res._status, 503)
  assert.equal(res._json?.ok, false)
})

test('corrupted installed-experts.json degrades cleanly to empty ledger without throwing', () => {
  const p = expertLedgerPath(tempHome)
  mkdirSync(join(tempHome, 'omnimux-market'), { recursive: true })
  writeFileSync(p, '{corrupted json', 'utf8')
  const ledger = readExpertLedger(tempHome)
  assert.deepEqual(ledger.installed, [])
  assert.deepEqual(ledger.disabled, [])
})

test('buildMarketExpertPresetDefinition emits persona.prefix (never retired text key) for all 8 SOP experts', () => {
  for (const exp of DEFAULT_MARKET_EXPERTS) {
    const def = buildMarketExpertPresetDefinition(exp)
    const personaRow = def.plugins.find((r) => r.id === 'persona')
    assert.ok(personaRow && typeof (personaRow.config as any)?.prefix === 'string' && (personaRow.config as any).prefix.length > 50, `${exp.id} must emit rich persona.prefix`)
    assert.ok(!('text' in ((personaRow?.config as Record<string, unknown>) ?? {})), `${exp.id} must not emit retired persona.text key`)
  }
})

test('buildMarketExpertPresetDefinition prunes unresolvable optional rows while keeping persona', () => {
  const exp = DEFAULT_MARKET_EXPERTS[0]
  const def = buildMarketExpertPresetDefinition(exp, {
    platform: 'darwin',
    isPackageResolvable: (pkg) => pkg !== '@deepseek-ai/dsh-tool-ralph',
  })
  const delegation = def.plugins.find((r) => r.id === 'delegation')
  assert.ok(Array.isArray(delegation?.config))
  assert.ok(!(delegation?.config as any[]).some((r) => r.name === '@deepseek-ai/dsh-tool-ralph'))
  assert.ok(def.plugins.some((r) => r.id === 'persona'))
})

test('materializeEnabledMarketExperts is retired no-op (never writes legacy .agent-presets)', () => {
  assert.deepEqual(materializeEnabledMarketExperts(tempHome), [])
  assert.equal(existsSync(join(tempHome, '.agent-presets')), false)
})

test('reconcileMarketExperts aggregates system presets, custom agents, and hides broken market rows from enabled', () => {
  const official: DiscoveredPresetRef[] = [
    { id: 'omni-agent', trust: 'system', name: 'OmniMux' },
    { id: 'cordis', trust: 'system', name: 'cordis' },
    { id: 'ecom-listing-copy', name: '跨境 Listing 与合规文案专家' },
    { id: 'ecom-ads-optimizer', name: '跨境广告诊断与买量优化专家', broken: 'missing plugin' },
    { id: 'my-custom-agent', trust: 'user', name: '我的私有助手', description: '专属定制助手' },
  ]
  const items = reconcileMarketExperts(tempHome, official)
  assert.equal(items.find((it) => it.id === 'omni-agent')?.status, 'system')
  assert.equal(items.find((it) => it.id === 'cordis')?.status, 'system')
  assert.equal(items.find((it) => it.id === 'my-custom-agent')?.status, 'custom')
  assert.equal(items.find((it) => it.id === 'ecom-listing-copy')?.status, 'enabled')
  assert.equal(items.find((it) => it.id === 'ecom-ads-optimizer')?.status, 'available', 'broken preset must never show enabled')
  assert.ok(!items.some((it) => it.id === 'html-generator'))
})

test('healInstalledAgentPresets & healAgentPresetCordis keep backward compatibility for suite presets', () => {
  const dir = join(tempHome, '.agent-presets', 'suite-sample')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'agent.cordis.yml'), [
    '- id: tool-fs-search',
    "  name: '@deepseek-ai/dsh-tool-fs-search'",
    '- id: tool-subagent',
    "  name: '@deepseek-ai/dsh-tool-subagent'",
  ].join('\n'), 'utf8')
  const healed = healInstalledAgentPresets(tempHome)
  assert.equal(healed.length, 1)
  const content = readFileSync(join(dir, 'agent.cordis.yml'), 'utf8')
  assert.ok(content.includes('sampleOverCapGlobResults: false'))
  assert.ok(content.includes('provider: spawn'))
  assert.equal(healAgentPresetCordis(content), content)
})

test('i18n, UI, and host source contracts align with DSH 0.1.7+ agent-preset-registry', () => {
  const i18n = readFileSync(new URL('../../src/client/i18n.js', import.meta.url), 'utf8')
  assert.match(i18n, /"expertMarket\.title": "专家市场"/)
  assert.match(i18n, /"expertMarket\.stageResearch": "选品与策略"/)
  assert.match(i18n, /"expertMarket\.stageProduction": "货架与内容生产"/)
  assert.match(i18n, /"expertMarket\.stageGrowth": "投放与复盘闭环"/)

  const host = readFileSync(new URL('../../src/host.ts', import.meta.url), 'utf8')
  assert.match(host, /new ExpertPresetRuntime\(/, 'host must wire ExpertPresetRuntime')
  assert.match(host, /AGENT_PRESET_SETTINGS_NS\s*=\s*'agent-preset-registry'/, 'must broadcast official agent-preset-registry namespace')
  assert.doesNotMatch(host, /materializeEnabledMarketExperts/, 'host must not auto-materialize retired .agent-presets/')
})
