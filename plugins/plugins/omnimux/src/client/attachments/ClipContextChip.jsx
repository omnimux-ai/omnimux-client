import { useLayoutEffect, useState, useSyncExternalStore } from 'react'
import { IconSparkleMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import { IconButton, IconCloseOutline16 } from 'dsh-ui-kit'

function timecode(seconds) {
  const rounded = Math.round(seconds * 10) / 10
  return `${String(Math.floor(rounded / 60)).padStart(2, '0')}:${(rounded % 60).toFixed(1).padStart(4, '0')}`
}

export function ClipContextChip({ bridge, sessionId, t }) {
  const [anchor, setAnchor] = useState(null)
  useLayoutEffect(() => anchor ? bridge.register(anchor, sessionId) : undefined, [anchor, bridge, sessionId])
  const snapshot = useSyncExternalStore(bridge.subscribe, bridge.getSnapshot, bridge.getSnapshot)
  const clip = snapshot?.anchor === anchor ? snapshot.clip : null
  const closeLabel = t('clipComposer.remove')
  return <>
    <span ref={setAnchor} hidden />
    {clip && <div className="omx-clip-context-chip" role="group" aria-label={t('clipComposer.context')}>
      <span className="omx-clip-context-icon"><IconSparkleMedium size={16} aria-hidden="true" /></span>
      <div className="omx-clip-context-copy">
        <div className="omx-clip-context-heading">
          <strong>{t(clip.mode === 'canvas' ? 'clipComposer.canvas' : 'clipComposer.studio')} · {clip.title || clip.projectId}</strong>
          <span title={t('clipComposer.epoch', { epoch: clip.revisionEpoch })}>r{clip.revision}{clip.revisionEpoch > 0 && ` · ${t('clipComposer.epoch', { epoch: clip.revisionEpoch })}`}</span>
        </div>
        <div className="omx-clip-context-meta">
          <span>{clip.projectId}</span>
          {clip.mode === 'canvas' && <span>{clip.workspaceId}/{clip.nodeId}</span>}
          <span>{t('clipComposer.playhead')} {timecode(clip.playheadSec)} / {timecode(clip.durationSec)}</span>
        </div>
        <div className="omx-clip-context-meta">
          {clip.selectedClips.length ? clip.selectedClips.map(row => (
            <span key={row.id}>{row.name || row.id} [{timecode(row.startSec)}–{timecode(row.endSec)}]</span>
          )) : <span>{t('clipComposer.noSelection')}</span>}
        </div>
      </div>
      <IconButton size="xs" aria-label={closeLabel} onClick={() => bridge.dismiss(anchor)}>
        <IconCloseOutline16 size={14} />
      </IconButton>
    </div>}
  </>
}
