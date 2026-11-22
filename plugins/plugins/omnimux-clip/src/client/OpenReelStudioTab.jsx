import { useEffect, useRef, useState } from 'react'
import { Button, DropdownSelect } from 'dsh-ui-kit'
import { useHostLocale } from './useHostLocale.js'
import OpenReelApp from './openreel/web/App.tsx'
import { useProjectStore } from './openreel/web/stores/project-store.ts'
import { resetOpenReelRouter } from './openreel/web/hooks/use-router.ts'
import { EditorOpening, EditorSyncNotice, useEditorInert, useEditorSeat } from './live/EditorSeat.jsx'
import './openreel/web/index.css'
import './theme/dsw-map.css'

const PRESETS = [
  ['1920x1080', 'tab.landscape'],
  ['1080x1920', 'tab.portrait'],
  ['1080x1080', 'tab.square'],
  ['1280x720', 'tab.landscape'],
]
const FRAME_RATES = ['24', '25', '30', '60'].map(value => ({ value, label: `${value} fps` }))

function StudioCreateForm({ t, onCreated, onWelcome }) {
  const [name, setName] = useState('')
  const [preset, setPreset] = useState('1920x1080')
  const [fps, setFps] = useState('30')
  const submit = (event) => {
    event.preventDefault()
    const [width, height] = preset.split('x').map(Number)
    useProjectStore.getState().createNewProject(name.trim() || t('tab.untitled'), { width, height, frameRate: Number(fps) })
    resetOpenReelRouter({ route: 'editor', params: {} })
    onCreated()
  }
  return (
    <form className="openreel-studio-fallback" onSubmit={submit}>
      <strong>{t('tab.createTitle')}</strong>
      <label className="omnimux-clip-create-field" htmlFor="omnimux-clip-project-name">
        {t('tab.nameLabel')}
        <input id="omnimux-clip-project-name" value={name} placeholder={t('tab.namePlaceholder')} onChange={event => setName(event.target.value)} />
      </label>
      <div className="omnimux-clip-create-fields">
        <div className="omnimux-clip-create-field">
          <span>{t('tab.sizeLabel')}</span>
          <DropdownSelect id="omnimux-clip-preset" aria-label={t('tab.sizeLabel')} value={preset} onChange={setPreset}
            options={PRESETS.map(([value, key]) => ({ value, label: `${t(key)} ${value.replace('x', '×')}` }))} />
        </div>
        <div className="omnimux-clip-create-field">
          <span>{t('tab.fpsLabel')}</span>
          <DropdownSelect id="omnimux-clip-fps" aria-label={t('tab.fpsLabel')} value={fps} options={FRAME_RATES} onChange={setFps} />
        </div>
      </div>
      <div className="omnimux-clip-create-actions">
        <Button type="button" variant="secondary" onClick={onWelcome}>{t('tab.openOfficial')}</Button>
        <Button type="submit" variant="primary">{t('tab.create')}</Button>
      </div>
    </form>
  )
}

export function OpenReelStudioTab({ t, store, tab, sessionId, locale, runtime, visible = true }) {
  useHostLocale(locale)
  const root = useRef(null)
  const [showWelcome, setShowWelcome] = useState(false)
  const clip = tab?.meta?.clip
  const view = useEditorSeat(runtime, {
    mode: 'standalone', root, sessionId, tabInstanceId: tab?.id,
    isVisible: () => visible && root.current?.isConnected && root.current.dataset.visible === 'true',
    studioRequest: clip?.mode === 'standalone' ? { projectId: clip.projectId, key: clip.requestId ?? clip.projectId } : undefined,
  })

  useEffect(() => {
    const api = window.__omnimuxWorkbench
    if (!api?.attachStore || !store) return undefined
    api.attachStore(store)
    return () => api.detachStore?.(store)
  }, [store])

  const editorRootRef = useEditorInert(view.resolving)
  const editing = view.phase === 'editing'
  const welcome = view.phase === 'welcome'
  const active = visible && (editing || welcome && showWelcome)
  return (
    <div className="openreel-studio-root omnimux-clip-studio-entry" aria-hidden={!visible || undefined} ref={root}
      data-visible={visible ? 'true' : 'false'} data-clip-mode="standalone" data-clip-project-id={view.projectId}>
      <div className="openreel-studio-hostbar">
        <div className="openreel-studio-hostbar-title">{editing && view.title || t('tab.title')}</div>
        <div className="openreel-studio-hostbar-status" role="status">{editing && view.status ? t(`tab.${view.status}`) : ''}</div>
        <Button type="button" variant="secondary" className="omnimux-clip-stage-save-btn" disabled={!editing || view.resolving}
          onClick={() => void runtime.session.save()}>{t('tab.save')}</Button>
      </div>
      <div className="openreel-studio-body">
        {visible && (view.phase === 'loading' || view.phase === 'error' || view.phase === 'hidden') && <EditorOpening view={view} t={t} runtime={runtime} />}
        {visible && welcome && !showWelcome && <StudioCreateForm t={t} onCreated={() => setShowWelcome(true)} onWelcome={() => {
          resetOpenReelRouter({ route: 'welcome', params: {} })
          setShowWelcome(true)
        }} />}
        <div ref={editorRootRef} style={{ height: '100%', display: active ? undefined : 'none' }}>
          <OpenReelApp active={active} managed />
        </div>
        <EditorSyncNotice view={view} runtime={runtime} t={t} showStatus={false} />
      </div>
    </div>
  )
}

export default OpenReelStudioTab
