import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Badge,
  Button,
  CopyButton,
  Drawer,
  DropdownSelect,
  EmptyState,
  IconButton,
  IconRefreshOutline16,
  IconRightUpOutline14,
  InputField,
  ModalDialog,
  SearchField,
  Tabs,
} from 'dsh-ui-kit'
import { api } from './api.js'
import { safeExternalHref } from './safe-href.js'

const LIVE_DEFAULT_COLS = {
  rank: true,
  price: true,
  totalSales: true,
  rating: true,
  sales7d: false,
  periodGmv: false,
  accel: false,
  commission: false,
  creators: false,
  shopName: false,
  category: false,
}

const SNAPSHOT_DEFAULT_COLS = {
  rank: true,
  price: true,
  sales7d: true,
  periodGmv: false,
  accel: true,
  commission: true,
  creators: true,
  totalSales: false,
  rating: false,
  shopName: false,
  category: false,
}

const COL_LABELS = {
  rank: '排名',
  price: '价格',
  totalSales: '总销量',
  rating: '评分',
  sales7d: '7 天销量',
  periodGmv: '期间 GMV',
  accel: '加速倍数',
  commission: '佣金率',
  creators: '达人数',
  shopName: '店铺名称',
  category: '类目',
}

const LIVE_SORT_OPTIONS = [
  { value: 'totalSales:desc', label: '销量降序' },
  { value: 'totalSales:asc', label: '销量升序' },
  { value: 'priceMin:asc', label: '价格升序' },
  { value: 'priceMin:desc', label: '价格降序' },
  { value: 'rating:desc', label: '评分降序' },
]

const SNAPSHOT_SORT_OPTIONS = [
  { value: 'sales7d:desc', label: '7 天销量降序' },
  { value: 'accelRatio:desc', label: '加速倍数降序' },
  { value: 'commissionRate:desc', label: '佣金率降序' },
  { value: 'periodGmv:desc', label: '期间 GMV 降序' },
  { value: 'totalSales:desc', label: '总销量降序' },
  { value: 'priceMin:asc', label: '价格升序' },
  { value: 'priceMin:desc', label: '价格降序' },
]

function productCacheKey(product, fallbackRegion = 'US') {
  const reg = String(product?.region || fallbackRegion || 'US').trim().toUpperCase()
  return `${reg}::${String(product?.productId || '').trim()}`
}

