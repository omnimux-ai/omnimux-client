import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { OPERATIONAL_LIMITS, VIDEO_SCRIPT_OUTPUT_SCHEMA } from './constants.js'
import { SelectionError } from './errors.js'
import { ensureDir, resolveWithin, safePathSegment } from './paths.js'

export const PRODUCT_NAME_MAX = 40

function makeSlotId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${randomBytes(2).toString('hex')}`
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Normalize a product display name so it satisfies `omnimux-products`
 * (`NAME_MAX = 40`, no `/` / `\` or ASCII control characters).
 * @param {unknown} title
 * @param {unknown} [fallback]
 * @returns {string}
 */
export function normalizeProductSyncName(title, fallback = 'TikTok Product') {
  const sanitize = (raw) =>
    String(raw ?? '')
      .replace(/[\u0000-\u001f\u007f]+/g, ' ')
      .replace(/[\\/]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, PRODUCT_NAME_MAX)
      .trim()
  return sanitize(title) || sanitize(fallback) || 'TikTok Product'
}

/**
 * Frozen DSH 0.2.1-rc.3 exposes `executionMode()` without `setExecutor()`.
 * @param {Record<string, any>} tools
 */
function usesLegacySingleExecute(tools) {
  return typeof tools.executionMode === 'function' && typeof tools.setExecutor !== 'function'
}

function extractBatchResult(batch, callId, toolName) {
  const results = isObject(batch) && Array.isArray(batch.results) ? batch.results : []
  if (results.length === 0) {
    throw new Error(`工具 ${toolName} 未返回有效批次结果`)
  }
  const matched = results.find((item) => isObject(item) && item.callId === callId)
  const entry = matched ?? (results.length === 1 ? results[0] : undefined)
  if (!isObject(entry) || !isObject(entry.result)) {
    throw new Error(`工具 ${toolName} 批次结果缺少 callId=${callId} 的条目`)
  }
  return entry.result
}

function extractToolError(result, toolName) {
  const content = Array.isArray(result.content) ? result.content : []
  const text = content
    .map((block) => (isObject(block) && typeof block.text === 'string' ? block.text : ''))
    .join('\n')
    .trim()
  const errorInfo = isObject(result.error) ? result.error : {}
  const info = isObject(errorInfo.info) ? errorInfo.info : {}
  const rawMessage = text || String(errorInfo.message || '').trim() || `工具 ${toolName} 执行失败`
  const errText = `${text}\n${String(errorInfo.message || '')}\n${String(info.code || '')}`
  if (/UNKNOWN_TOOL|unknown tool/i.test(errText)) {
    return new SelectionError('needs-provider', 'omnimux-products 插件未启用，无法同步至 OmniMux 产品库。')
  }
  return new Error(rawMessage)
}

/**
 * Create the creative asset generation & OmniMux product-sync pipeline.
 */
export function createAssetsPipeline({ store, dataSource, getService, resolveTools, tools, logger }) {
  async function executeRegisteredTool(toolName, args) {
    const registry = typeof resolveTools === 'function' ? resolveTools() : tools
    if (!registry || typeof registry.execute !== 'function') {
      throw new SelectionError('needs-provider', 'omnimux-products 插件未启用，无法同步至 OmniMux 产品库。')
    }
    if (typeof registry.executable === 'function' || typeof registry.get === 'function') {
      const def =
        (typeof registry.executable === 'function' ? registry.executable(toolName) : undefined) ??
        (typeof registry.get === 'function' ? registry.get(toolName) : undefined)
      if (!def) {
        throw new SelectionError('needs-provider', 'omnimux-products 插件未启用，无法同步至 OmniMux 产品库。')
      }
    }

    const callId = makeSlotId('ttsel_tool')
    const signal = new AbortController().signal
    const normalizedArgs = args ?? {}
    const legacySingle = usesLegacySingleExecute(registry)
    const input = legacySingle
      ? { callId, name: toolName, arguments: normalizedArgs, signal }
      : { calls: [{ type: 'tool-call', id: callId, name: toolName, arguments: JSON.stringify(normalizedArgs) ?? '{}' }], signal }

    const raw = await registry.execute(input)
    const result = legacySingle ? raw : extractBatchResult(raw, callId, toolName)
    if (!isObject(result)) {
      throw new Error(`工具 ${toolName} 未返回有效结果对象`)
    }
    if (result.isError) {
      throw extractToolError(result, toolName)
    }
    return result.value
  }
  async function generateVideoScript({ productIds, extraSellingPoints = '' }) {
    if (!Array.isArray(productIds) || productIds.length === 0) {
      throw new SelectionError('invalid-request', 'productIds array is required')
    }
    const headlessSkill = getService?.('headlessSkill')
    if (!headlessSkill || typeof headlessSkill.run !== 'function') {
      throw new SelectionError(
        'needs-provider',
        'Hub headlessSkill 接缝未就绪，请先配置 OmniMux 文本模型渠道后再生成视频脚本。'
      )
    }

    const results = []
    for (const pid of productIds) {
      const item = store.getLibraryItem(pid)
      if (!item) {
        results.push({ productId: pid, ok: false, error: 'not-found' })
        continue
      }
      let refVideos = Array.isArray(item.referenceVideos) ? item.referenceVideos : []
      if (refVideos.length === 0) {
        try {
          const detail = await dataSource.getProductDetail({
            productId: item.productId,
            region: item.region,
            loadVideos: true,
            productHint: item,
          })
          refVideos = detail.referenceVideos || []
        } catch (err) {
          logger?.warn?.('omnimux-tiktok-selection: script ref-video fetch skipped', { productId: item.productId, error: err?.message })
        }
      }

      const topRef = refVideos[0] || null
      try {
        const res = await headlessSkill.run({
          skillName: 'tiktok-selection-video-script',
          label: `爆款脚本重写 ${item.productId}`,
          ownerPlugin: 'omnimux-tiktok-selection',
          targetId: item.id,
          inputFingerprint: `${item.id}:${extraSellingPoints}:${topRef?.videoId || 'none'}`,
          modality: 'text',
          input: JSON.stringify({
            title: item.title,
            category: item.category,
            price: item.priceDisplay,
            region: item.region,
            extraSellingPoints,
            referenceVideo: topRef
              ? { caption: topRef.caption, author: topRef.author, gmv: topRef.gmv, url: topRef.url }
              : null,
          }),
          outputSchema: VIDEO_SCRIPT_OUTPUT_SCHEMA,
          maxRepairAttempts: 1,
        })

        const scriptRecord = {
          ...res.data,
          referenceVideoUrl: topRef?.url || '',
          model: res.model || '',
          generatedAt: new Date().toISOString(),
        }
        store.updateLibraryItem(item.id, { videoScript: scriptRecord, assetError: '' })
        results.push({ productId: item.productId, id: item.id, ok: true, script: scriptRecord })
      } catch (err) {
        logger?.warn?.('omnimux-tiktok-selection: script generation failed', { productId: item.productId, error: err?.message })
        store.updateLibraryItem(item.id, { assetError: err?.message || '脚本生成失败' })
        results.push({ productId: item.productId, id: item.id, ok: false, error: err?.message || '脚本生成失败' })
      }
    }
    return {
      total: results.length,
      succeeded: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      results,
    }
  }

  async function generateImages({ productIds, countPerProduct = 2, skipExisting = true, prompt = '', model = '' }) {
    if (!Array.isArray(productIds) || productIds.length === 0) {
      throw new SelectionError('invalid-request', 'productIds array is required')
    }
    const perProd = Math.min(OPERATIONAL_LIMITS.maxImagesPerProduct, Math.max(1, Number.parseInt(String(countPerProduct), 10) || 2))
    const settings = store.getSettings()
    const effectivePrompt = String(prompt || settings.defaultImagePrompt).trim()

    const plan = []
    let totalToGenerate = 0
    for (const pid of productIds) {
      const item = store.getLibraryItem(pid)
      if (!item) continue
      const existingReady = (item.generatedImages || []).filter((x) => x.status === 'ready').length
      if (skipExisting && existingReady > 0) continue
      const remaining = Math.max(0, OPERATIONAL_LIMITS.maxImagesPerProduct - existingReady)
      const count = Math.min(perProd, remaining)
      if (count > 0) {
        plan.push({ item, count })
        totalToGenerate += count
      }
    }

    if (totalToGenerate > OPERATIONAL_LIMITS.maxBatchImages) {
      throw new SelectionError(
        'batch-limit-exceeded',
        `单次批量生图硬上限为 ${OPERATIONAL_LIMITS.maxBatchImages} 张，当前计划 ${totalToGenerate} 张，请缩减选中商品或单品张数。`
      )
    }

    const imageGenerate = getService?.('imageGenerate')
    if (!imageGenerate || typeof imageGenerate.execute !== 'function') {
      throw new SelectionError(
        'needs-provider',
        'Hub imageGenerate 接缝未就绪，请先在 OmniMux 配置生图渠道与默认模型。'
      )
    }

    const catalog = getService?.('modelCatalog')?.list?.()
    const resolvedModel = String(model || catalog?.defaults?.image || '').trim() || undefined

    const results = []
    for (const entry of plan) {
      const prodDir = resolveWithin(
        store.paths.assetsDir,
        safePathSegment(entry.item.productId, safePathSegment(entry.item.id, 'product'))
      )
      ensureDir(prodDir)
      const createdSlots = []
      for (let i = 0; i < entry.count; i += 1) {
        const slotId = makeSlotId('img')
        const dest = join(prodDir, `${slotId}.png`)
        try {
          const out = await imageGenerate.execute({
            prompt: `${effectivePrompt}\nProduct: ${entry.item.title}`,
            dest,
            aspectRatio: '3:4',
            ...(entry.item.coverUrl ? { image: entry.item.coverUrl } : {}),
            ...(resolvedModel ? { model: resolvedModel } : {}),
          })
          createdSlots.push({
            id: slotId,
            kind: 'image',
            status: 'ready',
            path: out?.dest || dest,
            prompt: effectivePrompt,
            model: out?.model || resolvedModel || '',
            createdAt: new Date().toISOString(),
          })
        } catch (err) {
          logger?.warn?.('omnimux-tiktok-selection: image generation slot failed', { productId: entry.item.productId, error: err?.message })
          createdSlots.push({
            id: slotId,
            kind: 'image',
            status: 'failed',
            path: '',
            prompt: effectivePrompt,
            error: err?.message || '生图失败',
            retries: 0,
            createdAt: new Date().toISOString(),
          })
        }
      }
      store.updateLibraryItem(entry.item.id, (cur) => ({
        generatedImages: [...(cur.generatedImages || []), ...createdSlots].slice(0, OPERATIONAL_LIMITS.maxImagesPerProduct),
      }))
      results.push({
        productId: entry.item.productId,
        id: entry.item.id,
        created: createdSlots.filter((s) => s.status === 'ready').length,
        failed: createdSlots.filter((s) => s.status === 'failed').length,
        slots: createdSlots,
      })
    }

    return { planned: totalToGenerate, results }
  }

  async function generateVideos({
    productIds,
    countPerProduct = 1,
    skipExisting = true,
    useExistingScript = true,
    prompt = '',
    model = '',
  }) {
    if (!Array.isArray(productIds) || productIds.length === 0) {
      throw new SelectionError('invalid-request', 'productIds array is required')
    }
    const perProd = Math.min(OPERATIONAL_LIMITS.maxVideosPerProduct, Math.max(1, Number.parseInt(String(countPerProduct), 10) || 1))
    const settings = store.getSettings()

    const plan = []
    let totalToGenerate = 0
    for (const pid of productIds) {
      const item = store.getLibraryItem(pid)
      if (!item) continue
      const existingReady = (item.generatedVideos || []).filter((x) => x.status === 'ready').length
      if (skipExisting && existingReady > 0) continue
      const remaining = Math.max(0, OPERATIONAL_LIMITS.maxVideosPerProduct - existingReady)
      const count = Math.min(perProd, remaining)
      if (count > 0) {
        plan.push({ item, count })
        totalToGenerate += count
      }
    }

    if (totalToGenerate > OPERATIONAL_LIMITS.maxBatchVideos) {
      throw new SelectionError(
        'batch-limit-exceeded',
        `单次批量生视频硬上限为 ${OPERATIONAL_LIMITS.maxBatchVideos} 个，当前计划 ${totalToGenerate} 个，请缩减数量。`
      )
    }

    const videoGenerate = getService?.('videoGenerate')
    if (!videoGenerate || typeof videoGenerate.execute !== 'function') {
      throw new SelectionError(
        'needs-provider',
        'Hub videoGenerate 接缝未就绪，请先在 OmniMux 配置视频生成渠道与默认模型。'
      )
    }

    const catalog = getService?.('modelCatalog')?.list?.()
    const resolvedModel = String(model || catalog?.defaults?.video || '').trim() || undefined

    const results = []
    for (const entry of plan) {
      const prodDir = resolveWithin(
        store.paths.assetsDir,
        safePathSegment(entry.item.productId, safePathSegment(entry.item.id, 'product'))
      )
      ensureDir(prodDir)
      const effectivePrompt =
        (useExistingScript && entry.item.videoScript?.videoPromptEn) ||
        String(prompt || settings.defaultVideoPrompt).trim()
      const createdSlots = []
      for (let i = 0; i < entry.count; i += 1) {
        const slotId = makeSlotId('vid')
        const dest = join(prodDir, `${slotId}.mp4`)
        try {
          const out = await videoGenerate.execute({
            prompt: effectivePrompt,
            dest,
            duration: 5,
            aspectRatio: '9:16',
            ...(entry.item.coverUrl ? { image: entry.item.coverUrl } : {}),
            ...(resolvedModel ? { model: resolvedModel } : {}),
          })
          createdSlots.push({
            id: slotId,
            kind: 'video',
            status: 'ready',
            path: out?.dest || dest,
            prompt: effectivePrompt,
            model: out?.model || resolvedModel || '',
            createdAt: new Date().toISOString(),
          })
        } catch (err) {
          logger?.warn?.('omnimux-tiktok-selection: video generation slot failed', { productId: entry.item.productId, error: err?.message })
          createdSlots.push({
            id: slotId,
            kind: 'video',
            status: 'failed',
            path: '',
            prompt: effectivePrompt,
            error: err?.message || '生视频失败',
            retries: 0,
            createdAt: new Date().toISOString(),
          })
        }
      }
      store.updateLibraryItem(entry.item.id, (cur) => ({
        generatedVideos: [...(cur.generatedVideos || []), ...createdSlots].slice(0, OPERATIONAL_LIMITS.maxVideosPerProduct),
      }))
      results.push({
        productId: entry.item.productId,
        id: entry.item.id,
        created: createdSlots.filter((s) => s.status === 'ready').length,
        failed: createdSlots.filter((s) => s.status === 'failed').length,
        slots: createdSlots,
      })
    }

    return { planned: totalToGenerate, results }
  }

  async function syncToOmnimuxProducts({ productIds }) {
    if (!Array.isArray(productIds) || productIds.length === 0) {
      throw new SelectionError('invalid-request', 'productIds array is required')
    }
    const registry = typeof resolveTools === 'function' ? resolveTools() : tools
    if (!registry || typeof registry.execute !== 'function') {
      throw new SelectionError('needs-provider', 'omnimux-products 插件未启用，无法同步至 OmniMux 产品库。')
    }
    if (typeof registry.executable === 'function' || typeof registry.get === 'function') {
      const def =
        (typeof registry.executable === 'function' ? registry.executable('products_create') : undefined) ??
        (typeof registry.get === 'function' ? registry.get('products_create') : undefined)
      if (!def) {
        throw new SelectionError('needs-provider', 'omnimux-products 插件未启用，无法同步至 OmniMux 产品库。')
      }
    }

    const synced = []
    for (const pid of productIds) {
      const item = store.getLibraryItem(pid)
      if (!item) {
        synced.push({ productId: pid, ok: false, error: 'not-found' })
        continue
      }
      const sellingPoints =
        item.videoScript?.sellingPoints?.join('；') ||
        `TikTok ${item.region} 选品入库，佣金 ${item.commissionRate ?? '—'}%，7天销量 ${item.sales7d ?? '—'}`
      const localMedia = [
        ...(item.generatedImages || []).filter((x) => x.status === 'ready' && x.path).map((x) => ({ real_path: x.path })),
        ...(item.generatedVideos || []).filter((x) => x.status === 'ready' && x.path).map((x) => ({ real_path: x.path })),
      ]
      try {
        const created = await executeRegisteredTool('products_create', {
          kind: 'physical',
          name: normalizeProductSyncName(item.title, item.productId),
          selling_points: sellingPoints,
          description: `${item.title}\n类目：${item.category || '未分类'}\n店铺：${item.shopName || '未知'}`,
          price: item.priceDisplay,
          sku: item.productId,
          link: item.tiktokUrl,
          categories: item.category ? [item.category.split('->')[0].trim().slice(0, 32)] : ['TikTok'],
          ...(localMedia.length > 0 ? { media: localMedia } : {}),
        })
        const syncedId = created?.product?.id || created?.id || 'synced'
        store.updateLibraryItem(item.id, { syncedProductId: String(syncedId) })
        synced.push({ productId: item.productId, id: item.id, ok: true, syncedProductId: syncedId })
      } catch (err) {
        if (err instanceof SelectionError && err.code === 'needs-provider') throw err
        logger?.warn?.('omnimux-tiktok-selection: sync to omnimux-products failed', { productId: item.productId, error: err?.message })
        synced.push({ productId: item.productId, id: item.id, ok: false, error: err?.message || '同步失败' })
      }
    }
    return {
      total: synced.length,
      succeeded: synced.filter((x) => x.ok).length,
      results: synced,
    }
  }

  return {
    generateVideoScript,
    generateImages,
    generateVideos,
    syncToOmnimuxProducts,
  }
}
