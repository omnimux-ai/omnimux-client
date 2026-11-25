import { useEffect, useState } from 'react'
import { Badge, Button, ConfirmModal, IconButton, InputField } from 'dsh-ui-kit'
import {
  ClockIcon,
  CloseIcon,
  GitCompareIcon,
  HistoryIcon,
  PlusIcon,
  RotateCcwIcon,
  TagIcon,
  TrashIcon,
} from '../icons.jsx'

/**
 * Format a numeric epoch timestamp as YYYY-MM-DD HH:mm:ss.
 * @param {number} timestamp
 */
function formatSnapshotTime(timestamp) {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return ''
  const d = new Date(timestamp)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/**
 * Right-hand Version History Drawer for the Asset Text Editor modal.
 * Uses dsh-ui-kit ConfirmModal for revert/delete confirmations (zero window.confirm).
 */
export function AssetVersionDrawer(props) {
  const {
    open,
    onClose,
    versions = [],
    readOnly = false,
    busy = false,
    onCreateSnapshot,
    onOpenDiff,
    onRevertSnapshot,
    onDeleteSnapshot,
    onConfirmOpenChange,
    t,
  } = props

  const [isCreating, setIsCreating] = useState(false)
  const [snapshotName, setSnapshotName] = useState('')
  const [pendingRevert, setPendingRevert] = useState(null)
  const [pendingDelete, setPendingDelete] = useState(null)

  const confirmOpen = Boolean(pendingRevert || pendingDelete)
  useEffect(() => {
    onConfirmOpenChange?.(confirmOpen)
    return () => onConfirmOpenChange?.(false)
  }, [confirmOpen, onConfirmOpenChange])

  if (!open) return null

  const getSourceMeta = (source) => {
    if (source === 'revert') return { label: t('textEditor.sourceRevert'), variant: 'warning' }
    if (source === 'auto') return { label: t('textEditor.sourceAuto'), variant: 'info' }
    return { label: t('textEditor.sourceManual'), variant: 'neutral' }
  }

  const handleCreate = async () => {
    if (busy || readOnly) return
    const ok = await onCreateSnapshot?.(snapshotName)
    if (ok !== false) {
      setSnapshotName('')
      setIsCreating(false)
    }
  }

  const handleConfirmRevert = async () => {
    if (!pendingRevert || busy) return
    const target = pendingRevert
    await onRevertSnapshot?.(target.id)
    setPendingRevert(null)
  }

  const handleConfirmDelete = async () => {
    if (!pendingDelete || busy) return
    const target = pendingDelete
    await onDeleteSnapshot?.(target.id)
    setPendingDelete(null)
  }

  return (
    <aside className="omnimux-ate-drawer" aria-label={t('textEditor.versionHistory')}>
      <div className="omnimux-ate-drawer-header">
        <div className="omnimux-ate-drawer-title">
          <HistoryIcon size={15} />
          <span>{t('textEditor.versionHistory')}</span>
          <Badge size="sm" variant="neutral">{versions.length}</Badge>
        </div>
        <IconButton
          variant="ghost"
          size="xs"
          aria-label={t('textEditor.closeDrawer')}
          title={t('textEditor.closeDrawer')}
          onClick={onClose}
        >
          <CloseIcon size={14} />
        </IconButton>
      </div>

      {!readOnly ? (
        <div className="omnimux-ate-drawer-create">
          {isCreating ? (
            <div className="omnimux-ate-drawer-form">
              <InputField
                aria-label={t('textEditor.snapshotNamePlaceholder')}
                placeholder={t('textEditor.snapshotNamePlaceholder')}
                value={snapshotName}
                disabled={busy}
                autoFocus
                onChange={(event) => setSnapshotName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void handleCreate()
                  } else if (event.key === 'Escape') {
                    event.preventDefault()
                    event.stopPropagation()
                    setIsCreating(false)
                  }
                }}
              />
              <div className="omnimux-ate-drawer-form-actions">
                <Button
                  variant="ghost"
                  size="xs"
                  disabled={busy}
                  onClick={() => setIsCreating(false)}
                >
                  {t('textEditor.cancel')}
                </Button>
                <Button
                  variant="primary"
                  size="xs"
                  loading={busy}
                  onClick={() => void handleCreate()}
                >
                  {t('textEditor.confirmCreate')}
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="omnimux-ate-drawer-new-btn"
              leadingIcon={<PlusIcon size={14} />}
              disabled={busy}
              onClick={() => setIsCreating(true)}
            >
              {t('textEditor.newSnapshot')}
            </Button>
          )}
        </div>
      ) : null}

      <div className="omnimux-ate-drawer-list">
        {versions.length === 0 ? (
          <div className="omnimux-ate-drawer-empty">
            <ClockIcon size={28} />
            <span>{t('textEditor.noVersions')}</span>
          </div>
        ) : (
          versions.map((ver) => {
            const meta = getSourceMeta(ver.source)
            return (
              <div key={ver.id} className="omnimux-ate-version-card" data-version-id={ver.id}>
                <div className="omnimux-ate-version-head">
                  <span className="omnimux-ate-version-name" title={ver.name}>
                    {ver.name}
                  </span>
                  <Badge size="sm" variant={meta.variant} icon={<TagIcon size={10} />}>
                    {meta.label}
                  </Badge>
                </div>

                <div className="omnimux-ate-version-meta">
                  <span>{formatSnapshotTime(ver.timestamp)}</span>
                  <span>
                    {ver.wordCount ?? 0} {t('textEditor.words')} / {ver.charCount ?? 0} {t('textEditor.chars')}
                  </span>
                </div>

                <div className="omnimux-ate-version-actions">
                  <Button
                    variant="outline"
                    size="xs"
                    leadingIcon={<GitCompareIcon size={12} />}
                    title={t('textEditor.diffHint')}
                    onClick={() => onOpenDiff?.(ver)}
                  >
                    {t('textEditor.diff')}
                  </Button>
                  {!readOnly ? (
                    <>
                      <Button
                        variant="outline"
                        size="xs"
                        leadingIcon={<RotateCcwIcon size={12} />}
                        title={t('textEditor.revertHint')}
                        disabled={busy}
                        onClick={() => setPendingRevert(ver)}
                      >
                        {t('textEditor.revert')}
                      </Button>
                      <IconButton
                        variant="ghost"
                        size="xs"
                        className="omnimux-ate-danger-icon-btn"
                        aria-label={t('textEditor.delete')}
                        title={t('textEditor.delete')}
                        disabled={busy}
                        onClick={() => setPendingDelete(ver)}
                      >
                        <TrashIcon size={13} />
                      </IconButton>
                    </>
                  ) : null}
                </div>
              </div>
            )
          })
        )}
      </div>

      {pendingRevert ? (
        <ConfirmModal
          open
          onClose={() => setPendingRevert(null)}
          title={t('textEditor.revertTitle')}
          message={t('textEditor.revertConfirm').replace('{name}', String(pendingRevert.name || ''))}
          confirmLabel={t('textEditor.revert')}
          cancelLabel={t('textEditor.cancel')}
          confirmVariant="primary"
          confirmLoading={busy}
          onConfirm={() => void handleConfirmRevert()}
        />
      ) : null}

      {pendingDelete ? (
        <ConfirmModal
          open
          onClose={() => setPendingDelete(null)}
          title={t('textEditor.deleteTitle')}
          message={t('textEditor.deleteConfirm').replace('{name}', String(pendingDelete.name || ''))}
          confirmLabel={t('textEditor.delete')}
          cancelLabel={t('textEditor.cancel')}
          confirmVariant="danger"
          confirmLoading={busy}
          onConfirm={() => void handleConfirmDelete()}
        />
      ) : null}
    </aside>
  )
}
