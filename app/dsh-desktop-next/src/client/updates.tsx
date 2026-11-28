import { useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DesktopCommand, DesktopState } from '../desktop-contract.ts'
import {
  formatArtifactSize,
  manualUpdate,
  manualUpdateHint,
  nonInstallableHint,
  releaseNotesUrl,
  updateAction,
  updateLabel,
  type NextUpdateState,
} from '../update-state.ts'

const ONE_GIB = 1024 * 1024 * 1024
const ONE_MIB = 1024 * 1024

export function pickUpdateNotes(update: NextUpdateState, language: string): readonly string[] {
  const notes = update.releaseNotes
  if (!notes) return []
  const zh = language.toLowerCase().startsWith('zh')
  const primary = zh ? notes.zh : notes.en
  const fallback = zh ? notes.en : notes.zh
  const chosen = primary.length > 0 ? primary : fallback
  return chosen.slice(0, 5)
}

export function formatDownloadMeta(update: NextUpdateState): string | undefined {
  if (update.phase === 'downloading') {
    const received = Math.max(0, update.received ?? 0)
    const total = update.total
    const totalLabel = formatArtifactSize(total)
    if (total !== undefined && total >= ONE_GIB && totalLabel) {
      return `${(received / ONE_GIB).toFixed(2)} GB / ${totalLabel}`
    }
    const receivedMb = Math.floor(received / ONE_MIB)
    return totalLabel ? `${receivedMb} MB / ${totalLabel}` : `${receivedMb} MB`
  }
  if (update.phase === 'available' || update.phase === 'ready') {
    return formatArtifactSize(update.artifactSize)
  }
  return undefined
}

export function updatePrimaryButtonLabel(
  update: NextUpdateState,
  action: ReturnType<typeof updateAction>,
  manual: boolean,
  language: string,
): string {
  const zh = language.toLowerCase().startsWith('zh')
  const t = (cn: string, en: string) => zh ? cn : en
  if (update.phase === 'installing') return t('正在安装…', 'Installing…')
  if (update.phase === 'checking') return t('正在检查…', 'Checking…')
  if (action === 'install-update') return t('安装并重启', 'Install and restart')
  if (action === 'download-update') return manual ? t('前往下载', 'Open download page') : t('下载更新', 'Download update')
  return t('检查更新', 'Check for updates')
}

export function splitUpdateNote(line: string): { title?: string; separator?: string; body: string } {
  const trimmed = line.trim()
  const cnIndex = trimmed.indexOf('：')
  const enIndex = trimmed.indexOf(': ')
  const separatorIndex = cnIndex > 0 && (enIndex < 0 || cnIndex < enIndex) ? cnIndex : enIndex
  if (separatorIndex > 0 && separatorIndex <= 28) {
    const separator = trimmed.startsWith(': ', separatorIndex) ? ': ' : '：'
    const body = trimmed.slice(separatorIndex + separator.length).trimStart()
    if (body.length > 0) {
      return { title: trimmed.slice(0, separatorIndex), separator, body }
    }
  }
  return { body: trimmed }
}

function ExternalLinkIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M6 3.5H12.5V10" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12.5 3.5L5.5 10.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  )
}

