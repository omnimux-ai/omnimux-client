import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  DSH_UI_KIT,
  REPO_ROOT,
  UI_THEME_STYLE_FILES,
  checkBaseline,
  collectUndefinedUsage,
  extractTokenDefinitions,
  extractTokenReferences,
  stripComments,
  verifyDswTokens,
  writeAllowlist,
  writeBaseline,
} from './verify-dsw-tokens.mjs'

const scriptDir = dirname(fileURLToPath(import.meta.url))

/**
 * Build a minimal repo-shaped fixture: PROVENANCE pin, the 8 ui-theme runtime
 * stylesheets, and one demo plugin whose CSS the test controls.
 */
function createFixture({ upstream = { 'design-platform.css': ['--dsw-alias-bg-base'] }, plugins = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'dsw-tokens-'))
  const stylesDir = join(root, 'app/deepseek-harness/packages/client/ui-theme/src/styles')
  mkdirSync(stylesDir, { recursive: true })
  writeFileSync(join(root, 'PROVENANCE.json'), JSON.stringify({
    sources: { app: { submodules: { 'app/deepseek-harness': 'a'.repeat(40) } } },
  }))
  for (const file of UI_THEME_STYLE_FILES) {
    const tokens = upstream[file] || []
    writeFileSync(join(stylesDir, file), `body {\n${tokens.map((token) => `  ${token}: red;`).join('\n')}\n}\n`)
  }
  mkdirSync(join(root, 'plugins/scripts'), { recursive: true })
  for (const [pkg, files] of Object.entries(plugins)) {
    const srcDir = join(root, pkg, 'src')
    mkdirSync(srcDir, { recursive: true })
    for (const [name, content] of Object.entries(files)) {
      const dest = join(srcDir, name)
      mkdirSync(dirname(dest), { recursive: true })
      writeFileSync(dest, content)
    }
  }
  const allowlistPath = join(root, 'allowlist.json')
  const baselinePath = join(root, 'baseline.json')
  writeAllowlist({ repoRoot: root, allowlistPath })
  return { root, allowlistPath, baselinePath }
}

function writeBaselineFor(fixture) {
  return writeBaseline({ repoRoot: fixture.root, allowlistPath: fixture.allowlistPath, baselinePath: fixture.baselinePath })
}

function cleanup(fixture) {
  rmSync(fixture.root, { recursive: true, force: true })
}

test('extracts definitions and references, including fallbacks and malformed prose names', () => {
  const css = `
    body { --dsw-alias-bg-base: #fff; --dsw-radius-sm: 8px; }
    /* prose mentioning --dsw-alias- is not a token */
    .x { background: var(--dsw-alias-bg-base); color: var(--dsw-missing, #123456); }
  `
  assert.deepEqual([...extractTokenDefinitions(css)].sort(), ['--dsw-alias-bg-base', '--dsw-radius-sm'])
  const refs = extractTokenReferences(css)
  assert.deepEqual(refs, [
    { token: '--dsw-alias-bg-base', hasFallback: false },
    { token: '--dsw-missing', hasFallback: true },
  ])
})

test('accepts legal upstream tokens from every runtime stylesheet and local definitions', () => {
  const fixture = createFixture({
    upstream: {
      'base.css': ['--dsw-radius-sm', '--dsw-font-mono'],
      'design-platform.css': ['--dsw-alias-bg-base', '--dsw-alias-label-primary'],
      'gradient-shadow-text.css': ['--dsw-elevation-prominent'],
    },
    plugins: {
      'plugins/plugins/demo': {
        'a.css': '.ok { border-radius: var(--dsw-radius-sm); box-shadow: var(--dsw-elevation-prominent); color: var(--dsw-alias-label-primary); font-family: var(--dsw-font-mono); }',
        'b.css': '.local { --dsw-demo-local: red; background: var(--dsw-demo-local); }',
      },
    },
  })
  try {
    writeBaselineFor(fixture)
    const result = verifyDswTokens({ repoRoot: fixture.root, allowlistPath: fixture.allowlistPath, baselinePath: fixture.baselinePath })
    assert.deepEqual(result.issues, [])
    assert.equal(result.summary.uiKitUndefined, 0)
  } finally {
    cleanup(fixture)
  }
})

