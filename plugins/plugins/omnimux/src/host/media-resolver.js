/**
 * Neutral federated media resolver seam (`mediaResolver`).
 *
 * The execution hub owns ONLY the stateless scope registry and handle
 * validation. Domain plugins register their own storage-backed providers
 * via `ctx.effect(() => mediaResolver.registerProvider(...))` and keep
 * full ownership of their files, ledgers, and workspace/session ACLs.
 */

export const MEDIA_HANDLE_SCOPES = Object.freeze([
  'project-asset',
  'library-file',
  'clip-vault',
  'canvas-node',
])

const SCOPE_SET = new Set(MEDIA_HANDLE_SCOPES)
const SHA256_RE = /^[a-f0-9]{64}$/u
const WORKSPACE_ID_RE = /^ws_[A-Za-z0-9_-]{1,128}$/u
const REF_ID_RE = /^[\p{L}\p{N}_.:-]{1,256}$/u
const FORBIDDEN_SCHEME_RE = /^(?:blob|data|file|javascript|https?):/iu
const MIME_RE = /^(?:video|audio|image)\/[a-z0-9.+-]+$/iu

export class MediaResolverError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message)
    this.name = 'MediaResolverError'
    this.code = code
  }
}

function isPlainRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
}

function isRefId(value) {
  return typeof value === 'string' && REF_ID_RE.test(value) && !FORBIDDEN_SCHEME_RE.test(value)
}

function isSafeRelativePosixPath(value) {
  if (typeof value !== 'string' || !value || value.length > 2048) return false
  if (value.startsWith('/') || value.includes('\\') || /[\x00-\x1f\x7f]/u.test(value)) return false
  const parts = value.split('/')
  return parts.every((part) => part && part !== '.' && part !== '..' && !part.includes(':'))
}

/**
 * Validate and normalize a version-1 MediaHandle.
 * Returns a clean defensive copy, or throws `MediaResolverError('invalid-media-handle', ...)`.
 *
 * @param {unknown} raw
 */
export function validateMediaHandle(raw) {
  if (!isPlainRecord(raw) || raw.v !== 1 || typeof raw.scope !== 'string' || !SCOPE_SET.has(raw.scope)) {
    throw new MediaResolverError('invalid-media-handle', 'Media handle must be a valid v1 handle with a known scope.')
  }
  let sha256
  if (raw.sha256 !== undefined) {
    if (typeof raw.sha256 !== 'string' || !SHA256_RE.test(raw.sha256)) {
      throw new MediaResolverError('invalid-media-handle', 'Media handle sha256 must be 64 lowercase hex characters.')
    }
    sha256 = raw.sha256
  }
  if (raw.scope === 'project-asset') {
    if (typeof raw.workspaceId !== 'string' || !WORKSPACE_ID_RE.test(raw.workspaceId)) {
      throw new MediaResolverError('invalid-media-handle', 'project-asset handle requires a valid workspaceId.')
    }
    if (!isSafeRelativePosixPath(raw.rel)) {
      throw new MediaResolverError('invalid-media-handle', 'project-asset handle requires a safe project-relative POSIX path.')
    }
    if (raw.assetId !== undefined && !isRefId(raw.assetId)) {
      throw new MediaResolverError('invalid-media-handle', 'project-asset assetId must be a valid reference ID.')
    }
    return {
      v: 1,
      scope: 'project-asset',
      workspaceId: raw.workspaceId,
      ...(raw.assetId !== undefined ? { assetId: raw.assetId } : {}),
      rel: raw.rel,
      ...(sha256 ? { sha256 } : {}),
    }
  }
  if (raw.scope === 'library-file') {
    if (!isRefId(raw.libraryAssetId) || !isRefId(raw.fileId)) {
      throw new MediaResolverError('invalid-media-handle', 'library-file handle requires valid libraryAssetId and fileId.')
    }
    return {
      v: 1,
      scope: 'library-file',
      libraryAssetId: raw.libraryAssetId,
      fileId: raw.fileId,
      ...(sha256 ? { sha256 } : {}),
    }
  }
  if (raw.scope === 'clip-vault') {
    if (!sha256) {
      throw new MediaResolverError('invalid-media-handle', 'clip-vault handle requires a 64-hex sha256 digest.')
    }
    if (typeof raw.mimeType !== 'string' || !MIME_RE.test(raw.mimeType) || /^image\/svg/iu.test(raw.mimeType)) {
      throw new MediaResolverError('invalid-media-handle', 'clip-vault handle requires a supported non-SVG media mimeType.')
    }
    if (!Number.isSafeInteger(raw.size) || raw.size <= 0) {
      throw new MediaResolverError('invalid-media-handle', 'clip-vault handle requires a positive integer size.')
    }
    return {
      v: 1,
      scope: 'clip-vault',
      sha256,
      mimeType: raw.mimeType.toLowerCase(),
      size: raw.size,
    }
  }
  // canvas-node
  if (typeof raw.workspaceId !== 'string' || !WORKSPACE_ID_RE.test(raw.workspaceId)) {
    throw new MediaResolverError('invalid-media-handle', 'canvas-node handle requires a valid workspaceId.')
  }
  if (!isRefId(raw.nodeId)) {
    throw new MediaResolverError('invalid-media-handle', 'canvas-node handle requires a valid nodeId.')
  }
  const outputIndex = raw.outputIndex === undefined ? 0 : raw.outputIndex
  if (!Number.isSafeInteger(outputIndex) || outputIndex < 0 || outputIndex > 256) {
    throw new MediaResolverError('invalid-media-handle', 'canvas-node outputIndex must be a small nonnegative integer.')
  }
  return {
    v: 1,
    scope: 'canvas-node',
    workspaceId: raw.workspaceId,
    nodeId: raw.nodeId,
    outputIndex,
    ...(sha256 ? { sha256 } : {}),
  }
}

/**
 * Create the neutral `mediaResolver` seam registered via `ctx.provide('mediaResolver', ...)`.
 */
export function createMediaResolver() {
  /** @type {Map<string, { scope: string, stat: Function, open: Function }>} */
  const providers = new Map()

  function registerProvider(provider) {
    if (!provider || typeof provider !== 'object' || !SCOPE_SET.has(provider.scope)
      || typeof provider.stat !== 'function' || typeof provider.open !== 'function') {
      throw new MediaResolverError('invalid-provider', 'Media provider requires a known scope and stat/open functions.')
    }
    providers.set(provider.scope, provider)
    return () => {
      if (providers.get(provider.scope) === provider) {
        providers.delete(provider.scope)
      }
    }
  }

  function requireProvider(scope) {
    const provider = providers.get(scope)
    if (!provider) {
      throw new MediaResolverError('needs-provider', `No media provider is registered for scope "${scope}".`)
    }
    return provider
  }

  async function stat(rawHandle, auth = {}, signal) {
    const handle = validateMediaHandle(rawHandle)
    const provider = requireProvider(handle.scope)
    return provider.stat(handle, auth, signal)
  }

  async function open(rawHandle, auth = {}, signal) {
    const handle = validateMediaHandle(rawHandle)
    const provider = requireProvider(handle.scope)
    return provider.open(handle, auth, signal)
  }

  return {
    registerProvider,
    hasProvider: (scope) => providers.has(scope),
    scopes: () => [...providers.keys()],
    validateHandle: validateMediaHandle,
    stat,
    open,
  }
}
