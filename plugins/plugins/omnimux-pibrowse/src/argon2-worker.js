import { parentPort, workerData } from 'node:worker_threads'
import { argon2id } from '@noble/hashes/argon2'

if (parentPort && workerData) {
  try {
    const { password, salt, memoryKiB, iterations, parallelism, dkLen } = workerData
    const derived = argon2id(
      new Uint8Array(password),
      new Uint8Array(salt),
      {
        m: memoryKiB,
        t: iterations,
        p: parallelism,
        dkLen,
      },
    )
    parentPort.postMessage({ ok: true, key: Buffer.from(derived) })
  } catch (err) {
    parentPort.postMessage({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
