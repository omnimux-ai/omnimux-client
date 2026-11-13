/**
 * 针对指定路径或资源的异步互斥锁
 */
export class AsyncMutex {
  private queue: Promise<void> = Promise.resolve();

  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    let release: () => void;
    const nextTicket = new Promise<void>((resolve) => {
      release = resolve;
    });

    const currentTicket = this.queue;
    this.queue = this.queue.then(() => nextTicket);

    await currentTicket;
    try {
      return await fn();
    } finally {
      release!();
    }
  }
}
