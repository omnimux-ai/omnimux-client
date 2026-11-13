#!/usr/bin/env node

import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { pathToFileURL } from 'node:url'
const SCHEMA = 'omnimux.inspiration-cover-repair/v1'
const TIMEOUT_MS = 15_000
const OMIT_AFTER_PATCH = new Set(['cover_key', 'cover_url', 'updated_at'])
function now(deps) { return (deps.now || (() => new Date().toISOString()))() }

function dataOf(body, label) {
  if (!body || typeof body !== 'object' || body.success === false || !body.data || typeof body.data !== 'object') {
    throw new Error(`${label} returned an invalid response`)
  }
  return body.data
}

async function request(url, init, deps) { return deps.fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) }) }

async function jsonRequest(url, init, deps, label) {
  const response = await request(url, init, deps)
  let body
  try {
    body = await response.json()
  } catch {
    throw new Error(`${label} returned non-JSON HTTP ${response.status}`)
  }
  if (!response.ok) throw new Error(`${label} failed with HTTP ${response.status}: ${JSON.stringify(body)}`)
  return body
}

function hostPath(host, path) { return new URL(path, `${host}/`).toString() }

async function getRecord(host, id, deps) {
  const body = await jsonRequest(hostPath(host, `/omnimux/inspiration/${encodeURIComponent(id)}`), { method: 'GET' }, deps, `GET inspiration ${id}`)
  const record = dataOf(body, `GET inspiration ${id}`)
  if (String(record.id) !== String(id)) throw new Error(`GET inspiration ${id} returned record id ${String(record.id)}`)
  return record
}

function canonicalTikTokUrl(sourceUrl) {
  const url = new URL(String(sourceUrl || ''))
  if (!/(^|\.)tiktok\.com$/i.test(url.hostname)) throw new Error(`source_url is not TikTok: ${sourceUrl}`)
  url.search = ''
  url.hash = ''
  return url.toString()
}

async function freshThumbnail(sourceUrl, deps) {
  const canonicalUrl = canonicalTikTokUrl(sourceUrl)
  const oembedUrl = `https://www.tiktok.com/oembed?url=${encodeURIComponent(canonicalUrl)}`
  const oembed = await jsonRequest(oembedUrl, { method: 'GET' }, deps, `TikTok oEmbed ${canonicalUrl}`)
  const thumbnailUrl = typeof oembed.thumbnail_url === 'string' ? oembed.thumbnail_url : ''
  if (!/^https?:\/\//i.test(thumbnailUrl)) throw new Error(`TikTok oEmbed has no thumbnail_url for ${canonicalUrl}`)
  const image = await request(thumbnailUrl, { method: 'GET' }, deps)
  const contentType = image.headers.get('content-type') || ''
  if (!image.ok || !contentType.toLowerCase().startsWith('image/')) {
    throw new Error(`thumbnail probe failed with HTTP ${image.status} and content-type ${contentType || '(missing)'}`)
  }
  if (image.body && typeof image.body.cancel === 'function') await image.body.cancel()
  return {
    canonical_url: canonicalUrl,
    thumbnail_url: thumbnailUrl,
    http_status: image.status,
    content_type: contentType,
    content_length: image.headers.get('content-length') || null,
  }
}

function comparable(value) {
  if (Array.isArray(value)) return value.map((entry) => comparable(entry))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, comparable(value[key])]))
}

function same(left, right, omitted) {
  const select = (value) => omitted && value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).filter(([key]) => !omitted.has(key)))
    : value
  return JSON.stringify(comparable(select(left))) === JSON.stringify(comparable(select(right)))
}

function assertOriginal(current, original, id) { if (!same(current, original)) throw new Error(`conflict: inspiration ${id} changed since planning`) }

function assertNonMedia(current, original, id) { if (!same(current, original, OMIT_AFTER_PATCH)) throw new Error(`verification failed: non-media fields changed for inspiration ${id}`) }

function validKey(key) {
  return typeof key === 'string' && /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(key) && !key.split('/').includes('..') && !/^https?:/i.test(key)
}

function mediaPath(host, key) { return hostPath(host, `/omnimux/inspiration/media/${key.split('/').map(encodeURIComponent).join('/')}`) }

async function verifyUploaded(host, upload, deps) {
  if (!validKey(upload.key)) throw new Error('media upload returned an unsafe or non-persistent key')
  if (!String(upload.content_type || '').toLowerCase().startsWith('image/') || !(Number(upload.size) > 0)) {
    throw new Error('media upload did not return a non-empty image')
  }
  const response = await request(mediaPath(host, upload.key), { method: 'GET' }, deps)
  const type = response.headers.get('content-type') || ''
  const bytes = response.ok ? (await response.arrayBuffer()).byteLength : 0
  if (!response.ok || !type.toLowerCase().startsWith('image/') || bytes === 0) {
    throw new Error(`uploaded media verification failed with HTTP ${response.status}, content-type ${type || '(missing)'}, bytes ${bytes}`)
  }
}

