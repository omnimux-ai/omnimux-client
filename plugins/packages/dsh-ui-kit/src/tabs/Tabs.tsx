import { forwardRef, useEffect, useLayoutEffect, useRef } from 'react'
import type { HTMLAttributes, MutableRefObject, ReactNode } from 'react'
import { cssClass } from '../internal/cssClass.ts'
import { cx } from '../internal/cx.ts'
import '../motion/tokens.ts'
import css from './Tabs.module.css'

export interface PageHeaderTabItem {
  id: string
  label: ReactNode
  badge?: ReactNode | number
  disabled?: boolean
}

export type TabsVariant = 'underline' | 'pill'

export interface TabsProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> {
  items: PageHeaderTabItem[]
  activeId: string
  onChange: (id: string) => void
  size?: 'default' | 'sm' // default 32px (pill) / 44px (underline), sm 28px (pill) / 36px (underline)
  variant?: TabsVariant
  className?: string
}

const TABS_CLASS = cssClass(css.tabs, 'tabs')
const PILL_CLASS = cssClass(css.pill, 'pill')
const UNDERLINE_CLASS = cssClass(css.underline, 'underline')
const SM_CLASS = cssClass(css.sm, 'sm')
const INDICATOR_CLASS = cssClass(css.indicator, 'indicator')
const TAB_ITEM_CLASS = cssClass(css.tabItem, 'tabItem')
const ACTIVE_CLASS = cssClass(css.active, 'active')
const BADGE_CLASS = cssClass(css.badge, 'badge')
const LABEL_CLASS = cssClass(css.label, 'label')

const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect

export const Tabs = forwardRef<HTMLDivElement, TabsProps>(function Tabs(
  {
    items,
    activeId,
    onChange,
    size = 'default',
    variant = 'underline',
    className,
    ...rest
  },
  ref,
) {
  const isPill = variant === 'pill'
  const listRef = useRef<HTMLDivElement | null>(null)
  const buttonRefs = useRef<Map<string, HTMLButtonElement>>(new Map())

  const setListRef = (node: HTMLDivElement | null) => {
    listRef.current = node
    if (typeof ref === 'function') {
      ref(node)
    } else if (ref) {
      ;(ref as MutableRefObject<HTMLDivElement | null>).current = node
    }
  }

  useIsomorphicLayoutEffect(() => {
    const list = listRef.current
    if (!list) return

    let rafId = 0
    const measure = () => {
      const btn = buttonRefs.current.get(activeId)
      if (!btn || !listRef.current) {
        list.removeAttribute('data-indicator')
        return
      }
      const padX = isPill
        ? 0
        : Number.parseFloat(getComputedStyle(list).getPropertyValue('--underline-tab-pad-x')) || 4
      const width = btn.offsetWidth
      const x = btn.offsetLeft + padX
      const w = Math.max(0, width - padX * 2)
      if (w <= 0) {
        list.removeAttribute('data-indicator')
        return
      }
      list.style.setProperty('--ind-x', `${x}px`)
      list.style.setProperty('--ind-w', `${w}px`)
      if (list.getAttribute('data-indicator') !== 'ready') {
        if (typeof requestAnimationFrame === 'function') {
          if (rafId) cancelAnimationFrame(rafId)
          rafId = requestAnimationFrame(() => {
            rafId = 0
            if (listRef.current === list) {
              list.setAttribute('data-indicator', 'ready')
            }
          })
        } else {
          list.setAttribute('data-indicator', 'ready')
        }
      }
    }

    measure()

    let observer: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => measure())
      observer.observe(list)
      const activeBtn = buttonRefs.current.get(activeId)
      if (activeBtn) observer.observe(activeBtn)
    }

    let cancelled = false
    if (typeof document !== 'undefined' && document.fonts?.ready) {
      void document.fonts.ready.then(() => {
        if (!cancelled) measure()
      })
    }

    return () => {
      cancelled = true
      if (rafId && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(rafId)
      }
      observer?.disconnect()
    }
  }, [activeId, isPill, size, items])

  return (
    <div
      {...rest}
      ref={setListRef}
      role="tablist"
      className={cx(
        TABS_CLASS,
        isPill ? PILL_CLASS : UNDERLINE_CLASS,
        size === 'sm' && SM_CLASS,
        className,
      )}
    >
      <span className={INDICATOR_CLASS} aria-hidden="true" />
      {items.map((item) => {
        const isActive = item.id === activeId
        const isPrimitiveLabel =
          typeof item.label === 'string' || typeof item.label === 'number'
        return (
          <button
            key={item.id}
            ref={(el) => {
              if (el) buttonRefs.current.set(item.id, el)
              else buttonRefs.current.delete(item.id)
            }}
            type="button"
            role="tab"
            aria-selected={isActive}
            disabled={item.disabled}
            className={cx(TAB_ITEM_CLASS, isActive && ACTIVE_CLASS)}
            onClick={() => {
              if (!item.disabled && item.id !== activeId) {
                onChange(item.id)
              }
            }}
          >
            <span
              className={LABEL_CLASS}
              data-label={isPrimitiveLabel ? String(item.label) : undefined}
            >
              {item.label}
            </span>
            {item.badge != null && item.badge !== '' ? (
              <span className={BADGE_CLASS}>{item.badge}</span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
})
