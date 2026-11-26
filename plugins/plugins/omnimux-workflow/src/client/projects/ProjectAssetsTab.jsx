import React, { useState } from 'react'
import { Button, IconButton, IconLoadingOutline16, IconRefreshOutline16, SearchField } from 'dsh-ui-kit'

function SvgIcon({ d, size = 16, className = '' }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {d}
    </svg>
  )
}

const Folder = ({ size = 16, className = '' }) => (
  <SvgIcon size={size} className={className} d={<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />} />
)

const FolderPlus = ({ size = 16, className = '' }) => (
  <SvgIcon
    size={size}
    className={className}
    d={
      <>
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        <line x1="12" y1="11" x2="12" y2="17" />
        <line x1="9" y1="14" x2="15" y2="14" />
      </>
    }
  />
)

const Upload = ({ size = 16, className = '' }) => (
  <SvgIcon
    size={size}
    className={className}
    d={
      <>
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="17 8 12 3 7 8" />
        <line x1="12" y1="3" x2="12" y2="15" />
      </>
    }
  />
)

const Film = ({ size = 16, className = '' }) => (
  <SvgIcon
    size={size}
    className={className}
    d={
      <>
        <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" />
        <line x1="7" y1="2" x2="7" y2="22" />
        <line x1="17" y1="2" x2="17" y2="22" />
        <line x1="2" y1="12" x2="22" y2="12" />
        <line x1="2" y1="7" x2="7" y2="7" />
        <line x1="2" y1="17" x2="7" y2="17" />
        <line x1="17" y1="17" x2="22" y2="17" />
        <line x1="17" y1="7" x2="22" y2="7" />
      </>
    }
  />
)

const ImageIcon = ({ size = 16, className = '' }) => (
  <SvgIcon
    size={size}
    className={className}
    d={
      <>
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <polyline points="21 15 16 10 5 21" />
      </>
    }
  />
)

const Music = ({ size = 16, className = '' }) => (
  <SvgIcon
    size={size}
    className={className}
    d={
      <>
        <path d="M9 18V5l12-2v13" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="18" cy="16" r="3" />
      </>
    }
  />
)

const FileText = ({ size = 16, className = '' }) => (
  <SvgIcon
    size={size}
    className={className}
    d={
      <>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
        <polyline points="10 9 9 9 8 9" />
      </>
    }
  />
)

