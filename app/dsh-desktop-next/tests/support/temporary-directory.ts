/**
 * Issue #311: a test's temporary directory is removed with a retry budget, so a
 * writer that is still settling cannot fail an otherwise green run.
 *
 * Work that writes under the temporary home outlives the assertions: the launch
 * analytics identity file, the single-instance claim and the diagnostics log are
 * written from callbacks that are still settling when a test's `finally` runs.
 * `rm(home, { recursive: true, force: true })` walks the tree and then calls
 * `rmdir` on a directory such a writer has refilled in the meantime, which fails
 * the suite with `ENOTEMPTY: directory not empty, rmdir '<home>/electron-user-data'`
 * instead of reporting a real regression. The window widens in the merge queue,
 * where several trees are built and tested at once.
 *
 * The asynchronous `fs.rm` honours `maxRetries`/`retryDelay` for this transient
 * (`ENOTEMPTY`, `EBUSY`, `EPERM`, `EMFILE`, `ENFILE`); its synchronous sibling does
 * not reliably wait out a recreating writer, so the helper is `async` and every
 * cleanup `await`s it. The error is still raised once the budget is spent: nothing
 * here swallows a directory that genuinely stays occupied.
 */
import { rm } from 'node:fs/promises'

/**
 * Removal budget for one temporary test directory: up to 5 retries with
 * 100-500 ms linear backoff (~1.5 s total) in Node `fs/promises.rm`.
 */
export const TEMPORARY_DIRECTORY_REMOVAL = Object.freeze({
  recursive: true,
  force: true,
  maxRetries: 5,
  retryDelay: 100,
} as const)

/** The `fs.rm` options this helper relies on; a test may model a race against them. */
export interface TemporaryDirectoryRemovalOptions {
  readonly recursive: true
  readonly force: true
  readonly maxRetries: number
  readonly retryDelay: number
}

/** Remover seam: the production default is `fs/promises.rm`, tests inject the transient failure. */
export type TemporaryDirectoryRemover = (
  path: string,
  options: TemporaryDirectoryRemovalOptions,
) => Promise<void> | void

/**
 * Delete a directory this test created under `tmpdir()`, waiting out writers that
 * are still settling. Never wrap this in a `try`/`catch` that ignores `ENOTEMPTY`:
 * a directory that stays occupied is a real failure, not noise.
 */
export async function removeTemporaryDirectory(
  path: string,
  remove: TemporaryDirectoryRemover = rm,
): Promise<void> {
  await remove(path, TEMPORARY_DIRECTORY_REMOVAL)
}
