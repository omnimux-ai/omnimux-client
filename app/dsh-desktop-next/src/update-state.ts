/** Serializable update state helpers and localized labels shared across UI, tray, and dialogs. */

import { OMNIMUX_RELEASES_URL } from './product-identity.ts'
import type { NextUpdateState, OmniMuxUpdateChannel, OmniMuxUpdateEnvironment, OmniMuxUpdateErrorCode } from './omnimux-updater/types.ts'

export type { NextUpdateState, OmniMuxUpdateChannel, OmniMuxUpdateEnvironment, OmniMuxUpdateErrorCode }

export function formatArtifactSize(bytes: number | undefined): string | undefined {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes <= 0) return undefined
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
  return `${Math.max(1, Math.round(bytes / (1024 * 1024)))} MB`
}

export function updateLabel(state: NextUpdateState, language: string): string {
  const t = (zh: string, en: string) => language.toLowerCase().startsWith('zh') ? zh : en
  switch (state.phase) {
    case 'checking': return t('正在检查更新…', 'Checking for updates…')
    case 'current': return t('已是最新版本', 'Up to date')
    case 'available':
      return state.mandatory
        ? t(`发现必需更新 ${state.version}`, `Required update available: ${state.version}`)
        : t(`发现新版本 ${state.version}`, `Update available: ${state.version}`)
    case 'downloading': {
      const progress = state.total
        ? `${Math.min(100, Math.floor((state.received ?? 0) / state.total * 100))}%`
        : `${Math.floor((state.received ?? 0) / 1048576)} MB`
      return t(`正在下载更新 ${progress}`, `Downloading update ${progress}`)
    }
    case 'preparing': return t('正在校验并准备安装…', 'Verifying and preparing update…')
    case 'ready': return t(`${state.version} 已就绪，安装并重启`, `${state.version} ready — Install and restart`)
    case 'installing': return t('正在安装并重启…', 'Installing and restarting…')
    case 'error':
      return updateErrorLabel(state, language)
    default: return t('检查更新', 'Check for updates')
  }
}

function updateErrorLabel(state: NextUpdateState, language: string): string {
  const t = (zh: string, en: string) => language.toLowerCase().startsWith('zh') ? zh : en
  switch (state.errorCode) {
    case 'OFFLINE':
      return t('无法连接更新服务，请检查网络或代理后重试。', 'Unable to reach the update service. Check your network or proxy and retry.')
    case 'HTTP_ERROR':
      return t('更新服务暂时不可用，请稍后重试。', 'The update service is temporarily unavailable. Try again later.')
    case 'SIGNATURE_INVALID':
      return t('更新清单签名校验未通过，已中止更新以保护安全。', 'Update manifest signature verification failed. The update was blocked for safety.')
    case 'MANIFEST_INVALID':
    case 'CHANNEL_MISMATCH':
      return t('更新信息格式无效，请稍后重试或前往官网下载。', 'Update metadata is invalid. Try again later or download manually.')
    case 'UNSUPPORTED_OS':
      return state.errorDetail
        ? t(`新版本需要系统版本 ${state.errorDetail} 或更高版本。`, `This update requires OS version ${state.errorDetail} or later.`)
        : t('当前操作系统版本不支持此更新。', 'Your operating system version does not support this update.')
    case 'INSUFFICIENT_SPACE':
      return state.errorDetail
        ? t(`磁盘空间不足，至少需要 ${state.errorDetail} 可用空间。`, `Not enough disk space. Free at least ${state.errorDetail} and retry.`)
        : t('磁盘空间不足，请清理空间后重试。', 'Not enough disk space to download and install the update.')
    case 'APP_TRANSLOCATED':
      return t('请先将 OmniMux 拖入“应用程序”文件夹并从该位置打开，再执行应用内更新。', 'Move OmniMux into the Applications folder and reopen it there to use in-app updates.')
    case 'PERMISSION_DENIED':
      return t('缺少应用安装目录的写入权限，请使用管理员账户或在官网下载覆盖安装。', 'Missing write permission for the application folder. Retry as an administrator or reinstall manually.')
    case 'DOWNLOAD_TIMEOUT':
      return t('下载连接长时间无响应，请检查网络后重试。', 'The download stalled and timed out. Check your connection and retry.')
    case 'CHECKSUM_MISMATCH':
      return t('安装包完整性校验失败，已清理损坏文件，请重新下载。', 'Installer integrity check failed. The corrupted file was removed; please download again.')
    case 'PREPARE_FAILED':
      return t('安装包签名或版本校验未通过，请重试或前往官网下载。', 'Installer verification failed. Retry or download from the official site.')
    case 'ACTIVE_TASKS_BLOCKED':
      return t('仍有正在运行的任务未结束，请等待完成后重试安装。', 'Active tasks are still running. Wait for them to finish and retry installation.')
    case 'INSTALL_FAILED':
      return t('无法启动安装程序，请重试或前往官网手动覆盖安装。', 'Could not launch the installer. Retry or install manually from the download page.')
    default: break
  }
  if (state.error === 'development') return t('当前为开发版，仅支持检查更新，不执行应用内覆盖安装。', 'Development builds can check for updates, but in-app installation is disabled.')
  if (state.error === 'unsupported') return t('当前平台或运行方式不支持应用内更新。', 'In-app updates are unavailable on this platform or installation type.')
  if (state.error === 'service') return t('暂时无法获取更新，请稍后重试。', 'Updates are temporarily unavailable. Try again later.')
  return t('更新未完成，请重试。', 'The update could not be completed. Please retry.')
}

