/**
 * Trusted-window Chromium downloads and clipboard fallback reads, ported from upstream Desktop's `file-actions.ts`.
 * The Host bundle imports src/upstream-family.ts, which re-exports this module, so Electron arrives as an argument.
 */
import { randomUUID } from 'node:crypto'
import { lookup as dnsLookup } from 'node:dns/promises'
import { closeSync, mkdirSync, openSync, realpathSync, rmSync } from 'node:fs'
import { isIP } from 'node:net'
import { dirname, extname, join } from 'node:path'
import { Readable } from 'node:stream'
import type { FileSaveResult } from '@deepseek-ai/dsh-client-ui-file-actions/types'
import { resolveDragFileName } from '@deepseek-ai/dsh-util-file-drag'
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import { FILE_ACTIONS_IPC } from './file-actions-ipc.ts'

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'instance-data',
  'metadata',
  'metadata.google.internal',
  'metadata.goog',
])
const BLOCKED_HOST_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa'] as const

function isPrivateIpv4(address: string): boolean {
  const parts = address.split('.')
  if (parts.length !== 4 || !parts.every(part => /^\d{1,3}$/u.test(part))) return false
  const octets = parts.map(Number)
  if (octets.some(value => value > 255)) return false
  const [a, b] = octets as [number, number, number, number]
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  return a >= 224
}

const ALLOWED_IMAGE_MEDIA_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
  'image/x-icon',
  'image/vnd.microsoft.icon',
  'image/tiff',
  'image/heic',
  'image/heif',
  'image/apng',
])

function expandIpv6Words(bare: string): number[] | null {
  const halves = bare.split('::')
  if (halves.length > 2) return null
  const parsePart = (part: string): number[] | null => {
    if (part === '') return []
    const tokens = part.split(':')
    const words: number[] = []
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]!
      if (token.includes('.')) {
        if (i !== tokens.length - 1) return null
        const octets = token.split('.')
        if (octets.length !== 4 || !octets.every(o => /^\d{1,3}$/u.test(o))) return null
        const nums = octets.map(Number)
        if (nums.some(n => n > 255)) return null
        words.push((nums[0]! << 8) | nums[1]!, (nums[2]! << 8) | nums[3]!)
      } else {
        if (!/^[0-9a-f]{1,4}$/u.test(token)) return null
        words.push(Number.parseInt(token, 16))
      }
    }
    return words
  }
  const left = parsePart(halves[0] ?? '')
  const right = halves.length === 2 ? parsePart(halves[1] ?? '') : []
  if (left === null || right === null) return null
  if (halves.length === 1) return left.length === 8 ? left : null
  const fill = 8 - left.length - right.length
  if (fill < 1) return null
  return [...left, ...new Array<number>(fill).fill(0), ...right]
}

function isPrivateIpv6(address: string): boolean {
  const bare = address.includes('%') ? address.slice(0, address.indexOf('%')) : address
  const words = expandIpv6Words(bare)
  if (words === null) return true
  const [w0, w1, w2, w3, w4, w5, w6, w7] = words as [number, number, number, number, number, number, number, number]
  // Unspecified (::) and loopback (::1)
  if (w0 === 0 && w1 === 0 && w2 === 0 && w3 === 0 && w4 === 0 && w5 === 0 && w6 === 0 && (w7 === 0 || w7 === 1)) return true
  // IPv4-mapped (::ffff:0:0/96) and IPv4-compatible (::/96)
  if (w0 === 0 && w1 === 0 && w2 === 0 && w3 === 0 && w4 === 0 && (w5 === 0xffff || w5 === 0)) {
    return isPrivateIpv4(`${w6 >> 8}.${w6 & 0xff}.${w7 >> 8}.${w7 & 0xff}`)
  }
  // 6to4 (2002::/16) embedding private IPv4
  if (w0 === 0x2002) {
    return isPrivateIpv4(`${w1 >> 8}.${w1 & 0xff}.${w2 >> 8}.${w2 & 0xff}`)
  }
  // NAT64 well-known prefix (64:ff9b::/96) and discard-only (100::/64)
  if (w0 === 0x0064 || w0 === 0x0100) return true
  // Unique local (fc00::/7)
  if ((w0 & 0xfe00) === 0xfc00) return true
  // Link-local (fe80::/10) and deprecated site-local (fec0::/10)
  if ((w0 & 0xff80) === 0xfe80) return true
  // Multicast (ff00::/8)
  if ((w0 & 0xff00) === 0xff00) return true
  return false
}

