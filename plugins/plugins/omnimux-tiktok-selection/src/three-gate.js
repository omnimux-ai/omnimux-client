import {
  DEFAULT_GATE_CRITERIA,
  OPERATIONAL_LIMITS,
  RISK_AUDIT_OUTPUT_SCHEMA,
  computeAcceleration,
} from './constants.js'
import { SelectionError } from './errors.js'

function toNumOrNull(val) {
  if (val === null || val === undefined || val === '') return null
  const n = Number(val)
  return Number.isFinite(n) ? n : null
}

export function normalizeGateCriteria(raw = {}, settings = {}) {
  const merged = { ...DEFAULT_GATE_CRITERIA, ...raw }
  return {
    source: ['rank', 'search', 'snapshot'].includes(merged.source) ? merged.source : 'rank',
    region: String(merged.region || 'US').trim().toUpperCase(),
    category: String(merged.category || '').trim(),
    keyword: String(merged.keyword || '').trim(),
    sortField: String(merged.sortField || 'sales7d'),
    snapshotId: String(merged.snapshotId || '').trim(),
    totalSalesMin: toNumOrNull(merged.totalSalesMin),
    totalSalesMax: toNumOrNull(merged.totalSalesMax),
    sales7dMin: toNumOrNull(merged.sales7dMin),
    sales7dMax: toNumOrNull(merged.sales7dMax),
    creatorsMin: toNumOrNull(merged.creatorsMin),
    creatorsMax: toNumOrNull(merged.creatorsMax),
    commissionMin: toNumOrNull(merged.commissionMin),
    commissionMax: toNumOrNull(merged.commissionMax),
    accelMin: toNumOrNull(merged.accelMin),
    accelMax: toNumOrNull(merged.accelMax),
    accelBase28dMin: toNumOrNull(merged.accelBase28dMin) ?? 28,
    ratingMin: toNumOrNull(merged.ratingMin),
    listedDaysMax: toNumOrNull(merged.listedDaysMax),
    g2MinCardRatio: toNumOrNull(merged.g2MinCardRatio) ?? 20,
    g2MaxVideoRatio: toNumOrNull(merged.g2MaxVideoRatio) ?? 0,
    maxPages: Math.min(20, Math.max(1, Number.parseInt(String(merged.maxPages ?? 3), 10) || 3)),
    maxIngest: Math.min(200, Math.max(1, Number.parseInt(String(merged.maxIngest ?? 50), 10) || 50)),
    concurrency: Math.min(
      OPERATIONAL_LIMITS.maxConcurrency,
      Math.max(OPERATIONAL_LIMITS.minConcurrency, Number.parseInt(String(merged.concurrency ?? settings.concurrency ?? 4), 10) || 4)
    ),
    missingMetricPolicy:
      merged.missingMetricPolicy === 'fail_on_missing'
        ? 'fail_on_missing'
        : settings.defaultMissingMetricPolicy === 'fail_on_missing'
          ? 'fail_on_missing'
          : 'skip_missing_metric',
    useAiAudit: merged.useAiAudit !== false,
    trigger: String(merged.trigger || 'manual'),
  }
}

export function summarizeCriteria(c) {
  const parts = [
    `站点 ${c.region}`,
    c.source === 'snapshot' ? `导入快照` : c.source === 'search' ? `关键词 ${c.keyword || '不限'}` : '热销榜',
    `类目 ${c.category || '不限'}`,
  ]
  if (c.totalSalesMax !== null) parts.push(`总销量≤${c.totalSalesMax}`)
  if (c.sales7dMin !== null) parts.push(`7天销量≥${c.sales7dMin}`)
  if (c.creatorsMax !== null) parts.push(`达人≤${c.creatorsMax}`)
  if (c.commissionMin !== null) parts.push(`佣金≥${c.commissionMin}%`)
  if (c.accelMin !== null) parts.push(`加速≥${c.accelMin}倍`)
  if (c.g2MinCardRatio !== null && c.g2MinCardRatio > 0) parts.push(`商品卡≥${c.g2MinCardRatio}%`)
  return parts.join(' / ')
}

/**
 * Pure G1 local quantitative evaluation with machine reason codes & calculation trace.
 */
