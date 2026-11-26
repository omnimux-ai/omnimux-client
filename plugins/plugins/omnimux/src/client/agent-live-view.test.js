import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  AGENT_AUTO_REFRESH_MS,
  agentCardSubtitle,
  agentConnectionBadge,
  agentModelSource,
  agentScanUrl,
  agentStatusText,
  agentUpdatesUrl,
  canImportCliAuth,
  countInstalledAgents,
  isAgentSelectable,
  shouldAutoRefresh,
} from './agent-live-view.js'

function t(key, params) {
  const map = new Map([
    ['runtime.cliNeedsLogin', '需要登录'],
    ['runtime.unconfigured', '未配置'],
    ['runtime.notDetected', '未检测到程序安装'],
    ['runtime.badgeConnected', '已连接'],
    ['runtime.badgeCliReady', '可复用本机登录'],
    ['runtime.badgeOAuth', '账号授权'],
    ['runtime.badgeCliOnly', '仅本机 CLI'],
    ['runtime.noCliNeeded', '无需安装 CLI，支持账号授权'],
    ['runtime.modelsReadyCount', `${params?.count ?? ''} 个对话模型可用`],
  ])
  return map.get(key) ?? key
}

describe('agentScanUrl', () => {
  it('asks the Host to skip its cache only for an explicit scan', () => {
    assert.equal(agentScanUrl(), '/omnimux/agents')
    assert.equal(agentScanUrl(false), '/omnimux/agents')
    assert.equal(agentScanUrl(true), '/omnimux/agents?refresh=1')
    assert.equal(agentUpdatesUrl(true), '/omnimux/agents/updates?refresh=1')
    assert.equal(agentUpdatesUrl(), '/omnimux/agents/updates')
  })
})

describe('countInstalledAgents', () => {
  it('counts only rows the scan proved installed', () => {
    assert.equal(countInstalledAgents([{ installed: true }, { installed: false }, { installed: true }]), 2)
    assert.equal(countInstalledAgents([]), 0)
    assert.equal(countInstalledAgents(null), 0)
  })
})

describe('agentStatusText', () => {
  it('prefers the live version and explains an unusable CLI', () => {
    assert.equal(agentStatusText(t, { version: 'codex-cli 0.167.0' }), 'codex-cli 0.167.0')
    assert.equal(agentStatusText(t, { version: '' }), '未检测到程序安装')
    assert.equal(agentStatusText(t, { auth: { state: 'signed-out', loginSupported: true } }), '需要登录')
    assert.equal(agentStatusText(t, { auth: { state: 'signed-out', loginSupported: false } }), '未配置')
    assert.equal(agentStatusText(t, { version: '2.5.2', auth: { state: 'signed-in' } }), '2.5.2')
  })
})

describe('agentModelSource', () => {
  it('maps only the two Host-declared provenances', () => {
    assert.equal(agentModelSource({ modelsSource: 'live' }), 'live')
    assert.equal(agentModelSource({ modelsSource: 'preset' }), 'preset')
    assert.equal(agentModelSource({}), '')
    assert.equal(agentModelSource(null), '')
  })
})

describe('shouldAutoRefresh', () => {
  it('throttles focus re-scans and never runs while hidden', () => {
    assert.equal(shouldAutoRefresh(0, 1000, 'visible'), true)
    assert.equal(shouldAutoRefresh(0, 1000, 'hidden'), false)
    assert.equal(shouldAutoRefresh(1000, 1000 + AGENT_AUTO_REFRESH_MS - 1), false)
    assert.equal(shouldAutoRefresh(1000, 1000 + AGENT_AUTO_REFRESH_MS), true)
    assert.equal(shouldAutoRefresh(Number.NaN, 1000), true)
  })
})

describe('subscription fusion view helpers', () => {
  it('allows selecting uninstalled agents when subscription OAuth is supported', () => {
    assert.equal(isAgentSelectable({ id: 'codex', installed: false, subscription: { supported: true } }), true)
    assert.equal(isAgentSelectable({ id: 'qwen', installed: false, subscription: { supported: false } }), false)
    assert.equal(isAgentSelectable({ id: 'qwen', installed: true, subscription: { supported: false } }), true)
  })

  it('derives badges, import readiness, and subtitles cleanly without middle dots', () => {
    const connected = {
      id: 'codex',
      installed: false,
      subscription: { supported: true, connected: true, liveModels: ['gpt-6.1-sol', 'gpt-5.6-sol'] },
    }
    assert.deepEqual(agentConnectionBadge(t, connected), { kind: 'connected', label: '已连接' })
    assert.equal(agentCardSubtitle(t, connected), '2 个对话模型可用')

    const importable = {
      id: 'codex',
      installed: true,
      version: 'codex-cli 0.167.0',
      subscription: { supported: true, connected: false, cliImport: { importable: true } },
    }
    assert.equal(canImportCliAuth(importable), true)
    assert.deepEqual(agentConnectionBadge(t, importable), { kind: 'cli-ready', label: '可复用本机登录' })
    assert.equal(agentCardSubtitle(t, importable), 'codex-cli 0.167.0')

    const oauthOnly = {
      id: 'claude',
      installed: false,
      subscription: { supported: true, connected: false, cliImport: { importable: false } },
    }
    assert.equal(canImportCliAuth(oauthOnly), false)
    assert.deepEqual(agentConnectionBadge(t, oauthOnly), { kind: 'oauth', label: '账号授权' })
    assert.equal(agentCardSubtitle(t, oauthOnly), '无需安装 CLI，支持账号授权')
  })
})