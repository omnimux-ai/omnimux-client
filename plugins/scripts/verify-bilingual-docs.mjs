#!/usr/bin/env node
/**
 * scripts/verify-bilingual-docs.mjs
 *
 * Enforce bilingual consistency using Git Blob SHA-1 hashes recorded in *.i18n.yaml sidecars.
 * Usage:
 *   node scripts/verify-bilingual-docs.mjs [--write]
 */

import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { resolve, join, dirname, relative, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')

const args = process.argv.slice(2)
const writeMode = args.includes('--write')

export function gitBlobHash(contentBuffer) {
  const hash = createHash('sha1')
  hash.update(`blob ${contentBuffer.byteLength}\0`)
  hash.update(contentBuffer)
  return hash.digest('hex')
}

function findI18nRecords(dir) {
  const records = []
  if (!existsSync(dir)) return records

  function walk(current) {
    const entries = readdirSync(current, { withFileTypes: true })
    for (const entry of entries) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        if (['node_modules', '.git', 'dist', '.workbuddy', 'lib'].includes(entry.name)) continue
        walk(full)
      } else if (entry.isFile() && entry.name.endsWith('.i18n.yaml')) {
        records.push(full)
      }
    }
  }
  walk(dir)
  return records
}

function parseI18nRecord(content) {
  const entries = {}
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const match = /^([^:]+):\s*([0-9a-f]{40})$/i.exec(trimmed)
    if (match) {
      entries[match[1].trim()] = match[2].toLowerCase()
    }
  }
  return entries
}

function main() {
const sidecarPaths = findI18nRecords(repoRoot)
let checkedTriplets = 0
const errors = []

// Check existing .i18n.yaml files
for (const sidecarPath of sidecarPaths) {
  const sidecarDir = dirname(sidecarPath)
  const relSidecar = relative(repoRoot, sidecarPath)
  const content = readFileSync(sidecarPath, 'utf8')
  const record = parseI18nRecord(content)

  const keys = Object.keys(record)
  if (keys.length !== 2 && !writeMode) {
    errors.push(`${relSidecar}: must contain exactly 2 file records (got ${keys.length})`)
    continue
  }

  const updatedRecord = {}
  let isMismatch = false

  for (const [filename, expectedHash] of Object.entries(record)) {
    const docPath = join(sidecarDir, filename)
    if (!existsSync(docPath)) {
      errors.push(`${relSidecar}: referenced file ${filename} does not exist`)
      continue
    }

    const docBuffer = readFileSync(docPath)
    const actualHash = gitBlobHash(docBuffer)
    updatedRecord[filename] = actualHash

    if (actualHash !== expectedHash) {
      isMismatch = true
      errors.push(`${relSidecar}: stale hash for ${filename} (expected: ${expectedHash}, actual: ${actualHash})`)
    }
  }

  if (writeMode && isMismatch) {
    let newYaml = '# Bilingual-pair consistency record\n'
    for (const [fn, hash] of Object.entries(updatedRecord)) {
      newYaml += `${fn}: ${hash}\n`
    }
    writeFileSync(sidecarPath, newYaml, 'utf8')
    console.log(`📝 Updated sidecar: ${relSidecar}`)
  }

  checkedTriplets++
}

// Auto-generate missing .i18n.yaml if in --write mode or report missing in check mode
function scanMissingSidecars(dir) {
  const missing = []
  function walk(current) {
    const entries = readdirSync(current, { withFileTypes: true })
    const files = new Set(entries.filter(e => e.isFile()).map(e => e.name))
    for (const entry of entries) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        if (['node_modules', '.git', 'dist', '.workbuddy', 'lib'].includes(entry.name)) continue
        walk(full)
      } else if (entry.isFile() && entry.name.endsWith('.zh.md')) {
        const baseName = entry.name.replace(/\.zh\.md$/, '')
        const enName = `${baseName}.md`
        const sidecarName = `${baseName}.i18n.yaml`

        if (files.has(enName) && !files.has(sidecarName)) {
          missing.push({ dir: current, enName, zhName: entry.name, sidecarName })
        }
      }
    }
  }
  walk(dir)
  return missing
}

const missingSidecars = scanMissingSidecars(repoRoot)
for (const m of missingSidecars) {
  const sidecarPath = join(m.dir, m.sidecarName)
  const relSidecar = relative(repoRoot, sidecarPath)
  if (writeMode) {
    const enBuf = readFileSync(join(m.dir, m.enName))
    const zhBuf = readFileSync(join(m.dir, m.zhName))
    const enHash = gitBlobHash(enBuf)
    const zhHash = gitBlobHash(zhBuf)
    const newYaml = `# Bilingual-pair consistency record\n${m.enName}: ${enHash}\n${m.zhName}: ${zhHash}\n`
    writeFileSync(sidecarPath, newYaml, 'utf8')
    console.log(`✨ Generated new sidecar: ${relSidecar}`)
  } else {
    errors.push(`missing sidecar record: ${relSidecar} for ${m.enName} and ${m.zhName}`)
  }
}

if (writeMode) {
  console.log('✅ verify-bilingual-docs: All sidecar records updated successfully.')
  process.exit(0)
}

if (errors.length === 0) {
  console.log(`✅ verify-bilingual-docs: ${checkedTriplets} bilingual pair(s) verified with cryptographic Git Blob consistency.`)
  process.exit(0)
}

console.error('❌ verify-bilingual-docs: violations found:')
for (const e of errors) {
  console.error(`  - ${e}`)
}
console.error('\n👉 Tip: Run `node scripts/verify-bilingual-docs.mjs --write` to update hashes if document edits are intentional.')
process.exit(1)
}

const isMain = Boolean(process.argv[1]) && import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href
if (isMain) main()