function UpdateSpinnerIcon() {
  return (
    <svg className="dshUpdateSpinner" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeOpacity="0.22" strokeWidth="1.8" />
      <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

export function NextUpdateSettings({ state, language, run }: { state: DesktopState; language: string; run(command: DesktopCommand): void }) {
  const update = state.updates
  const errorKey = update?.phase === 'error' && update.errorCode
    ? `${update.errorCode}:${update.errorDetail ?? ''}`
    : null
  const [expandedErrorKey, setExpandedErrorKey] = useState<string | null>(null)
  const showErrorDetail = errorKey !== null && expandedErrorKey === errorKey
  if (!update) return null
  const zh = language.toLowerCase().startsWith('zh')
  const t = (cn: string, en: string) => zh ? cn : en
  // Linux and portable Windows copies have no in-app installer; their download action opens the release page instead.
  const manual = manualUpdate(update, state.platform)
  const action = updateAction(update)
  const notes = (update.phase === 'available' || update.phase === 'ready') ? pickUpdateNotes(update, language) : []
  const meta = formatDownloadMeta(update)
  const statusTone = update.phase === 'error'
    ? 'error'
    : (update.phase === 'ready' || update.phase === 'current')
      ? 'success'
      : 'default'
  const dotTone = update.phase === 'error'
    ? 'error'
    : (update.phase === 'ready' || update.phase === 'current')
      ? 'success'
      : (update.phase === 'available' || update.phase === 'downloading' || update.phase === 'preparing' || update.phase === 'installing')
        ? 'available'
        : 'neutral'
  const spinning = update.phase === 'checking' || update.phase === 'preparing' || update.phase === 'installing'
  const showTransition = Boolean(
    update.version
    && update.version !== state.version
    && ['available', 'downloading', 'preparing', 'ready', 'installing'].includes(update.phase),
  )
  const cancellable = update.phase === 'downloading' || update.phase === 'preparing'
  const actionDisabled = state.busy || !action || (action !== 'check-updates' && !update.installable && !manual)
  const isPrimaryAction = !actionDisabled && (action === 'install-update' || action === 'download-update')
  const hint = manual
    ? manualUpdateHint(language, update.portable)
    : !update.installable
      ? nonInstallableHint(update, language)
      : update.phase === 'ready'
        ? t('安装时会重启应用并中断正在运行的任务，Profile 和会话会保留。', 'Installation restarts the app and interrupts running tasks. Profiles and sessions are retained.')
        : undefined
  const hasFooter = Boolean(hint || (errorKey !== null && update.errorCode))

  return <section className="dshDesktopSettingsGroup" data-next-updates="">
    <div className="dshUpdateHeader">
      <div className="dshUpdateIdentity">
        <h3>{t('应用更新', 'App updates')}</h3>
        <span className="dshUpdateVersion">OmniMux v{state.version}</span>
        {update.environment === 'dev' && <span className="dshDesktopSettingsBadge dshUpdateBadgeWarn">Dev</span>}
        {update.channel === 'beta' && <span className="dshDesktopSettingsBadge dshUpdateBadgeBrand">Beta</span>}
      </div>
      <a
        className="dshUpdateNotesLink"
        href={releaseNotesUrl(update.version ?? state.version, update.releaseNotesUrl)}
        target="_blank"
        rel="noopener noreferrer"
      >
        <span>{t('更新公告', 'Release notes')}</span>
        <ExternalLinkIcon />
      </a>
    </div>

    <div className="dshUpdateCard" data-phase={update.phase} data-tone={statusTone}>
      <div className="dshUpdateCardTop">
        <div className="dshUpdateCardSummary">
          <div className="dshUpdateHeadlineRow">
            {spinning
              ? <UpdateSpinnerIcon />
              : <span className="dshUpdateStatusDot" data-tone={dotTone} aria-hidden="true" />}
            <p className="dshUpdateStatusText" data-tone={statusTone} role={update.phase === 'error' ? 'alert' : 'status'}>
              {updateLabel(update, language)}
            </p>
            {update.mandatory === true && <span className="dshDesktopSettingsBadge dshUpdateBadgeWarn">{t('必需更新', 'Required')}</span>}
          </div>
          {(showTransition || meta) && (
            <div className="dshUpdateSubmeta">
              {showTransition && <span className="dshUpdateTransition">{`v${state.version} → v${update.version}`}</span>}
              {meta && <span className="dshUpdateMeta">{meta}</span>}
            </div>
          )}
        </div>

        <div className="dshUpdateCardAction">
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
              className={isPrimaryAction ? 'dshDesktopSettingsButton dshDesktopSettingsButtonPrimary' : 'dshDesktopSettingsButton'}
              disabled={actionDisabled}
              onClick={() => { if (action) run({ type: action }) }}
            >
              {updatePrimaryButtonLabel(update, action, manual, language)}
            </Button>
          )}
        </div>
      </div>

      {update.phase === 'downloading' && (
        <progress
          className="dshUpdateProgress"
          aria-label={t('更新下载进度', 'Update download progress')}
          max={update.total ?? 1}
          value={update.total ? update.received ?? 0 : undefined}
        />
      )}

      {notes.length > 0 && (
        <ul className="dshUpdateNotes" data-next-update-notes="">
          {notes.map((line, index) => {
            const parts = splitUpdateNote(line)
            return (
              <li key={`${index}-${line}`}>
                {parts.title ? (
                  <>
                    <strong className="dshUpdateNoteTitle">{parts.title}</strong>
                    <span>{`${parts.separator}${parts.body}`}</span>
                  </>
                ) : parts.body}
              </li>
            )
          })}
        </ul>
      )}

      {hasFooter && (
        <div className="dshUpdateCardFooter">
          {hint && <p className="dshDesktopSettingsHint">{hint}</p>}
          {errorKey !== null && update.errorCode && (
            <div className="dshUpdateErrorBlock">
              <button
                type="button"
                className="dshUpdateErrorToggle"
                aria-expanded={showErrorDetail}
                onClick={() => { setExpandedErrorKey(prev => prev === errorKey ? null : errorKey) }}
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
        </div>
      )}
    </div>
  </section>
}
