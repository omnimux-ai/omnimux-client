/**
 * 展示名保留用户输入；目录名去掉路径分隔符 / 控制字符。
 * 全空则拒绝（弹窗已拦）。非法字符替换为 `_`。
 */
import { MAX_PROJECT_TITLE_LENGTH } from './limits.js'

/** 客户端不依赖 host schema 包，长度与 host MAX_PROJECT_TITLE_LENGTH 对齐。 */
export { MAX_PROJECT_TITLE_LENGTH }

/**
 * @param {unknown} title
 * @returns {string}
 */
export function sanitizeFolderName(title) {
  const trimmed = String(title ?? '').trim()
  const replaced = trimmed
    .replace(/[<>:"/\\|?*\u0000-\u001f]/gu, '_')
    .replace(/[. ]+$/u, '')
  return replaced.replace(/^\.+$/u, '')
}

/**
 * @param {unknown} raw
 * @returns {{ ok: true, title: string, folderName: string } | { ok: false, error: string }}
 */
export function validateProjectTitle(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return { ok: false, error: 'title-required' }
  }
  const title = raw.trim()
  if (title.length > MAX_PROJECT_TITLE_LENGTH) {
    return { ok: false, error: 'title-too-long' }
  }
  const folderName = sanitizeFolderName(title)
  if (folderName === '') return { ok: false, error: 'title-invalid' }
  return { ok: true, title, folderName }
}

/**
 * 重名：先试原名，再 `名称 (2)`、`(3)`…
 * @param {string} base
 * @param {number} attempt 从 0 起
 */
export function folderNameAttempt(base, attempt) {
  if (attempt <= 0) return base
  return `${base} (${attempt + 1})`
}

/**
 * 官方 DirectoryBrowseError：name + rpcError.code。
 * 源码（dsh-client-runtime WorkspaceRuntime.createDirectory）：
 *   throw new DirectoryBrowseError(response.result.error)
 *   message = `directory browse failed: ${rpcError.code}: ${rpcError.message}`
 * Host browse mkdir EEXIST → DirectoryPickerError("directory-exists", target, …)
 * → RPC `{ code: 'directory-exists', details: { path } }`。
 *
 * @param {unknown} error
 * @returns {boolean}
 */
export function isDirectoryExistsError(error) {
  if (!error || typeof error !== 'object') return false
  const err = /** @type {{ name?: string, code?: string, rpcError?: { code?: string }, message?: string }} */ (error)
  if (err.rpcError?.code === 'directory-exists') return true
  if (err.code === 'directory-exists') return true
  if (err.name === 'DirectoryBrowseError' && /directory-exists/.test(String(err.message || ''))) return true
  return false
}
