#!/usr/bin/env node
/**
 * scripts/verify-agent-note-format.mjs
 *
 * Enforce Agent Note in-file header, lifecycle sections, alternatives considered,
 * and banned proposal-era spec headings in implemented notes.
 */

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { walkAgentNoteTree, getAgentNoteRoot } from './lib/agent-note-tree.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')

const STATUS = {
  proposed: /^Status: proposed$/,
  implemented: /^Status: implemented$/,
  rejected: /^Status: rejected — .+$/,
}

const REQUIRED = {
  proposed: ['## Problem', '## Proposal', '## Alternatives considered', '## Acceptance criteria', '## Risks'],
  implemented: ['## Problem', '## Decision', '## Alternatives considered', '## Consequences'],
  rejected: ['## Problem', '## Proposal', '## Alternatives considered'],
}

const BANNED_IMPLEMENTED = /^## (?:Proposal\b|Plan\b|Migration plan\b|Acceptance criteria\b)/i
const GRANDFATHER = '<!-- agent-note-format: alternatives-not-recorded (pre-format Agent Note) -->'
const FORMAT_ADOPTED = '2026-07-05'

const { notes, errors } = walkAgentNoteTree(repoRoot)
const noteRoot = getAgentNoteRoot(repoRoot)

for (const note of notes) {
  const fail = (msg) => errors.push(`format: ${note.rel} — ${msg}`)
  const lines = readFileSync(note.fullPath, 'utf8').split('\n')

  let inFence = false
  const prose = lines.filter((l) => {
    if (l.startsWith('```')) {
      inFence = !inFence
      return false
    }
    return !inFence
  })

  // 1. Header Block Contract
  if (!/^# Agent Note: \S/.test(lines[0] || '')) fail('Line 1 must start with `# Agent Note: <title>`')
  if (lines[1] !== '') fail('Line 2 must be blank')
  const statusPattern = STATUS[note.lifecycle]
  if (statusPattern && !statusPattern.test(lines[2] || '')) {
    fail(`Line 3 must match ${note.lifecycle} status grammar (${statusPattern})`)
  }
  if (lines[3] !== '') fail('Line 4 must be blank')

  const extraStatus = prose.filter(l => l.startsWith('Status:') && l !== lines[2])
  if (extraStatus.length > 0) fail('Line 3 `Status:` must be the only status header in the file')

  // 2. Sections grammar
  const h2s = prose.filter(l => l.startsWith('## ')).map(l => l.trim())
  if (h2s[0] !== '## Problem') fail(`First section must be \`## Problem\` (got ${JSON.stringify(h2s[0] || '<none>')})`)

  for (const req of REQUIRED[note.lifecycle] || []) {
    if (!h2s.includes(req)) fail(`Missing required section \`${req}\``)
  }

  if (note.lifecycle === 'implemented') {
    for (const h2 of h2s.filter(h => BANNED_IMPLEMENTED.test(h))) {
      fail(`\`${h2}\` is a proposal-era heading; implemented notes must use present-tense facts (Decision / Consequences / Verification)`)
    }
  }

  // 3. Alternatives Considered
  const hasAlternatives = h2s.includes('## Alternatives considered')
  const hasGrandfather = prose.includes(GRANDFATHER)
  if (hasAlternatives && hasGrandfather) fail('Carries both `## Alternatives considered` and grandfather comment')
  if (!hasAlternatives && !hasGrandfather) fail('Missing `## Alternatives considered` section')
  if (hasGrandfather && note.date >= FORMAT_ADOPTED) fail(`Grandfather comment is only valid before ${FORMAT_ADOPTED}`)
}

if (errors.length === 0) {
  console.log(`✅ verify-agent-note-format: ${notes.length} Agent Note(s) checked, 100% compliant.`)
  process.exit(0)
}

console.error('❌ verify-agent-note-format: violations found:')
for (const e of errors) {
  console.error(`  - ${e}`)
}
process.exit(1)
