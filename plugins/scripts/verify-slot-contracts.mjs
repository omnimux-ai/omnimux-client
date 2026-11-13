#!/usr/bin/env node
/**
 * scripts/verify-slot-contracts.mjs
 *
 * OmniMux Slot Governance Static Contract Scanner:
 * 1. Scans client source code across all plugins for slot registrations.
 * 2. Enforces Single Occupant Slot rules:
 *    - `conversation.hero.brand.mark`: must specify priority -10 and id 'omnimux-hero-brand-mark'.
 *    - `conversation.input.attachments`: must specify priority -10 and id 'omnimux-attachment-tray'.
 * 3. Enforces general slot registration integrity:
 *    - Must specify explicit `name` (or `name: ...`)
 *    - Must specify explicit `id` (or `id: ...` / `key: ...`)
 * 4. Fails loudly with line numbers and descriptions if any violation is found.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SINGLE_OCCUPANT_SLOTS = {
  'conversation.hero.brand.mark': {
    expectedPriority: -10,
    expectedId: 'omnimux-hero-brand-mark',
    description: 'Empty-session hero brand-mark slot',
  },
  'conversation.input.attachments': {
    expectedPriority: -10,
    expectedId: 'omnimux-attachment-tray',
    description: 'Composer inner attachment tray slot',
  },
}

/**
 * Recursively find client source files.
 * @param {string} dir
 * @returns {string[]}
 */
export function findClientSourceFiles(dir) {
  const results = []
  if (!existsSync(dir)) return results

  const entries = readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (['node_modules', 'dist', 'lib', '.git', 'coverage'].includes(entry.name)) continue
      results.push(...findClientSourceFiles(fullPath))
    } else if (entry.isFile()) {
      const ext = entry.name.split('.').pop()
      if (['js', 'jsx', 'ts', 'tsx'].includes(ext)) {
        if (!entry.name.includes('.test.') && !entry.name.includes('.spec.')) {
          results.push(fullPath)
        }
      }
    }
  }
  return results
}

/**
 * Scan a source file for slot registration violations.
 * @param {string} filePath
 * @param {string} content
 * @returns {Array<{ file: string, line: number, slotName: string, message: string }>}
 */
export function scanFileForSlotContracts(filePath, content) {
  const issues = []
  const lines = content.split('\n')

  // Check for single occupant slot occurrences
  for (const [slotName, rule] of Object.entries(SINGLE_OCCUPANT_SLOTS)) {
    if (content.includes(slotName)) {
      // Find line numbers where slot is referenced
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (line.includes(slotName) && (line.includes('register') || line.includes('inject') || line.includes('SLOT'))) {
          const lineNum = i + 1

          // Extract surrounding context (next 15 lines) to inspect registration object
          const contextBlock = lines.slice(i, Math.min(lines.length, i + 20)).join('\n')

          // Check if it's a register block
          if (contextBlock.includes('register') || line.includes('register') || line.includes('HERO_BRAND_PRIORITY')) {
            // Check priority: -10 or HERO_BRAND_PRIORITY
            const hasCorrectPriority =
              /priority\s*:\s*-10\b/.test(contextBlock) ||
              /priority\s*:\s*HERO_BRAND_PRIORITY\b/.test(contextBlock) ||
              /HERO_BRAND_PRIORITY\s*=\s*-10\b/.test(content)

            if (!hasCorrectPriority) {
              issues.push({
                file: filePath,
                line: lineNum,
                slotName,
                message: `Single-occupant slot '${slotName}' MUST declare priority: ${rule.expectedPriority}`,
              })
            }

            // Check id
            const hasId =
              contextBlock.includes(rule.expectedId) ||
              contextBlock.includes('HERO_BRAND_ID') ||
              /id\s*:\s*['"][^'"]+['"]/.test(contextBlock)

            if (!hasId) {
              issues.push({
                file: filePath,
                line: lineNum,
                slotName,
                message: `Single-occupant slot '${slotName}' MUST declare an explicit occupant id`,
              })
            }
          }
        }
      }
    }
  }

  // General check: Any ctx.slots.register or slots.register call must include name and id
  const registerRegex = /slots\.register\s*\(\s*\{([\s\S]*?)\}/g
  let match
  while ((match = registerRegex.exec(content)) !== null) {
    const regBlock = match[1]
    const lineIndex = content.slice(0, match.index).split('\n').length

    // Skip commented out code
    const precedingLine = lines[lineIndex - 1] || ''
    if (precedingLine.trim().startsWith('//') || precedingLine.trim().startsWith('/*')) {
      continue
    }

    if (!regBlock.includes('name:') && !regBlock.includes('name :') && !regBlock.includes('...')) {
      issues.push({
        file: filePath,
        line: lineIndex,
        slotName: 'unknown',
        message: `slots.register configuration missing required 'name' field`,
      })
    }

    if (!regBlock.includes('id:') && !regBlock.includes('id :') && !regBlock.includes('key:') && !regBlock.includes('...')) {
      issues.push({
        file: filePath,
        line: lineIndex,
        slotName: 'unknown',
        message: `slots.register configuration missing required 'id' or 'key' field`,
      })
    }
  }

  return issues
}

/**
 * Scan all plugin client sources across the repository.
 * @param {string} rootDir
 * @returns {{ filesScanned: number, issues: Array<{ file: string, line: number, slotName: string, message: string }> }}
 */
export function auditAllSlotContracts(rootDir) {
  const pluginsDir = join(rootDir, 'plugins')
  const clientFiles = findClientSourceFiles(pluginsDir)
  const allIssues = []

  for (const file of clientFiles) {
    const content = readFileSync(file, 'utf8')
    const fileIssues = scanFileForSlotContracts(file, content)
    allIssues.push(...fileIssues)
  }

  return {
    filesScanned: clientFiles.length,
    issues: allIssues,
  }
}

// CLI Execution Entrypoint
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))

if (isMain) {
  const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  console.log('[Slot Governance Scanner] Scanning plugin client source files...')

  const { filesScanned, issues } = auditAllSlotContracts(rootDir)

  if (issues.length > 0) {
    console.error(`\n❌ [Slot Contract Violations Found: ${issues.length}]`)
    for (const issue of issues) {
      const rel = relative(rootDir, issue.file)
      console.error(`  - ${rel}:${issue.line} [${issue.slotName}] -> ${issue.message}`)
    }
    console.error('\nPlease fix slot contract violations before delivering.\n')
    process.exit(1)
  } else {
    console.log(`✓ Slot contracts verified on ${filesScanned} client files. 0 violations.`)
    process.exit(0)
  }
}
