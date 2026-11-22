import type { MediaItem } from '@openreel/core'
import { loadMediaRecord } from '../openreel/web/services/media-storage'
import { verifiedMediaBlob } from './media-source'
import { readConfirmedMediaDrafts } from './persistence.js'

export function createStoredMediaRecovery(
  projectId: string, binding: Parameters<typeof readConfirmedMediaDrafts>[1], isCurrent: () => boolean,
) {
  let drafts: ReturnType<typeof readConfirmedMediaDrafts> | undefined
  const readDrafts = () => drafts ??= readConfirmedMediaDrafts(projectId, binding).catch(error => {
    console.warn('[Clip] Confirmed media drafts could not be read.', (error as Error)?.name)
    return []
  })

  return async (item: MediaItem, digest: string): Promise<Blob | undefined> => {
    if (!isCurrent()) return undefined
    const stored = await loadMediaRecord(item.sourceRef?.key ?? item.id).catch(error => {
      console.warn('[Clip] Shared media cache could not be read.', (error as Error)?.name)
      return null
    })
    if (!isCurrent()) return undefined
    if (stored?.projectId === (item.sourceRef?.projectId ?? projectId)) {
      const blob = await verifiedMediaBlob(stored.blob, digest)
      if (blob) return blob
    }
    if (!isCurrent()) return undefined

    // A confirmed draft can carry the bytes after another window has
    // overwritten the shared cache. Verify every candidate independently.
    for (const draft of await readDrafts()) {
      if (!isCurrent()) return undefined
      const blob = await verifiedMediaBlob(draft.media?.[item.id], digest)
      if (blob) return blob
    }
    return undefined
  }
}
