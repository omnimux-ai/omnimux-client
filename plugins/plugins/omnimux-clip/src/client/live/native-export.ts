import { ClipDomainError } from '../../errors.js'
import { createIsolatedExportEngine } from '../openreel/core/export/export-engine'
import { cloneProjectSnapshot } from '../openreel/core/export/project-snapshot'
import type { ExportProgress, VideoExportSettings } from '../openreel/core/export/types'
import type { Project } from '../openreel/core/types/project'
import { startWebCodecsVideoExport, tryLockNativeVideoRender } from '../openreel/web/services/export-runner'
import { isExportQueueRunning } from '../openreel/web/services/export-queue/export-queue-activity'
import { createBrowserOutputSink, readBrowserOutput, type BrowserOutputSink } from '../openreel/web/services/export-queue/export-queue-storage'
import { ensureProjectFonts } from '../openreel/web/services/project-fonts'
import { renderCacheService } from '../openreel/web/services/render-cache-service'
import { useProjectStore } from '../openreel/web/stores/project-store'
import { useTimelineStore } from '../openreel/web/stores/timeline-store'
import { useUIStore } from '../openreel/web/stores/ui-store'
import { assertMotionPlaybackSafe } from './native-motion'

interface NativeExportArgs {
  project: Project
  settings?: Partial<VideoExportSettings>
  onProgress?: (progress: ExportProgress) => void
}

interface NativeExportMetadata {
  durationMs: number
  width: number
  height: number
}

const MP4_MIME = 'video/mp4'
let activeRender: Promise<void> | undefined

/** Wait before loading a different project into OpenReel's shared processing engines. */
export function waitForNativeExportRender(): Promise<void> | undefined {
  return activeRender
}

async function readOutputMetadata(blob: Blob): Promise<NativeExportMetadata> {
  const { BlobSource, Input, MP4 } = await import('mediabunny')
  const input = new Input({ formats: [MP4], source: new BlobSource(blob) })
  try {
    const video = await input.getPrimaryVideoTrack()
    if (!video) throw ClipDomainError.exportEncodeFailed('The MP4 has no video stream.')
    const [width, height, duration] = await Promise.all([
      video.getDisplayWidth(), video.getDisplayHeight(), video.computeDuration(),
    ])
    return { durationMs: Math.round(duration * 1_000), width, height }
  } finally {
    input.dispose()
  }
}

