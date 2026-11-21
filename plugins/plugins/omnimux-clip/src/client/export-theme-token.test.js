import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import postcss from 'postcss'
import tailwind from '../../tailwind.openreel.config.js'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const editor = './openreel/web/components/editor/'
const control = read(`${editor}EditorExportControl.tsx`)
const icon = read(`${editor}EditorHeaderIcon.tsx`)
const desktop = postcss.parse(read(`${editor}reference-workspace.css`))
const mobile = postcss.parse(read(`${editor}mobile/mobile-editor.css`))
const mappings = postcss.parse(read('./theme/dsw-map.css'))

function declarations(css, selector) {
  const result = new Map()
  css.walkRules(rule => {
    if (rule.selectors.includes(selector)) {
      rule.nodes.filter(node => node.type === 'decl').forEach(node => {
        result.set(node.prop, node.value)
      })
    }
  })
  return result
}

test('Export idle and hover use host accent tokens in both header layouts', () => {
  assert.match(control, /className=\{compact \? "mobile-editor-export" : "workspace-export"\}/)
  assert.match(control, /data-export-state=\{status\}/)
  for (const [css, selector] of [
    [desktop, '.workspace-export'],
    [mobile, '.mobile-editor-topbar .mobile-editor-export'],
  ]) {
    const idle = declarations(css, selector)
    assert.equal(idle.get('background'), 'var(--accent)', selector)
    assert.equal(idle.get('color'), 'var(--accent-fg)', selector)
    const hover = declarations(css, `${selector}[data-export-state="idle"]:hover:not(:disabled)`)
    assert.equal(hover.get('background'), 'var(--accent-strong)', selector)
  }
})

test('Export icon inherits the button foreground', () => {
  assert.match(control, /<EditorHeaderIcon kind="export"/)
  assert.match(icon, /<svg[^>]*stroke="currentColor"/)
  for (const source of [control, icon]) {
    assert.doesNotMatch(source, /\b(?:text-white|border-white\/\d+)\b|stroke="#(?:fff|ffffff)"/i)
  }
  const style = declarations(desktop, '.workspace-export svg')
  assert.equal(style.get('stroke') ?? 'currentColor', 'currentColor')
})

test('DSH accent mappings and retained Tailwind utilities stay aligned', () => {
  const root = declarations(mappings, '.openreel-studio-root')
  for (const token of ['--accent', '--accent-strong', '--accent-fg']) {
    assert.match(root.get(token), /^var\(--dsw-/, token)
  }
  assert.match(root.get('--accent-divider'), /color-mix\(.*var\(--accent-fg\b/)
  const accent = tailwind.theme.extend.colors.accent
  assert.ok(root.get('--accent-soft'))
  assert.equal(accent.divider, 'var(--accent-divider)')
  assert.equal(accent.DEFAULT({}), 'var(--accent)')
  assert.equal(accent.strong({}), 'var(--accent-strong)')
  assert.equal(accent.soft({}), 'var(--accent-soft)')
  assert.equal(accent.fg({}), 'var(--accent-fg)')
  for (const source of [control, icon, desktop.toString(), mobile.toString(), mappings.toString()]) {
    assert.doesNotMatch(source, /--omx-/)
  }
})
