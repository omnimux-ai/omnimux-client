import {
  computeDurationMs,
  createEmptySchema,
  makeClip,
  schemaFromOpenPayload,
  structuredCloneSafe,
  uid,
  ASPECT_PRESETS,
} from './timelineTypes.js'

const HISTORY_LIMIT = 80

function snapshotOf(state) {
  return {
    schema: structuredCloneSafe(state.schema),
    selectedClipId: state.selectedClipId,
    selectedTrackId: state.selectedTrackId,
  }
}

function restoreSnapshot(state, snap) {
  state.schema = structuredCloneSafe(snap.schema)
  state.selectedClipId = snap.selectedClipId
  state.selectedTrackId = snap.selectedTrackId
}

function createStore() {
  let state = {
    schema: createEmptySchema(),
    projectName: '未命名工程',
    nodeId: undefined,
    workspaceId: undefined,
    selectedClipId: null,
    selectedTrackId: null,
    playheadMs: 0,
    isPlaying: false,
    zoomLevel: 1,
    past: [],
    future: [],
  }
  const listeners = new Set()

  function emit() {
    for (const listener of listeners) listener()
  }

  function set(partial) {
    state = { ...state, ...(typeof partial === 'function' ? partial(state) : partial) }
    emit()
  }

  function mutate(recipe, { record = true } = {}) {
    if (record) {
      const snap = snapshotOf(state)
      state = {
        ...state,
        past: [...state.past, snap].slice(-HISTORY_LIMIT),
        future: [],
      }
    }
    recipe(state)
    state.schema.canvasConfig.durationMs = computeDurationMs(
      state.schema.tracks,
      state.schema.canvasConfig.durationMs,
    )
    emit()
  }

  const api = {
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getState() {
      return state
    },
    hydrateFromPayload(payload) {
      const schema = schemaFromOpenPayload(payload || {})
      state = {
        ...state,
        schema,
        projectName: payload?.nodeTitle || schema.projectId || '未命名工程',
        nodeId: payload?.nodeId,
        workspaceId: payload?.workspaceId,
        selectedClipId: null,
        selectedTrackId: schema.tracks[0]?.id || null,
        playheadMs: 0,
        isPlaying: false,
        zoomLevel: 1,
        past: [],
        future: [],
      }
      emit()
    },
    reset() {
      state = {
        schema: createEmptySchema(),
        projectName: '未命名工程',
        nodeId: undefined,
        workspaceId: undefined,
        selectedClipId: null,
        selectedTrackId: null,
        playheadMs: 0,
        isPlaying: false,
        zoomLevel: 1,
        past: [],
        future: [],
      }
      emit()
    },
    setProjectName(name) {
      set({ projectName: String(name || '').slice(0, 80) || '未命名工程' })
    },
    setAspectRatio(aspectRatio) {
      mutate((draft) => {
        const size = ASPECT_PRESETS[aspectRatio] || ASPECT_PRESETS['16:9']
        draft.schema.canvasConfig.aspectRatio = aspectRatio
        draft.schema.canvasConfig.width = size.width
        draft.schema.canvasConfig.height = size.height
      })
    },
    setFps(fps) {
      mutate((draft) => {
        draft.schema.canvasConfig.fps = fps
      })
    },
    selectClip(clipId, trackId) {
      set({ selectedClipId: clipId || null, selectedTrackId: trackId || state.selectedTrackId })
    },
    setPlayhead(ms) {
      const duration = state.schema.canvasConfig.durationMs || 0
      set({ playheadMs: Math.max(0, Math.min(duration, Math.round(ms))) })
    },
    setPlaying(isPlaying) {
      set({ isPlaying: Boolean(isPlaying) })
    },
    togglePlaying() {
      set({ isPlaying: !state.isPlaying })
    },
    setZoom(level) {
      set({ zoomLevel: Math.max(0.25, Math.min(8, Number(level) || 1)) })
    },
    addMediaItem(item) {
      mutate((draft) => {
        draft.schema.media.push({
          id: item.id || uid('media'),
          name: item.name || '素材',
          type: item.type || 'video',
          durationMs: item.durationMs,
          path: item.path || item.url || '',
          url: item.url,
        })
      })
    },
    addClip(trackId, partial) {
      mutate((draft) => {
        const track = draft.schema.tracks.find((item) => item.id === trackId)
        if (!track || track.isLocked) return
        const clip = makeClip({
          ...partial,
          trackId,
          startTimeMs: partial?.startTimeMs ?? draft.playheadMs,
        })
        if (track.type === 'text' && !clip.textStyle) {
          clip.mediaType = 'text'
        }
        if (track.type === 'audio') clip.mediaType = 'audio'
        track.clips.push(clip)
        draft.selectedClipId = clip.id
        draft.selectedTrackId = track.id
      })
    },
    addClipFromMedia(media, trackHint) {
      const type = media.type === 'audio' ? 'audio' : media.type === 'text' ? 'text' : 'video'
      const track = state.schema.tracks.find((item) => item.id === trackHint)
        || state.schema.tracks.find((item) => item.type === type)
        || state.schema.tracks[0]
      if (!track) return
      api.addClip(track.id, {
        name: media.name,
        mediaType: media.type || type,
        sourceUrl: media.path || media.url || '',
        durationMs: media.durationMs || media.displayDurationMs || (type === 'image' ? 3000 : 4000),
        sourceOutMs: media.durationMs || 4000,
      })
    },
    splitClip(clipId, atMs) {
      mutate((draft) => {
        const found = findIn(draft, clipId)
        if (!found || found.track.isLocked) return
        const { track, clip, index } = found
        const cut = Math.round(atMs)
        if (cut <= clip.startTimeMs + 80 || cut >= clip.startTimeMs + clip.durationMs - 80) return
        const offset = cut - clip.startTimeMs
        const sourceOffset = Math.round(offset * (clip.speed || 1))
        const right = makeClip({
          ...clip,
          id: uid('clip'),
          startTimeMs: cut,
          durationMs: clip.durationMs - offset,
          sourceInMs: (clip.sourceInMs || 0) + sourceOffset,
        })
        clip.durationMs = offset
        clip.sourceOutMs = (clip.sourceInMs || 0) + sourceOffset
        track.clips.splice(index + 1, 0, right)
        draft.selectedClipId = right.id
      })
    },
    captureHistory() {
      state = {
        ...state,
        past: [...state.past, snapshotOf(state)].slice(-HISTORY_LIMIT),
        future: [],
      }
    },
    trimClip(clipId, { startTimeMs, durationMs, sourceInMs, sourceOutMs }, opts = {}) {
      mutate((draft) => {
        const found = findIn(draft, clipId)
        if (!found || found.track.isLocked) return
        if (startTimeMs != null) found.clip.startTimeMs = Math.max(0, Math.round(startTimeMs))
        if (durationMs != null) found.clip.durationMs = Math.max(120, Math.round(durationMs))
        if (sourceInMs != null) found.clip.sourceInMs = Math.max(0, Math.round(sourceInMs))
        if (sourceOutMs != null) found.clip.sourceOutMs = Math.max(found.clip.sourceInMs + 120, Math.round(sourceOutMs))
      }, { record: opts.record !== false })
    },
    moveClip(clipId, { startTimeMs, trackId }, opts = {}) {
      mutate((draft) => {
        const found = findIn(draft, clipId)
        if (!found || found.track.isLocked) return
        const nextStart = Math.max(0, Math.round(startTimeMs ?? found.clip.startTimeMs))
        if (trackId && trackId !== found.track.id) {
          const dest = draft.schema.tracks.find((item) => item.id === trackId)
          if (!dest || dest.isLocked) return
          if (dest.type !== found.track.type && !(dest.type === 'video' && (found.clip.mediaType === 'video' || found.clip.mediaType === 'image'))) {
            return
          }
          found.track.clips = found.track.clips.filter((item) => item.id !== clipId)
          found.clip.trackId = dest.id
          found.clip.startTimeMs = nextStart
          dest.clips.push(found.clip)
          draft.selectedTrackId = dest.id
        } else {
          found.clip.startTimeMs = nextStart
        }
      }, { record: opts.record !== false })
    },
    removeClip(clipId) {
      mutate((draft) => {
        for (const track of draft.schema.tracks) {
          if (track.isLocked) continue
          const next = track.clips.filter((item) => item.id !== clipId)
          if (next.length !== track.clips.length) {
            track.clips = next
            if (draft.selectedClipId === clipId) draft.selectedClipId = null
            return
          }
        }
      })
    },
    setSpeed(clipId, speed) {
      mutate((draft) => {
        const found = findIn(draft, clipId)
        if (!found) return
        found.clip.speed = Math.max(0.2, Math.min(10, Number(speed) || 1))
      })
    },
    setVolume(clipId, volume) {
      mutate((draft) => {
        const found = findIn(draft, clipId)
        if (!found) return
        found.clip.volume = Math.max(0, Math.min(1, Number(volume) || 0))
      })
    },
    setTextStyle(clipId, patch) {
      mutate((draft) => {
        const found = findIn(draft, clipId)
        if (!found) return
        found.clip.textStyle = { ...(found.clip.textStyle || {}), ...patch }
        if (patch.content) found.clip.name = String(patch.content).slice(0, 24)
      })
    },
    setTransition(clipId, transition) {
      mutate((draft) => {
        const found = findIn(draft, clipId)
        if (!found) return
        found.clip.transition = transition
      })
    },
    toggleTrackFlag(trackId, flag) {
      mutate((draft) => {
        const track = draft.schema.tracks.find((item) => item.id === trackId)
        if (!track) return
        track[flag] = !track[flag]
      })
    },
    undo() {
      if (state.past.length === 0) return
      const current = snapshotOf(state)
      const previous = state.past[state.past.length - 1]
      restoreSnapshot(state, previous)
      state.past = state.past.slice(0, -1)
      state.future = [...state.future, current]
      emit()
    },
    redo() {
      if (state.future.length === 0) return
      const current = snapshotOf(state)
      const next = state.future[state.future.length - 1]
      restoreSnapshot(state, next)
      state.future = state.future.slice(0, -1)
      state.past = [...state.past, current]
      emit()
    },
  }

  function findIn(draft, clipId) {
    for (const track of draft.schema.tracks) {
      const index = track.clips.findIndex((item) => item.id === clipId)
      if (index >= 0) return { track, clip: track.clips[index], index }
    }
    return null
  }

  return api
}

export const timelineStore = createStore()

export function selectedClipOf(state) {
  if (!state.selectedClipId) return null
  for (const track of state.schema.tracks) {
    const clip = track.clips.find((item) => item.id === state.selectedClipId)
    if (clip) return { track, clip }
  }
  return null
}
