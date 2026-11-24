import { memo, useEffect, useRef, useState } from 'react'
import {
  isValidBrandId,
  resolveBrandVisual,
  resolveModelBrand,
  sanitizeBrandIconPath,
  type BrandVectorElement,
  type BrandVisualResult,
} from 'dsh-ui-kit/model-brands'

import { PANEL_COPY, type PanelCopy } from '../strings.ts'
import type { UiLocale } from '../../i18n.ts'
import { ChevronDownIcon, CheckMarkIcon } from './icons.tsx'

/** localStorage key prefix: `omnimux_model_mode_<port>` ∈ {auto, manual} */
export const MODEL_MODE_STORAGE_PREFIX = 'omnimux_model_mode_'

export type ModelMode = 'auto' | 'manual'

export type AutoModelPickerCopy = PanelCopy['modelPicker']

export interface PickerModelRow {
  id: string
  name: string
  provider?: string
  brandId?: string
  brandName?: string
  brandIconPath?: string
  reasoning?: {
    efforts?: Array<{ id?: string; name?: string }>
    defaultEffort?: string
  }
}

export interface AutoModelPickerProps {
  locale: UiLocale
  port: number
  copy?: AutoModelPickerCopy
  rpc?: (method: string, payload?: unknown) => Promise<unknown>
  fetchImpl?: typeof fetch
  selectedModel?: string
  selectedProvider?: string
  onSelectModel?: (modelId: string, effort?: string, provider?: string) => void | Promise<void>
  disabled?: boolean
}

/** Normalize persisted mode: anything that is not a literal 'auto'|'manual' becomes 'auto'. */
export function normalizeModelMode(value: unknown): ModelMode {
  return value === 'manual' ? 'manual' : 'auto'
}

/**
 * Brand icon key for a model row via shared canonical registry (`dsh-ui-kit/model-brands`).
 * Returns `null` when unrecognized (unregistered models omit the icon slot).
 */
export function resolveModelBrandKey(modelId: string): string | null {
  return resolveModelBrand(modelId)
}

interface RawModelEntry {
  id?: unknown
  name?: unknown
  provider?: unknown
  brandId?: unknown
  brand_id?: unknown
  brandName?: unknown
  brand_name?: unknown
  brandIconPath?: unknown
  brand_icon_path?: unknown
  reasoning?: unknown
}

interface RawGroup {
  id?: unknown
  group?: unknown
  provider?: unknown
  models?: unknown
}

function toPickerModelRow(m: RawModelEntry, provider?: string): PickerModelRow | null {
  if (!m || typeof m.id !== 'string' || m.id === '') return null
  const name = typeof m.name === 'string' && m.name !== '' ? m.name : m.id
  const rawBrandId = m.brandId ?? m.brand_id
  const brandId = isValidBrandId(rawBrandId) ? (rawBrandId as string) : undefined
  const rawBrandName = m.brandName ?? m.brand_name
  const brandName = typeof rawBrandName === 'string' && rawBrandName.trim() ? rawBrandName.trim() : undefined
  const rawBrandIconPath = m.brandIconPath ?? m.brand_icon_path
  const brandIconPath = sanitizeBrandIconPath(rawBrandIconPath) ?? undefined
  const reasoning = typeof m.reasoning === 'object' && m.reasoning !== null
    ? m.reasoning as PickerModelRow['reasoning']
    : undefined
  return {
    id: m.id,
    name,
    ...(provider ? { provider } : {}),
    ...(brandId ? { brandId } : {}),
    ...(brandName ? { brandName } : {}),
    ...(brandIconPath ? { brandIconPath } : {}),
    ...(reasoning !== undefined ? { reasoning } : {}),
  }
}

function flattenRows(raw: unknown, providerOf: (group: RawGroup) => string | undefined): PickerModelRow[] {
  if (!raw || typeof raw !== 'object') return []
  const groups = (raw as { groups?: unknown }).groups
  if (!Array.isArray(groups)) return []
  const rows: PickerModelRow[] = []
  for (const g of groups as RawGroup[]) {
    if (!g || !Array.isArray(g.models)) continue
    const provider = providerOf(g)
    for (const m of g.models as RawModelEntry[]) {
      const rowProvider = typeof m?.provider === 'string' && m.provider !== '' ? m.provider : provider
      const row = toPickerModelRow(m, rowProvider)
      if (row) rows.push(row)
    }
  }
  return rows
}

/** `session.modelCatalog` 载荷 → 拍平行；provider 取目录分组 id。 */
export function flattenCatalogGroups(payload: unknown): PickerModelRow[] {
  return flattenRows(payload, (g) =>
    (typeof g.id === 'string' && g.id !== '' ? g.id
      : typeof g.provider === 'string' && g.provider !== '' ? g.provider
        : undefined))
}

