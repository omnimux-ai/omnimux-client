import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import { formatDownloadMeta, NextUpdateSettings, pickUpdateNotes, splitUpdateNote, updatePrimaryButtonLabel } from '../../src/client/updates.tsx'
import { SidebarUpdatePillView, UpdateShellOverlayView, shouldShowSidebarUpdatePill } from '../../src/client/update-indicator.tsx'
import { DEFAULT_PREFERENCES, type DesktopState } from '../../src/desktop-contract.ts'
import type { NextUpdateState } from '../../src/update-state.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Button: ({ children, ...props }: Record<string, unknown>) => createElement('button', props, children as never),
  useModalLayer: () => {},
}))

const baseState: DesktopState = {
  selected: 'desktop',
  profiles: ['desktop'],
  unavailableProfiles: [],
  features: { market: false, remoteControl: false },
  preferences: { ...DEFAULT_PREFERENCES },
  phase: 'ready',
  busy: false,
  failure: '',
  safeMode: false,
  home: '/fixture',
  platform: 'darwin',
  version: '2.0.25',
  trayAvailable: true,
  notificationsAvailable: true,
  browserUrl: null,
  lan: null,
  checkpoint: null,
  logs: '',
  updates: { phase: 'idle', installable: true, environment: 'production', channel: 'stable' },
}

it('renders OmniMux version without middle-dot separator, shows Dev/Beta/Required badges, inline notes, and size', () => {
  const available: NextUpdateState = {
    phase: 'available',
    version: '2.0.26',
    installable: true,
    environment: 'production',
    channel: 'beta',
    mandatory: true,
    artifactSize: 128 * 1024 * 1024,
    releaseNotes: {
      zh: ['要点一', '要点二', '要点三', '要点四', '要点五', '超出五条不显示'],
      en: ['Bullet 1', 'Bullet 2'],
    },
  }
  const zhHtml = renderToStaticMarkup(createElement(NextUpdateSettings, {
    state: { ...baseState, updates: available },
    language: 'zh-CN',
    run: vi.fn(),
  }))
  expect(zhHtml).toContain('OmniMux v2.0.25')
  expect(zhHtml).not.toContain('·')
  expect(zhHtml).toContain('Beta')
  expect(zhHtml).toContain('必需更新')
  expect(zhHtml).toContain('128 MB')
  expect(zhHtml).toContain('要点一')
  expect(zhHtml).toContain('要点五')
  expect(zhHtml).not.toContain('超出五条不显示')

  const enHtml = renderToStaticMarkup(createElement(NextUpdateSettings, {
    state: { ...baseState, updates: { ...available, environment: 'dev', installable: false, mandatory: false } },
    language: 'en-US',
    run: vi.fn(),
  }))
  expect(enHtml).toContain('Dev')
  expect(enHtml).toContain('Bullet 1')
  expect(enHtml).toContain('OmniMux Dev')
  expect(enHtml).not.toContain('·')

  // Locale fallback when preferred language array is empty.
  expect(pickUpdateNotes({ phase: 'available', installable: true, releaseNotes: { zh: [], en: ['Fallback EN'] } }, 'zh-CN')).toEqual(['Fallback EN'])
  expect(pickUpdateNotes({ phase: 'available', installable: true, releaseNotes: { zh: ['中文兜底'], en: [] } }, 'en-US')).toEqual(['中文兜底'])
})

