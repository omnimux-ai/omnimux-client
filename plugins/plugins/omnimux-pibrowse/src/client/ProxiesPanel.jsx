import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Badge,
  Button,
  ConfirmModal,
  DropdownSelect,
  EmptyState,
  InputField,
  ModalDialog,
} from 'dsh-ui-kit'
import { requestFilePicker } from 'dsh-ui-kit/native-file-picker'
import { api } from './api.js'

export function ProxiesPanel({ overview, t, onNotify, onOverviewChanged }) {
  const [proxies, setProxies] = useState([])
  const [geoipPath, setGeoipPath] = useState('')
  const [blocklists, setBlocklists] = useState([])
  const [activeBlocklist, setActiveBlocklist] = useState('')
  const [blocklistContent, setBlocklistContent] = useState('')
  const [busyId, setBusyId] = useState(null)

  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [mmdbOpen, setMmdbOpen] = useState(false)
  const [mmdbInput, setMmdbInput] = useState('')
  const [newBlOpen, setNewBlOpen] = useState(false)
  const [newBlName, setNewBlName] = useState('')
  const [diagModal, setDiagModal] = useState(null)
  const [deleteProxyTarget, setDeleteProxyTarget] = useState(null)
  const [deleteBlOpen, setDeleteBlOpen] = useState(false)

  const sidecarRunning = Boolean(overview?.sidecar?.running)

  const loadData = useCallback(async () => {
    if (!overview?.sidecar?.running) {
      setProxies([])
      setBlocklists([])
      return
    }
    try {
      const [pxRes, blRes] = await Promise.all([
        api.listProxies(),
        api.listBlocklists().catch((err) => {
          onNotify(err instanceof Error ? err.message : '加载域名规则失败', true)
          return { blocklists: [] }
        }),
      ])
      setProxies(Array.isArray(pxRes?.proxies) ? pxRes.proxies : [])
      setGeoipPath(pxRes?.geoip?.configuredPath || '')
      setMmdbInput(pxRes?.geoip?.configuredPath || '')
      const blList = Array.isArray(blRes?.blocklists) ? blRes.blocklists : []
      setBlocklists(blList)
      if (!activeBlocklist && blList.length > 0) {
        const firstName = typeof blList[0] === 'string' ? blList[0] : blList[0]?.name
        if (firstName) {
          setActiveBlocklist(firstName)
          const detail = await api.getBlocklist(firstName).catch((err) => {
            onNotify(err instanceof Error ? err.message : '读取规则详情失败', true)
            return null
          })
          setBlocklistContent(String(detail?.blocklist?.content ?? detail?.blocklist ?? ''))
        }
      }
    } catch (err) {
      onNotify(err instanceof Error ? err.message : '加载代理池失败', true)
    }
  }, [overview?.sidecar?.running, activeBlocklist, onNotify])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const selectBlocklist = async (name) => {
    setActiveBlocklist(name)
    if (!name || name === 'all') {
      setBlocklistContent('')
      return
    }
    try {
      const res = await api.getBlocklist(name)
      setBlocklistContent(String(res?.blocklist?.content ?? res?.blocklist ?? ''))
    } catch (err) {
      onNotify(err instanceof Error ? err.message : '读取规则失败', true)
    }
  }

  const blocklistOptions = useMemo(() => {
    const items = [{ value: 'all', label: t('allOption') }]
    for (const item of blocklists) {
      const name = typeof item === 'string' ? item : item?.name
      if (name) items.push({ value: name, label: name })
    }
    return items
  }, [blocklists, t])

  const isAllowOnly = /(?:^|\n)\s*@allow-only\b/.test(blocklistContent)

  const handlePickMmdb = async () => {
    const picked = await requestFilePicker(
      { mode: 'file', title: '选择 MaxMind .mmdb 数据库' },
      async () => ({ ok: false, status: 503, body: { path: null } }),
    )
    if (picked?.ok && picked.body?.path) {
      setMmdbInput(picked.body.path)
    }
    setMmdbOpen(true)
  }

  const handleSaveMmdb = async () => {
    setBusyId('mmdb')
    try {
      await api.runtime({ action: 'configure_paths', geoipPath: mmdbInput.trim() || null })
      setMmdbOpen(false)
      await Promise.all([loadData(), onOverviewChanged()])
    } catch (err) {
      onNotify(err instanceof Error ? err.message : '保存 .mmdb 路径失败', true)
    } finally {
      setBusyId(null)
    }
  }

  const handleImportProxies = async () => {
    setBusyId('import')
    try {
      await api.importProxies({ text: importText })
      setImportOpen(false)
      setImportText('')
      await Promise.all([loadData(), onOverviewChanged()])
    } catch (err) {
      onNotify(err instanceof Error ? err.message : '批量导入代理失败', true)
    } finally {
      setBusyId(null)
    }
  }

  const handleProxyProbe = async (proxy, action) => {
    setBusyId(`${action}:${proxy.id}`)
    try {
      const res = await api.checkProxy({ proxyId: proxy.id, action })
      if (action === 'diagnose') {
        setDiagModal({ proxy, result: res?.result })
      }
      await loadData()
    } catch (err) {
      onNotify(err instanceof Error ? err.message : '代理检测失败', true)
    } finally {
      setBusyId(null)
    }
  }

  const handleSaveBlocklist = async () => {
    if (!activeBlocklist || activeBlocklist === 'all') {
      setNewBlOpen(true)
      return
    }
    setBusyId('save-bl')
    try {
      await api.manageBlocklists({ action: 'save', name: activeBlocklist, content: blocklistContent })
      await loadData()
    } catch (err) {
      onNotify(err instanceof Error ? err.message : '保存域名规则失败', true)
    } finally {
      setBusyId(null)
    }
  }

  const handleCreateBlocklist = async () => {
    const trimmed = newBlName.trim()
    if (!trimmed) {
      onNotify('请输入规则集名称', true)
      return
    }
    setBusyId('new-bl')
    try {
      await api.manageBlocklists({ action: 'save', name: trimmed, content: blocklistContent || '' })
      setActiveBlocklist(trimmed)
      setNewBlName('')
      setNewBlOpen(false)
      await loadData()
    } catch (err) {
      onNotify(err instanceof Error ? err.message : '创建规则集失败', true)
    } finally {
      setBusyId(null)
    }
  }

  if (!sidecarRunning) {
    return <EmptyState compact title="启动 Sidecar 后可管理代理池与域名规则" />
  }

  return (
    <>
      <div className="omnimux-pibrowse-card-head">
        <div className="omnimux-pibrowse-row">
          <h2 className="omnimux-pibrowse-card-title">{t('proxyPool')}</h2>
          <Badge variant={geoipPath ? 'success' : 'neutral'}>
            {geoipPath ? '离线 GeoIP 已启用' : '离线 GeoIP 未配置'}
          </Badge>
        </div>
        <div className="omnimux-pibrowse-row">
          <Button variant="outline" size="sm" onClick={handlePickMmdb}>
            {t('selectMmdb')}
          </Button>
          <Button variant="primary" size="sm" onClick={() => setImportOpen(true)}>
            {t('importProxies')}
          </Button>
        </div>
      </div>

      {proxies.length === 0 ? (
        <EmptyState
          compact
          title="代理池为空"
          action={
            <Button variant="primary" size="sm" onClick={() => setImportOpen(true)}>
              {t('importProxies')}
            </Button>
          }
        />
      ) : (
        <div className="omnimux-pibrowse-table-wrap">
          <table className="omnimux-pibrowse-table">
            <thead>
              <tr>
                <th>名称</th>
                <th>端点</th>
                <th>出口与时区</th>
                <th>凭据与轮换</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {proxies.map((px) => (
                <tr key={px.id}>
                  <td><strong>{px.name || px.id}</strong></td>
                  <td className="omnimux-pibrowse-mono">
                    {px.url || `${px.kind || px.scheme || px.protocol || 'http'}://${px.host || ''}:${px.port || ''}`}
                  </td>
                  <td className="omnimux-pibrowse-mono">
                    {px.last_ip || px.exit_ip || px.ip || '未检测'}{' '}
                    {(px.last_country || px.country) ? `(${px.last_country || px.country})` : ''}{' '}
                    {px.last_timezone || px.timezone || ''}
                  </td>
                  <td>
                    <div className="omnimux-pibrowse-row">
                      {px.hasPassword && <Badge variant="neutral">已存凭据</Badge>}
                      {px.hasRotateUrl ? (
                        <Badge variant="info">支持轮换</Badge>
                      ) : (
                        <span className="omnimux-pibrowse-muted">固定出口</span>
                      )}
                    </div>
                  </td>
                  <td>
                    <div className="omnimux-pibrowse-row-nowrap">
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={busyId === `check:${px.id}`}
                        onClick={() => handleProxyProbe(px, 'check')}
                      >
                        {t('checkProxy')}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        loading={busyId === `diagnose:${px.id}`}
                        onClick={() => handleProxyProbe(px, 'diagnose')}
                      >
                        {t('diagnoseProxy')}
                      </Button>
                      {px.hasRotateUrl && (
                        <Button
                          variant="outline"
                          size="sm"
                          loading={busyId === `rotate:${px.id}`}
                          onClick={() => handleProxyProbe(px, 'rotate')}
                        >
                          {t('rotateProxy')}
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleteProxyTarget(px)}
                      >
                        {t('deleteProxy')}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="omnimux-pibrowse-card">
        <div className="omnimux-pibrowse-card-head">
          <div className="omnimux-pibrowse-row">
            <h2 className="omnimux-pibrowse-card-title">{t('blocklistsTitle')}</h2>
            <DropdownSelect
              aria-label="选择域名规则集"
              value={activeBlocklist || 'all'}
              options={blocklistOptions}
              onChange={selectBlocklist}
            />
            {isAllowOnly && <Badge variant="info">{t('allowOnlyBadge')}</Badge>}
          </div>
          <div className="omnimux-pibrowse-row">
            <Button variant="outline" size="sm" onClick={() => setNewBlOpen(true)}>
              {t('newBlocklist')}
            </Button>
            {activeBlocklist && activeBlocklist !== 'all' && (
              <Button variant="outline" size="sm" onClick={() => setDeleteBlOpen(true)}>
                {t('deleteBlocklist')}
              </Button>
            )}
            <Button
              variant="primary"
              size="sm"
              loading={busyId === 'save-bl'}
              onClick={handleSaveBlocklist}
            >
              {t('saveBlocklist')}
            </Button>
          </div>
        </div>
        <textarea
          className="omnimux-pibrowse-textarea"
          aria-label="域名规则内容"
          value={blocklistContent}
          onChange={(e) => setBlocklistContent(e.target.value)}
          placeholder={'@allow-only\n*.example.com'}
        />
      </div>

      <ModalDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title={t('importProxies')}
        footer={
          <div className="omnimux-pibrowse-row">
            <Button variant="outline" onClick={() => setImportOpen(false)}>{t('cancel')}</Button>
            <Button variant="primary" loading={busyId === 'import'} onClick={handleImportProxies}>
              {t('confirm')}
            </Button>
          </div>
        }
      >
        <div className="omnimux-pibrowse-field">
          <span className="omnimux-pibrowse-label">每行一条（host:port / host:port:user:pass / scheme://...）</span>
          <textarea
            className="omnimux-pibrowse-textarea"
            aria-label="批量导入代理列表"
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder="socks5://user:pass@proxy.example.com:1080"
          />
        </div>
      </ModalDialog>

      <ModalDialog
        open={mmdbOpen}
        onClose={() => setMmdbOpen(false)}
        title={t('selectMmdb')}
        footer={
          <div className="omnimux-pibrowse-row">
            <Button variant="outline" onClick={() => setMmdbOpen(false)}>{t('cancel')}</Button>
            <Button variant="primary" loading={busyId === 'mmdb'} onClick={handleSaveMmdb}>
              {t('save')}
            </Button>
          </div>
        }
      >
        <InputField
          label="离线 MaxMind GeoLite2 .mmdb 绝对路径"
          value={mmdbInput}
          onChange={(e) => setMmdbInput(e.target.value)}
          placeholder="/path/to/GeoLite2-City.mmdb"
        />
      </ModalDialog>

      <ModalDialog
        open={newBlOpen}
        onClose={() => setNewBlOpen(false)}
        title={t('newBlocklist')}
        footer={
          <div className="omnimux-pibrowse-row">
            <Button variant="outline" onClick={() => setNewBlOpen(false)}>{t('cancel')}</Button>
            <Button variant="primary" loading={busyId === 'new-bl'} onClick={handleCreateBlocklist}>
              {t('confirm')}
            </Button>
          </div>
        }
      >
        <InputField
          label="规则集名称"
          required
          value={newBlName}
          onChange={(e) => setNewBlName(e.target.value)}
          placeholder="例如 shop-allowlist"
        />
      </ModalDialog>

      <ModalDialog
        open={Boolean(diagModal)}
        onClose={() => setDiagModal(null)}
        title={`代理诊断（${diagModal?.proxy?.name || diagModal?.proxy?.id || ''}）`}
        footer={
          <Button variant="primary" onClick={() => setDiagModal(null)}>
            {t('close')}
          </Button>
        }
      >
        <pre className="omnimux-pibrowse-log">
          {JSON.stringify(diagModal?.result ?? {}, null, 2)}
        </pre>
      </ModalDialog>

      <ConfirmModal
        open={Boolean(deleteProxyTarget)}
        onClose={() => setDeleteProxyTarget(null)}
        title="删除代理条目"
        message={`确认删除代理「${deleteProxyTarget?.name || deleteProxyTarget?.id || ''}」？若存在活跃配置引用将自动阻止。`}
        confirmLabel={t('deleteProxy')}
        cancelLabel={t('cancel')}
        confirmVariant="danger"
        confirmLoading={busyId === `del:${deleteProxyTarget?.id}`}
        onConfirm={async () => {
          const target = deleteProxyTarget
          if (!target) return
          setBusyId(`del:${target.id}`)
          try {
            await api.deleteProxy({ proxyId: target.id, confirm: true })
            setDeleteProxyTarget(null)
            await Promise.all([loadData(), onOverviewChanged()])
          } catch (err) {
            onNotify(err instanceof Error ? err.message : '删除代理失败', true)
          } finally {
            setBusyId(null)
          }
        }}
      />

      <ConfirmModal
        open={deleteBlOpen}
        onClose={() => setDeleteBlOpen(false)}
        title="删除域名规则集"
        message={`确认删除规则集「${activeBlocklist}」？`}
        confirmLabel={t('deleteBlocklist')}
        cancelLabel={t('cancel')}
        confirmVariant="danger"
        confirmLoading={busyId === 'del-bl'}
        onConfirm={async () => {
          setBusyId('del-bl')
          try {
            await api.manageBlocklists({ action: 'delete', name: activeBlocklist, confirm: true })
            setActiveBlocklist('')
            setBlocklistContent('')
            setDeleteBlOpen(false)
            await loadData()
          } catch (err) {
            onNotify(err instanceof Error ? err.message : '删除规则集失败', true)
          } finally {
            setBusyId(null)
          }
        }}
      />
    </>
  )
}
