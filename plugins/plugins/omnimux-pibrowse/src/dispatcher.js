import { PINNED_UPSTREAM, UPSTREAM_MCP_TOOL_NAMES } from './constants.js'
import { PibrowseError, normalizeCoreLaunchError } from './errors.js'
import { validateUserPath } from './paths.js'
import {
  getPlatformInfo,
  probeCoreInstallation,
  probeWidevineCdm,
  resolveAgentBinary,
} from './platform.js'
import { redactAny, redactProfile, redactProxy, toLosslessJson } from './redact.js'

function requireConfirm(confirm, actionLabel) {
  if (confirm !== true) {
    return {
      ok: false,
      error: 'confirmation-required',
      message: `Destructive operation "${actionLabel}" requires explicit confirm: true`,
    }
  }
  return null
}

function asArray(val, field) {
  if (Array.isArray(val)) return val
  if (val && typeof val === 'object' && Array.isArray(val[field])) return val[field]
  return []
}

function cleanOptionalId(val) {
  if (typeof val !== 'string') return null
  const trimmed = val.trim()
  if (!trimmed || trimmed === 'all') return null
  return trimmed
}

/**
 * Choose a default Persona ID matching the current host OS when the user leaves
 * Persona as default/random on single-profile creation.
 */
function pickDefaultPersonaId(personas, platform = process.platform) {
  const list = asArray(personas, 'personas').filter((p) => p && typeof p.id === 'string' && p.id.trim())
  if (list.length === 0) return ''
  const want = platform === 'darwin' ? /mac/i : platform === 'win32' ? /win/i : /linux/i
  const match = list.find((p) => want.test(String(p.os || p.id)))
  return (match || list[0]).id
}

/**
 * Normalize a partial UI/tool profile payload into the full Rust `Profile` serde
 * struct expected by upstream `v0.5.5` `fury-agent` (`profiles.upsert` / `profiles.createMany`).
 */
export function normalizeProfilePayload(body = {}, existing = null, opts = {}) {
  const id = existing?.id ?? (typeof body.id === 'string' ? body.id.trim() : '')
  const name = typeof body.name === 'string' ? body.name.trim() : String(existing?.name || '').trim()
  if (!opts.allowEmptyName && !name) {
    throw new PibrowseError('invalid-input', 'Profile name is required')
  }

  let projectId = existing?.project_id ?? null
  for (const key of ['project_id', 'projectId', 'group_id', 'groupId', 'group']) {
    if (body[key] !== undefined) {
      projectId = cleanOptionalId(body[key])
      break
    }
  }

  let proxyId = existing?.proxy_id ?? existing?.proxy?.id ?? null
  for (const key of ['proxy_id', 'proxyId']) {
    if (body[key] !== undefined) {
      proxyId = cleanOptionalId(body[key])
      break
    }
  }

  const explicitPersona = cleanOptionalId(body.persona_id) ?? cleanOptionalId(body.persona)
  const personaId = explicitPersona ?? cleanOptionalId(existing?.persona_id) ?? cleanOptionalId(opts.fallbackPersonaId) ?? ''
  if (!opts.allowEmptyPersona && !personaId) {
    throw new PibrowseError('invalid-input', 'A valid Persona ID is required (call personas.list first)')
  }

  let startUrls = Array.isArray(existing?.start_urls) ? existing.start_urls.map(String).filter(Boolean) : []
  if (Array.isArray(body.start_urls)) {
    startUrls = body.start_urls.map((u) => String(u).trim()).filter(Boolean)
  } else if (typeof body.start_url === 'string' || typeof body.startUrl === 'string') {
    const raw = String(body.start_url ?? body.startUrl ?? '').trim()
    startUrls = raw ? [raw] : []
  }

  const allowNoProxy =
    typeof body.allow_no_proxy === 'boolean'
      ? body.allow_no_proxy
      : typeof body.allowNoProxy === 'boolean'
        ? body.allowNoProxy
        : existing
          ? Boolean(existing.allow_no_proxy)
          : !proxyId

  const fpSeed =
    typeof body.fp_seed === 'number' && Number.isFinite(body.fp_seed)
      ? Math.trunc(body.fp_seed)
      : typeof existing?.fp_seed === 'number' && Number.isFinite(existing.fp_seed)
        ? Math.trunc(existing.fp_seed)
        : 0

  return {
    id,
    project_id: projectId,
    name,
    notes: typeof body.notes === 'string' ? body.notes : String(existing?.notes ?? ''),
    tags: Array.isArray(body.tags)
      ? body.tags.map(String)
      : Array.isArray(existing?.tags)
        ? existing.tags.map(String)
        : [],
    status: typeof body.status === 'string' ? body.status : String(existing?.status ?? ''),
    blocklists: Array.isArray(body.blocklists)
      ? body.blocklists.map(String)
      : Array.isArray(existing?.blocklists)
        ? existing.blocklists.map(String)
        : [],
    inline_lists: Array.isArray(body.inline_lists)
      ? body.inline_lists
      : Array.isArray(existing?.inline_lists)
        ? existing.inline_lists
        : [],
    persona_id: personaId,
    fp_seed: fpSeed,
    allow_no_proxy: allowNoProxy,
    proxy: null,
    proxy_id: proxyId,
    timezone: body.timezone !== undefined ? (body.timezone ? String(body.timezone) : null) : (existing?.timezone ?? null),
    languages:
      body.languages !== undefined
        ? Array.isArray(body.languages)
          ? body.languages.map(String)
          : null
        : (existing?.languages ?? null),
    overrides:
      body.overrides && typeof body.overrides === 'object' && !Array.isArray(body.overrides)
        ? body.overrides
        : existing?.overrides && typeof existing.overrides === 'object' && !Array.isArray(existing.overrides)
          ? existing.overrides
          : {},
    start_urls: startUrls,
    last_opened_at: existing?.last_opened_at ?? null,
  }
}