const CLEAN_CSS = '.x { color: var(--dsw-alias-bg-base); }'
const OLD_CSS = '.a { color: var(--dsw-alias-old); }'

function demoFixture(css) {
  return createFixture({ plugins: { 'plugins/plugins/demo': { 'a.css': css } } })
}

function writeDemoCss(fixture, css) {
  writeFileSync(join(fixture.root, 'plugins/plugins/demo/src/a.css'), css)
}

function verifyFixture(fixture) {
  return verifyDswTokens({ repoRoot: fixture.root, allowlistPath: fixture.allowlistPath, baselinePath: fixture.baselinePath })
}

test('fails on a new bare undefined token', () => {
  const fixture = demoFixture(CLEAN_CSS)
  try {
    writeBaselineFor(fixture)
    writeDemoCss(fixture, '.x { color: var(--dsw-alias-made-up); }')
    const result = verifyFixture(fixture)
    assert.equal(result.issues.length, 1)
    assert.equal(result.issues[0].code, 'undefined-token')
    assert.match(result.issues[0].message, /--dsw-alias-made-up/)
  } finally {
    cleanup(fixture)
  }
})

test('fails on a new undefined token even when it carries a fallback', () => {
  const fixture = demoFixture(CLEAN_CSS)
  try {
    writeBaselineFor(fixture)
    writeDemoCss(fixture, '.x { color: var(--dsw-alias-made-up, #fff); }')
    const result = verifyFixture(fixture)
    assert.equal(result.issues.length, 1)
    assert.equal(result.issues[0].code, 'undefined-token')
  } finally {
    cleanup(fixture)
  }
})

test('fails when the count exceeds the baseline', () => {
  const fixture = demoFixture(OLD_CSS)
  try {
    writeBaselineFor(fixture)
    writeDemoCss(fixture, '.a { color: var(--dsw-alias-old); }\n.b { color: var(--dsw-alias-old); }')
    const result = verifyFixture(fixture)
    assert.ok(result.issues.some((issue) => issue.code === 'baseline-exceeded'))
  } finally {
    cleanup(fixture)
  }
})

test('fails when a file introduces a token outside its baseline token list', () => {
  const fixture = demoFixture(OLD_CSS)
  try {
    writeBaselineFor(fixture)
    writeDemoCss(fixture, '.a { color: var(--dsw-alias-old); }\n.b { color: var(--dsw-alias-new); }')
    const result = verifyFixture(fixture)
    assert.ok(result.issues.some((issue) => issue.code === 'undefined-token' && /--dsw-alias-new/.test(issue.message)))
  } finally {
    cleanup(fixture)
  }
})

test('passes and reports shrink when the actual count is below the baseline', () => {
  const fixture = demoFixture(OLD_CSS)
  try {
    writeBaselineFor(fixture)
    const baseline = JSON.parse(readFileSync(fixture.baselinePath, 'utf8'))
    baseline.entries['plugins/plugins/demo']['src/a.css'].count = 7
    writeFileSync(fixture.baselinePath, JSON.stringify(baseline))
    const result = verifyFixture(fixture)
    assert.deepEqual(result.issues, [])
    assert.equal(result.summary.shrunk.length, 1)
  } finally {
    cleanup(fixture)
  }
})

test('locks dsh-ui-kit to zero regardless of baseline', () => {
  const fixture = createFixture({ plugins: { [DSH_UI_KIT]: { 'badge.css': '.x { background: var(--dsw-alias-brand-secondary); }' } } })
  try {
    writeBaselineFor(fixture)
    const result = verifyDswTokens({ repoRoot: fixture.root, allowlistPath: fixture.allowlistPath, baselinePath: fixture.baselinePath })
    assert.ok(result.issues.some((issue) => issue.code === 'ui-kit-undefined-token'))
    const baseline = JSON.parse(readFileSync(fixture.baselinePath, 'utf8'))
    baseline.entries[DSH_UI_KIT] = { 'badge.css': { count: 1, tokens: ['--dsw-alias-brand-secondary'] } }
    writeFileSync(fixture.baselinePath, JSON.stringify(baseline))
    const withEntry = verifyDswTokens({ repoRoot: fixture.root, allowlistPath: fixture.allowlistPath, baselinePath: fixture.baselinePath })
    assert.ok(withEntry.issues.some((issue) => issue.code === 'ui-kit-baseline-entry'))
  } finally {
    cleanup(fixture)
  }
})

