/**
 * 会话工作区文件夹（cwd）解析。
 *
 * 2026-08-23：项目库作用域改成默认库，禁止再用 resolveCurrentCwd 当列表范围。
 * 本模块仍给「当前会话路径 ↔ 账本 workspaceId」匹配用（打开项目、补绑定）。
 *
 * 优先级：
 *   1. 当前会话的 cwd（sessions.list.byId[current].cwd）
 *   2. 最近活跃工作区的 path（workspaces.list.recentWorkspaceId → items[].path）
 *   3. undefined（无工作区，无法落盘 → 调用方给空态/提示）
 *
 * 会话创建必须走 workspaceId（官方 SessionManager.create：有 workspaceId 才
 * 账本挂载；只传 cwd 会生出 ungrouped 会话）。文件盘仍用路径。
 */

/**
 * 去掉尾斜杠再比路径；根路径 `/` 或 `\` 保持原样。
 * @param {unknown} path
 * @returns {string}
 */
export function normalizeWorkspacePath(path) {
  const value = String(path)
  if (value === '/' || value === '\\') return value
  return value.replace(/[/\\]+$/u, '')
}

/**
 * 在 workspaces.list 快照里按 path 匹配 cwd，返回账本 workspaceId。
 * @param {string | undefined} cwd
 * @param {{ list?: { getSnapshot?: () => { items?: Array<{ workspaceId?: unknown, path?: unknown }> } } }} workspaces
 * @returns {string | undefined}
 */
export function resolveWorkspaceForCwd(cwd, workspaces) {
  if (typeof cwd !== 'string' || cwd === '') return undefined
  try {
    const items = workspaces?.list?.getSnapshot?.()?.items
    if (!Array.isArray(items)) return undefined
    const needle = normalizeWorkspacePath(cwd)
    const hit = items.find((item) => {
      const path = item?.path
      return path !== undefined && path !== null && String(path) !== ''
        && normalizeWorkspacePath(path) === needle
    })
    const id = hit?.workspaceId
    if (id === undefined || id === null || String(id) === '') return undefined
    return String(id)
  } catch {
    return undefined
  }
}

/**
 * 当前作用域对应的 workspaceId。cwd 能解析但账本没有条目时返回 undefined。
 * @param {{ list?: { getSnapshot?: () => unknown } }} sessions
 * @param {{ list?: { getSnapshot?: () => unknown } }} workspaces
 * @returns {string | undefined}
 */
export function resolveWorkspaceId(sessions, workspaces) {
  const cwd = resolveCurrentCwd(sessions, workspaces)
  if (!cwd) return undefined
  return resolveWorkspaceForCwd(cwd, workspaces)
}

/**
 * @param {{ list?: { getSnapshot?: () => { current?: string, byId?: Record<string, { cwd?: string }> } } }} sessions
 * @param {{ list?: { getSnapshot?: () => { recentWorkspaceId?: string, items?: Array<{ workspaceId: string, path: string }> } } }} workspaces
 * @returns {string | undefined}
 */
export function resolveCurrentCwd(sessions, workspaces) {
  try {
    const sessionSnapshot = sessions?.list?.getSnapshot?.()
    const currentId = sessionSnapshot?.current
    const currentCwd = currentId !== undefined ? sessionSnapshot?.byId?.[currentId]?.cwd : undefined
    if (typeof currentCwd === 'string' && currentCwd !== '') return currentCwd

    const workspaceSnapshot = workspaces?.list?.getSnapshot?.()
    const recentId = workspaceSnapshot?.recentWorkspaceId
    const recent = workspaceSnapshot?.items?.find?.((item) => item.workspaceId === recentId)
    if (typeof recent?.path === 'string' && recent.path !== '') return recent.path
  } catch {
    /* 服务未就绪 / 快照缺失：返回 undefined，调用方降级空态。 */
  }
  return undefined
}
