#!/usr/bin/env node
/**
 * scripts/verify-archived-agent-notes.mjs
 *
 * Verify and append-seal the frozen Agent Note archive with SHA-256 signatures.
 * Usage:
 *   node scripts/verify-archived-agent-notes.mjs [--write]
 */

import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve, join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AGENT_NOTE_CLASSES, getAgentNoteRoot } from './lib/agent-note-tree.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')

const args = process.argv.slice(2)
const writeMode = args.includes('--write')

const noteRoot = getAgentNoteRoot(repoRoot)
const archiveRoot = join(noteRoot, 'archived')
const manifestPath = join(archiveRoot, 'manifest.json')

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

if (!existsSync(archiveRoot)) {
  console.log('ℹ️  No archived directory found, skipping archive verification.')
  process.exit(0)
}

let manifest = { version: 1, files: {} }
if (existsSync(manifestPath)) {
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (err) {
    console.error(`❌ archived/manifest.json is invalid JSON: ${err.message}`)
    process.exit(1)
  }
}

const errors = []
const currentArtifacts = {}

for (const cls of AGENT_NOTE_CLASSES) {
  const clsDir = join(archiveRoot, cls)
  if (!existsSync(clsDir)) continue

  for (const entry of readdirSync(clsDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue
    const rel = `${cls}/${entry.name}`
    const buffer = readFileSync(join(clsDir, entry.name))
    const hash = `sha256:${sha256(buffer)}`
    currentArtifacts[rel] = hash

    // Check if previously sealed in manifest
    if (manifest.files[rel] && manifest.files[rel] !== hash) {
      errors.push(`tamper detected: ${rel} has changed from sealed hash (sealed: ${manifest.files[rel]}, current: ${hash})`)
    }
  }
}

// Check for deleted sealed files
for (const sealedRel of Object.keys(manifest.files)) {
  if (!currentArtifacts[sealedRel]) {
    errors.push(`tamper detected: sealed artifact ${sealedRel} was deleted from archive`)
  }
}

// Handle unsealed files
const unsealed = []
for (const [rel, hash] of Object.entries(currentArtifacts)) {
  if (!manifest.files[rel]) {
    unsealed.push({ rel, hash })
    if (!writeMode) {
      errors.push(`unsealed artifact: ${rel} is not sealed in manifest.json (run with --write to seal)`)
    }
  }
}

if (writeMode) {
  if (errors.length > 0) {
    console.error('❌ Cannot update manifest due to tampering errors:')
    for (const e of errors) console.error(`  - ${e}`)
    process.exit(1)
  }

  for (const u of unsealed) {
    manifest.files[u.rel] = u.hash
  }

  // Sort keys for deterministic manifest formatting
  const sortedFiles = {}
  for (const k of Object.keys(manifest.files).sort()) {
    sortedFiles[k] = manifest.files[k]
  }
  manifest.files = sortedFiles

  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
  console.log(`✅ verify-archived-agent-notes: Sealed ${unsealed.length} new artifact(s) in manifest.json.`)
  process.exit(0)
}

if (errors.length === 0) {
  const count = Object.keys(currentArtifacts).length
  console.log(`✅ verify-archived-agent-notes: ${count} archived note artifact(s) checked, manifest seal intact.`)
  process.exit(0)
}

console.error('❌ verify-archived-agent-notes: violations found:')
for (const e of errors) console.error(`  - ${e}`)
process.exit(1)