/** Pick the effort a row can accept; `''` means the model has no reasoning control. */
export function pickEffortForRow(row: PickerModelRow): string | undefined {
  const efforts = row.reasoning?.efforts ?? []
  if (efforts.length === 0) return undefined
  const preferred = row.reasoning?.defaultEffort
  if (typeof preferred === 'string' && efforts.some((effort) => effort.id === preferred)) return preferred
  return typeof efforts[0]?.id === 'string' ? efforts[0].id : ''
}

/**
 * `/ext/bridge-config` 的 `modelGroups` → 拍平行；provider 沿用
 * 旧订阅目录的 group→provider 规则（ChatGPT (Codex) → chatgpt、
 * Grok (Subscription) → grok、组自带 provider 优先、其他 undefined）。
 */
export function flattenModelGroupsFallback(payload: unknown): PickerModelRow[] {
  const groups = Array.isArray(payload) ? payload : undefined
  if (!groups) return []
  const rows: PickerModelRow[] = []
  for (const g of groups as RawGroup[]) {
    if (!g || !Array.isArray(g.models)) continue
    const label = typeof g.group === 'string' ? g.group : typeof g.id === 'string' ? g.id : ''
    const provider = typeof g.provider === 'string' && g.provider !== '' ? g.provider
      : label === 'ChatGPT (Codex)' ? 'chatgpt'
        : label === 'Grok (Subscription)' ? 'grok'
          : undefined
    for (const m of g.models as RawModelEntry[]) {
      const row = toPickerModelRow(m, provider)
      if (row) rows.push(row)
    }
  }
  return rows
}

function renderVectorElement(el: BrandVectorElement, idx: number) {
  if (el.tag === 'path') return <path key={idx} {...(el.attrs as React.SVGProps<SVGPathElement>)} />
  if (el.tag === 'rect') return <rect key={idx} {...(el.attrs as React.SVGProps<SVGRectElement>)} />
  if (el.tag === 'circle') return <circle key={idx} {...(el.attrs as React.SVGProps<SVGCircleElement>)} />
  if (el.tag === 'text') return <text key={idx} {...(el.attrs as React.SVGProps<SVGTextElement>)}>{el.text}</text>
  return null
}

function resolvePickerBrandVisual(input: {
  modelId: string
  brandId?: string
  brandName?: string
  brandIconPath?: string
}): BrandVisualResult {
  return resolveBrandVisual({
    brandId: input.brandId,
    brandName: input.brandName,
    brandIconPath: input.brandIconPath,
    modelId: input.modelId,
    variant: 'mono',
  })
}

function BrandIcon({ visual, size }: { visual: BrandVisualResult; size: number }) {
  if (visual.kind === 'svg') {
    return (
      <svg
        width={size}
        height={size}
        viewBox={visual.vector.viewBox}
        fill={visual.vector.fill}
        className="amp-brand-icon"
        data-brand-id={visual.brandId}
        data-brand-source={visual.source}
        aria-hidden="true"
      >
        {visual.vector.elements.map(renderVectorElement)}
      </svg>
    )
  }
  if (visual.kind === 'path') {
    return (
      <svg
        width={size}
        height={size}
        viewBox={visual.viewBox}
        fill="none"
        className="amp-brand-icon"
        data-brand-id={visual.brandId || ''}
        data-brand-source={visual.source}
        aria-hidden="true"
      >
        <path d={visual.path} fill="currentColor" />
      </svg>
    )
  }
  return null
}

function readStoredModel(port: number): string {
  try {
    return localStorage.getItem(`omnimux_default_model_${port}`)
      || localStorage.getItem('omnimux_default_model')
      || ''
  } catch {
    return ''
  }
}

function readStoredMode(port: number): ModelMode {
  try {
    return normalizeModelMode(localStorage.getItem(`${MODEL_MODE_STORAGE_PREFIX}${port}`))
  } catch {
    return 'auto'
  }
}