export function updateAction(state: NextUpdateState): 'check-updates' | 'download-update' | 'install-update' | undefined {
  if (state.phase === 'ready') return 'install-update'
  if (state.phase === 'available') return 'download-update'
  if (state.phase === 'error' && state.version && state.error !== 'service'
    && state.errorCode !== 'UNSUPPORTED_OS' && state.errorCode !== 'APP_TRANSLOCATED' && state.errorCode !== 'SIGNATURE_INVALID') {
    return 'download-update'
  }
  if (['idle', 'current', 'error'].includes(state.phase)) return 'check-updates'
  return undefined
}

/**
 * Linux has no in-app installer, and Setup would install a second copy instead of replacing a portable one, so both
 * download an update from the release page.
 */
export function manualUpdate(state: NextUpdateState, platform: string): boolean {
  return platform === 'linux' || state.portable === true || state.environment === 'portable' || state.environment === 'linux'
}

/** How to install a manual update: the matching Linux package, or a new portable ZIP in place of this folder. */
export function manualUpdateHint(language: string, portable = false): string {
  const zh = language.toLowerCase().startsWith('zh')
  if (portable) {
    return zh
      ? '便携版需要手动更新：下载新的便携版 ZIP，退出应用后解压替换当前文件夹。'
      : 'Portable copies update manually: download the new portable ZIP, quit the app, and replace this folder.'
  }
  return zh
    ? 'Linux 版需要手动更新：在发布页下载与当前安装方式相同的安装包（deb、AppImage 或 tar.gz）。'
    : 'Linux builds update manually: download the matching package (deb, AppImage, or tar.gz) from the release page.'
}

/** Clear environment hint when in-app installation is intentionally disabled (e.g. OmniMux Dev or source run). */
export function nonInstallableHint(state: NextUpdateState, language: string): string {
  const zh = language.toLowerCase().startsWith('zh')
  if (state.environment === 'dev') {
    return zh
      ? '当前为 OmniMux Dev 开发版，可检查更新但不执行应用内覆盖安装。'
      : 'Running OmniMux Dev. Update checks work, while in-app replacement is disabled.'
  }
  if (state.environment === 'source') {
    return zh
      ? '当前为源码运行模式，应用内安装需使用正式安装包。'
      : 'Running from source. Install a packaged macOS or Windows build to use in-app updates.'
  }
  return zh
    ? '应用内安装更新需要使用 macOS 或 Windows 安装版。'
    : 'Install a packaged macOS or Windows build to use in-app updates.'
}

export function releaseNotesUrl(version?: string, overrideUrl?: string): string {
  if (overrideUrl !== undefined && overrideUrl.trim().length > 0) {
    try {
      const parsed = new URL(overrideUrl)
      if (parsed.protocol === 'https:') return parsed.href
    } catch { /* fall back to canonical tag URL */ }
  }
  return version ? `${OMNIMUX_RELEASES_URL}/tag/v${encodeURIComponent(version)}` : OMNIMUX_RELEASES_URL
}
