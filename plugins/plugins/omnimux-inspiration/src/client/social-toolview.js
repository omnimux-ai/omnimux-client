import { createElement, useCallback, useSyncExternalStore } from 'react'
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

function subscribeNoop() {
  return () => {}
}

/**
 * Resolve active UI locale ('zh' | 'en') from props, Cordis `LocaleRuntime` snapshot (`active`), or document root.
 * @param {{ locale?: unknown, getLocale?: () => 'zh' | 'en', localeRuntime?: { getSnapshot?: () => { active?: string } } }} [props]
 * @param {{ locale?: { getSnapshot?: () => { active?: string } } }} [ctx]
 * @returns {'zh' | 'en'}
 */
export function resolveInspirationToolViewLocale(props, ctx) {
  const fromProp = typeof props?.locale === 'string' ? props.locale : undefined
  const fromGetter = typeof props?.getLocale === 'function' ? props.getLocale() : undefined
  const runtime = props?.localeRuntime ?? ctx?.locale
  let fromCtx
  try {
    fromCtx = runtime?.getSnapshot?.()?.active
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
  const runtime = props?.localeRuntime
  const subscribe = useCallback(
    (onStoreChange) => (typeof runtime?.subscribe === 'function' ? runtime.subscribe(onStoreChange) : subscribeNoop()),
    [runtime],
  )
  const getSnapshot = useCallback(
    () => resolveInspirationToolViewLocale(props),
    [props],
  )
  const locale = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

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
          inject: () => ({
            localeRuntime: ctx.locale,
            getLocale,
          }),
        },
        InspirationSocialToolView,
      ),
    )
    if (typeof stop === 'function') disposers.push(stop)
  }
  return disposers
}
