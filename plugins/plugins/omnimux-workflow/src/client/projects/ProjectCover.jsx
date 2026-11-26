import React, { useEffect, useRef, useState } from 'react'
import {
  acquireCoverObjectUrl,
  loadCoverThumbnail,
  peekCoverObjectUrl,
  releaseCoverObjectUrl,
  retainCoverObjectUrl,
} from './coverThumbnail.js'
import { injectFolderStyles } from './folderStyles.js'

const AUDIO_WAVEFORM_PATH = (() => {
  const segments = []
  for (let i = 0; i < 160; i += 1) {
    const envelope = Math.max(0.03, Math.sin(i * 0.067) ** 14, 0.6 * Math.sin(i * 0.14 + 1) ** 20)
    const height = 3 + envelope * (12 + Math.abs(Math.sin(i * 2.17)) * 66)
    segments.push(`M${(10 + i * 2.5).toFixed(1)} ${(112 - height / 2).toFixed(1)}v${height.toFixed(1)}`)
  }
  return segments.join('')
})()

function CoverGlyph({ kind }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {kind === 'empty' ? (
        <path d="M9 49V16a4 4 0 0 1 4-4h12l6 8h18a4 4 0 0 1 4 4v5H23l-9 20h35l7-20" />
      ) : kind === 'video' ? (
        <>
          <rect x="9" y="14" width="46" height="36" rx="6" />
          <path d="m27 23 14 9-14 9Z" />
        </>
      ) : kind === 'image' ? (
        <>
          <rect x="8" y="12" width="48" height="40" rx="5" />
          <circle cx="23" cy="25" r="4" />
          <path d="m10 48 15-14 10 9 9-11 10 16" />
        </>
      ) : (
        <path d="M17 8h22l10 10v38H17Z M39 8v12h10 M24 30h18 M24 38h18 M24 46h12" />
      )}
    </svg>
  )
}

function AudioCover() {
  return (
    <svg className="omnimux-cover-audio" viewBox="0 0 420 240" aria-hidden="true">
      <path d={AUDIO_WAVEFORM_PATH} stroke="currentColor" strokeWidth="1.7" />
    </svg>
  )
}

/** Static cover only: media playback never starts in the project library. */
export function ProjectCover({ cover, renderFrame }) {
  const pendingMeta = cover === undefined
  const kind = cover?.kind || 'empty'
  const source = cover?.sourceRevision || cover?.thumbnailUrl || cover?.mediaUrl
  const mediaKind = kind === 'image' || kind === 'video'
  const [url, setUrl] = useState(() => (cover ? peekCoverObjectUrl(cover) : null))
  const [failedUrl, setFailedUrl] = useState(null)
  const root = useRef(null)

  useEffect(() => {
    injectFolderStyles()
    if (pendingMeta || !mediaKind || !source) {
      setUrl(null)
      setFailedUrl(null)
      return undefined
    }

    let alive = true
    let retained = false
    let retryTimer = null
    let attempts = 0
    let activeController = null

    const cachedUrl = retainCoverObjectUrl(cover)
    if (cachedUrl) {
      retained = true
      setUrl(cachedUrl)
      setFailedUrl(null)
      return () => {
        alive = false
        releaseCoverObjectUrl(cover)
      }
    }

    setUrl(null)
    setFailedUrl(null)

    const load = () => {
      if (!alive) return
      activeController = new AbortController()
      loadCoverThumbnail(cover, { signal: activeController.signal })
        .then((blob) => {
          if (!alive || !blob) return
          const objectUrl = acquireCoverObjectUrl(cover, blob)
          if (objectUrl) {
            retained = true
            setUrl(objectUrl)
            setFailedUrl(null)
          }
        })
        .catch((error) => {
          if (!alive || error?.name === 'AbortError') return
          const fallback = kind === 'image' ? cover?.mediaUrl : cover?.thumbnailUrl
          if (fallback) {
            setUrl(fallback)
          } else {
            setFailedUrl(source)
          }
          if (++attempts < 2) {
            retryTimer = setTimeout(load, 31000)
          }
        })
    }

    let observer = null
    if (typeof IntersectionObserver === 'function' && root.current) {
      observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            observer.disconnect()
            observer = null
            load()
          }
        },
        { rootMargin: '200px' },
      )
      observer.observe(root.current)
    } else {
      load()
    }

    return () => {
      alive = false
      if (retryTimer) clearTimeout(retryTimer)
      if (activeController) activeController.abort()
      if (observer) observer.disconnect()
      if (retained) releaseCoverObjectUrl(cover)
    }
  }, [pendingMeta, source, kind, mediaKind])

  const showImage = Boolean(url && url !== failedUrl && mediaKind)
  const isUnavailable = Boolean(!pendingMeta && (cover?.unavailable || failedUrl))
  const isLoading = Boolean(pendingMeta || (!showImage && !isUnavailable && mediaKind && source))
  const coverState = showImage
    ? 'ready'
    : isLoading
      ? 'loading'
      : isUnavailable
        ? 'unavailable'
        : 'placeholder'

  const content = (
    <div
      ref={root}
      className={`omnimux-cover-content omnimux-cover-content--${kind}${isLoading ? ' omnimux-cover-content--loading' : ''}${showImage ? ' omnimux-cover-content--has-media' : ''}`}
      data-cover-kind={kind}
      data-cover-state={coverState}
      data-cover-unavailable={isUnavailable ? 'true' : 'false'}
      aria-busy={isLoading ? 'true' : undefined}
    >
      {showImage ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailedUrl(url)}
        />
      ) : isLoading ? null : kind === 'audio' ? (
        <AudioCover />
      ) : (
        <CoverGlyph kind={kind} />
      )}
    </div>
  )

  return renderFrame ? renderFrame(content, null) : content
}