export const AutoModelPicker = memo(function AutoModelPicker({
  locale,
  port,
  copy,
  rpc,
  fetchImpl,
  selectedModel,
  selectedProvider,
  onSelectModel,
  disabled = false,
}: AutoModelPickerProps) {
  const resolvedCopy: AutoModelPickerCopy = copy ?? PANEL_COPY[locale].modelPicker
  const [isOpen, setIsOpen] = useState(false)
  const [mode, setMode] = useState<ModelMode>(() => readStoredMode(port))
  const [storedModel, setStoredModel] = useState(() => readStoredModel(port))
  const [picked, setPicked] = useState<PickerModelRow | null>(null)
  const [rows, setRows] = useState<PickerModelRow[]>([])
  const [listState, setListState] = useState<'idle' | 'loading' | 'ok' | 'empty' | 'unavailable'>('idle')
  const rootRef = useRef<HTMLSpanElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const rpcRef = useRef(rpc)
  const fetchRef = useRef(fetchImpl)
  rpcRef.current = rpc
  fetchRef.current = fetchImpl

  // 实例切换时同步该端口的持久化模式与手动偏好，避免把上一实例的选择推给新宿主。
  useEffect(() => {
    setMode(readStoredMode(port))
    setStoredModel(readStoredModel(port))
  }, [port])

  // 外部真源变化（设置页 ModelSelector 或 settings 回填）以 props 为准，
  // 乐观选中态只覆盖到父组件回写为止。
  useEffect(() => {
    setPicked(null)
  }, [port, selectedModel, selectedProvider])

  // 宿主可能尚未实现 bridge.modelMode —— 每次失败静默即可（fire-and-forget）。
  useEffect(() => {
    const call = rpcRef.current
    if (!call) return
    void call('bridge.modelMode', { auto: mode === 'auto' }).catch(() => {})
  }, [mode, port])

  // 列表数据源两级兜底：session.modelCatalog → /ext/bridge-config 的 modelGroups。
  // 并发请求（初始加载/打开重载/端口切换）以代次丢弃过期响应，
  // 避免慢请求把上一实例的目录写进当前面板。
  const loadGenRef = useRef(0)
  const loadModels = () => {
    const call = rpcRef.current
    const fetcher = fetchRef.current ?? fetch
    const generation = ++loadGenRef.current
    setListState('loading')
    const fallback = async (): Promise<PickerModelRow[] | null> => {
      try {
        const res = await fetcher(`http://127.0.0.1:${port}/ext/bridge-config`, {
          // Loopback endpoints never authenticate with the browser cookie jar;
          // see src/shared/loopback-fetch.ts for the header-budget reason.
          credentials: 'omit',
          signal: AbortSignal.timeout(1200),
        })
        if (!res.ok) return null
        const data = await res.json() as { modelGroups?: unknown }
        return flattenModelGroupsFallback(data?.modelGroups)
      } catch {
        return null
      }
    }
    void (async () => {
      let catalogRows: PickerModelRow[] | null = null
      if (call) {
        try {
          catalogRows = flattenCatalogGroups(await call('session.modelCatalog', {}))
        } catch {
          catalogRows = null
        }
      }
      const fallbackRows = catalogRows && catalogRows.length > 0 ? null : await fallback()
      if (generation !== loadGenRef.current) return
      const resolved = catalogRows && catalogRows.length > 0 ? catalogRows : fallbackRows
      if (resolved && resolved.length > 0) {
        setRows(resolved)
        setListState('ok')
      } else {
        setRows([])
        setListState(catalogRows !== null || fallbackRows !== null ? 'empty' : 'unavailable')
      }
    })()
  }

  useEffect(() => {
    loadModels()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [port])

  // 打开面板时聚焦首个可交互元素；关闭由 Esc/外点/点选统一走 closePanel。
  useEffect(() => {
    if (!isOpen) return
    const first = panelRef.current?.querySelector<HTMLElement>('button, [role="option"]')
    first?.focus()
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    const onPointerDown = (event: MouseEvent) => {
      const root = rootRef.current
      if (root && event.target instanceof Node && !root.contains(event.target)) {
        setIsOpen(false)
        triggerRef.current?.focus()
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setIsOpen(false)
        triggerRef.current?.focus()
        return
      }
      if (event.key !== 'Tab') return
      const panelEl = panelRef.current
      if (!panelEl) return
      const focusable = [...panelEl.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )].filter((el) => !el.hasAttribute('disabled'))
      if (focusable.length === 0) {
        event.preventDefault()
        return
      }
      const first = focusable[0]!
      const last = focusable[focusable.length - 1]!
      const active = document.activeElement
      if (event.shiftKey && (active === first || !panelEl.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (active === last || !panelEl.contains(active))) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [isOpen])

  const setModelMode = (next: ModelMode) => {
    setMode(next)
    try {
      localStorage.setItem(`${MODEL_MODE_STORAGE_PREFIX}${port}`, next)
    } catch {
      // Ignore
    }
  }

  const handlePick = (row: PickerModelRow) => {
    if (mode !== 'manual') setModelMode('manual')
    setPicked(row)
    setIsOpen(false)
    triggerRef.current?.focus()
    const write = onSelectModel?.(row.id, pickEffortForRow(row), row.provider)
    if (write && selectedModel !== undefined) {
      // The parent reports write errors and supplies the last confirmed route.
      const useConfirmed = () => setPicked(current => current === row ? null : current)
      void write.then(useConfirmed, useConfirmed)
    }
  }

  const handleToggle = () => {
    const next = !isOpen
    setIsOpen(next)
    if (next) {
      loadModels()
      // 桥断线重连后宿主模式可能已回默认：每次打开都补发当前模式。
      const call = rpcRef.current
      if (call) void call('bridge.modelMode', { auto: mode === 'auto' }).catch(() => {})
    }
  }

  const effectiveModel = picked?.id ?? selectedModel ?? storedModel
  const provider = picked ? picked.provider : selectedProvider
  const isManual = mode === 'manual'
  const matches = rows.filter(row => row.id === effectiveModel && (!provider || row.provider === provider))
  const selectedRow = matches.length === 1 ? matches[0] : undefined
  const triggerRow = selectedRow ?? picked ?? undefined
  const triggerVisual = isManual
    ? resolvePickerBrandVisual({
        modelId: effectiveModel,
        brandId: triggerRow?.brandId,
        brandName: triggerRow?.brandName,
        brandIconPath: triggerRow?.brandIconPath,
      })
    : null
  const triggerLabel = isManual ? (selectedRow?.name ?? picked?.name ?? (effectiveModel || '—')) : resolvedCopy.triggerAuto

  return (
    <span className="amp-wrap" ref={rootRef}>
      <button
        type="button"
        ref={triggerRef}
        className={`amp-trigger${isOpen ? ' open' : ''}`}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-label={resolvedCopy.triggerAriaLabel}
        onClick={handleToggle}
      >
        {triggerVisual && triggerVisual.kind !== 'monogram' && <BrandIcon visual={triggerVisual} size={14} />}
        <span className="amp-trigger-label">{triggerLabel}</span>
        <ChevronDownIcon size={12} className="amp-chevron" />
      </button>
      {isOpen && (
        <div
          className="amp-panel"
          role="dialog"
          aria-label={resolvedCopy.panelTitle}
          ref={panelRef}
        >
          <div className="amp-panel-inner">
            <div className="amp-title">{resolvedCopy.panelTitle}</div>
            <div className="amp-auto-row">
              <span className="amp-auto-label">{resolvedCopy.autoLabel}</span>
              <button
                type="button"
                className={`amp-switch${mode === 'auto' ? ' on' : ''}`}
                role="switch"
                aria-checked={mode === 'auto'}
                aria-label={resolvedCopy.autoLabel}
                onClick={() => setModelMode(mode === 'auto' ? 'manual' : 'auto')}
              >
                <span className="amp-switch-thumb" aria-hidden="true" />
              </button>
            </div>
            <div className="amp-help">{resolvedCopy.autoHelp}</div>
            {mode === 'manual' && (
              <>
                <div className="amp-divider" />
                <div className="amp-list" role="listbox" aria-label={resolvedCopy.panelTitle}>
                  {listState === 'ok' && rows.map((row) => {
                    const selected = row === selectedRow
                    const visual = resolvePickerBrandVisual({
                      modelId: row.id,
                      brandId: row.brandId,
                      brandName: row.brandName,
                      brandIconPath: row.brandIconPath,
                    })
                    const subtitle = resolvedCopy.modelSubtitles[row.id] ?? resolvedCopy.fallbackSubtitle
                    return (
                      <button
                        type="button"
                        key={JSON.stringify([row.provider, row.id])}
                        role="option"
                        aria-selected={selected}
                        aria-label={selected ? `${row.name}, ${resolvedCopy.rowSelectedAria}` : row.name}
                        className={`amp-row${selected ? ' selected' : ''}`}
                        onClick={() => handlePick(row)}
                      >
                        {visual.kind !== 'monogram' && <span className="amp-row-icon"><BrandIcon visual={visual} size={20} /></span>}
                        <span className="amp-row-text">
                          <span className="amp-row-name">{row.name}</span>
                          <span className="amp-row-sub">{subtitle}</span>
                        </span>
                        {selected && <CheckMarkIcon size={12} className="amp-check" />}
                      </button>
                    )
                  })}
                  {listState === 'empty' && (
                    <div className="amp-empty">{resolvedCopy.listEmpty}</div>
                  )}
                  {listState === 'unavailable' && (
                    <div className="amp-empty">{resolvedCopy.listUnavailable}</div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </span>
  )
})