function parseSortValue(sortValue) {
  const [sortField = 'totalSales', sortDir = 'desc'] = String(sortValue || 'totalSales:desc').split(':')
  return { sortField, sortDir: sortDir === 'asc' ? 'asc' : 'desc' }
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
  const [category, setCategory] = useState('')
  const [keyword, setKeyword] = useState('')
  const [sortValue, setSortValue] = useState('totalSales:desc')
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
  const [liveCols, setLiveCols] = useState(LIVE_DEFAULT_COLS)
  const [snapshotCols, setSnapshotCols] = useState(SNAPSHOT_DEFAULT_COLS)
  const [colMenuOpen, setColMenuOpen] = useState(false)
  const colMenuRef = useRef(null)
  const hasQueriedRef = useRef(false)
  const listReqSeqRef = useRef(0)

  // Product Detail Drawer states (3 independent dimensions)
  const [detailOpen, setDetailOpen] = useState(false)
  const [activeProduct, setActiveProduct] = useState(null)
  const [drawerTab, setDrawerTab] = useState('overview')
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailStatus, setDetailStatus] = useState('idle')
  const [detailError, setDetailError] = useState('')
  const [videosLoading, setVideosLoading] = useState(false)
  const [videosStatus, setVideosStatus] = useState('idle')
  const [videosError, setVideosError] = useState('')
  const [referenceVideos, setReferenceVideos] = useState([])
  const [reviewsLoading, setReviewsLoading] = useState(false)
  const [reviewsStatus, setReviewsStatus] = useState('idle')
  const [reviewsError, setReviewsError] = useState('')
  const [reviews, setReviews] = useState([])

  const drawerCacheRef = useRef(new Map())
  const detailSeqRef = useRef(0)
  const videosSeqRef = useRef(0)
  const reviewsSeqRef = useRef(0)

  const [importOpen, setImportOpen] = useState(false)
  const [importName, setImportName] = useState('')
  const [importContent, setImportContent] = useState('')
  const [importing, setImporting] = useState(false)
  const [ingestingId, setIngestingId] = useState('')

  const snapshots = overview?.snapshots || []
  const regionOptions = useMemo(
    () => (overview?.regions || [{ code: 'US', labelZh: '美国' }]).map((r) => ({ value: r.code, label: `${r.labelZh} (${r.code})` })),
    [overview]
  )
  const categoryOptions = useMemo(
    () => [{ value: '', label: '全部' }, ...(overview?.categories || []).map((c) => ({ value: c, label: c }))],
    [overview]
  )
  const snapshotOptions = useMemo(
    () =>
      snapshots.length > 0
        ? snapshots.map((s) => ({ value: s.id, label: `${s.name} (${s.itemCount})` }))
        : [{ value: '', label: '暂无快照' }],
    [snapshots]
  )

  const isSnapshotMode = mode === 'snapshot'
  const isSnapshotResult = result?.source === 'snapshot'
  const cols = isSnapshotResult || isSnapshotMode ? snapshotCols : liveCols
  const setCols = isSnapshotResult || isSnapshotMode ? setSnapshotCols : setLiveCols
  const sortOptions = isSnapshotMode || isSnapshotResult ? SNAPSHOT_SORT_OPTIONS : LIVE_SORT_OPTIONS

  const items = result?.items || []
  const selectableItems = items.filter((i) => !i.inLibrary)

  // Close column settings menu on outside click or Escape
  useEffect(() => {
    if (!colMenuOpen) return undefined
    const handlePointerDown = (e) => {
      if (colMenuRef.current && !colMenuRef.current.contains(e.target)) {
        setColMenuOpen(false)
      }
    }
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') setColMenuOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [colMenuOpen])

  async function runQuery(targetPage = 1, overrides = {}) {
    const nextMode = overrides.mode ?? mode
    const nextRegion = overrides.region ?? region
    const nextCategory = overrides.category ?? category
    const nextKeyword = overrides.keyword ?? keyword
    const nextSortValue = overrides.sortValue ?? sortValue
    const nextSnapshotId = overrides.snapshotId ?? (nextMode === 'snapshot' ? snapshotId || snapshots[0]?.id || '' : '')
    const forceRefresh = Boolean(overrides.forceRefresh)
    const { sortField, sortDir } = parseSortValue(nextSortValue)

    if (nextMode === 'snapshot' && !nextSnapshotId) {
      setResult(null)
      setError('')
      return
    }
    if (nextMode === 'search' && !String(nextKeyword).trim() && !String(nextCategory).trim()) {
      setError('请输入关键词或选择类目后再搜索')
      return
    }

    const reqSeq = listReqSeqRef.current + 1
    listReqSeqRef.current = reqSeq
    hasQueriedRef.current = true
    setLoading(true)
    setError('')
    try {
      const payload =
        nextMode === 'search'
          ? await api.searchProducts({
              keyword: nextKeyword,
              region: nextRegion,
              category: nextCategory,
              sortField,
              sortDir,
              salesMin: salesMin || undefined,
              salesMax: salesMax || undefined,
              commissionMin: commissionMin || undefined,
              commissionMax: commissionMax || undefined,
              creatorsMin: creatorsMin || undefined,
              creatorsMax: creatorsMax || undefined,
              shopType,
              page: targetPage,
              forceRefresh,
            })
          : await api.queryRank({
              region: nextRegion,
              category: nextCategory,
              sortField,
              sortDir,
              snapshotId: nextMode === 'snapshot' ? nextSnapshotId : undefined,
              page: targetPage,
              forceRefresh,
            })
      if (listReqSeqRef.current !== reqSeq) return
      setResult(payload)
      setSelectedIds(new Set())
    } catch (err) {
      if (listReqSeqRef.current !== reqSeq) return
      setError(err?.message || '查询失败')
    } finally {
      if (listReqSeqRef.current === reqSeq) {
        setLoading(false)
      }
    }
  }

  function handleModeChange(nextMode) {
    setMode(nextMode)
    setError('')
    setColMenuOpen(false)
    setSelectedIds(new Set())
    if (nextMode === 'snapshot') {
      const nextSort = SNAPSHOT_SORT_OPTIONS[0].value
      setSortValue(nextSort)
      const firstSnapId = snapshotId || snapshots[0]?.id || ''
      if (firstSnapId) {
        setSnapshotId(firstSnapId)
        runQuery(1, { mode: 'snapshot', snapshotId: firstSnapId, sortValue: nextSort })
      } else {
        setResult(null)
      }
    } else {
      const validSort = LIVE_SORT_OPTIONS.some((o) => o.value === sortValue) ? sortValue : LIVE_SORT_OPTIONS[0].value
      setSortValue(validSort)
      if (nextMode === 'rank' && hasQueriedRef.current) {
        runQuery(1, { mode: 'rank', sortValue: validSort })
      }
    }
  }

  function handleRegionChange(nextRegion) {
    setRegion(nextRegion)
    if (mode === 'rank' && hasQueriedRef.current) {
      runQuery(1, { region: nextRegion })
    }
  }

  function handleCategoryChange(nextCategory) {
    setCategory(nextCategory)
    if (mode === 'rank' && hasQueriedRef.current) {
      runQuery(1, { category: nextCategory })
    } else if (mode === 'snapshot' && (snapshotId || snapshots[0]?.id)) {
      runQuery(1, { category: nextCategory })
    } else if (mode === 'search' && hasQueriedRef.current && (keyword.trim() || nextCategory)) {
      runQuery(1, { category: nextCategory })
    }
  }

  function handleSnapshotChange(nextId) {
    setSnapshotId(nextId)
    if (nextId) {
      runQuery(1, { mode: 'snapshot', snapshotId: nextId })
    }
  }

  function handleSortChange(nextSort) {
    setSortValue(nextSort)
    if (result && (mode !== 'search' || keyword.trim() || category)) {
      runQuery(1, { sortValue: nextSort })
    }
  }

  function handleResetFilters() {
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

  function markProductsInLibrary(productIds) {
    const idSet = new Set(productIds)
    setResult((prev) =>
      prev
        ? {
            ...prev,
            items: prev.items.map((item) => (idSet.has(item.productId) ? { ...item, inLibrary: true } : item)),
          }
        : prev
    )
    setActiveProduct((prev) => (prev && idSet.has(prev.productId) ? { ...prev, inLibrary: true } : prev))
    for (const [k, cached] of drawerCacheRef.current.entries()) {
      if (cached?.product && idSet.has(cached.product.productId)) {
        drawerCacheRef.current.set(k, {
          ...cached,
          product: { ...cached.product, inLibrary: true },
        })
      }
    }
  }

  async function ingestProductsList(chosen, { silentOnCleanSuccess = false } = {}) {
    if (!chosen || chosen.length === 0) return
    const isSingle = chosen.length === 1
    if (isSingle) setIngestingId(chosen[0].productId)
    try {
      const res = await api.ingestProducts({
        products: chosen,
        region: chosen[0]?.region || region,
        source: mode,
        sourceDetail: `${region} ${mode === 'search' ? keyword || category : mode === 'snapshot' ? '本地快照' : '热销榜'}`,
      })
      const addedIds = (res.added || []).map((a) => a.productId)
      const dupIds = (res.duplicated || []).map((d) => d.productId)
      markProductsInLibrary([...addedIds, ...dupIds])
      setSelectedIds((prev) => {
        const next = new Set(prev)
        for (const id of [...addedIds, ...dupIds]) next.delete(id)
        return next
      })
      onLibraryChanged?.()

      if (res.blockedCount > 0) {
        onNotify(
          `命中风险词拦截 ${res.blockedCount} 件，已入库 ${res.addedCount} 件`,
          res.addedCount === 0
        )
      } else if (!silentOnCleanSuccess) {
        onNotify(`已入库 ${res.addedCount} 件${res.duplicatedCount > 0 ? `，跳过重复 ${res.duplicatedCount} 件` : ''}`)
      }
    } catch (err) {
      onNotify(err?.message || '入库失败', true)
    } finally {
      if (isSingle) setIngestingId('')
    }
  }

  function updateProductCache(key, patch) {
    const prev = drawerCacheRef.current.get(key) || {}
    drawerCacheRef.current.set(key, { ...prev, ...patch })
  }

  async function loadDrawerDetail(product, forceRefresh = false) {
    const targetRegion = product.region || region
    const key = productCacheKey(product, targetRegion)
    const seq = detailSeqRef.current + 1
    detailSeqRef.current = seq

    if (product.source === 'snapshot' && !forceRefresh) {
      setDetailStatus('snapshot')
      setDetailError('')
      updateProductCache(key, { product, detailStatus: 'snapshot', detailError: '' })
      return
    }

    setDetailLoading(true)
    setDetailError('')
    try {
      const res = await api.getProductDetail({
        productId: product.productId,
        region: targetRegion,
        includeDetail: true,
        loadVideos: false,
        loadReviews: false,
        forceRefresh,
        productHint: product,
      })
      if (detailSeqRef.current !== seq) return
      const mergedProduct = { ...product, ...res.product, inLibrary: Boolean(product.inLibrary || res.product?.inLibrary) }
      const nextStatus = res.detailStatus || (res.detailError ? 'unavailable' : 'live')
      const nextError = res.detailError || ''
      setActiveProduct(mergedProduct)
      setDetailStatus(nextStatus)
      setDetailError(nextError)
      const patch = { product: mergedProduct, detailStatus: nextStatus, detailError: nextError }
      if (res.videosStatus && res.videosStatus !== 'idle') {
        setReferenceVideos(res.referenceVideos || [])
        setVideosStatus(res.videosStatus)
        patch.videos = res.referenceVideos || []
        patch.videosStatus = res.videosStatus
      }
      if (res.reviewsStatus && res.reviewsStatus !== 'idle') {
        setReviews(res.reviews || [])
        setReviewsStatus(res.reviewsStatus)
        patch.reviews = res.reviews || []
        patch.reviewsStatus = res.reviewsStatus
      }
      updateProductCache(key, patch)
    } catch (err) {
      if (detailSeqRef.current !== seq) return
      const msg = err?.message || '读取详情失败'
      setDetailStatus('error')
      setDetailError(msg)
      updateProductCache(key, { detailStatus: 'error', detailError: msg })
    } finally {
      if (detailSeqRef.current === seq) {
        setDetailLoading(false)
      }
    }
  }

  async function loadDrawerVideos(product, forceRefresh = false) {
    const targetRegion = product.region || region
    const key = productCacheKey(product, targetRegion)
    const seq = videosSeqRef.current + 1
    videosSeqRef.current = seq
    setVideosLoading(true)
    setVideosError('')
    try {
      const res = await api.getProductDetail({
        productId: product.productId,
        region: targetRegion,
        includeDetail: false,
        loadVideos: true,
        loadReviews: false,
        forceRefresh,
        productHint: product,
      })
      if (videosSeqRef.current !== seq) return
      const list = Array.isArray(res.referenceVideos) ? res.referenceVideos : []
      const status = res.videosStatus || (res.videosError ? 'error' : list.length > 0 ? 'loaded' : 'empty')
      const errMsg = res.videosError || ''
      setReferenceVideos(list)
      setVideosStatus(status)
      setVideosError(errMsg)
      updateProductCache(key, { videos: list, videosStatus: status, videosError: errMsg })
    } catch (err) {
      if (videosSeqRef.current !== seq) return
      const msg = err?.message || '读取带货视频失败'
      setVideosStatus('error')
      setVideosError(msg)
      updateProductCache(key, { videosStatus: 'error', videosError: msg })
    } finally {
      if (videosSeqRef.current === seq) {
        setVideosLoading(false)
      }
    }
  }

  async function loadDrawerReviews(product, forceRefresh = false) {
    const targetRegion = product.region || region
    const key = productCacheKey(product, targetRegion)
    const seq = reviewsSeqRef.current + 1
    reviewsSeqRef.current = seq
    setReviewsLoading(true)
    setReviewsError('')
    try {
      const res = await api.getProductDetail({
        productId: product.productId,
        region: targetRegion,
        includeDetail: false,
        loadVideos: false,
        loadReviews: true,
        forceRefresh,
        productHint: product,
      })
      if (reviewsSeqRef.current !== seq) return
      const list = Array.isArray(res.reviews) ? res.reviews : []
      const status = res.reviewsStatus || (res.reviewsError ? 'error' : list.length > 0 ? 'loaded' : 'empty')
      const errMsg = res.reviewsError || ''
      setReviews(list)
      setReviewsStatus(status)
      setReviewsError(errMsg)
      updateProductCache(key, { reviews: list, reviewsStatus: status, reviewsError: errMsg })
    } catch (err) {
      if (reviewsSeqRef.current !== seq) return
      const msg = err?.message || '读取商品评价失败'
      setReviewsStatus('error')
      setReviewsError(msg)
      updateProductCache(key, { reviewsStatus: 'error', reviewsError: msg })
    } finally {
      if (reviewsSeqRef.current === seq) {
        setReviewsLoading(false)
      }
    }
  }

  function openDrawer(product) {
    const targetRegion = product.region || region
    const key = productCacheKey(product, targetRegion)
    const cached = drawerCacheRef.current.get(key)
    const seededProduct = cached?.product ? { ...cached.product, inLibrary: Boolean(product.inLibrary || cached.product.inLibrary) } : product

    setActiveProduct(seededProduct)
    setDrawerTab('overview')
    setDetailOpen(true)
    setDetailLoading(false)
    setVideosLoading(false)
    setReviewsLoading(false)

    setDetailStatus(cached?.detailStatus || 'idle')
    setDetailError(cached?.detailError || '')
    setReferenceVideos(cached?.videos || product.referenceVideos || [])
    setVideosStatus(cached?.videosStatus || (product.referenceVideos?.length ? 'loaded' : 'idle'))
    setVideosError(cached?.videosError || '')
    setReviews(cached?.reviews || [])
    setReviewsStatus(cached?.reviewsStatus || 'idle')
    setReviewsError(cached?.reviewsError || '')

    const alreadyResolved = cached?.detailStatus && ['live', 'cached', 'unavailable', 'snapshot'].includes(cached.detailStatus)
    if (!alreadyResolved) {
      loadDrawerDetail(seededProduct, false)
    }
  }

  function handleDrawerTabChange(nextTab) {
    setDrawerTab(nextTab)
    if (!activeProduct) return
    if (nextTab === 'videos' && videosStatus === 'idle' && !videosLoading) {
      loadDrawerVideos(activeProduct, false)
    } else if (nextTab === 'reviews' && reviewsStatus === 'idle' && !reviewsLoading) {
      loadDrawerReviews(activeProduct, false)
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
      setSortValue(SNAPSHOT_SORT_OPTIONS[0].value)
      await onSnapshotsChanged?.()
      await runQuery(1, { mode: 'snapshot', snapshotId: res.snapshot.id, sortValue: SNAPSHOT_SORT_OPTIONS[0].value })
    } catch (err) {
      onNotify(err?.message || '导入失败', true)
    } finally {
      setImporting(false)
    }
  }

  const modeTabItems = [
    { id: 'rank', label: t('modeRank') },
    { id: 'search', label: t('modeSearch') },
    { id: 'snapshot', label: t('modeSnapshot'), badge: snapshots.length || undefined },
  ]

  const drawerTabItems = [
    { id: 'overview', label: t('drawerTabOverview') },
    {
      id: 'videos',
      label: t('drawerTabVideos'),
      badge: videosStatus === 'loaded' ? referenceVideos.length : undefined,
    },
    {
      id: 'reviews',
      label: t('drawerTabReviews'),
      badge: reviewsStatus === 'loaded' ? reviews.length : undefined,
    },
  ]

  const originalHref = activeProduct ? safeExternalHref(activeProduct.tiktokUrl) : ''

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <div className="omnimux-ttsel-toolbar">
        <div className="omnimux-ttsel-toolbar-group">
          <Tabs variant="pill" size="sm" items={modeTabItems} activeId={mode} onChange={handleModeChange} />

          {mode === 'search' && (
            <SearchField
              placeholder="商品标题关键词"
              value={keyword}
              debounceMs={0}
              onValueChange={setKeyword}
              onClear={() => setKeyword('')}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent?.isComposing) {
                  runQuery(1)
                }
              }}
            />
          )}

          {isSnapshotMode ? (
            <DropdownSelect
              aria-label="选择快照"
              value={snapshotId || snapshots[0]?.id || ''}
              options={snapshotOptions}
              onChange={handleSnapshotChange}
            />
          ) : (
            <DropdownSelect aria-label="站点" value={region} options={regionOptions} onChange={handleRegionChange} />
          )}

          <DropdownSelect aria-label="类目" value={category} options={categoryOptions} onChange={handleCategoryChange} />

          <DropdownSelect aria-label="排序" value={sortValue} options={sortOptions} onChange={handleSortChange} />

          {isSnapshotMode ? (
            <Button variant="primary" onClick={() => setImportOpen(true)}>
              {t('importSnapshot')}
            </Button>
          ) : (
            <Button variant="primary" loading={loading} onClick={() => runQuery(1)}>
              {mode === 'search' ? t('searchProducts') : t('queryRank')}
            </Button>
          )}

          {mode === 'search' && (
            <Button variant="ghost" onClick={() => setShowMore((v) => !v)}>
              {showMore ? '收起条件' : '更多条件'}
            </Button>
          )}
        </div>

        <div className="omnimux-ttsel-toolbar-group">
          {!isSnapshotMode && (
            <Button variant="ghost" onClick={() => setImportOpen(true)}>
              {t('importSnapshot')}
            </Button>
          )}
          <div className="omnimux-ttsel-popover-anchor" ref={colMenuRef}>
            <Button
              variant="secondary"
              aria-haspopup="menu"
              aria-expanded={colMenuOpen}
              onClick={() => setColMenuOpen((v) => !v)}
            >
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
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setCols(isSnapshotResult || isSnapshotMode ? SNAPSHOT_DEFAULT_COLS : LIVE_DEFAULT_COLS)}
                >
                  {t('resetDefaults')}
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>

      {mode === 'search' && showMore && (
        <div className="omnimux-ttsel-card">
          <div className="omnimux-ttsel-grid">
            <div className="omnimux-ttsel-field">
              <span className="omnimux-ttsel-label">7 天销量范围</span>
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
                  { value: 'all', label: '全部' },
                  { value: 'cross_border', label: '跨境店铺' },
                  { value: 'local', label: '本土店铺' },
                ]}
                onChange={setShopType}
              />
            </div>
          </div>
          <div className="omnimux-ttsel-row">
            <Button size="sm" variant="secondary" onClick={handleResetFilters}>
              {t('reset')}
            </Button>
          </div>
        </div>
      )}

      {error && (
        <div className="omnimux-ttsel-error-banner">
          <span>{error}</span>
          <Button size="sm" variant="ghost" onClick={() => runQuery(1, { forceRefresh: true })}>
            重试
          </Button>
        </div>
      )}

      {selectedIds.size > 0 && (
        <div className="omnimux-ttsel-bulk-bar">
          <span>已选 {selectedIds.size} 件商品</span>
          <div className="omnimux-ttsel-row">
            <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>
              取消选择
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => ingestProductsList(items.filter((i) => selectedIds.has(i.productId) && !i.inLibrary))}
            >
              {t('addToLibrary')} ({selectedIds.size})
            </Button>
          </div>
        </div>
      )}

      {!result ? (
        <div className="omnimux-ttsel-card">
          <EmptyState
            title={isSnapshotMode ? '暂无本地快照' : '选择条件后查询候选商品'}
            action={
              <div className="omnimux-ttsel-row">
                {!isSnapshotMode && (
                  <Button variant="primary" loading={loading} onClick={() => runQuery(1)}>
                    {mode === 'search' ? t('searchProducts') : t('queryRank')}
                  </Button>
                )}
                <Button variant={isSnapshotMode ? 'primary' : 'secondary'} onClick={() => setImportOpen(true)}>
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
                {cols.totalSales && <th>总销量</th>}
                {cols.sales7d && <th>7 天销量</th>}
                {cols.periodGmv && <th>期间 GMV</th>}
                {cols.accel && <th>加速倍数</th>}
                {cols.commission && <th>佣金率</th>}
                {cols.creators && <th>达人数</th>}
                {cols.rating && <th>评分</th>}
                {cols.shopName && <th>店铺名称</th>}
                {cols.category && <th>类目</th>}
                <th style={{ width: '96px' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={`${item.region}-${item.productId}`}
                  className="omnimux-ttsel-row-clickable"
                  onClick={() => openDrawer(item)}
                >
                  <td onClick={(e) => e.stopPropagation()}>
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
                      <div style={{ minWidth: 0 }}>
                        <button
                          type="button"
                          className="omnimux-ttsel-title-btn"
                          onClick={(e) => {
                            e.stopPropagation()
                            openDrawer(item)
                          }}
                        >
                          <span className="omnimux-ttsel-title-clamp">{item.title}</span>
                        </button>
                        <div className="omnimux-ttsel-prod-sub">
                          {item.shopName && <span>{item.shopName}</span>}
                          {item.category && !cols.category && <span>{item.category}</span>}
                          {item.inLibrary && <Badge variant="info">{t('inLibrary')}</Badge>}
                        </div>
                      </div>
                    </div>
                  </td>
                  {cols.price && <td className="omnimux-ttsel-num">{item.priceDisplay}</td>}
                  {cols.totalSales && <td className="omnimux-ttsel-num">{fmtNum(item.totalSales)}</td>}
                  {cols.sales7d && <td className="omnimux-ttsel-num">{fmtNum(item.sales7d)}</td>}
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
                  {cols.rating && (
                    <td className="omnimux-ttsel-num">
                      {item.rating !== null && item.rating !== undefined
                        ? item.reviewCount !== null && item.reviewCount !== undefined
                          ? `${item.rating} (${fmtNum(item.reviewCount)})`
                          : String(item.rating)
                        : '—'}
                    </td>
                  )}
                  {cols.shopName && <td>{item.shopName || '—'}</td>}
                  {cols.category && <td>{item.category || '—'}</td>}
                  <td onClick={(e) => e.stopPropagation()}>
                    {item.inLibrary ? (
                      <Badge variant="info">{t('inLibrary')}</Badge>
                    ) : (
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={ingestingId === item.productId}
                        onClick={() => ingestProductsList([item], { silentOnCleanSuccess: true })}
                      >
                        + 入库
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="omnimux-ttsel-table-footer">
            <div className="omnimux-ttsel-row">
              <span className="omnimux-ttsel-label">共 {result.total} 件</span>
              <span className="omnimux-ttsel-label">
                第 {result.page}/{result.totalPages} 页
              </span>
              {result.cached && <Badge variant="neutral">已缓存</Badge>}
            </div>
            <div className="omnimux-ttsel-row">
              {!isSnapshotResult && (
                <IconButton
                  aria-label="刷新候选商品"
                  variant="ghost"
                  size="sm"
                  disabled={loading}
                  onClick={() => runQuery(result.page, { forceRefresh: true })}
                >
                  <IconRefreshOutline16 />
                </IconButton>
              )}
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
        title="商品详情"
        width={600}
        footer={
          activeProduct ? (
            <div className="omnimux-ttsel-drawer-footer">
              {originalHref ? (
                <a className="omnimux-ttsel-ext-link" href={originalHref} target="_blank" rel="noopener noreferrer">
                  <span>{t('openOriginal')}</span>
                  <IconRightUpOutline14 />
                </a>
              ) : (
                <span />
              )}
              <Button
                variant={activeProduct.inLibrary ? 'secondary' : 'primary'}
                disabled={Boolean(activeProduct.inLibrary)}
                loading={ingestingId === activeProduct.productId}
                onClick={() => ingestProductsList([activeProduct], { silentOnCleanSuccess: true })}
              >
                {activeProduct.inLibrary ? t('inLibrary') : t('addToLibrary')}
              </Button>
            </div>
          ) : null
        }
      >
        {activeProduct ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div className="omnimux-ttsel-drawer-hero">
              {activeProduct.coverUrl ? (
                <img className="omnimux-ttsel-drawer-thumb" src={activeProduct.coverUrl} alt="" />
              ) : (
                <div className="omnimux-ttsel-drawer-thumb">IMG</div>
              )}
              <div style={{ minWidth: 0 }}>
                <h4 className="omnimux-ttsel-drawer-title">{activeProduct.title}</h4>
                <div className="omnimux-ttsel-drawer-meta">
                  {activeProduct.shopName && <span>{activeProduct.shopName}</span>}
                  <Badge>{activeProduct.region || region}</Badge>
                  {activeProduct.category && <Badge>{activeProduct.category}</Badge>}
                </div>
              </div>
            </div>

            <div className="omnimux-ttsel-kpi-grid">
              <div className="omnimux-ttsel-kpi-tile">
                <div className="omnimux-ttsel-label">价格</div>
                <div className="omnimux-ttsel-kpi-v">{activeProduct.priceDisplay || '—'}</div>
              </div>
              {activeProduct.totalSales !== null && activeProduct.totalSales !== undefined && (
                <div className="omnimux-ttsel-kpi-tile">
                  <div className="omnimux-ttsel-label">总销量</div>
                  <div className="omnimux-ttsel-kpi-v">{fmtNum(activeProduct.totalSales)}</div>
                </div>
              )}
              {activeProduct.sales7d !== null && activeProduct.sales7d !== undefined && (
                <div className="omnimux-ttsel-kpi-tile">
                  <div className="omnimux-ttsel-label">7 天销量</div>
                  <div className="omnimux-ttsel-kpi-v">{fmtNum(activeProduct.sales7d)}</div>
                </div>
              )}
              {activeProduct.rating !== null && activeProduct.rating !== undefined && (
                <div className="omnimux-ttsel-kpi-tile">
                  <div className="omnimux-ttsel-label">评分</div>
                  <div className="omnimux-ttsel-kpi-v">
                    {activeProduct.reviewCount !== null && activeProduct.reviewCount !== undefined
                      ? `${activeProduct.rating} (${fmtNum(activeProduct.reviewCount)})`
                      : activeProduct.rating}
                  </div>
                </div>
              )}
              {activeProduct.commissionRate !== null && activeProduct.commissionRate !== undefined && (
                <div className="omnimux-ttsel-kpi-tile">
                  <div className="omnimux-ttsel-label">佣金率</div>
                  <div className="omnimux-ttsel-kpi-v">{fmtPct(activeProduct.commissionRate)}</div>
                </div>
              )}
              {activeProduct.accelRatio !== null && activeProduct.accelRatio !== undefined && (
                <div className="omnimux-ttsel-kpi-tile">
                  <div className="omnimux-ttsel-label">加速倍数</div>
                  <div className="omnimux-ttsel-kpi-v">{activeProduct.accelRatio.toFixed(2)}x</div>
                </div>
              )}
            </div>

            <Tabs items={drawerTabItems} activeId={drawerTab} onChange={handleDrawerTabChange} size="sm" />

            {drawerTab === 'overview' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div className="omnimux-ttsel-kv-list">
                  {activeProduct.shopName && (
                    <div className="omnimux-ttsel-kv">
                      <span className="omnimux-ttsel-kv-k">店铺名称</span>
                      <span className="omnimux-ttsel-kv-v">{activeProduct.shopName}</span>
                    </div>
                  )}
                  {activeProduct.category && (
                    <div className="omnimux-ttsel-kv">
                      <span className="omnimux-ttsel-kv-k">类目</span>
                      <span className="omnimux-ttsel-kv-v">{activeProduct.category}</span>
                    </div>
                  )}
                  {activeProduct.skuCount !== null && activeProduct.skuCount !== undefined && (
                    <div className="omnimux-ttsel-kv">
                      <span className="omnimux-ttsel-kv-k">SKU 数量</span>
                      <span className="omnimux-ttsel-kv-v">{activeProduct.skuCount}</span>
                    </div>
                  )}
                  {activeProduct.creatorsCount !== null && activeProduct.creatorsCount !== undefined && (
                    <div className="omnimux-ttsel-kv">
                      <span className="omnimux-ttsel-kv-k">带货达人数</span>
                      <span className="omnimux-ttsel-kv-v">{fmtNum(activeProduct.creatorsCount)}</span>
                    </div>
                  )}
                  {activeProduct.accelRatio !== null && activeProduct.accelRatio !== undefined && activeProduct.accel?.label && (
                    <div className="omnimux-ttsel-kv">
                      <span className="omnimux-ttsel-kv-k">加速评估</span>
                      <span className="omnimux-ttsel-kv-v">{activeProduct.accel.label}</span>
                    </div>
                  )}
                  <div className="omnimux-ttsel-kv">
                    <span className="omnimux-ttsel-kv-k">商品 ID</span>
                    <span className="omnimux-ttsel-kv-v">
                      <span>{activeProduct.productId}</span>
                      <CopyButton text={activeProduct.productId} size="xs" label="" copiedLabel="已复制" />
                    </span>
                  </div>
                </div>

                {detailLoading ? (
                  <div className="omnimux-ttsel-subtle-status">
                    <span>正在同步实时详情</span>
                  </div>
                ) : detailStatus === 'error' && detailError ? (
                  <div className="omnimux-ttsel-error-banner">
                    <span>{detailError}</span>
                    <Button size="sm" variant="ghost" onClick={() => loadDrawerDetail(activeProduct, true)}>
                      重试
                    </Button>
                  </div>
                ) : detailStatus === 'unavailable' ? (
                  <div className="omnimux-ttsel-subtle-status">
                    <span>实时详情暂不可用，当前展示列表基础数据</span>
                    <Button size="sm" variant="ghost" onClick={() => loadDrawerDetail(activeProduct, true)}>
                      重试
                    </Button>
                  </div>
                ) : detailStatus === 'snapshot' ? (
                  <div className="omnimux-ttsel-subtle-status">
                    <span>本地快照数据</span>
                    <Button size="sm" variant="ghost" onClick={() => loadDrawerDetail(activeProduct, true)}>
                      同步实时详情
                    </Button>
                  </div>
                ) : (detailStatus === 'live' || detailStatus === 'cached') ? (
                  <div className="omnimux-ttsel-subtle-status">
                    <span>{detailStatus === 'cached' ? '实时详情已缓存' : '实时详情已同步'}</span>
                    <IconButton
                      aria-label="刷新商品详情"
                      size="xs"
                      variant="ghost"
                      onClick={() => loadDrawerDetail(activeProduct, true)}
                    >
                      <IconRefreshOutline16 />
                    </IconButton>
                  </div>
                ) : null}
              </div>
            )}

            {drawerTab === 'videos' && (
              videosLoading ? (
                <div className="omnimux-ttsel-video-list">
                  <div className="omnimux-ttsel-skeleton" />
                  <div className="omnimux-ttsel-skeleton" />
                </div>
              ) : videosStatus === 'error' ? (
                <div className="omnimux-ttsel-error-banner">
                  <span>{videosError || '获取带货视频失败'}</span>
                  <Button size="sm" variant="ghost" onClick={() => loadDrawerVideos(activeProduct, true)}>
                    重试
                  </Button>
                </div>
              ) : referenceVideos.length === 0 ? (
                <EmptyState
                  title="暂无相关带货视频"
                  action={
                    <Button size="sm" variant="secondary" onClick={() => loadDrawerVideos(activeProduct, true)}>
                      重新获取
                    </Button>
                  }
                />
              ) : (
                <div className="omnimux-ttsel-video-list">
                  <div className="omnimux-ttsel-subtle-status">
                    <span>参考带货视频（Top {referenceVideos.length}）</span>
                    <IconButton
                      aria-label="刷新带货视频"
                      size="xs"
                      variant="ghost"
                      onClick={() => loadDrawerVideos(activeProduct, true)}
                    >
                      <IconRefreshOutline16 />
                    </IconButton>
                  </div>
                  {referenceVideos.map((v) => (
                    <div key={v.videoId} className="omnimux-ttsel-video-item">
                      <div>{v.caption}</div>
                      <div className="omnimux-ttsel-row">
                        {v.author && <Badge>@{v.author}</Badge>}
                        {v.salesCount !== null && <Badge>销量 {fmtNum(v.salesCount)}</Badge>}
                        {v.gmv !== null && <Badge variant="success">GMV {fmtMoney(v.gmv)}</Badge>}
                        <Badge>播放 {fmtNum(v.playCount)}</Badge>
                        <Badge>收藏 {fmtNum(v.collectCount)}</Badge>
                        {safeExternalHref(v.url) && (
                          <a
                            className="omnimux-ttsel-ext-link"
                            style={{ marginLeft: 'auto' }}
                            href={safeExternalHref(v.url)}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            打开视频
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )
            )}

            {drawerTab === 'reviews' && (
              reviewsLoading ? (
                <div className="omnimux-ttsel-video-list">
                  <div className="omnimux-ttsel-skeleton" />
                  <div className="omnimux-ttsel-skeleton" />
                </div>
              ) : reviewsStatus === 'error' ? (
                <div className="omnimux-ttsel-error-banner">
                  <span>{reviewsError || '获取商品评价失败'}</span>
                  <Button size="sm" variant="ghost" onClick={() => loadDrawerReviews(activeProduct, true)}>
                    重试
                  </Button>
                </div>
              ) : reviews.length === 0 ? (
                <EmptyState
                  title="暂无商品评价"
                  action={
                    <Button size="sm" variant="secondary" onClick={() => loadDrawerReviews(activeProduct, true)}>
                      重新获取
                    </Button>
                  }
                />
              ) : (
                <div className="omnimux-ttsel-video-list">
                  <div className="omnimux-ttsel-subtle-status">
                    <span>商品评价（{reviews.length} 条）</span>
                    <IconButton
                      aria-label="刷新商品评价"
                      size="xs"
                      variant="ghost"
                      onClick={() => loadDrawerReviews(activeProduct, true)}
                    >
                      <IconRefreshOutline16 />
                    </IconButton>
                  </div>
                  {reviews.map((r, idx) => (
                    <div key={`${idx}-${r.createdAt || ''}`} className="omnimux-ttsel-video-item">
                      <div className="omnimux-ttsel-row">
                        {r.rating !== null && Number.isFinite(r.rating) && (
                          <Badge variant={r.rating >= 4 ? 'success' : 'neutral'}>{r.rating} 星</Badge>
                        )}
                        {r.reviewer && <span className="omnimux-ttsel-label">{r.reviewer}</span>}
                        {r.createdAt && <span className="omnimux-ttsel-label">{r.createdAt}</span>}
                      </div>
                      <div>{r.text || (r.rating !== null ? '仅评分' : '')}</div>
                    </div>
                  ))}
                </div>
              )
            )}
          </div>
        ) : null}
      </Drawer>

      <ModalDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="导入 CSV 或 JSON 选品快照"
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
