import { useCallback, useEffect, useRef, useState } from 'react'
import { Badge, Button, PageHeader, Tabs } from 'dsh-ui-kit'
import { api } from './api.js'
import { EnvironmentPanel } from './EnvironmentPanel.jsx'
import { ExtensionsTeamPanel } from './ExtensionsTeamPanel.jsx'
import { ProfilesPanel } from './ProfilesPanel.jsx'
import { ProxiesPanel } from './ProxiesPanel.jsx'
import { PIBROWSE_TAB_ID } from './sidebar-entry.js'
import { injectPibrowseStyles } from './styles.js'

function formatMb(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0.0'
  return (bytes / (1024 * 1024)).toFixed(1)
}

function getCoreProgressMeta(installer) {
  const coreState = installer?.core
  if (coreState?.status === 'downloading') {
    const pct = coreState.progress?.percent ?? 0
    const dl = formatMb(coreState.progress?.downloadedBytes ?? 0)
    const tot = coreState.progress?.totalBytes ? formatMb(coreState.progress.totalBytes) : null
    return {
      active: true,
      percent: pct,
      label: tot
        ? `正在下载 Chromium 157 内核（${pct}%，${dl} / ${tot} MB）`
        : `正在下载 Chromium 157 内核（${dl} MB）`,
    }
  }
  if (coreState?.status === 'extracting') {
    return {
      active: true,
      percent: 100,
      label: '正在解压并校验 Chromium 157 内核...',
    }
  }
  const ipcDl = installer?.ipcCoreDownload
  if (ipcDl?.running) {
    const pct = ipcDl.total > 0 ? Math.min(100, Math.round((ipcDl.downloaded / ipcDl.total) * 100)) : 50
    const dl = formatMb(ipcDl.downloaded || 0)
    const tot = ipcDl.total > 0 ? formatMb(ipcDl.total) : null
    return {
      active: true,
      percent: pct,
      label: tot
        ? `正在下载 Chromium 157 内核（${pct}%，${dl} / ${tot} MB）`
        : `正在下载 Chromium 157 内核（${dl} MB）`,
    }
  }
  return { active: false, percent: null, label: null }
}

function resolveHeaderBadge(overview, t) {
  if (!overview) {
    return <Badge variant="neutral">{t('statusWaitingInit')}</Badge>
  }
  if (overview.sidecar?.running) {
    return <Badge variant="success">{t('statusRunning')}</Badge>
  }
  if (overview.sidecar?.state === 'starting') {
    return <Badge variant="info">{t('statusStarting')}</Badge>
  }
  if (overview.sidecar?.state === 'error') {
    return <Badge variant="error">{t('statusError')}</Badge>
  }
  if (overview.platform && !overview.platform.prebuiltSupported && !overview.agent?.installed) {
    return <Badge variant="warning">{t('statusNeedsSetup')}</Badge>
  }
  if (!overview.agent?.installed) {
    return <Badge variant="neutral">{t('statusWaitingInit')}</Badge>
  }
  return <Badge variant="neutral">{t('statusStopped')}</Badge>
}