test('fails when PROVENANCE pin and allowlist harnessCommit drift apart', () => {
  const fixture = createFixture({ plugins: { 'plugins/plugins/demo': { 'a.css': '.x { color: var(--dsw-alias-bg-base); }' } } })
  try {
    writeBaselineFor(fixture)
    const provenance = JSON.parse(readFileSync(join(fixture.root, 'PROVENANCE.json'), 'utf8'))
    provenance.sources.app.submodules['app/deepseek-harness'] = 'b'.repeat(40)
    writeFileSync(join(fixture.root, 'PROVENANCE.json'), JSON.stringify(provenance))
    const result = verifyDswTokens({ repoRoot: fixture.root, allowlistPath: fixture.allowlistPath, baselinePath: fixture.baselinePath })
    assert.ok(result.issues.some((issue) => issue.code === 'allowlist-pin-stale'))
  } finally {
    cleanup(fixture)
  }
})

test('fails when the checked-out theme tokens and the allowlist snapshot drift apart', () => {
  const fixture = createFixture({ plugins: { 'plugins/plugins/demo': { 'a.css': '.x { color: var(--dsw-alias-bg-base); }' } } })
  try {
    writeBaselineFor(fixture)
    const stylesFile = join(fixture.root, 'app/deepseek-harness/packages/client/ui-theme/src/styles/design-platform.css')
    writeFileSync(stylesFile, 'body { --dsw-alias-bg-base: #fff; --dsw-alias-brand-new: #000; }')
    const result = verifyDswTokens({ repoRoot: fixture.root, allowlistPath: fixture.allowlistPath, baselinePath: fixture.baselinePath })
    assert.ok(result.issues.some((issue) => issue.code === 'allowlist-stale'))
  } finally {
    cleanup(fixture)
  }
})

test('checkBaseline reports no issue when actual equals baseline', () => {
  const usage = { 'plugins/plugins/demo': { 'a.css': { count: 1, tokens: ['--dsw-alias-old'], bare: 1, fallback: 0 } } }
  const baseline = { version: 1, entries: { 'plugins/plugins/demo': { 'a.css': { count: 1, tokens: ['--dsw-alias-old'] } } } }
  assert.deepEqual(checkBaseline({ usage, baseline }).issues, [])
})

test('collectUndefinedUsage ignores tests, fixtures, built output and vendor directories', () => {
  const fixture = createFixture({
    plugins: {
      'plugins/plugins/demo': {
        'ok.css': '.x { color: var(--dsw-alias-bg-base); }',
        'bad.test.js': 'const css = "var(--dsw-alias-nope)"',
        'fixtures/fixture.css': '.x { color: var(--dsw-alias-nope); }',
        'lib/built.css': '.x { color: var(--dsw-alias-nope); }',
      },
    },
  })
  try {
    const allowlist = JSON.parse(readFileSync(fixture.allowlistPath, 'utf8'))
    const usage = collectUndefinedUsage({ repoRoot: fixture.root, allowlistTokens: allowlist.source.tokens })
    assert.deepEqual(usage, {})
  } finally {
    cleanup(fixture)
  }
})

test('CSS block comments cannot smuggle local token definitions', () => {
  const fixture = demoFixture(CLEAN_CSS)
  try {
    writeBaselineFor(fixture)
    writeDemoCss(fixture, '/* --dsw-fake-local: 1 */\n.fake { color: var(--dsw-fake-local); }')
    const result = verifyFixture(fixture)
    assert.ok(result.issues.some((issue) => issue.code === 'undefined-token' && /--dsw-fake-local/.test(issue.message)))
  } finally {
    cleanup(fixture)
  }
})