function formatBytes(bytes) {
  if (!bytes || typeof bytes !== 'number') return '-'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatAssetDate(value) {
  if (!value) return '-'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '-'
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}.${m}.${d}`
}

function FileTypeIcon({ type, isFolder }) {
  if (isFolder) return <Folder size={16} className="omnimux-file-icon-folder" />
  if (type === 'video') return <Film size={16} className="omnimux-file-icon-media" />
  if (type === 'image') return <ImageIcon size={16} className="omnimux-file-icon-media" />
  if (type === 'audio') return <Music size={16} className="omnimux-file-icon-media" />
  return <FileText size={16} className="omnimux-file-icon-media" />
}

export function ProjectAssetsTab({
  assetsDoc,
  subpath = '',
  onNavigateSubpath,
  onCreateFolder,
  onUploadFile,
  onRefresh,
  loading = false,
  t,
}) {
  const [query, setQuery] = useState('')
  const [virtualFolderId, setVirtualFolderId] = useState(null)

  const folders = assetsDoc?.folders ?? []
  const items = assetsDoc?.items ?? []
  const isPhysicalMode = typeof onNavigateSubpath === 'function' && assetsDoc?.mode === 'physical'

  const visibleFolders = isPhysicalMode
    ? folders
    : folders.filter((f) => (f.parentId ?? null) === virtualFolderId)
  const visibleItems = isPhysicalMode
    ? items
    : items.filter((item) => (item.folderId ?? null) === virtualFolderId)

  const q = query.trim().toLowerCase()
  const filteredFolders = visibleFolders.filter((f) => !q || f.name.toLowerCase().includes(q))
  const filteredItems = visibleItems.filter((item) => !q || item.name.toLowerCase().includes(q))

  const virtualFolder = !isPhysicalMode ? folders.find((f) => f.id === virtualFolderId) : null
  const physicalSegments = isPhysicalMode && subpath ? subpath.split('/').filter(Boolean) : []

  const openFolder = (folder) => {
    setQuery('')
    if (isPhysicalMode) {
      onNavigateSubpath(folder.id)
    } else {
      setVirtualFolderId(folder.id)
    }
  }

  const navigateRoot = () => {
    setQuery('')
    if (isPhysicalMode) {
      onNavigateSubpath('')
    } else {
      setVirtualFolderId(null)
    }
  }

  return (
    <div className="omnimux-assets-tab">
      <div className="omnimux-assets-action-row">
        <Button
          variant="ghost"
          className="omnimux-assets-action-card"
          onClick={onCreateFolder}
          title="在当前目录下新建文件夹"
        >
          <span className="omnimux-assets-card-icon-box" aria-hidden="true">
            <FolderPlus size={20} />
          </span>
          <span className="omnimux-assets-card-text">
            <span className="omnimux-assets-card-title">新建文件夹</span>
            <span className="omnimux-assets-card-subtitle">在当前目录下新建</span>
          </span>
        </Button>

        <Button
          variant="ghost"
          className="omnimux-assets-action-card"
          onClick={onUploadFile}
          title="上传文件到工作区目录 (支持批量上传)"
        >
          <span className="omnimux-assets-card-icon-box" aria-hidden="true">
            <Upload size={20} />
          </span>
          <span className="omnimux-assets-card-text">
            <span className="omnimux-assets-card-title">上传文件</span>
            <span className="omnimux-assets-card-subtitle">支持批量上传</span>
          </span>
        </Button>
      </div>

      <div className="omnimux-assets-browser">
        <div className="omnimux-assets-filter-line">
          <div className="omnimux-project-breadcrumbs">
            {physicalSegments.length > 0 || virtualFolder ? (
              <Button
                variant="ghost"
                size="sm"
                className="omnimux-project-crumb-link"
                onClick={navigateRoot}
              >
                {t?.('projects.assetsAllFiles') || '全部文件'}
              </Button>
            ) : (
              <span className="omnimux-project-crumb-current">
                {t?.('projects.assetsAllFiles') || '全部文件'}
              </span>
            )}
            {physicalSegments.map((segment, index) => {
              const target = physicalSegments.slice(0, index + 1).join('/')
              const isLast = index === physicalSegments.length - 1
              return (
                <React.Fragment key={target}>
                  <span className="omnimux-project-crumb-sep" aria-hidden="true">/</span>
                  {isLast ? (
                    <span className="omnimux-project-crumb-current">{segment}</span>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="omnimux-project-crumb-link"
                      onClick={() => onNavigateSubpath(target)}
                    >
                      {segment}
                    </Button>
                  )}
                </React.Fragment>
              )
            })}
            {virtualFolder && (
              <>
                <span className="omnimux-project-crumb-sep" aria-hidden="true">/</span>
                <span className="omnimux-project-crumb-current">{virtualFolder.name}</span>
              </>
            )}
          </div>

          <div className="omnimux-assets-search-cluster">
            <SearchField
              value={query}
              placeholder={t?.('projects.assetsSearchPlaceholder') || '搜索文件名'}
              onValueChange={setQuery}
              onClear={() => setQuery('')}
            />
            {onRefresh && (
              <IconButton
                variant="ghost"
                size="sm"
                aria-label={t?.('projects.refresh') || '刷新'}
                title="刷新资产列表"
                onClick={onRefresh}
                disabled={loading}
              >
                {loading ? <IconLoadingOutline16 /> : <IconRefreshOutline16 />}
              </IconButton>
            )}
          </div>
        </div>

        <table className="omnimux-assets-table">
          <thead>
            <tr>
              <th className="omnimux-col-name">名称</th>
              <th className="omnimux-col-size">大小</th>
              <th className="omnimux-col-time">更新时间</th>
            </tr>
          </thead>
          <tbody>
            {loading && !assetsDoc ? (
              Array.from({ length: 4 }, (_, index) => (
                <tr key={`skel-${index}`} aria-hidden="true">
                  <td><div className="omnimux-skeleton-line omnimux-skeleton-line--title" /></td>
                  <td><div className="omnimux-skeleton-line omnimux-skeleton-line--short" /></td>
                  <td><div className="omnimux-skeleton-line omnimux-skeleton-line--short" /></td>
                </tr>
              ))
            ) : (
              <>
                {filteredFolders.map((f) => (
                  <tr key={f.id} className="omnimux-assets-folder-row" onClick={() => openFolder(f)}>
                    <td>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="omnimux-file-folder-btn"
                        onClick={(event) => {
                          event.stopPropagation()
                          openFolder(f)
                        }}
                      >
                        <FileTypeIcon isFolder />
                        <span className="omnimux-file-folder-name">{f.name}</span>
                      </Button>
                    </td>
                    <td className="omnimux-assets-num-cell">-</td>
                    <td className="omnimux-assets-num-cell">{formatAssetDate(f.updatedAt)}</td>
                  </tr>
                ))}

                {filteredItems.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <div className="omnimux-file-name-cell">
                        <FileTypeIcon type={item.type} />
                        <span>{item.name}</span>
                      </div>
                    </td>
                    <td className="omnimux-assets-num-cell">{formatBytes(item.size)}</td>
                    <td className="omnimux-assets-num-cell">{formatAssetDate(item.updatedAt)}</td>
                  </tr>
                ))}

                {filteredFolders.length === 0 && filteredItems.length === 0 && (
                  <tr>
                    <td colSpan={3} className="omnimux-assets-empty-cell">
                      {q
                        ? (t?.('projects.emptySearch') || '没有匹配的项目')
                        : (t?.('projects.assetsEmpty') || '暂无文件，点击上方新建文件夹或上传文件')}
                    </td>
                  </tr>
                )}
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
