/**
 * 项目库列表与工程中心页（workbench tab on dsh-better-sidebar）。
 *
 * 架构层级：
 * 1. 顶层：紧凑单行页头 + 吸顶筛选排序栏 + 项目文件夹网格（两阶段渐进加载与 SWR 缓存）；
 * 2. 二级：项目详情工程中心（带键盘可达面包屑导航）：
 *    - 创作页 Tab：展示该工作区下的全部创作页卡片，支持直接打开画布、新建创作页、重命名与删除；
 *    - 项目资产 Tab：按需异步加载的工作区文件管理器，支持子目录浏览、新建文件夹与批量上传。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, ConfirmModal, DropdownSelect, FilterBar, IconPlusOutline16, ModalDialog, PageHeader, SearchField, Tabs } from 'dsh-ui-kit'
import { Info } from 'lucide-react'
import { Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  listProjects,
  fetchProjectCovers,
  getProject,
  renameProject,
  deleteProject,
  createProjectPage,
  updateProjectPage,
  deleteProjectPage,
  fetchProjectFiles,
  mkdirProjectFile,
  uploadProjectFiles,
} from '../api.js'
import {
  getWorkspaceAssets,
  mkdirWorkspaceAsset,
  ingestWorkspaceAssets,
  pickLocalFiles,
} from '../../canvas/bridge/apiClient.ts'
import { useAsyncInstanceGuard } from '../../canvas/editor/hooks/useAsyncInstanceGuard.ts'
import { injectWorkflowStyles } from '../styles.js'
import { NewLocalProjectDialog } from './NewLocalProjectDialog.jsx'
import { dismissProductStage, runNewProject } from './newProject.js'
import { closeAppTab, openAppTab } from './projectCanvas.js'
import { createProjectNavigation } from './project-navigation.js'
import { ProjectFolderCard } from './ProjectFolderCard.jsx'
import { ProjectPagesTab } from './ProjectPagesTab.jsx'
import { ProjectAssetsTab } from './ProjectAssetsTab.jsx'
import { AIAppCard } from './AIAppCard.jsx'
import {
  APP_REMOVE_ERROR_KEYS,
  appEntryMatchesQuery,
  defaultAppStorage,
  listPublishedApps,
  removePublishedApp,
  resolveAppEditTarget,
  resolveOwningProject,
} from './appLibrary.js'
import { fetchBuiltinApps, mergeAppEntries } from './builtinApps.js'

export const WORKFLOW_LIBRARY_TAB_ID = 'omnimux-workflow:library'

const COVER_BATCH_SIZE = 24
const SKELETON_CARD_COUNT = 12
const useDeferredValueSafe = typeof React.useDeferredValue === 'function' ? React.useDeferredValue : (value) => value

// 会话级 SWR 列表缓存：切出页签返回时帧 0 渲染，后台静默刷新并保留已解析封面。
let cachedProjectsSnapshot = null

export function resetProjectLibraryCache() {
  cachedProjectsSnapshot = null
}

function extractWorkspaceTail(dir) {
  if (typeof dir !== 'string' || dir.trim() === '') return ''
  const parts = dir.replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] || ''
}

function BreadcrumbChevron() {
  return (
    <svg className="omnimux-project-crumb-sep" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m6 4 4 4-4 4" />
    </svg>
  )
}

function PromptModal({ open, title, placeholder, defaultValue = '', confirmLabel = '确定', cancelLabel = '取消', onClose, onConfirm }) {
  const [value, setValue] = useState(defaultValue)
  useEffect(() => {
    if (open) setValue(defaultValue)
  }, [open, defaultValue])

  if (!open) return null

  const handleSubmit = (e) => {
    e?.preventDefault?.()
    if (!value.trim()) return
    onConfirm(value.trim())
  }

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      closeLabel={cancelLabel}
      footer={(
        <div className="omnimux-prompt-footer">
          <Button variant="ghost" onClick={onClose}>{cancelLabel}</Button>
          <Button variant="primary" onClick={handleSubmit} disabled={!value.trim()}>{confirmLabel}</Button>
        </div>
      )}
    >
      <form onSubmit={handleSubmit} className="omnimux-prompt-form">
        <input
          autoFocus
          className="omnimux-prompt-input"
          placeholder={placeholder}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              onClose()
            }
          }}
        />
      </form>
    </ModalDialog>
  )
}

function errText(result, t) {
  const code = String(result?.body?.error ?? '')
  if (code === 'no-workspace') return t('projects.noWorkspace') || '工作区不可用'
  return String(result?.body?.message || result?.body?.error || result?.status || t('projects.genericError') || '请求失败')
}

function mergeProjectCoverPayload(project, coverEntry) {
  if (!coverEntry) return project
  const pageCoverById = new Map(
    (Array.isArray(coverEntry.pages) ? coverEntry.pages : []).map((page) => [page.id, page.cover]),
  )
  const nextPages = Array.isArray(project.pages)
    ? project.pages.map((page) => (pageCoverById.has(page.id) ? { ...page, cover: pageCoverById.get(page.id) } : page))
    : project.pages
  return {
    ...project,
    cover: coverEntry.cover ?? project.cover,
    pages: nextPages,
  }
}

export function ProjectLibraryPage(props) {
  const { t, stage, store, visible = true, sessions, workspaces, layout, betterSidebar, getSessionNavigation, getSidebarRight, presence } = props
  useEffect(() => { injectWorkflowStyles() }, [])
  const navigation = React.useMemo(
    () => createProjectNavigation({ sessions, workspaces, layout, betterSidebar, getSessionNavigation, getSidebarRight, t, presence }),
    [sessions, workspaces, layout, betterSidebar, getSessionNavigation, getSidebarRight, t, presence],
  )

  useEffect(() => {
    const api = typeof window !== 'undefined' ? window.__omnimuxWorkbench : undefined
    if (!api || typeof api.attachStore !== 'function' || !store) return undefined
    api.attachStore(store)
    return () => { api.detachStore?.(store) }
  }, [store])

  const workspacesRef = useRef(workspaces)
  workspacesRef.current = workspaces
  const reloadGenRef = useRef(0)
  const reloadAbortRef = useRef(null)
  const assetsGenRef = useRef(0)

  const [projects, setProjects] = useState(() => cachedProjectsSnapshot ?? [])
  const [hasLoadedProjects, setHasLoadedProjects] = useState(() => cachedProjectsSnapshot !== null)
  const [selectedProject, setSelectedProject] = useState(null)
  const projectGuard = useAsyncInstanceGuard(JSON.stringify([visible, selectedProject?.id]))
  const pendingUpload = useRef(null)
  const [pickerNotice, setPickerNotice] = useState(null)
  const [uploadingProject, setUploadingProject] = useState(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [loadingAssets, setLoadingAssets] = useState(false)
  const [projectDetail, setProjectDetail] = useState(null)
  const [detailTab, setDetailTab] = useState('pages') // pages | assets
  const [assetsDoc, setAssetsDoc] = useState(null)
  const [assetsSubpath, setAssetsSubpath] = useState('')
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValueSafe(query)
  const [sourceFilter, setSourceFilter] = useState('all') // all | bound | independent
  const [sortBy, setSortBy] = useState('updatedDesc') // updatedDesc | titleAsc
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // 「打开创作页」的即时反馈：卡片「打开中」遮罩 + 重复点击拦截。
  // ref 与 state 双轨：ref 在本次事件里同步生效（连点不会穿透），state 驱动渲染。
  const [openingPageId, setOpeningPageId] = useState(null)
  const openingRef = useRef(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [pendingRemove, setPendingRemove] = useState(null)
  const [pendingPurge, setPendingPurge] = useState(null)
  const [pendingDeletePage, setPendingDeletePage] = useState(null)
  const [pendingAppDelete, setPendingAppDelete] = useState(null)
  const [promptModal, setPromptModal] = useState(null)
  const [libraryTab, setLibraryTab] = useState('local')
  // 「AI应用」分类的独立数据源：用户已发布清单（localStorage，发布向导写的唯一真实落点）
  // + 官方内置应用清单（只读 HTTP 缝）。两者合并展示，内置条目不可删。
  const [publishedApps, setPublishedApps] = useState([])
  const [builtinApps, setBuiltinApps] = useState([])
  const [appsError, setAppsError] = useState('')
  const apps = React.useMemo(
    () => mergeAppEntries(publishedApps, builtinApps),
    [publishedApps, builtinApps],
  )

  const enrichProjectCovers = useCallback(async (ids, generation, signal) => {
    if (!ids.length || typeof fetchProjectCovers !== 'function') return
    const settlePendingChunk = (chunkIds, fallbackCover) => {
      const idSet = new Set(chunkIds)
      setProjects((current) => {
        let changed = false
        const next = current.map((item) => {
          if (!idSet.has(item.id) || item.cover !== undefined) return item
          changed = true
          return { ...item, cover: fallbackCover }
        })
        if (changed) cachedProjectsSnapshot = next
        return changed ? next : current
      })
    }
    for (let offset = 0; offset < ids.length; offset += COVER_BATCH_SIZE) {
      if (signal?.aborted || reloadGenRef.current !== generation) return
      const chunk = ids.slice(offset, offset + COVER_BATCH_SIZE)
      let res
      try {
        res = await fetchProjectCovers(chunk, { signal })
      } catch (err) {
        if (err?.name === 'AbortError' || signal?.aborted || reloadGenRef.current !== generation) return
        settlePendingChunk(chunk, { kind: 'empty', unavailable: true })
        continue
      }
      if (signal?.aborted || reloadGenRef.current !== generation) return
      if (!res?.ok || !res.body?.covers || typeof res.body.covers !== 'object') {
        settlePendingChunk(chunk, { kind: 'empty', unavailable: true })
        continue
      }
      const coverMap = res.body.covers
      const chunkSet = new Set(chunk)
      setProjects((current) => {
        const next = current.map((item) => {
          if (Object.prototype.hasOwnProperty.call(coverMap, item.id)) {
            return mergeProjectCoverPayload(item, coverMap[item.id])
          }
          if (chunkSet.has(item.id) && item.cover === undefined) {
            return { ...item, cover: { kind: 'empty' } }
          }
          return item
        })
        cachedProjectsSnapshot = next
        return next
      })
    }
  }, [])

  // 1. 重新加载顶层项目列表（两阶段渐进加载：Phase 1 快速元数据，Phase 2 视口优先批量封面）
  const reload = useCallback(async () => {
    reloadAbortRef.current?.abort()
    const controller = typeof AbortController === 'function' ? new AbortController() : null
    reloadAbortRef.current = controller
    const generation = ++reloadGenRef.current
    try {
      const res = await listProjects({ covers: 'none', signal: controller?.signal })
      if (controller?.signal?.aborted || reloadGenRef.current !== generation) return
      if (res.ok && Array.isArray(res.body?.projects)) {
        const workspaceItems = workspacesRef.current?.list?.getSnapshot?.()?.items ?? []
        const workspaceByPath = new Map()
        for (const ws of workspaceItems) {
          if (ws?.path) workspaceByPath.set(ws.path, ws)
        }
        const coversIncluded = res.body.coversIncluded !== false
        const previousById = new Map((cachedProjectsSnapshot ?? []).map((item) => [item.id, item]))
        const nextProjects = res.body.projects.map((project) => {
          const prev = previousById.get(project.id)
          const preservedCover = !coversIncluded && project.cover === undefined ? prev?.cover : project.cover
          const prevPagesById = !coversIncluded && Array.isArray(prev?.pages)
            ? new Map(prev.pages.map((page) => [page.id, page.cover]))
            : null
          const nextPages = prevPagesById && Array.isArray(project.pages)
            ? project.pages.map((page) => (page.cover === undefined && prevPagesById.has(page.id) ? { ...page, cover: prevPagesById.get(page.id) } : page))
            : project.pages
          return {
            ...project,
            ...(preservedCover !== undefined ? { cover: preservedCover } : {}),
            pages: nextPages,
            workspace: workspaceByPath.get(project.path) ?? null,
          }
        })
        cachedProjectsSnapshot = nextProjects
        setProjects(nextProjects)
        setHasLoadedProjects(true)
        setError('')
        if (!coversIncluded && nextProjects.length > 0) {
          void enrichProjectCovers(nextProjects.map((item) => item.id), generation, controller?.signal)
        }
      } else if (!res.ok) {
        setHasLoadedProjects(true)
        setError(errText(res, t))
      }
    } catch (e) {
      if (e?.name === 'AbortError' || controller?.signal?.aborted || reloadGenRef.current !== generation) return
      setHasLoadedProjects(true)
      setError(String(e?.message || e || t('projects.genericError') || '请求失败'))
    }
  }, [t, enrichProjectCovers])

  useEffect(() => {
    if (!visible) return undefined
    void reload()
    return () => {
      reloadAbortRef.current?.abort()
    }
  }, [visible, reload])

  // 1b. 「AI应用」分类的独立列表：用户已发布 manifest 映射 + 官方内置清单。
  const reloadApps = useCallback(async () => {
    const errors = []
    if (!defaultAppStorage()) {
      setPublishedApps([])
      errors.push(t('projects.appStorageUnavailable') || '本地存储不可用，无法读取应用清单。')
    } else {
      try {
        setPublishedApps(listPublishedApps())
      } catch {
        setPublishedApps([])
        errors.push(t('projects.appStorageUnreadable') || '应用清单读取失败，请刷新后重试。')
      }
    }
    const builtin = await fetchBuiltinApps()
    setBuiltinApps(builtin.entries)
    if (builtin.error) {
      errors.push(t('projects.appBuiltinUnavailable') || '官方内置应用暂时读取失败，请刷新后重试。')
    }
    setAppsError(errors.join(' '))
  }, [t])

  useEffect(() => {
    if (!visible || libraryTab !== 'apps') return undefined
    void reloadApps()
    if (typeof window === 'undefined') return undefined
    const onAppTabsChanged = () => { void reloadApps() }
    window.addEventListener('omnimux-app-tabs-changed', onAppTabsChanged)
    return () => window.removeEventListener('omnimux-app-tabs-changed', onAppTabsChanged)
  }, [visible, libraryTab, reloadApps])

  const handleLibraryTabChange = useCallback((nextId) => {
    setLibraryTab(nextId)
    setError('')
    setAppsError('')
  }, [])

  // 2a. 进入项目详情时先只加载项目与创作页详情（不再同步拉物理文件列表）
  const loadProjectDetail = useCallback(async (project) => {
    const ticket = projectGuard.capture()
    if (!project?.id || !projectGuard.isCurrent(ticket)) return
    setLoadingDetail(true)
    setError('')
    try {
      const res = await getProject(project.id)
      if (!projectGuard.isCurrent(ticket)) return
      if (res.ok && res.body?.project) {
        setProjectDetail(res.body.project)
        setProjects((current) => {
          const next = current.map((item) => (
            item.id === project.id ? { ...item, cover: res.body.project.cover ?? item.cover, pages: res.body.project.pages } : item
          ))
          cachedProjectsSnapshot = next
          return next
        })
      } else {
        setProjectDetail(project)
      }
    } catch {
      if (projectGuard.isCurrent(ticket)) setProjectDetail(project)
    } finally {
      if (projectGuard.isCurrent(ticket)) setLoadingDetail(false)
    }
  }, [projectGuard])

  // 2b. 切到「项目资产」页签或切换子目录时按需异步拉取工作区物理文件列表
  const loadProjectAssets = useCallback(async (project, subpath = '') => {
    const ticket = projectGuard.capture()
    const generation = ++assetsGenRef.current
    if (!project?.id || !projectGuard.isCurrent(ticket)) return
    setLoadingAssets(true)
    try {
      const filesRes = await fetchProjectFiles(project.id, subpath)
      if (!projectGuard.isCurrent(ticket) || assetsGenRef.current !== generation) return
      if (filesRes.ok && Array.isArray(filesRes.body?.items)) {
        setError('')
        setAssetsDoc({
          mode: 'physical',
          currentSubpath: filesRes.body.currentSubpath ?? subpath,
          folders: filesRes.body.items.filter((i) => i.isFolder),
          items: filesRes.body.items.filter((i) => !i.isFolder),
        })
      } else {
        const assetsWorkspaceId = project.pages?.[0]?.canvasWorkspaceId || project.id
        const assetsRes = await getWorkspaceAssets(assetsWorkspaceId)
        if (!projectGuard.isCurrent(ticket) || assetsGenRef.current !== generation) return
        if (assetsRes.ok && assetsRes.body?.assets) {
          setError('')
          setAssetsDoc({ mode: 'virtual', ...assetsRes.body.assets })
        } else {
          setAssetsDoc({ mode: 'physical', currentSubpath: subpath, folders: [], items: [] })
        }
      }
    } catch (err) {
      if (projectGuard.isCurrent(ticket) && assetsGenRef.current === generation) {
        setError(String(err?.message || t('projects.assetsLoadFailed') || '项目资产加载失败，请重试。'))
        setAssetsDoc((prev) => (
          prev?.currentSubpath === subpath
            ? prev
            : { mode: 'physical', currentSubpath: subpath, folders: [], items: [] }
        ))
      }
    } finally {
      if (projectGuard.isCurrent(ticket) && assetsGenRef.current === generation) {
        setLoadingAssets(false)
      }
    }
  }, [projectGuard, t])

  const selectedProjectId = selectedProject?.id ?? null

  useEffect(() => {
    setAssetsDoc(null)
    setAssetsSubpath('')
    if (!selectedProjectId) {
      setProjectDetail(null)
    }
  }, [selectedProjectId])

  useEffect(() => {
    if (!visible || !selectedProject) return
    void loadProjectDetail(selectedProject)
  }, [selectedProject, loadProjectDetail, visible])

  useEffect(() => {
    if (!visible || !selectedProject || detailTab !== 'assets') return
    void loadProjectAssets(selectedProject, assetsSubpath)
  }, [visible, selectedProject, detailTab, assetsSubpath, loadProjectAssets])

  // 3. 点击进入某个项目文件夹：先展开详情；真正的工作区切换在打开创作页时完成
  const handleSelectFolder = useCallback((project) => {
    setSelectedProject(project)
    setDetailTab('pages')
    setAssetsSubpath('')
  }, [])

  // 4. 打开某个具体的创作页：统一走项目导航（path → workspace → live session）
  const handleOpenPage = useCallback(async (page) => {
    if (!selectedProject) return
    if (openingRef.current) return
    openingRef.current = true
    setOpeningPageId(page?.id ?? null)
    try {
      dismissProductStage()
      const result = await navigation.openPage(selectedProject, page)
      if (!result.ok) {
        setError(result.error === 'session-navigation-unavailable'
          ? (t('projects.noWorkspace') || '工作区不可用')
          : (t('projects.openCanvasFailed') || '无法打开创作画布，请重试。'))
        return
      }
      setError('')
    } catch (e) {
      console.error('[omnimux-workflow] open page failed', e)
      setError(t('projects.openCanvasFailed') || '无法打开创作画布，请重试。')
    } finally {
      openingRef.current = false
      setOpeningPageId(null)
    }
  }, [selectedProject, navigation, t])

  // 4b. 点击 AI 应用卡片 → 右侧栏应用标签页。
  const handleOpenApp = useCallback((app) => {
    const opened = openAppTab(
      app?.manifest || { appId: app?.appId },
      { appId: app?.appId, title: app?.name },
    )
    if (!opened) setAppsError(t('projects.genericError') || '打开应用失败，请重试。')
    else setAppsError('')
  }, [t])

  // 4c. 卡片「编辑」→ 打开该应用所属项目的创作画布，并聚焦发布时的工作流组。
  const handleEditApp = useCallback(async (app) => {
    const target = resolveAppEditTarget(app)
    const project = resolveOwningProject(projects, app)
    dismissProductStage()
    if (!project) {
      setAppsError(t('projects.appEditNoProject') || '找不到该应用所属项目，已为你打开创作画布。')
      return
    }
    const targetPage = (project.pages ?? []).find((page) => page?.canvasWorkspaceId === target.workspaceId)
      || (project.pages ?? []).find((page) => page?.id === project.activePageId)
      || (project.pages ?? [])[0]
    const opened = await navigation.openProject(project, {
      pageId: targetPage?.id,
      focusGroupId: target.groupId,
    })
    if (!opened.ok) {
      setAppsError(t('projects.appEditFailed') || '打开项目画布失败，请重试。')
      return
    }
    if (!target.groupId) {
      setAppsError(t('projects.appEditOpened') || '已打开所属项目画布，未能定位到工作流组。')
    } else {
      setAppsError('')
    }
  }, [projects, navigation, t])

  // 4d. 卡片「删除」：先二次确认，再移除记录并关掉对应应用标签页。
  const confirmDeleteApp = () => {
    if (!pendingAppDelete) return
    const target = pendingAppDelete
    setPendingAppDelete(null)
    const result = removePublishedApp(target.appId)
    if (!result.ok) {
      setAppsError(t(APP_REMOVE_ERROR_KEYS[result.reason] || 'projects.appDeleteFailed')
        || '删除应用失败，请重试。')
      return
    }
    closeAppTab(target.appId)
    void reloadApps()
  }

  // 5. 在项目内新建创作页
  const handleCreatePageInProject = async () => {
    if (!selectedProject) return
    const currentPages = projectDetail?.pages ?? []
    const newTitle = `创作页 ${currentPages.length + 1}`
    setBusy(true)
    try {
      const res = await createProjectPage(selectedProject.id, newTitle)
      if (res.ok) {
        if (res.body?.project) {
          setProjectDetail(res.body.project)
          setProjects((current) => {
            const next = current.map((item) => (
              item.id === selectedProject.id
                ? { ...item, cover: res.body.project.cover ?? item.cover, pages: res.body.project.pages }
                : item
            ))
            cachedProjectsSnapshot = next
            return next
          })
        }
        await loadProjectDetail(selectedProject)
        void reload()
      } else {
        setError(errText(res, t))
      }
    } finally {
      setBusy(false)
    }
  }

  // 6. 重命名创作页
  const handleRenamePage = (page) => {
    if (!selectedProject) return
    setPromptModal({
      title: t('projects.renamePrompt') || '重命名创作页',
      placeholder: t('projects.namePlaceholder') || '请输入新名称',
      defaultValue: page.title || '',
      confirmLabel: t('projects.save') || '保存',
      onConfirm: async (next) => {
        if (!next.trim() || next.trim() === page.title) return
        setBusy(true)
        try {
          const res = await updateProjectPage(selectedProject.id, page.id, { title: next.trim() })
          if (res.ok) void loadProjectDetail(selectedProject)
          else setError(errText(res, t))
        } finally {
          setBusy(false)
        }
      },
    })
  }

  // 7. 删除创作页
  const handleDeletePage = (page) => {
    if (!selectedProject) return
    setPendingDeletePage(page)
  }

  const confirmDeletePage = async () => {
    if (!selectedProject || !pendingDeletePage) return
    const pageId = pendingDeletePage.id
    setPendingDeletePage(null)
    setBusy(true)
    try {
      const res = await deleteProjectPage(selectedProject.id, pageId)
      if (res.ok) void loadProjectDetail(selectedProject)
      else setError(errText(res, t))
    } finally {
      setBusy(false)
    }
  }

  // 8. 资产管理：新建文件夹
  const handleCreateFolder = () => {
    if (!selectedProject) return
    setPromptModal({
      title: '新建文件夹',
      placeholder: '请输入文件夹名称',
      defaultValue: '新建文件夹',
      confirmLabel: '创建',
      onConfirm: async (name) => {
        if (!name.trim()) return
        setBusy(true)
        try {
          const res = await mkdirProjectFile(selectedProject.id, name.trim(), assetsSubpath)
          if (res.ok) {
            void loadProjectAssets(selectedProject, assetsSubpath)
          } else {
            const wsId = selectedProject.pages?.find((page) => page.id === selectedProject.activePageId)?.canvasWorkspaceId || selectedProject.pages?.[0]?.canvasWorkspaceId || selectedProject.id
            await mkdirWorkspaceAsset(wsId, { name: name.trim() })
            void loadProjectAssets(selectedProject, assetsSubpath)
          }
        } finally {
          setBusy(false)
        }
      },
    })
  }

  // 9. 资产管理：上传文件 (物理工作区目录)
  const handleUploadFile = async () => {
    const ticket = projectGuard.capture()
    if (!visible || !selectedProject || pendingUpload.current === projectGuard || !projectGuard.isCurrent(ticket)) return
    pendingUpload.current = projectGuard
    try {
      const pickRes = await pickLocalFiles().catch(() => null)
      if (!projectGuard.isCurrent(ticket)) return
      if (!pickRes?.ok) {
        setPickerNotice(previous => ({
          id: (previous?.id ?? 0) + 1,
          projectGuard,
          message: errText(pickRes, t),
        }))
        return
      }
      const paths = pickRes.body?.paths
      if (!Array.isArray(paths) || !paths.length) return
      setError('')
      setUploadingProject(projectGuard)
      const uploadRes = await uploadProjectFiles(selectedProject.id, paths, assetsSubpath)
      if (!projectGuard.isCurrent(ticket)) return
      if (!uploadRes.ok) {
        const wsId = selectedProject.pages?.find((page) => page.id === selectedProject.activePageId)?.canvasWorkspaceId || selectedProject.pages?.[0]?.canvasWorkspaceId || selectedProject.id
        const indexed = await ingestWorkspaceAssets(wsId, {
          files: paths.map((source_path) => ({ source_path })),
        })
        if (!projectGuard.isCurrent(ticket)) return
        if (!indexed.ok) {
          setError(errText(indexed, t))
          return
        }
      }
      await loadProjectAssets(selectedProject, assetsSubpath)
    } catch (err) {
      if (projectGuard.isCurrent(ticket)) setError(err?.message || t('projects.genericError'))
    } finally {
      if (pendingUpload.current === projectGuard) pendingUpload.current = null
      if (projectGuard.isCurrent(ticket)) setUploadingProject(null)
    }
  }

  // 新建项目提交
  const handleDialogSubmit = async (payload) => {
    setBusy(true)
    setError('')
    try {
      const created = await runNewProject({
        sessions,
        workspaces,
        layout,
        betterSidebar,
        stage,
        t,
        getSessionNavigation,
        getSidebarRight,
      }, payload)
      if (!created?.ok) {
        setError(created?.error || t('projects.genericError') || '创建失败')
        return created
      }
      setDialogOpen(false)
      presence?.markVisible?.(created.project?.path || created.cwd)
      await reload()
      if (created.canvasOpened === false) {
        setError(t('projects.canvasNotOpened') || '项目已创建，但创作画布未能打开，请重试。')
      }
      return created
    } finally {
      setBusy(false)
    }
  }

  const handleRenameProject = useCallback((project) => {
    setPromptModal({
      title: t('projects.renamePrompt') || '重命名项目',
      placeholder: t('projects.namePlaceholder') || '请输入项目名称',
      defaultValue: project.title || '',
      confirmLabel: t('projects.save') || '保存',
      onConfirm: async (next) => {
        if (!next.trim() || next.trim() === project.title) return
        setBusy(true)
        try {
          const res = await renameProject(project.id, next.trim())
          if (res.ok) void reload()
          else setError(errText(res, t))
        } finally {
          setBusy(false)
        }
      },
    })
  }, [t, reload])

  const finishDelete = async (id, purge) => {
    setBusy(true)
    try {
      const res = await deleteProject(id, purge ? { purge: true } : undefined)
      if (res.ok) {
        if (selectedProject?.id === id) setSelectedProject(null)
        void reload()
      } else {
        setError(errText(res, t))
      }
    } finally {
      setBusy(false)
    }
  }

  const confirmRemoveProject = async () => {
    if (!pendingRemove) return
    const id = pendingRemove.id
    setPendingRemove(null)
    await finishDelete(id, false)
  }

  const confirmPurgeProject = async () => {
    if (!pendingPurge) return
    const id = pendingPurge.id
    setPendingPurge(null)
    await finishDelete(id, true)
  }

  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase()
    const matched = projects.filter((p) => {
      if (sourceFilter === 'bound' && !p.bound) return false
      if (sourceFilter === 'independent' && p.bound) return false
      if (!q) return true
      const titleMatch = (p.title || '').toLowerCase().includes(q)
      const wsMatch = extractWorkspaceTail(p.workspaceDir || '').toLowerCase().includes(q)
      return titleMatch || wsMatch
    })
    if (sortBy === 'titleAsc') {
      return [...matched].sort((a, b) => (a.title || '').localeCompare(b.title || '', 'zh-CN'))
    }
    return matched
  }, [projects, deferredQuery, sourceFilter, sortBy])

  const filteredApps = useMemo(
    () => apps.filter((app) => appEntryMatchesQuery(app, deferredQuery)),
    [apps, deferredQuery],
  )

  const sourceOptions = useMemo(() => [
    { value: 'all', label: t('projects.all') || '全部' },
    { value: 'bound', label: t('projects.bound') || '关联工作区' },
    { value: 'independent', label: t('projects.independent') || '独立项目' },
  ], [t])

  const sortOptions = useMemo(() => [
    { value: 'updatedDesc', label: t('projects.sortUpdatedShort') || '最近更新' },
    { value: 'titleAsc', label: t('projects.sortTitle') || '名称 A-Z' },
  ], [t])

  const clearLocalFilters = useCallback(() => {
    setQuery('')
    setSourceFilter('all')
  }, [])

  const rawPages = projectDetail?.pages ?? selectedProject?.pages ?? []
  const currentProjectPages = Array.isArray(rawPages) && rawPages.length > 0
    ? rawPages
    : [{
        id: 'page-default',
        title: selectedProject?.title || '创作页 1',
        canvasWorkspaceId: selectedProject?.pages?.find((page) => page.id === selectedProject?.activePageId)?.canvasWorkspaceId || selectedProject?.pages?.[0]?.canvasWorkspaceId || selectedProject?.id,
        createdAt: selectedProject?.createdAt || '',
      }]
  const detailBusy = busy || loadingDetail
  const isInitialLoading = !hasLoadedProjects && projects.length === 0 && !error

  return (
    <div
      role="region"
      aria-label={t('projects.title') || '项目'}
      aria-hidden={visible ? undefined : 'true'}
      className="omnimux-workflow-library-page omx-stage-scroll"
      data-visible={visible ? 'true' : 'false'}
    >
      {pickerNotice?.projectGuard === projectGuard && (
        <Toast
          key={pickerNotice.id}
          text={pickerNotice.message}
          icon={<Info size={16} />}
          onDone={() => setPickerNotice(current => current === pickerNotice ? null : current)}
        />
      )}

      {/* 视图分支 A：项目详情页 */}
      {selectedProject ? (
        <>
          <div className="omnimux-project-breadcrumb-bar">
            <div className="omnimux-project-breadcrumbs">
              <Button
                variant="ghost"
                size="sm"
                className="omnimux-project-crumb-link"
                onClick={() => setSelectedProject(null)}
                title="返回项目库"
              >
                {t('projects.breadcrumbLibrary') || '项目库'}
              </Button>
              <BreadcrumbChevron />
              <span className="omnimux-project-crumb-current">{selectedProject.title}</span>
            </div>
          </div>

          <div className="omnimux-project-detail-tabs-bar omx-stage-sticky">
            <Tabs
              variant="underline"
              items={[
                {
                  id: 'pages',
                  label: (
                    <span className="omnimux-tab-label-wrap">
                      {t('projects.detailTabPages') || '创作页'}
                      <Info size={13} className="omnimux-tab-info-icon" aria-label="查看并管理项目的所有创作页" />
                    </span>
                  ),
                },
                {
                  id: 'assets',
                  label: (
                    <span className="omnimux-tab-label-wrap">
                      {t('projects.detailTabAssets') || '项目资产'}
                      <Info size={13} className="omnimux-tab-info-icon" aria-label="查看并管理项目的所有资产文件" />
                    </span>
                  ),
                },
              ]}
              activeId={detailTab}
              onChange={setDetailTab}
            />
            {detailTab === 'pages' && (
              <Button
                variant="primary"
                className="omnimux-create-page-btn"
                leadingIcon={<IconPlusOutline16 />}
                disabled={detailBusy}
                onClick={handleCreatePageInProject}
                title={t('projects.newPage') || '新建创作页'}
              >
                {t('projects.newPage') || '新建创作页'}
              </Button>
            )}
          </div>

          {error ? (
            <div className="omnimux-workflow-library-error" role="alert">
              <span>{error}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setError('')
                  if (detailTab === 'assets') void loadProjectAssets(selectedProject, assetsSubpath)
                  else void loadProjectDetail(selectedProject)
                }}
              >
                {t('projects.retry') || '重试'}
              </Button>
            </div>
          ) : null}

          {detailTab === 'pages' && (
            <ProjectPagesTab
              pages={currentProjectPages}
              activePageId={projectDetail?.activePageId}
              openingPageId={openingPageId}
              onOpenPage={handleOpenPage}
              onCreatePage={handleCreatePageInProject}
              onRenamePage={handleRenamePage}
              onDeletePage={handleDeletePage}
              loading={detailBusy}
              t={t}
            />
          )}

          {detailTab === 'assets' && (
            <ProjectAssetsTab
              assetsDoc={assetsDoc}
              subpath={assetsSubpath}
              onNavigateSubpath={setAssetsSubpath}
              onCreateFolder={handleCreateFolder}
              onUploadFile={handleUploadFile}
              onRefresh={() => void loadProjectAssets(selectedProject, assetsSubpath)}
              loading={loadingAssets || uploadingProject === projectGuard}
              t={t}
            />
          )}
        </>
      ) : (
        /* 视图分支 B：顶层项目文件夹列表（单行紧凑页头 + 吸顶筛选排序栏） */
        <>
          <PageHeader
            title={t('workflow.pageTitle') || '项目'}
            badge={libraryTab === 'local' && hasLoadedProjects && projects.length > 0 ? (
              <span className="omnimux-workflow-count-badge">{projects.length}</span>
            ) : undefined}
            actions={(
              <div className="omnimux-workflow-library-action-row">
                <Button
                  variant="primary"
                  leadingIcon={<IconPlusOutline16 />}
                  onClick={() => { setDialogOpen(true) }}
                >
                  {t('workflow.action.new') || '新建项目'}
                </Button>
              </div>
            )}
          />

          <FilterBar
            className="omnimux-workflow-library-filter omx-stage-sticky"
            filters={(
              <Tabs
                variant="underline"
                items={[
                  { id: 'local', label: t('projects.localTab') || '本地项目' },
                  {
                    id: 'featured',
                    label: t('workflow.tab.featured') || '共创项目（即将上线）',
                    disabled: true,
                  },
                  { id: 'apps', label: t('workflow.tab.aiApps') || 'AI应用' },
                ]}
                activeId={libraryTab}
                onChange={handleLibraryTabChange}
              />
            )}
            search={(
              <SearchField
                value={query}
                placeholder={t('projects.searchPlaceholder') || '搜索项目名称'}
                onValueChange={setQuery}
                onClear={() => { setQuery('') }}
              />
            )}
            tools={libraryTab === 'local' ? (
              <div className="omnimux-workflow-filter-tools">
                <DropdownSelect
                  aria-label={t('projects.sourceFilterLabel') || '项目来源'}
                  value={sourceFilter}
                  options={sourceOptions}
                  onChange={setSourceFilter}
                  align="end"
                />
                <DropdownSelect
                  aria-label={t('projects.sortLabel') || '排序方式'}
                  value={sortBy}
                  options={sortOptions}
                  onChange={setSortBy}
                  align="end"
                />
              </div>
            ) : undefined}
          />

          {error ? (
            <div className="omnimux-workflow-library-error" role="alert">
              <span>{error}</span>
              <Button variant="ghost" size="sm" onClick={() => void reload()}>
                {t('projects.retry') || '重试'}
              </Button>
            </div>
          ) : null}
          {appsError ? (
            <div className="omnimux-workflow-library-error" role="alert">
              <span>{appsError}</span>
            </div>
          ) : null}

          <div className="omnimux-workflow-library-body">
            {libraryTab === 'apps' ? (
              filteredApps.length === 0 ? (
                <div className="omnimux-workflow-library-empty">
                  <div className="omnimux-workflow-library-empty-title">{t('projects.appsEmptyTitle') || '还没有 AI 应用'}</div>
                  <div className="omnimux-workflow-library-empty-sub">{t('projects.appsEmptySubtitle') || '在创作画布中把工作流打组后点「发布应用」，发布的应用会出现在这里。'}</div>
                </div>
              ) : (
                <div className="omnimux-workflow-grid">
                  {filteredApps.map((app) => (
                    <AIAppCard
                      key={app.appId}
                      app={app}
                      t={t}
                      onOpen={handleOpenApp}
                      onEdit={(target) => { void handleEditApp(target) }}
                      onDelete={setPendingAppDelete}
                    />
                  ))}
                </div>
              )
            ) : isInitialLoading ? (
              <div className="omnimux-workflow-grid" aria-busy="true" data-loading-skeleton="true">
                {Array.from({ length: SKELETON_CARD_COUNT }, (_, index) => (
                  <div key={index} className="omnimux-folder-skeleton" aria-hidden="true">
                    <div className="omnimux-skeleton-line omnimux-skeleton-line--title" />
                    <div className="omnimux-skeleton-line omnimux-skeleton-line--meta" />
                    <div className="omnimux-skeleton-line omnimux-skeleton-line--short" />
                  </div>
                ))}
              </div>
            ) : projects.length === 0 ? (
              <div className="omnimux-workflow-library-empty">
                <div className="omnimux-workflow-library-empty-title">{t('projects.emptyTitle') || '暂无项目'}</div>
                <div className="omnimux-workflow-library-empty-sub">{t('projects.emptySubtitle') || '点击下方按钮创建第一个项目工程'}</div>
                <Button
                  variant="primary"
                  leadingIcon={<IconPlusOutline16 />}
                  onClick={() => { setDialogOpen(true) }}
                >
                  {t('projects.newButton') || '新建项目'}
                </Button>
              </div>
            ) : filtered.length === 0 ? (
              <div className="omnimux-workflow-library-empty" data-empty-kind="search">
                <div className="omnimux-workflow-library-empty-title">{t('projects.emptySearch') || '没有匹配的项目'}</div>
                <div className="omnimux-workflow-library-empty-sub">{t('projects.emptySearchSub') || '当前搜索或筛选条件下未找到匹配项目'}</div>
                <Button variant="secondary" onClick={clearLocalFilters}>
                  {t('projects.clearFilters') || '清空筛选'}
                </Button>
              </div>
            ) : (
              <div className="omnimux-workflow-grid">
                {filtered.map((project) => (
                  <ProjectFolderCard
                    key={project.id}
                    project={project}
                    onOpen={handleSelectFolder}
                    onRename={handleRenameProject}
                    onRemove={setPendingRemove}
                    onPurge={setPendingPurge}
                    t={t}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {dialogOpen ? (
        <NewLocalProjectDialog
          t={t}
          busy={busy}
          error={error}
          initialPath=""
          initialTitle=""
          onCancel={() => { if (!busy) setDialogOpen(false) }}
          onClearError={() => setError('')}
          onSubmit={handleDialogSubmit}
        />
      ) : null}

      {pendingRemove ? (
        <ConfirmModal
          open
          onClose={() => { setPendingRemove(null) }}
          title={t('projects.removeFromLibrary') || '移出项目库'}
          message={(t('projects.removeFromLibraryConfirm') || '将把「{title}」移出项目库，画布与资产保留在磁盘，可再次打开。').replace('{title}', pendingRemove.title)}
          confirmLabel={t('projects.removeFromLibrary') || '移出项目库'}
          cancelLabel={t('projects.dialog.cancel') || '取消'}
          onConfirm={() => { void confirmRemoveProject() }}
        />
      ) : null}

      {pendingPurge ? (
        <ConfirmModal
          open
          onClose={() => { setPendingPurge(null) }}
          title={t('projects.purge') || '删除项目'}
          message={(t('projects.purgeConfirm') || '将删除「{title}」的画布与资产（.omnimux/canvases 与 assets.json）。项目文件夹中的其他文件会保留，此操作不可撤销。').replace('{title}', pendingPurge.title)}
          confirmLabel={t('projects.purge') || '删除项目'}
          cancelLabel={t('projects.dialog.cancel') || '取消'}
          confirmVariant="danger"
          onConfirm={() => { void confirmPurgeProject() }}
        />
      ) : null}

      {pendingAppDelete ? (
        <ConfirmModal
          open
          onClose={() => { setPendingAppDelete(null) }}
          title={t('projects.appDelete') || '删除应用'}
          message={(t('projects.appDeleteConfirm') || '将删除应用「{title}」，其侧栏标签页会一并关闭。').replace('{title}', pendingAppDelete.name)}
          confirmLabel={t('projects.appDelete') || '删除'}
          cancelLabel={t('projects.dialog.cancel') || '取消'}
          confirmVariant="danger"
          onConfirm={confirmDeleteApp}
        />
      ) : null}

      {pendingDeletePage ? (
        <ConfirmModal
          open
          onClose={() => { setPendingDeletePage(null) }}
          title={t('projects.deletePageTitle') || '删除创作页'}
          message={(t('projects.deletePageConfirm') || '确定要删除创作页「{title}」吗？').replace('{title}', pendingDeletePage.title)}
          confirmLabel={t('projects.delete') || '删除'}
          cancelLabel={t('projects.dialog.cancel') || '取消'}
          confirmVariant="danger"
          onConfirm={() => { void confirmDeletePage() }}
        />
      ) : null}

      {promptModal ? (
        <PromptModal
          open
          title={promptModal.title}
          placeholder={promptModal.placeholder}
          defaultValue={promptModal.defaultValue}
          confirmLabel={promptModal.confirmLabel}
          cancelLabel={t('projects.dialog.cancel') || '取消'}
          onClose={() => setPromptModal(null)}
          onConfirm={(val) => {
            const fn = promptModal.onConfirm
            setPromptModal(null)
            void fn(val)
          }}
        />
      ) : null}
    </div>
  )
}
