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
  {
    name: 'js-legacy-darwin-platform-query-missing-next-twin',
    legacyRe: /data-dsh-desktop-platform=["']darwin["']/,
    nextRe: /data-platform(?:=["']darwin["'])?|dataset\??\.platform/,
    hint: 'Pair data-dsh-desktop-platform="darwin" DOM lookup with html[data-platform="darwin"] / dataset.platform',
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
 * Advance past a JS string literal (`'...'` or `"..."`), returning the index
 * immediately after the closing quote (or line end / EOF).
 */
function skipQuotedString(source, start) {
  const quote = source[start]
  let i = start + 1
  while (i < source.length) {
    if (source[i] === '\\') {
      i += 2
      continue
    }
    if (source[i] === quote) return i + 1
    if (source[i] === '\n') return i
    i += 1
  }
  return i
}

/**
 * Advance past a JS template literal starting at the opening backtick,
 * respecting escapes, nested `${...}` expressions, and comments/strings inside `${...}`.
 * Returns `{ start, end }` (the body bounds exclusive of backticks) and `nextIndex`.
 */
function scanTemplateLiteral(source, openIndex) {
  const start = openIndex + 1
  let i = start
  let depth = 0
  while (i < source.length) {
    const ch = source[i]
    if (depth === 0) {
      if (ch === '\\') {
        i += 2
        continue
      }
      if (ch === '$' && source[i + 1] === '{') {
        depth = 1
        i += 2
        continue
      }
      if (ch === '`') {
        return { start, end: i, nextIndex: i + 1 }
      }
      i += 1
      continue
    }
    // Inside `${ ... }` expression: skip comments, strings, nested templates, and track braces.
    if (ch === '/' && source[i + 1] === '/') {
      const nl = source.indexOf('\n', i + 2)
      i = nl === -1 ? source.length : nl + 1
      continue
    }
    if (ch === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2)
      i = end === -1 ? source.length : end + 2
      continue
    }
    if (ch === '\'' || ch === '"') {
      i = skipQuotedString(source, i)
      continue
    }
    if (ch === '`') {
      const nested = scanTemplateLiteral(source, i)
      i = nested.nextIndex
      continue
    }
    if (ch === '{') {
      depth += 1
      i += 1
      continue
    }
    if (ch === '}') {
      depth -= 1
      i += 1
      continue
    }
    i += 1
  }
  return { start, end: i, nextIndex: i }
}

/**
 * Strip JS line/block comments outside string and template literals while
 * preserving exact character offsets and newlines, and collect CSS template ranges.
 */
function scanJsSource(source) {
  const cssRanges = []
  let codeChars = ''
  let i = 0
  while (i < source.length) {
    const ch = source[i]
    const next = source[i + 1]
    if (ch === '/' && next === '/') {
      const nl = source.indexOf('\n', i + 2)
      const end = nl === -1 ? source.length : nl
      codeChars += ' '.repeat(end - i)
      i = end
      continue
    }
    if (ch === '/' && next === '*') {
      const close = source.indexOf('*/', i + 2)
      const end = close === -1 ? source.length : close + 2
      codeChars += source.slice(i, end).replace(/[^\n]/g, ' ')
      i = end
      continue
    }
    if (ch === '\'' || ch === '"') {
      const end = skipQuotedString(source, i)
      codeChars += source.slice(i, end)
      i = end
      continue
    }
    if (ch === '`') {
      const tpl = scanTemplateLiteral(source, i)
      const body = source.slice(tpl.start, tpl.end)
      if (/\{[^{}]*:[^}]*\}/.test(body) && /\.dshDesktop|data-dsh-desktop-platform/.test(body)) {
        cssRanges.push({ start: tpl.start, end: tpl.end, body })
        // Blank CSS template body in JS code view so JS audit doesn't double-report CSS rules.
        codeChars += source.slice(i, tpl.nextIndex).replace(/[^\n]/g, ' ')
      } else {
        codeChars += source.slice(i, tpl.nextIndex)
      }
      i = tpl.nextIndex
      continue
    }
    codeChars += ch
    i += 1
  }
  return { cssRanges, codeWithoutComments: codeChars }
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

function auditJsQueries(originalSource, codeWithoutComments, filePath, violations) {
  const origLines = originalSource.split('\n')
  const codeLines = codeWithoutComments.split('\n')

  for (let idx = 0; idx < codeLines.length; idx += 1) {
    const codeLine = codeLines[idx]
    if (!codeLine.trim()) continue
    // Fast pre-filter: only lines referencing a legacy desktop shell token in active code
    if (!/\.dshDesktop|data-dsh-desktop-platform/.test(codeLine)) continue

    // Check exemption on current or two preceding original lines (handles multi-line querySelector calls)
    const exemptWindow = origLines.slice(Math.max(0, idx - 2), idx + 1).join('\n')
    if (EXEMPT_RE.test(exemptWindow)) continue

    // Surrounding statement window (supports multi-line querySelector(\n '.dshDesktopFrame'\n) and selector arrays)
    const windowText = codeLines.slice(Math.max(0, idx - 3), Math.min(codeLines.length, idx + 4)).join('\n')
    if (!/(?:querySelector(?:All)?|matches|closest|getAttribute|hasAttribute)\s*\(|(?:SELECTOR|SELECTORS)\s*=|['"`][^'"`]*(?:\.dshDesktop|data-dsh-desktop-platform)/.test(windowText)) {
      continue
    }

    for (const rule of JS_QUERY_TWIN_RULES) {
      if (!rule.legacyRe.test(codeLine)) continue
      if (rule.nextRe.test(windowText)) continue
      violations.push({
        file: filePath,
        line: idx + 1,
        rule: rule.name,
        selector: origLines[idx].trim().slice(0, 180),
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
  const { cssRanges, codeWithoutComments } = scanJsSource(source)
  for (const range of cssRanges) {
    auditCssBlock(range.body, range.start, source, filePath, violations)
  }
  auditJsQueries(source, codeWithoutComments, filePath, violations)
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
