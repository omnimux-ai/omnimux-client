/**
 * Host-side project media resolution and canvas reconciliation engine.
 *
 * - Resolves any project media item through the hub `mediaResolver` seam using
 *   its canonical `MediaHandleV1` (or legacy derivable locator) while enforcing
 *   workspace/session ACL and SHA-256 content verification.
 * - Reconciles a project's media library against Host storage and connected
 *   canvas upstream nodes, classifying every item into one of five mutually
 *   exclusive states (`online_exact`, `legacy_unsigned_exact`, `source_drifted`,
 *   `legacy_ambiguous`, `missing_unlinked`) plus `unimportedUpstreams`.
 * - In `apply` mode, safely upgrades unambiguous legacy unsigned items after
 *   writing a `.backups/` snapshot, and never silently substitutes drifted media.
 */
import { ClipDomainError } from '../errors.js'
import { readCanvasBinding, resolveWorkflowBinding, sameBinding } from '../live/command-broker.js'
import { assertProjectId } from '../paths.js'
import {
  isReferenceId,
  mediaContentDigest,
  mediaHandleOf,
  normalizeMediaHandle,
  sha256Digest,
} from '../timeline/nativeProjectFields.js'

const DURATION_TOLERANCE_SEC = 0.15

function mapResolverError(error) {
  if (error instanceof ClipDomainError) return error
  const code = error?.code
  if (code === 'needs-provider') {
    return new ClipDomainError('media-resolver-unavailable', 'The required Host media provider is unavailable.')
  }
  if (code === 'media-version-mismatch') {
    return new ClipDomainError('media-version-mismatch', 'Media content digest no longer matches the expected version.')
  }
  if (code === 'media-not-found') {
    return new ClipDomainError('media-not-found', 'The requested media file was not found.')
  }
  if (code === 'access-denied' || code === 'outside-project-boundary') {
    return new ClipDomainError('access-denied', 'Access to the requested media file was denied.')
  }
  if (code === 'unsupported-media') {
    return new ClipDomainError('unsupported-media', 'The requested media file type is unsupported.')
  }
  if (code === 'invalid-media-handle') {
    return new ClipDomainError('invalid-media-handle', 'The media handle is invalid.')
  }
  if (code === 'media-changed') {
    return new ClipDomainError('media-changed', 'The media file changed while being read.')
  }
  throw error
}

function canonicalSourceIdOf(handle) {
  if (!handle) return undefined
  if (handle.scope === 'project-asset') {
    return handle.assetId ? `project:${handle.workspaceId}:${handle.assetId}` : `project:${handle.workspaceId}:${handle.rel}`
  }
  if (handle.scope === 'library-file') {
    return `library:${handle.libraryAssetId}:${handle.fileId}`
  }
  if (handle.scope === 'clip-vault') {
    return `vault:${handle.sha256}`
  }
  return `canvas:${handle.workspaceId}:${handle.nodeId}:${handle.outputIndex}`
}

function projectAssetUrlOf(handle) {
  if (handle?.scope !== 'project-asset') return undefined
  const base = `/omnimux-workflow/api/workspaces/${encodeURIComponent(handle.workspaceId)}/file?rel=${encodeURIComponent(handle.rel)}`
  return handle.sha256 ? `${base}&rev=${encodeURIComponent(`sha256:${handle.sha256}`)}` : base
}

function normalizedDisplayName(value) {
  if (typeof value !== 'string') return ''
  return value.trim().toLowerCase()
}

function baseFileName(value) {
  const normalized = normalizedDisplayName(value)
  if (!normalized) return ''
  const tail = normalized.split(/[/\\]/u).at(-1) ?? normalized
  return tail.replace(/\.[a-z0-9]{1,8}$/iu, '')
}

function durationCompatible(item, source) {
  const itemDuration = item?.metadata?.duration
  if (!Number.isFinite(itemDuration) || itemDuration <= 0) return true
  if (!Number.isFinite(source?.durationMs) || source.durationMs <= 0) return true
  return Math.abs(itemDuration - source.durationMs / 1000) <= DURATION_TOLERANCE_SEC
}