function readPlan(file) {
  const document = JSON.parse(readFileSync(file, 'utf8'))
  if (document.schema !== SCHEMA || !document.plan || !document.state || !Array.isArray(document.plan.ids)) {
    throw new Error('invalid repair plan file')
  }
  return document
}

function writePlan(file, document, create = false) {
  if (create && existsSync(file)) throw new Error(`refusing to overwrite existing plan: ${file}`)
  const temp = join(dirname(file), `.${file.split('/').at(-1)}.${process.pid}.tmp`)
  writeFileSync(temp, `${JSON.stringify(document, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  chmodSync(temp, 0o600)
  renameSync(temp, file)
  chmodSync(file, 0o600)
}

function validateScope(document, options = {}) {
  const host = String(document.plan.host || '').replace(/\/$/, '')
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(host)) throw new Error(`plan host must be explicit loopback HTTP: ${host}`)
  if (options.host && String(options.host).replace(/\/$/, '') !== host) throw new Error('provided host does not match the plan')
  if (options.ids && JSON.stringify(options.ids.map(String)) !== JSON.stringify(document.plan.ids.map(String))) {
    throw new Error('provided ids do not exactly match the plan')
  }
  if (new Set(document.plan.ids.map(String)).size !== document.plan.ids.length) throw new Error('plan ids must be unique')
  for (const id of document.plan.ids) {
    if (!/^[1-9]\d*$/.test(String(id))) throw new Error(`plan contains invalid positive numeric id: ${String(id)}`)
    if (!document.plan.items[String(id)] || !document.state.items[String(id)]) throw new Error(`plan is missing explicit id ${id}`)
  }
  return host
}

const defaultDeps = { fetch: globalThis.fetch }

export async function planRepair({ host, ids, file }, deps = defaultDeps) {
  host = String(host || '').replace(/\/$/, '')
  if (!isAbsolute(file)) throw new Error('--file must be an absolute path')
  if (existsSync(file)) throw new Error(`refusing to overwrite existing plan: ${file}`)
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(host)) throw new Error('--host must be explicit loopback HTTP')
  if (!Array.isArray(ids) || ids.length === 0 || new Set(ids.map(String)).size !== ids.length || ids.some((id) => !/^[1-9]\d*$/.test(String(id)))) {
    throw new Error('--ids must contain unique positive numeric ids')
  }
  const items = {}
  const states = {}
  for (const rawId of ids) {
    const id = String(rawId)
    const record = await getRecord(host, id, deps)
    const candidate = await freshThumbnail(record.source_url, deps)
    items[id] = { record, original_cover_key: record.cover_key ?? null, candidate: { ...candidate, checked_at: now(deps) } }
    states[id] = { status: 'planned', upload: null, applied_at: null, rolled_back_at: null, last_error: null }
  }
  const document = { schema: SCHEMA, plan: { created_at: now(deps), host, ids: ids.map(String), items }, state: { phase: 'planned', items: states, failure: null } }
  writePlan(file, document, true)
  return document
}

async function patchCover(host, id, coverKey, deps) {
  const body = await jsonRequest(hostPath(host, `/omnimux/inspiration/${encodeURIComponent(id)}`), {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cover_key: coverKey }),
  }, deps, `PATCH inspiration ${id}`)
  return dataOf(body, `PATCH inspiration ${id}`)
}

function markFailure(document, itemState, id, error, deps) {
  const message = error instanceof Error ? error.message : String(error)
  itemState.last_error = { at: now(deps), message }
  document.state.phase = 'failed'
  document.state.failure = { id, ...itemState.last_error }
}

export async function applyRepair({ file, host: expectedHost, ids: expectedIds }, deps = defaultDeps) {
  const document = readPlan(file)
  const host = validateScope(document, { host: expectedHost, ids: expectedIds })
  for (const id of document.plan.ids) {
    const item = document.plan.items[id]
    const state = document.state.items[id]
    try {
      let current = await getRecord(host, id, deps)
      if (state.upload && current.cover_key === state.upload.key) {
        await verifyUploaded(host, state.upload, deps)
        assertNonMedia(current, item.record, id)
        state.status = 'applied'
        state.applied_at ||= now(deps)
        state.last_error = null
        writePlan(file, document)
        continue
      }
      if (state.status === 'applied') throw new Error(`conflict: inspiration ${id} no longer has its applied cover key`)
      assertOriginal(current, item.record, id)
      if (!state.upload) {
        const fresh = await freshThumbnail(current.source_url, deps)
        const body = await jsonRequest(hostPath(host, '/omnimux/inspiration/media'), {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: fresh.thumbnail_url, kind: 'cover' }),
        }, deps, `upload cover for inspiration ${id}`)
        const upload = dataOf(body, `upload cover for inspiration ${id}`)
        state.upload = { ...upload, source_url: fresh.thumbnail_url, uploaded_at: now(deps) }
        state.status = 'uploaded_unverified'
        state.last_error = null
        writePlan(file, document)
        await verifyUploaded(host, state.upload, deps)
        state.status = 'uploaded'
        writePlan(file, document)
      } else {
        await verifyUploaded(host, state.upload, deps)
      }
      current = await getRecord(host, id, deps)
      assertOriginal(current, item.record, id)
      await patchCover(host, id, state.upload.key, deps)
      const verified = await getRecord(host, id, deps)
      if (verified.cover_key !== state.upload.key) throw new Error(`verification failed: cover_key was not applied for inspiration ${id}`)
      assertNonMedia(verified, item.record, id)
      state.status = 'applied'
      state.applied_at = now(deps)
      state.last_error = null
      writePlan(file, document)
    } catch (error) {
      markFailure(document, state, id, error, deps)
      writePlan(file, document)
      throw error
    }
  }
  document.state.phase = 'applied'
  document.state.failure = null
  writePlan(file, document)
  return document
}

export async function rollbackRepair({ file, host: expectedHost, ids: expectedIds }, deps = defaultDeps) {
  const document = readPlan(file)
  const host = validateScope(document, { host: expectedHost, ids: expectedIds })
  for (const id of [...document.plan.ids].reverse()) {
    const item = document.plan.items[id]
    const state = document.state.items[id]
    try {
      let current = await getRecord(host, id, deps)
      if (current.cover_key === item.original_cover_key) {
        assertNonMedia(current, item.record, id)
        state.status = 'rolled_back'
        state.rolled_back_at ||= now(deps)
        writePlan(file, document)
        continue
      }
      if (!state.upload || current.cover_key !== state.upload.key) throw new Error(`conflict: inspiration ${id} does not have the applied cover key`)
      assertNonMedia(current, item.record, id)
      current = await getRecord(host, id, deps)
      if (current.cover_key !== state.upload.key) throw new Error(`conflict: inspiration ${id} changed before rollback`)
      assertNonMedia(current, item.record, id)
      await patchCover(host, id, item.original_cover_key, deps)
      const verified = await getRecord(host, id, deps)
      if (verified.cover_key !== item.original_cover_key) throw new Error(`rollback verification failed for inspiration ${id}`)
      assertNonMedia(verified, item.record, id)
      state.status = 'rolled_back'
      state.rolled_back_at = now(deps)
      state.last_error = null
      writePlan(file, document)
    } catch (error) {
      markFailure(document, state, id, error, deps)
      writePlan(file, document)
      throw error
    }
  }
  document.state.phase = 'rolled_back'
  document.state.failure = null
  writePlan(file, document)
  return document
}

function parseArgs(argv) {
  const [mode, ...rest] = argv
  if (!['plan', 'apply', 'rollback'].includes(mode)) throw new Error('usage: repair-inspiration-covers.mjs <plan|apply|rollback> --file ABSOLUTE [--host URL] [--ids 145,146]')
  const values = {}
  for (let i = 0; i < rest.length; i += 2) {
    if (!rest[i]?.startsWith('--') || rest[i + 1] == null) throw new Error(`invalid argument: ${rest[i] || '(missing)'}`)
    values[rest[i].slice(2)] = rest[i + 1]
  }
  if (!values.file || !isAbsolute(values.file)) throw new Error('--file must be an absolute path')
  const ids = values.ids ? values.ids.split(',').map((id) => id.trim()).filter(Boolean) : undefined
  if (mode === 'plan' && (!values.host || !ids?.length)) throw new Error('plan requires --host and --ids')
  return { mode, file: values.file, host: values.host, ids }
}

export async function runCli(argv, deps = defaultDeps) {
  const args = parseArgs(argv)
  const document = args.mode === 'plan' ? await planRepair(args, deps) : args.mode === 'apply' ? await applyRepair(args, deps) : await rollbackRepair(args, deps)
  return { mode: args.mode, phase: document.state.phase, ids: document.plan.ids }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli(process.argv.slice(2)).then((result) => console.log(JSON.stringify(result))).catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error))
    process.exitCode = 1
  })
}