export function evaluateG1(product, criteria) {
  const strict = criteria.missingMetricPolicy === 'fail_on_missing'
  const skipped = []
  const passedNotes = []

  const checkMin = (val, min, code, shortReason, detailFn, label) => {
    if (min === null) return null
    if (val === null || val === undefined) {
      if (strict) return { conclusion: 'fail', reasonCode: 'G1_METRIC_MISSING', shortReason: `缺少${label}`, detailReason: `严格模式下缺少${label}字段，无法通过 G1 校验` }
      skipped.push(label)
      return null
    }
    if (val < min) return { conclusion: 'fail', reasonCode: code, shortReason, detailReason: detailFn(val, min) }
    passedNotes.push(`${label} ${val} ≥ ${min}`)
    return null
  }

  const checkMax = (val, max, code, shortReason, detailFn, label) => {
    if (max === null) return null
    if (val === null || val === undefined) {
      if (strict) return { conclusion: 'fail', reasonCode: 'G1_METRIC_MISSING', shortReason: `缺少${label}`, detailReason: `严格模式下缺少${label}字段，无法通过 G1 校验` }
      skipped.push(label)
      return null
    }
    if (val > max) return { conclusion: 'fail', reasonCode: code, shortReason, detailReason: detailFn(val, max) }
    passedNotes.push(`${label} ${val} ≤ ${max}`)
    return null
  }

  const accel = computeAcceleration(product.sales7d, product.sales28d, criteria.accelMin ?? 1.1, criteria.accelBase28dMin ?? 28)

  const checks = [
    () => checkMax(product.totalSales, criteria.totalSalesMax, 'G1_TOTAL_SALES_HIGH', '总销量超过上限', (v, m) => `总销量 ${v} > 上限 ${m}，成熟大盘竞争过于拥挤`, '总销量'),
    () => checkMin(product.totalSales, criteria.totalSalesMin, 'G1_TOTAL_SALES_LOW', '总销量低于下限', (v, m) => `总销量 ${v} < 下限 ${m}`, '总销量'),
    () => checkMin(product.sales7d, criteria.sales7dMin, 'G1_SALES_7D_LOW', '近 7 天销量低于下限', (v, m) => `近 7 天销量 ${v} < 下限 ${m}，短期动销不足`, '近7天销量'),
    () => checkMax(product.sales7d, criteria.sales7dMax, 'G1_SALES_7D_HIGH', '近 7 天销量超过上限', (v, m) => `近 7 天销量 ${v} > 上限 ${m}`, '近7天销量'),
    () => checkMax(product.creatorsCount, criteria.creatorsMax, 'G1_CREATORS_HIGH', '带货达人数超过上限', (v, m) => `带货达人数 ${v} > 上限 ${m}，达人生态已过度饱和`, '达人数'),
    () => checkMin(product.creatorsCount, criteria.creatorsMin, 'G1_CREATORS_LOW', '带货达人数低于下限', (v, m) => `带货达人数 ${v} < 下限 ${m}`, '达人数'),
    () => checkMin(product.commissionRate, criteria.commissionMin, 'G1_COMMISSION_LOW', '佣金率低于下限', (v, m) => `佣金率 ${v}% < 下限 ${m}%，利润与分销空间不足`, '佣金率'),
    () => checkMax(product.commissionRate, criteria.commissionMax, 'G1_COMMISSION_HIGH', '佣金率超过上限', (v, m) => `佣金率 ${v}% > 上限 ${m}%`, '佣金率'),
    () => checkMin(product.rating, criteria.ratingMin, 'G1_RATING_LOW', '评分低于下限', (v, m) => `评分 ${v} < 下限 ${m}，低分商品转化差且售后风险高`, '评分'),
    () => checkMax(product.listedDays, criteria.listedDaysMax, 'G1_AGE_OVER_WINDOW', '上架时间超过新品窗口', (v, m) => `已上架 ${v} 天 > 新品窗口上限 ${m} 天`, '上架天数'),
  ]

  for (const run of checks) {
    const fail = run()
    if (fail) {
      return {
        ...fail,
        accel,
        skippedMetrics: skipped,
        evidence: { accel, skippedMetrics: skipped, passedNotes },
      }
    }
  }

  if (criteria.accelMin !== null) {
    if (accel.sold7d === null || accel.sold28d === null) {
      if (strict) {
        return {
          conclusion: 'fail',
          reasonCode: 'G1_METRIC_MISSING',
          shortReason: '缺少 28 天加速数据',
          detailReason: '严格模式下缺少 7 天或 28 天销量，无法计算加速倍数',
          accel,
          skippedMetrics: [...skipped, '加速倍数'],
          evidence: { accel, skippedMetrics: [...skipped, '加速倍数'], passedNotes },
        }
      }
      skipped.push('加速倍数')
    } else if (accel.insufficient) {
      return {
        conclusion: 'fail',
        reasonCode: 'G1_ACCEL_BASE_LOW',
        shortReason: '28 天销量基数不足',
        detailReason: accel.label,
        accel,
        skippedMetrics: skipped,
        evidence: { accel, skippedMetrics: skipped, passedNotes },
      }
    } else if (accel.ratio < criteria.accelMin) {
      return {
        conclusion: 'fail',
        reasonCode: 'G1_ACCEL_LOW',
        shortReason: '加速倍数低于下限',
        detailReason: `${accel.label}，未达到放量拐点`,
        accel,
        skippedMetrics: skipped,
        evidence: { accel, skippedMetrics: skipped, passedNotes },
      }
    } else {
      passedNotes.push(`加速 ${accel.ratio.toFixed(2)} 倍 ≥ ${criteria.accelMin}`)
    }
  }

  const suffix = skipped.length > 0 ? `（数据源未提供 ${skipped.join('、')}，按策略跳过）` : ''
  return {
    conclusion: 'pass',
    reasonCode: 'G1_PASS',
    shortReason: skipped.length > 0 ? '已有量化指标达标（部分字段缺失已跳过）' : '各项量化阈值达标且处于加速期',
    detailReason: `${passedNotes.join('；')}${suffix}`,
    accel,
    skippedMetrics: skipped,
    evidence: { accel, skippedMetrics: skipped, passedNotes },
  }
}

