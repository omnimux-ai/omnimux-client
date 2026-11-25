#!/usr/bin/env node
/**
 * Static dual-shell selector parity gate for plugins/plugins/omnimux/src/client/.
 *
 * Ensures legacy desktop shell selectors (.dshDesktopFrame, .dshDesktopConversationSurface,
 * .dshDesktopRightbarSurface, .dshDesktopSidebarSurface, body[data-dsh-desktop-platform="darwin"])
 * are never introduced without their Next shell (DSH 0.2.2-rc.5 AppFrame) twins unless
 * explicitly marked with `legacy-shell-only: <reason>`.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const PLUGINS_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const DEFAULT_SCAN_ROOT = join(PLUGINS_ROOT, 'plugins', 'omnimux', 'src', 'client')

const EXEMPT_RE = /legacy-shell-only\s*:/i

const CSS_TWIN_RULES = [
  {
    name: 'legacy-frame-missing-next-twin',
    legacyRe: /\.dshDesktopFrame\b/,
    nextRe: /\[class\*=["']frame["']\]/,
    hint: 'Add [class*="frame"] twin alongside .dshDesktopFrame',
  },
  {
    name: 'legacy-conversation-surface-missing-next-twin',
    legacyRe: /\.dshDesktopConversationSurface\b/,
    nextRe: /\[class\*=["']centerCol["']\]/,
    hint: 'Add [class*="centerCol"] twin alongside .dshDesktopConversationSurface',
  },
  {
    name: 'legacy-rightbar-surface-missing-next-twin',
    legacyRe: /\.dshDesktopRightbarSurface\b/,
    nextRe: /\[data-rightbar-col\]|\[class\*=["']rightbarCol["']\]/,
    hint: 'Add [data-rightbar-col] / [class*="rightbarCol"] twin alongside .dshDesktopRightbarSurface',
  },
  {
    name: 'legacy-sidebar-surface-missing-next-twin',
    legacyRe: /\.dshDesktopSidebarSurface\b/,
    nextRe: /\[class\*=["']sidebarCol["']\]|\[data-pane=["']sidebar["']\]/,
    hint: 'Add [class*="sidebarCol"] or [data-pane="sidebar"] twin alongside .dshDesktopSidebarSurface',
  },
  {
    name: 'legacy-darwin-platform-missing-next-twin',
    legacyRe: /body\[data-dsh-desktop-platform=["']darwin["']\]/,
    nextRe: /html\[data-platform=["']darwin["']\]|\[data-platform=["']darwin["']\]/,
    hint: 'Add html[data-platform="darwin"] twin alongside body[data-dsh-desktop-platform="darwin"]',
  },
]

const JS_QUERY_TWIN_RULES = [
  {
    name: 'js-legacy-frame-query-missing-next-twin',
    legacyRe: /\.dshDesktopFrame\b/,
    nextRe: /\[class\*=["']frame["']\]|class\*=\\"frame\\"/,
    hint: 'Pair .dshDesktopFrame DOM lookup with [class*="frame"]',
  },
  {
    name: 'js-legacy-conversation-query-missing-next-twin',
    legacyRe: /\.dshDesktopConversationSurface\b/,
    nextRe: /\[class\*=["']centerCol["']\]|centerCol/,
    hint: 'Pair .dshDesktopConversationSurface DOM lookup with [class*="centerCol"]',
  },
  {
    name: 'js-legacy-rightbar-query-missing-next-twin',
    legacyRe: /\.dshDesktopRightbarSurface\b/,
    nextRe: /\[data-rightbar-col\]|rightbarCol/,
    hint: 'Pair .dshDesktopRightbarSurface DOM lookup with [data-rightbar-col] / [class*="rightbarCol"]',
  },
  {
    name: 'js-legacy-sidebar-query-missing-next-twin',
    legacyRe: /\.dshDesktopSidebarSurface\b/,
    nextRe: /sidebarCol|\[data-pane=["']sidebar["']\]/,
    hint: 'Pair .dshDesktopSidebarSurface DOM lookup with [class*="sidebarCol"] / [data-pane="sidebar"]',
  },
]

function lineNumberAt(text, offset) {
  let line = 1
  for (let i = 0; i < offset && i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) line += 1
  }
  return line
}

function stripBlockComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ' '))
}

/**
 * Extract template literals that appear to contain CSS stylesheets (rules with `{ ... : ... }`).
 * Returns offsets in the original source so violations report exact line numbers.
 */
function findCssTemplateRanges(source) {
  const ranges = []
  let i = 0
  while (i < source.length) {
    if (source[i] === '`') {
      const start = i + 1
      let j = start
      let depth = 0
      while (j < source.length) {
        if (source[j] === '\\') {
          j += 2
          continue
        }
        if (source[j] === '$' && source[j + 1] === '{') {
          depth += 1
          j += 2
          continue
        }
        if (source[j] === '}' && depth > 0) {
          depth -= 1
          j += 1
          continue
        }
        if (source[j] === '`' && depth === 0) break
        j += 1
      }
      const body = source.slice(start, j)
      if (/\{[^{}]*:[^}]*\}/.test(body) && /\.dshDesktop|data-dsh-desktop-platform/.test(body)) {
        ranges.push({ start, end: j, body })
      }
      i = j + 1
      continue
    }
    i += 1
  }
  return ranges
}

