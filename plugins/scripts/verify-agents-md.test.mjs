/**
 * scripts/verify-agents-md.test.mjs
 *
 * Gate for the always-on root instructions (AGENTS.md):
 * - size budget (lines and bytes) so the file stays a thin entrypoint;
 * - every relative Markdown link resolves to an existing path, and `#anchor`
 *   links into Markdown files match a heading;
 * - nested `plugins/<name>/AGENTS.md` files stay small and their links resolve;
 * - CLAUDE.md stays a pointer to AGENTS.md;
 * - hard bounds that must never be slimmed away keep their marker text.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const agentsPath = join(root, 'AGENTS.md')
const agents = readFileSync(agentsPath, 'utf8')

/** Raise only when new hard bounds genuinely need the space. */
const MAX_LINES = 100
const MAX_BYTES = 14_900

/** Markers for hard bounds that slimming must preserve. */
const REQUIRED_MARKERS = [
  'Product baseline',
  'No exclusive runtime modes',
  'Hub owns integration',
  'real-money transactions are human-only',
  'MUST NOT modify official DSH source',
  'Agents MUST NOT edit this section',
  // 2026-11-13: Dev acceptance moved from human-owned to the desktop Bot (governance change approved by X).
  "Dev app acceptance is the desktop Bot's",
  'Never push to `main`',
]

/**
 * GitHub-style heading slug: lowercase, drop punctuation except `-`/`_`,
 * spaces become `-`. Non-ASCII letters (e.g. CJK) are kept.
 * @param {string} heading
 * @returns {string}
 */
function slugify(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-')
}

/**
 * @param {string} markdown
 * @returns {Set<string>}
 */
function headingSlugs(markdown) {
  const slugs = new Set()
  for (const line of markdown.split('\n')) {
    const m = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line)
    if (m) slugs.add(slugify(m[1]))
  }
  return slugs
}

test('AGENTS.md stays within its always-on size budget', () => {
  const lines = agents.split('\n').length
  const bytes = Buffer.byteLength(agents, 'utf8')
  assert.ok(lines <= MAX_LINES, `AGENTS.md has ${lines} lines (max ${MAX_LINES}); move detail into contracts or skills`)
  assert.ok(bytes <= MAX_BYTES, `AGENTS.md has ${bytes} bytes (max ${MAX_BYTES}); move detail into contracts or skills`)
})

/**
 * Relative links in `markdown` (resolved against `baseDir`) whose path or
 * Markdown heading anchor does not exist.
 * @param {string} markdown
 * @param {string} baseDir
 * @returns {string[]}
 */
function brokenLinks(markdown, baseDir) {
  const failures = []
  for (const [, target] of markdown.matchAll(/\]\(([^)\s]+)\)/g)) {
    if (/^[a-z]+:/i.test(target)) continue
    const [rawPath, anchor] = target.split('#')
    const full = rawPath ? join(baseDir, decodeURIComponent(rawPath)) : null
    if (full && !existsSync(full)) {
      failures.push(`missing path: ${target}`)
      continue
    }
    if (full && anchor && rawPath.endsWith('.md') && statSync(full).isFile()) {
      const slugs = headingSlugs(readFileSync(full, 'utf8'))
      if (!slugs.has(decodeURIComponent(anchor))) failures.push(`missing anchor: ${target}`)
    }
  }
  return failures
}

/** Nested always-on files: `plugins/<name>/AGENTS.md`. */
const NESTED_MAX_LINES = 60
const nestedAgents = readdirSync(join(root, 'plugins'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join(root, 'plugins', entry.name, 'AGENTS.md')))
  .map((entry) => join(root, 'plugins', entry.name, 'AGENTS.md'))

test('AGENTS.md relative links and anchors resolve', () => {
  assert.deepEqual(brokenLinks(agents, root), [])
})

test('nested plugin AGENTS.md files stay small and their links resolve', () => {
  assert.ok(existsSync(join(root, 'plugins/omnimux/AGENTS.md')), 'the execution hub owns plugins/omnimux/AGENTS.md')
  const failures = []
  for (const file of nestedAgents) {
    const text = readFileSync(file, 'utf8')
    const rel = relative(root, file)
    const lines = text.split('\n').length
    if (lines > NESTED_MAX_LINES) failures.push(`${rel}: ${lines} lines (max ${NESTED_MAX_LINES})`)
    for (const broken of brokenLinks(text, dirname(file))) failures.push(`${rel}: ${broken}`)
  }
  assert.deepEqual(failures, [])
})

