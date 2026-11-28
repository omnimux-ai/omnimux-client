import { createElement, type ComponentType } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RecoveryApp } from '../../src/native-ui/recovery/App.tsx'
import { ProfileCreateApp } from '../../src/native-ui/profile-create/App.tsx'
import { desktopRecoveryCopy } from '../../src/recovery-copy.ts'

describe('RecoveryApp and ProfileCreateApp UX invariants', () => {
  it('keeps export-diagnostics alongside show-diagnostics, omits unknown version facts, and marks busy main aria-busy', () => {
    const previousWindow = globalThis.window
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      writable: true,
      value: { location: { search: '?frame=true&platform=darwin' } },
    })
    try {
      const RecoveryComponent = RecoveryApp as ComponentType<NonNullable<Parameters<typeof RecoveryApp>[0]>>
      const sharedState = {
        locale: 'zh' as const,
        failureStage: 'host-boot' as const,
        failureDetail: 'startup failed',
        snapshot: {
          profileName: 'desktop',
          bundles: [],
          checkpoints: [{ slotId: 'slot-1' as const, status: 'available' as const, fileCount: 3, totalBytes: 2048 }],
        },
        diagnostics: { status: 'saved' as const, filename: 'diag.json' },
        busy: true,
        restartReady: true,
        configurationAvailable: false,
      }
      const diagnosticsMarkup = renderToStaticMarkup(createElement(RecoveryComponent, {
        state: { ...sharedState, activeTab: 'diagnostics' },
      }))
      expect(diagnosticsMarkup).toContain('aria-busy="true"')
      expect(diagnosticsMarkup).toContain('dsh-recovery://export-diagnostics')
      expect(diagnosticsMarkup).toContain('dsh-recovery://show-diagnostics')
      expect(diagnosticsMarkup).toContain('重新导出')

      const rollbackMarkup = renderToStaticMarkup(createElement(RecoveryComponent, {
        state: { ...sharedState, activeTab: 'rollback' },
      }))
      expect(rollbackMarkup).toContain('槽位 1')
      expect(rollbackMarkup).not.toContain(desktopRecoveryCopy('zh').unknown)
      expect(rollbackMarkup).not.toContain(desktopRecoveryCopy('zh').desktopVersion)
    } finally {
      if (previousWindow === undefined) {
        delete (globalThis as { window?: unknown }).window
      } else {
        Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: previousWindow })
      }
    }
  })

  it('defaults to 255-byte legacy limit without hint and supports Next 64-char ASCII rule', () => {
    const previousWindow = (globalThis as { window?: unknown }).window
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      writable: true,
      value: { location: { search: '?locale=zh' } },
    })

    try {
      const ProfileCreate = ProfileCreateApp as ComponentType<NonNullable<Parameters<typeof ProfileCreateApp>[0]>>
      const legacyMarkup = renderToStaticMarkup(createElement(ProfileCreate, {}))
      expect(legacyMarkup).toContain('maxLength="255"')
      expect(legacyMarkup).not.toContain('1–64')

      const nextHint = '支持 1–64 个英文字母、数字、下划线或连字符，需以字母或数字开头。'
      const nextMarkup = renderToStaticMarkup(
        createElement(ProfileCreate, {
          maxLength: 64,
          hint: nextHint,
        }),
      )
      expect(nextMarkup).toContain('maxLength="64"')
      expect(nextMarkup).toContain(nextHint)
    } finally {
      if (previousWindow === undefined) {
        delete (globalThis as { window?: unknown }).window
      } else {
        Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: previousWindow })
      }
    }
  })
})
