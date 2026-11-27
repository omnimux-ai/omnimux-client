import { createElement } from 'react'
import { SocialSearchToolView, isSafeHttpUrl } from 'dsh-ui-kit/social-card'
import { NS } from '../locales.js'

/**
 * Keyed `tool.call.toolview` registrations owned by the Hub (`omnimux`).
 * Never duplicate keys owned by sibling plugins (`omnimux-inspiration`, `omnimux-viewer`, `omnimux-market`).
 */
export const OMNIMUX_SOCIAL_TOOLVIEW_KEYS = Object.freeze([
  'omnimux_x_search',
  'omnimux_x_posts',
  'omnimux_x_tweet',
  'omnimux_tiktok_search',
  'omnimux_tiktok_posts',
  'omnimux_tiktok_video',
  'omnimux_instagram_search',
  'omnimux_instagram_posts',
  'omnimux_instagram_post',
  'omnimux_youtube_search',
  'omnimux_youtube_posts',
  'omnimux_youtube_video',
  'omnimux_social_data',
  'omnimux_inspiration_list',
  'omnimux_inspiration_get',
])

const LOCAL_IMPORT_URL = '/omnimux/inspiration/local/import-url'

/**
 * Resolve active UI locale ('zh' | 'en') from props, Cordis locale service, or document root.
 * @param {{ locale?: unknown, getLocale?: () => 'zh' | 'en' }} [props]
 * @param {{ locale?: { getSnapshot?: () => { locale?: string }, current?: string } }} [ctx]
 * @returns {'zh' | 'en'}
 */
export function resolveSocialToolViewLocale(props, ctx) {
  const fromGetter = typeof props?.getLocale === 'function' ? props.getLocale() : undefined
  const fromProp = typeof props?.locale === 'string' ? props.locale : undefined
  let fromCtx
  try {
    const snap = ctx?.locale?.getSnapshot?.()
    fromCtx = snap?.locale ?? ctx?.locale?.current
  } catch {
    fromCtx = undefined
  }
  const fromDom = typeof document !== 'undefined' ? document.documentElement?.lang : undefined
  const candidate = String(fromProp || fromGetter || fromCtx || fromDom || 'zh').trim().toLowerCase()
  return candidate.startsWith('en') ? 'en' : 'zh'
}

/**
 * Save a social search result card into the local inspiration library through the Host endpoint.
 * Never throws; maps 200/201/202 to saved, 409 duplicates to alreadySaved, and errors to `{ ok: false }`.
 *
 * @param {{ sourceUrl?: string }} item
 * @param {typeof fetch} [fetcher]
 * @returns {Promise<{ ok: boolean, alreadySaved?: boolean, error?: string }>}
 */
export async function savePostToInspiration(item, fetcher = globalThis.fetch) {
  const sourceUrl = typeof item?.sourceUrl === 'string' ? item.sourceUrl.trim() : ''
  if (!isSafeHttpUrl(sourceUrl)) {
    return { ok: false, error: 'invalid url' }
  }
  if (typeof fetcher !== 'function') {
    return { ok: false, error: 'fetch unavailable' }
  }
  try {
    const response = await fetcher(LOCAL_IMPORT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: sourceUrl,
        background: true,
        auto_analyze: false,
      }),
    })
    let body = null
    try {
      body = typeof response?.json === 'function' ? await response.json() : null
    } catch {
      body = null
    }
    if (response?.status === 409 || body?.is_duplicate === true) {
      return { ok: true, alreadySaved: true }
    }
    if (response?.ok) {
      return { ok: true }
    }
    const errText =
      (typeof body?.error === 'string' && body.error) ||
      (typeof body?.message === 'string' && body.message) ||
      `HTTP ${String(response?.status ?? 'error')}`
    return { ok: false, error: errText }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Chat `tool.call.toolview` component for Hub social search, creator feed, post detail,
 * and cloud inspiration tools.
 * @param {Record<string, any>} props
 */
export function OmnimuxSocialToolView(props) {
  const toolName = String(props?.toolName || props?.block?.call?.name || props?.block?.name || '')
  const locale = resolveSocialToolViewLocale(props)
  const canSave = !toolName.startsWith('omnimux_inspiration_')

  return createElement(SocialSearchToolView, {
    toolName,
    block: props?.block,
    locale,
    inspect: typeof props?.inspect === 'function' ? props.inspect : undefined,
    canSaveToInspiration: canSave,
    onSaveToInspiration: canSave ? (item) => savePostToInspiration(item) : undefined,
  })
}

/**
 * Register Hub social & cloud-inspiration toolviews lazily via `ctx.slots.inject`.
 * @param {{ slots?: { inject?: Function, register?: Function }, locale?: any }} ctx
 * @returns {Array<() => void>}
 */
export function registerSocialToolViews(ctx) {
  if (!ctx?.slots || typeof ctx.slots.inject !== 'function' || typeof ctx.slots.register !== 'function') {
    return []
  }
  const disposers = []
  const getLocale = () => resolveSocialToolViewLocale(undefined, ctx)

  for (const key of OMNIMUX_SOCIAL_TOOLVIEW_KEYS) {
    const stop = ctx.slots.inject('tool.call.toolview', () =>
      ctx.slots.register(
        {
          name: 'tool.call.toolview',
          key,
          id: key,
          locale: NS,
          inject: () => ({ getLocale }),
        },
        OmnimuxSocialToolView,
      ),
    )
    if (typeof stop === 'function') disposers.push(stop)
  }
  return disposers
}