/**
 * Pure G2 channel share evaluation.
 */
export function evaluateG2(channelRes, criteria) {
  if (!channelRes?.ok || !channelRes.metrics) {
    if (criteria.missingMetricPolicy === 'fail_on_missing') {
      return {
        conclusion: 'fail',
        reasonCode: 'G2_CHANNEL_DATA_MISSING',
        shortReason: '缺少 30 天渠道占比数据',
        detailReason: channelRes?.message || '数据源未提供渠道 GMV 拆分，严格模式下不放行',
        channelMetrics: null,
      }
    }
    return {
      conclusion: 'pass',
      reasonCode: 'G2_CHANNEL_DATA_MISSING',
      shortReason: '无渠道占比数据（按策略跳过进入 G3）',
      detailReason: channelRes?.message || '数据源未提供 30 天渠道占比，保留进入 G3 风险审查并标注缺失',
      channelMetrics: null,
    }
  }

  const m = channelRes.metrics
  const card = m.productCardRatio
  const video = m.videoRatio

  if (criteria.g2MinCardRatio > 0) {
    if (card === null || card === undefined) {
      return {
        conclusion: criteria.missingMetricPolicy === 'fail_on_missing' ? 'fail' : 'pass',
        reasonCode: 'G2_CHANNEL_DATA_MISSING',
        shortReason: '缺少商品卡占比字段',
        detailReason: '渠道明细中未返回商品卡占比',
        channelMetrics: m,
      }
    }
    if (card < criteria.g2MinCardRatio) {
      const diff = Number((criteria.g2MinCardRatio - card).toFixed(2))
      return {
        conclusion: 'fail',
        reasonCode: 'G2_CARD_RATIO_LOW',
        shortReason: '商品卡占比低于下限，偏依赖达人推流',
        detailReason: `商品卡占比 ${card}% < 下限 ${criteria.g2MinCardRatio}%（差 ${diff} 个百分点），自然搜索与商城转化偏弱`,
        channelMetrics: m,
      }
    }
  }

  if (criteria.g2MaxVideoRatio > 0 && video !== null && video !== undefined && video > criteria.g2MaxVideoRatio) {
    return {
      conclusion: 'fail',
      reasonCode: 'G2_VIDEO_RATIO_HIGH',
      shortReason: '视频占比超过上限',
      detailReason: `短视频带货占比 ${video}% > 上限 ${criteria.g2MaxVideoRatio}%`,
      channelMetrics: m,
    }
  }

  return {
    conclusion: 'pass',
    reasonCode: 'G2_PASS',
    shortReason: '商品卡占比达标，具备自然成交基础',
    detailReason: `商品卡占比 ${card ?? '—'}% ≥ 下限 ${criteria.g2MinCardRatio}%，视频占比 ${video ?? '—'}%`,
    channelMetrics: m,
  }
}

