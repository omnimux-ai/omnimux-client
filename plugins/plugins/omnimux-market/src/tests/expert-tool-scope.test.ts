import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { ToolsService, defineTool } from '@deepseek-ai/dsh-tools'
import {
  ALL_EXPERT_TOOL_DOMAINS,
  computeDeniedTools,
  resolveManagedToolDomain,
} from '../expert-tool-domains.js'
import * as expertToolScopePlugin from '../expert-tool-scope-plugin.js'
import { DEFAULT_MARKET_EXPERTS } from '../expert-market.js'
import { buildMarketExpertPresetDefinition } from '../expert-runtime.js'

const localRequire = createRequire(import.meta.url)
const toolsPkgPath = localRequire.resolve('@deepseek-ai/dsh-tools/package.json')
const toolsRequire = createRequire(toolsPkgPath)
const { createScope } = toolsRequire('@deepseek-ai/dsh-scope') as {
  createScope: (ctx: Context, key: object, options?: { parent?: object }) => {
    ctx: Context
    dispose: () => Promise<void>
  }
}
const { SystemPrompt } = toolsRequire('@deepseek-ai/dsh-system-prompt') as {
  SystemPrompt: any
}

function makeTool(name: string) {
  return defineTool({
    name,
    description: `Test tool ${name}`,
    parameters: {},
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute() {
      return 'ok'
    },
  })
}

async function createRealToolsHarness() {
  const root = new Context()
  const promptFiber = root.plugin(SystemPrompt)
  const toolsFiber = root.plugin(ToolsService)
  await promptFiber
  await toolsFiber
  return {
    root,
    async dispose() {
      await toolsFiber.dispose()
      await promptFiber.dispose()
    },
  }
}

test('resolveManagedToolDomain and computeDeniedTools classify managed OmniMux tools and pass through third-party MCP tools', () => {
  assert.equal(resolveManagedToolDomain('tiktok_selection_create_task'), 'tiktok_selection')
  assert.equal(resolveManagedToolDomain('products_list'), 'products')
  assert.equal(resolveManagedToolDomain('clip_export'), 'clip')
  assert.equal(resolveManagedToolDomain('workflow_run'), 'workflow')
  assert.equal(resolveManagedToolDomain('publish_create_task'), 'publish_accounts')
  assert.equal(resolveManagedToolDomain('mcp__pibrowse__navigate'), 'pibrowse')
  assert.equal(resolveManagedToolDomain('display_file'), 'viewer')
  assert.equal(resolveManagedToolDomain('skillhub_search'), 'market')
  assert.equal(resolveManagedToolDomain('omnimux_social_data'), 'social_data')
  assert.equal(resolveManagedToolDomain('mcp__user_erp__query_inventory'), null)
  assert.equal(resolveManagedToolDomain('custom_third_party_tool'), null)

  const denied = computeDeniedTools(
    [
      'products_list',
      'tiktok_selection_create_task',
      'clip_export',
      'workflow_run',
      'publish_create_task',
      'mcp__user_erp__query_inventory',
      'custom_third_party_tool',
    ],
    ['products', 'tiktok_selection'],
  )
  assert.deepEqual(denied, ['clip_export', 'publish_create_task', 'workflow_run'])
  assert.ok(ALL_EXPERT_TOOL_DOMAINS.includes('tiktok_selection'))
})

