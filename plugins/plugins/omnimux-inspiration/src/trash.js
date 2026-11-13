import { existsSync, renameSync, unlinkSync } from 'node:fs'
import { basename, join } from 'node:path'
import { homedir } from 'node:os'

/**
 * Move a local file to the OS System Trash (macOS ~/.Trash or Electron shell.trashItem).
 * @param {string} filePath
 * @returns {Promise<boolean>}
 */
export async function moveToTrash(filePath) {
  if (!filePath || typeof filePath !== 'string' || !existsSync(filePath)) {
    return false
  }

  // 1. Electron shell.trashItem if running in Electron process
  try {
    const electron = await import('electron')
    if (electron?.shell?.trashItem) {
      await electron.shell.trashItem(filePath)
      return true
    }
  } catch {}

  // 2. Native macOS ~/.Trash folder
  try {
    if (process.platform === 'darwin') {
      const trashDir = join(homedir(), '.Trash')
      if (existsSync(trashDir)) {
        const fileBase = basename(filePath)
        let dest = join(trashDir, fileBase)
        if (existsSync(dest)) {
          dest = join(trashDir, `${Date.now()}_${fileBase}`)
        }
        renameSync(filePath, dest)
        return true
      }
    }
  } catch {}

  // 3. Fallback: unlinkSync
  try {
    unlinkSync(filePath)
    return true
  } catch {
    return false
  }
}
