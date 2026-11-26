import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, IconButton } from 'dsh-ui-kit'
import { activateRowKeydown } from './a11y.js'
import { cloudPage } from './api.js'
import { cloudCardKind, normalizeCloudAsset } from './cloud-feed-helpers.js'
import { fetchCategoryRandomSample, fetchScopesRandomSample, globalShuffleCache } from './category-shuffle-cache.js'
import { ChevronLeftIcon, ChevronRightIcon } from './icons.jsx'
import { CloudAssetCard } from './CloudAssetsView.jsx'

/**
 * 缺省读面：没有控制器注入时两张卡都按「未保存」渲染（只读空集）。
 * 逐文件声明，不新增跨文件的共享导出。
 */
const NO_IDS = new Set()

/**
 * 单行初始挂载卡片数：覆盖宽屏可见 7 张 + 3 张右滑缓冲，阻断 Chromium `loading="lazy"`
 * 1250-2500px 横向预加载边距把第 11-24 张离屏大图一次性拉进首屏 HTTP/2 管道。
 */
export const INITIAL_ROW_CARDS = 10

/** 每次右滚/点击右箭头增量展开的卡片张数，一次展开即可覆满 24 张。 */
export const ROW_EXPAND_STEP = 14

/** 首屏第一行前 7 张可见封面赋予高优加载（eager + fetchpriority=high）。 */
export const EAGER_HIGH_PRIORITY_CARDS = 7

/** 离屏分类行的视口预激活边距：避免第 4 行素材（无封面 MP4）在首屏未滚动时提前触发。 */
export const ROW_OBSERVER_MARGIN = '80px 0px'

/**
 * 抽样范围必须取自具名二级 scope 的分类行。
 *
 * 声音「全部」：该行承诺的是可试听的卡点配乐与音效，而 `audio` 全量的 27 页里
 * 近八成是点不动的音色描述行，随机 1~2 页多半整行都是空框。收窄到 `audio/bgm`
 * 与 `audio/sfx` 两个二级 scope，行的内容才与副标题一致。音色描述行并没有丢：
 * 「声音 → 配音」二级标签仍完整可达。行级筛除交给 `cloudCardKind`，
 * `audio/bgm` 里那张被判为 `media` 的行因此不会混进来。
 * 未列出的分类一律走原来的全量抽样。
 */
const ROW_SAMPLE_SCOPES = { audio: ['audio/bgm', 'audio/sfx'] }

/**
 * 从 manifest 分类对象读取二级 scope 页数映射，省去首次 page-0000 探测请求。
 * @param {any} category
 * @param {string[]} scopes
 * @returns {Record<string, number>}
 */
function scopePageCountsOf(category, scopes) {
  /** @type {Record<string, number>} */
  const counts = {}
  const subs = Array.isArray(category?.sub_categories) ? category.sub_categories : []
  for (const scope of scopes) {
    const subId = scope.includes('/') ? scope.split('/').pop() : scope
    const entry = subs.find((row) => row?.id === subId)
    const pages = Number(entry?.pages)
    if (Number.isFinite(pages) && pages >= 1) counts[scope] = pages
  }
  return counts
}

/**
 * Single horizontal category row in the cross-category "All" view.
 *
 * Each category displays a section header (title, description, and "View all ->" CTA)
 * and a single-row scrollable container of cards with session-level caching,
 * viewport-gated activation for below-the-fold rows, and horizontal progressive
 * rendering so off-screen cards never starve first-screen visible artwork.
 *
 * @param {{
 *   category: { id: string, zh?: string, en?: string, total?: number, pages?: number, sub_categories?: any[] },
 *   rowIndex?: number,
 *   eager?: boolean,
 *   t: (key: string) => string,
 *   onSelectCategory: (categoryId: string) => void,
 *   onTogglePlay: (asset: any, explicit?: boolean) => void,
 *   onPreview?: (asset: any) => void,
 *   playingId?: string,
 *   suppressedIds?: Set<string>,
 *   refreshKey?: number,
 *   savedIds?: Set<string>,
 *   savingIds?: Set<string>,
 *   onSave?: (asset: any) => void,
 * }} props
 */
