import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const allowlist = JSON.parse(readFileSync(join(here, '../../../scripts/dsw-token-allowlist.json'), 'utf8'))
const upstreamTokens = new Set(allowlist.source.tokens)

const TOKEN_NAME = '--dsw-[A-Za-z0-9_]+(?:-[A-Za-z0-9_]+)*'
const DEFINITION_RE = new RegExp(`(?:['"])?(${TOKEN_NAME})(?:['"])?\\s*:`, 'g')
const REFERENCE_RE = new RegExp(`var\\(\\s*(${TOKEN_NAME})`, 'g')

function cssModules(dir) {
  const files = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'lib' || entry.name === 'dist') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...cssModules(full))
      continue
    }
    if (entry.isFile() && entry.name.endsWith('.module.css')) files.push(full)
  }
  return files.sort()
}

describe('dsh-ui-kit --dsw-* token contract', () => {
  it('only references host-runtime tokens or local package definitions', () => {
    const files = cssModules(here)
    assert.ok(files.length >= 20, `expected the full CSS module set, found ${files.length}`)

    const localDefinitions = new Set()
    for (const file of files) {
      for (const match of readFileSync(file, 'utf8').matchAll(DEFINITION_RE)) localDefinitions.add(match[1])
    }

    const violations = []
    for (const file of files) {
      for (const match of readFileSync(file, 'utf8').matchAll(REFERENCE_RE)) {
        const token = match[1]
        if (!upstreamTokens.has(token) && !localDefinitions.has(token)) {
          violations.push(`${relative(here, file).split('\\').join('/')}: var(${token})`)
        }
      }
    }
    assert.deepEqual(violations, [], `undefined --dsw-* tokens in dsh-ui-kit:\n${violations.join('\n')}`)
  })

  it('keeps the semantic status mapping on real official tokens', () => {
    const badge = readFileSync(join(here, 'badge/Badge.module.css'), 'utf8')
    assert.match(badge, /\.brand\s*\{[^}]*var\(--dsw-alias-interactive-bg-active\)/s)
    assert.match(badge, /\.success\s*\{[^}]*var\(--dsw-alias-state-success-tertiary\)/s)
    assert.match(badge, /\.warning\s*\{[^}]*var\(--dsw-alias-state-warn-tertiary\)/s)
    assert.match(badge, /\.warning\s*\{[^}]*var\(--dsw-alias-state-warn-label\)/s)
    assert.match(badge, /\.error\s*\{[^}]*var\(--dsw-alias-interactive-bg-hover-danger\)/s)
    assert.match(badge, /\.info\s*\{[^}]*var\(--dsw-alias-state-business-tertiary\)/s)
    assert.match(badge, /\.info\s*\{[^}]*var\(--dsw-alias-state-business-primary\)/s)

    for (const file of ['card/MediaCard.module.css', 'table/Table.module.css', 'tile/SelectableTile.module.css']) {
      assert.match(readFileSync(join(here, file), 'utf8'), /var\(--dsw-alias-interactive-bg-active\)/)
    }
    assert.match(readFileSync(join(here, 'stat/StatBar.module.css'), 'utf8'), /var\(--dsw-alias-state-success-primary\)/)
  })
})
