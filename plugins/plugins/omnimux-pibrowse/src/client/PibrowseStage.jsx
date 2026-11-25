import { useCallback, useEffect, useState } from 'react'
import { Badge, Button, PageHeader, Tabs } from 'dsh-ui-kit'
import { api } from './api.js'
import { EnvironmentPanel } from './EnvironmentPanel.jsx'
import { ExtensionsTeamPanel } from './ExtensionsTeamPanel.jsx'
import { ProfilesPanel } from './ProfilesPanel.jsx'
import { ProxiesPanel } from './ProxiesPanel.jsx'
import { PIBROWSE_TAB_ID } from './sidebar-entry.js'
import { injectPibrowseStyles } from './styles.js'

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
  const [loadError, setLoadError] = useState(null)
  const [toast, setToast] = useState(null)
  const [everOpened, setEverOpened] = useState(visible)

  useEffect(() => {
    if (visible) setEverOpened(true)
  }, [visible])

  // Toast strictly reserved for errors, actionable recovery prompts, or clipboard copy receipt.
  const notify = useCallback((message, isError = false) => {
    setToast({ message, isError })
    setTimeout(() => {
      setToast((cur) => (cur?.message === message ? null : cur))
    }, 3200)
  }, [])

  const loadOverview = useCallback(async () => {
    setRefreshing(true)
    setLoadError(null)
    try {
      const data = await api.getOverview()
      setOverview(data)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load PiBrowse overview'
      setLoadError(msg)
      notify(msg, true)
    } finally {
      setRefreshing(false)
    }
  }, [notify])

  useEffect(() => {
    if (visible) void loadOverview()
  }, [visible, loadOverview])

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

  const needsSetupBanner = Boolean(
    overview && (
      (!overview.platform?.prebuiltSupported && !overview.agent?.installed) ||
      !overview.agent?.installed ||
      overview.widevine?.available === false
    ),
  )

  const bannerMessage = !overview
    ? null
    : !overview.platform?.prebuiltSupported && !overview.agent?.installed
      ? overview.platform.unsupportedGuidance
      : !overview.agent?.installed
        ? '尚未安装 fury-agent，请前往「环境与运行态」下载校验或手动指定本地二进制路径。'
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
          onRefresh={loadOverview}
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
              <Button variant="secondary" size="sm" onClick={loadOverview}>
                {t('refresh')}
              </Button>
            </div>
          )}

          {!loadError && needsSetupBanner && bannerMessage && (
            <div className="omnimux-pibrowse-notice" role="status">
              <span>{bannerMessage}</span>
              {activeTab !== 'env' && (
                <Button variant="secondary" size="sm" onClick={() => setActiveTab('env')}>
                  {t('goEnv')}
                </Button>
              )}
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