export function CloudCategoryRow(props) {
  const {
    category,
    rowIndex = 0,
    eager = true,
    t,
    onSelectCategory,
    onTogglePlay,
    onPreview,
    playingId,
    suppressedIds = NO_IDS,
    refreshKey = 0,
    savedIds = NO_IDS,
    savingIds = NO_IDS,
    onSave,
  } = props

  const [activated, setActivated] = useState(() => Boolean(eager) || typeof IntersectionObserver !== 'function')
  const [items, setItems] = useState(/** @type {any[]} */ ([]))
  const [visibleCount, setVisibleCount] = useState(INITIAL_ROW_CARDS)
  const [loading, setLoading] = useState(false)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)
  const sectionRef = useRef(/** @type {HTMLElement | null} */ (null))
  const scrollRef = useRef(/** @type {HTMLDivElement | null} */ (null))

  // 首屏行立即激活；离屏行保留定高骨架占位，待接近视口时再触发分片请求与卡片挂载。
  useEffect(() => {
    if (eager) {
      setActivated(true)
      return undefined
    }
    if (activated) return undefined
    const node = sectionRef.current
    if (!node || typeof IntersectionObserver !== 'function') {
      setActivated(true)
      return undefined
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setActivated(true)
        observer.disconnect()
      }
    }, { rootMargin: ROW_OBSERVER_MARGIN })
    observer.observe(node)
    return () => { observer.disconnect() }
  }, [eager, activated])

  useEffect(() => {
    setVisibleCount(INITIAL_ROW_CARDS)
  }, [category?.id, refreshKey])

  // Fetch or retrieve cached shuffled items for this category once activated
  useEffect(() => {
    let cancelled = false
    const catId = category?.id
    if (!catId || !activated) return undefined

    // Check session shuffle cache first
    const cached = globalShuffleCache.get(catId)
    if (cached !== undefined && cached.length > 0) {
      setItems(cached)
      return undefined
    }

    setLoading(true)
    const useHotPool = refreshKey === 0
    void (async () => {
      try {
        const scopes = ROW_SAMPLE_SCOPES[catId]
        const sampled = scopes
          ? await fetchScopesRandomSample(
            scopes,
            cloudPage,
            normalizeCloudAsset,
            24,
            (row) => cloudCardKind(row) === 'audio',
            {
              totalPagesByScope: scopePageCountsOf(category, scopes),
              useHotPool,
              seedSalt: refreshKey,
            },
          )
          : await fetchCategoryRandomSample(
            catId,
            cloudPage,
            normalizeCloudAsset,
            24,
            {
              totalPages: category?.pages,
              useHotPool,
              seedSalt: refreshKey,
            },
          )
        if (cancelled) return
        if (sampled && sampled.length > 0) {
          globalShuffleCache.set(catId, sampled)
          setItems(sampled)
        }
      } catch (error) {
        console.warn(`[omnimux-assets] cloud row "${catId}" load failed:`, error?.message || error)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => { cancelled = true }
  }, [category?.id, category?.pages, category?.sub_categories, refreshKey, activated])

  const visibleItems = useMemo(
    () => (items.length > visibleCount ? items.slice(0, visibleCount) : items),
    [items, visibleCount],
  )
  const hasCollapsedItems = items.length > visibleCount

  const expandVisibleItems = useCallback(() => {
    setVisibleCount((prev) => (prev < items.length ? Math.min(items.length, prev + ROW_EXPAND_STEP) : prev))
  }, [items.length])

  // Update scroll arrow indicators and progressively reveal collapsed tail cards on scroll
  const updateScrollButtons = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setCanScrollLeft(el.scrollLeft > 20)
    const canMoveRight = hasCollapsedItems || el.scrollLeft + el.clientWidth < el.scrollWidth - 20
    setCanScrollRight(canMoveRight)
    // 仅在容器已完成真实布局且用户确实向右滚动过时按需展开尾部卡片，
    // 避免首帧 scrollWidth=0 或宽屏未滚动时把 10 张瞬间误展成 24 张。
    if (
      hasCollapsedItems
      && el.scrollLeft > 0
      && el.scrollWidth > el.clientWidth
      && el.scrollLeft + el.clientWidth >= el.scrollWidth - 240
    ) {
      expandVisibleItems()
    }
  }, [hasCollapsedItems, expandVisibleItems])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return undefined
    updateScrollButtons()
    // Check after items render and images settle
    const timer = setTimeout(updateScrollButtons, 300)
    return () => clearTimeout(timer)
  }, [visibleItems, updateScrollButtons])

  const handleScroll = (delta) => {
    if (delta > 0 && hasCollapsedItems) {
      expandVisibleItems()
    }
    const el = scrollRef.current
    if (el) {
      el.scrollBy({ left: delta, behavior: 'smooth' })
    }
  }

  const categoryTitle = t(`cloud.category.${category.id}`) || category.zh || category.id
  const categoryDesc = t(`cloud.categoryDesc.${category.id}`)
  const showSkeleton = !activated || (loading && items.length === 0)

  return (
    <section
      ref={sectionRef}
      className="omnimux-assets-cloud-row-section"
      data-category={category.id}
      data-activated={activated ? 'true' : 'false'}
    >
      <div className="omnimux-assets-cloud-row-header">
        <div className="omnimux-assets-cloud-row-info">
          <h2
            className="omnimux-assets-cloud-row-title"
            role="button"
            tabIndex={0}
            title={categoryTitle}
            onClick={() => onSelectCategory(category.id)}
            onKeyDown={activateRowKeydown(() => onSelectCategory(category.id))}
          >
            {categoryTitle}
          </h2>
          {categoryDesc ? (
            <p className="omnimux-assets-cloud-row-desc">{categoryDesc}</p>
          ) : null}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="omnimux-assets-cloud-row-view-all"
          onClick={() => onSelectCategory(category.id)}
          trailingIcon={<ChevronRightIcon size={13} />}
        >
          {t('cloud.category.viewAll')}
        </Button>
      </div>

      <div className="omnimux-assets-cloud-row-wrapper">
        {canScrollLeft ? (
          <IconButton
            variant="ghost"
            size="sm"
            className="omnimux-assets-cloud-row-arrow omnimux-assets-cloud-row-arrow--left"
            aria-label={t('card.scrollLeft') || '向左滚动'}
            onClick={() => handleScroll(-500)}
          >
            <ChevronLeftIcon size={16} />
          </IconButton>
        ) : null}

        <div
          ref={scrollRef}
          className="omnimux-assets-cloud-row-cards"
          onScroll={updateScrollButtons}
        >
          {showSkeleton ? (
            Array.from({ length: 6 }, (_, index) => (
              <div
                key={`skeleton-${index}`}
                className="omnimux-assets-card omnimux-assets-cloud-card omnimux-assets-cloud-skeleton omnimux-assets-cloud-row-skeleton"
              >
                <div className="omnimux-assets-cloud-skeleton-thumb" />
                <div className="omnimux-assets-cloud-skeleton-line" />
              </div>
            ))
          ) : (
            visibleItems.map((asset, cardIndex) => (
              <CloudAssetCard
                key={asset.id}
                asset={asset}
                t={t}
                aspect={category.id === 'style' || category.id === 'audio' ? 'horizontal' : undefined}
                priority={rowIndex === 0 && cardIndex < EAGER_HIGH_PRIORITY_CARDS ? 'high' : 'auto'}
                playing={playingId === asset.id}
                autoplaySuppressed={suppressedIds.has(asset.id)}
                onTogglePlay={onTogglePlay}
                onPreview={onPreview}
                saved={savedIds.has(asset.id)}
                saving={savingIds.has(asset.id)}
                onSave={onSave}
              />
            ))
          )}
        </div>

        {canScrollRight ? (
          <IconButton
            variant="ghost"
            size="sm"
            className="omnimux-assets-cloud-row-arrow omnimux-assets-cloud-row-arrow--right"
            aria-label={t('card.scrollRight') || '向右滚动'}
            onClick={() => handleScroll(500)}
          >
            <ChevronRightIcon size={16} />
          </IconButton>
        ) : null}
      </div>
    </section>
  )
}
