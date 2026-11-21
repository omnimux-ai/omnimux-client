import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import postcss from 'postcss'
import selectors from 'postcss-selector-parser'
import ts from 'typescript'
import { scopeOpenReelCss } from '../../scripts/scope-openreel-css.mjs'

const ROOT = 'openreel-studio-root'
const ID_PREFIX = 'omnimux-clip-css:'

function injectedStylesheets() {
  const code = readFileSync(new URL('../../lib/client.js', import.meta.url), 'utf8')
  const stylesheets = new Map()
  // Read the same static literal assigned to style.textContent in the CJS
  // bundle. The compiler can emit either a string or a template literal.
  const bindings = /"omnimux-clip-css:([^"]+\.css)";if\(document\.getElementById\(/g
  for (const match of code.matchAll(bindings)) {
    const assignment = 'style.textContent='
    const from = match.index + match[0].length
    const start = code.indexOf(assignment, from)
    assert.ok(start > from && start - from < 512, `No stylesheet body for ${match[1]}`)
    const end = code.indexOf('.appendChild(style)', start)
    assert.ok(end > start, `No injection for ${match[1]}`)
    const body = code.slice(start + assignment.length, end)
    // Scan just the CSS literal, so parsing the test never evaluates the bundle.
    const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, body)
    assert.ok([ts.SyntaxKind.StringLiteral, ts.SyntaxKind.NoSubstitutionTemplateLiteral].includes(scanner.scan()), match[1])
    stylesheets.set(match[1], { css: postcss.parse(scanner.getTokenValue()), offset: match.index })
  }
  assert.ok(stylesheets.size > 0, `Build the Clip bundle first. Missing ${ID_PREFIX} injections.`)
  return stylesheets
}

function hasStudioScope(selector) {
  return selector.nodes.some(node => {
    if (node.type === 'class') return node.value === ROOT
    return node.type === 'pseudo' && [':is', ':where'].includes(node.value)
      && node.nodes.length > 0 && node.nodes.every(hasStudioScope)
  })
}

function assertIsolated(css, filename) {
  css.walkAtRules(/keyframes$/i, rule => assert.match(rule.params, /^omnimux-clip-/, filename))
  css.walkRules(rule => {
    for (let parent = rule.parent; parent; parent = parent.parent) {
      if (parent.type === 'atrule' && /keyframes$/i.test(parent.name)) return
    }
    assert.doesNotMatch(rule.selector, /(^|[\s,(>+~])(?::root\b|body\s*:has\()/, filename)
    const tree = selectors().astSync(rule.selector)
    tree.each(selector => assert.ok(hasStudioScope(selector), `${filename}: ${selector}`))
  })
}

test('Clip bundle keeps every vendor stylesheet under the studio root', () => {
  const sheets = injectedStylesheets()
  const viewport = sheets.get('openreel/web/components/Toast.css')?.css
  const workspace = sheets.get('openreel/web/components/editor/reference-workspace.css')
  const theme = sheets.get('openreel/web/index.css')
  const mapping = sheets.get('theme/dsw-map.css')
  assert.ok(viewport && workspace && theme && mapping, 'Expected the complete set of editor styles')
  assert.match(viewport.toString(), /:where\(\.openreel-studio-root:has\(\.editor-shell\)\) \.app-toast-viewport/)
  assert.ok(mapping.offset > theme.offset && mapping.offset > workspace.offset, 'Host mappings follow vendor style injection')
  for (const [path, { css }] of sheets) {
    if (path.startsWith('openreel/')) assertIsolated(css, path)
  }
})

test('document and theme selectors retain their qualifiers inside the studio', async () => {
  const { css, root } = await postcss([scopeOpenReelCss()]).process(`
    :root, .dark, [data-theme="light"] { --fg: red; }
    html[data-theme="dark"] > body:has(.editor-shell) .notice { animation: blink 1s; }
    @media (max-width: 640px) { button, :is(input, select) { padding: 0; } }
    @keyframes blink { from { opacity: 0; } to { opacity: 1; } }
  `, { from: undefined })
  assertIsolated(root, 'selector fixture')
  assert.match(css, /:where\(\.openreel-studio-root\[data-theme="dark"\]:has\(\.editor-shell\)\) \.notice/)
  assert.match(css, /animation: omnimux-clip-blink 1s/)
  assert.doesNotMatch(css, /\bhtml\b|\bbody\b/)
})

test('the scoper refuses selectors that can target siblings of the studio', async () => {
  for (const selector of ['body ~ .host', '.openreel-studio-root + .host']) {
    await assert.rejects(
      async () => postcss([scopeOpenReelCss()]).process(`${selector} { opacity: 0; }`, { from: undefined }),
      /escapes the studio root/,
    )
  }
})
