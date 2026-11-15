import { useEffect, useRef, useState } from 'react'
import { Button, IconButton } from 'dsh-ui-kit'
import { Check, ChevronLeft, ChevronRight, Plus, Sparkles, ZoomIn } from 'lucide-react'

/**
 * Horizontal gallery for a post whose assets are all images.
 *
 * The detail view used to stack every image vertically; a carousel post then
 * read as one long column and the only way to compare slides was scrolling.
 * This component keeps one slide in view and exposes every way to change it:
 * drag, arrow buttons, dots and the left/right keys. It is presentation-only —
 * the parent owns which asset is open in the lightbox and how references and
 * analysis are recorded, so a slide is just another `media` asset there.
 *
 * @param {{
 *   assets: Array<{ id: string, index: number, label: string, title?: string, url: string }>,
 *   dimensions?: Record<number, { width?: number, height?: number }>,
 *   failedImages?: Record<string, boolean>,
 *   onOpen: (asset: any) => void,
 *   onDimension?: (asset: any, size: { width: number, height: number }) => void,
 *   onImageError?: (asset: any) => void,
 *   onAnalyze?: (asset: any) => void,
 *   onToggleReference?: (asset: any) => void,
 *   hasReference?: (asset: any) => boolean,
 *   saving?: boolean,
 *   t: (key: string) => string,
 * }} props
 */
export function PostMediaCarousel({
  assets,
  dimensions = {},
  failedImages = {},
  onOpen,
  onDimension,
  onImageError,
  onAnalyze,
  onToggleReference,
  hasReference,
  saving = false,
  t,
}) {
  const [index, setIndex] = useState(0)
  const drag = useRef({ active: false, startX: 0, startY: 0, dx: 0 })
  const suppressClickUntil = useRef(0)
  const track = useRef(null)

  useEffect(() => {
    setIndex(current => Math.min(current, Math.max(0, assets.length - 1)))
  }, [assets.length])

  const copy = (name) => t(`post.${name}`)
  const go = (next) => setIndex(Math.max(0, Math.min(assets.length - 1, next)))
  const current = assets[index]

  const startDrag = (event) => {
    if (event.button !== 0 || assets.length < 2) return
    // Arrow buttons and dots are click targets inside the viewport; capturing
    // the pointer here would retarget their click event to the viewport.
    if (event.target?.closest?.('.omnimux-post-carousel-nav, .omnimux-post-carousel-dot')) return
    drag.current = { active: true, startX: event.clientX, startY: event.clientY, dx: 0, pointerId: event.pointerId }
    track.current?.classList.add('is-dragging')
  }
  const moveDrag = (event) => {
    if (!drag.current.active) return
    const dx = event.clientX - drag.current.startX
    const dy = event.clientY - drag.current.startY
    if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 14 && Math.abs(dx) < 14) return
    drag.current.dx = dx
    if (Math.abs(dx) > 6 && !drag.current.captured) {
      event.currentTarget.setPointerCapture?.(event.pointerId)
      drag.current.captured = true
    }
    if (track.current) track.current.style.transform = `translateX(calc(${-index * 100}% + ${dx}px))`
  }
  const endDrag = () => {
    if (!drag.current.active) return
    const dx = drag.current.dx
    drag.current.active = false
    track.current?.classList.remove('is-dragging')
    if (Math.abs(dx) > 6) suppressClickUntil.current = Date.now() + 250
    const threshold = Math.min(120, (track.current?.clientWidth || 600) * 0.18)
    const target = Math.max(0, Math.min(assets.length - 1, index + (dx < -threshold ? 1 : dx > threshold ? -1 : 0)))
    if (track.current) track.current.style.transform = `translateX(${-target * 100}%)`
    go(target)
    drag.current.dx = 0
  }
  const handleKeyDown = (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    event.stopPropagation()
    go(index + (event.key === 'ArrowRight' ? 1 : -1))
  }

  return <article className="omnimux-post-media omnimux-post-carousel" data-media-count={assets.length}>
    <div className="omnimux-post-carousel-head">
      <span className="omnimux-post-carousel-chip">{copy('carousel')} · {assets.length}</span>
      <span className="omnimux-post-carousel-hint">{copy('carouselHint')}</span>
    </div>
    <div
      className="omnimux-post-carousel-viewport"
      role="group"
      aria-roledescription="carousel"
      aria-label={`${copy('carousel')} ${index + 1} / ${assets.length}`}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onPointerDown={startDrag}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <div className="omnimux-post-carousel-track" ref={track} style={{ transform: `translateX(-${index * 100}%)` }}>
        {assets.map((asset, slide) => <div className="omnimux-post-carousel-slide" key={asset.id} aria-hidden={slide !== index}>
          {failedImages[asset.id] ? <p role="alert" className="omnimux-inspiration-error-text">{copy('imageUnavailable')}</p> : <button
            type="button"
            className="omnimux-post-image-open"
            tabIndex={slide === index ? 0 : -1}
            aria-label={`${copy('openImage')} ${asset.label}`}
            onClick={() => {
              if (Date.now() < suppressClickUntil.current) return
              onOpen?.(asset)
            }}
          >
            <img
              src={asset.url}
              alt={asset.title || asset.label}
              draggable="false"
              onLoad={event => {
                const node = event.currentTarget
                onDimension?.(asset, { width: node.naturalWidth, height: node.naturalHeight })
              }}
              onError={() => onImageError?.(asset)}
            />
            <span className="omnimux-post-image-caption"><ZoomIn size={14} />{copy('openImage')}</span>
          </button>}
        </div>)}
      </div>
      <IconButton
        className="omnimux-post-carousel-nav is-prev"
        variant="ghost"
        aria-label={copy('previousImage')}
        disabled={index === 0}
        onClick={() => go(index - 1)}
      ><ChevronLeft size={18} /></IconButton>
      <IconButton
        className="omnimux-post-carousel-nav is-next"
        variant="ghost"
        aria-label={copy('nextImage')}
        disabled={index === assets.length - 1}
        onClick={() => go(index + 1)}
      ><ChevronRight size={18} /></IconButton>
      <span className="omnimux-post-carousel-counter" aria-live="polite">{index + 1} / {assets.length}</span>
      <div className="omnimux-post-carousel-dots" role="tablist" aria-label={copy('carousel')}>
        {assets.map((asset, dot) => <button
          key={asset.id}
          type="button"
          role="tab"
          aria-label={asset.label}
          aria-selected={dot === index}
          className={`omnimux-post-carousel-dot${dot === index ? ' is-active' : ''}`}
          onClick={() => go(dot)}
        />)}
      </div>
    </div>
    <div className="omnimux-post-asset-footer">
      <div>
        <strong>{current?.label}</strong>
        <p>{dimensions[current?.index]?.width > 0 && `${dimensions[current.index].width} × ${dimensions[current.index].height}`}</p>
      </div>
      <div className="omnimux-post-actions">
        <Button variant="ghost" size="sm" leadingIcon={<Sparkles size={14} />} onClick={() => onAnalyze?.(current)}>{copy('analyzeImage')}</Button>
        <Button
          size="sm"
          variant={hasReference?.(current) ? 'secondary' : 'ghost'}
          aria-pressed={Boolean(hasReference?.(current))}
          disabled={saving}
          leadingIcon={hasReference?.(current) ? <Check size={14} /> : <Plus size={14} />}
          onClick={() => onToggleReference?.(current)}
        >{t(hasReference?.(current) ? 'post.selected' : 'post.selectReference')}</Button>
      </div>
    </div>
  </article>
}