it('shows cancel action during downloading/preparing, consistent units, transient labels, and expandable errorCode trigger', () => {
  const downloading = renderToStaticMarkup(createElement(NextUpdateSettings, {
    state: {
      ...baseState,
      updates: { phase: 'downloading', version: '2.0.26', installable: true, received: 64 * 1024 * 1024, total: 128 * 1024 * 1024 },
    },
    language: 'zh-CN',
    run: vi.fn(),
  }))
  expect(downloading).toContain('<progress')
  expect(downloading).toContain('64 MB / 128 MB')
  expect(downloading).toMatch(/<button[^>]*>取消<\/button>/)
  expect(downloading).not.toContain('·')

  // When total >= 1 GiB, both received and total use GB consistently.
  expect(formatDownloadMeta({
    phase: 'downloading',
    installable: true,
    received: Math.round(0.5 * 1024 * 1024 * 1024),
    total: Math.round(1.5 * 1024 * 1024 * 1024),
  })).toBe('0.50 GB / 1.50 GB')

  expect(updatePrimaryButtonLabel({ phase: 'installing', installable: true }, undefined, false, 'zh-CN')).toBe('正在安装…')
  expect(updatePrimaryButtonLabel({ phase: 'checking', installable: true }, undefined, false, 'en-US')).toBe('Checking…')

  const errored = renderToStaticMarkup(createElement(NextUpdateSettings, {
    state: {
      ...baseState,
      updates: { phase: 'error', version: '2.0.26', installable: true, error: 'download', errorCode: 'APP_TRANSLOCATED' },
    },
    language: 'zh-CN',
    run: vi.fn(),
  }))
  expect(errored).toContain('role="alert"')
  expect(errored).toContain('查看诊断码')
  expect(errored).toContain('aria-expanded="false"')
  expect(errored).not.toContain('·')
})

it('renders SidebarUpdatePill only for actionable phases (and adapts to compact rail mode)', () => {
  expect(shouldShowSidebarUpdatePill({ phase: 'idle', installable: true })).toBe(false)
  expect(shouldShowSidebarUpdatePill({ phase: 'current', installable: true })).toBe(false)
  expect(shouldShowSidebarUpdatePill({ phase: 'current', installable: true, mandatory: true })).toBe(false)
  expect(shouldShowSidebarUpdatePill({ phase: 'error', installable: true })).toBe(false)
  expect(shouldShowSidebarUpdatePill({ phase: 'error', installable: true, mandatory: true })).toBe(true)
  expect(shouldShowSidebarUpdatePill({ phase: 'available', version: '2.0.26', installable: true })).toBe(true)
  expect(shouldShowSidebarUpdatePill({ phase: 'ready', version: '2.0.26', installable: true })).toBe(true)

  const idleHtml = renderToStaticMarkup(createElement(SidebarUpdatePillView, {
    state: baseState,
    language: 'zh-CN',
    onOpen: vi.fn(),
  }))
  expect(idleHtml).toBe('')

  const readyHtml = renderToStaticMarkup(createElement(SidebarUpdatePillView, {
    state: { ...baseState, updates: { phase: 'ready', version: '2.0.26', installable: true } },
    language: 'zh-CN',
    wide: true,
    onOpen: vi.fn(),
  }))
  expect(readyHtml).toContain('data-next-update-pill')
  expect(readyHtml).toContain('重启以完成更新')
  expect(readyHtml).toContain('v2.0.26')
  expect(readyHtml).not.toContain('data-compact')
  expect(readyHtml).not.toContain('·')

  // Collapsed sidebar rail hides text/version while preserving accessible name.
  const railHtml = renderToStaticMarkup(createElement(SidebarUpdatePillView, {
    state: { ...baseState, updates: { phase: 'ready', version: '2.0.26', installable: true } },
    language: 'zh-CN',
    wide: false,
    onOpen: vi.fn(),
  }))
  expect(railHtml).toContain('data-compact="true"')
  expect(railHtml).toContain('aria-label="重启以完成更新 v2.0.26"')
  expect(railHtml).not.toContain('dshUpdatePillText')
})