export function isPrivateIpAddress(address: string): boolean {
  const normalized = address.trim().toLowerCase().replace(/^\[|\]$/gu, '')
  const version = isIP(normalized)
  if (version === 4) return isPrivateIpv4(normalized)
  if (version === 6) return isPrivateIpv6(normalized)
  return false
}

export function isBlockedImageHost(hostname: string): boolean {
  const bare = hostname.trim().toLowerCase().replace(/\.$/u, '').replace(/^\[|\]$/gu, '')
  if (!bare) return true
  if (BLOCKED_HOSTNAMES.has(bare)) return true
  if (BLOCKED_HOST_SUFFIXES.some(suffix => bare.endsWith(suffix))) return true
  if (isIP(bare) !== 0) return isPrivateIpAddress(bare)
  return false
}

export function isAllowedImageMediaType(contentType: string): boolean {
  const trimmed = contentType.trim()
  if (trimmed === '') return true
  const mime = trimmed.split(';')[0]?.trim().toLowerCase() ?? ''
  return ALLOWED_IMAGE_MEDIA_TYPES.has(mime)
}

/** The Electron main-process modules the file actions use. */
export type FileActionsElectron = Pick<typeof import('electron'), 'app' | 'ipcMain' | 'net' | 'session'>

/** In-memory partition for image reads: an empty cookie jar and none of the application window's request handlers. */
const IMAGE_READ_PARTITION = 'dsh-desktop-image-read'
/** HTTP statuses whose Response must be constructed without a body stream. */
const NULL_BODY_STATUSES = new Set([204, 205, 304])

/**
 * Read a duration that `setTimeout` accepts without clamping.
 * @param name - variable to read; the validation error names it.
 * @param fallback - value used when the variable is unset.
 * @returns integer milliseconds from 1000 through 2147483647.
 */
function resolveDurationMs(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback)
  if (!Number.isSafeInteger(value) || value < 1_000 || value > 2_147_483_647) {
    throw new Error(`${name} must be an integer from 1000 through 2147483647`)
  }
  return value
}

/**
 * The saved file as the client should name it: the Host reveals only a path it verifies as canonical, which one below
 * a linked Downloads directory is not.
 * @param path - completed destination.
 * @returns its real path, or the path itself if the file has gone already.
 */
function completedPath(path: string): string {
  try { return realpathSync.native(path) } catch { return path }
}

/** @param value - untrusted IPC input. @returns captured URL and destination policy. */
function saveRequest(value: unknown): { url: URL; name?: string; mediaType?: string; mode: 'download' | 'saveAs' } {
  if (typeof value !== 'object' || value === null
    || !('url' in value) || typeof value.url !== 'string'
    || ('name' in value && typeof value.name !== 'string')
    || ('mediaType' in value && typeof value.mediaType !== 'string')
    || !('mode' in value) || (value.mode !== 'download' && value.mode !== 'saveAs')) throw new Error('Invalid file save request')
  const url = new URL(value.url)
  if (!['https:', 'http:', 'blob:', 'data:'].includes(url.protocol) || url.username || url.password) throw new Error('Unsupported file source')
  return { url, mode: value.mode,
    ...'name' in value ? { name: value.name as string } : {},
    ...'mediaType' in value ? { mediaType: value.mediaType as string } : {},
  }
}