test('CLAUDE.md is a pointer to AGENTS.md', () => {
  const claude = readFileSync(join(root, 'CLAUDE.md'), 'utf8')
  assert.match(claude, /\(AGENTS\.md\)/)
  assert.ok(claude.split('\n').length <= 5, 'CLAUDE.md must stay a short pointer, not a second rule set')
})

test('AGENTS.md preserves hard-bound markers', () => {
  const missing = REQUIRED_MARKERS.filter((marker) => !agents.includes(marker))
  assert.deepEqual(missing, [], 'a hard bound was removed or renamed; update the marker only with user approval')
})

test('canvas generation rules are discoverable without local skills or task history', () => {
  const contract = 'docs/contracts/canvas-generation.md'
  const hub = 'plugins/omnimux/AGENTS.md'
  assert.ok(agents.includes(`(${contract})`), 'link the active canvas contract from plugins/AGENTS.md')
  assert.ok(readFileSync(join(root, hub), 'utf8').includes(`(../../${contract})`), 'link the same contract from the hub rules')

  const contractPath = join(root, contract)
  assert.deepEqual(brokenLinks(readFileSync(contractPath, 'utf8'), dirname(contractPath)), [])
  for (const spec of ['issue-62-input-capability', 'issue-89-muse-video-mapping']) {
    const historical = readFileSync(join(root, '..', `specs/${spec}.spec.md`), 'utf8')
    assert.ok(historical.includes(`(../plugins/${contract})`), `${spec} must point readers to the active canvas contract`)
  }
})

const repoRoot = resolve(root, '..')
const LESSONS_MAX_LINES = 200
const LESSONS_MAX_BYTES = 16_000

test('root AGENTS.md links LESSONS.md and its relative links resolve', () => {
  const rootAgents = readFileSync(join(repoRoot, 'AGENTS.md'), 'utf8')
  assert.ok(rootAgents.includes('(LESSONS.md)'), 'root AGENTS.md must link LESSONS.md so every session reads active lessons')
  assert.deepEqual(brokenLinks(rootAgents, repoRoot), [])
})

test('root CLAUDE.md stays a short pointer to AGENTS.md and LESSONS.md', () => {
  const rootClaudePath = join(repoRoot, 'CLAUDE.md')
  assert.ok(existsSync(rootClaudePath), 'root CLAUDE.md pointer must exist')
  const rootClaude = readFileSync(rootClaudePath, 'utf8')
  assert.match(rootClaude, /\(AGENTS\.md\)/)
  assert.match(rootClaude, /\(LESSONS\.md\)/)
  assert.ok(rootClaude.split('\n').length <= 10, 'root CLAUDE.md must stay a short pointer, not a second rule set')
  assert.deepEqual(brokenLinks(rootClaude, repoRoot), [])
})

test('LESSONS.md stays within its active-rules budget and its links resolve', () => {
  const lessonsPath = join(repoRoot, 'LESSONS.md')
  assert.ok(existsSync(lessonsPath), 'LESSONS.md must be tracked at repository root')
  const lessons = readFileSync(lessonsPath, 'utf8')
  const lines = lessons.split('\n').length
  const bytes = Buffer.byteLength(lessons, 'utf8')
  assert.match(lessons, /^<!--\s*reviewed-through:\s*[0-9a-f]{7,40}\s*\(\d{4}-\d{2}-\d{2}\)\s*-->/, 'LESSONS.md must start with a reviewed-through cursor comment')
  assert.ok(lines <= LESSONS_MAX_LINES, `LESSONS.md has ${lines} lines (max ${LESSONS_MAX_LINES}); graduate mechanical checks to CI gates or prune stale entries`)
  assert.ok(bytes <= LESSONS_MAX_BYTES, `LESSONS.md has ${bytes} bytes (max ${LESSONS_MAX_BYTES}); keep daily review logs in PR descriptions`)
  assert.deepEqual(brokenLinks(lessons, repoRoot), [])
})
