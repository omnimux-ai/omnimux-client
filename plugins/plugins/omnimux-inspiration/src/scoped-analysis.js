import { realpathSync, statSync } from 'node:fs'
import { basename, isAbsolute, relative, sep } from 'node:path'
import { analysisInputFingerprint, analysisMediaItems, sourceFingerprint } from './analysis-input.js'
export { analysisInputFingerprint, sourceFingerprint } from './analysis-input.js'
import {
  INSPIRATION_DECONSTRUCT_SKILL,
  INSPIRATION_TRANSLATE_SKILL,
} from './inspiration-skills.js'
import {
  DIRECTION_KEYS,
  INSPIRATION_ANALYSIS_SCHEMA,
  INSPIRATION_TRANSLATION_SCHEMA,
  buildAnalysisUserInput,
  buildTranslationUserInput,
  normalizeStructuredAnalysisResult,
} from './analysis-schema.js'

/** @typedef {{scope: 'post'|'body'|'media', media_index?: number, directions: Array<'content'|'expression'|'creative'>}} AnalysisSelection */
/** @typedef {{type: 'image'|'video', pathOrUrl: string}} AnalysisReference */

const OWNER_PLUGIN = 'omnimux-inspiration'
const VALID_DIRECTIONS = new Set(DIRECTION_KEYS)
const ACTIVE_JOB_STATUSES = new Set(['queued', 'running', 'repairing'])

/** @type {WeakMap<object, Map<string, { controller: AbortController }>>} */
const activeRuns = new WeakMap()

const fail = (status, error, data, key) => ({
  status,
  body: { error, ...(data ? { data, analysis_key: key } : {}) },
})

function resolveHeadlessSkill(ctx) {
  if (!ctx) return null
  if (typeof ctx.headlessSkill === 'function') return ctx.headlessSkill()
  if (ctx.headlessSkill) return ctx.headlessSkill
  if (typeof ctx.get === 'function') return ctx.get('headlessSkill')
  return null
}

function hasLiveHeadlessJob(headlessSkill, targetId) {
  if (!headlessSkill || typeof headlessSkill.listJobs !== 'function') return false
  try {
    const jobs = headlessSkill.listJobs({ ownerPlugin: OWNER_PLUGIN, targetId })
    return Array.isArray(jobs) && jobs.some((job) => ACTIVE_JOB_STATUSES.has(job?.status))
  } catch {
    return false
  }
}

function isScopeActive(store, itemId, key, headlessSkill) {
  const lock = `${itemId}:${key}`
  if (activeRuns.get(store)?.has(lock)) return true
  return hasLiveHeadlessJob(headlessSkill, lock)
}

/** A persisted running entry without an active executor was interrupted by a restart. */
export function recoverInterruptedAnalyses(store, item, headlessSkill = null) {
  let current = item
  for (const [key, entry] of Object.entries(item?.analysis_results || {})) {
    if (entry?.status !== 'running' || isScopeActive(store, item.id, key, headlessSkill)) continue
    current = store.updateAnalysis(item.id, key, {
      ...entry,
      status: 'failed',
      error: '分析已中断，请重新分析',
    })
  }
  return current
}

function cancelled(signal) {
  if (!signal?.aborted) return
  throw Object.assign(new Error('分析已取消'), { name: 'AbortError', code: 'ABORT_ERR' })
}

function linkAbortSignals(parentSignal) {
  const controller = new AbortController()
  const onAbort = () => controller.abort(parentSignal.reason)
  if (parentSignal) {
    if (parentSignal.aborted) controller.abort(parentSignal.reason)
    else parentSignal.addEventListener('abort', onAbort, { once: true })
  }
  return {
    controller,
    dispose() {
      parentSignal?.removeEventListener('abort', onAbort)
    },
  }
}

