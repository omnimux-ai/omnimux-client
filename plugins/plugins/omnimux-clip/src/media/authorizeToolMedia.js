/**
 * Host-side media authorization for `clip_edit` (`import_media` and `relink_media`).
 *
 * Resolves workspace-bounded local paths, global asset library files, canvas
 * upstream nodes, and project assets through the shared Host seams
 * (`mediaResolver`, `workflowClip`, `assetLibrary`) and mints opaque transfer
 * URLs for handle-based sources without exposing host filesystem paths.
 */
import { realpathSync, statSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { ClipDomainError } from '../errors.js'
import { resolveWorkflowBinding } from '../live/command-broker.js'
import { getBuiltInEditingTemplate, getBuiltInGraphicTemplate, resolveCustomGraphicTemplate } from '../templates/catalog.js'

const LOCAL_MEDIA_ROUTE = '/omnimux-workflow/api/local-file'
const MEDIA_FILE_RE = /\.(?:mp4|m4v|mov|webm|mkv|avi|mp3|m4a|aac|wav|flac|ogg|opus|png|jpe?g|webp|gif|avif|bmp)$/i
const WORKSPACE_ID_RE = /^ws_[A-Za-z0-9_-]{1,128}$/u

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

export function workflowMediaUrl(source, cwd) {
  if (!cwd || typeof source !== 'string' || source.includes('\0')) {
    throw ClipDomainError.pathDenied('Select a file from the conversation workspace.')
  }
  let target = source
  if (source.startsWith(`${LOCAL_MEDIA_ROUTE}?`)) {
    target = new URL(source, 'http://localhost').searchParams.get('path')
  } else if (/^(?:[a-z][a-z\d+.-]*:\/\/|\/\/|(?:blob|data|file|javascript):)/i.test(source)) {
    throw ClipDomainError.pathDenied('Clip tools accept local workspace media references.')
  }
  if (!target) throw ClipDomainError.pathDenied('Select a file from the conversation workspace.')
  try {
    const root = realpathSync(cwd)
    const resolvedPath = realpathSync(resolve(root, target))
    const tail = relative(root, resolvedPath)
    if (!tail || tail === '..' || tail.startsWith(`..${sep}`) || isAbsolute(tail) || !MEDIA_FILE_RE.test(resolvedPath)) {
      throw new Error('Media is outside the workspace allowlist')
    }
    const stat = statSync(resolvedPath)
    if (!stat.isFile() || stat.size <= 0) throw new Error('Media is not a readable file')
    return `${LOCAL_MEDIA_ROUTE}?${new URLSearchParams({ path: resolvedPath, rev: `${stat.mtimeMs}:${stat.size}` })}`
  } catch {
    throw ClipDomainError.pathDenied('The media file is outside the conversation workspace or unsupported.')
  }
}

function mapStatFailure(status) {
  if (status === 'access_denied') {
    throw ClipDomainError.pathDenied('Access to the requested media handle was denied.')
  }
  if (status === 'not_found') {
    throw ClipDomainError.mediaMissing('The requested media file was not found.')
  }
  if (status === 'digest_mismatch') {
    throw new ClipDomainError('media-version-mismatch', 'The media content digest no longer matches the expected version.')
  }
  if (status === 'unsupported') {
    throw new ClipDomainError('unsupported-media', 'The requested media file type is unsupported.')
  }
  throw new ClipDomainError('media-resolver-unavailable', 'The required Host media provider is unavailable.')
}

function pickDefaultLibraryFileId(asset) {
  const files = Array.isArray(asset?.files) ? asset.files : []
  if (!files.length) return undefined
  const isMedia = (file) => file && !file.isDirectory && (
    ['video', 'audio', 'image'].includes(file.kind)
    || (typeof file.name === 'string' && MEDIA_FILE_RE.test(file.name))
  )
  const cover = asset.cover_file_id ? files.find((file) => file.id === asset.cover_file_id && isMedia(file)) : undefined
  const chosen = cover ?? files.find(isMedia) ?? files[0]
  return typeof chosen?.id === 'string' && chosen.id ? chosen.id : undefined
}

async function authorizeHandleSource({
  handle,
  fallbackName,
  command,
  sessionId,
  getMediaResolver,
  mediaTransfers,
  signal,
}) {
  const resolver = getMediaResolver?.()
  if (!resolver || typeof resolver.stat !== 'function') {
    throw new ClipDomainError('media-resolver-unavailable', 'Host media resolver is unavailable.')
  }
  if (!mediaTransfers || typeof mediaTransfers.mint !== 'function') {
    throw new ClipDomainError('media-resolver-unavailable', 'Host media transfer service is unavailable.')
  }
  let stat
  try {
    stat = await resolver.stat(handle, { sessionId, projectBinding: command.binding }, signal)
  } catch (error) {
    if (error instanceof ClipDomainError) throw error
    if (error?.code === 'access-denied' || error?.code === 'outside-project-boundary') {
      throw ClipDomainError.pathDenied('Access to the requested media handle was denied.')
    }
    if (error?.code === 'needs-provider') {
      throw new ClipDomainError('media-resolver-unavailable', 'The required Host media provider is unavailable.')
    }
    if (error?.code === 'invalid-media-handle') {
      throw ClipDomainError.invalidJson('The media handle is invalid.')
    }
    throw error
  }
  if (stat?.status !== 'ok' || !stat.canonicalHandle || !stat.currentSha256) {
    mapStatFailure(stat?.status)
  }
  const displayName = (typeof stat.displayName === 'string' && stat.displayName.trim())
    || (typeof fallbackName === 'string' && fallbackName.trim())
    || 'media'
  const { transferUrl } = mediaTransfers.mint({
    handle: stat.canonicalHandle,
    sha256: stat.currentSha256,
    mimeType: stat.mimeType,
    size: stat.size,
    displayName,
    sessionId,
    projectId: command.projectId,
    binding: command.binding,
  })
  return {
    transferUrl,
    handle: stat.canonicalHandle,
    sha256: stat.currentSha256,
    mimeType: stat.mimeType,
    name: displayName,
    sourceId: canonicalSourceIdOf(stat.canonicalHandle),
  }
}

async function authorizeSourceSelector(selector, {
  command,
  sessionId,
  cwd,
  getMediaResolver,
  getWorkflowClip,
  getAssetLibrary,
  mediaTransfers,
  signal,
  label,
}) {
  const { path, sourceUrl, libraryAssetId, fileId, canvasNodeId, outputIndex, projectAssetId, workspaceId: requestedWorkspaceId } = selector
  const hasPath = path !== undefined || sourceUrl !== undefined
  const hasLibrary = libraryAssetId !== undefined
  const hasCanvasNode = canvasNodeId !== undefined
  const hasProjectAsset = projectAssetId !== undefined
  const kindCount = Number(hasPath) + Number(hasLibrary) + Number(hasCanvasNode) + Number(hasProjectAsset)
  if (kindCount !== 1 || (path !== undefined && sourceUrl !== undefined)) {
    throw ClipDomainError.invalidJson(`${label} requires exactly one of path/sourceUrl, libraryAssetId, canvasNodeId, or projectAssetId.`)
  }
  if (fileId !== undefined && !hasLibrary) {
    throw ClipDomainError.invalidJson(`${label}.fileId requires libraryAssetId.`)
  }
  if (outputIndex !== undefined && !hasCanvasNode) {
    throw ClipDomainError.invalidJson(`${label}.outputIndex requires canvasNodeId.`)
  }
  if (requestedWorkspaceId !== undefined && !hasCanvasNode && !hasProjectAsset) {
    throw ClipDomainError.invalidJson(`${label}.workspaceId is only supported with canvasNodeId or projectAssetId.`)
  }

  if (hasPath) {
    return { sourceUrl: workflowMediaUrl(path ?? sourceUrl, cwd) }
  }

  if (hasLibrary) {
    let resolvedFileId = fileId
    let fallbackName
    if (!resolvedFileId) {
      const assetLibrary = getAssetLibrary?.()
      if (!assetLibrary || typeof assetLibrary.getAsset !== 'function') {
        throw new ClipDomainError('media-resolver-unavailable', 'Asset library service is unavailable.')
      }
      const asset = assetLibrary.getAsset(libraryAssetId)
      if (!asset) throw ClipDomainError.mediaMissing(`Library asset not found: ${libraryAssetId}`)
      resolvedFileId = pickDefaultLibraryFileId(asset)
      if (!resolvedFileId) throw ClipDomainError.mediaMissing(`Library asset has no media files: ${libraryAssetId}`)
      fallbackName = asset.name
    }
    const resolvedMedia = await authorizeHandleSource({
      handle: { v: 1, scope: 'library-file', libraryAssetId, fileId: resolvedFileId },
      fallbackName,
      command,
      sessionId,
      getMediaResolver,
      mediaTransfers,
      signal,
    })
    return { resolvedMedia }
  }

  // Canvas-node or project-asset reference: enforce strict workspace & session boundary.
  const binding = command.binding
  if (requestedWorkspaceId !== undefined) {
    if (!WORKSPACE_ID_RE.test(requestedWorkspaceId)) {
      throw ClipDomainError.invalidJson(`${label}.workspaceId is invalid.`)
    }
    if (binding && requestedWorkspaceId !== binding.workspaceId) {
      throw ClipDomainError.pathDenied('Cross-workspace media reference is denied.')
    }
  }
  const workspaceId = requestedWorkspaceId ?? binding?.workspaceId
  if (!workspaceId) {
    throw ClipDomainError.pathDenied('A canvas workspace binding is required to reference canvas or project assets.')
  }
  const workflow = getWorkflowClip?.()
  if (binding) {
    resolveWorkflowBinding(workflow, binding, sessionId)
  }

  if (hasCanvasNode) {
    const resolvedMedia = await authorizeHandleSource({
      handle: {
        v: 1,
        scope: 'canvas-node',
        workspaceId,
        nodeId: canvasNodeId,
        outputIndex: outputIndex ?? 0,
      },
      command,
      sessionId,
      getMediaResolver,
      mediaTransfers,
      signal,
    })
    return { resolvedMedia }
  }

  // projectAssetId
  if (!workflow || typeof workflow.resolveProjectAsset !== 'function') {
    throw new ClipDomainError('needs-workflow-clip', 'The canvas workflow service is unavailable.')
  }
  let asset
  try {
    asset = workflow.resolveProjectAsset(workspaceId, projectAssetId, sessionId)
  } catch (error) {
    if (error?.code === 'outside-project-boundary') {
      throw ClipDomainError.pathDenied('The requested project asset is outside this conversation workspace.')
    }
    throw error
  }
  if (!asset?.handle) {
    throw ClipDomainError.mediaMissing(`Project asset not found: ${projectAssetId}`)
  }
  const resolvedMedia = await authorizeHandleSource({
    handle: asset.handle,
    fallbackName: asset.name,
    command,
    sessionId,
    getMediaResolver,
    mediaTransfers,
    signal,
  })
  return { resolvedMedia }
}

/**
 * Authorize all media-bearing operations in a `clip_edit` command on the Host.
 */
export async function authorizeClipEditOperations(args, context) {
  const operations = []
  for (const op of args.operations) {
    if (op && typeof op === 'object' && Object.hasOwn(op, 'resolvedTemplate')) {
      throw ClipDomainError.invalidJson('resolvedTemplate is reserved for Host template resolution.')
    }
    if (op.type === 'import_media') {
      const {
        path, sourceUrl, libraryAssetId, fileId, canvasNodeId, outputIndex, projectAssetId, workspaceId,
        ...rest
      } = op
      const authorized = await authorizeSourceSelector(
        { path, sourceUrl, libraryAssetId, fileId, canvasNodeId, outputIndex, projectAssetId, workspaceId },
        { ...context, label: 'import_media' },
      )
      operations.push({ ...rest, ...authorized })
    } else if (op.type === 'relink_media') {
      const { source, ...rest } = op
      const authorized = await authorizeSourceSelector(source ?? {}, { ...context, label: 'relink_media.source' })
      operations.push({ ...rest, ...authorized })
    } else if (op.type === 'add_graphic_instance') {
      const hasBuiltin = op.templateId !== undefined
      const hasLibrary = op.libraryAssetId !== undefined
      if (Number(hasBuiltin) + Number(hasLibrary) !== 1) {
        throw ClipDomainError.invalidJson('add_graphic_instance requires exactly one of templateId or libraryAssetId.')
      }
      if (op.fileId !== undefined && !hasLibrary) {
        throw ClipDomainError.invalidJson('add_graphic_instance.fileId requires libraryAssetId.')
      }
      if (hasLibrary) {
        const { template, libraryAssetId, fileId } = await resolveCustomGraphicTemplate(
          { libraryAssetId: op.libraryAssetId, fileId: op.fileId },
          context,
        )
        const { libraryAssetId: _lib, fileId: _file, ...rest } = op
        operations.push({ ...rest, resolvedTemplate: template, customSource: { libraryAssetId, fileId } })
      } else {
        if (!getBuiltInGraphicTemplate(op.templateId)) {
          throw new ClipDomainError('template-not-found', `Graphic template not found: ${op.templateId}`)
        }
        operations.push(op)
      }
    } else if (op.type === 'apply_editing_template') {
      if (!getBuiltInEditingTemplate(op.templateId)) {
        throw new ClipDomainError('template-not-found', `Editing template not found: ${op.templateId}`)
      }
      operations.push(op)
    } else {
      operations.push(op)
    }
  }
  return { ...args, operations }
}
