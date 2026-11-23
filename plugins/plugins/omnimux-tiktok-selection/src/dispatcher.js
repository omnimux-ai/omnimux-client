import {
  DEFAULT_GATE_CRITERIA,
  OPERATIONAL_LIMITS,
  TIKTOK_CATEGORIES,
  TIKTOK_REGIONS,
} from './constants.js'
import { SelectionError } from './errors.js'

function requireConfirm(confirm, actionLabel) {
  if (confirm !== true) {
    return {
      ok: false,
      error: 'confirmation-required',
      message: `${actionLabel}属于破坏性操作，必须显式传入 confirm: true 后才可执行。`,
    }
  }
  return null
}

/**
 * Single-source business dispatcher shared by HTTP routes and Agent tools.
 */
export function createSelectionDispatcher({ store, dataSource, threeGate, assetsPipeline, scheduler }) {
  async function getOverview() {
    return {
      stats: store.summaryStats(),
      capabilities: dataSource.getCapabilities(),
      regions: TIKTOK_REGIONS,
      categories: TIKTOK_CATEGORIES,
      limits: OPERATIONAL_LIMITS,
      defaultGateCriteria: DEFAULT_GATE_CRITERIA,
      snapshots: store.listSnapshots(),
      settings: store.getSettings(),
    }
  }

  async function queryRank(args = {}) {
    return dataSource.queryRank(args)
  }

  async function searchProducts(args = {}) {
    return dataSource.searchProducts(args)
  }

  async function importSnapshot(args = {}) {
    return dataSource.importSnapshot(args)
  }

  async function getProductDetail(args = {}) {
    return dataSource.getProductDetail(args)
  }

  async function gateDryRun(args = {}) {
    return threeGate.dryRunEstimate(args)
  }

  async function createTask(args = {}) {
    const awaitCompletion = args.awaitCompletion !== false
    return threeGate.createAndRunTask(args.criteria || args, {
      estimate: args.estimate,
      awaitCompletion,
    })
  }

  async function listTasks(args = {}) {
    const tasks = store.listTasks(args)
    return { count: tasks.length, tasks }
  }

  async function getTask(args = {}) {
    const taskId = String(args.taskId || args.id || '').trim()
    if (!taskId) throw new SelectionError('invalid-request', 'taskId is required')
    const task = store.getTask(taskId)
    if (!task) throw new SelectionError('not-found', `Task ${taskId} not found`)
    return { task }
  }

  async function controlTask(args = {}) {
    const taskId = String(args.taskId || args.id || '').trim()
    const action = String(args.action || '').trim()
    if (!taskId) throw new SelectionError('invalid-request', 'taskId is required')
    if (action === 'stop') {
      return { ok: true, task: threeGate.stopTask(taskId) }
    }
    if (action === 'retry_incomplete') {
      return { ok: true, task: await threeGate.retryIncomplete(taskId) }
    }
    if (action === 'clone_run') {
      return { ok: true, task: await threeGate.cloneAndRun(taskId, { awaitCompletion: args.awaitCompletion !== false }) }
    }
    if (action === 'override_row') {
      const itemId = String(args.itemId || '').trim()
      const rowAction = String(args.rowAction || '').trim()
      if (!itemId) throw new SelectionError('invalid-request', 'itemId is required for override_row')
      if (rowAction === 'delete') {
        const denied = requireConfirm(args.confirm, '删除三闸判定明细记录')
        if (denied) return denied
      }
      const res = store.overrideGateItem(taskId, itemId, rowAction)
      return { ok: true, ...res, task: store.getTask(taskId) }
    }
    throw new SelectionError('invalid-request', `Unsupported task control action: ${action}`)
  }

  async function listLibrary(args = {}) {
    const items = store.listLibrary(args)
    return {
      count: items.length,
      revision: store.revision(),
      items,
    }
  }

  async function ingestProducts(args = {}) {
    const products = Array.isArray(args.products) ? args.products : args.product ? [args.product] : []
    return store.ingestProducts(products, {
      region: args.region,
      source: args.source || 'manual',
      rankPeriod: args.rankPeriod || '',
      sourceDetail: args.sourceDetail || '',
      sourceTaskId: args.sourceTaskId || '',
      checkRiskWords: args.checkRiskWords !== false,
    })
  }

  async function updateStatus(args = {}) {
    const mode = String(args.action || 'status')
    const ids = Array.isArray(args.ids) ? args.ids : args.id ? [args.id] : []
    if (mode === 'enrich_channel') {
      if (ids.length === 0) throw new SelectionError('invalid-request', 'ids array is required')
      const results = []
      for (const id of ids) {
        const item = store.getLibraryItem(id)
        if (!item) {
          results.push({ id, ok: false, error: 'not-found' })
          continue
        }
        const res = await dataSource.enrichChannelMetrics(item)
        if (res.ok && res.metrics) {
          store.updateLibraryItem(item.id, { channelMetrics: res.metrics })
          results.push({ id: item.id, productId: item.productId, ok: true, metrics: res.metrics })
        } else {
          results.push({ id: item.id, productId: item.productId, ok: false, error: res.code, message: res.message })
        }
      }
      return {
        total: results.length,
        succeeded: results.filter((r) => r.ok).length,
        results,
      }
    }
    return store.batchUpdateStatus(ids, args.selectionStatus, args.reviewNotes)
  }

  async function removeProducts(args = {}) {
    const denied = requireConfirm(args.confirm, '批量移除选品库商品')
    if (denied) return denied
    const ids = Array.isArray(args.ids) ? args.ids : args.id ? [args.id] : []
    return { ok: true, ...store.removeLibraryItems(ids) }
  }

  async function generateAssets(args = {}) {
    const kind = String(args.kind || '').trim()
    const productIds = Array.isArray(args.productIds) ? args.productIds : args.productId ? [args.productId] : []
    if (kind === 'script') {
      return assetsPipeline.generateVideoScript({
        productIds,
        extraSellingPoints: args.extraSellingPoints || '',
      })
    }
    if (kind === 'image') {
      return assetsPipeline.generateImages({
        productIds,
        countPerProduct: args.countPerProduct,
        skipExisting: args.skipExisting !== false,
        prompt: args.prompt || '',
        model: args.model || '',
      })
    }
    if (kind === 'video') {
      return assetsPipeline.generateVideos({
        productIds,
        countPerProduct: args.countPerProduct,
        skipExisting: args.skipExisting !== false,
        useExistingScript: args.useExistingScript !== false,
        prompt: args.prompt || '',
        model: args.model || '',
      })
    }
    if (kind === 'sync_omnimux_products') {
      return assetsPipeline.syncToOmnimuxProducts({ productIds })
    }
    throw new SelectionError('invalid-request', `Unsupported asset generation kind: ${kind}`)
  }

  async function manageSchedule(args = {}) {
    const action = String(args.action || 'list').trim()
    if (action === 'list') {
      const schedules = store.listSchedules()
      return { count: schedules.length, schedules }
    }
    if (action === 'create') {
      return { ok: true, schedule: store.createSchedule(args.schedule || args) }
    }
    if (action === 'update') {
      const id = String(args.id || '').trim()
      if (!id) throw new SelectionError('invalid-request', 'schedule id is required')
      return { ok: true, schedule: store.updateSchedule(id, args.patch || args) }
    }
    if (action === 'run_now') {
      const id = String(args.id || '').trim()
      if (!id) throw new SelectionError('invalid-request', 'schedule id is required')
      const run = await scheduler.runScheduleNow(id, 'manual')
      return { ok: true, run }
    }
    if (action === 'delete') {
      const denied = requireConfirm(args.confirm, '删除自动选品定时任务')
      if (denied) return denied
      const id = String(args.id || '').trim()
      if (!id) throw new SelectionError('invalid-request', 'schedule id is required')
      return { ok: true, ...store.removeSchedule(id) }
    }
    throw new SelectionError('invalid-request', `Unsupported schedule action: ${action}`)
  }

  async function listRuns(args = {}) {
    const runs = store.listRuns(args)
    return { count: runs.length, runs }
  }

  async function manageRiskWords(args = {}) {
    const action = String(args.action || 'list').trim()
    if (action === 'list') {
      const words = store.listRiskWords(args)
      return { count: words.length, words }
    }
    if (action === 'add') {
      return { ok: true, word: store.addRiskWord(args) }
    }
    if (action === 'batch_add') {
      const rawTerms = Array.isArray(args.terms) ? args.terms : String(args.terms || '').split(/[\n,，、]+/)
      const added = []
      const skipped = []
      for (const rawTerm of rawTerms) {
        const term = String(rawTerm || '').trim()
        if (!term) continue
        try {
          added.push(store.addRiskWord({ type: args.type, term, zhName: '', source: args.source || '批量导入', enabled: true }))
        } catch (err) {
          skipped.push({ term, reason: err?.message || 'duplicate' })
        }
      }
      return { ok: true, addedCount: added.length, skippedCount: skipped.length, added, skipped }
    }
    if (action === 'update') {
      const id = String(args.id || '').trim()
      if (!id) throw new SelectionError('invalid-request', 'risk word id is required')
      return { ok: true, word: store.updateRiskWord(id, args) }
    }
    if (action === 'delete') {
      const denied = requireConfirm(args.confirm, '删除风险词条')
      if (denied) return denied
      const id = String(args.id || '').trim()
      if (!id) throw new SelectionError('invalid-request', 'risk word id is required')
      return { ok: true, ...store.removeRiskWord(id) }
    }
    throw new SelectionError('invalid-request', `Unsupported risk word action: ${action}`)
  }

  async function manageSettings(args = {}) {
    const action = String(args.action || 'get').trim()
    if (action === 'get') {
      return {
        settings: store.getSettings(),
        limits: OPERATIONAL_LIMITS,
        capabilities: dataSource.getCapabilities(),
      }
    }
    if (action === 'update' || action === 'reset') {
      const patch = action === 'reset' ? { resetPrompts: true } : args.patch || args
      return {
        ok: true,
        settings: store.updateSettings(patch),
      }
    }
    throw new SelectionError('invalid-request', `Unsupported settings action: ${action}`)
  }

  return {
    getOverview,
    queryRank,
    searchProducts,
    importSnapshot,
    getProductDetail,
    gateDryRun,
    createTask,
    listTasks,
    getTask,
    controlTask,
    listLibrary,
    ingestProducts,
    updateStatus,
    removeProducts,
    generateAssets,
    manageSchedule,
    listRuns,
    manageRiskWords,
    manageSettings,
  }
}
