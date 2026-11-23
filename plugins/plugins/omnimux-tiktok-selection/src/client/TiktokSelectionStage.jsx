import { useCallback, useEffect, useState } from 'react'
import { Badge, PageHeader, Tabs } from 'dsh-ui-kit'
import { api } from './api.js'
import { AutomationRiskPanel } from './AutomationRiskPanel.jsx'
import { DiscoveryPanel } from './DiscoveryPanel.jsx'
import { LibraryAssetsPanel } from './LibraryAssetsPanel.jsx'
import { SELECTION_TAB_ID } from './sidebar-entry.js'
import { injectTiktokSelectionStyles } from './styles.js'
import { ThreeGatePanel } from './ThreeGatePanel.jsx'

export function TiktokSelectionStage({ t, stage, store, visible = true }) {
  useEffect(() => {
    injectTiktokSelectionStyles()
  }, [])

  useEffect(() => {
    const wb = typeof window !== 'undefined' ? window.__omnimuxWorkbench : undefined
    if (!wb || typeof wb.attachStore !== 'function' || !store) return undefined
    wb.attachStore(store)
    return () => {
      wb.detachStore?.(store)
    }
  }, [store])

  const [activeTab, setActiveTab] = useState('discovery')
  const [overview, setOverview] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [libraryToken, setLibraryToken] = useState(0)
  const [toast, setToast] = useState(null)

  const notify = useCallback((message, isError = false) => {
    setToast({ message, isError })
    setTimeout(() => {
      setToast((cur) => (cur?.message === message ? null : cur))
    }, 3200)
  }, [])

  const loadOverview = useCallback(async () => {
    setRefreshing(true)
    try {
      const data = await api.getOverview()
      setOverview(data)
    } catch (err) {
      notify(err?.message || '初始化选品工作台失败', true)
    } finally {
      setRefreshing(false)
    }
  }, [notify])

  useEffect(() => {
    if (visible) loadOverview()
  }, [visible, loadOverview])

  const bumpLibrary = useCallback(() => {
    setLibraryToken((n) => n + 1)
    loadOverview()
  }, [loadOverview])

  const handleClose = () => {
    const wb = typeof window !== 'undefined' ? window.__omnimuxWorkbench : undefined
    if (wb && typeof wb.closeTab === 'function') wb.closeTab(SELECTION_TAB_ID)
    else stage?.set?.(false)
  }

  const tabItems = [
    { id: 'discovery', label: t('tabDiscovery') },
    { id: 'gate', label: t('tabThreeGate'), badge: overview?.stats?.tasksTotal || undefined },
    { id: 'library', label: t('tabLibrary'), badge: overview?.stats?.libraryTotal || undefined },
    { id: 'assets', label: t('tabAssets'), badge: overview?.stats?.assetsReadyCount || undefined },
    { id: 'automation', label: t('tabAutomation'), badge: overview?.stats?.activeSchedulesCount || undefined },
    { id: 'risk', label: t('tabRiskSettings') },
  ]

  return (
    <div
      role="region"
      aria-label={t('title')}
      aria-hidden={visible ? undefined : 'true'}
      className="omnimux-ttsel-stage"
      data-visible={visible ? 'true' : 'false'}
    >
      <div className="omnimux-ttsel-stage-body omx-stage-scroll">
        <PageHeader
          title={t('title')}
          badge={
            overview?.capabilities?.hasSocialDataSeam ? (
              <Badge variant="success">Hub 在线</Badge>
            ) : (
              <Badge variant="neutral">本地快照模式</Badge>
            )
          }
          onRefresh={loadOverview}
          refreshing={refreshing}
          onClose={handleClose}
        />

        <div className="omnimux-ttsel-tabs-wrap omx-stage-sticky">
          <Tabs items={tabItems} activeId={activeTab} onChange={setActiveTab} />
        </div>

        <div className="omnimux-ttsel-content">
          {activeTab === 'discovery' && (
            <DiscoveryPanel
              overview={overview}
              t={t}
              onNotify={notify}
              onLibraryChanged={bumpLibrary}
              onSnapshotsChanged={loadOverview}
            />
          )}
          {activeTab === 'gate' && (
            <ThreeGatePanel overview={overview} t={t} onNotify={notify} onLibraryChanged={bumpLibrary} />
          )}
          {activeTab === 'library' && (
            <LibraryAssetsPanel
              assetsOnly={false}
              overview={overview}
              t={t}
              onNotify={notify}
              refreshToken={libraryToken}
              onLibraryChanged={bumpLibrary}
            />
          )}
          {activeTab === 'assets' && (
            <LibraryAssetsPanel
              assetsOnly={true}
              overview={overview}
              t={t}
              onNotify={notify}
              refreshToken={libraryToken}
              onLibraryChanged={bumpLibrary}
            />
          )}
          {activeTab === 'automation' && (
            <AutomationRiskPanel
              section="automation"
              overview={overview}
              t={t}
              onNotify={notify}
              onOverviewChanged={loadOverview}
            />
          )}
          {activeTab === 'risk' && (
            <AutomationRiskPanel
              section="risk"
              overview={overview}
              t={t}
              onNotify={notify}
              onOverviewChanged={loadOverview}
            />
          )}
        </div>
      </div>

      {toast && (
        <div className="omnimux-ttsel-toast" role="status" data-error={toast.isError ? 'true' : 'false'}>
          {toast.message}
        </div>
      )}
    </div>
  )
}