function sameHandle(left, right) {
  if (!left || !right || left.scope !== right.scope || left.v !== right.v) return false
  if (left.sha256 !== right.sha256) return false
  if (left.scope === 'project-asset') {
    return left.workspaceId === right.workspaceId && left.rel === right.rel && left.assetId === right.assetId
  }
  if (left.scope === 'library-file') {
    return left.libraryAssetId === right.libraryAssetId && left.fileId === right.fileId
  }
  if (left.scope === 'clip-vault') {
    return left.mimeType === right.mimeType && left.size === right.size
  }
  return left.workspaceId === right.workspaceId && left.nodeId === right.nodeId && left.outputIndex === right.outputIndex
}

function requireAuthorizedBinding(envelope, requestedBinding, sessionId, getWorkflowClip) {
  const binding = requestedBinding === undefined ? envelope.binding : readCanvasBinding(envelope.projectId, requestedBinding)
  if (envelope.binding && !sameBinding(envelope.binding, binding)) {
    throw new ClipDomainError('clip-binding-mismatch', 'The Clip project belongs to another composition node.')
  }
  if (binding) {
    if (!sessionId) {
      throw new ClipDomainError('WINDOW_UNAUTHORIZED', 'An authenticated Clip window in the canvas conversation is required.')
    }
    const workflow = getWorkflowClip?.()
    resolveWorkflowBinding(workflow, binding, sessionId)
    return { binding, workflow }
  }
  return { binding: undefined, workflow: undefined }
}

/**
 * Resolve and open a verified read-only media byte stream for one project MediaItem.
 */
export async function resolveProjectMediaStream(
  { store, getMediaResolver, getWorkflowClip },
  { projectId, mediaId, sessionId, signal },
) {
  const id = assertProjectId(projectId)
  if (!isReferenceId(mediaId)) throw ClipDomainError.invalidId('invalid media id')
  const envelope = store.load(id)
  const { binding } = requireAuthorizedBinding(envelope, undefined, sessionId, getWorkflowClip)
  const item = envelope.project.mediaLibrary.items.find((entry) => entry.id === mediaId)
  if (!item) throw new ClipDomainError('media-not-found', `Media item not found: ${mediaId}`)

  const handle = mediaHandleOf(item, binding?.workspaceId)
  if (!handle) {
    throw new ClipDomainError('media-not-found', 'Media item has no resolvable Host media handle.')
  }
  const resolver = getMediaResolver?.()
  if (!resolver || typeof resolver.open !== 'function') {
    throw new ClipDomainError('media-resolver-unavailable', 'Host media resolver is unavailable.')
  }
  const expectedDigest = mediaContentDigest(item)
  const effectiveHandle = expectedDigest ? { ...handle, sha256: expectedDigest } : handle
  try {
    const stream = await resolver.open(effectiveHandle, { sessionId, projectBinding: binding }, signal)
    return { stream, item, envelope }
  } catch (error) {
    throw mapResolverError(error)
  }
}

function matchUpstreamCandidates(item, upstreamSources, expectedDigest) {
  const sameType = upstreamSources.filter((source) => source.materialType === item.type)
  if (!sameType.length) return []

  const fingerprint = item.sourceRef?.fingerprint
  const sourceId = item.omnimuxSource?.id
  const byIdentity = sameType.filter((source) => {
    const fps = source.legacyFingerprints ?? []
    if (fingerprint && fps.includes(fingerprint)) return true
    if (sourceId && fps.includes(sourceId)) return true
    if (expectedDigest && source.currentSha256 === expectedDigest) return true
    return false
  })
  if (byIdentity.length) return byIdentity

  // Only unsigned historical items may fall back to name + type matching.
  if (expectedDigest) return []
  const itemName = normalizedDisplayName(item.name)
  const itemBase = baseFileName(item.name)
  if (!itemName) return []
  const byExactName = sameType.filter((source) => normalizedDisplayName(source.name) === itemName)
  if (byExactName.length) return byExactName
  return sameType.filter((source) => itemBase && baseFileName(source.name) === itemBase)
}

function buildUpgradedMediaItem(item, { canonicalHandle, currentSha256, suggestedSourceNodeId, outputIndex }) {
  const existingSource = item.omnimuxSource
  const stableId = existingSource?.id
    ?? item.sourceRef?.fingerprint
    ?? (suggestedSourceNodeId ? `${canonicalHandle.workspaceId}:${suggestedSourceNodeId}:${outputIndex ?? 0}` : undefined)
    ?? canonicalSourceIdOf(canonicalHandle)
    ?? item.id
  const safeUrl = projectAssetUrlOf(canonicalHandle)
  return {
    ...item,
    omnimuxSource: {
      id: stableId,
      version: `sha256:${currentSha256}`,
      digest: currentSha256,
      handle: canonicalHandle,
      ...(safeUrl ? { url: safeUrl } : {}),
    },
    sourceRef: {
      ...(item.sourceRef ?? {}),
      kind: 'indexeddb',
      key: item.id,
      digest: currentSha256,
    },
  }
}

