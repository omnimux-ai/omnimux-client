import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

function lockPath(taskId) {
  // Ego strips TMPDIR; use the same POSIX location in parent and child.
  return join('/tmp', `omnimux-ego-${process.getuid()}`, createHash('sha256').update(String(taskId)).digest('hex'))
}

export function acquireTaskLock(taskId, runId, pid) {
  const dir = lockPath(taskId)
  mkdirSync(join(dir, '..'), { recursive: true, mode: 0o700 })
  try { mkdirSync(dir, { mode: 0o700 }) } catch (error) {
    if (error.code !== 'EEXIST') throw error
    throw new Error(`Browser task space ${taskId} is busy; inspect its owner before recovering an abandoned lock`)
  }
  const lock = { taskId, runId, pid }
  writeFileSync(join(dir, 'owner.json'), JSON.stringify(lock), { mode: 0o600 })
  return lock
}

export function releaseTaskLock(lock) {
  const dir = lockPath(lock.taskId)
  const owner = JSON.parse(readFileSync(join(dir, 'owner.json'), 'utf8'))
  if (owner.pid !== lock.pid || owner.runId !== lock.runId) throw new Error('Browser lock ownership changed')
  unlinkSync(join(dir, 'owner.json'))
  rmdirSync(dir)
}