/**
 * Normalize a proxy payload into the full Rust `Proxy` serde struct expected
 * by upstream `v0.5.5` `fury-agent` (`proxies.upsert`).
 */
export function normalizeProxyPayload(body = {}, existing = null) {
  const id = existing?.id ?? (typeof body.id === 'string' ? body.id.trim() : '')
  const host = String(body.host ?? existing?.host ?? '').trim()
  const port = Number(body.port ?? existing?.port)
  if (!host) {
    throw new PibrowseError('invalid-input', 'Proxy host is required')
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new PibrowseError('invalid-input', 'Proxy port must be an integer between 1 and 65535')
  }
  const kind = String(body.kind || body.scheme || body.protocol || existing?.kind || 'http').trim().toLowerCase()
  const name = String(body.name ?? existing?.name ?? `${host}:${port}`).trim() || `${host}:${port}`
  return {
    id,
    name,
    kind,
    host,
    port,
    username: body.username !== undefined ? (body.username ? String(body.username) : null) : (existing?.username ?? null),
    password: body.password !== undefined ? (body.password ? String(body.password) : null) : (existing?.password ?? null),
    last_country: existing?.last_country ?? null,
    last_ip: existing?.last_ip ?? null,
    last_timezone: existing?.last_timezone ?? null,
    last_location: existing?.last_location ?? null,
    rotate_url:
      body.rotate_url !== undefined || body.rotateUrl !== undefined
        ? (body.rotate_url || body.rotateUrl ? String(body.rotate_url || body.rotateUrl) : null)
        : (existing?.rotate_url ?? null),
    checker_url:
      body.checker_url !== undefined || body.checkerUrl !== undefined
        ? (body.checker_url || body.checkerUrl ? String(body.checker_url || body.checkerUrl) : null)
        : (existing?.checker_url ?? null),
  }
}

/**
 * Single authoritative domain dispatcher shared by HTTP routes (`/omnimux/pibrowse/*`)
 * and Agent tools (`ctx.tools` `pibrowse_*`).
 *
 * @param {{
 *   paths: ReturnType<import('./paths.js').resolvePibrowsePaths>,
 *   configStore: ReturnType<import('./config-store.js').createConfigStore>,
 *   ipcClient: ReturnType<import('./ipc-client.js').createIpcClient>,
 *   installer: ReturnType<import('./installer.js').createInstaller>,
 *   sidecar: ReturnType<import('./sidecar.js').createSidecarSupervisor>,
 *   mcpBridge: ReturnType<import('./mcp-bridge.js').createMcpBridge>,
 *   teamClient: ReturnType<import('./team-client.js').createTeamClient>,
 *   platform?: NodeJS.Platform,
 *   arch?: string,
 *   widevineProbeOpts?: object,
 *   standaloneCandidates?: string[],
 *   logger?: { warn?: Function, info?: Function },
 * }} deps
 */