async function renderMp4(
  project: Project,
  settings: Partial<VideoExportSettings>,
  assertRenderSource: () => void,
  onProgress: NativeExportArgs['onProgress'],
  signal?: AbortSignal,
): Promise<{ blob: Blob; discard: () => Promise<void> }> {
  signal?.throwIfAborted()
  assertRenderSource()
  const previous = useUIStore.getState().exportState
  if (previous.isExporting || isExportQueueRunning() || renderCacheService.isRenderingNow()
    || useTimelineStore.getState().playbackLockedReason) {
    throw ClipDomainError.exportEncodeFailed('Wait for the current editor operation to finish before exporting.')
  }
  const release = tryLockNativeVideoRender()
  if (!release) throw ClipDomainError.exportEncodeFailed('Another video export is encoding.')
  const { engine, dispose } = createIsolatedExportEngine()
  const exporting = { isExporting: true, progress: 0, phase: 'Rendering...' }
  let rendered!: () => void
  activeRender = new Promise((resolve) => { rendered = resolve })
  let needsSource = true
  let invalidated: { cause: unknown } | undefined
  const check = () => {
    signal?.throwIfAborted()
    if (invalidated) throw invalidated.cause
    if (needsSource) assertRenderSource()
  }
  const observe = () => {
    if (!needsSource || invalidated) return
    try {
      assertRenderSource()
    } catch (cause) {
      invalidated = { cause }
      engine.cancel()
    }
  }
  const unsubscribe = useProjectStore.subscribe(observe)
  const cancel = () => engine.cancel()
  signal?.addEventListener('abort', cancel, { once: true })
  let generator: ReturnType<typeof engine.exportVideo> | undefined
  const outputKey = `clip-live-${crypto.randomUUID()}`
  let sink: BrowserOutputSink | undefined
  try {
    useTimelineStore.getState().pause()
    useUIStore.getState().setExportState(exporting)
    sink = await createBrowserOutputSink(outputKey, 'mp4', MP4_MIME)
    check()
    await engine.initialize()
    check()
    await ensureProjectFonts(project)
    check()
    generator = engine.exportVideo(project, settings, sink.writable)
    let step = await startWebCodecsVideoExport(generator)
    for (;;) {
      check()
      if (step.done) {
        if (!step.value.success) throw ClipDomainError.exportEncodeFailed(step.value.error?.message)
        break
      }
      // After the last frame and audio sample, muxing only touches this file.
      if (step.value.phase === 'muxing') needsSource = false
      onProgress?.(step.value)
      if (needsSource) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
        check()
      }
      step = await generator.next()
    }
    await sink.finish()
    const output = await readBrowserOutput(outputKey, 'mp4')
    if (!output?.size) throw ClipDomainError.exportEncodeFailed('The encoder produced no MP4 bytes.')
    const blob = output.type === MP4_MIME ? output : output.slice(0, output.size, MP4_MIME)
    return { blob, discard: sink.discard }
  } catch (error) {
    engine.cancel()
    await sink?.writable.abort().catch(() => undefined)
    await sink?.discard()
    throw error
  } finally {
    unsubscribe()
    signal?.removeEventListener('abort', cancel)
    try {
      await generator?.return({ success: false }).catch(() => {
        console.warn('[omnimux-clip] The export generator did not close cleanly.')
      })
      await dispose().catch(() => {
        console.warn('[omnimux-clip] The export engine did not release all of its resources.')
      })
    } finally {
      if (useUIStore.getState().exportState === exporting) useUIStore.getState().setExportState(previous)
      release()
      activeRender = undefined
      rendered()
    }
  }
}

/** Render the authorized native revision, then upload independently of the editor. */
export async function exportNativeProject<T>(
  args: NativeExportArgs,
  { assertCurrent, upload, signal }: {
    assertCurrent: () => void
    upload: (blob: Blob, metadata: NativeExportMetadata) => Promise<T>
    /** An explicit command cancellation. The editor's lease signal may end on a simple Tab switch. */
    signal?: AbortSignal
  },
): Promise<T> {
  signal?.throwIfAborted()
  assertCurrent()
  const editor = useProjectStore.getState()
  if (!editor.hasOpenProject || editor.project.id !== args.project.id) throw ClipDomainError.previewNotReady()
  const project = cloneProjectSnapshot(args.project)
  assertMotionPlaybackSafe(project)
  const modifiedAt = editor.project.modifiedAt
  const assertRenderSource = () => {
    const current = useProjectStore.getState()
    if (!current.hasOpenProject || current.actionExecutor !== editor.actionExecutor || current.project !== editor.project
      || current.project.modifiedAt !== modifiedAt) {
      throw new ClipDomainError('REVISION_CONFLICT', 'The editor project changed while rendering the export.')
    }
  }
  if (args.settings?.format && args.settings.format !== 'mp4') {
    throw ClipDomainError.exportEncodeFailed('Clip export requires MP4 settings.')
  }
  const settings = cloneProjectSnapshot({
    width: project.settings.width,
    height: project.settings.height,
    frameRate: project.settings.frameRate,
    ...args.settings,
    format: 'mp4' as const,
    smartRender: false,
  })
  // The UI lease is needed to freeze the source. From this point, a hidden or
  // unmounted editor can finish if the shared engine still holds this project.
  const { blob, discard } = await renderMp4(project, settings, assertRenderSource, args.onProgress, signal)
  try {
    const metadata = await readOutputMetadata(blob)
    signal?.throwIfAborted()
    return await upload(blob, metadata)
  } finally {
    await discard()
  }
}
