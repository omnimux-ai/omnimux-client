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

test('resolveManagedToolDomain and computeDeniedTools classify all managed OmniMux domains, keep Hub core utilities unmanaged, and pass through third-party plugins & MCP tools', () => {
  assert.equal(resolveManagedToolDomain('tiktok_selection_create_task'), 'tiktok_selection')
  assert.equal(resolveManagedToolDomain('products_list'), 'products')
  assert.equal(resolveManagedToolDomain('clip_export'), 'clip')
  assert.equal(resolveManagedToolDomain('workflow_run'), 'workflow')
  assert.equal(resolveManagedToolDomain('publish_submit'), 'publish_accounts')
  assert.equal(resolveManagedToolDomain('omnimux_accounts_list'), 'publish_accounts')
  assert.equal(resolveManagedToolDomain('analytics_query_metrics'), 'analytics')
  assert.equal(resolveManagedToolDomain('browser_open_tab'), 'browser')
  assert.equal(resolveManagedToolDomain('mcp__pibrowse__navigate'), 'pibrowse')
  assert.equal(resolveManagedToolDomain('display_file'), 'viewer')
  assert.equal(resolveManagedToolDomain('skillhub_search'), 'market')
  assert.equal(resolveManagedToolDomain('omnimux_creative_templates_search'), 'inspiration')

  // All 16 direct social-data tools + omnimux_social_data belong to social_data
  for (const socialTool of [
    'omnimux_social_data',
    'omnimux_tiktok_video',
    'omnimux_tiktok_shop_search',
    'omnimux_instagram_post',
    'omnimux_x_tweet',
    'omnimux_youtube_video',
  ]) {
    assert.equal(resolveManagedToolDomain(socialTool), 'social_data', `${socialTool} must map to social_data`)
  }

  // Hub shared core utilities stay unmanaged (never denied even when social_data is excluded)
  for (const coreTool of ['omnimux_text_complete', 'omnimux_page_fetch', 'omnimux_jev_decision', 'omnimux_speech_to_text']) {
    assert.equal(resolveManagedToolDomain(coreTool), null, `${coreTool} must remain unmanaged shared core`)
  }

  // Third-party MCP tools and third-party non-MCP Cordis tools with generic prefixes stay unmanaged
  for (const externalTool of [
    'mcp__user_erp__query_inventory',
    'custom_third_party_tool',
    'browser_playwright_eval',
    'video_ffmpeg_trim',
    'analytics_ga4_report',
  ]) {
    assert.equal(resolveManagedToolDomain(externalTool), null, `${externalTool} must not hit false-positive managed domain`)
  }

  const denied = computeDeniedTools(
    [
      'products_list',
      'tiktok_selection_create_task',
      'clip_export',
      'workflow_run',
      'publish_submit',
      'omnimux_tiktok_video',
      'omnimux_text_complete',
      'browser_playwright_eval',
      'mcp__user_erp__query_inventory',
    ],
    ['products', 'tiktok_selection'],
  )
  assert.deepEqual(denied, ['clip_export', 'omnimux_tiktok_video', 'publish_submit', 'workflow_run'])
  assert.ok(ALL_EXPERT_TOOL_DOMAINS.includes('tiktok_selection'))
})

test('real Cordis + dsh-tools: expert-tool-scope hides out-of-domain Host tools while keeping allowed domains, Hub core utilities, Agent own-scope tools, and external plugins/MCP tools', async (t) => {
  const harness = await createRealToolsHarness()
  const { root } = harness
  t.after(async () => { await harness.dispose() })

  const hostTools = [
    'products_list',
    'assets_list',
    'workflow_run',
    'omnimux_image_submit',
    'omnimux_text_complete',
    'tiktok_selection_list_tasks',
    'omnimux_tiktok_video',
    'omnimux_instagram_post',
    'clip_export',
    'publish_submit',
    'analytics_query_metrics',
    'browser_open_tab',
    'mcp__pibrowse__click',
    'display_file',
    'browser_playwright_eval',
    'mcp__user_erp__query_inventory',
    'custom_notion_search',
  ]
  for (const name of hostTools) {
    root.tools.register(makeTool(name))
  }

  // Visual Designer excludes social_data, tiktok_selection, clip, publish_accounts, analytics, browser, pibrowse
  const presetKey = { scope: 'preset:ecom-visual-studio' }
  const presetScope = createScope(root, presetKey)
  const fiber = presetScope.ctx.plugin(expertToolScopePlugin, {
    presetId: 'ecom-visual-studio',
    allowedDomains: ['products', 'assets', 'inspiration', 'workflow', 'media_gen', 'viewer', 'market', 'workbench'],
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
  assert.equal(visibleNames.has('assets_list'), true)
  assert.equal(visibleNames.has('workflow_run'), true)
  assert.equal(visibleNames.has('omnimux_image_submit'), true)
  assert.equal(visibleNames.has('display_file'), true)

  // Shared Hub core multimodal fallback stays visible even without social_data
  assert.equal(visibleNames.has('omnimux_text_complete'), true)

  // Own-scope Agent core tools are untouched
  assert.equal(visibleNames.has('read'), true)
  assert.equal(visibleNames.has('bash'), true)
  assert.equal(visibleNames.has('skill'), true)

  // External MCP tools and third-party non-MCP plugins are untouched
  assert.equal(visibleNames.has('mcp__user_erp__query_inventory'), true)
  assert.equal(visibleNames.has('custom_notion_search'), true)
  assert.equal(visibleNames.has('browser_playwright_eval'), true)

  // Out-of-domain OmniMux managed tools (including direct social tools) are hidden
  for (const hidden of [
    'tiktok_selection_list_tasks',
    'omnimux_tiktok_video',
    'omnimux_instagram_post',
    'clip_export',
    'publish_submit',
    'analytics_query_metrics',
    'browser_open_tab',
    'mcp__pibrowse__click',
  ]) {
    assert.equal(visibleNames.has(hidden), false, `${hidden} must be hidden for ecom-visual-studio`)
    assert.equal(root.tools.get(hidden, agentKey), undefined, `${hidden} get() must return undefined`)
  }

  // Global (unscoped) Host view remains completely unaffected (e.g. for omni-agent)
  assert.ok(root.tools.get('clip_export'), 'global clip_export stays visible outside scoped expert')
  assert.ok(root.tools.get('omnimux_tiktok_video'), 'global omnimux_tiktok_video stays visible outside scoped expert')

  // Disposing the preset plugin lifts the restriction cleanly
  await fiber.dispose()
  assert.ok(root.tools.get('clip_export', agentKey), 'disposing plugin restores global tool visibility')
  await agentScope.dispose()
  await presetScope.dispose()
})

test('real Cordis + dsh-tools: empty deny set is a clean no-op, late-registered tools reconcile dynamically, and unregistering back to empty deny lifts restriction cleanly', async (t) => {
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
  const unregisterClip = root.tools.register(makeTool('clip_edit'))
  root.tools.register(makeTool('mcp__user_jira__search'))

  // Reconciled dynamically: out-of-domain managed tool hidden, external MCP tool visible, zero infinite loop
  assert.equal(root.tools.get('clip_edit', agentKey), undefined)
  assert.ok(root.tools.get('mcp__user_jira__search', agentKey))
  assert.ok(changeCount - beforeLate <= 6, `tools/change must not loop recursively (observed ${changeCount - beforeLate})`)

  // Unregistering the only denied tool brings deny set back to empty cleanly without throwing
  assert.doesNotThrow(() => unregisterClip())
  assert.ok(root.tools.get('products_list', agentKey))
  assert.ok(root.tools.get('mcp__user_jira__search', agentKey))

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
