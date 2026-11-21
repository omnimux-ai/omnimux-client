import { StorageEngine } from "@openreel/core";
import type { MediaRecord, MediaMetadata } from "@openreel/core";

const storage = new StorageEngine();
const mediaWrites = new Map<string, Promise<void>>();

async function writeMedia(mediaId: string, write: () => Promise<void>): Promise<void> {
  // Native projects publish their exact digest with the Blob before saving it.
  // Order writes to the legacy mutable cache key within this editor as well.
  const prior = mediaWrites.get(mediaId);
  const pending = prior ? prior.then(write, write) : write();
  mediaWrites.set(mediaId, pending);
  try {
    await pending;
  } finally {
    if (mediaWrites.get(mediaId) === pending) mediaWrites.delete(mediaId);
  }
}

export async function saveMediaBlob(
  projectId: string,
  mediaId: string,
  blob: Blob,
  metadata: MediaMetadata,
): Promise<void> {
  const record: MediaRecord = {
    id: mediaId,
    projectId,
    blob,
    metadata,
  };

  await writeMedia(mediaId, () => storage.saveMedia(record));
}

export async function loadMediaBlob(mediaId: string): Promise<Blob | null> {
  const record = await storage.loadMedia(mediaId);
  return record?.blob || null;
}

export async function loadMediaRecord(
  mediaId: string,
): Promise<MediaRecord | null> {
  return storage.loadMedia(mediaId);
}

export async function loadProjectMedia(
  projectId: string,
): Promise<MediaRecord[]> {
  return storage.getMediaByProject(projectId);
}

export async function deleteMediaBlob(mediaId: string): Promise<void> {
  await writeMedia(mediaId, () => storage.deleteMedia(mediaId));
}

export async function saveFileHandle(name: string, size: number, handle: FileSystemFileHandle): Promise<void> {
  await storage.saveFileHandle(name, size, handle);
}

export async function loadFileHandle(name: string, size: number): Promise<FileSystemFileHandle | null> {
  return storage.loadFileHandle(name, size);
}

export async function saveDirectoryHandle(projectId: string, handle: FileSystemDirectoryHandle): Promise<void> {
  await storage.saveDirectoryHandle(projectId, handle);
}

export async function loadDirectoryHandle(projectId: string): Promise<{ handle: FileSystemDirectoryHandle; folderName: string } | null> {
  return storage.loadDirectoryHandle(projectId);
}