/**
 * Request one hop of an original image through Chromium, which reaches it the way the window showing it does: Node's
 * `fetch` in this process follows neither the system proxy (see src/system-proxy.ts) nor the system certificates.
 * `net.fetch` rejects a manual redirect, so a redirect answers here as a body-less response the caller validates.
 * @param electron - Electron main-process modules.
 * @param url - validated hop.
 * @param signal - stops the request and its body.
 * @returns the hop's response.
 */
function requestImageHop({ net, session }: FileActionsElectron, url: URL, signal: AbortSignal): Promise<Response> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted()
    const request = net.request({ url: url.href, session: session.fromPartition(IMAGE_READ_PARTITION),
      redirect: 'manual', credentials: 'omit', referrerPolicy: 'no-referrer' })
    let body: Readable | undefined
    const abort = (): void => {
      reject(signal.reason as Error)
      body?.destroy(signal.reason as Error)
      request.abort()
    }
    signal.addEventListener('abort', abort, { once: true })
    request.on('redirect', (status, _method, location) => {
      signal.removeEventListener('abort', abort)
      resolve(new Response(null, { status, headers: { location } }))
      // A redirect left unfollowed without an abort reports itself as a failure.
      request.abort()
    })
    request.on('response', (incoming) => {
      // Electron's IncomingMessage is a Node Readable at runtime; its declared type only guarantees NodeJS.ReadableStream.
      body = incoming as unknown as Readable
      body.once('close', () => {
        signal.removeEventListener('abort', abort)
        request.abort()
      })
      try {
        const headers = new Headers()
        for (const [name, value] of Object.entries(incoming.headers)) {
          for (const item of Array.isArray(value) ? value : [value]) headers.append(name, item)
        }
        resolve(new Response(
          NULL_BODY_STATUSES.has(incoming.statusCode) ? null : Readable.toWeb(body) as unknown as ReadableStream<Uint8Array>,
          { status: incoming.statusCode, headers },
        ))
      } catch (error) {
        reject(error as Error)
        body.destroy()
      }
    })
    request.on('error', (error) => {
      signal.removeEventListener('abort', abort)
      reject(error)
    })
    // ClientRequest is a Writable: without end() the request is never sent.
    request.end()
  })
}

/**
 * Install trusted-window original-file operations.
 * @param electron - Electron main-process modules.
 * @param assertOwner - rejects shell pages, subframes, and unowned windows.
 * @param hostUrl - current application Host excluded from image reads.
 */
export type ImageHostResolver = (hostname: string) => Promise<readonly { address: string }[]>

const defaultImageHostResolver: ImageHostResolver = (hostname) => dnsLookup(hostname, { all: true, verbatim: true })