test('CSS block comments, JS line comments and JSDoc never create references or definitions', () => {
  const css = '/* var(--dsw-not-real) and var(--dsw-alias-*, #fff) */\n/* --dsw-fake-local: 1 */\n.x { color: var(--dsw-alias-bg-base); }'
  assert.deepEqual(extractTokenReferences(css, 'x.css'), [{ token: '--dsw-alias-bg-base', hasFallback: false }])
  assert.deepEqual([...extractTokenDefinitions(css, 'x.css')], [])

  const js = "// var(--dsw-not-real)\n/** JSDoc var(--dsw-not-real) and var(--dsw-alias-*, #fff) */\nconst x = 'var(--dsw-alias-bg-base)'\n"
  assert.deepEqual(extractTokenReferences(js, 'x.js'), [{ token: '--dsw-alias-bg-base', hasFallback: false }])
  assert.deepEqual([...extractTokenDefinitions(js, 'x.js')], [])
  assert.equal(stripComments(js, 'x.js').split('\n').length, js.split('\n').length)
})

test('CSS-in-JS template literals strip embedded CSS block comments', () => {
  const template = 'const STYLES = `\n/* --dsw-fake-local: 1 */\n/* var(--dsw-not-real) */\n.x { color: var(--dsw-alias-bg-base); }\n`\n'
  assert.deepEqual(extractTokenReferences(template, 'x.js'), [{ token: '--dsw-alias-bg-base', hasFallback: false }])
  assert.deepEqual([...extractTokenDefinitions(template, 'x.js')], [])

  const fixture = demoFixture(CLEAN_CSS)
  try {
    writeBaselineFor(fixture)
    writeFileSync(
      join(fixture.root, 'plugins/plugins/demo/src/b.js'),
      'export const STYLES = `\n/* --dsw-fake-local: 1 */\n.fake { color: var(--dsw-fake-local); }\n`\n',
    )
    const result = verifyFixture(fixture)
    assert.ok(result.issues.some((issue) => issue.code === 'undefined-token' && /--dsw-fake-local/.test(issue.message)))
  } finally {
    cleanup(fixture)
  }
})

test('prose var(--dsw-alias-*, ...) is not prefix-truncated into a token reference', () => {
  assert.deepEqual(extractTokenReferences('/* var(--dsw-alias-*, #fff) */', 'x.css'), [])
  assert.deepEqual(extractTokenReferences('.x { color: var(--dsw-alias-*, #fff); }', 'x.css'), [])
  assert.deepEqual(extractTokenReferences('/* var(--dsw-platform-*, #hex) */', 'x.css'), [])
})

test('https:// in CSS urls and JS strings does not swallow same-line token references', () => {
  const css = '.hero { background: url(https://example.com/a.png); color: var(--dsw-not-real); }'
  assert.deepEqual(extractTokenReferences(css, 'x.css'), [{ token: '--dsw-not-real', hasFallback: false }])

  const js = "const u = 'https://example.com/a.png'; const css = 'color: var(--dsw-not-real)'\n"
  assert.deepEqual(extractTokenReferences(js, 'x.js'), [{ token: '--dsw-not-real', hasFallback: false }])

  const template = 'const css = `background: url(https://example.com/a.png); color: var(--dsw-not-real);`\n'
  assert.deepEqual(extractTokenReferences(template, 'x.js'), [{ token: '--dsw-not-real', hasFallback: false }])
})

test('unterminated /* in a template literal does not swallow following code', () => {
  const source = 'const label = `${slot.type}/*`\nconst bad = \'var(--dsw-made-up-after-mime)\'\n'
  assert.deepEqual(extractTokenReferences(source, 'x.jsx'), [{ token: '--dsw-made-up-after-mime', hasFallback: false }])
  assert.match(stripComments(source, 'x.jsx'), /var\(--dsw-made-up-after-mime\)/)
})

