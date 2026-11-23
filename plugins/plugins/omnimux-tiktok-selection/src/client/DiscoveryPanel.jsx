import { useMemo, useState } from 'react'
import {
  Badge,
  Button,
  Drawer,
  DropdownSelect,
  EmptyState,
  InputField,
  ModalDialog,
} from 'dsh-ui-kit'
import { api } from './api.js'

const DEFAULT_COLS = {
  rank: true,
  price: true,
  periodSales: true,
  periodGmv: true,
  accel: true,
  commission: true,
  creators: true,
  rating: false,
  shopName: true,
  category: true,
}

const COL_LABELS = {
  rank: '排名',
  price: '价格',
  periodSales: '7天/期间销量',
  periodGmv: '期间GMV',
  accel: '加速倍数',
  commission: '佣金率',
  creators: '达人数',
  rating: '评分',
  shopName: '店铺名称',
  category: '类目',
}

function fmtNum(v) {
  if (v === null || v === undefined || v === '') return '—'
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`
  return n.toLocaleString('en-US')
}

function fmtMoney(v, currency = '$') {
  if (v === null || v === undefined || v === '') return '—'
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return `${currency}${n.toLocaleString('en-US', { maximumFractionDigits: 1 })}`
}

function fmtPct(v) {
  if (v === null || v === undefined || v === '') return '—'
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return `${n.toFixed(1)}%`
}

export function DiscoveryPanel({ overview, t, onNotify, onLibraryChanged, onSnapshotsChanged }) {
  const [mode, setMode] = useState('rank')
  const [region, setRegion] = useState('US')
  const [granularity, setGranularity] = useState('daily')
  const [period, setPeriod] = useState(new Date(Date.now() - 86400000).toISOString().slice(0, 10))
  const [category, setCategory] = useState('')
  const [keyword, setKeyword] = useState('')
  const [sortField, setSortField] = useState('periodSales')
  const [sortDir, setSortDir] = useState('desc')
  const [snapshotId, setSnapshotId] = useState('')
  const [salesMin, setSalesMin] = useState('')
  const [salesMax, setSalesMax] = useState('')
  const [commissionMin, setCommissionMin] = useState('')
  const [commissionMax, setCommissionMax] = useState('')
  const [creatorsMin, setCreatorsMin] = useState('')
  const [creatorsMax, setCreatorsMax] = useState('')
  const [shopType, setShopType] = useState('all')
  const [showMore, setShowMore] = useState(false)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [cols, setCols] = useState(DEFAULT_COLS)
  const [colMenuOpen, setColMenuOpen] = useState(false)

  const [detailOpen, setDetailOpen] = useState(false)
  const [detailData, setDetailData] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const [importOpen, setImportOpen] = useState(false)
  const [importName, setImportName] = useState('')
  const [importContent, setImportContent] = useState('')
  const [importing, setImporting] = useState(false)

  const regionOptions = useMemo(
    () => (overview?.regions || [{ code: 'US', labelZh: '美国' }]).map((r) => ({ value: r.code, label: `${r.labelZh} (${r.code})` })),
    [overview]
  )
  const categoryOptions = useMemo(
    () => [{ value: '', label: '全部类目' }, ...(overview?.categories || []).map((c) => ({ value: c, label: c }))],
    [overview]
  )
  const snapshotOptions = useMemo(
    () => [
      { value: '', label: '实时 Hub 数据源' },
      ...(overview?.snapshots || []).map((s) => ({ value: s.id, label: `${s.name} (${s.itemCount})` })),
    ],
    [overview]
  )

  const items = result?.items || []
  const selectableItems = items.filter((i) => !i.inLibrary)

  async function runQuery(targetPage = 1) {
    setLoading(true)
    setError('')
    try {
      const payload =
        mode === 'search'
          ? await api.searchProducts({
              keyword,
              region,
              category,
              sortField: sortField === 'periodSales' ? 'sales7d' : sortField,
              sortDir,
              salesMin: salesMin || undefined,
              salesMax: salesMax || undefined,
              commissionMin: commissionMin || undefined,
              commissionMax: commissionMax || undefined,
              creatorsMin: creatorsMin || undefined,
              creatorsMax: creatorsMax || undefined,
              shopType,
              snapshotId: snapshotId || undefined,
              page: targetPage,
            })
          : await api.queryRank({
              region,
              granularity,
              period,
              category,
              sortField,
              sortDir,
              snapshotId: mode === 'snapshot' ? snapshotId || overview?.snapshots?.[0]?.id || undefined : snapshotId || undefined,
              page: targetPage,
            })
      setResult(payload)
      setSelectedIds(new Set())
    } catch (err) {
      setError(err?.message || '查询失败')
    } finally {
      setLoading(false)
    }
  }

  function handleReset() {
    setCategory('')
    setKeyword('')
    setSalesMin('')
    setSalesMax('')
    setCommissionMin('')
    setCommissionMax('')
    setCreatorsMin('')
    setCreatorsMax('')
    setShopType('all')
    setError('')
  }

  function toggleRow(productId) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(productId)) next.delete(productId)
      else next.add(productId)
      return next
    })
  }

  function toggleAll() {
    if (selectedIds.size === selectableItems.length && selectableItems.length > 0) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(selectableItems.map((i) => i.productId)))
    }
  }

  async function handleIngestSelected() {
    const chosen = items.filter((i) => selectedIds.has(i.productId) && !i.inLibrary)
    if (chosen.length === 0) return
    try {
      const res = await api.ingestProducts({
        products: chosen,
        region,
        source: mode,
        sourceDetail: `${region} ${mode === 'search' ? keyword || category : `${granularity} ${period}`}`,
      })
      onNotify(
        `入库 ${res.addedCount} 个，重复跳过 ${res.duplicatedCount} 个，风险词拦截 ${res.blockedCount} 个`
      )
      setResult((prev) =>
        prev
          ? {
              ...prev,
              items: prev.items.map((item) =>
                res.added.some((a) => a.productId === item.productId) ? { ...item, inLibrary: true } : item
              ),
            }
          : prev
      )
      setSelectedIds(new Set())
      onLibraryChanged?.()
    } catch (err) {
      onNotify(err?.message || '入库失败', true)
    }
  }

  async function openDetail(product, loadVideos = false, loadReviews = false) {
    setDetailOpen(true)
    setDetailLoading(true)
    try {
      const res = await api.getProductDetail({
        productId: product.productId,
        region: product.region || region,
        loadVideos,
        loadReviews,
        productHint: product,
      })
      setDetailData(res)
    } catch (err) {
      onNotify(err?.message || '读取详情失败', true)
    } finally {
      setDetailLoading(false)
    }
  }

  async function handleImportSubmit() {
    if (!importContent.trim()) return
    setImporting(true)
    try {
      const res = await api.importSnapshot({
        name: importName.trim() || `导入快照 ${new Date().toLocaleDateString('zh-CN')}`,
        region,
        content: importContent,
      })
      setImportOpen(false)
      setImportName('')
      setImportContent('')
      setSnapshotId(res.snapshot.id)
      setMode('snapshot')
      onNotify(`已导入快照「${res.snapshot.name}」共 ${res.snapshot.itemCount} 条商品`)
      await onSnapshotsChanged?.()
      const rankRes = await api.queryRank({ region, snapshotId: res.snapshot.id, page: 1 })
      setResult(rankRes)
    } catch (err) {
      onNotify(err?.message || '导入失败', true)
    } finally {
      setImporting(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div className="omnimux-ttsel-card">
        <div className="omnimux-ttsel-row">
          <Button size="sm" variant={mode === 'rank' ? 'primary' : 'secondary'} onClick={() => setMode('rank')}>
            {t('modeRank')}
          </Button>
          <Button size="sm" variant={mode === 'search' ? 'primary' : 'secondary'} onClick={() => setMode('search')}>
            {t('modeSearch')}
          </Button>
          <Button size="sm" variant={mode === 'snapshot' ? 'primary' : 'secondary'} onClick={() => setMode('snapshot')}>
            {t('modeSnapshot')}
          </Button>
          <div className="omnimux-ttsel-row-end">
            <Button size="sm" variant="secondary" onClick={() => setImportOpen(true)}>
              {t('importSnapshot')}
            </Button>
          </div>
        </div>

        <div className="omnimux-ttsel-grid">
          {mode === 'search' && (
            <InputField
              label="关键词"
              placeholder="商品标题关键词"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
          )}
          <div className="omnimux-ttsel-field">
            <span className="omnimux-ttsel-label">站点</span>
            <DropdownSelect aria-label="站点" value={region} options={regionOptions} onChange={setRegion} />
          </div>
          {mode === 'rank' && (
            <div className="omnimux-ttsel-field">
              <span className="omnimux-ttsel-label">榜单粒度</span>
              <DropdownSelect
                aria-label="榜单粒度"
                value={granularity}
                options={[
                  { value: 'daily', label: '日榜' },
                  { value: 'weekly', label: '周榜' },
                  { value: 'monthly', label: '月榜' },
                ]}
                onChange={setGranularity}
              />
            </div>
          )}
          {mode === 'rank' && (
            <InputField label="榜单期次" value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="2026-11-20" />
          )}
          <div className="omnimux-ttsel-field">
            <span className="omnimux-ttsel-label">类目</span>
            <DropdownSelect aria-label="类目" value={category} options={categoryOptions} onChange={setCategory} />
          </div>
          <div className="omnimux-ttsel-field">
            <span className="omnimux-ttsel-label">数据源快照</span>
            <DropdownSelect aria-label="数据源快照" value={snapshotId} options={snapshotOptions} onChange={setSnapshotId} />
          </div>
          <div className="omnimux-ttsel-field">
            <span className="omnimux-ttsel-label">排序字段</span>
            <DropdownSelect
              aria-label="排序字段"
              value={sortField}
              options={[
                { value: 'periodSales', label: '期间销量' },
                { value: 'periodGmv', label: '期间GMV' },
                { value: 'sales7d', label: '7天销量' },
                { value: 'totalSales', label: '总销量' },
                { value: 'commissionRate', label: '佣金率' },
                { value: 'accelRatio', label: '加速倍数' },
              ]}
              onChange={setSortField}
            />
          </div>
          <div className="omnimux-ttsel-field">
            <span className="omnimux-ttsel-label">排序方向</span>
            <DropdownSelect
              aria-label="排序方向"
              value={sortDir}
              options={[
                { value: 'desc', label: '降序' },
                { value: 'asc', label: '升序' },
              ]}
              onChange={setSortDir}
            />
          </div>
        </div>

        {mode === 'search' && showMore && (
          <div className="omnimux-ttsel-grid">
            <div className="omnimux-ttsel-field">
              <span className="omnimux-ttsel-label">7天销量范围</span>
              <div className="omnimux-ttsel-range">
                <InputField aria-label="销量最小值" placeholder="最小" value={salesMin} onChange={(e) => setSalesMin(e.target.value)} />
                <span className="omnimux-ttsel-range-sep">至</span>
                <InputField aria-label="销量最大值" placeholder="最大" value={salesMax} onChange={(e) => setSalesMax(e.target.value)} />
              </div>
            </div>
            <div className="omnimux-ttsel-field">
              <span className="omnimux-ttsel-label">佣金率范围 (%)</span>
              <div className="omnimux-ttsel-range">
                <InputField aria-label="佣金率最小值" placeholder="最小" value={commissionMin} onChange={(e) => setCommissionMin(e.target.value)} />
                <span className="omnimux-ttsel-range-sep">至</span>
                <InputField aria-label="佣金率最大值" placeholder="最大" value={commissionMax} onChange={(e) => setCommissionMax(e.target.value)} />
              </div>
            </div>
            <div className="omnimux-ttsel-field">
              <span className="omnimux-ttsel-label">带货达人数</span>
              <div className="omnimux-ttsel-range">
                <InputField aria-label="达人数最小值" placeholder="最小" value={creatorsMin} onChange={(e) => setCreatorsMin(e.target.value)} />
                <span className="omnimux-ttsel-range-sep">至</span>
                <InputField aria-label="达人数最大值" placeholder="最大" value={creatorsMax} onChange={(e) => setCreatorsMax(e.target.value)} />
              </div>
            </div>
            <div className="omnimux-ttsel-field">
              <span className="omnimux-ttsel-label">店铺类型</span>
              <DropdownSelect
                aria-label="店铺类型"
                value={shopType}
                options={[
                  { value: 'all', label: '不限' },
                  { value: 'cross_border', label: '跨境店铺' },
                  { value: 'local', label: '本土店铺' },
                ]}
                onChange={setShopType}
              />
            </div>
          </div>
        )}

        <div className="omnimux-ttsel-row">
          <Button variant="primary" loading={loading} onClick={() => runQuery(1)}>
            {mode === 'search' ? t('searchProducts') : t('queryRank')}
          </Button>
          <Button variant="secondary" onClick={handleReset}>
            {t('reset')}
          </Button>
          {mode === 'search' && (
            <Button variant="ghost" onClick={() => setShowMore((v) => !v)}>
              {showMore ? '收起条件' : '更多条件'}
            </Button>
          )}
          <div className="omnimux-ttsel-row-end">
            <div className="omnimux-ttsel-popover-anchor">
              <Button variant="secondary" onClick={() => setColMenuOpen((v) => !v)}>
                {t('columnSettings')}
              </Button>
              {colMenuOpen && (
                <div className="omnimux-ttsel-menu" role="menu" aria-label="列设置">
                  {Object.entries(COL_LABELS).map(([k, label]) => (
                    <label key={k} className="omnimux-ttsel-menu-item">
                      <input
                        type="checkbox"
                        checked={Boolean(cols[k])}
                        onChange={() => setCols((prev) => ({ ...prev, [k]: !prev[k] }))}
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                  <Button size="sm" variant="ghost" onClick={() => setCols(DEFAULT_COLS)}>
                    恢复默认
                  </Button>
                </div>
              )}
            </div>
            <Button variant="primary" disabled={selectedIds.size === 0} onClick={handleIngestSelected}>
              {t('addToLibrary')} {selectedIds.size > 0 ? `(${selectedIds.size})` : ''}
            </Button>
          </div>
        </div>
        {error && <div className="omnimux-ttsel-error-banner">{error}</div>}
      </div>

      {!result ? (
        <div className="omnimux-ttsel-card">
          <EmptyState
            title="等待查询候选商品"
            action={
              <div className="omnimux-ttsel-row">
                <Button variant="primary" onClick={() => runQuery(1)}>
                  {t('queryRank')}
                </Button>
                <Button variant="secondary" onClick={() => setImportOpen(true)}>
                  {t('importSnapshot')}
                </Button>
              </div>
            }
          />
        </div>
      ) : items.length === 0 ? (
        <div className="omnimux-ttsel-card">
          <EmptyState title="未匹配到商品" />
        </div>
      ) : (
        <div className="omnimux-ttsel-table-wrap">
          <table className="omnimux-ttsel-table">
            <thead>
              <tr>
                <th style={{ width: '36px' }}>
                  <input
                    type="checkbox"
                    aria-label="全选本页"
                    checked={selectableItems.length > 0 && selectedIds.size === selectableItems.length}
                    onChange={toggleAll}
                  />
                </th>
                {cols.rank && <th>排名</th>}
                <th>商品</th>
                {cols.price && <th>价格</th>}
                {cols.periodSales && <th>7天/期间销量</th>}
                {cols.periodGmv && <th>期间GMV</th>}
                {cols.accel && <th>加速倍数</th>}
                {cols.commission && <th>佣金率</th>}
                {cols.creators && <th>达人数</th>}
                {cols.rating && <th>评分</th>}
                {cols.shopName && <th>店铺名称</th>}
                {cols.category && <th>类目</th>}
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={`${item.region}-${item.productId}`}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`选择 ${item.productId}`}
                      disabled={Boolean(item.inLibrary)}
                      checked={selectedIds.has(item.productId)}
                      onChange={() => toggleRow(item.productId)}
                    />
                  </td>
                  {cols.rank && <td className="omnimux-ttsel-num">{item.rank ?? '—'}</td>}
                  <td>
                    <div className="omnimux-ttsel-prod-cell">
                      {item.coverUrl ? (
                        <img className="omnimux-ttsel-thumb" src={item.coverUrl} alt="" />
                      ) : (
                        <div className="omnimux-ttsel-thumb">IMG</div>
                      )}
                      <div>
                        <div className="omnimux-ttsel-title-clamp">{item.title}</div>
                        {item.inLibrary && <Badge variant="info">{t('inLibrary')}</Badge>}
                      </div>
                    </div>
                  </td>
                  {cols.price && <td className="omnimux-ttsel-num">{item.priceDisplay}</td>}
                  {cols.periodSales && <td className="omnimux-ttsel-num">{fmtNum(item.sales7d ?? item.periodSales)}</td>}
                  {cols.periodGmv && <td className="omnimux-ttsel-num">{fmtMoney(item.gmv7d ?? item.periodGmv, item.currency)}</td>}
                  {cols.accel && (
                    <td className="omnimux-ttsel-num">
                      {item.accelRatio !== null && item.accelRatio !== undefined ? (
                        <Badge variant={item.accelRatio >= 1.1 ? 'success' : 'neutral'}>{item.accelRatio.toFixed(2)}x</Badge>
                      ) : (
                        '—'
                      )}
                    </td>
                  )}
                  {cols.commission && <td className="omnimux-ttsel-num">{fmtPct(item.commissionRate)}</td>}
                  {cols.creators && <td className="omnimux-ttsel-num">{fmtNum(item.creatorsCount)}</td>}
                  {cols.rating && <td className="omnimux-ttsel-num">{item.rating ?? '—'}</td>}
                  {cols.shopName && <td>{item.shopName || '—'}</td>}
                  {cols.category && <td>{item.category || '—'}</td>}
                  <td>
                    <Button size="sm" variant="secondary" onClick={() => openDetail(item, false, false)}>
                      {t('detailAndVideos')}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="omnimux-ttsel-row" style={{ padding: '10px 12px' }}>
            <span className="omnimux-ttsel-label">
              共 {result.total} 条 第 {result.page}/{result.totalPages} 页
            </span>
            <div className="omnimux-ttsel-row-end">
              <Button size="sm" variant="secondary" disabled={result.page <= 1 || loading} onClick={() => runQuery(result.page - 1)}>
                上一页
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={result.page >= result.totalPages || loading}
                onClick={() => runQuery(result.page + 1)}
              >
                下一页
              </Button>
            </div>
          </div>
        </div>
      )}

      <Drawer
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        title={detailData?.product?.title || '商品详情'}
        width={620}
      >
        {detailLoading ? (
          <div className="omnimux-ttsel-label">正在加载详情</div>
        ) : detailData?.product ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div className="omnimux-ttsel-kv-grid">
              <div className="omnimux-ttsel-kv"><span className="omnimux-ttsel-kv-k">商品ID</span><span className="omnimux-ttsel-kv-v">{detailData.product.productId}</span></div>
              <div className="omnimux-ttsel-kv"><span className="omnimux-ttsel-kv-k">站点</span><span className="omnimux-ttsel-kv-v">{detailData.product.region}</span></div>
              <div className="omnimux-ttsel-kv"><span className="omnimux-ttsel-kv-k">价格</span><span className="omnimux-ttsel-kv-v">{detailData.product.priceDisplay}</span></div>
              <div className="omnimux-ttsel-kv"><span className="omnimux-ttsel-kv-k">佣金率</span><span className="omnimux-ttsel-kv-v">{fmtPct(detailData.product.commissionRate)}</span></div>
              <div className="omnimux-ttsel-kv"><span className="omnimux-ttsel-kv-k">7天销量</span><span className="omnimux-ttsel-kv-v">{fmtNum(detailData.product.sales7d)}</span></div>
              <div className="omnimux-ttsel-kv"><span className="omnimux-ttsel-kv-k">总销量</span><span className="omnimux-ttsel-kv-v">{fmtNum(detailData.product.totalSales)}</span></div>
              <div className="omnimux-ttsel-kv"><span className="omnimux-ttsel-kv-k">带货达人数</span><span className="omnimux-ttsel-kv-v">{fmtNum(detailData.product.creatorsCount)}</span></div>
              <div className="omnimux-ttsel-kv"><span className="omnimux-ttsel-kv-k">店铺名称</span><span className="omnimux-ttsel-kv-v">{detailData.product.shopName || '—'}</span></div>
              <div className="omnimux-ttsel-kv"><span className="omnimux-ttsel-kv-k">类目</span><span className="omnimux-ttsel-kv-v">{detailData.product.category || '—'}</span></div>
              <div className="omnimux-ttsel-kv"><span className="omnimux-ttsel-kv-k">加速评估</span><span className="omnimux-ttsel-kv-v">{detailData.product.accel?.label || '—'}</span></div>
            </div>

            <div className="omnimux-ttsel-row">
              <Button size="sm" variant="primary" onClick={() => openDetail(detailData.product, true, false)}>
                {t('loadVideos')}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => openDetail(detailData.product, false, true)}>
                {t('loadReviews')}
              </Button>
            </div>

            {Array.isArray(detailData.warnings) && detailData.warnings.length > 0 && (
              <div className="omnimux-ttsel-error-banner">{detailData.warnings.join(' ')}</div>
            )}

            {Array.isArray(detailData.referenceVideos) && detailData.referenceVideos.length > 0 && (
              <div className="omnimux-ttsel-video-list">
                <strong>TikTok 参考带货视频（Top {detailData.referenceVideos.length}）</strong>
                {detailData.referenceVideos.map((v) => (
                  <div key={v.videoId} className="omnimux-ttsel-video-item">
                    <div>{v.caption}</div>
                    <div className="omnimux-ttsel-row">
                      {v.salesCount !== null && <Badge>销量 {fmtNum(v.salesCount)}</Badge>}
                      {v.gmv !== null && <Badge variant="success">GMV {fmtMoney(v.gmv)}</Badge>}
                      <Badge>播放 {fmtNum(v.playCount)}</Badge>
                      <Badge>收藏 {fmtNum(v.collectCount)}</Badge>
                      <a href={v.url} target="_blank" rel="noreferrer">
                        打开视频
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </Drawer>

      <ModalDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="导入 CSV / JSON 选品快照"
        size="lg"
        footer={
          <div className="omnimux-ttsel-row">
            <Button variant="secondary" onClick={() => setImportOpen(false)}>
              {t('cancel')}
            </Button>
            <Button variant="primary" loading={importing} onClick={handleImportSubmit}>
              导入并预览
            </Button>
          </div>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <InputField
            label="快照名称"
            placeholder="例如 US 美妆日榜 2026-11-20"
            value={importName}
            onChange={(e) => setImportName(e.target.value)}
          />
          <div className="omnimux-ttsel-field">
            <label className="omnimux-ttsel-label" htmlFor="ttsel-import-textarea">
              CSV 或 JSON 数据（支持 productId, title, price, sales7d, sales28d, totalSales, commissionRate, creatorsCount, rating, listedDays, productCardRatio, videoRatio）
            </label>
            <textarea
              id="ttsel-import-textarea"
              className="omnimux-ttsel-textarea"
              rows={8}
              value={importContent}
              onChange={(e) => setImportContent(e.target.value)}
              placeholder='[{"productId":"1732604036473983816","title":"Herbal Blend 30 Packs","priceMin":20.5,"sales7d":17000,"sales28d":32000,"totalSales":38000,"commissionRate":15,"creatorsCount":114,"rating":4.8,"listedDays":45,"productCardRatio":52.6,"videoRatio":31.2}]'
            />
          </div>
        </div>
      </ModalDialog>
    </div>
  )
}
