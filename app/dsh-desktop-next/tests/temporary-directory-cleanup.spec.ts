/**
 * Issue #311: a test's temporary home under `tmpdir()` is removed with a retry
 * budget, so a writer that is still settling cannot fail an otherwise green run.
 *
 * The merge queue failed with `ENOTEMPTY: directory not empty, rmdir
 * '<home>/electron-user-data'`: the recursive walk deleted the entries it saw and
 * then called `rmdir` on a directory the launch-analytics identity, the
 * single-instance claim or the diagnostics log had refilled. This spec pins both
 * directions without depending on machine timing:
 *
 *  - the pre-fix call (no retry budget) aborts on that transient error;
 *  - `removeTemporaryDirectory` retries and still removes the tree;
 *  - a directory that never settles still fails loudly, so the helper can never
 *    become a `try`/`catch` that swallows `ENOTEMPTY`.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { afterEach, expect, it } from 'vitest'
import {
  TEMPORARY_DIRECTORY_REMOVAL,
  removeTemporaryDirectory,
  type TemporaryDirectoryRemovalOptions,
  type TemporaryDirectoryRemover,
} from './support/temporary-directory.ts'

const homes: string[] = []

function temporaryHome(prefix = 'next-temporary-directory-'): string {
  const home = mkdtempSync(join(tmpdir(), prefix))
  homes.push(home)
  return home
}

/**
 * The pre-fix cleanup this issue replaced: `rmSync(home, { recursive: true,
 * force: true })`. `fs.rmSync` treats the omitted retry options as `0`, which is
 * exactly the difference this regression pins, so the seam receives them spelled out.
 */
function legacyCleanup(home: string, fsRemove: TemporaryDirectoryRemover): void {
  const attempt = fsRemove(home, { recursive: true, force: true, maxRetries: 0, retryDelay: 0 })
  // The seam mirrors fs.rmSync on the legacy path and never returns a promise there.
  if (attempt instanceof Promise) throw new Error('The legacy seam must fail synchronously')
}

/** One Electron user-data tree, as a real launch leaves it behind. */
function electronUserData(home: string): string {
  const userData = join(home, 'electron-user-data')
  mkdirSync(join(userData, 'launch-analytics', 'identity'), { recursive: true })
  writeFileSync(join(userData, 'launch-analytics', 'identity', 'installation-id'), 'fixture')
  return userData
}

/** The exact error the merge queue reported, raised for the transient window only. */
function directoryNotEmpty(userData: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`ENOTEMPTY: directory not empty, rmdir '${userData}'`), {
    code: 'ENOTEMPTY', errno: -66, syscall: 'rmdir', path: userData,
  })
}

afterEach(async () => {
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

it('aborts the pre-fix cleanup on ENOTEMPTY, while the retrying helper removes the same tree', async () => {
  const home = temporaryHome()
  const userData = electronUserData(home)
  const attempts: TemporaryDirectoryRemovalOptions[] = []
  // fs.rm stands in here: it raises the observed ENOTEMPTY while the writer is still
  // settling, whichever caller asks. Only the retry budget separates the two.
  const racingFs: TemporaryDirectoryRemover = (path, options) => {
    attempts.push(options)
    if (options.maxRetries === 0) throw directoryNotEmpty(userData)
    return rm(path, options)
  }

  expect(() => legacyCleanup(home, racingFs)).toThrow(/ENOTEMPTY: directory not empty, rmdir/u)
  expect(existsSync(userData)).toBe(true)

  await removeTemporaryDirectory(home, racingFs)
  expect(existsSync(home)).toBe(false)
  // The pre-fix call asked for no retries; the helper asks for the documented budget.
  expect(attempts).toEqual([
    { recursive: true, force: true, maxRetries: 0, retryDelay: 0 },
    { recursive: true, force: true, maxRetries: 5, retryDelay: 100 },
  ])
})

it('uses a five-attempt 100 ms retry budget for every temporary directory it removes', async () => {
  const home = temporaryHome()
  const attempts: TemporaryDirectoryRemovalOptions[] = []
  await removeTemporaryDirectory(home, async (path, options) => { attempts.push(options); await rm(path, options) })
  expect(attempts).toEqual([TEMPORARY_DIRECTORY_REMOVAL])
  expect(TEMPORARY_DIRECTORY_REMOVAL).toEqual({ recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  expect(existsSync(home)).toBe(false)
})

it('still fails loudly when the writer never settles, so ENOTEMPTY is never swallowed', async () => {
  const home = temporaryHome()
  const userData = electronUserData(home)
  const stuck: TemporaryDirectoryRemover = () => { throw directoryNotEmpty(userData) }
  await expect(removeTemporaryDirectory(home, stuck)).rejects.toThrow(/ENOTEMPTY: directory not empty, rmdir/u)
  expect(existsSync(userData)).toBe(true)
})

it('removes a real user-data tree while a writer thread is still creating files in it', async () => {
  // Concurrent smoke probe only: deterministic proof lives in cases 1-3 and the
  // injected ENOTEMPTY falsification probes; machine scheduling decides whether a
  // real race window opens on a given run.
  const home = temporaryHome()
  const userData = electronUserData(home)
  const writerRoot = join(userData, 'writer')
  // A separate thread is what outlives the assertions: only another thread (or
  // process) can refill a directory between a delete's walk and its rmdir.
  const writer = new Worker(`
    const { mkdirSync, writeFileSync } = require('node:fs')
    const { join } = require('node:path')
    const { parentPort, workerData } = require('node:worker_threads')
    let written = 0
    const timer = setInterval(() => {
      try {
        mkdirSync(join(workerData, 'Crashpad', 'pending'), { recursive: true })
        writeFileSync(join(workerData, 'Crashpad', 'pending', 'report-' + written), 'settling')
        written += 1
        parentPort.postMessage(written)
        if (written >= 40) clearInterval(timer)
      } catch { /* The directory is gone: the writer has nothing left to settle. */ }
    }, 2)
  `, { eval: true, workerData: writerRoot })
  try {
    const firstWrite = await new Promise<number>((resolve, reject) => {
      writer.once('message', value => resolve(value as number))
      writer.once('error', reject)
    })
    expect(firstWrite).toBeGreaterThan(0)
    await expect(removeTemporaryDirectory(home)).resolves.toBeUndefined()
  } finally {
    await writer.terminate().catch(() => {})
    // The writer can recreate the tree it was writing to; leave no temporary home behind.
    await removeTemporaryDirectory(home)
  }
  expect(existsSync(home)).toBe(false)
})

it('proves unretried async rm fails on ENOTEMPTY from launch-analytics identity while removeTemporaryDirectory cleans it', async () => {
  const root = temporaryHome('next-launch-analytics-')
  const identityDir = join(root, 'install', 'identity')
  mkdirSync(identityDir, { recursive: true })
  writeFileSync(join(identityDir, 'installation-id'), 'fixture-device-id')

  const racingAsyncRm: TemporaryDirectoryRemover = async (path, options) => {
    if (!options.maxRetries) throw directoryNotEmpty(identityDir)
    await rm(path, options)
  }

  await expect(racingAsyncRm(root, { recursive: true, force: true, maxRetries: 0, retryDelay: 0 })).rejects.toThrow(
    /ENOTEMPTY: directory not empty, rmdir/u,
  )
  expect(existsSync(identityDir)).toBe(true)

  await removeTemporaryDirectory(root, racingAsyncRm)
  expect(existsSync(root)).toBe(false)
})