function matchExcludedCategoriesLocally(product, excludedCategories) {
  const hay = `${product.title || ''} ${product.category || ''}`.toLowerCase()
  const keywordHints = {
    电池: ['battery', 'led', 'lithium', 'rechargeable', 'aa ', 'aaa ', 'usb-c', '电池', '发光'],
    儿童玩具: ['kids toy', 'toys', 'squishy', 'fidget', 'children', 'toddler', '儿童玩具', '玩具'],
    液体: ['liquid', 'spray', 'serum', 'oil', 'shampoo', 'lotion', 'toner', '液体'],
    大件: ['furniture', 'mattress', 'sofa', 'treadmill', 'wardrobe', '大件'],
    大ip: ['spider-man', 'spiderman', 'marvel', 'disney', 'pokemon', 'sanrio', 'hello kitty', 'harry potter', 'barbie', 'nike', 'adidas', 'xbox', 'playstation'],
  }
  const hits = []
  for (const cat of excludedCategories) {
    const norm = String(cat || '').trim()
    if (!norm) continue
    const lower = norm.toLowerCase()
    if (hay.includes(lower)) {
      hits.push(norm)
      continue
    }
    const hints = keywordHints[lower]
    if (hints && hints.some((h) => hay.includes(h))) {
      hits.push(norm)
    }
  }
  return [...new Set(hits)]
}

/**
 * Create the Three-Gate Pipeline Engine.
 */
