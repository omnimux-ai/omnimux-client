import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { resolveKitLocale } from './internal/locale.ts'
import { createSidebarEntry } from './stage/createSidebarEntry.ts'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel) => readFileSync(join(here, rel), 'utf8')

describe('Layer 1 dsh-ui-kit UX overhaul', () => {
  it('resolveKitLocale infers zh/en from explicit arg, html lang, or navigator without throwing', () => {
    assert.equal(resolveKitLocale('en-US'), 'en')
    assert.equal(resolveKitLocale('zh-CN'), 'zh')

    const origDoc = globalThis.document
    const origNav = globalThis.navigator
    try {
      globalThis.document = { documentElement: { lang: 'en-GB' } }
      assert.equal(resolveKitLocale(), 'en')

      globalThis.document = { documentElement: { lang: 'zh-Hans' } }
      assert.equal(resolveKitLocale(), 'zh')

      globalThis.document = { documentElement: { lang: '' } }
      Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: { language: 'en-US' },
      })
      assert.equal(resolveKitLocale(), 'en')
    } finally {
      globalThis.document = origDoc
      if (origNav !== undefined) {
        Object.defineProperty(globalThis, 'navigator', { configurable: true, value: origNav })
      }
    }
  })

  it('SearchField stops Esc propagation when clearing, preserves immediate controlled input, clears pending timers on mode switch, and supports Mod/⌘ cross-platform shortcuts', () => {
    const src = read('search/SearchField.tsx')
    assert.match(src, /event\.stopPropagation\(\)/)
    assert.match(src, /isApplePlatform\(\)/)
    assert.match(src, /wantsMod = \/\\bmod\\b\/\.test\(lower\) \|\| \(hasCmdGlyph && !hasExplicitMeta && !hasExplicitCtrl\)/)
    assert.match(src, /event\.defaultPrevented \|\| event\.isComposing/)
    assert.match(src, /const immediate = controlled \|\| debounceMs <= 0 \|\| !onValueChange/)
    assert.match(src, /useEffect\(\(\) => clearPendingEmit, \[immediate, onValueChange\]\)/)
    assert.match(src, /function emit\(next: string\): void \{\s*clearPendingEmit\(\);/s)
    assert.match(src, /resolveKitLocale\(\) === "en"/)
  })

  it('ConfirmModal focuses cancel button by default on danger dialogs and blocks closing while confirmLoading', () => {
    const tsx = read('dialog/Dialog.tsx')
    const css = read('dialog/Dialog.module.css')
    assert.match(tsx, /cancelRef = useRef<HTMLButtonElement>\(null\)/)
    assert.match(tsx, /if \(!rest\.open \|\| confirmVariant !== "danger"\) return/)
    assert.match(tsx, /cancelRef\.current\?\.focus\(\)/)
    assert.match(tsx, /const guardedOnClose = \(\) => \{\s*if \(!confirmLoading\) onClose\(\)/s)
    assert.match(css, /\.description\s*\{[^}]*--dsw-alias-label-secondary/s)
    assert.match(css, /\.iconFooter\s*\{[^}]*padding:\s*12px 24px 20px/s)
  })

  it('IconButton keeps Tooltip visible via a stable wrapper across disabled transitions, and Button.module.css styles aria-busy', () => {
    const tsx = read('button/Button.tsx')
    const css = read('button/Button.module.css')
    assert.match(tsx, /<span style=\{\{ display: "inline-flex", cursor: isDisabled \? "not-allowed" : undefined \}\}>\{button\}<\/span>/)
    assert.match(css, /\.button\[aria-busy="true"\]\s*\{[^}]*cursor:\s*wait/s)
  })

  it('Tabs, DropdownSelect, TableHead, and DataTable expose keyboard navigation and localized fallbacks', () => {
    const tabs = read('tabs/Tabs.tsx')
    const dropdown = read('field/DropdownSelect.tsx')
    const table = read('table/Table.tsx')
    const tableCss = read('table/Table.module.css')
    const dataTable = read('table/DataTable.tsx')
    const dataTableCss = read('table/DataTable.module.css')

    assert.match(tabs, /event\.key === 'ArrowRight' \|\| event\.key === 'ArrowDown'/)
    assert.match(tabs, /event\.key === 'Home'/)
    assert.match(tabs, /tabIndex=\{item\.disabled \? -1 : item\.id === focusableTabId \? 0 : -1\}/)

    assert.match(dropdown, /autoFocus/)
    assert.match(dropdown, /returnFocus=\{\(\) => triggerRef\.current\}/)
    assert.match(dropdown, /event\.key === "ArrowDown" \|\| event\.key === "ArrowUp"/)

    assert.match(table, /sortable && onClick && \(e\.key === "Enter" \|\| e\.key === " "\)/)
    assert.match(tableCss, /\.headCellSortable:focus-visible/)

    assert.match(dataTable, /tabIndex=\{onRowClick \? 0 : undefined\}/)
    assert.match(dataTable, /if \(e\.target !== e\.currentTarget\) return/)
    assert.match(dataTableCss, /\.clickableRow:focus-visible/)
  })

  it('Drawer listens at document level without eating SearchField Esc, blocks portaled modal Esc/focus steal, and localizes close label', () => {
    const drawer = read('drawer/Drawer.tsx')
    assert.match(drawer, /document\.addEventListener\("keydown", onDocumentKeyDown\)/)
    assert.match(drawer, /if \(e\.defaultPrevented\) return;/)
    assert.match(drawer, /closest\('\[role="menu"\]'\)/)
    assert.match(drawer, /hasBlockingModalAbove\(drawerRef\.current\)/)
    assert.match(drawer, /if \(!current \|\| current !== el \|\| !latestOpenRef\.current \|\| hasBlockingModalAbove\(current\)\) return;/)
    assert.match(drawer, /!drawerRef\.current\.contains\(e\.target\)/)
    assert.match(drawer, /closeLabel\?: string/)
  })

  it('Toolbar scrolls horizontally on narrow viewports instead of clipping, and PageHeader localizes + guards refresh double click', () => {
    const toolbarCss = read('toolbar/Toolbar.module.css')
    const headerTsx = read('stage/PageHeader.tsx')
    assert.match(toolbarCss, /\.left\s*\{[^}]*overflow-x:\s*auto/s)
    assert.match(headerTsx, /if \(!refreshing\) void onRefresh\(\)/)
    assert.match(headerTsx, /resolveKitLocale\(\) === 'en'/)
  })

  it('createSidebarEntry enables tooltip title by default and exposes focus-visible + press feedback', () => {
    const origWindow = globalThis.window
    const origDoc = globalThis.document
    let registeredStyles = ''
    const fakeEntry = {
      title: '',
      className: '',
      innerHTML: '',
      dataset: {},
      setAttribute: () => {},
      removeAttribute: () => {},
      querySelector: () => ({ textContent: '' }),
      addEventListener: () => {},
    }
    globalThis.document = { createElement: () => fakeEntry }
    globalThis.window = {
      __omnimuxSidebar: {
        register: (row) => {
          registeredStyles = row.styles || ''
          row.create()
          return () => {}
        },
      },
    }

    try {
      const cleanup = createSidebarEntry({
        id: 'ux-default-title',
        rank: 99,
        label: '工作流画布',
        iconSvg: '<svg></svg>',
        stageStore: { open: () => {}, getSnapshot: () => false, subscribe: () => () => {} },
      })
      assert.equal(fakeEntry.title, '工作流画布')
      assert.match(registeredStyles, /:focus-visible/)
      assert.match(registeredStyles, /:active/)
      assert.match(registeredStyles, /prefers-reduced-motion:\s*reduce/)
      cleanup()
    } finally {
      globalThis.window = origWindow
      globalThis.document = origDoc
    }
  })

  it('SocialSearchToolView hides JSON debug button by default, replaces ×N, and surfaces save spinner + retry + inline errors', () => {
    const tsx = read('social-card/SocialSearchToolView.tsx')
    const css = read('social-card/SocialSearchToolView.module.css')
    assert.doesNotMatch(tsx, /`×\$\{parsed\.totalCount\}`/)
    assert.match(tsx, /\(Boolean\(inspect\) \|\| isPassthrough \|\| isError\) && parsed\.rawOutputText/)
    assert.match(tsx, /hoverSpinner/)
    assert.match(tsx, /hoverRetryLabel/)
    assert.match(tsx, /saveErrors\.size > 0/)
    assert.match(css, /\.hoverSpinner/)
  })

  it('GenWaveCard disables fake 0→96% demo progress badge unless real progress or autoProgress={true} is supplied', () => {
    const tsx = read('gen-wave-card/GenWaveCard.tsx')
    assert.match(tsx, /autoProgress = false/)
    assert.match(tsx, /shouldShowBadge = progress !== undefined \|\| autoProgress === true/)
    assert.match(tsx, /if \(showBadgeRef\.current\)/)
  })
})
