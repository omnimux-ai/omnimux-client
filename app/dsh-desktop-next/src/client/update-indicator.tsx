/** Non-intrusive sidebar update pill, post-update notice, and mandatory update blocking overlay. */
import { useState, useSyncExternalStore } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DesktopCommand, DesktopState } from '../desktop-contract.ts'
import { OMNIMUX_DOWNLOAD_URL } from '../product-identity.ts'
import { manualUpdate, releaseNotesUrl, updateAction, updateLabel, type NextUpdateState } from '../update-state.ts'
import { useDesktopState } from './desktop-state.ts'
import type { NextSettingsAdapter } from './settings-adapter.ts'
import { pickUpdateNotes } from './updates.tsx'

/** Open the official Settings dialog and select the Desktop Settings section. */
export function openDesktopUpdateSettings(): void {
  if (typeof document === 'undefined') return
  const selectDesktopTab = (): boolean => {
    const dialog = document.querySelector('[data-shortcut-modal="settings"]')
    if (!dialog) return false
    const buttons = Array.from(dialog.querySelectorAll<HTMLButtonElement>('nav button'))
    const desktopBtn = buttons.find(btn => /^(桌面设置|Desktop settings)$/u.test((btn.textContent ?? '').trim()))
    if (desktopBtn) {
      desktopBtn.click()
      return true
    }
    return false
  }
  if (selectDesktopTab()) return

  let menuOpened = false
  let settled = false
  const observer = new MutationObserver(() => {
    if (settled) return
    if (selectDesktopTab()) {
      settled = true
      observer.disconnect()
      return
    }
    if (menuOpened) {
      const entry = document.querySelector<HTMLButtonElement>('[role="menu"] button[role="menuitem"]')
      if (entry) {
        menuOpened = false
        entry.click()
      }
    }
  })
  observer.observe(document.body, { childList: true, subtree: true })
  const stop = setTimeout(() => {
    settled = true
    observer.disconnect()
  }, 4_000)

  const trigger = document.querySelector('[data-slot="settings.trigger"]')?.closest('button')
  if (trigger) {
    trigger.click()
  } else {
    const launcher = document.querySelector<HTMLButtonElement>('[data-slot="settings.launcher"] button')
    if (launcher) {
      menuOpened = true
      launcher.click()
    } else {
      settled = true
      clearTimeout(stop)
      observer.disconnect()
    }
  }
}

export function shouldShowSidebarUpdatePill(update: NextUpdateState | undefined): boolean {
  if (!update) return false
  return update.mandatory === true
    || update.phase === 'available'
    || update.phase === 'downloading'
    || update.phase === 'preparing'
    || update.phase === 'ready'
}

function sidebarPillLabel(update: NextUpdateState, zh: boolean): string {
  const t = (cn: string, en: string) => zh ? cn : en
  if (update.phase === 'ready') return t('重启以完成更新', 'Restart to update')
  if (update.phase === 'downloading') {
    const progress = update.total
      ? `${Math.min(100, Math.floor((update.received ?? 0) / update.total * 100))}%`
      : `${Math.floor((update.received ?? 0) / (1024 * 1024))} MB`
    return t(`下载更新 ${progress}`, `Downloading ${progress}`)
  }
  if (update.phase === 'preparing') return t('正在准备更新', 'Preparing update')
  if (update.mandatory === true) return t('需要立即更新', 'Update required')
  return t('有新版本可用', 'Update available')
}

export function SidebarUpdatePillView({
  state,
  language,
  onOpen,
}: {
  state: DesktopState | undefined
  language: string
  onOpen(): void
}) {
  const update = state?.updates
  if (!shouldShowSidebarUpdatePill(update) || !update) return null
  const zh = language.toLowerCase().startsWith('zh')
  const label = sidebarPillLabel(update, zh)
  const tone = update.mandatory === true ? 'mandatory' : update.phase === 'ready' ? 'ready' : 'available'
  const versionTag = update.version ? `v${update.version}` : ''
  return (
    <button
      type="button"
      className="dshUpdatePill"
      data-next-update-pill=""
      aria-label={versionTag ? `${label} ${versionTag}` : label}
      title={versionTag ? `${label} ${versionTag}` : label}
      onClick={onOpen}
    >
      <span className="dshUpdatePillLeft">
        <span className="dshUpdateDot" data-tone={tone} aria-hidden="true" />
        <span className="dshUpdatePillText">{label}</span>
      </span>
      {versionTag && <span className="dshUpdatePillVer">{versionTag}</span>}
    </button>
  )
}

export function SidebarUpdatePill({ adapter, language }: { adapter: NextSettingsAdapter; language: string }) {
  const state = useSyncExternalStore(adapter.subscribe, adapter.getSnapshot)
  return <SidebarUpdatePillView state={state} language={language} onOpen={openDesktopUpdateSettings} />
}