export function installFileActions(
  electron: FileActionsElectron,
  assertOwner: (event: IpcMainInvokeEvent) => BrowserWindow,
  hostUrl: () => string | undefined = () => undefined,
  resolveHost: ImageHostResolver = defaultImageHostResolver,
): void {
  const { app, ipcMain, session } = electron
  const timeoutMs = resolveDurationMs('DSH_DESKTOP_IMAGE_READ_TIMEOUT_MS', 30_000)
  const maxBytes = Number(process.env.DSH_DESKTOP_IMAGE_READ_MAX_BYTES ?? 64 * 1024 * 1024)
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('DSH_DESKTOP_IMAGE_READ_MAX_BYTES must be a positive integer')
  // Keyed by the URL fragment: Chromium reports a URL in its own canonical form (`|` in a path becomes `%7C`), but keeps the fragment.
  const pending = new Map<string, {
    event: IpcMainInvokeEvent
    owner: BrowserWindow
    request: ReturnType<typeof saveRequest>
    finish: (result: FileSaveResult | Error) => void
    started: () => void
    item?: Electron.DownloadItem
  }>()
  session.defaultSession.on('will-download', (_event, item, contents) => {
    const url = item.getURLChain()[0]
    const hash = url === undefined ? '' : new URL(url).hash
    if (!hash.startsWith('#dsh-download=')) return
    const entry = pending.get(hash)
    if (entry === undefined || entry.owner.webContents !== contents) { item.cancel(); return }
    entry.started()
    entry.item = item
    let reserved: string | undefined
    try {
      assertOwner(entry.event)
      const name = resolveDragFileName({
        name: entry.request.name ?? item.getFilename(),
        mediaType: item.getMimeType() || entry.request.mediaType || '',
      })
      let destination = join(app.getPath('downloads'), name)
      // A Linux home need not have a Downloads directory yet.
      mkdirSync(dirname(destination), { recursive: true })
      if (entry.request.mode === 'saveAs') {
        // Without a title, Windows and Linux dialogs show the whole URL, with its fragment or `data:` payload.
        item.setSaveDialogOptions({ title: name, defaultPath: destination, properties: ['showOverwriteConfirmation', 'createDirectory'] })
      } else {
        const extension = extname(destination)
        const stem = destination.slice(0, destination.length - extension.length)
        for (let index = 0; ; index++) {
          destination = index === 0 ? `${stem}${extension}` : `${stem} (${index})${extension}`
          try { closeSync(openSync(destination, 'wx')); break }
          catch (error) {
            if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST') continue
            throw error
          }
        }
        reserved = destination
        item.setSavePath(destination)
      }
      // A network failure only pauses the item for a resume that nothing here offers; it would never finish on its own.
      let interrupted = false
      item.on('updated', (_event, state) => {
        if (state !== 'interrupted' || interrupted) return
        interrupted = true
        setImmediate(() => { item.cancel() })
      })
      item.once('done', (_event, state) => {
        try {
          if (state !== 'completed') {
            if (reserved !== undefined) rmSync(reserved, { force: true })
            entry.finish(state === 'cancelled' && !interrupted ? { status: 'cancelled' } : new Error('File download interrupted'))
            return
          }
          if (!pending.has(hash)) return
          assertOwner(entry.event)
          entry.finish({ status: 'saved', path: completedPath(item.getSavePath()) })
        } catch (error) { entry.finish(error instanceof Error ? error : new Error('File download unavailable')) }
      })
    } catch (error) {
      item.cancel()
      try { if (reserved !== undefined) rmSync(reserved, { force: true }) }
      catch (cleanupError) {
        entry.finish(new AggregateError([error, cleanupError], 'File download failed and its partial file could not be removed'))
        return
      }
      entry.finish(error instanceof Error ? error : new Error('File download unavailable'))
    }
  })
  const downloadTimeoutMs = resolveDurationMs('DSH_DESKTOP_FILE_DOWNLOAD_TIMEOUT_MS', 300_000)
  ipcMain.handle(FILE_ACTIONS_IPC.save, (event, value: unknown): Promise<FileSaveResult> => {
    const owner = assertOwner(event)
    const request = saveRequest(value)
    // Fragments do not change the fetched resource; each native request has its own completion identity.
    request.url.hash = `dsh-download=${randomUUID()}`
    const { hash } = request.url
    return new Promise((resolve, reject) => {
      const contents = owner.webContents
      const finish = (result: FileSaveResult | Error): void => {
        if (!pending.delete(hash)) return
        clearTimeout(timer)
        owner.removeListener('closed', cancel)
        contents.removeListener('did-start-navigation', navigate)
        if (result instanceof Error) reject(result)
        else resolve(result)
      }
      const cancel = (): void => {
        const item = pending.get(hash)?.item
        finish({ status: 'cancelled' })
        item?.cancel()
      }
      const navigate = (_event: Electron.Event, _url: string, inPlace: boolean, mainFrame: boolean): void => {
        if (mainFrame && !inPlace) cancel()
      }
      const timer = setTimeout(() => {
        const item = pending.get(hash)?.item
        finish(new Error('File download timed out'))
        item?.cancel()
      }, downloadTimeoutMs)
      pending.set(hash, { event, owner, request, finish, started: () => { clearTimeout(timer) } })
      owner.once('closed', cancel)
      contents.on('did-start-navigation', navigate)
      try { contents.downloadURL(request.url.href) }
      catch (error) { finish(error instanceof Error ? error : new Error('File download unavailable')) }
    })
  })
  ipcMain.handle(FILE_ACTIONS_IPC.clipboardImageRead, async (event, value: unknown) => {
    const owner = assertOwner(event)
    if (typeof value !== 'string') throw new Error('Invalid image URL')
    const parseAndCheckLiteralUrl = (rawValue: string): URL => {
      const url = new URL(rawValue)
      const host = hostUrl()
      const application = host === undefined ? undefined : new URL(host)
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password
        || isBlockedImageHost(url.hostname)
        || application !== undefined && url.port === application.port
        && (url.hostname === application.hostname || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
        throw new Error('Invalid image URL')
      }
      return url
    }
    const verifyResolvedAddress = async (url: URL, signal: AbortSignal): Promise<void> => {
      const bareHost = url.hostname.trim().toLowerCase().replace(/\.$/u, '').replace(/^\[|\]$/gu, '')
      if (isIP(bareHost) !== 0) return
      const resolved = await new Promise<readonly { address: string }[]>((resolve, reject) => {
        if (signal.aborted) { reject(signal.reason); return }
        const onAbort = (): void => { reject(signal.reason) }
        signal.addEventListener('abort', onAbort, { once: true })
        resolveHost(bareHost).then(
          value => { signal.removeEventListener('abort', onAbort); resolve(value) },
          error => { signal.removeEventListener('abort', onAbort); reject(error) },
        )
      }).catch((error: unknown) => {
        if (signal.aborted) throw signal.reason
        throw new Error('Original image unavailable', { cause: error })
      })
      signal.throwIfAborted()
      if (resolved.length === 0 || resolved.some(entry => isPrivateIpAddress(entry.address))) {
        throw new Error('Invalid image URL')
      }
    }
    let url = parseAndCheckLiteralUrl(value)
    const contents = owner.webContents
    const lifetime = new AbortController()
    const abort = (): void => { lifetime.abort() }
    owner.once('closed', abort)
    const navigate = (_event: Electron.Event, _url: string, inPlace: boolean, mainFrame: boolean): void => {
      if (mainFrame && !inPlace) abort()
    }
    contents.on('did-start-navigation', navigate)
    try {
      const signal = AbortSignal.any([lifetime.signal, AbortSignal.timeout(timeoutMs)])
      let response: Response
      for (let redirects = 0; ; redirects++) {
        await verifyResolvedAddress(url, signal)
        response = await requestImageHop(electron, url, signal)
        if (![301, 302, 303, 307, 308].includes(response.status)) break
        await response.body?.cancel()
        const location = response.headers.get('location')
        if (redirects >= 20 || location === null) throw new Error('Invalid image redirect')
        url = parseAndCheckLiteralUrl(new URL(location, url).href)
      }
      if (!response.ok) {
        await response.body?.cancel()
        throw new Error('Original image unavailable')
      }
      const mediaType = response.headers.get('content-type') ?? ''
      if (!isAllowedImageMediaType(mediaType)) {
        await response.body?.cancel()
        throw new Error('Unsupported image media type')
      }
      const reader = response.body?.getReader()
      if (reader === undefined) throw new Error('Original image unavailable')
      const chunks: Uint8Array[] = []
      let size = 0
      try {
        for (;;) {
          const chunk = await reader.read()
          if (chunk.done) break
          size += chunk.value.byteLength
          if (size > maxBytes) throw new Error('Original image exceeds the download limit')
          chunks.push(chunk.value)
        }
      } finally { await reader.cancel(); reader.releaseLock() }
      assertOwner(event)
      lifetime.signal.throwIfAborted()
      return { bytes: new Uint8Array(Buffer.concat(chunks)), mediaType }
    } finally {
      owner.removeListener('closed', abort)
      contents.removeListener('did-start-navigation', navigate)
    }
  })
}