export function createThreeGateEngine({ store, dataSource, getService, logger }) {
  const abortControllers = new Map()

  function emitProgress(task) {
    const hubEvents = getService?.('hubEvents')
    if (hubEvents && typeof hubEvents.emit === 'function') {
      try {
        hubEvents.emit({
          type: 'omnimux:tiktok-selection:task-update',
          payload: {
            taskId: task.id,
            status: task.status,
            stage: task.stage,
            metrics: task.metrics,
            lastActivityAt: task.lastActivityAt,
          },
        })
      } catch (err) {
        logger?.warn?.('omnimux-tiktok-selection: hubEvents emit failed', { error: err?.message })
      }
    }
  }

  async function fetchCandidatesForCriteria(criteria, pageLimit) {
    const all = []
    let matchedTotal = 0
    let fetchedPages = 0
    const pagesToFetch = Math.max(1, pageLimit ?? criteria.maxPages)

    for (let page = 1; page <= pagesToFetch; page += 1) {
      const res =
        criteria.source === 'search'
          ? await dataSource.searchProducts({
              region: criteria.region,
              keyword: criteria.keyword,
              category: criteria.category,
              sortField: criteria.sortField,
              snapshotId: criteria.snapshotId,
              page,
              pageSize: OPERATIONAL_LIMITS.pageSize,
            })
          : await dataSource.queryRank({
              region: criteria.region,
              category: criteria.category,
              sortField: criteria.sortField,
              snapshotId: criteria.snapshotId,
              page,
              pageSize: OPERATIONAL_LIMITS.pageSize,
            })

      matchedTotal = Math.max(matchedTotal, Number(res.total || 0))
      fetchedPages += 1
      const pageItems = Array.isArray(res.items) ? res.items : []
      for (let i = 0; i < pageItems.length; i += 1) {
        all.push({ ...pageItems[i], _page: page, _indexInPage: i + 1 })
      }
      if (pageItems.length < OPERATIONAL_LIMITS.pageSize || page >= (res.totalPages || 1)) break
    }
    return { items: all, matchedTotal, fetchedPages }
  }

  async function dryRunEstimate(rawCriteria = {}) {
    const settings = store.getSettings()
    const criteria = normalizeGateCriteria(rawCriteria, settings)
    const { items: page1Items, matchedTotal } = await fetchCandidatesForCriteria(criteria, 1)
    const maxProcessCount = Math.min(matchedTotal || page1Items.length, criteria.maxPages * OPERATIONAL_LIMITS.pageSize)
    const hitApiCap = matchedTotal >= OPERATIONAL_LIMITS.maxApiMatches
    const truncatedByPages = matchedTotal > maxProcessCount

    return {
      criteria,
      summary: summarizeCriteria(criteria),
      matchedTotal,
      page1Count: page1Items.length,
      maxPages: criteria.maxPages,
      maxProcessCount,
      hitApiCap,
      truncatedByPages,
      stages: [
        { stage: 'G1 量化初筛', maxCalls: criteria.maxPages, unitCostNote: '按页拉取，本地零额外算力初筛' },
        { stage: 'G2 渠道核验', maxCalls: maxProcessCount, unitCostNote: '仅处理 G1 通过商品' },
        { stage: 'G3 合规风控', maxCalls: maxProcessCount, unitCostNote: '本地风险词拦截后走 Hub 无头技能审查' },
      ],
      previewItems: page1Items.slice(0, 5),
    }
  }

  async function runG3ForProduct(product, criteria, settings, signal) {
    // Step 3a: local brand + sensitive risk word dictionary
    const wordHits = store.matchRiskWords(product)
    if (wordHits.length > 0) {
      return {
        conclusion: 'fail',
        reasonCode: 'G3_RISK_WORD_HIT',
        riskLevel: 'high',
        brandRisk: wordHits.some((h) => h.type === 'brand') ? 'confirmed' : 'none',
        suspectBrand: wordHits.find((h) => h.type === 'brand')?.term || '',
        excludedHits: [],
        shortReason: '命中本地风险词表',
        detailReason: `命中风险词：${wordHits.map((h) => `${h.term}(${h.type === 'brand' ? '品牌词' : '敏感词'})`).join('、')}`,
        modelReason: '',
        evidence: { wordHits },
      }
    }

    // Step 3b: local excluded category check
    const localExcluded = matchExcludedCategoriesLocally(product, settings.excludedCategories)
    if (localExcluded.length > 0 && !criteria.useAiAudit) {
      return {
        conclusion: 'fail',
        reasonCode: 'G3_EXCLUDED_CATEGORY',
        riskLevel: 'high',
        brandRisk: localExcluded.some((c) => c.toLowerCase() === '大ip') ? 'confirmed' : 'none',
        suspectBrand: '',
        excludedHits: localExcluded,
        shortReason: '命中排除品类',
        detailReason: `命中排除品类：${localExcluded.join('、')}（当前清单：${settings.excludedCategories.join('、')}）`,
        modelReason: '',
        evidence: { localExcluded },
      }
    }

    // Step 3c: Hub headlessSkill AI risk audit
    const headlessSkill = getService?.('headlessSkill')
    if (criteria.useAiAudit && headlessSkill && typeof headlessSkill.run === 'function') {
      try {
        const res = await headlessSkill.run({
          skillName: 'tiktok-selection-risk-audit',
          label: `G3 风控审查 ${product.productId}`,
          ownerPlugin: 'omnimux-tiktok-selection',
          targetId: product.productId,
          inputFingerprint: `${product.productId}:${product.title}:${settings.excludedCategories.join(',')}`,
          modality: product.coverUrl ? 'image' : 'text',
          input: JSON.stringify({
            productId: product.productId,
            region: product.region,
            title: product.title,
            shopName: product.shopName,
            category: product.category,
            price: product.priceDisplay,
            excludedCategories: settings.excludedCategories,
          }),
          references: product.coverUrl ? [{ type: 'image', pathOrUrl: product.coverUrl }] : [],
          outputSchema: RISK_AUDIT_OUTPUT_SCHEMA,
          maxRepairAttempts: 1,
          signal,
        })

        const data = res?.data
        if (!data || typeof data.pass !== 'boolean') {
          return {
            conclusion: 'incomplete',
            reasonCode: 'G3_AI_INVALID_SCHEMA',
            riskLevel: 'medium',
            brandRisk: 'suspected',
            suspectBrand: '',
            excludedHits: localExcluded,
            shortReason: 'AI 返回结构不合法，待重试',
            detailReason: '无头技能未返回符合 JSON Schema 的结构化结论，禁止默认放行',
            modelReason: '',
            evidence: { rawResponse: res },
          }
        }

        const mergedExcluded = [...new Set([...(Array.isArray(data.excludedHits) ? data.excludedHits : []), ...localExcluded])]
        const hardBlocked = mergedExcluded.length > 0 || data.brandRisk === 'confirmed'
        const finalPass = !hardBlocked && data.pass === true

        return {
          conclusion: finalPass ? 'pass' : 'fail',
          reasonCode: mergedExcluded.length > 0 ? 'G3_EXCLUDED_CATEGORY' : data.brandRisk === 'confirmed' ? 'G3_BRAND_CONFIRMED' : finalPass ? 'G3_PASS' : 'G3_AI_REJECTED',
          riskLevel: hardBlocked ? 'high' : data.riskLevel || 'low',
          brandRisk: data.brandRisk || 'none',
          suspectBrand: String(data.suspectBrand || ''),
          excludedHits: mergedExcluded,
          shortReason: mergedExcluded.length > 0 ? '命中排除品类' : data.brandRisk === 'confirmed' ? '存在明确品牌/TRO 风险' : finalPass ? '通过风险词与 AI 合规审查' : 'AI 判定不建议跟卖',
          detailReason: `${mergedExcluded.length > 0 ? `命中排除品类：${mergedExcluded.join('、')}。` : ''}${data.reason || ''}`,
          modelReason: String(data.reason || ''),
          evidence: { aiAudit: data, localExcluded, model: res.model, jobId: res.jobId },
        }
      } catch (err) {
        logger?.warn?.('omnimux-tiktok-selection: G3 headlessSkill error', { productId: product.productId, error: err?.message })
        return {
          conclusion: 'incomplete',
          reasonCode: 'G3_AI_ERROR',
          riskLevel: 'medium',
          brandRisk: 'suspected',
          suspectBrand: '',
          excludedHits: localExcluded,
          shortReason: 'AI 风控调用失败，待重试',
          detailReason: err?.message || 'Hub headlessSkill 调用异常，按 fail-closed 原则记为未完成',
          modelReason: '',
          evidence: { error: err?.message, code: err?.code, localExcluded },
        }
      }
    }

    // Rule-only fallback when useAiAudit is explicitly false (never silently pretend AI ran)
    if (!criteria.useAiAudit) {
      return {
        conclusion: 'pass',
        reasonCode: 'G3_RULES_PASS',
        riskLevel: 'low',
        brandRisk: 'none',
        suspectBrand: '',
        excludedHits: [],
        shortReason: '通过本地风险词与排除品类校验（未启用 AI 审查）',
        detailReason: '本地品牌词、敏感词及排除品类均未命中',
        modelReason: '',
        evidence: { mode: 'rules_only' },
      }
    }

    // useAiAudit === true but headlessSkill is unavailable -> fail-closed (incomplete) if not already blocked
    if (localExcluded.length > 0) {
      return {
        conclusion: 'fail',
        reasonCode: 'G3_EXCLUDED_CATEGORY',
        riskLevel: 'high',
        brandRisk: 'none',
        suspectBrand: '',
        excludedHits: localExcluded,
        shortReason: '命中排除品类',
        detailReason: `命中排除品类：${localExcluded.join('、')}`,
        modelReason: '',
        evidence: { localExcluded },
      }
    }
    return {
      conclusion: 'incomplete',
      reasonCode: 'G3_AI_UNAVAILABLE',
      riskLevel: 'medium',
      brandRisk: 'suspected',
      suspectBrand: '',
      excludedHits: [],
      shortReason: 'AI 审查服务未就绪，待复核',
      detailReason: 'Hub headlessSkill 接缝未就绪，按 fail-closed 原则记为未完成（可关闭 AI 审查后走本地规则或人工放行）',
      modelReason: '',
      evidence: { headlessSkillAvailable: false },
    }
  }

  async function executeTask(taskId, { retryIncompleteOnly = false } = {}) {
    const controller = new AbortController()
    abortControllers.set(taskId, controller)
    const settings = store.getSettings()

    try {
      let task = store.getTask(taskId)
      if (!task) throw new SelectionError('not-found', `Task ${taskId} not found`)
      const criteria = task.criteria

      let g1PassedProducts = []
      let g2PassedProducts = []

      if (!retryIncompleteOnly) {
        // ---- G1 ----
        task = store.updateTask(taskId, (t) => ({
          ...t,
          status: 'g1_running',
          stage: 'g1',
          metrics: { ...t.metrics, rounds: (t.metrics.rounds || 0) + 1 },
        }))
        store.appendTaskLog(taskId, 'G1', `第 ${task.metrics.rounds} 轮开始（状态 G1中）`)
        emitProgress(task)

        const { items, matchedTotal, fetchedPages } = await fetchCandidatesForCriteria(criteria)
        if (controller.signal.aborted) return markStopped(taskId)

        for (const product of items) {
          const result = evaluateG1(product, criteria)
          store.saveGateItem({
            taskId,
            gate: 'g1',
            productId: product.productId,
            region: product.region,
            title: product.title,
            coverUrl: product.coverUrl,
            tiktokUrl: product.tiktokUrl,
            conclusion: result.conclusion,
            reasonCode: result.reasonCode,
            shortReason: result.shortReason,
            detailReason: result.detailReason,
            metrics: {
              totalSales: product.totalSales,
              sales7d: product.sales7d,
              sales28d: product.sales28d,
              creatorsCount: product.creatorsCount,
              commissionRate: product.commissionRate,
              rating: product.rating,
              listedDays: product.listedDays,
              accelRatio: result.accel.ratio,
              accelLabel: result.accel.label,
            },
            evidence: result.evidence,
            rawProduct: product,
          })
          if (result.conclusion === 'pass') g1PassedProducts.push(product)
        }

        task = store.updateTask(taskId, (t) => ({
          ...t,
          metrics: { ...t.metrics, matchedTotal, fetchedPages },
        }))
        task = store.recomputeTaskGateCounters(taskId)
        store.appendTaskLog(
          taskId,
          'G1',
          `完成：共 ${fetchedPages} 页 ${items.length} 个商品，通过 ${task.metrics.g1.pass} / 不通过 ${task.metrics.g1.fail} / 未完成 ${task.metrics.g1.incomplete}`
        )
        emitProgress(task)

        // ---- G2 ----
        task = store.updateTask(taskId, (t) => ({
          ...t,
          status: 'g2_running',
          stage: 'g2',
          metrics: { ...t.metrics, rounds: (t.metrics.rounds || 0) + 1 },
        }))
        store.appendTaskLog(taskId, 'G2', `第 ${task.metrics.rounds} 轮开始，核验 ${g1PassedProducts.length} 个商品渠道占比`)
        emitProgress(task)

        for (const product of g1PassedProducts) {
          if (controller.signal.aborted) return markStopped(taskId)
          const channelRes = await dataSource.enrichChannelMetrics(product)
          const g2Res = evaluateG2(channelRes, criteria)
          const enrichedProduct = g2Res.channelMetrics ? { ...product, channelMetrics: g2Res.channelMetrics } : product
          store.saveGateItem({
            taskId,
            gate: 'g2',
            productId: product.productId,
            region: product.region,
            title: product.title,
            coverUrl: product.coverUrl,
            tiktokUrl: product.tiktokUrl,
            conclusion: g2Res.conclusion,
            reasonCode: g2Res.reasonCode,
            shortReason: g2Res.shortReason,
            detailReason: g2Res.detailReason,
            metrics: {
              productCardRatio: g2Res.channelMetrics?.productCardRatio ?? null,
              videoRatio: g2Res.channelMetrics?.videoRatio ?? null,
              creatorRatio: g2Res.channelMetrics?.creatorRatio ?? null,
              gmv30d: g2Res.channelMetrics?.gmv30d ?? null,
            },
            evidence: { channelRes },
            rawProduct: enrichedProduct,
          })
          if (g2Res.conclusion === 'pass') g2PassedProducts.push(enrichedProduct)
        }

        task = store.recomputeTaskGateCounters(taskId)
        store.appendTaskLog(
          taskId,
          'G2',
          `完成：输入 ${task.metrics.g2.input} / 通过 ${task.metrics.g2.pass} / 不通过 ${task.metrics.g2.fail}`
        )
        emitProgress(task)
      } else {
        // Retry only incomplete G3 items
        const curTask = store.getTask(taskId)
        const incompleteG3 = (curTask?.gateItems?.g3 || []).filter((x) => x.conclusion === 'incomplete')
        g2PassedProducts = incompleteG3.map((x) => x.rawProduct).filter(Boolean)
      }

      // ---- G3 ----
      task = store.updateTask(taskId, (t) => ({
        ...t,
        status: 'g3_running',
        stage: 'g3',
        metrics: { ...t.metrics, rounds: (t.metrics.rounds || 0) + 1 },
      }))
      store.appendTaskLog(taskId, 'G3', `第 ${task.metrics.rounds} 轮开始，审查 ${g2PassedProducts.length} 个商品合规与品牌风险`)
      emitProgress(task)

      const toIngest = []
      for (const product of g2PassedProducts) {
        if (controller.signal.aborted) return markStopped(taskId)
        const g3Res = await runG3ForProduct(product, criteria, settings, controller.signal)
        store.saveGateItem({
          taskId,
          gate: 'g3',
          productId: product.productId,
          region: product.region,
          title: product.title,
          coverUrl: product.coverUrl,
          tiktokUrl: product.tiktokUrl,
          conclusion: g3Res.conclusion,
          reasonCode: g3Res.reasonCode,
          shortReason: g3Res.shortReason,
          detailReason: g3Res.detailReason,
          metrics: {
            riskLevel: g3Res.riskLevel,
            brandRisk: g3Res.brandRisk,
            suspectBrand: g3Res.suspectBrand,
            excludedHits: g3Res.excludedHits,
            modelReason: g3Res.modelReason,
          },
          evidence: g3Res.evidence,
          rawProduct: product,
        })
        if (g3Res.conclusion === 'pass' && toIngest.length < criteria.maxIngest) {
          toIngest.push(product)
        }
      }

      let newlyIngested = 0
      if (toIngest.length > 0) {
        const ingestRes = store.ingestProducts(toIngest, {
          region: criteria.region,
          source: 'three_gate',
          sourceDetail: summarizeCriteria(criteria),
          sourceTaskId: taskId,
          checkRiskWords: false, // Already checked in G3 Step 3a
        })
        newlyIngested = ingestRes.addedCount
      }

      task = store.recomputeTaskGateCounters(taskId)
      task = store.updateTask(taskId, (t) => ({
        ...t,
        status: 'completed',
        stage: 'done',
        finishedAt: new Date().toISOString(),
        metrics: {
          ...t.metrics,
          ingestedCount: (t.metrics.ingestedCount || 0) + newlyIngested,
        },
      }))
      store.appendTaskLog(
        taskId,
        'G3',
        `完成：通过 ${task.metrics.g3.pass} / 不通过 ${task.metrics.g3.fail} / 未完成 ${task.metrics.g3.incomplete}，新入库 ${newlyIngested} 个，任务结束`
      )
      emitProgress(task)
      return store.getTask(taskId)
    } catch (err) {
      logger?.warn?.('omnimux-tiktok-selection: three-gate task failed', { taskId, error: err?.message })
      const failed = store.updateTask(taskId, (t) => ({
        ...t,
        status: 'failed',
        finishedAt: new Date().toISOString(),
      }))
      store.appendTaskLog(taskId, 'ERROR', err?.message || '任务执行异常')
      emitProgress(failed)
      throw err
    } finally {
      abortControllers.delete(taskId)
    }
  }

  function markStopped(taskId) {
    const stopped = store.updateTask(taskId, (t) => ({
      ...t,
      status: 'stopped',
      finishedAt: new Date().toISOString(),
    }))
    store.appendTaskLog(taskId, 'STOP', '任务已被用户手动停止')
    emitProgress(stopped)
    return store.getTask(taskId)
  }

  async function createAndRunTask(rawCriteria = {}, opts = {}) {
    const settings = store.getSettings()
    const criteria = normalizeGateCriteria(rawCriteria, settings)
    const estimate = opts.estimate || {
      matchedTotal: 0,
      maxProcessCount: criteria.maxPages * OPERATIONAL_LIMITS.pageSize,
    }
    const created = store.createTask(criteria, estimate)
    if (opts.awaitCompletion === false) {
      executeTask(created.id).catch((err) => {
        logger?.warn?.('omnimux-tiktok-selection: background task error', { taskId: created.id, error: err?.message })
      })
      return store.getTask(created.id)
    }
    return executeTask(created.id)
  }

  function stopTask(taskId) {
    const ctrl = abortControllers.get(taskId)
    if (ctrl) ctrl.abort()
    return markStopped(taskId)
  }

  async function retryIncomplete(taskId) {
    const task = store.getTask(taskId)
    if (!task) throw new SelectionError('not-found', `Task ${taskId} not found`)
    return executeTask(taskId, { retryIncompleteOnly: true })
  }

  async function cloneAndRun(taskId, opts = {}) {
    const task = store.getTask(taskId)
    if (!task) throw new SelectionError('not-found', `Task ${taskId} not found`)
    return createAndRunTask(task.criteria, opts)
  }

  function dispose() {
    for (const ctrl of abortControllers.values()) {
      ctrl.abort()
    }
    abortControllers.clear()
  }

  return {
    dryRunEstimate,
    createAndRunTask,
    stopTask,
    retryIncomplete,
    cloneAndRun,
    dispose,
  }
}