export function UpdateShellOverlayView({
  state,
  language,
  run,
}: {
  state: DesktopState | undefined
  language: string
  run(command: DesktopCommand): void
}) {
  const [showErrorDetail, setShowErrorDetail] = useState(false)
  const update = state?.updates
  if (!state || !update) return null
  const zh = language.toLowerCase().startsWith('zh')
  const t = (cn: string, en: string) => zh ? cn : en

  const showMandatory = update.mandatory === true && update.phase !== 'current'
  const showPostNotice = !showMandatory && Boolean(update.justUpdatedFrom)
  if (!showMandatory && !showPostNotice) return null

  if (showPostNotice) {
    return (
      <aside
        className="dshPostUpdateNotice"
        data-next-post-update-notice=""
        role="status"
        aria-label={t('应用已更新', 'App updated')}
      >
        <div className="dshPostUpdateCopy">
          <span className="dshUpdateDot" data-tone="ready" aria-hidden="true" />
          <span>{t(`已更新至 OmniMux v${state.version}`, `Updated to OmniMux v${state.version}`)}</span>
        </div>
        <div className="dshPostUpdateActions">
          <a
            className="dshDesktopSettingsButton"
            href={releaseNotesUrl(state.version, update.releaseNotesUrl)}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t('更新内容', 'Release notes')}
          </a>
          <button
            type="button"
            className="dshUpdateNoticeDismiss"
            aria-label={t('关闭更新提示', 'Dismiss update notice')}
            onClick={() => { run({ type: 'dismiss-post-update-notice' }) }}
          >
            ×
          </button>
        </div>
      </aside>
    )
  }

  const manual = manualUpdate(update, state.platform)
  const action = updateAction(update)
  const notes = pickUpdateNotes(update, language)
  const cancellable = update.phase === 'downloading' || update.phase === 'preparing'
  const actionDisabled = state.busy || !action || (action !== 'check-updates' && !update.installable && !manual)
  const targetVer = update.version ? `v${update.version}` : ''
  const reason = update.minSupportedVersion
    ? t(
        `当前版本 v${state.version} 低于最低支持版本 v${update.minSupportedVersion}，请更新后继续使用。`,
        `Version v${state.version} is below the minimum supported version v${update.minSupportedVersion}. Update to continue.`,
      )
    : t('此版本包含关键更新，请更新后继续使用。', 'This release includes required updates. Update to continue.')

  return (
    <div className="dshMandatoryBackdrop" data-next-mandatory-update="">
      <div className="dshMandatoryCard" role="dialog" aria-modal="true" aria-labelledby="dsh-mandatory-update-title">
        <div className="dshUpdateHeader">
          <h4 id="dsh-mandatory-update-title">
            {targetVer ? t(`需要更新至 ${targetVer}`, `Update required: ${targetVer}`) : t('需要更新应用', 'Update required')}
          </h4>
          <span className="dshDesktopSettingsBadge dshUpdateBadgeWarn">{t('必需更新', 'Required')}</span>
        </div>
        <p className="dshDesktopSettingsHint">{reason}</p>
        <p className="dshUpdateStatusText" data-tone={update.phase === 'error' ? 'error' : update.phase === 'ready' ? 'success' : 'default'} role={update.phase === 'error' ? 'alert' : 'status'}>
          {updateLabel(update, language)}
        </p>

        {update.phase === 'downloading' && (
          <progress
            className="dshUpdateProgress"
            aria-label={t('更新下载进度', 'Update download progress')}
            max={update.total ?? 1}
            value={update.total ? update.received ?? 0 : undefined}
          />
        )}

        {notes.length > 0 && (
          <ul className="dshUpdateNotes">
            {notes.map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}
          </ul>
        )}

        {update.phase === 'error' && update.errorCode && (
          <div className="dshUpdateErrorBlock">
            <button
              type="button"
              className="dshUpdateErrorToggle"
              aria-expanded={showErrorDetail}
              onClick={() => { setShowErrorDetail(prev => !prev) }}
            >
              {showErrorDetail ? t('隐藏诊断码', 'Hide error code') : t('查看诊断码', 'Show error code')}
            </button>
            {showErrorDetail && (
              <pre className="dshUpdateErrorDetail">
                {update.errorDetail ? `${update.errorCode} (${update.errorDetail})` : update.errorCode}
              </pre>
            )}
          </div>
        )}

        <div className="dshMandatoryActions">
          <a
            className="dshDesktopSettingsButton"
            href={OMNIMUX_DOWNLOAD_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t('官网手动下载', 'Manual download')}
          </a>
          {cancellable ? (
            <Button
              variant="outline"
              size="sm"
              className="dshDesktopSettingsButton"
              disabled={state.busy}
              onClick={() => { run({ type: 'cancel-update-download' }) }}
            >
              {t('取消', 'Cancel')}
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className={actionDisabled ? 'dshDesktopSettingsButton' : 'dshDesktopSettingsButton dshDesktopSettingsButtonPrimary'}
              disabled={actionDisabled}
              onClick={() => { if (action) run({ type: action }) }}
            >
              {action === 'install-update'
                ? t('安装并重启', 'Install and restart')
                : action === 'download-update'
                  ? manual ? t('前往下载', 'Open download page') : t('下载更新', 'Download update')
                  : t('检查更新', 'Check for updates')}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

export function UpdateShellOverlay({ adapter, language }: { adapter: NextSettingsAdapter; language: string }) {
  const state = useDesktopState(adapter)
  const run = (command: DesktopCommand): void => {
    void adapter.command(command).catch(() => {})
  }
  return <UpdateShellOverlayView state={state} language={language} run={run} />
}
