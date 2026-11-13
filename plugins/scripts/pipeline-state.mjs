#!/usr/bin/env node
/**
 * Local state and exclusive locking for the Issue delivery pipeline.
 *
 * The state file is evidence and recovery metadata, not merge authority.
 * GitHub's PR/check state remains authoritative for an actual merge.
 */

import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'

export const TERMINAL_STATES = new Set(['succeeded', 'failed', 'blocked', 'abandoned'])

export function normalizeIssueId(issueId) {
  const value = String(issueId ?? '').replace(/^#/, '').trim()
  if (!/^\d+$/.test(value)) throw new Error(`Invalid Issue id: ${issueId}`)
  return value
}

export function makeRunKey(issueId, baseSha) {
  const id = normalizeIssueId(issueId)
  const sha = String(baseSha ?? '').trim()
  if (!sha) throw new Error('baseSha is required')
  return `${id}@${sha}`
}

export function safeRunId(runKey) {
  return createHash('sha256').update(String(runKey)).digest('hex').slice(0, 16)
}

export function statePaths(root, issueId) {
  const id = normalizeIssueId(issueId)
  const dir = resolve(root, '.workbuddy', 'pipeline')
  return {
    dir,
    lock: join(dir, `${id}.lock`),
    state: join(dir, `${id}.json`),
  }
}

function lockMetadata(path) {
  try {
    const raw = readFileSync(path, 'utf8').trim()
    const stat = statSync(path)
    return {
      pid: Number(raw) || null,
      createdAt: stat.mtime.toISOString(),
    }
  } catch {
    return null
  }
}

/**
 * Acquire an Issue-scoped lock. Existing locks are never silently deleted:
 * an operator must remove a demonstrably stale lock after inspecting it.
 */
export function acquireIssueLock(root, issueId) {
  const paths = statePaths(root, issueId)
  mkdirSync(paths.dir, { recursive: true, mode: 0o700 })
  let fd
  try {
    fd = openSync(paths.lock, 'wx', 0o600)
    writeFileSync(fd, `${process.pid}\n`, 'utf8')
    closeSync(fd)
  } catch (error) {
    if (error?.code === 'EEXIST') {
      const owner = lockMetadata(paths.lock)
      const ownerText = owner ? ` pid=${owner.pid ?? 'unknown'} created=${owner.createdAt}` : ''
      throw new Error(`Issue #${issueId} 已有流水线运行锁${ownerText}`)
    }
    throw error
  }

  let released = false
  return {
    ...paths,
    release() {
      if (released) return
      released = true
      try {
        unlinkSync(paths.lock)
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }
    },
  }
}

export function readState(root, issueId) {
  const paths = statePaths(root, issueId)
  if (!existsSync(paths.state)) return null
  try {
    return JSON.parse(readFileSync(paths.state, 'utf8'))
  } catch {
    return null
  }
}

export function writeState(root, issueId, state) {
  const paths = statePaths(root, issueId)
  mkdirSync(paths.dir, { recursive: true, mode: 0o700 })
  const next = {
    ...state,
    issueId: normalizeIssueId(issueId),
    updatedAt: new Date().toISOString(),
  }
  const temp = `${paths.state}.${process.pid}.tmp`
  writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  renameSync(temp, paths.state)
  return next
}

export function isTerminalState(value) {
  return TERMINAL_STATES.has(value)
}

export function assertSameRun(existing, runKey) {
  if (!existing) return { kind: 'new' }
  if (existing.runKey !== runKey) return { kind: 'different', state: existing }
  if (isTerminalState(existing.state)) return { kind: 'terminal', state: existing }
  return { kind: 'active', state: existing }
}

export function transitionState(root, issueId, current, nextState, patch = {}) {
  const diskState = readState(root, issueId)
  if (current && current !== nextState && isTerminalState(current)) {
    throw new Error(`Cannot transition terminal pipeline state ${current} -> ${nextState}`)
  }
  if (diskState?.state && current && diskState.state !== current) {
    throw new Error(`Pipeline state changed concurrently: expected ${current}, found ${diskState.state}`)
  }
  if (patch.runKey && diskState?.runKey && patch.runKey !== diskState.runKey) {
    throw new Error(`Pipeline run key changed concurrently: expected ${patch.runKey}, found ${diskState.runKey}`)
  }
  return writeState(root, issueId, {
    ...(diskState ?? {}),
    ...patch,
    state: nextState,
  })
}
