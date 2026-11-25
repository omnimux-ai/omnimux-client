import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Badge,
  Button,
  ConfirmModal,
  DropdownSelect,
  EmptyState,
  FilterBar,
  InputField,
  ModalDialog,
  SearchField,
  StatBar,
} from 'dsh-ui-kit'
import { api } from './api.js'

export function ProfilesPanel({ overview, t, onNotify, onOverviewChanged, onOpenEnv }) {
  const [profiles, setProfiles] = useState([])
  const [trash, setTrash] = useState([])
  const [groups, setGroups] = useState([])
  const [personas, setPersonas] = useState([])
  const [proxies, setProxies] = useState([])
  const [loading, setLoading] = useState(false)
  const [groupFilter, setGroupFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [trashView, setTrashView] = useState(false)
  const [busyId, setBusyId] = useState(null)

  const [createOpen, setCreateOpen] = useState(false)
  const [batchOpen, setBatchOpen] = useState(false)
  const [mirrorOpen, setMirrorOpen] = useState(false)
  const [purgeTarget, setPurgeTarget] = useState(null)

  const [formName, setFormName] = useState('')
  const [formPersona, setFormPersona] = useState('all')
  const [formProxyId, setFormProxyId] = useState('all')
  const [formStartUrl, setFormStartUrl] = useState('')

  const [batchPrefix, setBatchPrefix] = useState('Profile')
  const [batchCount, setBatchCount] = useState('3')
  const [mirrorSource, setMirrorSource] = useState('')
  const [mirrorTargets, setMirrorTargets] = useState([])

  const sidecarRunning = Boolean(overview?.sidecar?.running)
  const mirrorActive = Boolean(overview?.stats?.mirrorActive)

  const loadData = useCallback(async () => {
    if (!overview?.sidecar?.running) {
      setProfiles([])
      setTrash([])
      setGroups([])
      return
    }
    setLoading(true)
    try {
      const [pRes, personaRes, proxyRes] = await Promise.all([
        api.listProfiles({}),
        api.listPersonas().catch((err) => {
          onNotify(err instanceof Error ? err.message : '加载 Persona 失败', true)
          return { personas: [] }
        }),
        api.listProxies().catch((err) => {
          onNotify(err instanceof Error ? err.message : '加载代理池失败', true)
          return { proxies: [] }
        }),
      ])
      setProfiles(Array.isArray(pRes?.profiles) ? pRes.profiles : [])
      setTrash(Array.isArray(pRes?.trash) ? pRes.trash : [])
      setGroups(Array.isArray(pRes?.groups) ? pRes.groups : [])
      setPersonas(Array.isArray(personaRes?.personas) ? personaRes.personas : [])
      setProxies(Array.isArray(proxyRes?.proxies) ? proxyRes.proxies : [])
    } catch (err) {
      onNotify(err instanceof Error ? err.message : '加载配置文件失败', true)
    } finally {
      setLoading(false)
    }
  }, [overview?.sidecar?.running, onNotify])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const groupOptions = useMemo(() => {
    const items = [{ value: 'all', label: t('allOption') }]
    for (const g of groups) {
      const id = String(g?.id ?? g?.name ?? '')
      if (!id) continue
      items.push({ value: id, label: String(g?.name || id) })
    }
    return items
  }, [groups, t])

  const statusOptions = useMemo(
    () => [
      { value: 'all', label: t('allOption') },
      { value: 'running', label: t('statusRunningOpt') },
      { value: 'stopped', label: t('statusStoppedOpt') },
    ],
    [t],
  )

  const personaOptions = useMemo(() => {
    const items = [{ value: 'all', label: t('allOption') }]
    for (const p of personas) {
      const id = String(p?.id ?? p?.name ?? '')
      if (!id) continue
      items.push({ value: id, label: String(p?.label || p?.name || id) })
    }
    return items
  }, [personas, t])

  const proxyOptions = useMemo(() => {
    const items = [{ value: 'all', label: t('allOption') }]
    for (const px of proxies) {
      const id = String(px?.id ?? '')
      if (!id) continue
      items.push({ value: id, label: String(px?.name || px?.host || id) })
    }
    return items
  }, [proxies, t])

  const visibleRows = useMemo(() => {
    const base = trashView ? trash : profiles
    return base.filter((row) => {
      if (
        !trashView &&
        groupFilter !== 'all' &&
        row.project_id !== groupFilter &&
        row.group_id !== groupFilter &&
        row.group !== groupFilter
      ) {
        return false
      }
      if (!trashView && statusFilter === 'running' && !row.running) return false
      if (!trashView && statusFilter === 'stopped' && row.running) return false
      if (search.trim()) {
        const needle = search.trim().toLowerCase()
        const hay = `${row.name || ''} ${row.id || ''} ${row.persona_id || row.persona || ''}`.toLowerCase()
        if (!hay.includes(needle)) return false
      }
      return true
    })
  }, [profiles, trash, trashView, groupFilter, statusFilter, search])

  const runAction = async (id, fn) => {
    setBusyId(id)
    try {
      await fn()
      await Promise.all([loadData(), onOverviewChanged()])
    } catch (err) {
      onNotify(err instanceof Error ? err.message : '操作失败', true)
    } finally {
      setBusyId(null)
    }
  }

  const handleCreateProfile = async () => {
    if (!formName.trim()) {
      onNotify('请输入配置名称', true)
      return
    }
    await runAction('create', async () => {
      await api.upsertProfile({
        name: formName.trim(),
        ...(formPersona !== 'all' ? { persona: formPersona } : {}),
        ...(formProxyId !== 'all' ? { proxy_id: formProxyId } : {}),
        ...(formStartUrl.trim() ? { start_url: formStartUrl.trim() } : {}),
      })
      setCreateOpen(false)
      setFormName('')
      setFormStartUrl('')
    })
  }

  const handleBatchCreate = async () => {
    await runAction('batch', async () => {
      await api.batchCreateProfiles({
        prefix: batchPrefix.trim() || 'Profile',
        count: Number(batchCount) || 1,
        ...(formPersona !== 'all' ? { persona: formPersona } : {}),
        ...(formProxyId !== 'all' ? { proxyId: formProxyId } : {}),
      })
      setBatchOpen(false)
    })
  }

  const handleMirrorToggle = async () => {
    if (mirrorActive) {
      await runAction('mirror', () => api.manageExtensions({ action: 'mirror_stop' }))
      return
    }
    const running = profiles.filter((p) => p.running)
    if (running.length < 2) {
      onNotify('请至少启动两个配置文件窗口后再开启多窗同步', true)
      return
    }
    setMirrorSource(running[0].id)
    setMirrorTargets(running.slice(1).map((p) => p.id))
    setMirrorOpen(true)
  }

  const handleConfirmMirror = async () => {
    await runAction('mirror', async () => {
      await api.manageExtensions({
        action: 'mirror_start',
        sourceProfileId: mirrorSource,
        targetProfileIds: mirrorTargets,
      })
      setMirrorOpen(false)
    })
  }

  const statItems = [
    {
      key: 'profiles',
      label: t('statProfiles'),
      value: String(overview?.stats?.profilesTotal ?? profiles.length),
      extra: `${t('trashToggle')} ${overview?.stats?.trashedProfiles ?? trash.length}`,
    },
    {
      key: 'running',
      label: t('statRunning'),
      value: String(overview?.stats?.runningProfiles ?? profiles.filter((p) => p.running).length),
      extra: mirrorActive ? '镜像同步运行中' : '镜像同步未开启',
    },
    {
      key: 'proxies',
      label: t('statProxies'),
      value: String(overview?.stats?.proxiesTotal ?? proxies.length),
      extra: overview?.config?.geoipPath ? '离线 GeoIP 已配置' : '在线探测',
    },
    {
      key: 'tools',
      label: t('statTools'),
      value: String((overview?.mcp?.mountedToolsCount || 0) + 8),
      extra: `MCP ${overview?.mcp?.mountedToolsCount || 0} / 宿主 8`,
    },
  ]

  if (!sidecarRunning) {
    return (
      <>
        <StatBar items={statItems} />
        <EmptyState
          title={overview?.agent?.installed ? 'Sidecar 尚未启动' : '尚未完成运行环境初始化'}
          action={
            overview?.agent?.installed ? (
              <Button
                variant="primary"
                loading={busyId === 'start-sidecar'}
                onClick={() => runAction('start-sidecar', () => api.runtime({ action: 'start' }))}
              >
                {t('startSidecar')}
              </Button>
            ) : (
              <Button variant="primary" onClick={onOpenEnv}>
                {t('goEnv')}
              </Button>
            )
          }
        />
      </>
    )
  }

  return (
    <>
      <StatBar items={statItems} />

      <FilterBar
        filters={
          <>
            <DropdownSelect
              aria-label="分组筛选"
              value={groupFilter}
              options={groupOptions}
              onChange={setGroupFilter}
            />
            <DropdownSelect
              aria-label="状态筛选"
              value={statusFilter}
              options={statusOptions}
              onChange={setStatusFilter}
            />
            <SearchField
              value={search}
              onValueChange={setSearch}
              placeholder={t('searchProfiles')}
              aria-label={t('searchProfiles')}
            />
          </>
        }
        actions={
          <div className="omnimux-pibrowse-row">
            <Button
              variant={mirrorActive ? 'primary' : 'outline'}
              size="sm"
              loading={busyId === 'mirror'}
              onClick={handleMirrorToggle}
            >
              {mirrorActive ? t('mirrorStop') : t('mirrorStart')}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setTrashView((v) => !v)}>
              {trashView ? t('backToProfiles') : `${t('trashToggle')} (${trash.length})`}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setBatchOpen(true)}>
              {t('batchCreate')}
            </Button>
            <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
              {t('newProfile')}
            </Button>
          </div>
        }
      />

      {visibleRows.length === 0 ? (
        <EmptyState
          compact
          title={loading ? '正在加载配置列表' : trashView ? '回收站为空' : '暂无匹配的配置文件'}
          action={
            !loading && !trashView ? (
              <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
                {t('newProfile')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="omnimux-pibrowse-table-wrap">
          <table className="omnimux-pibrowse-table">
            <thead>
              <tr>
                <th>名称</th>
                <th>设备 Persona</th>
                <th>代理</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <div><strong>{row.name || row.id}</strong></div>
                    <div className="omnimux-pibrowse-muted">{row.project_id || row.group_id || row.group || '默认分组'}</div>
                  </td>
                  <td className="omnimux-pibrowse-mono">{row.persona_id || row.persona || '默认随机'}</td>
                  <td>{row.proxy?.name || row.proxy?.host || row.proxy_id || '直连'}</td>
                  <td>
                    {row.running ? (
                      <Badge variant="success">{t('statusRunningOpt')}</Badge>
                    ) : (
                      <Badge variant="neutral">{t('statusStoppedOpt')}</Badge>
                    )}
                  </td>
                  <td>
                    <div className="omnimux-pibrowse-row-nowrap">
                      {trashView ? (
                        <>
                          <Button
                            variant="secondary"
                            size="sm"
                            loading={busyId === row.id}
                            onClick={() =>
                              runAction(row.id, () =>
                                api.manageProfiles({ action: 'restore', profileId: row.id }),
                              )
                            }
                          >
                            {t('restore')}
                          </Button>
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={() => setPurgeTarget(row)}
                          >
                            {t('purge')}
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            variant={row.running ? 'outline' : 'primary'}
                            size="sm"
                            loading={busyId === row.id}
                            onClick={() =>
                              runAction(row.id, () =>
                                row.running ? api.stopProfile(row.id) : api.launchProfile(row.id),
                              )
                            }
                          >
                            {row.running ? t('stop') : t('launch')}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              runAction(row.id, () =>
                                api.manageProfiles({ action: 'detect_suite', profileId: row.id }),
                              )
                            }
                          >
                            {t('detectSuite')}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              runAction(row.id, () =>
                                api.manageProfiles({ action: 'clone', profileId: row.id }),
                              )
                            }
                          >
                            {t('clone')}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              runAction(row.id, () =>
                                api.manageProfiles({ action: 'rerandomize', profileId: row.id }),
                              )
                            }
                          >
                            {t('rerandomize')}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              runAction(row.id, () =>
                                api.manageProfiles({ action: 'trash', profileId: row.id }),
                              )
                            }
                          >
                            {t('moveToTrash')}
                          </Button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ModalDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title={t('newProfile')}
        footer={
          <div className="omnimux-pibrowse-row">
            <Button variant="outline" onClick={() => setCreateOpen(false)}>{t('cancel')}</Button>
            <Button variant="primary" loading={busyId === 'create'} onClick={handleCreateProfile}>
              {t('confirm')}
            </Button>
          </div>
        }
      >
        <div className="omnimux-pibrowse-field">
          <InputField
            label="配置名称"
            required
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
            placeholder="例如 US-TikTok-01"
          />
          <div className="omnimux-pibrowse-field">
            <span className="omnimux-pibrowse-label">设备 Persona</span>
            <DropdownSelect
              aria-label="选择 Persona"
              value={formPersona}
              options={personaOptions}
              onChange={setFormPersona}
            />
          </div>
          <div className="omnimux-pibrowse-field">
            <span className="omnimux-pibrowse-label">绑定代理</span>
            <DropdownSelect
              aria-label="选择代理"
              value={formProxyId}
              options={proxyOptions}
              onChange={setFormProxyId}
            />
          </div>
          <InputField
            label="启动页 URL"
            value={formStartUrl}
            onChange={(e) => setFormStartUrl(e.target.value)}
            placeholder="https://example.com"
          />
        </div>
      </ModalDialog>

      <ModalDialog
        open={batchOpen}
        onClose={() => setBatchOpen(false)}
        title={t('batchCreate')}
        footer={
          <div className="omnimux-pibrowse-row">
            <Button variant="outline" onClick={() => setBatchOpen(false)}>{t('cancel')}</Button>
            <Button variant="primary" loading={busyId === 'batch'} onClick={handleBatchCreate}>
              {t('confirm')}
            </Button>
          </div>
        }
      >
        <div className="omnimux-pibrowse-field">
          <InputField
            label="名称前缀"
            value={batchPrefix}
            onChange={(e) => setBatchPrefix(e.target.value)}
          />
          <InputField
            label="创建数量（1-50）"
            type="number"
            min="1"
            max="50"
            value={batchCount}
            onChange={(e) => setBatchCount(e.target.value)}
          />
          <div className="omnimux-pibrowse-field">
            <span className="omnimux-pibrowse-label">设备 Persona</span>
            <DropdownSelect
              aria-label="批量 Persona"
              value={formPersona}
              options={personaOptions}
              onChange={setFormPersona}
            />
          </div>
        </div>
      </ModalDialog>

      <ModalDialog
        open={mirrorOpen}
        onClose={() => setMirrorOpen(false)}
        title={t('mirrorStart')}
        footer={
          <div className="omnimux-pibrowse-row">
            <Button variant="outline" onClick={() => setMirrorOpen(false)}>{t('cancel')}</Button>
            <Button variant="primary" loading={busyId === 'mirror'} onClick={handleConfirmMirror}>
              {t('confirm')}
            </Button>
          </div>
        }
      >
        <div className="omnimux-pibrowse-field">
          <span className="omnimux-pibrowse-label">主控窗口</span>
          <DropdownSelect
            aria-label="主控窗口"
            value={mirrorSource}
            options={profiles.filter((p) => p.running).map((p) => ({ value: p.id, label: p.name || p.id }))}
            onChange={(val) => {
              setMirrorSource(val)
              setMirrorTargets(profiles.filter((p) => p.running && p.id !== val).map((p) => p.id))
            }}
          />
          <div className="omnimux-pibrowse-muted">
            跟随窗口数量：{mirrorTargets.length}
          </div>
        </div>
      </ModalDialog>

      <ConfirmModal
        open={Boolean(purgeTarget)}
        onClose={() => setPurgeTarget(null)}
        title="彻底清除配置文件"
        message={`即将永久删除「${purgeTarget?.name || purgeTarget?.id || ''}」及其隔离数据目录，此操作不可撤销。`}
        confirmLabel={t('purge')}
        cancelLabel={t('cancel')}
        confirmVariant="danger"
        confirmLoading={busyId === purgeTarget?.id}
        onConfirm={() => {
          const target = purgeTarget
          if (!target) return
          void runAction(target.id, async () => {
            await api.manageProfiles({ action: 'purge', profileId: target.id, confirm: true })
            setPurgeTarget(null)
          })
        }}
      />
    </>
  )
}
