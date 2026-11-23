import { useEffect, useState } from 'react'
import {
  Badge,
  Button,
  ConfirmModal,
  DropdownSelect,
  EmptyState,
  InputField,
  ModalDialog,
  StatBar,
  Tabs,
} from 'dsh-ui-kit'
import { api } from './api.js'

const SEL_STATUS_META = {
  pending_review: { label: '待评估', variant: 'neutral' },
  approved: { label: '已通过', variant: 'success' },
  recheck: { label: '待复核', variant: 'warning' },
  rejected: { label: '已放弃', variant: 'danger' },
}

const ASSET_STATUS_META = {
  none: { label: '未生成', variant: 'neutral' },
  script_ready: { label: '脚本就绪', variant: 'info' },
  generating: { label: '生成中', variant: 'warning' },
  partial: { label: '部分完成', variant: 'warning' },
  ready: { label: '素材就绪', variant: 'success' },
  failed: { label: '生成失败', variant: 'danger' },
}

export function LibraryAssetsPanel({ assetsOnly = false, overview, t, onNotify, refreshToken, onLibraryChanged }) {
  const [query, setQuery] = useState('')
  const [region, setRegion] = useState('')
  const [selectionStatus, setSelectionStatus] = useState('all')
  const [assetStatus, setAssetStatus] = useState('all')
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [selectedIds, setSelectedIds] = useState(() => new Set())

  const [statusModalOpen, setStatusModalOpen] = useState(false)
  const [targetStatus, setTargetStatus] = useState('approved')
  const [reviewNotes, setReviewNotes] = useState('')

  const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false)

  const [scriptModalOpen, setScriptModalOpen] = useState(false)
  const [extraSellingPoints, setExtraSellingPoints] = useState('')

  const [genModalKind, setGenModalKind] = useState('')
  const [genCount, setGenCount] = useState('2')
  const [genPrompt, setGenPrompt] = useState('')
  const [skipExisting, setSkipExisting] = useState(true)
  const [busy, setBusy] = useState(false)

  const [studioItem, setStudioItem] = useState(null)
  const [studioTab, setStudioTab] = useState('image')

  async function loadItems() {
    setLoading(true)
    try {
      const res = await api.listLibrary({
        query,
        region,
        selectionStatus: assetsOnly ? 'all' : selectionStatus,
        assetStatus,
        assetsOnly: assetsOnly ? true : undefined,
      })
      setItems(res.items || [])
    } catch (err) {
      onNotify(err?.message || '读取选品库失败', true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadItems()
  }, [assetsOnly, refreshToken])

  function toggleRow(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    if (selectedIds.size === items.length && items.length > 0) setSelectedIds(new Set())
    else setSelectedIds(new Set(items.map((x) => x.id)))
  }

  const chosenIds = [...selectedIds]

  async function handleBatchStatus() {
    if (chosenIds.length === 0) return
    setBusy(true)
    try {
      const res = await api.updateStatus({ ids: chosenIds, selectionStatus: targetStatus, reviewNotes })
      setStatusModalOpen(false)
      setReviewNotes('')
      await loadItems()
      onLibraryChanged?.()
      onNotify(`已更新 ${res.updatedCount} 个商品状态`)
    } catch (err) {
      onNotify(err?.message || '更新状态失败', true)
    } finally {
      setBusy(false)
    }
  }

  async function handleBatchRemove() {
    if (chosenIds.length === 0) return
    setBusy(true)
    try {
      const res = await api.removeProducts({ ids: chosenIds, confirm: true })
      setRemoveConfirmOpen(false)
      setSelectedIds(new Set())
      await loadItems()
      onLibraryChanged?.()
      onNotify(`已移除 ${res.removedCount} 个商品`)
    } catch (err) {
      onNotify(err?.message || '移除失败', true)
    } finally {
      setBusy(false)
    }
  }

  async function handleEnrichChannel() {
    if (chosenIds.length === 0) return
    setBusy(true)
    try {
      const res = await api.updateStatus({ action: 'enrich_channel', ids: chosenIds })
      await loadItems()
      const firstErr = res.results?.find((r) => !r.ok)?.message
      onNotify(
        res.succeeded > 0
          ? `已更新 ${res.succeeded}/${res.total} 个商品渠道占比`
          : firstErr || '当前数据源未提供渠道占比',
        res.succeeded === 0
      )
    } catch (err) {
      onNotify(err?.message || '补齐渠道占比失败', true)
    } finally {
      setBusy(false)
    }
  }

  async function handleGenerateScript(ids = chosenIds) {
    if (ids.length === 0) return
    setBusy(true)
    try {
      const res = await api.generateAssets({ kind: 'script', productIds: ids, extraSellingPoints })
      setScriptModalOpen(false)
      await loadItems()
      onLibraryChanged?.()
      onNotify(`视频脚本完成 ${res.succeeded}/${res.total}`)
    } catch (err) {
      onNotify(err?.message || '生成视频脚本失败', true)
    } finally {
      setBusy(false)
    }
  }

  async function handleGenerateMedia(kind, ids = chosenIds) {
    if (ids.length === 0) return
    setBusy(true)
    try {
      const res = await api.generateAssets({
        kind,
        productIds: ids,
        countPerProduct: Number(genCount) || (kind === 'image' ? 2 : 1),
        skipExisting,
        prompt: genPrompt,
      })
      setGenModalKind('')
      await loadItems()
      onLibraryChanged?.()
      onNotify(`已提交 ${res.planned} 个${kind === 'image' ? '图片' : '视频'}生成任务`)
    } catch (err) {
      onNotify(err?.message || '素材生成失败', true)
    } finally {
      setBusy(false)
    }
  }

  async function handleSyncOmnimuxProducts() {
    if (chosenIds.length === 0) return
    setBusy(true)
    try {
      const res = await api.generateAssets({ kind: 'sync_omnimux_products', productIds: chosenIds })
      await loadItems()
      onNotify(`已同步 ${res.succeeded}/${res.total} 个商品至 OmniMux 商品库`)
    } catch (err) {
      onNotify(err?.message || '同步商品库失败', true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {!assetsOnly && overview?.stats && (
        <StatBar
          items={[
            { key: 'total', label: '库内商品', value: String(overview.stats.libraryTotal) },
            { key: 'approved', label: '已通过', value: String(overview.stats.approvedCount) },
            { key: 'pending', label: '待评估', value: String(overview.stats.pendingCount) },
            { key: 'assets', label: '素材就绪', value: String(overview.stats.assetsReadyCount) },
          ]}
        />
      )}

      <div className="omnimux-ttsel-card">
        <div className="omnimux-ttsel-grid">
          <InputField label="标题 / 商品ID" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索商品" />
          {!assetsOnly && (
            <InputField label="站点" value={region} onChange={(e) => setRegion(e.target.value)} placeholder="如 US" />
          )}
          {!assetsOnly && (
            <div className="omnimux-ttsel-field">
              <span className="omnimux-ttsel-label">选品状态</span>
              <DropdownSelect
                aria-label="选品状态"
                value={selectionStatus}
                options={[
                  { value: 'all', label: '不限' },
                  { value: 'pending_review', label: '待评估' },
                  { value: 'approved', label: '已通过' },
                  { value: 'recheck', label: '待复核' },
                  { value: 'rejected', label: '已放弃' },
                ]}
                onChange={setSelectionStatus}
              />
            </div>
          )}
          <div className="omnimux-ttsel-field">
            <span className="omnimux-ttsel-label">素材状态</span>
            <DropdownSelect
              aria-label="素材状态"
              value={assetStatus}
              options={[
                { value: 'all', label: '不限' },
                { value: 'none', label: '未生成' },
                { value: 'script_ready', label: '脚本就绪' },
                { value: 'ready', label: '素材就绪' },
                { value: 'failed', label: '生成失败' },
              ]}
              onChange={setAssetStatus}
            />
          </div>
        </div>
        <div className="omnimux-ttsel-row">
          <Button variant="primary" loading={loading} onClick={loadItems}>
            查询
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setQuery('')
              setRegion('')
              setSelectionStatus('all')
              setAssetStatus('all')
            }}
          >
            {t('reset')}
          </Button>
        </div>
      </div>

      <div className="omnimux-ttsel-card">
        <div className="omnimux-ttsel-row">
          <Button
            size="sm"
            variant="secondary"
            disabled={chosenIds.length === 0 || busy}
            onClick={() => {
              setGenCount('2')
              setGenPrompt(overview?.settings?.defaultImagePrompt || '')
              setGenModalKind('image')
            }}
          >
            {t('batchGenImages')}
          </Button>
          <Button size="sm" variant="secondary" disabled={chosenIds.length === 0 || busy} onClick={() => setScriptModalOpen(true)}>
            {t('batchGenScript')}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={chosenIds.length === 0 || busy}
            onClick={() => {
              setGenCount('1')
              setGenPrompt(overview?.settings?.defaultVideoPrompt || '')
              setGenModalKind('video')
            }}
          >
            {t('batchGenVideos')}
          </Button>
          {!assetsOnly && (
            <>
              <Button size="sm" variant="secondary" disabled={chosenIds.length === 0 || busy} onClick={handleEnrichChannel}>
                {t('batchEnrichChannel')}
              </Button>
              <Button size="sm" variant="secondary" disabled={chosenIds.length === 0 || busy} onClick={() => setStatusModalOpen(true)}>
                {t('batchChangeStatus')}
              </Button>
              <Button size="sm" variant="primary" disabled={chosenIds.length === 0 || busy} onClick={handleSyncOmnimuxProducts}>
                {t('syncToProducts')}
              </Button>
              <div className="omnimux-ttsel-row-end">
                <Button size="sm" variant="danger" disabled={chosenIds.length === 0 || busy} onClick={() => setRemoveConfirmOpen(true)}>
                  {t('batchRemove')}
                </Button>
              </div>
            </>
          )}
        </div>

        {items.length === 0 ? (
          <EmptyState title={assetsOnly ? '暂无已生成素材的商品' : '选品库为空'} />
        ) : (
          <div className="omnimux-ttsel-table-wrap">
            <table className="omnimux-ttsel-table">
              <thead>
                <tr>
                  <th style={{ width: '36px' }}>
                    <input
                      type="checkbox"
                      aria-label="全选商品"
                      checked={items.length > 0 && selectedIds.size === items.length}
                      onChange={toggleAll}
                    />
                  </th>
                  <th>商品</th>
                  <th>价格</th>
                  <th>佣金率</th>
                  <th>7天销量</th>
                  <th>达人占比</th>
                  <th>商品卡占比</th>
                  <th>选品状态</th>
                  <th>素材状态</th>
                  <th>图 / 视</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`勾选 ${item.title}`}
                        checked={selectedIds.has(item.id)}
                        onChange={() => toggleRow(item.id)}
                      />
                    </td>
                    <td>
                      <div className="omnimux-ttsel-prod-cell">
                        {item.coverUrl ? (
                          <img className="omnimux-ttsel-thumb" src={item.coverUrl} alt="" />
                        ) : (
                          <div className="omnimux-ttsel-thumb">IMG</div>
                        )}
                        <div>
                          <div className="omnimux-ttsel-title-clamp">{item.title}</div>
                          {item.syncedProductId && <Badge variant="success">已同步产品库</Badge>}
                        </div>
                      </div>
                    </td>
                    <td className="omnimux-ttsel-num">{item.priceDisplay}</td>
                    <td className="omnimux-ttsel-num">{item.commissionRate !== null ? `${item.commissionRate}%` : '—'}</td>
                    <td className="omnimux-ttsel-num">{item.sales7d ?? '—'}</td>
                    <td className="omnimux-ttsel-num">
                      {item.channelMetrics?.creatorRatio !== null && item.channelMetrics?.creatorRatio !== undefined
                        ? `${item.channelMetrics.creatorRatio}%`
                        : '—'}
                    </td>
                    <td className="omnimux-ttsel-num">
                      {item.channelMetrics?.productCardRatio !== null && item.channelMetrics?.productCardRatio !== undefined
                        ? `${item.channelMetrics.productCardRatio}%`
                        : '—'}
                    </td>
                    <td>
                      <Badge variant={SEL_STATUS_META[item.selectionStatus]?.variant || 'neutral'}>
                        {SEL_STATUS_META[item.selectionStatus]?.label || item.selectionStatus}
                      </Badge>
                    </td>
                    <td>
                      <Badge variant={ASSET_STATUS_META[item.assetStatus]?.variant || 'neutral'}>
                        {ASSET_STATUS_META[item.assetStatus]?.label || item.assetStatus}
                      </Badge>
                    </td>
                    <td className="omnimux-ttsel-num">
                      {(item.generatedImages || []).filter((x) => x.status === 'ready').length}/10 {' '}
                      {(item.generatedVideos || []).filter((x) => x.status === 'ready').length}/5
                    </td>
                    <td>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setStudioItem(item)
                          setStudioTab('image')
                        }}
                      >
                        {t('assetStudio')}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ModalDialog
        open={statusModalOpen}
        onClose={() => setStatusModalOpen(false)}
        title={`批量修改选品状态 (${chosenIds.length})`}
        footer={
          <div className="omnimux-ttsel-row">
            <Button variant="secondary" onClick={() => setStatusModalOpen(false)}>
              {t('cancel')}
            </Button>
            <Button variant="primary" loading={busy} onClick={handleBatchStatus}>
              {t('confirm')}
            </Button>
          </div>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <DropdownSelect
            aria-label="目标状态"
            value={targetStatus}
            options={[
              { value: 'approved', label: '已通过' },
              { value: 'pending_review', label: '待评估' },
              { value: 'recheck', label: '待复核' },
              { value: 'rejected', label: '已放弃' },
            ]}
            onChange={setTargetStatus}
          />
          <textarea
            className="omnimux-ttsel-textarea"
            placeholder="评估备注（可选）"
            value={reviewNotes}
            onChange={(e) => setReviewNotes(e.target.value)}
          />
        </div>
      </ModalDialog>

      <ModalDialog
        open={scriptModalOpen}
        onClose={() => setScriptModalOpen(false)}
        title={`批量生成视频脚本 (${chosenIds.length})`}
        footer={
          <div className="omnimux-ttsel-row">
            <Button variant="secondary" onClick={() => setScriptModalOpen(false)}>
              {t('cancel')}
            </Button>
            <Button variant="primary" loading={busy} onClick={() => handleGenerateScript(chosenIds)}>
              开始生成
            </Button>
          </div>
        }
      >
        <div className="omnimux-ttsel-field">
          <label className="omnimux-ttsel-label" htmlFor="ttsel-selling-points">
            补充卖点（可选）
          </label>
          <textarea
            id="ttsel-selling-points"
            className="omnimux-ttsel-textarea"
            placeholder="例如：主打轻便随行与快速起效"
            value={extraSellingPoints}
            onChange={(e) => setExtraSellingPoints(e.target.value)}
          />
        </div>
      </ModalDialog>

      <ModalDialog
        open={Boolean(genModalKind)}
        onClose={() => setGenModalKind('')}
        title={genModalKind === 'image' ? `批量生成带货图片 (${chosenIds.length})` : `批量生成竖屏视频 (${chosenIds.length})`}
        footer={
          <div className="omnimux-ttsel-row">
            <Button variant="secondary" onClick={() => setGenModalKind('')}>
              {t('cancel')}
            </Button>
            <Button variant="primary" loading={busy} onClick={() => handleGenerateMedia(genModalKind, chosenIds)}>
              开始生成
            </Button>
          </div>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <InputField
            label={genModalKind === 'image' ? '每品生成张数 (1-10，单批上限 60)' : '每品生成个数 (1-5，单批上限 20)'}
            value={genCount}
            onChange={(e) => setGenCount(e.target.value)}
          />
          <label className="omnimux-ttsel-check-row">
            <input type="checkbox" checked={skipExisting} onChange={(e) => setSkipExisting(e.target.checked)} />
            <span>跳过已有素材的商品</span>
          </label>
          <textarea
            className="omnimux-ttsel-textarea"
            value={genPrompt}
            onChange={(e) => setGenPrompt(e.target.value)}
            placeholder="提示词（留空使用系统默认配置）"
          />
        </div>
      </ModalDialog>

      <ModalDialog
        open={Boolean(studioItem)}
        onClose={() => setStudioItem(null)}
        title={studioItem ? `素材工坊 ${studioItem.title.slice(0, 42)}` : '素材工坊'}
        size="lg"
      >
        {studioItem && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <Tabs
              items={[
                { id: 'image', label: `图片 (${(studioItem.generatedImages || []).length}/10)` },
                { id: 'video', label: `视频 (${(studioItem.generatedVideos || []).length}/5)` },
              ]}
              activeId={studioTab}
              onChange={setStudioTab}
              size="sm"
            />
            {studioTab === 'image' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <Button size="sm" variant="primary" loading={busy} onClick={() => handleGenerateMedia('image', [studioItem.id])}>
                  生成 2 张 3:4 带货图
                </Button>
                {(studioItem.generatedImages || []).length === 0 ? (
                  <EmptyState title="尚未生成图片" />
                ) : (
                  <div className="omnimux-ttsel-log">{JSON.stringify(studioItem.generatedImages, null, 2)}</div>
                )}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div className="omnimux-ttsel-row">
                  <Button size="sm" variant="secondary" loading={busy} onClick={() => handleGenerateScript([studioItem.id])}>
                    重写爆款视频脚本
                  </Button>
                  <Button size="sm" variant="primary" loading={busy} onClick={() => handleGenerateMedia('video', [studioItem.id])}>
                    生成 1 个 9:16 竖版视频
                  </Button>
                </div>
                {studioItem.videoScript && (
                  <div className="omnimux-ttsel-log">{JSON.stringify(studioItem.videoScript, null, 2)}</div>
                )}
              </div>
            )}
          </div>
        )}
      </ModalDialog>

      <ConfirmModal
        open={removeConfirmOpen}
        onClose={() => setRemoveConfirmOpen(false)}
        onConfirm={handleBatchRemove}
        title="确认移除选中商品"
        description={`将从本地选品库移除 ${chosenIds.length} 个商品记录。`}
        confirmLabel="确认移除"
        confirmVariant="danger"
        loading={busy}
      />
    </div>
  )
}