test('CSS quotes and apostrophes inside template literals do not break comment handling', () => {
  const quoteSource = [
    'const STYLES = `',
    '.x::before { content: "/*"; }',
    '.bad { color: var(--dsw-made-up-after-quote); }',
    '`',
  ].join('\n')
  assert.deepEqual(extractTokenReferences(quoteSource, 'x.jsx'), [{ token: '--dsw-made-up-after-quote', hasFallback: false }])

  const apostropheSource = [
    "const STYLES = `don't",
    '/* --dsw-fake: 1 */',
    '.bad { color: var(--dsw-fake); }',
    '`',
  ].join('\n')
  assert.deepEqual([...extractTokenDefinitions(apostropheSource, 'x.jsx')], [])
  assert.deepEqual(extractTokenReferences(apostropheSource, 'x.jsx'), [{ token: '--dsw-fake', hasFallback: false }])
})

test('JS regex literals are preserved and following undefined tokens are captured', () => {
  const cases = [
    ["const re = /^https?:\\/\\//i; const bad = 'var(--dsw-made-up-after-regex)'", '--dsw-made-up-after-regex'],
    ["const x = y.replace(/\\//g, '.'); const bad = 'var(--dsw-made-up-after-replace)'", '--dsw-made-up-after-replace'],
    ['const re = /[^/*]+/; const bad = "var(--dsw-made-up-after-charclass)"', '--dsw-made-up-after-charclass'],
  ]
  for (const [source, token] of cases) {
    assert.deepEqual(extractTokenReferences(source, 'x.js'), [{ token, hasFallback: false }])
  }
  assert.match(stripComments(cases[0][0], 'x.js'), /\/\^https\?:\\\/\\\/\/i/)
})

test('control-flow, division and JSX boundaries are classified correctly', () => {
  const control = "if (ok) /[^/*]+/.test(s); const bad = 'var(--dsw-made-up)'"
  assert.deepEqual(extractTokenReferences(control, 'x.js'), [{ token: '--dsw-made-up', hasFallback: false }])

  const returned = "return /* note */ /[^/*]+/; const bad = 'var(--dsw-made-up-after-return)'"
  assert.deepEqual(extractTokenReferences(returned, 'x.js'), [{ token: '--dsw-made-up-after-return', hasFallback: false }])

  const division = "(a + b) / c // var(--dsw-commented) / end\nconst bad = 'var(--dsw-made-up-after-division)'"
  assert.deepEqual(extractTokenReferences(division, 'x.js'), [{ token: '--dsw-made-up-after-division', hasFallback: false }])
  assert.doesNotMatch(stripComments(division, 'x.js'), /--dsw-commented/)

  const jsx = '<span>{a}</span><span>{/* --dsw-fake: 1 */}</span>'
  assert.deepEqual([...extractTokenDefinitions(jsx, 'x.jsx')], [])
  assert.deepEqual(extractTokenReferences(jsx, 'x.jsx'), [])
})

test('the real files hit by the previous regex/template over-strip keep their code', () => {
  const cases = [
    ['plugins/plugins/omnimux-viewer/src/media-viewer/MediaSlotGroup.jsx', /accept=\{slot\.allowedMimes\.length > 0.*`\$\{slot\.type\}\/\*`\}/s],
    ['plugins/plugins/omnimux/src/client/ProfileSection.jsx', /\/\^https\?:\\\/\\\/\//],
    ['plugins/plugins/omnimux-workflow/src/client/projects/ProjectAssetsTab.jsx', /\.replace\(\/\\\/\/g, '\.'\)/],
  ]
  for (const [file, pattern] of cases) {
    const source = readFileSync(join(REPO_ROOT, file), 'utf8')
    const stripped = stripComments(source, file)
    assert.equal(stripped.split('\n').length, source.split('\n').length)
    assert.match(stripped, pattern)
  }
})

test('the real repository state passes the gate', () => {
  const result = verifyDswTokens({ repoRoot: REPO_ROOT, allowlistPath: join(scriptDir, 'dsw-token-allowlist.json'), baselinePath: join(scriptDir, 'dsw-token-baseline.json') })
  assert.deepEqual(result.issues, [])
  assert.equal(result.summary.uiKitUndefined, 0)
})