/** @param {Record<string, unknown>} body @returns {AnalysisSelection} */
function requestScope(body) {
  if (!['post', 'body', 'media'].includes(body.scope)) {
    throw Object.assign(new Error('分析范围无效'), { status: 400 })
  }
  if (body.scope === 'media' && (!Number.isInteger(body.media_index) || body.media_index < 0)) {
    throw Object.assign(new Error('请选择有效素材'), { status: 400 })
  }
  const directions = body.directions === undefined ? [...DIRECTION_KEYS] : body.directions
  if (!Array.isArray(directions) || !directions.length || directions.some((value) => !VALID_DIRECTIONS.has(value))) {
    throw Object.assign(new Error('请选择有效分析方向'), { status: 400 })
  }
  return {
    scope: body.scope,
    ...(body.scope === 'media' ? { media_index: body.media_index } : {}),
    directions: [...new Set(directions)],
  }
}

/** @returns {AnalysisReference | null} */
function resolveSavedReference(media, item, paths) {
  if (!['image', 'video'].includes(media?.type) || typeof media.url !== 'string') return null
  const match = media.url.match(/^\/omnimux\/inspiration\/local\/media\/(videos|images|covers)\/([^/?#]+)$/)
  if (!match) return null
  const isPhotoRecord = item.type !== 'video' && (
    ['image', 'photo', 'gallery'].includes(String(item.type || ''))
    || ['photo', 'gallery'].includes(String(item.content_shape || ''))
    || item.media_kind === 'image'
  )
  const coverPhoto = media.type === 'image' && match[1] === 'covers' && isPhotoRecord
  if (!coverPhoto && match[1] !== (media.type === 'video' ? 'videos' : 'images')) return null
  const root = coverPhoto ? paths?.coversDir : media.type === 'video' ? paths?.videosDir : paths?.imagesDir
  if (!root) return null
  for (const path of Object.values(item.local_paths || {})) {
    if (typeof path !== 'string' || basename(path) !== match[2]) continue
    try {
      const canonical = realpathSync(path)
      const rel = relative(realpathSync(root), canonical)
      const stat = statSync(canonical)
      if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel) || !stat.isFile()) continue
      return { type: media.type, pathOrUrl: canonical }
    } catch {
      // Missing or external files cannot become remote fallback inputs.
      continue
    }
  }
  return null
}

/**
 * Resolve every target and build Skill user input before submitting to Hub `headlessSkill`.
 * @param {Record<string, any>} item
 * @param {AnalysisSelection} selection
 * @param {Record<string, string>} paths
 */
export function prepareAnalysis(item, selection, paths) {
  const all = analysisMediaItems(item)
  if (selection.scope === 'media' && !all[selection.media_index]) {
    throw Object.assign(new Error('所选素材不存在'), { status: 400 })
  }
  const targets = selection.scope === 'body' ? [] : selection.scope === 'media' ? [all[selection.media_index]] : all
  /** @type {AnalysisReference[]} */
  const references = []
  let missing = 0
  for (const target of targets) {
    const resolved = resolveSavedReference(target, item, paths)
    if (resolved) references.push(resolved)
    else missing += 1
  }
  const body = String(item.content || '')
  const input_fingerprint = analysisInputFingerprint(item, selection)
  const input = buildAnalysisUserInput(item, selection, references)
  return {
    input_fingerprint,
    references,
    input,
    prompt: input,
    missing,
    empty: !body.trim() && !targets.length,
    body,
  }
}

/** Scope state is merged by the store, so other scopes cannot be overwritten. */
export async function handleScopedAnalysis(ctx, options = {}) {
  const item = ctx.store.get(ctx.id)
  if (!item) return fail(404, '灵感不存在')
  if (item.import_status === 'importing') return fail(422, '灵感正在导入，请等待完成后分析')
  let selection
  let prepared
  try {
    selection = requestScope(ctx.req.body || {})
    prepared = prepareAnalysis(item, selection, ctx.paths)
  } catch (error) {
    return fail(error.status || 400, error.message)
  }
  cancelled(ctx.signal)

  const key = selection.scope === 'media' ? `media:${selection.media_index}` : selection.scope
  let runs = activeRuns.get(ctx.store)
  if (!runs) {
    runs = new Map()
    activeRuns.set(ctx.store, runs)
  }
  const lock = `${ctx.id}:${key}`
  if (runs.has(lock)) return fail(409, '该范围正在分析，请稍候')

  const linked = linkAbortSignals(ctx.signal)
  const runToken = Symbol('analysis-run')
  runs.set(lock, { controller: linked.controller, token: runToken })

  const previous = item.analysis_results?.[key]
  const prior = previous?.input_fingerprint === prepared.input_fingerprint ? previous : null
  const entry = {
    ...selection,
    input_fingerprint: prepared.input_fingerprint,
    status: 'running',
    source: prior?.source || 'legacy_unknown',
    model: prior?.model || '',
    result: prior?.result || null,
    error: null,
    error_code: null,
    started_at: new Date().toISOString(),
    analyzed_at: prior?.analyzed_at || null,
  }

  try {
    ctx.store.updateAnalysis(ctx.id, key, entry)
    if (prepared.missing) {
      const row = ctx.store.updateAnalysis(ctx.id, key, {
        ...entry,
        status: 'partial',
        error: '部分素材尚未保存或文件已不可用，未进行不完整的整帖分析',
      })
      return fail(422, row.analysis_results[key].error, row, key)
    }
    if (prepared.empty || (selection.scope === 'body' && !prepared.body.trim())) {
      throw Object.assign(new Error('暂无完整正文可分析'), { status: 422 })
    }

    let result
    let modelUsed = ''
    let jobId = null

    if (options.execute) {
      const response = await options.execute(prepared)
      cancelled(linked.controller.signal)
      if (response?.mode !== 'live' || (!response.result && (typeof response.text !== 'string' || !response.text.trim()))) {
        throw new Error('分析未返回真实有效结果，请重试')
      }
      result = response.result || normalizeStructuredAnalysisResult({
        summary: response.text.trim().slice(0, 240),
        sections: [],
        shots: [],
      }, selection)
      modelUsed = response.model || ''
    } else {
      const headlessSkill = resolveHeadlessSkill(ctx)
      if (!headlessSkill || typeof headlessSkill.run !== 'function') {
        throw Object.assign(
          new Error('无头技能执行引擎 (headlessSkill) 未就绪，请检查 omnimux 执行中枢插件是否加载'),
          { status: 503, code: 'headless-skill-unavailable' },
        )
      }
      const runResult = await headlessSkill.run({
        skillName: INSPIRATION_DECONSTRUCT_SKILL,
        input: prepared.input,
        references: prepared.references,
        outputSchema: INSPIRATION_ANALYSIS_SCHEMA,
        label: `拆解灵感：${item.title || item.id}`,
        ownerPlugin: OWNER_PLUGIN,
        targetId: lock,
        inputFingerprint: prepared.input_fingerprint,
        verifyFingerprint: () => {
          const latest = ctx.store.get(ctx.id)
          if (!latest) return false
          return prepareAnalysis(latest, selection, ctx.paths).input_fingerprint === prepared.input_fingerprint
        },
        maxTokens: 4096,
        signal: linked.controller.signal,
      })
      cancelled(linked.controller.signal)
      if (runResult?.mode !== 'live' || !runResult.data || typeof runResult.data !== 'object') {
        throw new Error('分析未返回真实有效结果，请重试')
      }
      result = normalizeStructuredAnalysisResult(runResult.data, selection)
      modelUsed = runResult.model || ''
      jobId = runResult.jobId || null
    }

    if (runs.get(lock)?.token !== runToken) {
      throw Object.assign(new Error('分析已取消'), { name: 'AbortError', code: 'ABORT_ERR' })
    }
    const current = ctx.store.get(ctx.id)
    if (!current) return fail(404, '灵感已删除')
    if (prepareAnalysis(current, selection, ctx.paths).input_fingerprint !== prepared.input_fingerprint) {
      const row = ctx.store.updateAnalysis(ctx.id, key, {
        ...entry,
        status: 'partial',
        result: null,
        error_code: 'headless-skill-stale-input',
        error: '分析期间原始内容已变更，请重新分析',
      })
      return fail(409, row.analysis_results[key].error, row, key)
    }

    const row = ctx.store.updateAnalysis(ctx.id, key, {
      ...entry,
      status: 'done',
      source: 'live',
      model: modelUsed,
      ...(jobId ? { job_id: jobId } : {}),
      result,
      error: null,
      error_code: null,
      analyzed_at: new Date().toISOString(),
    })
    const updated = options.mirrorLegacy ? ctx.store.update(ctx.id, { deconstruction: result }) : row
    return {
      status: 200,
      body: {
        data: updated,
        analysis_key: key,
        ...(jobId ? { job_id: jobId } : {}),
      },
    }
  } catch (error) {
    const stillOwner = runs.get(lock)?.token === runToken
    if (error?.code === 'headless-skill-stale-input') {
      const current = ctx.store.get(ctx.id)
      if (!current) return fail(404, '灵感已删除')
      if (!stillOwner) {
        throw Object.assign(new Error('分析已取消'), { name: 'AbortError', code: 'ABORT_ERR' })
      }
      const row = ctx.store.updateAnalysis(ctx.id, key, {
        ...entry,
        status: 'partial',
        result: null,
        error_code: 'headless-skill-stale-input',
        error: '分析期间原始内容已变更，请重新分析',
      })
      return fail(409, row.analysis_results[key].error, row, key)
    }
    const aborted = linked.controller.signal.aborted
      || ctx.signal?.aborted
      || error?.name === 'AbortError'
      || error?.code === 'ABORT_ERR'
      || error?.code === 'headless-skill-cancelled'
    const current = ctx.store.get(ctx.id)
    const errorCode = aborted ? 'analysis-cancelled' : (typeof error?.code === 'string' ? error.code : null)
    const message = aborted
      ? '分析已取消，可重新分析'
      : (ctx.formatErrorMessage?.(error) || error?.message || String(error))
    // Only write failure state if this run still owns the lock. If handleCancelAnalysis
    // already released the lock, it synchronously settled the cancelled entry and a newer
    // run may already have started or finished (even within the same millisecond).
    const row = current && stillOwner
      ? ctx.store.updateAnalysis(ctx.id, key, {
        ...entry,
        status: 'failed',
        error_code: errorCode,
        error: message,
      })
      : current || null
    if (aborted) {
      throw Object.assign(new Error('分析已取消'), { name: 'AbortError', code: 'ABORT_ERR' })
    }
    const status = error?.status
      || (error?.code === 'headless-skill-transport-exceeded' ? 422 : null)
      || (error?.code === 'headless-skill-transport-unavailable' ? 503 : null)
      || 502
    return fail(status, row?.analysis_results?.[key]?.error || message || '分析失败，请重试', row, key)
  } finally {
    linked.dispose()
    if (runs.get(lock)?.token === runToken) runs.delete(lock)
  }
}

/**
 * Cancel in-flight headless analysis jobs for an inspiration item (optionally narrowed to a scope or job_id).
 * Enforces strict item + plugin ownership before cancelling any explicit `job_id`.
 */
export async function handleCancelAnalysis(ctx) {
  const item = ctx.store.get(ctx.id)
  if (!item) return fail(404, '灵感不存在')

  const body = ctx.req?.body && typeof ctx.req.body === 'object' ? ctx.req.body : {}
  let targetKey = ''
  if (typeof body.scope === 'string' && body.scope) {
    targetKey = body.scope === 'media' && Number.isInteger(body.media_index)
      ? `media:${body.media_index}`
      : body.scope
  }
  const targetPrefix = targetKey ? `${ctx.id}:${targetKey}` : `${ctx.id}:`
  const cancelledTargets = []
  const settledKeys = new Set()
  const runs = activeRuns.get(ctx.store)
  const headlessSkill = resolveHeadlessSkill(ctx)
  const requestedJobId = typeof body.job_id === 'string' ? body.job_id.trim() : ''

  if (requestedJobId) {
    let job = null
    if (headlessSkill && typeof headlessSkill.getJob === 'function') {
      job = headlessSkill.getJob(requestedJobId) || null
    } else if (headlessSkill && typeof headlessSkill.listJobs === 'function') {
      const jobs = headlessSkill.listJobs({ ownerPlugin: OWNER_PLUGIN }) || []
      job = jobs.find((entry) => entry?.jobId === requestedJobId) || null
    }
    const jobTargetId = String(job?.targetId || '')
    const ownedByPlugin = job?.ownerPlugin === OWNER_PLUGIN
    const belongsToTarget = targetKey ? jobTargetId === targetPrefix : jobTargetId.startsWith(targetPrefix)
    if (!job || !ownedByPlugin || !belongsToTarget) {
      return fail(403, '无权取消非当前灵感的分析任务')
    }
    // Only cancel and settle if the named job is still active; a finished historical job_id
    // must not abort a newer run on the same scope.
    if (ACTIVE_JOB_STATUSES.has(job.status)) {
      if (typeof headlessSkill?.cancel === 'function' && headlessSkill.cancel(requestedJobId)) {
        cancelledTargets.push(requestedJobId)
      }
      if (runs?.has(jobTargetId)) {
        const handle = runs.get(jobTargetId)
        runs.delete(jobTargetId)
        handle.controller.abort(Object.assign(new Error('分析已取消'), { name: 'AbortError', code: 'ABORT_ERR' }))
        cancelledTargets.push(jobTargetId)
      }
      const scopeKey = jobTargetId.slice(`${ctx.id}:`.length)
      if (scopeKey && !scopeKey.startsWith('translate:')) settledKeys.add(scopeKey)
    }
  } else {
    if (runs) {
      for (const [lock, handle] of [...runs.entries()]) {
        const matched = targetKey ? lock === targetPrefix : lock.startsWith(targetPrefix)
        if (!matched) continue
        // Release lock before aborting so an immediate user retry never hits a 409 lock window.
        runs.delete(lock)
        handle.controller.abort(Object.assign(new Error('分析已取消'), { name: 'AbortError', code: 'ABORT_ERR' }))
        cancelledTargets.push(lock)
        const scopeKey = lock.slice(`${ctx.id}:`.length)
        if (scopeKey) settledKeys.add(scopeKey)
      }
    }

    if (headlessSkill && typeof headlessSkill.cancel === 'function' && typeof headlessSkill.listJobs === 'function') {
      const jobs = headlessSkill.listJobs({ ownerPlugin: OWNER_PLUGIN }) || []
      for (const job of jobs) {
        if (!ACTIVE_JOB_STATUSES.has(job?.status)) continue
        const targetId = String(job.targetId || '')
        const matched = targetKey ? targetId === targetPrefix : targetId.startsWith(targetPrefix)
        if (!matched) continue
        if (headlessSkill.cancel(job.jobId)) {
          cancelledTargets.push(job.jobId)
          const scopeKey = targetId.slice(`${ctx.id}:`.length)
          if (scopeKey && !scopeKey.startsWith('translate:')) settledKeys.add(scopeKey)
        }
      }
    }
  }

  // Synchronously settle cancelled scopes in the store so the response never returns stale `running`.
  const latestItem = ctx.store.get(ctx.id)
  if (latestItem?.analysis_results) {
    for (const scopeKey of settledKeys) {
      const currentEntry = latestItem.analysis_results[scopeKey]
      if (currentEntry?.status !== 'running') continue
      ctx.store.updateAnalysis(ctx.id, scopeKey, {
        ...currentEntry,
        status: 'failed',
        error_code: 'analysis-cancelled',
        error: '分析已取消，可重新分析',
      })
    }
  }

  return {
    status: 200,
    body: {
      ok: true,
      cancelled: [...new Set(cancelledTargets)],
      data: ctx.store.get(ctx.id),
    },
  }
}

/**
 * Run single-video structured deconstruction through Hub `headlessSkill` (used by
 * background/sync URL import `auto_analyze: true` so every production AI path
 * shares the same Skill + JSON Schema contract).
 *
 * @param {{
 *   headlessSkill: { run: Function },
 *   item: Record<string, any>,
 *   videoPath: string,
 *   mediaIndex?: number,
 *   targetId?: string,
 *   signal?: AbortSignal,
 *   formatErrorMessage?: (err: unknown) => string,
 * }} deps
 * @returns {Promise<{ deconstruction: Record<string, any> | null, error: string }>}
 */
export async function runHeadlessVideoDeconstruct({
  headlessSkill,
  item,
  videoPath,
  mediaIndex = 0,
  targetId,
  signal,
  formatErrorMessage,
}) {
  if (!videoPath || !headlessSkill || typeof headlessSkill.run !== 'function') {
    return { deconstruction: null, error: '无头技能执行引擎 (headlessSkill) 未就绪' }
  }
  const selection = { scope: 'media', media_index: mediaIndex, directions: [...DIRECTION_KEYS] }
  const references = [{ type: 'video', pathOrUrl: videoPath }]
  const input = buildAnalysisUserInput(item, selection, references)
  try {
    cancelled(signal)
    const runResult = await headlessSkill.run({
      skillName: INSPIRATION_DECONSTRUCT_SKILL,
      input,
      references,
      outputSchema: INSPIRATION_ANALYSIS_SCHEMA,
      label: `拆解灵感：${item?.title || item?.id || '视频'}`,
      ownerPlugin: OWNER_PLUGIN,
      targetId: targetId || `${item?.id || 'import'}:media:${mediaIndex}`,
      maxTokens: 4096,
      signal,
    })
    cancelled(signal)
    if (runResult?.mode !== 'live' || !runResult.data || typeof runResult.data !== 'object') {
      return { deconstruction: null, error: 'AI 视频拆解未返回真实有效结果，请重试' }
    }
    const normalized = normalizeStructuredAnalysisResult(runResult.data, selection)
    return {
      deconstruction: {
        ...normalized,
        source: 'live',
        model: runResult.model || '',
        ...(runResult.jobId ? { job_id: runResult.jobId } : {}),
        analyzed_at: new Date().toISOString(),
      },
      error: '',
    }
  } catch (error) {
    if (signal?.aborted || error?.name === 'AbortError' || error?.code === 'ABORT_ERR' || error?.code === 'headless-skill-cancelled') {
      throw Object.assign(new Error('分析已取消'), { name: 'AbortError', code: 'ABORT_ERR' })
    }
    return {
      deconstruction: null,
      error: formatErrorMessage?.(error) || error?.message || 'AI 视频拆解失败，请确保大模型视觉分析服务可用',
    }
  }
}

/** Body translation never reads the generated script or overwrites its translation. */
export async function handleBodyTranslation(ctx) {
  const item = ctx.store.get(ctx.id)
  if (!item) return fail(404, '灵感不存在')
  const source = String(item.content || '')
  if (!source.trim()) return fail(422, '暂无完整正文可翻译')
  const headlessSkill = resolveHeadlessSkill(ctx)
  if (!headlessSkill || typeof headlessSkill.run !== 'function') {
    return fail(503, '无头技能执行引擎 (headlessSkill) 未就绪')
  }
  const lang = String(ctx.req.body?.lang || ctx.req.body?.target || 'zh').trim() || 'zh'
  const fingerprint = sourceFingerprint(source)
  try {
    cancelled(ctx.signal)
    const runResult = await headlessSkill.run({
      skillName: INSPIRATION_TRANSLATE_SKILL,
      input: buildTranslationUserInput({ lang, source, segmentIds: [] }),
      outputSchema: INSPIRATION_TRANSLATION_SCHEMA,
      modality: 'text',
      label: `翻译灵感正文：${item.title || item.id}`,
      ownerPlugin: OWNER_PLUGIN,
      targetId: `${ctx.id}:translate:body`,
      inputFingerprint: fingerprint,
      verifyFingerprint: () => {
        const latest = ctx.store.get(ctx.id)
        if (!latest) return false
        return sourceFingerprint(String(latest.content || '')) === fingerprint
      },
      maxTokens: 4096,
      signal: ctx.signal,
    })
    cancelled(ctx.signal)
    if (runResult?.mode !== 'live' || !runResult.data || typeof runResult.data.text !== 'string' || !runResult.data.text.trim()) {
      throw new Error('正文翻译未返回真实有效结果')
    }
    const current = ctx.store.get(ctx.id)
    if (!current) return fail(404, '灵感已删除')
    if (sourceFingerprint(String(current.content || '')) !== fingerprint) {
      return fail(409, '正文已变更，请重新翻译')
    }
    const row = ctx.store.update(ctx.id, {
      body_translation: {
        lang,
        text: runResult.data.text.trim(),
        source_fingerprint: fingerprint,
        source: 'live',
        model: runResult.model || '',
        translated_at: new Date().toISOString(),
      },
    })
    return { status: 200, body: { data: row } }
  } catch (error) {
    if (error?.code === 'headless-skill-stale-input') {
      if (!ctx.store.get(ctx.id)) return fail(404, '灵感已删除')
      return fail(409, '正文已变更，请重新翻译')
    }
    cancelled(ctx.signal)
    if (error?.name === 'AbortError' || error?.code === 'ABORT_ERR' || error?.code === 'headless-skill-cancelled') {
      throw Object.assign(new Error('翻译已取消'), { name: 'AbortError', code: 'ABORT_ERR' })
    }
    return fail(502, ctx.formatErrorMessage?.(error) || error?.message || String(error))
  }
}

function scriptTranslationInputs(item, lang) {
  const analysis = item?.deconstruction && typeof item.deconstruction === 'object'
    ? item.deconstruction
    : (item?.analysis_results?.post?.result || {})
  const segments = Array.isArray(analysis.segments) ? analysis.segments : []
  const source = segments.length
    ? segments.map((row) => row.text).filter(Boolean).join('\n')
    : (item?.content || '')
  const segmentIds = segments.map((row) => row.id)
  const fingerprint = sourceFingerprint(`${lang}\n${JSON.stringify(segmentIds)}\n${source}`)
  return { segments, segmentIds, source, fingerprint }
}

/** Script / segment translation routed through Hub `headlessSkill`. */
export async function handleScriptTranslation(ctx) {
  const item = ctx.store.get(ctx.id)
  if (!item) return fail(404, 'not found')
  const lang = String(ctx.req.body?.lang || ctx.req.body?.target || 'zh').trim() || 'zh'
  const { segmentIds, source, fingerprint } = scriptTranslationInputs(item, lang)
  if (!source.trim()) return fail(422, '暂无脚本文案可翻译')
  const headlessSkill = resolveHeadlessSkill(ctx)
  if (!headlessSkill || typeof headlessSkill.run !== 'function') {
    return fail(503, '无头技能执行引擎 (headlessSkill) 未就绪')
  }
  try {
    cancelled(ctx.signal)
    const runResult = await headlessSkill.run({
      skillName: INSPIRATION_TRANSLATE_SKILL,
      input: buildTranslationUserInput({
        lang,
        source,
        segmentIds,
      }),
      outputSchema: INSPIRATION_TRANSLATION_SCHEMA,
      modality: 'text',
      label: `翻译灵感脚本：${item.title || item.id}`,
      ownerPlugin: OWNER_PLUGIN,
      targetId: `${ctx.id}:translate:script`,
      inputFingerprint: fingerprint,
      verifyFingerprint: () => {
        const latest = ctx.store.get(ctx.id)
        if (!latest) return false
        return scriptTranslationInputs(latest, lang).fingerprint === fingerprint
      },
      maxTokens: 2048,
      signal: ctx.signal,
    })
    cancelled(ctx.signal)
    if (runResult?.mode !== 'live' || !runResult.data || typeof runResult.data.text !== 'string' || !runResult.data.text.trim()) {
      throw new Error('脚本翻译未返回真实有效结果')
    }
    const current = ctx.store.get(ctx.id)
    if (!current) return fail(404, '灵感已删除')
    if (scriptTranslationInputs(current, lang).fingerprint !== fingerprint) {
      return fail(409, '脚本内容已变更，请重新翻译')
    }
    const updated = ctx.store.update(ctx.id, {
      script_translation: {
        lang,
        text: runResult.data.text.trim(),
        segments: Array.isArray(runResult.data.segments) ? runResult.data.segments : [],
        source_fingerprint: fingerprint,
        source: 'live',
        model: runResult.model || '',
        translated_at: new Date().toISOString(),
      },
    })
    return { status: 200, body: { data: updated } }
  } catch (error) {
    if (error?.code === 'headless-skill-stale-input') {
      if (!ctx.store.get(ctx.id)) return fail(404, '灵感已删除')
      return fail(409, '脚本内容已变更，请重新翻译')
    }
    cancelled(ctx.signal)
    if (error?.name === 'AbortError' || error?.code === 'ABORT_ERR' || error?.code === 'headless-skill-cancelled') {
      throw Object.assign(new Error('翻译已取消'), { name: 'AbortError', code: 'ABORT_ERR' })
    }
    return fail(502, ctx.formatErrorMessage?.(error) || error?.message || String(error))
  }
}
