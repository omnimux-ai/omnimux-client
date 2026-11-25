import { PINNED_UPSTREAM, UPSTREAM_MCP_TOOL_NAMES } from './constants.js'
import { PibrowseError } from './errors.js'
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

    if (sidecarStatus.running) {
      const [profilesRes, trashRes, proxiesRes, blRes, extRes, mirrorRes] = await Promise.all([
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
      core,
      widevine,
      sidecar: sidecarStatus,
      installer: installStatus,
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
      if (sidecar.getStatus().running && args.useIpc !== false) {
        try {
          const ipcRes = await ipcClient.call('core.download', {}, { timeoutMs: 10_000 })
          return toLosslessJson({ ok: true, mode: 'ipc', download: redactAny(ipcRes) })
        } catch (err) {
          logger?.warn?.('omnimux-pibrowse: IPC core.download failed, falling back to verified installer', {
            error: err instanceof Error ? err.message : String(err),
          })
        }
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
      const patch = {}
      if ('agentPath' in args) patch.agentPath = args.agentPath
      if ('corePath' in args) patch.corePath = args.corePath
      if ('geoipPath' in args) patch.geoipPath = args.geoipPath
      if ('autoStartSidecar' in args) patch.autoStartSidecar = args.autoStartSidecar
      const next = await configStore.update(patch)
      const mcp = await mcpBridge.sync({ force: true })
      return toLosslessJson({ ok: true, config: next, mcp })
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
      const mcp = await mcpBridge.sync({ force: true })
      return toLosslessJson({ ok: true, config: next, probe, mcp })
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

  async function upsertProfile(body = {}) {
    await ensureSidecarRunning()
    if (!body || typeof body !== 'object') {
      throw new PibrowseError('invalid-input', 'Profile payload object is required')
    }
    const created = await ipcClient.call('profiles.upsert', body)
    return toLosslessJson({ ok: true, profile: redactProfile(created) })
  }

  async function batchCreateProfiles(body = {}) {
    await ensureSidecarRunning()
    const count = Math.min(50, Math.max(1, Number(body.count) || 1))
    const prefix = String(body.prefix || 'Profile').trim()
    const results = []
    for (let i = 1; i <= count; i += 1) {
      const payload = {
        ...body.template,
        name: `${prefix}-${String(i).padStart(2, '0')}`,
        ...(body.persona ? { persona: body.persona } : {}),
        ...(body.groupId ? { group_id: body.groupId } : {}),
        ...(body.proxyId ? { proxy_id: body.proxyId } : {}),
        ...(body.startUrl ? { start_url: body.startUrl } : {}),
      }
      const created = await ipcClient.call('profiles.upsert', payload)
      results.push(redactProfile(created))
    }
    return toLosslessJson({ ok: true, count: results.length, profiles: results })
  }

  async function launchProfile({ id, url, cdp = false, background = false }) {
    if (!id) throw new PibrowseError('invalid-input', 'Profile id is required')
    await ensureSidecarRunning()
    const res = await ipcClient.call('profile.launch', {
      id,
      ...(url ? { url } : {}),
      cdp: Boolean(cdp),
      background: Boolean(background),
    })
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
      const res = await ipcClient.call('profiles.randomize', {
        id: args.profileId,
      })
      return toLosslessJson({ ok: true, profile: redactProfile(res) })
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
      const detectUrl = args.detectUrl || 'https://browserleaks.com/'
      const res = await ipcClient.call('profile.launch', {
        id: args.profileId,
        url: detectUrl,
        detect_suite: true,
      })
      return toLosslessJson({ ok: true, profileId: args.profileId, detectUrl, launch: redactAny(res) })
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
    const res = await ipcClient.call('proxies.upsert', body)
    return toLosslessJson({ ok: true, proxy: redactProxy(res) })
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
      const proxyUrl = found.url || `${found.scheme || found.protocol || 'http'}://${found.username ? `${encodeURIComponent(found.username)}:${encodeURIComponent(found.password || '')}@` : ''}${found.host}:${found.port}`
      const res = await ipcClient.call(
        'proxies.check',
        { url: proxyUrl, ...(checkerUrl ? { checker_url: checkerUrl } : {}) },
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
      const res = await ipcClient.call('profiles.upsert', {
        id: args.profileId,
        blocklists: args.blocklists,
      })
      return toLosslessJson({ ok: true, profile: redactProfile(res) })
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
        throw new PibrowseError('invalid-input', 'Extension source (local path or CWS ID/URL) is required')
      }
      const profileIds = Array.isArray(args.profileIds) && args.profileIds.length > 0
        ? args.profileIds
        : args.profileId
          ? [args.profileId]
          : []
      const kind = args.kind || (/^[a-p]{32}$/.test(String(args.source).trim()) ? 'store' : String(args.source).endsWith('.crx') ? 'crx' : 'unpacked')
      let res
      if (kind === 'store') {
        res = await ipcClient.call('extensions.install_from_store', {
          ext_id: String(args.source).trim(),
          profile_ids: profileIds,
        })
      } else if (kind === 'crx') {
        res = await ipcClient.call('extensions.install', {
          profile_id: profileIds[0] || '',
          path: validateUserPath(args.source, { label: 'extensionPath' }),
        })
      } else {
        res = await ipcClient.call('extensions.install_folder', {
          profile_ids: profileIds,
          path: validateUserPath(args.source, { label: 'extensionFolder' }),
        })
      }
      return toLosslessJson({ ok: true, extension: redactAny(res) })
    }
    if (action === 'remove_extension') {
      const blocked = requireConfirm(args.confirm, 'remove_extension')
      if (blocked) return toLosslessJson(blocked)
      if (!args.extensionId) {
        throw new PibrowseError('invalid-input', 'extensionId is required')
      }
      const res = await ipcClient.call('extensions.remove', {
        id: args.extensionId,
        ...(args.profileId ? { profile_id: args.profileId } : {}),
      })
      return toLosslessJson({ ok: true, removed: args.extensionId, result: redactAny(res) })
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
