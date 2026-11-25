import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import { NextUpdateSettings } from '../../src/client/updates.tsx'
import { SidebarUpdatePillView, UpdateShellOverlayView, shouldShowSidebarUpdatePill } from '../../src/client/update-indicator.tsx'
import { DEFAULT_PREFERENCES, type DesktopState } from '../../src/desktop-contract.ts'
import type { NextUpdateState } from '../../src/update-state.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Button: ({ children, ...props }: Record<string, unknown>) => createElement('button', props, children as never),
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
})

it('shows cancel action during downloading/preparing and expandable errorCode trigger on error', () => {
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

it('renders SidebarUpdatePill only for actionable update phases and mandatory updates', () => {
  expect(shouldShowSidebarUpdatePill({ phase: 'idle', installable: true })).toBe(false)
  expect(shouldShowSidebarUpdatePill({ phase: 'current', installable: true })).toBe(false)
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
    onOpen: vi.fn(),
  }))
  expect(readyHtml).toContain('data-next-update-pill')
  expect(readyHtml).toContain('重启以完成更新')
  expect(readyHtml).toContain('v2.0.26')
  expect(readyHtml).not.toContain('·')
})

it('renders post-update notice on justUpdatedFrom and non-dismissible mandatory modal with manual fallback link', () => {
  const postNoticeHtml = renderToStaticMarkup(createElement(UpdateShellOverlayView, {
    state: {
      ...baseState,
      version: '2.0.26',
      updates: { phase: 'current', version: '2.0.26', installable: true, justUpdatedFrom: '2.0.25' },
    },
    language: 'zh-CN',
    run: vi.fn(),
  }))
  expect(postNoticeHtml).toContain('data-next-post-update-notice')
  expect(postNoticeHtml).toContain('已更新至 OmniMux v2.0.26')
  expect(postNoticeHtml).toContain('关闭更新提示')
  expect(postNoticeHtml).not.toContain('·')

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
  expect(mandatoryHtml).toContain('href="https://dl.omnimux.ai/"')
  expect(mandatoryHtml).toContain('最低支持版本 v2.0.20')
  expect(mandatoryHtml).toContain('关键修复')
  expect(mandatoryHtml).not.toContain('data-next-post-update-notice')
  expect(mandatoryHtml).not.toContain('·')
})
