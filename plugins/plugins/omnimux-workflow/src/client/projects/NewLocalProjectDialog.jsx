import { useEffect, useRef, useState } from 'react'
import { Button, IconButton, IconCloseOutline16, InputField, ModalDialog } from 'dsh-ui-kit'
import {
  IconArchiveOutlineRegular,
  IconFolderCloseRegular,
  IconInfoOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { pickProjectDirectory, preflightProject } from '../api.js'
import { useAsyncInstanceGuard } from '../../canvas/editor/hooks/useAsyncInstanceGuard.ts'
import { MAX_PROJECT_TITLE_LENGTH } from './limits.js'
import { extractFolderName, firstPickedDirectory } from './pickDirectory.js'

const PREFLIGHT_ACTIONS = {
  initialize: { status: 'projects.preflight.initialize', submit: 'projects.dialog.submit' },
  open: { status: 'projects.preflight.open', submit: 'projects.openProject' },
  converge: { status: 'projects.preflight.open', submit: 'projects.openProject' },
  rebuild: { status: 'projects.preflight.rebuild', submit: 'projects.rebuildAndOpen' },
  repair: { status: 'projects.preflight.repair', submit: 'projects.repairAndOpen' },
  'create-independent': { status: 'projects.preflight.independent', submit: 'projects.dialog.submit' },
}

/**
 * @param {{
 *   t: (key: string) => string,
 *   busy?: boolean,
 *   error?: string,
 *   initialPath?: string,
 *   initialTitle?: string,
 *   onCancel: () => void,
 *   onClearError?: () => void,
 *   onSubmit: (payload: { title: string, mode: 'independent'|'workspace', workspaceDir?: string }) => void | Promise<unknown>,
 *   onPickDirectory?: () => Promise<unknown>,
 *   onBrowseDirectory?: () => Promise<unknown>,
 *   onPreflight?: (payload: { mode: 'workspace', workspaceDir: string }) => Promise<unknown>,
 * }} props
 */
export function NewLocalProjectDialog({
  t,
  busy = false,
  error,
  initialPath = '',
  initialTitle = '',
  onCancel,
  onClearError,
  onSubmit,
  onPickDirectory,
  onBrowseDirectory,
  onPreflight,
}) {
  const chooseRef = useRef(null)
  const defaultTitle = initialTitle || extractFolderName(initialPath)
  const [name, setName] = useState(defaultTitle)
  const [selection, setSelection] = useState({ path: initialPath || '' })
  const nameTouched = useRef(Boolean(defaultTitle))
  const pickGuard = useAsyncInstanceGuard(true)
  const [picking, setPicking] = useState(false)
  const [pickError, setPickError] = useState('')
  const [directoryCheck, setDirectoryCheck] = useState(null)
  const trimmedPath = selection.path.trim()

  useEffect(() => {
    if (!trimmedPath) return
    let current = true
    const run = typeof onPreflight === 'function' ? onPreflight : preflightProject
    const record = (result) => {
      if (current) setDirectoryCheck({ selection, result })
    }
    Promise.resolve()
      .then(() => run({ mode: 'workspace', workspaceDir: trimmedPath }))
      .then((response) => record(response?.ok ? response.body : null), () => record(null))
    return () => { current = false }
  }, [selection, trimmedPath, onPreflight])

  const trimmed = name.trim()
  const hasFolder = trimmedPath !== ''
  const checked = directoryCheck?.selection === selection
  const preflight = hasFolder && checked ? directoryCheck.result : null
  const preflighting = hasFolder && !checked
  const mode = hasFolder ? 'workspace' : 'independent'
  const preflightMeta = PREFLIGHT_ACTIONS[hasFolder ? preflight?.action : 'create-independent']
  const canSubmit = trimmed !== '' && trimmed.length <= MAX_PROJECT_TITLE_LENGTH && !busy && !picking && Boolean(preflightMeta)
  const statusKey = preflighting ? 'projects.preflight.checking' : (preflightMeta?.status || 'projects.preflight.failed')
  let statusState = 'independent'
  if (hasFolder) statusState = preflighting ? 'checking' : (preflightMeta && preflight?.state) || 'failed'
  const submitKey = preflightMeta?.submit || 'projects.dialog.submit'
  const operationError = !preflighting && (pickError || error)
  const statusText = String(t(statusKey) || '').replace('{title}', () => preflight?.project?.title || '')

  const submit = () => {
    if (!canSubmit) return
    void Promise.resolve(onSubmit({
      title: trimmed,
      mode,
      ...(mode === 'workspace' ? { workspaceDir: trimmedPath } : {}),
    })).catch(() => {})
  }

  const applyPickedPath = (nextPath) => {
    const next = typeof nextPath === 'string' ? nextPath.trim() : ''
    if (next === '') return
    setSelection({ path: next })
    onClearError?.()
    if (!nameTouched.current) {
      const fromFolder = extractFolderName(next)
      if (fromFolder) setName(fromFolder)
    }
  }

  const handleCancel = () => {
    if (busy) return
    pickGuard.deactivate()
    onCancel()
  }

  const handlePickDirectory = async () => {
    if (busy || picking) return
    const ticket = pickGuard.capture()
    if (!pickGuard.isCurrent(ticket)) return
    setPicking(true)
    setPickError('')
    try {
      const picker = typeof onPickDirectory === 'function'
        ? onPickDirectory
        : typeof onBrowseDirectory === 'function'
          ? onBrowseDirectory
          : pickProjectDirectory
      const result = await picker()
      if (!pickGuard.isCurrent(ticket)) return
      if (result?.ok === false) {
        setPickError(result.body?.message || t('projects.dialog.browseFailed'))
        return
      }
      const chosen = firstPickedDirectory(result)
      if (chosen) {
        applyPickedPath(chosen)
      }
    } catch {
      if (pickGuard.isCurrent(ticket)) setPickError(t('projects.dialog.browseFailed'))
    } finally {
      if (pickGuard.isCurrent(ticket)) setPicking(false)
    }
  }

  return (
    <ModalDialog
      open
      onClose={handleCancel}
      title={t('projects.dialog.title')}
      titleIcon={<IconFolderCloseRegular size={18} />}
      closeLabel={t('projects.close')}
      className="omnimux-project-create"
      size="md"
      footer={(
        <div className="omnimux-workflow-dialog-footer">
          <Button variant="secondary" disabled={busy} onClick={handleCancel}>
            {t('projects.dialog.cancel')}
          </Button>
          <Button variant="primary" disabled={!canSubmit} loading={busy} onClick={submit}>
            {t(submitKey) || t('projects.dialog.submit') || '创建项目'}
          </Button>
        </div>
      )}
    >
      <div className="omnimux-workflow-form">
        <div className="omnimux-project-create-fields">
          <div className="omnimux-new-project-name">
            <InputField
              id="omnimux-new-local-project-name"
              className="omnimux-new-project-name-field"
              data-modal-autofocus=""
              value={name}
              maxLength={MAX_PROJECT_TITLE_LENGTH}
              placeholder={t('projects.dialog.namePlaceholder')}
              disabled={busy}
              aria-label={t('projects.dialog.nameLabel')}
              onChange={(event) => {
                setName(event.target.value)
                nameTouched.current = event.target.value.trim() !== ''
                if (error) onClearError?.()
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing && canSubmit) {
                  event.preventDefault()
                  submit()
                }
              }}
            />
          </div>

          <div
            className="omnimux-project-create-location"
            data-omnimux-new-project-picked={hasFolder ? '' : undefined}
          >
            <span className="omnimux-project-create-location-icon" aria-hidden="true">
              {hasFolder ? <IconFolderCloseRegular size={16} /> : <IconArchiveOutlineRegular size={16} />}
            </span>
            <div className="omnimux-project-create-destination">
              <span className="omnimux-project-create-location-label">{t('projects.dialog.pathLabel')}</span>
              <span className="omnimux-project-create-path" title={trimmedPath || undefined}>
                {hasFolder ? trimmedPath : t('projects.dialog.defaultLibrary')}
              </span>
            </div>
            <Button
              ref={chooseRef}
              variant="ghost"
              className="omnimux-project-create-change"
              disabled={busy || picking}
              data-omnimux-new-project-change={hasFolder ? '' : undefined}
              data-omnimux-new-project-drop={hasFolder ? undefined : ''}
              onClick={handlePickDirectory}
            >
              {t(hasFolder ? 'projects.dialog.change' : 'projects.dialog.addFolder')}
            </Button>
            {hasFolder && (
              <IconButton
                variant="ghost"
                size="sm"
                disabled={busy || picking}
                aria-label={t('projects.dialog.removeFolder')}
                title={t('projects.dialog.removeFolder')}
                data-omnimux-new-project-remove=""
                onClick={() => {
                  setSelection({ path: '' })
                  setPickError('')
                  onClearError?.()
                  chooseRef.current?.focus()
                }}
              >
                <IconCloseOutline16 size={14} />
              </IconButton>
            )}
          </div>
        </div>

        <p
          className="omnimux-project-create-status"
          data-omnimux-new-project-preflight={statusState}
          data-preflight-state={statusState}
          data-preflight-action={preflight?.action || ''}
          data-error={operationError || statusState === 'failed' ? '' : undefined}
          role="status"
        >
          <span className="omnimux-project-create-location-icon" aria-hidden="true"><IconInfoOutlineRegular size={16} /></span>
          <span>{operationError || statusText}</span>
        </p>
      </div>
    </ModalDialog>
  )
}