it('renders post-update notice (suppressed in Safe Mode & pinned to installed version) and non-dismissible mandatory modal', () => {
  const postNoticeHtml = renderToStaticMarkup(createElement(UpdateShellOverlayView, {
    state: {
      ...baseState,
      version: '2.0.26',
      updates: {
        phase: 'available',
        version: '2.0.27',
        releaseNotesUrl: 'https://github.com/omnimux-ai/omnimux-client/releases/tag/v2.0.27',
        installable: true,
        justUpdatedFrom: '2.0.25',
      },
    },
    language: 'zh-CN',
    run: vi.fn(),
  }))
  expect(postNoticeHtml).toContain('data-next-post-update-notice')
  expect(postNoticeHtml).toContain('已更新至 OmniMux v2.0.26')
  expect(postNoticeHtml).toContain('href="https://github.com/omnimux-ai/omnimux-client/releases/tag/v2.0.26"')
  expect(postNoticeHtml).not.toContain('tag/v2.0.27')
  expect(postNoticeHtml).not.toContain('·')

  // Safe Mode suppresses post-update notice so SafeModeNotice stays unobstructed.
  const safeModeHtml = renderToStaticMarkup(createElement(UpdateShellOverlayView, {
    state: {
      ...baseState,
      safeMode: true,
      version: '2.0.26',
      updates: { phase: 'current', version: '2.0.26', installable: true, justUpdatedFrom: '2.0.25' },
    },
    language: 'zh-CN',
    run: vi.fn(),
  }))
  expect(safeModeHtml).toBe('')

  const mandatoryHtml = renderToStaticMarkup(createElement(UpdateShellOverlayView, {
    state: {
      ...baseState,
      version: '2.0.19',
      updates: {
        phase: 'available',
        version: '2.0.26',
        installable: true,
        mandatory: true,
        minSupportedVersion: '2.0.20',
        releaseNotes: { zh: ['关键修复'], en: ['Critical fix'] },
      },
    },
    language: 'zh-CN',
    run: vi.fn(),
  }))
  expect(mandatoryHtml).toContain('data-next-mandatory-update')
  expect(mandatoryHtml).toContain('role="dialog"')
  expect(mandatoryHtml).toContain('aria-modal="true"')
  expect(mandatoryHtml).toContain('tabindex="-1"')
  expect(mandatoryHtml).toContain('data-modal-autofocus=""')
  expect(mandatoryHtml).toContain('href="https://dl.omnimux.ai/"')
  expect(mandatoryHtml).toContain('最低支持版本 v2.0.20')
  expect(mandatoryHtml).toContain('关键修复')
  expect(mandatoryHtml).not.toContain('data-next-post-update-notice')
  expect(mandatoryHtml).not.toContain('·')
})

