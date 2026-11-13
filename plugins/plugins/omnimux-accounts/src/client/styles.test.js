import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { STYLES } from './styles.js'

const here = dirname(fileURLToPath(import.meta.url))

/**
 * Pull one CSS rule body (inner declarations only) for an exact selector.
 * The stylesheet is a single exported string, so tests pin layout contracts
 * without spinning up a browser.
 * @param {string} css
 * @param {string} selector
 */
function ruleBody(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`))
  assert.ok(match, `missing selector ${selector}`)
  return match[1]
}

/**
 * @param {string} body
 * @param {string} property
 */
function decl(body, property) {
  const match = body.match(new RegExp(`${property}\\s*:\\s*([^;]+);`))
  assert.ok(match, `missing ${property} in ${body}`)
  return match[1].trim()
}

describe('table cellmenu CSS (list-mode ⋯ / popover)', () => {
  it('sizes the cellmenu as a 32px relative inline-flex anchor', () => {
    const body = ruleBody(STYLES, '.omnimux-accounts-cellmenu')
    assert.equal(decl(body, 'display'), 'inline-flex')
    assert.equal(decl(body, 'align-items'), 'center')
    assert.equal(decl(body, 'justify-content'), 'center')
    assert.equal(decl(body, 'width'), '32px')
    assert.equal(decl(body, 'height'), '32px')
    assert.equal(decl(body, 'vertical-align'), 'middle')
    assert.equal(decl(body, 'position'), 'relative')
  })

  it('scopes the ⋯ button to static so it stays in the table cell', () => {
    const body = ruleBody(STYLES, '.omnimux-accounts-cellmenu .omnimux-accounts-more')
    assert.equal(decl(body, 'position'), 'static')
    assert.equal(decl(body, 'top'), 'auto')
    assert.equal(decl(body, 'right'), 'auto')
    assert.equal(decl(body, 'z-index'), 'auto')
    assert.equal(decl(body, 'width'), '26px')
    assert.equal(decl(body, 'height'), '26px')
  })

  it('anchors the table popover to the cellmenu, not the card offsets', () => {
    const body = ruleBody(STYLES, '.omnimux-accounts-cellmenu .omnimux-accounts-popover')
    assert.equal(decl(body, 'top'), 'calc(100% + 4px)')
    assert.equal(decl(body, 'right'), '0')
    assert.equal(decl(body, 'left'), 'auto')
    assert.equal(decl(body, 'z-index'), '6')
    assert.equal(decl(body, 'min-width'), '200px')
    assert.equal(decl(body, 'max-width'), 'min(280px, 70vw)')
  })

  it('flips the last two table-row popovers upward to avoid tablewrap clip', () => {
    assert.match(
      STYLES,
      /\.omnimux-accounts-table tbody tr:last-child \.omnimux-accounts-cellmenu \.omnimux-accounts-popover,\s*\n\s*\.omnimux-accounts-table tbody tr:nth-last-child\(2\) \.omnimux-accounts-cellmenu \.omnimux-accounts-popover \{/,
    )
    const body = ruleBody(
      STYLES,
      '.omnimux-accounts-table tbody tr:nth-last-child(2) .omnimux-accounts-cellmenu .omnimux-accounts-popover',
    )
    assert.equal(decl(body, 'top'), 'auto')
    assert.equal(decl(body, 'bottom'), 'calc(100% + 4px)')
  })

  it('does not rewrite the default card ⋯ / popover absolute rules', () => {
    const more = ruleBody(STYLES, '.omnimux-accounts-more')
    assert.equal(decl(more, 'position'), 'absolute')
    assert.equal(decl(more, 'top'), '8px')
    assert.equal(decl(more, 'right'), '8px')
    assert.equal(decl(more, 'z-index'), '1')

    const popover = ruleBody(STYLES, '.omnimux-accounts-popover')
    assert.equal(decl(popover, 'position'), 'absolute')
    assert.equal(decl(popover, 'top'), '38px')
    assert.equal(decl(popover, 'right'), '8px')
    assert.equal(decl(popover, 'z-index'), '5')
    assert.equal(decl(popover, 'max-width'), '280px')
  })
})

describe('JSX freeze (AccountTable / AccountCard / AccountMenu / Avatar)', () => {
  it('wraps the table-row menu in cellmenu and leaves the card unwrapped', () => {
    const table = readFileSync(join(here, 'AccountTable.jsx'), 'utf8')
    const card = readFileSync(join(here, 'AccountCard.jsx'), 'utf8')
    const controls = readFileSync(join(here, 'account-controls.jsx'), 'utf8')
    const chips = readFileSync(join(here, 'chips.jsx'), 'utf8')

    assert.match(
      table,
      /<span className="omnimux-accounts-cellmenu">\s*<AccountMenu /,
    )
    assert.doesNotMatch(card, /omnimux-accounts-cellmenu/)
    assert.match(card, /<AccountMenu t=\{t\} name=\{name\}/)
    assert.match(controls, /className="omnimux-accounts-more"/)
    assert.match(controls, /className="omnimux-accounts-popover"/)
    assert.doesNotMatch(controls, /omnimux-accounts-cellmenu/)
    assert.match(chips, /referrerPolicy="no-referrer"/)
  })
})

describe('FilterBar structure contract', () => {
  const filterBar = readFileSync(join(here, 'FilterBar.jsx'), 'utf8')

  it('composes kit FilterBar / SearchField / DropdownSelect / IconButton', () => {
    assert.match(
      filterBar,
      /import \{ FilterBar as KitFilterBar, SearchField, DropdownSelect, IconButton \} from 'dsh-ui-kit'/,
    )
    assert.match(filterBar, /<KitFilterBar\b/)
    assert.match(filterBar, /<SearchField\b/)
    assert.match(filterBar, /<DropdownSelect\b/)
    assert.match(filterBar, /<IconButton\b/)
  })

  it('toggles sort/view with outline IconButton + aria-pressed, no local iconbtn class', () => {
    assert.match(filterBar, /variant="outline"/)
    assert.match(filterBar, /aria-pressed=\{sortDir === 'desc'\}/)
    assert.match(filterBar, /aria-pressed=\{view === 'grid'\}/)
    assert.match(filterBar, /aria-pressed=\{view === 'table'\}/)
    assert.doesNotMatch(filterBar, /omnimux-accounts-iconbtn/)
    assert.doesNotMatch(filterBar, /<button\b/)
  })

  it('keeps filter-actions layout class and drops dead iconbtn CSS', () => {
    assert.match(filterBar, /className="omnimux-accounts-filter-actions"/)
    assert.match(STYLES, /\.omnimux-accounts-filterbar\s*\{/)
    assert.match(STYLES, /\.omnimux-accounts-filter-actions\s*\{/)
    assert.doesNotMatch(STYLES, /\.omnimux-accounts-iconbtn/)
  })
})

describe('OverviewBar structure and styling contract', () => {
  const overviewBar = readFileSync(join(here, 'OverviewBar.jsx'), 'utf8')

  it('renders standard kit Button with stat-head before stat-value', () => {
    assert.match(overviewBar, /import \{ Button \} from 'dsh-ui-kit'/)
    assert.match(overviewBar, /<Button\b/)
    assert.match(overviewBar, /className=\{`omnimux-accounts-stat omnimux-accounts-stat--\$\{stat\.key\}`\}/)
    assert.match(overviewBar, /aria-pressed=\{stat\.selected\}/)
    assert.match(overviewBar, /className="omnimux-accounts-stat-head"/)
    assert.match(overviewBar, /className="omnimux-accounts-stat-value"/)
  })

  it('defines 12px-radius metric card grid, tabular-nums value, and interactive states', () => {
    const overviewBody = ruleBody(STYLES, '.omnimux-accounts-overview')
    assert.equal(decl(overviewBody, 'display'), 'grid')
    assert.equal(decl(overviewBody, 'gap'), '12px')

    const statBody = ruleBody(STYLES, '.omnimux-accounts-stat')
    assert.match(decl(statBody, 'display'), /^flex(\s*!important)?$/)
    assert.match(decl(statBody, 'flex-direction'), /^column(\s*!important)?$/)
    assert.match(decl(statBody, 'border-radius'), /^12px(\s*!important)?$/)
    assert.match(decl(statBody, 'padding'), /^12px 16px(\s*!important)?$/)

    const valueBody = ruleBody(STYLES, '.omnimux-accounts-stat-value')
    assert.equal(decl(valueBody, 'font-size'), '24px')
    assert.equal(decl(valueBody, 'font-variant-numeric'), 'tabular-nums')

    assert.match(STYLES, /\.omnimux-accounts-stat\[aria-pressed="true"\]\s*\{/)
    assert.match(STYLES, /\.omnimux-accounts-dot--needsAttention\s*\{/)
    assert.match(STYLES, /\.omnimux-accounts-dot--platforms\s*\{/)
    assert.match(STYLES, /\.omnimux-accounts-dot--total\s*\{/)
    assert.doesNotMatch(STYLES, /\.omnimux-accounts-overview-row\s*\{/)
  })
})

describe('client bundle freeze (outline pressed tokens, no dead iconbtn)', () => {
  const bundle = readFileSync(join(here, '../../lib/client.js'), 'utf8')

  it('embeds hashed outline pressed + hover-defense rules with kit tokens', () => {
    assert.match(bundle, /\.dshUk-Button-outline\[aria-pressed="true"\]/)
    assert.match(bundle, /var\(--dsw-alias-button-ghost-active-fill\)/)
    assert.match(bundle, /var\(--dsw-alias-button-ghost-active-border\)/)
    assert.match(bundle, /var\(--dsw-alias-button-ghost-active-hover\)/)
    assert.match(
      bundle,
      /\.dshUk-Button-outline\[aria-pressed="true"\]:hover:not\(:disabled\):not\(\[aria-disabled="true"\]\)/,
    )
  })

  it('does not ship leftover .omnimux-accounts-iconbtn rules', () => {
    assert.doesNotMatch(bundle, /\.omnimux-accounts-iconbtn/)
  })
})