export function createPibrowseDispatcher(deps) {
  const {
    paths,
    configStore,
    ipcClient,
    installer,
    sidecar,
    mcpBridge,
    teamClient,
    logger,
  } = deps

  async function ensureSidecarRunning() {
    const status = sidecar.getStatus()
    if (status.running) return status
    const ping = await ipcClient.ping(600)
    if (ping.ok) return sidecar.start()
    return sidecar.start()
  }

  async function getOverview() {
    const [config, widevine, teamStatus] = await Promise.all([
      configStore.load(),
      probeWidevineCdm({ platform: deps.platform, ...(deps.widevineProbeOpts || {}) }),
      teamClient.getStatus(),
    ])
    const [agent, core] = await Promise.all([
      resolveAgentBinary({
        paths,
        config,
        platform: deps.platform,
        standaloneCandidates: deps.standaloneCandidates,
      }),
      probeCoreInstallation({
        dataDir: paths.dataDir,
        corePath: config.corePath,
        platform: deps.platform,
      }),
    ])
    const platformInfo = getPlatformInfo({ platform: deps.platform, arch: deps.arch })
    const sidecarStatus = sidecar.getStatus()
    const mcpStatus = mcpBridge.getStatus()
    const installStatus = installer.getStatus()

    let stats = {
      profilesTotal: 0,
      runningProfiles: 0,
      trashedProfiles: 0,
      proxiesTotal: 0,
      blocklistsTotal: 0,
      extensionsTotal: 0,
      mirrorActive: false,
      upstreamMcpToolsCount: UPSTREAM_MCP_TOOL_NAMES.length,
    }

    let effectiveCore = { ...core, problem: null }
    let ipcCoreDownload = null

    if (sidecarStatus.running) {
      const [statusRes, profilesRes, trashRes, proxiesRes, blRes, extRes, mirrorRes] = await Promise.all([
        ipcClient.call('status', {}, { timeoutMs: 2500 }).catch((err) => {
          logger?.warn?.('omnimux-pibrowse: overview status failed', { error: err?.message })
          return null
        }),
        ipcClient.call('profiles.list', {}, { timeoutMs: 2500 }).catch((err) => {
          logger?.warn?.('omnimux-pibrowse: overview profiles.list failed', { error: err?.message })
          return []
        }),
        ipcClient.call('profiles.trash', {}, { timeoutMs: 2500 }).catch((err) => {
          logger?.warn?.('omnimux-pibrowse: overview profiles.trash failed', { error: err?.message })
          return []
        }),
        ipcClient.call('proxies.list', {}, { timeoutMs: 2500 }).catch((err) => {
          logger?.warn?.('omnimux-pibrowse: overview proxies.list failed', { error: err?.message })
          return []
        }),
        ipcClient.call('blocklists.list', {}, { timeoutMs: 2500 }).catch((err) => {
          logger?.warn?.('omnimux-pibrowse: overview blocklists.list failed', { error: err?.message })
          return []
        }),
        ipcClient.call('extensions.list_all', {}, { timeoutMs: 2500 }).catch((err) => {
          logger?.warn?.('omnimux-pibrowse: overview extensions.list_all failed', { error: err?.message })
          return []
        }),
        ipcClient.call('mirror.status', {}, { timeoutMs: 2500 }).catch((err) => {
          logger?.warn?.('omnimux-pibrowse: overview mirror.status failed', { error: err?.message })
          return { active: false }
        }),
      ])

      if (statusRes && typeof statusRes === 'object') {
        const runtimeCore = typeof statusRes.core === 'string' && statusRes.core.trim() ? statusRes.core.trim() : null
        const coreProblem =
          typeof statusRes.core_problem === 'string' && statusRes.core_problem.trim()
            ? statusRes.core_problem.trim()
            : null
        if (!effectiveCore.installed && runtimeCore) {
          effectiveCore = { installed: true, source: 'sidecar', path: runtimeCore, problem: coreProblem }
        } else {
          effectiveCore = { ...effectiveCore, problem: coreProblem }
        }
        if (statusRes.core_download && typeof statusRes.core_download === 'object') {
          ipcCoreDownload = redactAny(statusRes.core_download)
        }
      }

      const profileArr = asArray(profilesRes, 'profiles')
      const runningCount = profileArr.filter((p) => p && p.running === true).length
      stats = {
        ...stats,
        profilesTotal: profileArr.length,
        runningProfiles: runningCount,
        trashedProfiles: asArray(trashRes, 'profiles').length,
        proxiesTotal: asArray(proxiesRes, 'proxies').length,
        blocklistsTotal: asArray(blRes, 'blocklists').length,
        extensionsTotal: asArray(extRes, 'extensions').length,
        mirrorActive: Boolean(mirrorRes?.active || mirrorRes?.running),
      }
    }

    return toLosslessJson({
      ok: true,
      upstream: {
        repo: PINNED_UPSTREAM.repo,
        releaseTag: PINNED_UPSTREAM.releaseTag,
        sourceCommit: PINNED_UPSTREAM.sourceCommit,
        chromiumVersion: PINNED_UPSTREAM.chromiumVersion,
        license: PINNED_UPSTREAM.license,
      },
      platform: platformInfo,
      paths: {
        rootDir: paths.rootDir,
        dataDir: paths.dataDir,
        socketPath: paths.socketPath,
      },
      config: {
        agentPath: config.agentPath,
        corePath: config.corePath,
        geoipPath: config.geoipPath,
        teamServerUrl: config.teamServerUrl,
        rememberOrgKey: config.rememberOrgKey,
        autoStartSidecar: config.autoStartSidecar,
      },
      agent,
      core: effectiveCore,
      widevine,
      sidecar: sidecarStatus,
      installer: {
        ...installStatus,
        ...(ipcCoreDownload ? { ipcCoreDownload } : {}),
      },
      mcp: mcpStatus,
      team: teamStatus,
      stats,
    })
  }

  // ---- Runtime & Installer ----

  async function manageRuntime(args = {}) {
    const action = String(args.action || 'status')
    if (action === 'status') {
      return getOverview()
    }
    if (action === 'start') {
      const status = await sidecar.start()
      const mcp = await mcpBridge.sync({ force: false })
      return toLosslessJson({ ok: true, sidecar: status, mcp })
    }
    if (action === 'stop') {
      const status = await sidecar.stop({ stopProfiles: Boolean(args.stopProfiles) })
      return toLosslessJson({ ok: true, sidecar: status })
    }
    if (action === 'restart') {
      const status = await sidecar.restart()
      const mcp = await mcpBridge.restart()
      return toLosslessJson({ ok: true, sidecar: status, mcp })
    }
    if (action === 'install_agent') {
      if (args.background === true) {
        const info = getPlatformInfo({ platform: deps.platform, arch: deps.arch })
        if (!info.prebuiltSupported) {
          throw new PibrowseError('unsupported-platform', info.unsupportedGuidance)
        }
        installer
          .installAgent()
          .then(() => mcpBridge.sync({ force: true }))
          .catch((err) => {
            logger?.warn?.('omnimux-pibrowse: background agent install failed', {
              error: err instanceof Error ? err.message : String(err),
            })
          })
        return toLosslessJson({
          ok: true,
          started: true,
          mode: 'verified-installer',
          installer: installer.getStatus(),
        })
      }
      const res = await installer.installAgent()
      const mcp = await mcpBridge.sync({ force: true })
      return toLosslessJson({ ...res, mcp })
    }
    if (action === 'install_core') {
      const config = await configStore.load()
      const agent = await resolveAgentBinary({
        paths,
        config,
        platform: deps.platform,
        standaloneCandidates: deps.standaloneCandidates,
      })
      if (!agent.installed || !agent.path) {
        throw new PibrowseError('agent-not-installed', 'Install or configure fury-agent before downloading Core')
      }
      if (args.useIpc === true && sidecar.getStatus().running) {
        try {
          const ipcRes = await ipcClient.call('core.download', {}, { timeoutMs: 10_000 })
          return toLosslessJson({ ok: true, mode: 'ipc', download: redactAny(ipcRes) })
        } catch (err) {
          logger?.warn?.('omnimux-pibrowse: IPC core.download failed, falling back to verified installer', {
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }
      if (args.background === true) {
        const info = getPlatformInfo({ platform: deps.platform, arch: deps.arch })
        if (!info.prebuiltSupported) {
          throw new PibrowseError('unsupported-platform', info.unsupportedGuidance)
        }
        installer.installCore({ agentBinaryPath: agent.path }).catch((err) => {
          logger?.warn?.('omnimux-pibrowse: background core install failed', {
            error: err instanceof Error ? err.message : String(err),
          })
        })
        return toLosslessJson({
          ok: true,
          started: true,
          mode: 'verified-installer',
          installer: installer.getStatus(),
        })
      }
      const res = await installer.installCore({ agentBinaryPath: agent.path })
      return toLosslessJson(res)
    }
    if (action === 'core_download_status') {
      if (sidecar.getStatus().running) {
        const status = await ipcClient.call('core.downloadStatus', {}, { timeoutMs: 3000 }).catch((err) => {
          logger?.warn?.('omnimux-pibrowse: core.downloadStatus IPC failed', { error: err?.message })
          return null
        })
        return toLosslessJson({ ok: true, ipcStatus: redactAny(status), installer: installer.getStatus() })
      }
      return toLosslessJson({ ok: true, ipcStatus: null, installer: installer.getStatus() })
    }
    if (action === 'configure_paths') {
      const prev = await configStore.load()
      const patch = {}
      if ('agentPath' in args) patch.agentPath = args.agentPath
      if ('corePath' in args) patch.corePath = args.corePath
      if ('geoipPath' in args) patch.geoipPath = args.geoipPath
      if ('autoStartSidecar' in args) patch.autoStartSidecar = args.autoStartSidecar
      const next = await configStore.update(patch)
      const runtimePathsChanged = prev.agentPath !== next.agentPath || prev.corePath !== next.corePath
      let restartedSidecar = null
      if (runtimePathsChanged && sidecar.getStatus().running) {
        restartedSidecar = await sidecar.restart()
      }
      const mcp = await mcpBridge.sync({ force: true })
      return toLosslessJson({
        ok: true,
        config: next,
        ...(restartedSidecar ? { sidecar: restartedSidecar } : {}),
        mcp,
      })
    }
    if (action === 'reuse_standalone') {
      const config = await configStore.load()
      const resolved = await resolveAgentBinary({
        paths,
        config: { ...config, agentPath: null },
        platform: deps.platform,
        standaloneCandidates: deps.standaloneCandidates,
      })
      if (!resolved.standaloneCandidate) {
        throw new PibrowseError('not-found', 'No standalone PiBrowse.app installation found on this machine')
      }
      const next = await configStore.update({ agentPath: resolved.standaloneCandidate })
      const probe = await installer.probeAgentBinary(resolved.standaloneCandidate)
      let restartedSidecar = null
      if (config.agentPath !== next.agentPath && sidecar.getStatus().running) {
        restartedSidecar = await sidecar.restart()
      }
      const mcp = await mcpBridge.sync({ force: true })
      return toLosslessJson({
        ok: true,
        config: next,
        probe,
        ...(restartedSidecar ? { sidecar: restartedSidecar } : {}),
        mcp,
      })
    }
    if (action === 'probe_agent') {
      const config = await configStore.load()
      const resolved = await resolveAgentBinary({
        paths,
        config,
        platform: deps.platform,
        standaloneCandidates: deps.standaloneCandidates,
      })
      if (!resolved.path) {
        return toLosslessJson({ ok: false, error: 'agent-not-installed', message: 'No fury-agent path configured' })
      }
      const probe = await installer.probeAgentBinary(resolved.path)
      return toLosslessJson(probe)
    }
    if (action === 'probe_mcp') {
      return toLosslessJson({ ok: true, mcp: await mcpBridge.probe() })
    }
    if (action === 'restart_mcp') {
      return toLosslessJson({ ok: true, mcp: await mcpBridge.restart() })
    }
    if (action === 'clear_cache') {
      const blocked = requireConfirm(args.confirm, 'clear_cache')
      if (blocked) return toLosslessJson(blocked)
      const res = await installer.clearCache()
      return toLosslessJson(res)
    }

    throw new PibrowseError('invalid-input', `Unknown runtime action "${action}"`)
  }

  // ---- Profiles, Personas, Groups & Trash ----

  async function listProfiles(query = {}) {
    await ensureSidecarRunning()
    const [profilesRes, trashRes, groupsRes] = await Promise.all([
      ipcClient.call('profiles.list', {}),
      ipcClient.call('profiles.trash', {}).catch((err) => {
        logger?.warn?.('omnimux-pibrowse: profiles.trash failed', { error: err?.message })
        return []
      }),
      ipcClient.call('projects.list', {}).catch((err) => {
        logger?.warn?.('omnimux-pibrowse: projects.list failed', { error: err?.message })
        return []
      }),
    ])

    let profiles = asArray(profilesRes, 'profiles').map((p) => {
      const clean = redactProfile(p) || {}
      return {
        ...clean,
        running: Boolean(clean.running),
      }
    })
    const runningIds = profiles.filter((p) => p.running).map((p) => p.id)

    if (query.group && query.group !== 'all') {
      profiles = profiles.filter((p) => p.project_id === query.group || p.group_id === query.group || p.group === query.group)
    }
    if (query.status === 'running') {
      profiles = profiles.filter((p) => p.running)
    } else if (query.status === 'stopped') {
      profiles = profiles.filter((p) => !p.running)
    }
    if (query.search && String(query.search).trim()) {
      const needle = String(query.search).trim().toLowerCase()
      profiles = profiles.filter((p) =>
        `${p.name || ''} ${p.id || ''} ${p.persona_id || p.persona || ''} ${p.notes || ''}`.toLowerCase().includes(needle),
      )
    }

    return toLosslessJson({
      ok: true,
      profiles,
      trash: asArray(trashRes, 'profiles').map((p) => redactProfile(p)),
      groups: redactAny(asArray(groupsRes, 'projects')),
      runningIds,
    })
  }

  async function listPersonas() {
    await ensureSidecarRunning()
    const personas = await ipcClient.call('personas.list', {})
    return toLosslessJson({ ok: true, personas: redactAny(asArray(personas, 'personas')) })
  }

  async function findLocalProfile(profileId) {
    const res = await ipcClient.call('profiles.list', {})
    return asArray(res, 'profiles').find((p) => p && p.id === profileId) || null
  }

  async function resolveFallbackPersonaId() {
    const personas = await ipcClient.call('personas.list', {})
    return pickDefaultPersonaId(personas, deps.platform)
  }

  async function upsertProfile(body = {}) {
    await ensureSidecarRunning()
    if (!body || typeof body !== 'object') {
      throw new PibrowseError('invalid-input', 'Profile payload object is required')
    }
    const existing = typeof body.id === 'string' && body.id.trim()
      ? await findLocalProfile(body.id.trim())
      : null
    const hasPersona = Boolean(cleanOptionalId(body.persona_id) ?? cleanOptionalId(body.persona) ?? cleanOptionalId(existing?.persona_id))
    const fallbackPersonaId = hasPersona ? '' : await resolveFallbackPersonaId()
    const payload = normalizeProfilePayload(body, existing, { fallbackPersonaId })
    const created = await ipcClient.call('profiles.upsert', payload)
    const id = created?.id || payload.id
    return toLosslessJson({ ok: true, id, profile: redactProfile({ ...payload, ...created, id }) })
  }

  async function batchCreateProfiles(body = {}) {
    await ensureSidecarRunning()
    const count = Math.min(50, Math.max(1, Number(body.count) || 1))
    const prefix = String(body.prefix || 'Profile').trim() || 'Profile'
    const templateInput = {
      ...(body.template && typeof body.template === 'object' ? body.template : {}),
      name: prefix,
      ...(body.persona_id || body.persona ? { persona_id: body.persona_id || body.persona } : {}),
      ...(body.project_id || body.groupId ? { project_id: body.project_id || body.groupId } : {}),
      ...(body.proxy_id || body.proxyId ? { proxy_id: body.proxy_id || body.proxyId } : {}),
      ...(body.start_urls || body.startUrl ? { start_urls: body.start_urls || [body.startUrl] } : {}),
    }
    const template = normalizeProfilePayload(templateInput, null, {
      allowEmptyPersona: true,
      allowEmptyName: true,
    })
    const res = await ipcClient.call('profiles.createMany', {
      count,
      name_pattern: `${prefix}-{n}`,
      template,
    })
    const createdIds = Array.isArray(res?.created) ? res.created : []
    return toLosslessJson({
      ok: true,
      count: createdIds.length,
      created: createdIds,
      failed: redactAny(Array.isArray(res?.failed) ? res.failed : []),
    })
  }

  async function launchProfile({ id, url, cdp = false, background = false }) {
    if (!id) throw new PibrowseError('invalid-input', 'Profile id is required')
    await ensureSidecarRunning()
    let res
    try {
      res = await ipcClient.call('profile.launch', {
        id,
        ...(url ? { url } : {}),
        cdp: Boolean(cdp),
        background: Boolean(background),
      })
    } catch (err) {
      throw normalizeCoreLaunchError(err)
    }
    return toLosslessJson({ ok: true, id, launch: redactAny(res) })
  }

  async function stopProfile({ id }) {
    if (!id) throw new PibrowseError('invalid-input', 'Profile id is required')
    await ensureSidecarRunning()
    const res = await ipcClient.call('profile.stop', { id })
    return toLosslessJson({ ok: true, id, stopped: redactAny(res) })
  }

  async function manageProfiles(args = {}) {
    const action = String(args.action || '')
    if (!action) throw new PibrowseError('invalid-input', 'action is required')

    if (action === 'trash_list') {
      await ensureSidecarRunning()
      const trash = await ipcClient.call('profiles.trash', {})
      return toLosslessJson({ ok: true, trash: asArray(trash, 'profiles').map((p) => redactProfile(p)) })
    }

    if (action === 'purge') {
      const blocked = requireConfirm(args.confirm, 'purge_profile')
      if (blocked) return toLosslessJson(blocked)
      if (!args.profileId) throw new PibrowseError('invalid-input', 'profileId is required for purge')
      await ensureSidecarRunning()
      const res = await ipcClient.call('profiles.purge', { id: args.profileId })
      return toLosslessJson({ ok: true, purged: args.profileId, result: redactAny(res) })
    }

    if (!args.profileId) {
      throw new PibrowseError('invalid-input', `profileId is required for action "${action}"`)
    }
    await ensureSidecarRunning()

    if (action === 'clone') {
      const res = await ipcClient.call('profiles.clone', {
        id: args.profileId,
        ...(args.count ? { count: Number(args.count) } : {}),
        ...(args.name ? { name: args.name } : {}),
      })
      return toLosslessJson({ ok: true, profile: redactAny(res) })
    }
    if (action === 'rerandomize') {
      const requestedPersona = cleanOptionalId(args.personaId) ?? cleanOptionalId(args.persona)
      if (requestedPersona) {
        const existing = await findLocalProfile(args.profileId)
        if (!existing) {
          throw new PibrowseError('not-found', `Profile "${args.profileId}" not found`)
        }
        if (existing.running) {
          throw new PibrowseError('conflict', 'Stop the running profile before changing its Persona or reseeding its fingerprint')
        }
        const updated = normalizeProfilePayload({ persona_id: requestedPersona }, existing)
        await ipcClient.call('profiles.upsert', updated)
      }
      const res = await ipcClient.call('profiles.reseed', { id: args.profileId })
      return toLosslessJson({ ok: true, profile: redactAny(res) })
    }
    if (action === 'reset_fingerprint') {
      const res = await ipcClient.call('profiles.reseed', { id: args.profileId })
      return toLosslessJson({ ok: true, profile: redactAny(res) })
    }
    if (action === 'trash') {
      const res = await ipcClient.call('profiles.delete', { id: args.profileId })
      return toLosslessJson({ ok: true, trashed: args.profileId, result: redactAny(res) })
    }
    if (action === 'restore') {
      const res = await ipcClient.call('profiles.restore', { id: args.profileId })
      return toLosslessJson({ ok: true, restored: args.profileId, profile: redactProfile(res) })
    }
    if (action === 'detect_suite') {
      let res
      try {
        res = await ipcClient.call('profile.launch', {
          id: args.profileId,
          cdp: true,
          background: false,
        })
      } catch (err) {
        throw normalizeCoreLaunchError(err)
      }
      const targetUrl = args.detectUrl || res?.probe_url || 'https://browserleaks.com/'
      if (targetUrl) {
        await ipcClient.call('page.navigate', { id: args.profileId, url: targetUrl }).catch((err) => {
          logger?.warn?.('omnimux-pibrowse: detect_suite page.navigate skipped or failed', {
            error: err instanceof Error ? err.message : String(err),
          })
        })
      }
      return toLosslessJson({ ok: true, profileId: args.profileId, detectUrl: targetUrl, launch: redactAny(res) })
    }

    throw new PibrowseError('invalid-input', `Unknown profile management action "${action}"`)
  }

  // ---- Proxies & GeoIP ----

  async function listProxies() {
    await ensureSidecarRunning()
    const proxiesRes = await ipcClient.call('proxies.list', {})
    const config = await configStore.load()
    return toLosslessJson({
      ok: true,
      proxies: asArray(proxiesRes, 'proxies').map((p) => redactProxy(p)),
      geoip: {
        configuredPath: config.geoipPath,
      },
    })
  }

  async function upsertProxy(body = {}) {
    await ensureSidecarRunning()
    let existing = null
    if (typeof body.id === 'string' && body.id.trim()) {
      const list = await ipcClient.call('proxies.list', {})
      existing = asArray(list, 'proxies').find((p) => p && p.id === body.id.trim()) || null
    }
    const payload = normalizeProxyPayload(body, existing)
    const res = await ipcClient.call('proxies.upsert', payload)
    const id = res?.id || payload.id
    return toLosslessJson({ ok: true, id, proxy: redactProxy({ ...payload, ...res, id }) })
  }

  async function importProxies(body = {}) {
    await ensureSidecarRunning()
    const text = typeof body.text === 'string'
      ? body.text.trim()
      : Array.isArray(body.lines)
        ? body.lines.map((l) => String(l).trim()).filter(Boolean).join('\n')
        : ''
    if (!text) {
      throw new PibrowseError('invalid-input', 'At least one proxy line is required')
    }
    const res = await ipcClient.call('proxies.importMany', {
      text,
      ...(body.namePrefix ? { name_prefix: String(body.namePrefix) } : {}),
    })
    return toLosslessJson({ ok: true, result: redactAny(res) })
  }

  async function checkProxy(args = {}) {
    if (!args.proxyId) {
      throw new PibrowseError('invalid-input', 'proxyId is required')
    }
    const action = String(args.action || 'check')
    await ensureSidecarRunning()
    let geoipPath = (await configStore.load()).geoipPath
    if (args.geoipPath) {
      geoipPath = validateUserPath(args.geoipPath, { label: 'geoipPath' })
      await configStore.update({ geoipPath })
    }
    const checkerUrl = geoipPath ? `https://ipinfo.io/json|${geoipPath}` : undefined

    if (action === 'check') {
      const list = await ipcClient.call('proxies.list', {})
      const found = asArray(list, 'proxies').find((p) => p && p.id === args.proxyId)
      if (!found) {
        throw new PibrowseError('not-found', `Proxy "${args.proxyId}" not found`)
      }
      const proxyUrl = found.url || `${found.kind || found.scheme || found.protocol || 'http'}://${found.username ? `${encodeURIComponent(found.username)}:${encodeURIComponent(found.password || '')}@` : ''}${found.host}:${found.port}`
      const effectiveCheckerUrl = checkerUrl || found.checker_url || undefined
      const res = await ipcClient.call(
        'proxies.check',
        { id: args.proxyId, url: proxyUrl, ...(effectiveCheckerUrl ? { checker_url: effectiveCheckerUrl } : {}) },
        { timeoutMs: 20_000 },
      )
      return toLosslessJson({ ok: true, action, proxyId: args.proxyId, result: redactAny(res) })
    }
    if (action === 'diagnose') {
      const res = await ipcClient.call(
        'proxies.diagnose',
        { id: args.proxyId, ...(checkerUrl ? { checker_url: checkerUrl } : {}) },
        { timeoutMs: 25_000 },
      )
      return toLosslessJson({ ok: true, action, proxyId: args.proxyId, result: redactAny(res) })
    }
    if (action === 'rotate') {
      const res = await ipcClient.call('proxies.rotate', { id: args.proxyId }, { timeoutMs: 20_000 })
      return toLosslessJson({ ok: true, action, proxyId: args.proxyId, result: redactAny(res) })
    }
    throw new PibrowseError('invalid-input', `Unknown proxy check action "${action}"`)
  }

  async function deleteProxy(args = {}) {
    const blocked = requireConfirm(args.confirm, 'delete_proxy')
    if (blocked) return toLosslessJson(blocked)
    if (!args.proxyId) {
      throw new PibrowseError('invalid-input', 'proxyId is required')
    }
    await ensureSidecarRunning()

    // Check active profile references before deleting to prevent broken bindings.
    const profilesRes = await ipcClient.call('profiles.list', {}).catch((err) => {
      logger?.warn?.('omnimux-pibrowse: failed checking profile references before deleteProxy', { error: err?.message })
      return []
    })
    const referencing = asArray(profilesRes, 'profiles').filter(
      (p) => p?.proxy_id === args.proxyId || p?.proxy?.id === args.proxyId,
    )
    if (referencing.length > 0) {
      throw new PibrowseError(
        'proxy-in-use',
        `Proxy "${args.proxyId}" is still referenced by ${referencing.length} profile(s): ${referencing.map((p) => p.name || p.id).join(', ')}`,
        { referencingProfileIds: referencing.map((p) => p.id) },
      )
    }

    const res = await ipcClient.call('proxies.delete', { id: args.proxyId })
    return toLosslessJson({ ok: true, deleted: args.proxyId, result: redactAny(res) })
  }

  // ---- Blocklists ----

  async function manageBlocklists(args = {}) {
    const action = String(args.action || 'list')
    await ensureSidecarRunning()

    if (action === 'list') {
      const res = await ipcClient.call('blocklists.list', {})
      return toLosslessJson({ ok: true, blocklists: redactAny(asArray(res, 'blocklists')) })
    }
    if (action === 'get') {
      if (!args.name) throw new PibrowseError('invalid-input', 'Blocklist name is required')
      const res = await ipcClient.call('blocklists.read', { name: args.name })
      return toLosslessJson({
        ok: true,
        blocklist: redactAny({
          name: res?.name || args.name,
          text: res?.text ?? res?.content ?? '',
          content: res?.text ?? res?.content ?? '',
        }),
      })
    }
    if (action === 'save') {
      const text = typeof args.text === 'string' ? args.text : typeof args.content === 'string' ? args.content : null
      if (!args.name || text === null) {
        throw new PibrowseError('invalid-input', 'Blocklist name and content string are required')
      }
      const res = await ipcClient.call('blocklists.upsert', {
        name: args.name,
        text,
      })
      return toLosslessJson({ ok: true, blocklist: redactAny(res) })
    }
    if (action === 'bind') {
      if (!args.profileId || !Array.isArray(args.blocklists)) {
        throw new PibrowseError('invalid-input', 'profileId and blocklists array are required')
      }
      const existing = await findLocalProfile(args.profileId)
      if (!existing) {
        throw new PibrowseError('not-found', `Profile "${args.profileId}" not found`)
      }
      const payload = normalizeProfilePayload({ blocklists: args.blocklists }, existing)
      const res = await ipcClient.call('profiles.upsert', payload)
      return toLosslessJson({ ok: true, profile: redactProfile({ ...payload, ...res }) })
    }
    if (action === 'delete') {
      const blocked = requireConfirm(args.confirm, 'delete_blocklist')
      if (blocked) return toLosslessJson(blocked)
      if (!args.name) throw new PibrowseError('invalid-input', 'Blocklist name is required')
      const res = await ipcClient.call('blocklists.delete', { name: args.name })
      return toLosslessJson({ ok: true, deleted: args.name, result: redactAny(res) })
    }

    throw new PibrowseError('invalid-input', `Unknown blocklist action "${action}"`)
  }

  // ---- Extensions & Multi-Window Mirror ----

  async function manageExtensionsAndMirror(args = {}) {
    const action = String(args.action || 'list_extensions')
    await ensureSidecarRunning()

    if (action === 'list_extensions') {
      const extMethod = args.profileId ? 'extensions.list' : 'extensions.list_all'
      const extParams = args.profileId ? { profile_id: args.profileId } : {}
      const [exts, mirror] = await Promise.all([
        ipcClient.call(extMethod, extParams),
        ipcClient.call('mirror.status', {}).catch((err) => {
          logger?.warn?.('omnimux-pibrowse: mirror.status failed', { error: err?.message })
          return { active: false }
        }),
      ])
      return toLosslessJson({
        ok: true,
        extensions: redactAny(asArray(exts, 'extensions')),
        mirror: redactAny(mirror),
      })
    }
    if (action === 'install_extension') {
      if (!args.source) {
        throw new PibrowseError('invalid-input', 'Extension source (local .crx path or 32-char Chrome Web Store ID) is required')
      }
      let profileIds = Array.isArray(args.profileIds) && args.profileIds.length > 0
        ? args.profileIds.map(String)
        : args.profileId
          ? [String(args.profileId)]
          : []
      if (profileIds.length === 0) {
        const list = await ipcClient.call('profiles.list', {})
        profileIds = asArray(list, 'profiles').map((p) => p?.id).filter(Boolean)
      }
      if (profileIds.length === 0) {
        throw new PibrowseError('invalid-input', 'Create at least one browser profile before installing an extension')
      }
      const trimmedSource = String(args.source).trim()
      const kind = args.kind || (/^[a-p]{32}$/.test(trimmedSource) ? 'store' : trimmedSource.toLowerCase().endsWith('.crx') ? 'crx' : 'unsupported')
      let res
      if (kind === 'store') {
        res = await ipcClient.call('extensions.install_from_store', {
          ext_id: trimmedSource,
          profile_ids: profileIds,
        })
      } else if (kind === 'crx') {
        const crxPath = validateUserPath(trimmedSource, { label: 'extensionPath' })
        const installed = []
        for (const pid of profileIds) {
          const single = await ipcClient.call('extensions.install', {
            profile_id: pid,
            path: crxPath,
          })
          installed.push({ profileId: pid, extension: single })
        }
        res = installed.length === 1 ? installed[0].extension : { installed }
      } else {
        throw new PibrowseError(
          'invalid-input',
          'Upstream fury-agent v0.5.5 only accepts .crx extension packages or 32-character Chrome Web Store IDs',
        )
      }
      return toLosslessJson({ ok: true, extension: redactAny(res) })
    }
    if (action === 'remove_extension') {
      const blocked = requireConfirm(args.confirm, 'remove_extension')
      if (blocked) return toLosslessJson(blocked)
      if (!args.extensionId) {
        throw new PibrowseError('invalid-input', 'extensionId is required')
      }
      let targetProfileIds = args.profileId ? [String(args.profileId)] : []
      if (targetProfileIds.length === 0) {
        const allExts = await ipcClient.call('extensions.list_all', {})
        const found = asArray(allExts, 'extensions').find((e) => e && e.id === args.extensionId)
        if (Array.isArray(found?.profiles)) {
          targetProfileIds = found.profiles.map((p) => (typeof p === 'string' ? p : p?.id)).filter(Boolean)
        }
      }
      if (targetProfileIds.length === 0) {
        throw new PibrowseError('invalid-input', 'profileId is required to remove an extension (no profile owns this extension)')
      }
      const results = []
      for (const pid of targetProfileIds) {
        const r = await ipcClient.call('extensions.remove', {
          id: args.extensionId,
          profile_id: pid,
        })
        results.push({ profileId: pid, result: r })
      }
      return toLosslessJson({
        ok: true,
        removed: args.extensionId,
        result: redactAny(results.length === 1 ? results[0].result : { removedFrom: results }),
      })
    }
    if (action === 'mirror_status') {
      const res = await ipcClient.call('mirror.status', {})
      return toLosslessJson({ ok: true, mirror: redactAny(res) })
    }
    if (action === 'mirror_start') {
      const profileIds = Array.isArray(args.profileIds) && args.profileIds.length >= 2
        ? args.profileIds
        : args.sourceProfileId && Array.isArray(args.targetProfileIds) && args.targetProfileIds.length > 0
          ? [args.sourceProfileId, ...args.targetProfileIds]
          : []
      if (profileIds.length < 2) {
        throw new PibrowseError('invalid-input', 'At least two profile IDs are required for mirror_start')
      }
      const res = await ipcClient.call('mirror.start', {
        profile_ids: profileIds,
        ...(typeof args.typing === 'boolean' ? { typing: args.typing } : {}),
      })
      return toLosslessJson({ ok: true, mirror: redactAny(res) })
    }
    if (action === 'mirror_stop') {
      const res = await ipcClient.call('mirror.stop', {})
      return toLosslessJson({ ok: true, mirror: redactAny(res) })
    }

    throw new PibrowseError('invalid-input', `Unknown extensions/mirror action "${action}"`)
  }

  // ---- Team Server E2E Sync (Phase 3) ----

  async function manageTeamSync(args = {}) {
    const action = String(args.action || 'status')
    if (action === 'status') {
      return toLosslessJson({ ok: true, team: await teamClient.getStatus() })
    }
    if (action === 'probe') {
      return toLosslessJson(await teamClient.probeServer(args.serverUrl))
    }
    if (action === 'list_projects') {
      return toLosslessJson(await teamClient.listProjects())
    }
    if (action === 'create_project') {
      return toLosslessJson(await teamClient.createProject({ name: args.name, description: args.description }))
    }
    if (action === 'list_profiles') {
      return toLosslessJson(await teamClient.listProfiles(args.projectId))
    }
    if (action === 'list_members') {
      return toLosslessJson(await teamClient.listMembers())
    }
    if (action === 'handover_key') {
      return toLosslessJson(
        await teamClient.handoverKey({
          memberId: args.memberId,
          memberPublicKeyB64: args.memberPublicKeyB64,
          expectedVerifyCode: args.expectedVerifyCode,
        }),
      )
    }
    if (action === 'rotate_ork') {
      const blocked = requireConfirm(args.confirm, 'rotate_ork')
      if (blocked) return toLosslessJson(blocked)
      return toLosslessJson(await teamClient.rotateOrgKey())
    }
    if (action === 'launch_profile') {
      await ensureSidecarRunning()
      return toLosslessJson(
        await teamClient.launchTeamProfile({
          profileId: args.profileId,
          force: Boolean(args.force),
          cdp: Boolean(args.cdp),
          background: Boolean(args.background),
        }),
      )
    }
    if (action === 'stop_profile') {
      return toLosslessJson(await teamClient.stopTeamProfile({ profileId: args.profileId }))
    }
    if (action === 'share_local_profile') {
      await ensureSidecarRunning()
      return toLosslessJson(
        await teamClient.shareLocalProfile({
          localProfileId: args.localProfileId,
          projectId: args.projectId,
          name: args.name,
        }),
      )
    }
    if (action === 'audit_logs') {
      return toLosslessJson(await teamClient.listAuditLogs({ limit: args.limit, profileId: args.profileId }))
    }
    if (action === 'disconnect') {
      const blocked = requireConfirm(args.confirm, 'disconnect_team')
      if (blocked) return toLosslessJson(blocked)
      return toLosslessJson(await teamClient.disconnect())
    }

    throw new PibrowseError('invalid-input', `Unknown team sync action "${action}"`)
  }

  return {
    getOverview,
    manageRuntime,
    listProfiles,
    listPersonas,
    upsertProfile,
    batchCreateProfiles,
    launchProfile,
    stopProfile,
    manageProfiles,
    listProxies,
    upsertProxy,
    importProxies,
    checkProxy,
    deleteProxy,
    manageBlocklists,
    manageExtensionsAndMirror,
    manageTeamSync,
    teamLogin: (params) => teamClient.login(params),
    teamSignup: (params) => teamClient.signupWithInvite(params),
    teamUnlock: (password) => teamClient.unlockSessionWithPassword(password),
  }
}