function auditCssBlock(cssBody, baseOffset, fullSource, filePath, violations) {
  // Replace ${...} interpolations with safe placeholders of equal newline count
  const scrubbed = cssBody.replace(/\$\{[^}]*\}/g, (m) => m.replace(/[^\n]/g, '_'))
  // Scan CSS rule headers before each top-level `{ ... }`
  const ruleRe = /((?:\/\*[\s\S]*?\*\/|\s)*)([^{}@;][^{}]*?)\{([^{}]*)\}/g
  let match
  while ((match = ruleRe.exec(scrubbed))) {
    const leadingTrivia = match[1] || ''
    const rawSelector = match[2] || ''
    const selectorOffset = baseOffset + match.index + leadingTrivia.length
    const cleanSelector = stripBlockComments(rawSelector).trim()
    if (!cleanSelector || cleanSelector.startsWith('@')) continue
    // Check exempt comment in leading trivia or inside selector text
    if (EXEMPT_RE.test(leadingTrivia) || EXEMPT_RE.test(rawSelector)) continue

    for (const rule of CSS_TWIN_RULES) {
      if (!rule.legacyRe.test(cleanSelector)) continue
      if (rule.nextRe.test(cleanSelector)) continue
      violations.push({
        file: filePath,
        line: lineNumberAt(fullSource, selectorOffset),
        rule: rule.name,
        selector: cleanSelector.replace(/\s+/g, ' ').slice(0, 180),
        hint: rule.hint,
      })
    }
  }
}

function auditJsQueries(source, cssRanges, filePath, violations) {
  const lines = source.split('\n')
  const lineOffsets = []
  let cursor = 0
  for (const line of lines) {
    lineOffsets.push(cursor)
    cursor += line.length + 1
  }
  const inCssRange = (offset) => cssRanges.some((r) => offset >= r.start && offset <= r.end)

  for (let idx = 0; idx < lines.length; idx += 1) {
    const line = lines[idx]
    const offset = lineOffsets[idx]
    if (inCssRange(offset)) continue
    const trimmed = line.trim()
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue
    // Only inspect active DOM selector calls or selector constants
    if (!/(?:querySelector(?:All)?|matches|closest)\s*\(|(?:SELECTOR|SELECTORS)\s*=/.test(line)) continue
    if (EXEMPT_RE.test(line) || (idx > 0 && EXEMPT_RE.test(lines[idx - 1]))) continue

    // Allow pairing within a surrounding statement window (e.g. `const inner = querySelector('[class*="sidebarCol"]'); if (inner) return inner; const shell = querySelector('.dshDesktopSidebarSurface')`)
    const windowText = lines.slice(Math.max(0, idx - 2), Math.min(lines.length, idx + 3)).join('\n')
    for (const rule of JS_QUERY_TWIN_RULES) {
      if (!rule.legacyRe.test(line)) continue
      if (rule.nextRe.test(windowText)) continue
      violations.push({
        file: filePath,
        line: idx + 1,
        rule: rule.name,
        selector: trimmed.slice(0, 180),
        hint: rule.hint,
      })
    }
  }
}

/**
 * Audit a single JS/TS/CSS source file for un-paired legacy desktop shell selectors.
 * @param {string} source
 * @param {string} filePath
 */
export function auditSource(source, filePath = '<memory>') {
  const violations = []
  if (filePath.endsWith('.css')) {
    auditCssBlock(source, 0, source, filePath, violations)
    return violations
  }
  const cssRanges = findCssTemplateRanges(source)
  for (const range of cssRanges) {
    auditCssBlock(range.body, range.start, source, filePath, violations)
  }
  auditJsQueries(source, cssRanges, filePath, violations)
  return violations
}

function collectSourceFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'lib') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      collectSourceFiles(full, out)
    } else if (
      entry.isFile()
      && /\.(?:js|jsx|mjs|ts|tsx|css)$/.test(entry.name)
      && !/\.test\./.test(entry.name)
    ) {
      out.push(full)
    }
  }
  return out
}

export function auditDirectory(scanRoot = DEFAULT_SCAN_ROOT) {
  const files = collectSourceFiles(scanRoot)
  const violations = []
  for (const file of files) {
    const rel = relative(PLUGINS_ROOT, file)
    const content = readFileSync(file, 'utf8')
    violations.push(...auditSource(content, rel))
  }
  return { filesScanned: files.length, violations }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(__filename)) {
  const target = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_SCAN_ROOT
  const { filesScanned, violations } = auditDirectory(target)
  if (violations.length > 0) {
    console.error(`verify-next-shell-selectors: FAIL — ${violations.length} legacy selector(s) missing Next shell twin:`)
    for (const v of violations) {
      console.error(`  ${v.file}:${v.line} [${v.rule}] ${v.hint}`)
      console.error(`    ${v.selector}`)
    }
    process.exit(1)
  }
  console.log(`verify-next-shell-selectors: OK — ${filesScanned} files scanned, 0 unpaired legacy shell selectors`)
}