test('real Cordis + dsh-tools: expert-tool-scope hides out-of-domain Host tools while keeping allowed domains, Agent own-scope tools, and external MCP tools', async (t) => {
  const harness = await createRealToolsHarness()
  const { root } = harness
  t.after(async () => { await harness.dispose() })

  const hostTools = [
    'products_list',
    'tiktok_selection_list_tasks',
    'tiktok_selection_create_task',
    'clip_export',
    'workflow_canvas_run',
    'assets_list',
    'publish_submit',
    'analytics_query',
    'browser_open',
    'mcp__pibrowse__click',
    'display_file',
    'mcp__user_erp__query_inventory',
    'custom_notion_search',
  ]
  for (const name of hostTools) {
    root.tools.register(makeTool(name))
  }

  // Preset scope mirrors `agentPresets.register()`: scoped child context where preset plugins mount
  const presetKey = { scope: 'preset:ecom-market-research' }
  const presetScope = createScope(root, presetKey)
  const fiber = presetScope.ctx.plugin(expertToolScopePlugin, {
    presetId: 'ecom-market-research',
    allowedDomains: ['products', 'tiktok_selection', 'viewer'],
  })
  await fiber

  // Agent session scope inherits from preset scope (just like DSH AgentSession)
  const agentKey = { scope: 'agent:session-1' }
  const agentScope = createScope(root, agentKey, { parent: presetKey })
  await agentScope.ctx.plugin({
    name: 'test-agent-core-tools',
    inject: ['tools'],
    apply(ctx: Context) {
      ctx.tools.register(makeTool('read'))
      ctx.tools.register(makeTool('bash'))
      ctx.tools.register(makeTool('skill'))
    },
  })

  const visibleNames = new Set(root.tools.schemas(agentKey).map((s) => s.name))

  // Allowed OmniMux domains remain visible
  assert.equal(visibleNames.has('products_list'), true)
  assert.equal(visibleNames.has('tiktok_selection_list_tasks'), true)
  assert.equal(visibleNames.has('tiktok_selection_create_task'), true)
  assert.equal(visibleNames.has('display_file'), true)

  // Own-scope Agent core tools are untouched
  assert.equal(visibleNames.has('read'), true)
  assert.equal(visibleNames.has('bash'), true)
  assert.equal(visibleNames.has('skill'), true)

  // External / user-installed third-party MCP tools are untouched
  assert.equal(visibleNames.has('mcp__user_erp__query_inventory'), true)
  assert.equal(visibleNames.has('custom_notion_search'), true)

  // Out-of-domain OmniMux managed tools are hidden from schemas() and get()
  for (const hidden of ['clip_export', 'workflow_canvas_run', 'assets_list', 'publish_submit', 'analytics_query', 'browser_open', 'mcp__pibrowse__click']) {
    assert.equal(visibleNames.has(hidden), false, `${hidden} must be hidden for ecom-market-research`)
    assert.equal(root.tools.get(hidden, agentKey), undefined, `${hidden} get() must return undefined`)
  }

  // Global (unscoped) Host view remains completely unaffected (e.g. for omni-agent)
  assert.ok(root.tools.get('clip_export'), 'global clip_export stays visible outside scoped expert')
  assert.ok(root.tools.get('publish_submit'), 'global publish_submit stays visible outside scoped expert')

  // Disposing the preset plugin lifts the restriction cleanly
  await fiber.dispose()
  assert.ok(root.tools.get('clip_export', agentKey), 'disposing plugin restores global tool visibility')
  await agentScope.dispose()
  await presetScope.dispose()
})

test('real Cordis + dsh-tools: empty deny set is a clean no-op and late-registered Host tools reconcile dynamically without recursion', async (t) => {
  const harness = await createRealToolsHarness()
  const { root } = harness
  t.after(async () => { await harness.dispose() })

  // Start with only an allowed domain tool + external tool -> empty deny set must NOT throw
  root.tools.register(makeTool('products_list'))
  root.tools.register(makeTool('mcp__user_slack__post'))

  let changeCount = 0
  root.on('tools/change', () => { changeCount += 1 })

  const presetKey = { scope: 'preset:ecom-product-strategy' }
  const presetScope = createScope(root, presetKey)
  await presetScope.ctx.plugin(expertToolScopePlugin, {
    presetId: 'ecom-product-strategy',
    allowedDomains: ['products', 'viewer'],
  })

  const agentKey = { scope: 'agent:session-2' }
  const agentScope = createScope(root, agentKey, { parent: presetKey })

  assert.ok(root.tools.get('products_list', agentKey))
  assert.ok(root.tools.get('mcp__user_slack__post', agentKey))

  // Late-loading Host plugin registers out-of-domain clip tool + another external MCP tool
  const beforeLate = changeCount
  root.tools.register(makeTool('clip_timeline_cut'))
  root.tools.register(makeTool('mcp__user_jira__search'))

  // Reconciled dynamically: out-of-domain managed tool hidden, external MCP tool visible, zero infinite loop
  assert.equal(root.tools.get('clip_timeline_cut', agentKey), undefined)
  assert.ok(root.tools.get('mcp__user_jira__search', agentKey))
  assert.ok(changeCount - beforeLate <= 6, `tools/change must not loop recursively (observed ${changeCount - beforeLate})`)

  await agentScope.dispose()
  await presetScope.dispose()
})

test('all 10 market experts declare valid toolDomains and emit expert-tool-scope rows without leaking services', () => {
  assert.equal(DEFAULT_MARKET_EXPERTS.length, 10)
  const validDomains = new Set<string>(ALL_EXPERT_TOOL_DOMAINS)

  for (const exp of DEFAULT_MARKET_EXPERTS) {
    assert.ok(Array.isArray(exp.toolDomains) && exp.toolDomains.length >= 2, `${exp.id} must declare toolDomains`)
    for (const domain of exp.toolDomains!) {
      assert.ok(validDomains.has(domain), `${exp.id} references unknown domain ${domain}`)
    }
    const def = buildMarketExpertPresetDefinition(exp)
    const scopeRow = def.plugins.find((row) => row.id === 'expert-tool-scope')
    assert.ok(scopeRow, `${exp.id} preset definition must mount expert-tool-scope`)
    assert.equal(scopeRow!.name, 'omnimux-market/expert-tool-scope')
    assert.deepEqual((scopeRow!.config as { allowedDomains?: string[] })?.allowedDomains, exp.toolDomains)
  }

  // Ensure plugin metadata matches Cordis conventions (no service provided -> zero leakedServices)
  assert.equal(expertToolScopePlugin.name, 'omnimux-market-expert-tool-scope')
  assert.deepEqual(expertToolScopePlugin.inject, ['tools'])
})