export function PibrowseStage({ t, stage, store, visible = true }) {
  useEffect(() => {
    injectPibrowseStyles()
  }, [])

  useEffect(() => {
    const wb = typeof window !== 'undefined' ? window.__omnimuxWorkbench : undefined
    if (!wb || typeof wb.attachStore !== 'function' || !store) return undefined
    wb.attachStore(store)
    return () => {
      wb.detachStore?.(store)
    }
  }, [store])

  const [activeTab, setActiveTab] = useState('profiles')
  const [overview, setOverview] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [installingCore, setInstallingCore] = useState(false)
  const [loadError, setLoadError] = useState(null)
  const [toast, setToast] = useState(null)
  const [everOpened, setEverOpened] = useState(visible)
  const overviewInFlightRef = useRef(false)
  const prevInstallErrorsRef = useRef({ agentUpdatedAt: null, coreUpdatedAt: null, ipcError: null })

  useEffect(() => {
    if (visible) setEverOpened(true)
  }, [visible])

  // Toast strictly reserved for errors, actionable recovery prompts, or clipboard copy receipt.
  const notify = useCallback((message, isError = false) => {
    setToast({ message, isError })
    setTimeout(() => {
      setToast((cur) => (cur?.message === message ? null : cur))
    }, 4000)
  }, [])

  const loadOverview = useCallback(async ({ silent = false } = {}) => {
    if (silent && overviewInFlightRef.current) return
    overviewInFlightRef.current = true
    if (!silent) {
      setRefreshing(true)
      setLoadError(null)
    }
    try {
      const data = await api.getOverview()
      setOverview(data)
      setLoadError(null)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load PiBrowse overview'
      if (!silent) {
        setLoadError(msg)
        notify(msg, true)
      }
    } finally {
      overviewInFlightRef.current = false
      if (!silent) setRefreshing(false)
    }
  }, [notify])

  useEffect(() => {
    if (visible) void loadOverview()
  }, [visible, loadOverview])

  const agentInstallActive =
    overview?.installer?.agent?.status === 'downloading' ||
    overview?.installer?.agent?.status === 'extracting'
  const coreProgress = getCoreProgressMeta(overview?.installer)
  const anyInstallActive = agentInstallActive || coreProgress.active

  useEffect(() => {
    if (!visible || !anyInstallActive) return undefined
    const timer = setInterval(() => {
      void loadOverview({ silent: true })
    }, 1000)
    return () => clearInterval(timer)
  }, [visible, anyInstallActive, loadOverview])

  useEffect(() => {
    const agentInstall = overview?.installer?.agent
    const coreInstall = overview?.installer?.core
    const ipcError = overview?.installer?.ipcCoreDownload?.error ?? null
    const prev = prevInstallErrorsRef.current

    const agentNeedsToast =
      (agentInstall?.status === 'error' || agentInstall?.status === 'needs-authorization') &&
      Boolean(agentInstall?.error) &&
      agentInstall?.updatedAt !== prev.agentUpdatedAt
    if (agentNeedsToast) {
      notify(agentInstall.error, true)
    }

    const coreNeedsToast =
      coreInstall?.status === 'error' &&
      Boolean(coreInstall?.error) &&
      coreInstall?.updatedAt !== prev.coreUpdatedAt
    if (coreNeedsToast) {
      notify(coreInstall.error, true)
    }

    if (ipcError && ipcError !== prev.ipcError) {
      notify(String(ipcError), true)
    }

    prevInstallErrorsRef.current = {
      agentUpdatedAt:
        agentInstall?.status === 'error' || agentInstall?.status === 'needs-authorization'
          ? agentInstall?.updatedAt ?? null
          : prev.agentUpdatedAt,
      coreUpdatedAt: coreInstall?.status === 'error' ? coreInstall?.updatedAt ?? null : prev.coreUpdatedAt,
      ipcError,
    }
  }, [overview?.installer, notify])

  const handleInstallCore = useCallback(async () => {
    setInstallingCore(true)
    try {
      await api.runtime({ action: 'install_core', background: true })
      await loadOverview({ silent: true })
    } catch (err) {
      notify(err instanceof Error ? err.message : '下载 Chromium Core 失败', true)
    } finally {
      setInstallingCore(false)
    }
  }, [loadOverview, notify])

  const handleClose = () => {
    const wb = typeof window !== 'undefined' ? window.__omnimuxWorkbench : undefined
    if (wb && typeof wb.closeTab === 'function') wb.closeTab(PIBROWSE_TAB_ID)
    else stage?.set?.(false)
  }

  const tabItems = [
    { id: 'profiles', label: t('tabProfiles'), badge: overview?.stats?.profilesTotal || undefined },
    { id: 'proxies', label: t('tabProxies'), badge: overview?.stats?.proxiesTotal || undefined },
    { id: 'team', label: t('tabTeam'), badge: overview?.stats?.extensionsTotal || undefined },
    { id: 'env', label: t('tabEnv') },
  ]

  const agentNeedsAuth = Boolean(
    overview?.installer?.agent?.status === 'needs-authorization' && overview?.installer?.agent?.error,
  )
  const missingCore = Boolean(overview?.agent?.installed && !overview?.core?.installed)
  const coreProblem = typeof overview?.core?.problem === 'string' && overview.core.problem.trim() ? overview.core.problem.trim() : null
  const showMissingCoreBanner = missingCore && activeTab !== 'env'

  const needsSetupBanner = Boolean(
    overview && (
      (!overview.platform?.prebuiltSupported && !overview.agent?.installed) ||
      !overview.agent?.installed ||
      agentNeedsAuth ||
      showMissingCoreBanner ||
      Boolean(coreProblem) ||
      overview.widevine?.available === false
    ),
  )

  const bannerMessage = !overview
    ? null
    : !overview.platform?.prebuiltSupported && !overview.agent?.installed
      ? overview.platform.unsupportedGuidance
      : !overview.agent?.installed
        ? '尚未安装 fury-agent，请前往「环境与运行态」下载校验或手动指定本地二进制路径。'
        : agentNeedsAuth
          ? overview.installer.agent.error
          : showMissingCoreBanner
            ? coreProgress.active
              ? coreProgress.label
              : coreProblem || '尚未安装 Chromium 157 内核，启动窗口前需先下载安装 Core 或配置本地 FURY_CORE。'
            : coreProblem
              ? coreProblem
              : overview.widevine?.available === false
                ? overview.widevine.warning
                : null

  return (
    <div
      role="region"
      aria-label={t('title')}
      aria-hidden={visible ? undefined : 'true'}
      className="omnimux-pibrowse-stage"
      data-visible={visible ? 'true' : 'false'}
      style={everOpened && !visible ? { display: 'none' } : undefined}
    >
      <div className="omnimux-pibrowse-stage-body omx-stage-scroll">
        <PageHeader
          title={t('title')}
          badge={resolveHeaderBadge(overview, t)}
          onRefresh={() => loadOverview()}
          refreshing={refreshing}
          refreshTitle={t('refresh')}
          onClose={handleClose}
          closeTitle={t('close')}
        />

        <div className="omnimux-pibrowse-tabs-wrap omx-stage-sticky">
          <Tabs items={tabItems} activeId={activeTab} onChange={setActiveTab} />
        </div>

        <div className="omnimux-pibrowse-content">
          {loadError && (
            <div className="omnimux-pibrowse-notice" data-tone="error" role="alert">
              <span>{loadError}</span>
              <Button variant="secondary" size="sm" onClick={() => loadOverview()}>
                {t('refresh')}
              </Button>
            </div>
          )}

          {!loadError && needsSetupBanner && bannerMessage && (
            <div className="omnimux-pibrowse-notice" role="status">
              <div className="omnimux-pibrowse-notice-col">
                <span>{bannerMessage}</span>
                {showMissingCoreBanner && coreProgress.active && coreProgress.percent !== null && (
                  <div
                    className="omnimux-pibrowse-progress-track"
                    role="progressbar"
                    aria-valuenow={coreProgress.percent}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <div
                      className="omnimux-pibrowse-progress-fill"
                      style={{ '--pb-progress': Math.max(0, Math.min(100, Number(coreProgress.percent) || 0)) / 100 }}
                    />
                  </div>
                )}
              </div>
              <div className="omnimux-pibrowse-row">
                {showMissingCoreBanner && overview?.platform?.prebuiltSupported && (
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={coreProgress.active}
                    loading={installingCore || coreProgress.active}
                    onClick={handleInstallCore}
                  >
                    {t('downloadCore')}
                  </Button>
                )}
                {activeTab !== 'env' && (
                  <Button variant="secondary" size="sm" onClick={() => setActiveTab('env')}>
                    {t('goEnv')}
                  </Button>
                )}
              </div>
            </div>
          )}

          {activeTab === 'profiles' && (
            <ProfilesPanel
              overview={overview}
              t={t}
              onNotify={notify}
              onOverviewChanged={loadOverview}
              onOpenEnv={() => setActiveTab('env')}
            />
          )}
          {activeTab === 'proxies' && (
            <ProxiesPanel
              overview={overview}
              t={t}
              onNotify={notify}
              onOverviewChanged={loadOverview}
            />
          )}
          {activeTab === 'team' && (
            <ExtensionsTeamPanel
              overview={overview}
              t={t}
              onNotify={notify}
              onOverviewChanged={loadOverview}
            />
          )}
          {activeTab === 'env' && (
            <EnvironmentPanel
              overview={overview}
              t={t}
              onNotify={notify}
              onOverviewChanged={loadOverview}
            />
          )}
        </div>
      </div>

      {toast && (
        <div
          className="omnimux-pibrowse-toast"
          role="status"
          data-error={toast.isError ? 'true' : 'false'}
        >
          {toast.message}
        </div>
      )}
    </div>
  )
}
