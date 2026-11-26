import assert from 'node:assert/strict'
import { rm } from 'node:fs/promises'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { STYLES } from './styles.js'

const bundle = new URL('./.platform-brand-icon-test.mjs', import.meta.url)

const HOST_TOKENS = new Map([
  [
    'light',
    new Map([
      ['--dsw-alias-label-on-color', 'rgb(255, 255, 255)'],
      ['--dsw-alias-label-primary', 'rgb(15, 17, 21)'],
      ['--dsw-alias-label-primary-foreground', 'rgb(255, 255, 255)'],
      ['--dsw-alias-bg-module-platform', 'rgb(245, 246, 247)'],
    ]),
  ],
  [
    'dark',
    new Map([
      ['--dsw-alias-label-on-color', 'rgb(255, 255, 255)'],
      ['--dsw-alias-label-primary', 'rgb(249, 250, 251)'],
      ['--dsw-alias-label-primary-foreground', 'rgb(15, 17, 21)'],
      ['--dsw-alias-bg-module-platform', 'rgb(53, 54, 56)'],
    ]),
  ],
])

function resolveColorExpr(expr, tokens) {
  const value = String(expr || '').trim()
  const m = value.match(/^var\(\s*(--[A-Za-z0-9-]+)(?:\s*,\s*([^)]+))?\)$/)
  if (!m) return value
  const resolved = tokens.get(m[1])
  if (resolved !== undefined) return resolved
  return m[2] ? resolveColorExpr(m[2], tokens) : ''
}

function parseRgb(color) {
  const hex = String(color || '').trim().match(/^#([0-9a-f]{6})$/i)
  if (hex) {
    const n = parseInt(hex[1], 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }
  const rgb = String(color || '').trim().match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i)
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null
}

function contrastRatio(fg, bg) {
  const [r1, g1, b1] = parseRgb(fg) || []
  const [r2, g2, b2] = parseRgb(bg) || []
  assert.ok(Number.isFinite(r1) && Number.isFinite(r2), `invalid rgb colors: fg=${fg}, bg=${bg}`)
  const lum = (r, g, b) => {
    const channel = (v) => {
      const s = v / 255
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
  }
  const l1 = lum(r1, g1, b1)
  const l2 = lum(r2, g2, b2)
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
}

function ruleProperty(selector, property) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const rule = STYLES.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`))
  assert.ok(rule, `missing CSS rule for ${selector}`)
  const decl = rule[1].match(new RegExp(`${property}\\s*:\\s*([^;]+);`))
  assert.ok(decl, `missing ${property} in ${selector}`)
  return decl[1].trim()
}

async function loadIcons() {
  await build({
    entryPoints: [fileURLToPath(new URL('./icons.jsx', import.meta.url))],
    outfile: fileURLToPath(bundle),
    bundle: true,
    format: 'esm',
    platform: 'node',
    jsx: 'automatic',
    external: ['react', 'react/jsx-runtime'],
    logLevel: 'silent',
  })
  try {
    return await import(`${bundle.href}?t=${Date.now()}`)
  } finally {
    await rm(fileURLToPath(bundle), { force: true })
  }
}

describe('PlatformBrandIcon & Dual-Theme Contrast Contract', () => {
  it('renders 3-layer chromatic TikTok SVG with unclipped viewBox and white top currentColor layer', async () => {
    const { PlatformBrandIcon } = await loadIcons()
    const element = PlatformBrandIcon({ platform: 'tiktok', size: 22 })
    assert.equal(element.type, 'svg')
    assert.equal(element.props.width, 22)
    assert.equal(element.props.height, 22)
    assert.equal(element.props.viewBox, '-0.7 -1.5 27 27')

    const paths = React.Children.toArray(element.props.children).filter(
      (child) => React.isValidElement(child) && child.type === 'path'
    )
    assert.equal(paths.length, 3, 'TikTok icon must render cyan, magenta and currentColor layers')
    assert.equal(paths[0].props.fill, '#25F4EE')
    assert.equal(paths[0].props.transform, 'translate(-0.9 -0.75)')
    assert.equal(paths[1].props.fill, '#FE2C55')
    assert.equal(paths[1].props.transform, 'translate(0.9 0.75)')
    assert.equal(paths[2].props.fill, 'currentColor')

    const markup = renderToStaticMarkup(React.createElement(PlatformBrandIcon, { platform: 'tiktok', size: 22 }))
    assert.match(markup, /<svg[^>]*viewBox="-0\.7 -1\.5 27 27"/)
    assert.equal((markup.match(/<path\b/g) ?? []).length, 3)
    assert.match(markup, /fill="#25F4EE"/)
    assert.match(markup, /transform="translate\(-0\.9 -0\.75\)"/)
    assert.match(markup, /fill="#FE2C55"/)
    assert.match(markup, /transform="translate\(0\.9 0\.75\)"/)
    assert.match(markup, /fill="currentColor"/)
  })

  it('renders currentColor glyphs for coming-soon brand tiles', async () => {
    const { PlatformBrandIcon } = await loadIcons()
    for (const platform of ['instagram', 'youtube', 'x', 'facebook']) {
      const markup = renderToStaticMarkup(React.createElement(PlatformBrandIcon, { platform, size: 14 }))
      assert.match(markup, /<svg\b/, `${platform} must render an <svg>`)
      assert.match(markup, /currentColor/, `${platform} glyph must inherit tile foreground currentColor`)
    }
  })

  it('uses --dsw-alias-label-on-color for all brand icon tiles and --dsw-alias-label-primary for solid chip across light/dark themes', () => {
    for (const id of ['tiktok', 'instagram', 'youtube', 'x', 'facebook']) {
      const selector = `.omnimux-accounts-brand-icon--${id}`
      const colorDecl = ruleProperty(selector, 'color')
      assert.match(colorDecl, /^var\(--dsw-alias-label-on-color\b/, `${selector} must use --dsw-alias-label-on-color, got ${colorDecl}`)
      assert.doesNotMatch(colorDecl, /--dsw-alias-label-primary-foreground/, `${selector} must not use theme-inverting primary-foreground`)
    }

    for (const [theme, tokens] of HOST_TOKENS.entries()) {
      for (const [id, bgFallback] of [['tiktok', '#000000'], ['x', '#111111'], ['youtube', '#ff0000'], ['facebook', '#1877f2']]) {
        const selector = `.omnimux-accounts-brand-icon--${id}`
        const fg = resolveColorExpr(ruleProperty(selector, 'color'), tokens)
        const bg = resolveColorExpr(ruleProperty(selector, 'background'), tokens) || bgFallback
        assert.equal(fg, 'rgb(255, 255, 255)', `${selector} foreground must resolve white in ${theme} theme`)
        const ratio = contrastRatio(fg, bg)
        assert.ok(ratio >= 3, `${selector} contrast ${ratio.toFixed(2)} < 3 in ${theme} theme`)
      }

      const chipBg = resolveColorExpr(ruleProperty('.omnimux-accounts-chip--solid', 'background'), tokens)
      const chipFg = resolveColorExpr(ruleProperty('.omnimux-accounts-chip--solid', 'color'), tokens)
      const chipRatio = contrastRatio(chipFg, chipBg)
      assert.ok(chipRatio >= 4.5, `.omnimux-accounts-chip--solid contrast ${chipRatio.toFixed(2)} < 4.5 in ${theme} theme`)
    }
  })
})
