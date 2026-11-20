/** Routes path-based picks to the current Desktop window or the existing Web request. */
const errors = {
  'picker-update-required': [503, '请更新 OmniMux 后再选择本地文件或文件夹。', 'Update OmniMux to choose local files or folders.'],
  'picker-unavailable': [503, '当前窗口无法打开文件选择器。', 'The file picker is unavailable in this window.'],
  'picker-busy': [409, '已有文件选择器处于打开状态。', 'A file picker is already open.'],
  'picker-gesture-required': [403, '请点击选择按钮后重试。', 'Click the choose button to try again.'],
  'picker-invalid-request': [400, '文件选择参数无效。', 'The file picker request is invalid.'],
  'picker-failed': [500, '无法打开系统文件选择器。', 'Could not open the system file picker.'],
}

export function hasDesktopFilePicker(desktop = globalThis.dshDesktop) {
  const picker = desktop?.filePicker
  return picker?.version === 1 && typeof picker.open === 'function'
}

function failure(code) {
  const error = Object.hasOwn(errors, code) ? code : 'picker-failed'
  const [status, zh, en] = errors[error]
  const locale = globalThis.document?.documentElement.lang || globalThis.navigator?.language
  return { ok: false, status, body: { path: null, paths: [], error, message: /^zh\b/i.test(locale ?? '') ? zh : en } }
}

export async function requestFilePicker(options, webRequest, desktop = globalThis.dshDesktop) {
  if (!hasDesktopFilePicker(desktop)) {
    return Number.isInteger(desktop?.protocolVersion) ? failure('picker-update-required') : webRequest()
  }

  try {
    const result = await desktop.filePicker.open(options)
    if (result?.ok !== true) return failure(result?.error)
    if (!Array.isArray(result.paths) || result.paths.some(path => typeof path !== 'string' || path.length === 0)) {
      return failure('picker-failed')
    }
    return { ok: true, status: 200, body: { path: result.paths[0] ?? null, paths: result.paths } }
  } catch {
    return failure('picker-failed')
  }
}
