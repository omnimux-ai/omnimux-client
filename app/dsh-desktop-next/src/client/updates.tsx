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
  const cancellable = update.phase === 'downloading' || update.phase === 'preparing'
  const actionDisabled = state.busy || !action || (action !== 'check-updates' && !update.installable && !manual)
  const isPrimaryAction = !actionDisabled && (action === 'install-update' || action === 'download-update')

  return <section className="dshDesktopSettingsGroup" data-next-updates="">
    <div className="dshUpdateHeader">
      <div className="dshUpdateIdentity">
        <h3>{t('应用更新', 'App updates')}</h3>
        <span className="dshUpdateVersion">OmniMux v{state.version}</span>
        {update.environment === 'dev' && <span className="dshDesktopSettingsBadge dshUpdateBadgeWarn">Dev</span>}
        {update.channel === 'beta' && <span className="dshDesktopSettingsBadge dshUpdateBadgeBrand">Beta</span>}
        {update.mandatory === true && <span className="dshDesktopSettingsBadge dshUpdateBadgeWarn">{t('必需更新', 'Required')}</span>}
      </div>
    </div>

    <div className="dshUpdateStatusRow">
      <p className="dshUpdateStatusText" data-tone={statusTone} role={update.phase === 'error' ? 'alert' : 'status'}>
        {updateLabel(update, language)}
      </p>
      {meta && <span className="dshUpdateMeta">{meta}</span>}
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
        {notes.map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}
      </ul>
    )}

    {update.phase === 'ready' && (
      <p className="dshDesktopSettingsHint">
        {t('安装时会重启应用并中断正在运行的任务，Profile 和会话会保留。', 'Installation restarts the app and interrupts running tasks. Profiles and sessions are retained.')}
      </p>
    )}

    {manual
      ? <p className="dshDesktopSettingsHint">{manualUpdateHint(language, update.portable)}</p>
      : !update.installable && <p className="dshDesktopSettingsHint">{nonInstallableHint(update, language)}</p>}

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

    <div className="dshDesktopSettingsDialogActions">
      <a
        className="dshDesktopSettingsButton"
        href={releaseNotesUrl(update.version ?? state.version, update.releaseNotesUrl)}
        target="_blank"
        rel="noopener noreferrer"
      >
        {t('更新公告', 'Release notes')}
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
          className={isPrimaryAction ? 'dshDesktopSettingsButton dshDesktopSettingsButtonPrimary' : 'dshDesktopSettingsButton'}
          disabled={actionDisabled}
          onClick={() => { if (action) run({ type: action }) }}
        >
          {updatePrimaryButtonLabel(update, action, manual, language)}
        </Button>
      )}
    </div>
  </section>
}
