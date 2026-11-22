import { constants, type BigIntStats } from 'node:fs';
import { open, stat, type FileHandle } from 'node:fs/promises';

export function fileIdentity(stat: BigIntStats): string {
  return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');
}

export async function openRegularFile(path: string, signal?: AbortSignal, noFollow = false) {
  signal?.throwIfAborted();
  // O_NONBLOCK has no effect on regular files and avoids waiting on a pipe
  // that was swapped into the path before open. Check the opened inode too.
  const flags = constants.O_RDONLY | constants.O_NONBLOCK | (noFollow ? constants.O_NOFOLLOW ?? 0 : 0);
  const handle = await open(path, flags);
  try {
    signal?.throwIfAborted();
    const stat = await handle.stat({ bigint: true });
    signal?.throwIfAborted();
    if (!stat.isFile()) throw Object.assign(new Error('path is not a regular file'), { code: 'not-a-file' });
    return { handle, stat };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

export async function withRegularFile<T>(path: string, signal: AbortSignal | undefined,
  read: (handle: FileHandle, stat: BigIntStats) => Promise<T>, noFollow = false): Promise<T> {
  const { handle, stat } = await openRegularFile(path, signal, noFollow);
  try {
    return await read(handle, stat);
  } finally {
    await handle.close();
  }
}

export async function mapConcurrent<T, R>(items: readonly T[], limit: number,
  map: (item: T) => Promise<R>, signal?: AbortSignal): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = await Promise.allSettled(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      signal?.throwIfAborted();
      const index = next++;
      results[index] = await map(items[index]!);
    }
  }));
  const failure = workers.find(worker => worker.status === 'rejected');
  if (failure) throw failure.reason;
  return results;
}

async function waitForFileWork<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  signal.throwIfAborted();
  let onAbort: (() => void) | undefined;
  try {
    return await new Promise<T>((resolve, reject) => {
      onAbort = () => reject(signal.reason);
      signal.addEventListener('abort', onAbort, { once: true });
      promise.then(resolve, reject);
    });
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
  }
}

/** Share in-flight work without tying its lifetime to the first caller's socket. */
export class SharedFileWork<T> {
  private readonly active = new Map<string, {
    controller: AbortController;
    promise: Promise<T>;
    waiters: number;
  }>();

  async run(key: string, signal: AbortSignal | undefined, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    signal?.throwIfAborted();
    let entry = this.active.get(key);
    while (entry?.controller.signal.aborted) {
      // A cancelled open may still be in the kernel. Keep later requests from
      // starting more copies until this slot has actually been released.
      await waitForFileWork(entry.promise.then(() => undefined, () => undefined), signal);
      entry = this.active.get(key);
    }
    signal?.throwIfAborted();
    if (!entry) {
      const controller = new AbortController();
      const promise = Promise.resolve().then(() => work(controller.signal)).finally(() => this.active.delete(key));
      entry = { controller, promise, waiters: 0 };
      this.active.set(key, entry);
    }
    const task = entry;
    task.waiters++;
    try {
      return await waitForFileWork(task.promise, signal);
    } finally {
      if (--task.waiters === 0 && this.active.get(key) === task) task.controller.abort();
    }
  }
}

export async function statIfPresent(path: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const info = await stat(path, { bigint: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
    throw error;
  });
  signal?.throwIfAborted();
  return info;
}

/** One job at a time, including when a native I/O call cannot be interrupted. */
export class SerialFileWork {
  private tail = Promise.resolve();

  run<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
    const result = this.tail.then(() => {
      signal.throwIfAborted();
      return work();
    });
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }
}