it('uses only real allowlisted --dsw-* tokens and zero bare hex/rgba colors in updater CSS', () => {
  const stylesSource = readFileSync(
    fileURLToPath(new URL('../../src/client/desktop-settings-styles.ts', import.meta.url)),
    'utf8',
  )
  const allowlistJson = JSON.parse(readFileSync(
    fileURLToPath(new URL('../../../../plugins/scripts/dsw-token-allowlist.json', import.meta.url)),
    'utf8',
  )) as { source?: { tokens?: string[] } }
  const allowed = new Set(allowlistJson.source?.tokens ?? [])
  expect(allowed.size).toBeGreaterThan(100)
  const start = stylesSource.indexOf('.dshDesktopSettingsButtonPrimary,')
  const end = stylesSource.indexOf('.dshDesktopSettingsButton:disabled,')
  expect(start).toBeGreaterThan(0)
  expect(end).toBeGreaterThan(start)
  const updaterCss = stylesSource.slice(start, end)
  expect(updaterCss).not.toMatch(/#[0-9a-fA-F]{3,8}\b/u)
  expect(updaterCss).not.toMatch(/\brgba?\(/iu)
  const referencedTokens = [...updaterCss.matchAll(/--dsw-[a-z0-9-]+/gu)].map(match => match[0])
  expect(referencedTokens.length).toBeGreaterThan(0)
  const unknown = [...new Set(referencedTokens)].filter(token => !allowed.has(token))
  expect(unknown).toEqual([])
  // Compact sidebar pill must clamp width: max-content !important from sidebar-footer-styles.ts to a 32x32 target.
  expect(updaterCss).toMatch(/\.dshUpdatePill\[data-compact="true"\],\s*body \[class\*="collapsed"\] \.dshUpdatePill\s*\{[^}]*min-width:\s*32px;/u)
})

it('splits topic-prefixed changelog lines cleanly without middle dots', () => {
  expect(splitUpdateNote('动效体验升级：优化桌面交互与卡片切换。')).toEqual({
    title: '动效体验升级',
    separator: '：',
    body: '优化桌面交互与卡片切换。',
  })
  expect(splitUpdateNote('Security: Harden Electron Fuses and manifest checks')).toEqual({
    title: 'Security',
    separator: ': ',
    body: 'Harden Electron Fuses and manifest checks',
  })
  expect(splitUpdateNote('https://dl.omnimux.ai/releases/v2.0.26')).toEqual({
    body: 'https://dl.omnimux.ai/releases/v2.0.26',
  })
  expect(splitUpdateNote('当一个前置说明明显超过了二十八个字符的长度上限时不再拆分为加粗小标题：继续作为正文展示')).toEqual({
    body: '当一个前置说明明显超过了二十八个字符的长度上限时不再拆分为加粗小标题：继续作为正文展示',
  })
})

it('enables production download/install primary actions, structures version jump card, and keeps Dev hint/disabled state intact', () => {
  const prodAvailable = renderToStaticMarkup(createElement(NextUpdateSettings, {
    state: {
      ...baseState,
      updates: {
        phase: 'available',
        version: '2.0.26',
        installable: true,
        environment: 'production',
        channel: 'stable',
        artifactSize: 414 * 1024 * 1024,
        releaseNotes: { zh: ['体验升级：更新界面重构与交互优化'], en: ['UX: Update card overhaul'] },
      },
    },
    language: 'zh-CN',
    run: vi.fn(),
  }))
  expect(prodAvailable).toContain('dshUpdateCard')
  expect(prodAvailable).toContain('dshUpdateNotesLink')
  expect(prodAvailable).toContain('v2.0.25 → v2.0.26')
  expect(prodAvailable).toContain('<strong class="dshUpdateNoteTitle">体验升级</strong>')
  expect(prodAvailable).toContain('<span>：更新界面重构与交互优化</span>')
  expect(prodAvailable).toMatch(/class="dshDesktopSettingsButton dshDesktopSettingsButtonPrimary"[^>]*>下载更新<\/button>/)
  expect(prodAvailable).not.toMatch(/disabled=""[^>]*>下载更新/)
  expect(prodAvailable).not.toContain('·')

  const prodReady = renderToStaticMarkup(createElement(NextUpdateSettings, {
    state: {
      ...baseState,
      updates: { phase: 'ready', version: '2.0.26', installable: true, environment: 'production' },
    },
    language: 'zh-CN',
    run: vi.fn(),
  }))
  expect(prodReady).toMatch(/class="dshDesktopSettingsButton dshDesktopSettingsButtonPrimary"[^>]*>安装并重启<\/button>/)
  expect(prodReady).not.toMatch(/disabled=""[^>]*>安装并重启/)
  expect(prodReady).toContain('dshUpdateCardFooter')
  expect(prodReady).toContain('安装时会重启应用并中断正在运行的任务')

  const devAvailable = renderToStaticMarkup(createElement(NextUpdateSettings, {
    state: {
      ...baseState,
      updates: { phase: 'available', version: '2.0.26', installable: false, environment: 'dev' },
    },
    language: 'zh-CN',
    run: vi.fn(),
  }))
  expect(devAvailable).toContain('disabled=""')
  expect(devAvailable).toContain('当前为 OmniMux Dev 开发版，可检查更新但不执行应用内覆盖安装。')
})
