import { createElement } from 'react'
import { SocialSearchToolView } from 'dsh-ui-kit/social-card'
import { NS } from './locales.js'
import { openExternalUrl } from './open-url.js'

/**
 * Keyed `tool.call.toolview` registrations owned by `omnimux-inspiration`.
 * Disjoint from Hub (`omnimux_*`), `omnimux-viewer` (`display_file`/`read_image`),
 * and `omnimux-market` (`skillhub_*`/`plaza_search`).
 */
export const INSPIRATION_SOCIAL_TOOLVIEW_KEYS = Object.freeze([
  'inspiration_search',
  'inspiration_get',
  'inspiration_rival_posts',
  'inspiration_rival_post',
])

/**
 * Resolve active UI locale ('zh' | 'en') from props, Cordis locale service, or document root.
 * @param {{ locale?: unknown, getLocale?: () => 'zh' | 'en' }} [props]
 * @param {{ locale?: { getSnapshot?: () => { locale?: string }, current?: string } }} [ctx]
 * @returns {'zh' | 'en'}
 */
export function resolveInspirationToolViewLocale(props, ctx) {
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
 * Chat `tool.call.toolview` component for local inspiration and rival-post tools.
 * @param {Record<string, any>} props
 */
export function InspirationSocialToolView(props) {
  const toolName = String(props?.toolName || props?.block?.call?.name || props?.block?.name || '')
  const locale = resolveInspirationToolViewLocale(props)

  return createElement(SocialSearchToolView, {
    toolName,
    block: props?.block,
    locale,
    inspect: typeof props?.inspect === 'function' ? props.inspect : undefined,
    canSaveToInspiration: false,
    onOpenPost: (item) => {
      if (item?.sourceUrl) openExternalUrl(item.sourceUrl)
    },
  })
}

/**
 * Register inspiration `tool.call.toolview` renderers lazily through `ctx.slots.inject`.
 * @param {{ slots?: { inject?: Function, register?: Function }, locale?: any }} ctx
 * @returns {Array<() => void>}
 */
export function registerInspirationSocialToolViews(ctx) {
  if (!ctx?.slots || typeof ctx.slots.inject !== 'function' || typeof ctx.slots.register !== 'function') {
    return []
  }
  const disposers = []
  const getLocale = () => resolveInspirationToolViewLocale(undefined, ctx)

  for (const key of INSPIRATION_SOCIAL_TOOLVIEW_KEYS) {
    const stop = ctx.slots.inject('tool.call.toolview', () =>
      ctx.slots.register(
        {
          name: 'tool.call.toolview',
          key,
          id: key,
          locale: NS,
          inject: () => ({ getLocale }),
        },
        InspirationSocialToolView,
      ),
    )
    if (typeof stop === 'function') disposers.push(stop)
  }
  return disposers
}