async function safeResolverStat(resolver, handle, auth, signal) {
  if (!resolver || typeof resolver.stat !== 'function') {
    return { status: 'unavailable', exists: false }
  }
  try {
    return await resolver.stat(handle, auth, signal)
  } catch (error) {
    if (error?.code === 'needs-provider') return { status: 'unavailable', exists: false }
    throw mapResolverError(error)
  }
}

/**
 * Inspect or safely apply Host-side media reconciliation for a Clip project.
 */
export async function reconcileProjectMedia(
  { store, getMediaResolver, getWorkflowClip },
  { projectId, mode = 'inspect', binding: requestedBinding, actions, sessionId, signal },
) {
  const id = assertProjectId(projectId)
  if (mode !== 'inspect' && mode !== 'apply') {
    throw ClipDomainError.invalidJson('reconcile mode must be "inspect" or "apply".')
  }
  if (actions !== undefined && !Array.isArray(actions)) {
    throw ClipDomainError.invalidJson('reconcile actions must be an array.')
  }
  const envelope = store.load(id)
  const { binding, workflow } = requireAuthorizedBinding(envelope, requestedBinding, sessionId, getWorkflowClip)
  const resolver = getMediaResolver?.()
  const auth = { sessionId, projectBinding: binding }

  let upstreamSources = []
  if (binding && typeof workflow?.listUpstreamSources === 'function') {
    const listed = await workflow.listUpstreamSources(binding, sessionId, signal)
    upstreamSources = Array.isArray(listed?.sources) ? listed.sources : []
  }

  const matchedUpstreamKeys = new Set()
  const upstreamKeyOf = (source) => `${source.sourceNodeId}:${source.outputIndex}`
  const reportItems = []
  const upgradeProposals = new Map()

  for (const item of envelope.project.mediaLibrary.items) {
    signal?.throwIfAborted()
    const explicitHandle = normalizeMediaHandle(item.omnimuxSource?.handle, binding?.workspaceId)
    const derivedHandle = explicitHandle ?? mediaHandleOf(item, binding?.workspaceId)
    const expectedDigest = mediaContentDigest(item)

    let report
    if (derivedHandle) {
      const probeHandle = expectedDigest ? { ...derivedHandle, sha256: expectedDigest } : derivedHandle
      const st = await safeResolverStat(resolver, probeHandle, auth, signal)
      if (st.status === 'ok' && st.canonicalHandle && st.currentSha256) {
        const matchedSource = upstreamSources.find((src) => sameHandle(src.canonicalHandle, st.canonicalHandle) || src.currentSha256 === st.currentSha256)
        if (matchedSource) matchedUpstreamKeys.add(upstreamKeyOf(matchedSource))
        if (expectedDigest) {
          report = {
            mediaId: item.id,
            name: item.name,
            type: item.type,
            reconcileState: 'online_exact',
            recoverable: true,
            currentSha256: st.currentSha256,
            canonicalHandle: st.canonicalHandle,
            ...(matchedSource ? { suggestedSourceNodeId: matchedSource.sourceNodeId } : {}),
          }
          if (!explicitHandle || !sameHandle(explicitHandle, st.canonicalHandle)) {
            upgradeProposals.set(item.id, {
              reason: 'persist_handle',
              canonicalHandle: st.canonicalHandle,
              currentSha256: st.currentSha256,
              suggestedSourceNodeId: matchedSource?.sourceNodeId,
              outputIndex: matchedSource?.outputIndex,
            })
          }
        } else if (!matchedSource || durationCompatible(item, matchedSource)) {
          report = {
            mediaId: item.id,
            name: item.name,
            type: item.type,
            reconcileState: 'legacy_unsigned_exact',
            recoverable: true,
            currentSha256: st.currentSha256,
            canonicalHandle: st.canonicalHandle,
            ...(matchedSource ? { suggestedSourceNodeId: matchedSource.sourceNodeId } : {}),
          }
          upgradeProposals.set(item.id, {
            reason: 'legacy_unsigned_exact',
            canonicalHandle: st.canonicalHandle,
            currentSha256: st.currentSha256,
            suggestedSourceNodeId: matchedSource?.sourceNodeId,
            outputIndex: matchedSource?.outputIndex,
          })
        } else {
          report = {
            mediaId: item.id,
            name: item.name,
            type: item.type,
            reconcileState: 'legacy_ambiguous',
            recoverable: false,
            candidates: matchedSource ? [matchedSource.sourceNodeId] : [],
          }
        }
      } else if (st.status === 'digest_mismatch' && st.currentSha256) {
        const matchedSource = upstreamSources.find((src) => sameHandle(src.canonicalHandle, st.canonicalHandle) || src.currentSha256 === st.currentSha256)
        if (matchedSource) matchedUpstreamKeys.add(upstreamKeyOf(matchedSource))
        report = {
          mediaId: item.id,
          name: item.name,
          type: item.type,
          reconcileState: 'source_drifted',
          recoverable: false,
          expectedSha256: expectedDigest,
          currentSha256: st.currentSha256,
          canonicalHandle: st.canonicalHandle,
          ...(matchedSource ? { suggestedSourceNodeId: matchedSource.sourceNodeId } : {}),
        }
      }
    }

    if (!report && upstreamSources.length > 0) {
      const candidates = matchUpstreamCandidates(item, upstreamSources, expectedDigest)
      if (candidates.length === 1) {
        const match = candidates[0]
        matchedUpstreamKeys.add(upstreamKeyOf(match))
        if (expectedDigest) {
          if (match.currentSha256 === expectedDigest) {
            report = {
              mediaId: item.id,
              name: item.name,
              type: item.type,
              reconcileState: 'online_exact',
              recoverable: true,
              currentSha256: match.currentSha256,
              canonicalHandle: match.canonicalHandle,
              suggestedSourceNodeId: match.sourceNodeId,
            }
            upgradeProposals.set(item.id, {
              reason: 'persist_handle',
              canonicalHandle: match.canonicalHandle,
              currentSha256: match.currentSha256,
              suggestedSourceNodeId: match.sourceNodeId,
              outputIndex: match.outputIndex,
            })
          } else {
            report = {
              mediaId: item.id,
              name: item.name,
              type: item.type,
              reconcileState: 'source_drifted',
              recoverable: false,
              expectedSha256: expectedDigest,
              currentSha256: match.currentSha256,
              canonicalHandle: match.canonicalHandle,
              suggestedSourceNodeId: match.sourceNodeId,
            }
          }
        } else if (durationCompatible(item, match)) {
          report = {
            mediaId: item.id,
            name: item.name,
            type: item.type,
            reconcileState: 'legacy_unsigned_exact',
            recoverable: true,
            currentSha256: match.currentSha256,
            canonicalHandle: match.canonicalHandle,
            suggestedSourceNodeId: match.sourceNodeId,
          }
          upgradeProposals.set(item.id, {
            reason: 'legacy_unsigned_exact',
            canonicalHandle: match.canonicalHandle,
            currentSha256: match.currentSha256,
            suggestedSourceNodeId: match.sourceNodeId,
            outputIndex: match.outputIndex,
          })
        } else {
          report = {
            mediaId: item.id,
            name: item.name,
            type: item.type,
            reconcileState: 'legacy_ambiguous',
            recoverable: false,
            candidates: [match.sourceNodeId],
          }
        }
      } else if (candidates.length > 1) {
        report = {
          mediaId: item.id,
          name: item.name,
          type: item.type,
          reconcileState: 'legacy_ambiguous',
          recoverable: false,
          candidates: candidates.map((c) => c.sourceNodeId),
        }
      }
    }

    if (!report) {
      report = {
        mediaId: item.id,
        name: item.name,
        type: item.type,
        reconcileState: 'missing_unlinked',
        recoverable: false,
      }
    }
    reportItems.push(report)
  }

  const unimportedUpstreams = upstreamSources
    .filter((source) => !matchedUpstreamKeys.has(upstreamKeyOf(source)))
    .map((source) => ({
      sourceNodeId: source.sourceNodeId,
      outputIndex: source.outputIndex,
      materialType: source.materialType,
      name: source.name,
      ...(source.durationMs !== undefined ? { durationMs: source.durationMs } : {}),
      canonicalHandle: source.canonicalHandle,
      currentSha256: source.currentSha256,
    }))

  if (mode === 'inspect') {
    return {
      projectId: id,
      revision: envelope.revision,
      upgradedMediaIds: [],
      items: reportItems,
      unimportedUpstreams,
    }
  }

  // `mode === 'apply'`: compute concrete item upgrades.
  const updates = new Map()
  if (actions === undefined) {
    for (const [mediaId, proposal] of upgradeProposals.entries()) {
      updates.set(mediaId, proposal)
    }
  } else {
    for (const action of actions) {
      if (!action || typeof action !== 'object' || !isReferenceId(action.mediaId)) {
        throw ClipDomainError.invalidJson('Each reconcile action requires a valid mediaId.')
      }
      const targetItem = envelope.project.mediaLibrary.items.find((row) => row.id === action.mediaId)
      if (!targetItem) throw new ClipDomainError('media-not-found', `Media item not found: ${action.mediaId}`)
      if (action.action === 'auto_upgrade_legacy') {
        const proposal = upgradeProposals.get(action.mediaId)
        if (proposal) updates.set(action.mediaId, proposal)
      } else if (action.action === 'sync_from_upstream') {
        const outputIndex = action.outputIndex === undefined ? 0 : action.outputIndex
        const source = upstreamSources.find((src) => src.sourceNodeId === action.sourceNodeId && src.outputIndex === outputIndex)
        if (!source) throw new ClipDomainError('media-not-found', 'Requested upstream canvas source was not found.')
        if (source.materialType !== targetItem.type) {
          throw new ClipDomainError('unsupported-media', 'Upstream source media type does not match the target item.')
        }
        updates.set(action.mediaId, {
          reason: 'sync_from_upstream',
          canonicalHandle: source.canonicalHandle,
          currentSha256: source.currentSha256,
          suggestedSourceNodeId: source.sourceNodeId,
          outputIndex: source.outputIndex,
        })
      } else if (action.action === 'rebind_handle') {
        const normalized = normalizeMediaHandle(action.handle, binding?.workspaceId)
        if (!normalized) throw new ClipDomainError('invalid-media-handle', 'rebind_handle requires a valid MediaHandle v1.')
        const st = await safeResolverStat(resolver, normalized, auth, signal)
        if (st.status !== 'ok' || !st.canonicalHandle || !st.currentSha256) {
          throw new ClipDomainError(
            st.status === 'digest_mismatch' ? 'media-version-mismatch' : st.status === 'access_denied' ? 'access-denied' : 'media-not-found',
            'Target handle could not be verified.',
          )
        }
        updates.set(action.mediaId, {
          reason: 'rebind_handle',
          canonicalHandle: st.canonicalHandle,
          currentSha256: st.currentSha256,
        })
      } else {
        throw ClipDomainError.invalidJson(`Unsupported reconcile action: ${String(action.action)}`)
      }
    }
  }

  if (updates.size === 0) {
    return {
      projectId: id,
      revision: envelope.revision,
      upgradedMediaIds: [],
      items: reportItems,
      unimportedUpstreams,
    }
  }

  const nextItems = envelope.project.mediaLibrary.items.map((item) => {
    const patch = updates.get(item.id)
    return patch ? buildUpgradedMediaItem(item, patch) : item
  })
  const nextProject = {
    ...envelope.project,
    mediaLibrary: {
      ...envelope.project.mediaLibrary,
      items: nextItems,
    },
  }
  const saved = store.save(id, nextProject, {
    expectedRevision: envelope.revision,
    revision: envelope.revision + 1,
    binding,
    backupCurrent: true,
  })
  if (binding && typeof workflow?.saveDraft === 'function') {
    workflow.saveDraft({ ...binding, revision: saved.revision })
  }
  const upgradedMediaIds = [...updates.keys()]
  const updatedReportItems = reportItems.map((entry) => {
    const patch = updates.get(entry.mediaId)
    if (!patch) return entry
    return {
      ...entry,
      reconcileState: 'online_exact',
      recoverable: true,
      currentSha256: patch.currentSha256,
      canonicalHandle: patch.canonicalHandle,
      upgraded: true,
    }
  })
  return {
    projectId: id,
    revision: saved.revision,
    upgradedMediaIds,
    items: updatedReportItems,
    unimportedUpstreams,
    project: saved.project,
  }
}
