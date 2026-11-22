import { ClipDomainError } from '../../errors.js'
import { mediaContentDigest, sourceIdentity } from '../../timeline/nativeProjectFields.js'
import { getMediaEngine } from '../openreel/core/media/mediabunny-engine'
import type { MediaItem, Project } from '../openreel/core/types/project'
import { fields, invalid, referenceId, text, type Fields } from './native-input'
import { mediaDigest } from './media-source'

export type NativeMediaSource = string | Readonly<Record<string, unknown>>
export interface ResolvedNativeMedia {
  file: File
  source: NativeMediaSource
}

interface VerifiedSource {
  versioned: NonNullable<MediaItem['omnimuxSource']>
  reference: { fingerprint: string; contentVersion: string | number; digest: string }
}

async function verifiedSource(resolved: ResolvedNativeMedia): Promise<VerifiedSource> {
  const { file, source } = resolved
  const sourceFields = typeof source === 'string' ? { ref: source } : fields(source, 'verified media source')
  const providedFingerprint = typeof sourceFields.fingerprint === 'string' && /^[a-f0-9]{64}$/.test(sourceFields.fingerprint)
    ? sourceFields.fingerprint : undefined
  const identity = sourceFields.id ?? sourceFields.ref ?? sourceFields.key ?? sourceFields.assetId
    ?? sourceFields.path ?? sourceFields.url ?? sourceFields.sourceUrl
  if (!providedFingerprint && !(typeof identity === 'string' && identity.trim() && identity.length <= 4096)) {
    throw ClipDomainError.pathDenied('The resolver must return a verified media identity')
  }
  const fingerprint = providedFingerprint ?? await mediaDigest(JSON.stringify([sourceFields.kind ?? '', identity]))
  const digest = await mediaDigest(file)
  const sourceVersion = sourceFields.version ?? sourceFields.contentVersion ?? sourceFields.revision
  const contentVersion = sourceVersion === undefined ? digest
    : typeof sourceVersion === 'number' && Number.isSafeInteger(sourceVersion) && sourceVersion >= 0 ? sourceVersion
      : referenceId(sourceVersion, 'contentVersion')
  const version = String(contentVersion)
  const versioned = sourceIdentity({ id: sourceFields.id, version }) ?? { id: `source:${fingerprint}`, version }
  return { versioned, reference: { fingerprint, contentVersion, digest } }
}

export async function stageNativeMedia(
  project: Project,
  operation: Fields,
  resolveMedia: ((operation: Fields) => ResolvedNativeMedia | null | undefined | Promise<ResolvedNativeMedia | null | undefined>) | undefined,
  assertCurrent: () => void,
): Promise<{ item: MediaItem; reused: boolean }> {
  const requestedId = operation.mediaId === undefined ? undefined : referenceId(operation.mediaId, 'mediaId')
  const name = operation.name === undefined ? undefined : text(operation.name, 'name', 256).trim()
  const requestedType = operation.mediaType
  if (requestedType !== undefined && requestedType !== 'video' && requestedType !== 'audio' && requestedType !== 'image') {
    invalid('mediaType must be video, audio or image')
  }
  const resolved = await resolveMedia?.(operation)
  assertCurrent()
  if (typeof File === 'undefined' || !(resolved?.file instanceof File) || !resolved.source) {
    throw ClipDomainError.pathDenied('The media reference was not verified by the Host')
  }
  const { file } = resolved
  // The editable media pool accepts footage, sound and raster images. SVG and
  // project/script payloads are outside this seam even with a valid reference.
  if (/\.svgz?$/i.test(file.name) || /^image\/svg/i.test(file.type)) {
    throw ClipDomainError.pathDenied('Resolve a video, audio or raster image file')
  }
  let source: VerifiedSource
  try {
    source = await verifiedSource(resolved)
  } catch (error) {
    if (error instanceof ClipDomainError && error.code === 'path-denied') throw error
    throw ClipDomainError.pathDenied('The media resolver did not provide a valid content identity')
  }
  assertCurrent()
  const { reference, versioned } = source
  const existing = project.mediaLibrary.items.find(item => {
    if (item.omnimuxSource) {
      return item.omnimuxSource.id === versioned.id && item.omnimuxSource.version === versioned.version
    }
    return item.sourceRef?.fingerprint === reference.fingerprint && item.sourceRef?.contentVersion === reference.contentVersion
  })
  if (requestedId && project.mediaLibrary.items.some(item => item.id === requestedId && item !== existing)) {
    invalid('mediaId is already used by a different source')
  }
  const expectedDigest = mediaContentDigest(existing)
  if (expectedDigest && expectedDigest !== reference.digest) invalid('Media bytes changed for the same source version')
  if (existing && !existing.isPlaceholder && (existing.blob || existing.fileHandle)) {
    const blob = existing.blob ?? await existing.fileHandle?.getFile()
    if (requestedType && requestedType !== existing.type) invalid('mediaType does not match the source')
    if (blob && await mediaDigest(blob) !== reference.digest) invalid('Media bytes changed for the same source version')
    assertCurrent()
    return { item: existing, reused: true }
  }

  let metadata: Awaited<ReturnType<ReturnType<typeof getMediaEngine>['extractMetadata']>>
  const engine = getMediaEngine()
  try {
    await engine.initialize()
  } catch {
    throw new ClipDomainError('media-decode-failed', 'OpenReel could not initialize the media reader')
  }
  assertCurrent()
  try {
    metadata = await engine.extractMetadata(file)
  } catch {
    throw new ClipDomainError('media-decode-failed', 'OpenReel could not read the verified source media')
  }
  assertCurrent()
  const type = file.type.startsWith('image/') ? 'image' : metadata.hasVideo ? 'video' : 'audio'
  if (requestedType && requestedType !== type) invalid('mediaType does not match the source')
  if (type === 'image' ? !metadata.width || !metadata.height
    : !metadata.canDecode || !Number.isFinite(metadata.duration) || metadata.duration <= 0) {
    throw new ClipDomainError('media-decode-failed', 'OpenReel could not decode the verified source media')
  }
  const id = existing?.id ?? requestedId ?? crypto.randomUUID()
  const basename = file.name.split(/[/\\]/u).at(-1) || id
  const item: MediaItem = {
    ...existing,
    id,
    name: existing?.name ?? (name || basename),
    type,
    blob: file,
    fileHandle: null,
    isPlaceholder: false,
    missing: false,
    thumbnailUrl: null,
    waveformData: null,
    sourceFile: { name: basename, size: file.size, lastModified: file.lastModified },
    sourceRef: { kind: 'indexeddb', key: id, ...reference },
    omnimuxSource: { ...existing?.omnimuxSource, ...versioned },
    importedAt: existing?.importedAt ?? Date.now(),
    metadata: {
      duration: metadata.duration,
      width: metadata.width,
      height: metadata.height,
      frameRate: metadata.frameRate,
      codec: metadata.codec,
      sampleRate: metadata.sampleRate,
      channels: metadata.channels,
      fileSize: file.size,
      hasVideo: metadata.hasVideo,
      hasAudio: metadata.hasAudio,
      audioTrackCount: metadata.audioTrackCount,
      sourceColor: metadata.sourceColor,
    },
  }
  return { item, reused: false }
}
