#!/usr/bin/env node
/**
 * verify-dsw-tokens.mjs — 宿主 `--dsw-*` 主题 Token 真源白名单 + 单向不增棘轮门禁（#264）
 *
 * === AC-1 · 真源提取口径（写死在此，避免各 PR 各自解释） ===
 *
 * 1. 上游真源：`app/deepseek-harness/packages/client/ui-theme`（`@deepseek-ai/dsh-client-ui-theme`）。
 *    该包的 `src/client/styles.ts` 在运行时把下列 8 张样式表注入 `document.head`：
 *    `base.css`、`corner-shape.css`、`design-platform.css`、`focus.css`、`onboarding.css`、
 *    `scrollbar.css`、`gradient-shadow-text.css`、`shiki.css`。
 *    只有这 8 张表里 `--dsw-*: value` 定义的 Token 才算全局运行时真源；不要只扫
 *    `design-platform.css`（会误杀 `--dsw-radius-*` / `--dsw-elevation-*` / `--dsw-font-*`）。
 *
 * 2. 双壳交集：产品仓有 `app/dsh-desktop-next`（活跃 Electron 壳，锁定 `@deepseek-ai/dsh-client-ui-theme@0.2.2-rc.5`，
 *    450 个 Token）与 `app/dsh-plugin-desktop`（冻结的 Cordis 插件壳，锁定 `0.2.1-rc.3`，403 个 Token；
 *    双版本交集 402 个 Token，当前插件对 rc.5 新增 48 个 Token 的引用为 0）。两者都依赖
 *    `@deepseek-ai/dsh-client-ui-theme` 与 `@deepseek-ai/dsh-web-app` 并加载同一套 Harness Web UI，
 *    因此交集就是上述 8 张运行时样式表（以活跃线 rc.5 的 450 Token 快照为白名单）。两壳自己的 native-ui
 *    样式（`dsh-desktop-next/src/native-ui/theme.css`、`dsh-plugin-desktop/src/native-ui/**`）
 *    与 `dsh-desktop-next/src/web-document.ts` 的启动态样式里出现的全部 `--dsw-*` 定义，
 *    经核对都是上游 8 张表的子集（新增于本地时只会被计入「插件作用域内本地定义」）。
 *    非运行时测试夹具/快照里的定义从不算真源。
 *
 * 3. CI 约束：`quality-gate.yml` 的 `actions/checkout@v4` 未配置 `submodules: true`，
 *    CI 里没有 `app/deepseek-harness`。因此本门禁把上游真源固化为
 *    `plugins/scripts/dsw-token-allowlist.json`（内含 `harnessCommit` 与完整 Token 列表），
 *    CI 只读该快照，并把 `PROVENANCE.json` 的 submodule pin 与快照 `harnessCommit` 比对，
 *    任何子模块升级但未重新生成快照都会失败。本地有 submodule 时额外逐字节重算比对，
 *    防止快照与真源漂移（`--update-allowlist` 重新生成）。
 *
 * 4. 插件作用域内本地定义：同一插件/包 `src/` 内出现的 `--dsw-*: value` 视为该插件/包的
 *    合法本地 Token；跨插件引用不算合法（各自作用域独立）。
 *
 * === AC-2 · 门禁语义 ===
 *
 * - 扫描 `plugins/plugins/*\/src/**` 与 `plugins/packages/*\/src/**` 的运行时样式/源码，
 *   排除 `node_modules` / `lib` / `dist` / `build` / `tests` / `test-support` / `fixtures` /
 *   `openreel` 等 vendor 与 `*.test.*` / `*.spec.*`。
 * - 新增零容忍：任何不在「上游真源 ∪ 本包本地定义」中的 `var(--dsw-*)`（**无论是否带 fallback**）
 *   都记为未定义引用。
 * - 棘轮：`plugins/scripts/dsw-token-baseline.json` 按「插件/包 → 文件 → {count, tokens}」记录存量。
 *   只校验 `actual.count <= baseline.count` 且 `actual.tokens ⊆ baseline.tokens`；
 *   `actual < baseline` 永远放行（并行 PR 顺手清理无需改中央基线）。`--update-baseline` 收紧基线。
 * - `plugins/packages/dsh-ui-kit` 基线锁定为 0：该包任何未定义 Token 都直接失败，
 *   且基线文件中不得出现该包条目。
 */

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = resolve(SCRIPT_DIR, '..', '..')
export const PLUGINS_DIR = join(REPO_ROOT, 'plugins')
export const DEFAULT_ALLOWLIST_PATH = join(SCRIPT_DIR, 'dsw-token-allowlist.json')
export const DEFAULT_BASELINE_PATH = join(SCRIPT_DIR, 'dsw-token-baseline.json')
export const DSH_UI_KIT = 'plugins/packages/dsh-ui-kit'
export const HARNESS_SUBMODULE = 'app/deepseek-harness'
export const UI_THEME_STYLE_FILES = Object.freeze([
  'base.css',
  'corner-shape.css',
  'design-platform.css',
  'focus.css',
  'onboarding.css',
  'scrollbar.css',
  'gradient-shadow-text.css',
  'shiki.css',
])

const SCAN_EXTENSIONS = Object.freeze(['.css', '.scss', '.less', '.ts', '.tsx', '.js', '.jsx', '.mjs'])
const JS_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.mts', '.cts'])
const EXCLUDED_DIRS = new Set([
  'node_modules', 'lib', 'dist', 'build', 'tests', 'test', '__tests__', 'fixtures', 'fixture',
  'test-support', 'coverage', 'openreel', 'vendor', '.git',
])
// `--dsw-` + at least one segment; the inner `(?:-[A-Za-z0-9_]+)*` blocks malformed names
// such as the literal `--dsw-alias-` that appears in prose comments. The right-hand
// lookahead on REFERENCE_RE rejects prefix truncation of prose such as `var(--dsw-alias-*, ...)`.
const TOKEN_NAME = '--dsw-[A-Za-z0-9_]+(?:-[A-Za-z0-9_]+)*'
const DEFINITION_RE = new RegExp(`(?:['"])?(${TOKEN_NAME})(?:['"])?\\s*:`, 'g')
const REFERENCE_RE = new RegExp(`var\\(\\s*(${TOKEN_NAME})(?=\\s*[,)])`, 'g')

/** @param {string} value */
function blankComment(value) {
  return value.replace(/[^\n]/g, ' ')
}

/** @param {string} filePath */
function extensionOf(filePath) {
  const value = String(filePath || '')
  const dot = value.lastIndexOf('.')
  return dot === -1 ? '' : value.slice(dot).toLowerCase()
}

/**
 * Strip CSS block comments only, skipping single/double quoted strings. `//` is never a
 * comment in CSS, so `url(https://...)` stays intact.
 * @param {string} text
 */
export function stripCssComments(text) {
  const source = String(text)
  let output = ''
  let i = 0
  while (i < source.length) {
    const ch = source[i]
    if (ch === '"' || ch === "'") {
      const quote = ch
      output += ch
      i += 1
      while (i < source.length) {
        const current = source[i]
        output += current
        i += 1
        if (current === '\\') {
          if (i < source.length) {
            output += source[i]
            i += 1
          }
          continue
        }
        if (current === quote) break
      }
      continue
    }
    if (ch === '/' && source[i + 1] === '*') {
      let end = i + 2
      while (end < source.length && !(source[end] === '*' && source[end + 1] === '/')) end += 1
      const commentEnd = Math.min(end + 2, source.length)
      output += blankComment(source.slice(i, commentEnd))
      i = commentEnd
      continue
    }
    output += ch
    i += 1
  }
  return output
}

const REGEX_PREFIX_CHARS = new Set(['(', '[', '{', ',', ';', ':', '?', '=', '!', '&', '|', '^', '~', '*', '%', '<', '+', '-'])
const REGEX_PREFIX_KEYWORDS = new Set(['return', 'typeof', 'instanceof', 'case', 'in', 'of', 'delete', 'void', 'new', 'do', 'else', 'yield', 'await', 'throw', 'export', 'default'])
const CONTROL_KEYWORDS = new Set(['if', 'while', 'for', 'with'])

/** @param {{ kind: string, value?: string } | null} prev */
function startsRegex(prev) {
  if (!prev || prev.kind === 'start' || prev.kind === 'control-close') return true
  if (prev.kind === 'word') return REGEX_PREFIX_KEYWORDS.has(prev.value)
  if (prev.kind === 'punct') return prev.value === '=>' || REGEX_PREFIX_CHARS.has(prev.value)
  return false
}

/**
 * Scan a JavaScript regular-expression literal starting at `start` (the opening slash).
 * Returns the index just after the closing slash and flags, or -1 when the slash is really
 * division (no closing slash on the same line).
 * @param {string} source
 * @param {number} start
 */
function scanRegexLiteral(source, start) {
  let i = start + 1
  let inClass = false
  while (i < source.length) {
    const c = source[i]
    if (c === '\n') return -1
    if (c === '\\') {
      i += 2
      continue
    }
    if (c === '[') {
      inClass = true
      i += 1
      continue
    }
    if (c === ']' && inClass) {
      inClass = false
      i += 1
      continue
    }
    if (c === '/' && !inClass) {
      let end = i + 1
      while (end < source.length && /[A-Za-z]/.test(source[end])) end += 1
      return end
    }
    i += 1
  }
  return -1
}

/** @param {string} source @param {number} start */
function templateChunkBoundary(source, start) {
  let i = start
  while (i < source.length) {
    const c = source[i]
    if (c === '\\') {
      i += 2
      continue
    }
    if (c === '`') return { end: i, kind: 'backtick' }
    if (c === '$' && source[i + 1] === '{') return { end: i, kind: 'interp' }
    i += 1
  }
  return { end: source.length, kind: 'eof' }
}

/** @param {string} text @param {number} start @param {string} quote */
function sameLineClosingQuote(text, start, quote) {
  let i = start + 1
  while (i < text.length) {
    const c = text[i]
    if (c === '\\') {
      i += 2
      continue
    }
    if (c === '\n') return -1
    if (c === quote) return i
    i += 1
  }
  return -1
}

/** @param {string} text @param {number} start */
function blockCommentClose(text, start) {
  let i = start + 2
  while (i + 1 < text.length) {
    if (text[i] === '*' && text[i + 1] === '/') return i
    i += 1
  }
  return -1
}

/**
 * Strip CSS block comments from one template-literal static chunk. A block comment is only
 * blanked when its closing delimiter exists inside this same chunk; an unterminated opener
 * (for example the literal mime suffix `${slot.type}/*`) is preserved instead of swallowing
 * the rest of the file. Quote skipping is limited to a matching unescaped quote on the same
 * line, so an English apostrophe cannot lock later CSS comments out of scope.
 * @param {string} text
 */
function stripTemplateCssComments(text) {
  const source = String(text)
  let output = ''
  let i = 0
  while (i < source.length) {
    const ch = source[i]
    if (ch === '"' || ch === "'") {
      const close = sameLineClosingQuote(source, i, ch)
      if (close !== -1) {
        output += source.slice(i, close + 1)
        i = close + 1
        continue
      }
      output += ch
      i += 1
      continue
    }
    if (ch === '/' && source[i + 1] === '*') {
      const close = blockCommentClose(source, i)
      if (close !== -1) {
        output += blankComment(source.slice(i, close + 2))
        i = close + 2
        continue
      }
      output += ch
      i += 1
      continue
    }
    output += ch
    i += 1
  }
  return output
}

/**
 * Strip JS/TS line and block comments with a lexical scan that protects string literals,
 * template literals and regular-expression literals. CSS-in-JS template literal static
 * chunks additionally have their embedded CSS block comments stripped; `//` inside template
 * text (e.g. URLs) is always preserved.
 * @param {string} text
 */
export function stripJsComments(text) {
  const source = String(text)
  let output = ''
  /** @type {Array<{ kind: 'code' } | { kind: 'template' } | { kind: 'interp', braceDepth: number }>} */
  const stack = [{ kind: 'code' }]
  /** @type {{ kind: string, value?: string } | null} */
  let prev = null
  /** @type {Array<{ control: boolean }>} */
  const parenStack = []
  let i = 0
  while (i < source.length) {
    const state = stack[stack.length - 1]
    const ch = source[i]

    if (state.kind === 'template') {
      const boundary = templateChunkBoundary(source, i)
      output += stripTemplateCssComments(source.slice(i, boundary.end))
      i = boundary.end
      if (boundary.kind === 'backtick') {
        output += '`'
        i += 1
        stack.pop()
        prev = { kind: 'string' }
      } else if (boundary.kind === 'interp') {
        output += '${'
        i += 2
        stack.push({ kind: 'interp', braceDepth: 0 })
        prev = { kind: 'start' }
      } else {
        stack.pop()
      }
      continue
    }

    if (/\s/.test(ch)) {
      output += ch
      i += 1
      continue
    }

    if (ch === '/' && source[i + 1] === '/') {
      let end = i
      while (end < source.length && source[end] !== '\n') end += 1
      output += blankComment(source.slice(i, end))
      i = end
      continue
    }

    if (ch === '/' && source[i + 1] === '*') {
      let end = i + 2
      while (end < source.length && !(source[end] === '*' && source[end + 1] === '/')) end += 1
      const commentEnd = Math.min(end + 2, source.length)
      output += blankComment(source.slice(i, commentEnd))
      i = commentEnd
      continue
    }

    if (ch === '"' || ch === "'") {
      const quote = ch
      output += ch
      i += 1
      while (i < source.length) {
        const current = source[i]
        output += current
        i += 1
        if (current === '\\') {
          if (i < source.length) {
            output += source[i]
            i += 1
          }
          continue
        }
        if (current === quote) break
      }
      prev = { kind: 'string' }
      continue
    }

    if (ch === '`') {
      output += ch
      i += 1
      stack.push({ kind: 'template' })
      continue
    }

    if (
      ch === '/' &&
      source[i + 1] !== '/' &&
      source[i + 1] !== '*' &&
      source[i - 1] !== '<' &&
      startsRegex(prev)
    ) {
      const end = scanRegexLiteral(source, i)
      if (end !== -1) {
        output += source.slice(i, end)
        i = end
        prev = { kind: 'regex' }
        continue
      }
    }

    if (state.kind === 'interp') {
      if (ch === '{') {
        state.braceDepth += 1
        output += ch
        i += 1
        prev = { kind: 'punct', value: '{' }
        continue
      }
      if (ch === '}') {
        output += ch
        i += 1
        if (state.braceDepth === 0) {
          stack.pop()
          prev = { kind: 'string' }
        } else {
          state.braceDepth -= 1
          prev = { kind: 'punct', value: '}' }
        }
        continue
      }
    }

    if (ch === '(') {
      parenStack.push({ control: prev?.kind === 'word' && CONTROL_KEYWORDS.has(prev.value) })
      output += ch
      i += 1
      prev = { kind: 'punct', value: '(' }
      continue
    }
    if (ch === ')') {
      const info = parenStack.pop()
      output += ch
      i += 1
      prev = info?.control ? { kind: 'control-close' } : { kind: 'paren-close' }
      continue
    }
    if (ch === '+' || ch === '-') {
      if (source[i + 1] === ch) {
        output += ch + ch
        i += 2
        prev = { kind: 'punct', value: ch + ch }
      } else {
        output += ch
        i += 1
        prev = { kind: 'punct', value: ch }
      }
      continue
    }
    if (ch === '=' && source[i + 1] === '>') {
      output += '=>'
      i += 2
      prev = { kind: 'punct', value: '=>' }
      continue
    }
    if (/[A-Za-z0-9_$]/.test(ch)) {
      let end = i + 1
      while (end < source.length && /[A-Za-z0-9_$]/.test(source[end])) end += 1
      const word = source.slice(i, end)
      output += word
      i = end
      prev = /^[0-9]/.test(word) ? { kind: 'number' } : { kind: 'word', value: word }
      continue
    }

    output += ch
    i += 1
    prev = { kind: 'punct', value: ch }
  }
  return output
}

/**
 * Strip comments according to the source file type. Unknown extensions fall back to CSS
 * semantics (block comments only), which is the conservative choice for token extraction.
 * @param {string} text
 * @param {string} [filePath]
 */
export function stripComments(text, filePath = '') {
  return JS_EXTENSIONS.has(extensionOf(filePath)) ? stripJsComments(text) : stripCssComments(text)
}

/**
 * @param {string} text
 * @param {string} [filePath] used to select JS vs CSS comment syntax
 */
export function extractTokenDefinitions(text, filePath = '') {
  const found = new Set()
  for (const match of stripComments(text, filePath).matchAll(DEFINITION_RE)) found.add(match[1])
  return found
}

/**
 * @param {string} text
 * @param {string} [filePath] used to select JS vs CSS comment syntax
 */
export function extractTokenReferences(text, filePath = '') {
  const found = []
  const source = stripComments(text, filePath)
  for (const match of source.matchAll(REFERENCE_RE)) {
    const close = source.indexOf(')', match.index + match[0].length)
    const tail = close === -1 ? '' : source.slice(match.index + match[0].length, close)
    found.push({ token: match[1], hasFallback: tail.includes(',') })
  }
  return found
}

/** @param {string} dir */
function walkSourceFiles(dir) {
  const files = []
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || EXCLUDED_DIRS.has(entry.name)) continue
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (!entry.isFile()) continue
      if (!SCAN_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) continue
      if (/\.(?:test|spec)\.[^/]+$/u.test(entry.name)) continue
      files.push(full)
    }
  }
  walk(dir)
  return files.sort()
}

/** @param {string} repoRoot */
export function listScannedPackages(repoRoot = REPO_ROOT) {
  const packages = []
  for (const group of ['plugins', 'packages']) {
    const base = join(repoRoot, 'plugins', group)
    if (!existsSync(base)) continue
    for (const name of readdirSync(base)) {
      if (name.startsWith('.')) continue
      const packageDir = join(base, name)
      if (!statSync(packageDir).isDirectory()) continue
      const srcDir = join(packageDir, 'src')
      if (existsSync(srcDir) && statSync(srcDir).isDirectory()) {
        packages.push({ id: `plugins/${group}/${name}`, dir: packageDir, srcDir })
      }
    }
  }
  return packages.sort((a, b) => a.id.localeCompare(b.id))
}

/**
 * Extract the upstream runtime token set from the checked-out harness submodule.
 * @param {string} repoRoot
 * @returns {{ harnessCommit: string, styleFiles: string[], tokens: string[] }}
 */
export function generateUpstreamAllowlist(repoRoot = REPO_ROOT) {
  const provenancePath = join(repoRoot, 'PROVENANCE.json')
  const provenance = JSON.parse(readFileSync(provenancePath, 'utf8'))
  const harnessCommit = provenance?.sources?.app?.submodules?.[HARNESS_SUBMODULE]
  if (typeof harnessCommit !== 'string' || !harnessCommit) {
    throw new Error(`PROVENANCE.json is missing sources.app.submodules["${HARNESS_SUBMODULE}"]`)
  }
  const stylesDir = join(repoRoot, HARNESS_SUBMODULE, 'packages/client/ui-theme/src/styles')
  if (!existsSync(stylesDir)) {
    throw new Error(`Cannot regenerate the allowlist without ${HARNESS_SUBMODULE}; initialize the submodule first`)
  }
  const tokens = new Set()
  for (const file of UI_THEME_STYLE_FILES) {
    const full = join(stylesDir, file)
    if (!existsSync(full)) throw new Error(`ui-theme runtime stylesheet is missing: ${file}`)
    for (const token of extractTokenDefinitions(readFileSync(full, 'utf8'), full)) tokens.add(token)
  }
  return { harnessCommit, styleFiles: [...UI_THEME_STYLE_FILES], tokens: [...tokens].sort() }
}

/** @param {string} path */
export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

/**
 * Verify the committed allowlist against PROVENANCE (always) and the local submodule
 * when it is present. Returns a list of `{ code, message }` issues.
 * @param {{ allowlist: any, repoRoot?: string }} input
 */
export function verifyAllowlistSync({ allowlist, repoRoot = REPO_ROOT }) {
  const issues = []
  if (!allowlist || allowlist.version !== 1) {
    return [{ code: 'allowlist-shape', message: 'dsw-token-allowlist.json must be version 1' }]
  }
  const source = allowlist.source || {}
  if (!Array.isArray(source.tokens) || source.tokens.length === 0) {
    return [{ code: 'allowlist-shape', message: 'dsw-token-allowlist.json source.tokens must be a non-empty array' }]
  }
  const provenance = JSON.parse(readFileSync(join(repoRoot, 'PROVENANCE.json'), 'utf8'))
  const pin = provenance?.sources?.app?.submodules?.[HARNESS_SUBMODULE]
  if (pin !== source.harnessCommit) {
    issues.push({
      code: 'allowlist-pin-stale',
      message: `allowlist harnessCommit ${source.harnessCommit || '(missing)'} != PROVENANCE submodule pin ${pin || '(missing)'}; run with --update-allowlist`,
    })
  }
  const stylesDir = join(repoRoot, HARNESS_SUBMODULE, 'packages/client/ui-theme/src/styles')
  if (existsSync(stylesDir)) {
    const actual = generateUpstreamAllowlist(repoRoot)
    const expected = [...source.tokens].sort()
    if (JSON.stringify(actual.tokens) !== JSON.stringify(expected)) {
      const actualSet = new Set(actual.tokens)
      const expectedSet = new Set(expected)
      const added = actual.tokens.filter((token) => !expectedSet.has(token)).slice(0, 8)
      const removed = expected.filter((token) => !actualSet.has(token)).slice(0, 8)
      issues.push({
        code: 'allowlist-stale',
        message: `dsw-token-allowlist.json does not match the checked-out ui-theme runtime stylesheets; run with --update-allowlist (new: ${added.join(', ') || 'none'}; stale: ${removed.join(', ') || 'none'})`,
      })
    }
  }
  if (JSON.stringify(source.styleFiles) !== JSON.stringify([...UI_THEME_STYLE_FILES])) {
    issues.push({ code: 'allowlist-shape', message: 'allowlist source.styleFiles must list the 8 runtime ui-theme stylesheets in order' })
  }
  return issues
}

/**
 * Scan every plugin/package for undefined `--dsw-*` references.
 * @param {{ repoRoot?: string, allowlistTokens: Iterable<string> }} input
 */
export function collectUndefinedUsage({ repoRoot = REPO_ROOT, allowlistTokens }) {
  const upstream = new Set(allowlistTokens)
  /** @type {Record<string, Record<string, { count: number, tokens: string[], bare: number, fallback: number }>>} */
  const usage = {}
  for (const pkg of listScannedPackages(repoRoot)) {
    const files = walkSourceFiles(pkg.srcDir)
    const localDefinitions = new Set()
    for (const file of files) {
      for (const token of extractTokenDefinitions(readFileSync(file, 'utf8'), file)) localDefinitions.add(token)
    }
    const valid = new Set([...upstream, ...localDefinitions])
    const fileEntries = {}
    for (const file of files) {
      const references = extractTokenReferences(readFileSync(file, 'utf8'), file)
      const undefinedRefs = references.filter((ref) => !valid.has(ref.token))
      if (!undefinedRefs.length) continue
      const relPath = relative(pkg.dir, file).split(sep).join('/')
      fileEntries[relPath] = {
        count: undefinedRefs.length,
        tokens: [...new Set(undefinedRefs.map((ref) => ref.token))].sort(),
        bare: undefinedRefs.filter((ref) => !ref.hasFallback).length,
        fallback: undefinedRefs.filter((ref) => ref.hasFallback).length,
      }
    }
    if (Object.keys(fileEntries).length > 0) usage[pkg.id] = fileEntries
  }
  return usage
}

/**
 * @param {{ usage: Record<string, Record<string, { count: number, tokens: string[] }>>, baseline: any }} input
 */
export function checkBaseline({ usage, baseline }) {
  const issues = []
  const entries = baseline?.entries
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) {
    return [{ code: 'baseline-shape', message: 'dsw-token-baseline.json entries must be an object' }]
  }
  if (Object.hasOwn(entries, DSH_UI_KIT)) {
    issues.push({ code: 'ui-kit-baseline-entry', message: `${DSH_UI_KIT} must not keep any baseline entry (locked to 0)` })
  }
  const shrunk = []
  for (const [pkg, files] of Object.entries(usage)) {
    if (pkg === DSH_UI_KIT) continue
    const packageBaseline = entries[pkg] && typeof entries[pkg] === 'object' ? entries[pkg] : {}
    for (const [file, actual] of Object.entries(files)) {
      const allowed = packageBaseline[file]
      if (!allowed || typeof allowed !== 'object') {
        issues.push({
          code: 'undefined-token',
          message: `${pkg}/${file}: ${actual.count} undefined --dsw-* reference(s) with no baseline entry: ${actual.tokens.join(', ')}`,
        })
        continue
      }
      const allowedTokens = new Set(Array.isArray(allowed.tokens) ? allowed.tokens : [])
      const newTokens = actual.tokens.filter((token) => !allowedTokens.has(token))
      if (newTokens.length > 0) {
        issues.push({
          code: 'undefined-token',
          message: `${pkg}/${file}: new undefined --dsw-* token(s) outside the baseline: ${newTokens.join(', ')}`,
        })
      }
      const allowedCount = typeof allowed.count === 'number' ? allowed.count : 0
      if (actual.count > allowedCount) {
        issues.push({
          code: 'baseline-exceeded',
          message: `${pkg}/${file}: ${actual.count} undefined --dsw-* reference(s) exceed the baseline count ${allowedCount}`,
        })
      } else if (actual.count < allowedCount) {
        shrunk.push(`${pkg}/${file} (${allowedCount} -> ${actual.count})`)
      }
    }
  }
  return { issues, shrunk }
}

/**
 * Full gate.
 * @param {{ repoRoot?: string, allowlistPath?: string, baselinePath?: string }} [options]
 */
export function verifyDswTokens(options = {}) {
  const repoRoot = options.repoRoot ?? REPO_ROOT
  const allowlistPath = options.allowlistPath ?? DEFAULT_ALLOWLIST_PATH
  const baselinePath = options.baselinePath ?? DEFAULT_BASELINE_PATH
  const issues = []
  if (!existsSync(allowlistPath)) {
    return { issues: [{ code: 'allowlist-missing', message: `missing allowlist: ${allowlistPath}` }], summary: null }
  }
  const allowlist = readJson(allowlistPath)
  issues.push(...verifyAllowlistSync({ allowlist, repoRoot }))
  if (!existsSync(baselinePath)) {
    return { issues: [...issues, { code: 'baseline-missing', message: `missing baseline: ${baselinePath}` }], summary: null }
  }
  const baseline = readJson(baselinePath)
  const usage = collectUndefinedUsage({ repoRoot, allowlistTokens: allowlist.source.tokens })
  const checked = checkBaseline({ usage, baseline })
  issues.push(...checked.issues)
  const uiKitEntries = usage[DSH_UI_KIT] || {}
  const uiKitCount = Object.values(uiKitEntries).reduce((sum, entry) => sum + entry.count, 0)
  for (const [file, entry] of Object.entries(uiKitEntries)) {
    issues.push({
      code: 'ui-kit-undefined-token',
      message: `${DSH_UI_KIT}/${file}: ${entry.count} undefined --dsw-* reference(s) (this package is locked to 0): ${entry.tokens.join(', ')}`,
    })
  }
  const packagesWithUsage = Object.keys(usage).filter((pkg) => pkg !== DSH_UI_KIT)
  const totalUndefined = Object.values(usage).reduce(
    (sum, files) => sum + Object.values(files).reduce((inner, entry) => inner + entry.count, 0),
    0,
  )
  return {
    issues,
    summary: {
      scannedPackages: listScannedPackages(repoRoot).length,
      upstreamTokens: allowlist.source.tokens.length,
      packagesWithBaselineUsage: packagesWithUsage.length,
      totalUndefined,
      uiKitUndefined: uiKitCount,
      shrunk: checked.shrunk,
    },
    usage,
  }
}

/** @param {{ repoRoot?: string, allowlistPath?: string }} [options] */
export function writeAllowlist({ repoRoot = REPO_ROOT, allowlistPath = DEFAULT_ALLOWLIST_PATH } = {}) {
  const generated = generateUpstreamAllowlist(repoRoot)
  const payload = {
    version: 1,
    description: 'Runtime --dsw-* token truth extracted from the 8 ui-theme stylesheets both desktop shells inject (#264).',
    source: {
      package: '@deepseek-ai/dsh-client-ui-theme',
      harnessCommit: generated.harnessCommit,
      styleFiles: generated.styleFiles,
      tokenCount: generated.tokens.length,
      tokens: generated.tokens,
    },
  }
  writeFileSync(allowlistPath, `${JSON.stringify(payload, null, 2)}\n`)
  return payload
}

/** @param {{ repoRoot?: string, allowlistPath?: string, baselinePath?: string }} [options] */
export function writeBaseline({ repoRoot = REPO_ROOT, allowlistPath = DEFAULT_ALLOWLIST_PATH, baselinePath = DEFAULT_BASELINE_PATH } = {}) {
  const allowlist = readJson(allowlistPath)
  const usage = collectUndefinedUsage({ repoRoot, allowlistTokens: allowlist.source.tokens })
  const entries = {}
  for (const [pkg, files] of Object.entries(usage)) {
    if (pkg === DSH_UI_KIT) continue
    entries[pkg] = files
  }
  const payload = {
    version: 1,
    description: 'Soft-shrink ratchet baseline for existing undefined --dsw-* references (#264). Only actual <= baseline is enforced; shrink freely via --update-baseline.',
    entries,
  }
  writeFileSync(baselinePath, `${JSON.stringify(payload, null, 2)}\n`)
  return payload
}

function formatReport(result) {
  if (!result.summary) {
    return `❌ verify-dsw-tokens 失败（${result.issues.length} 项）：\n${result.issues.map((issue) => `   - [${issue.code}] ${issue.message}`).join('\n')}`
  }
  const { summary } = result
  if (result.issues.length === 0) {
    const lines = [
      `✅ verify-dsw-tokens 通过：扫描 ${summary.scannedPackages} 个插件/包；上游运行时 Token ${summary.upstreamTokens} 个；存量未定义引用 ${summary.totalUndefined}（${summary.packagesWithBaselineUsage} 个包，均在基线内）；dsh-ui-kit ${summary.uiKitUndefined}。`,
    ]
    if (summary.shrunk.length > 0) lines.push(`   ℹ️ 可顺手收紧基线（不阻断）：${summary.shrunk.slice(0, 6).join('; ')}${summary.shrunk.length > 6 ? ' …' : ''}`)
    return lines.join('\n')
  }
  return `❌ verify-dsw-tokens 失败（${result.issues.length} 项）：\n${result.issues.map((issue) => `   - [${issue.code}] ${issue.message}`).join('\n')}`
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const unknown = args.filter((arg) => !['--update-baseline', '--update-allowlist', '--json'].includes(arg))
  if (unknown.length > 0) {
    console.error(`verify-dsw-tokens: unknown argument(s): ${unknown.join(', ')}`)
    process.exit(2)
  }
  try {
    if (args.includes('--update-allowlist')) {
      const payload = writeAllowlist()
      console.log(`dsw-token-allowlist: wrote ${payload.source.tokens.length} tokens (harness ${payload.source.harnessCommit.slice(0, 12)})`)
    }
    if (args.includes('--update-baseline')) {
      const payload = writeBaseline()
      const packages = Object.keys(payload.entries).length
      console.log(`dsw-token-baseline: wrote ${packages} package(s)`)
    }
    const result = verifyDswTokens()
    if (args.includes('--json')) {
      console.log(JSON.stringify({ issues: result.issues, summary: result.summary }, null, 2))
    } else {
      console.log(formatReport(result))
    }
    if (result.issues.length > 0) process.exitCode = 1
  } catch (error) {
    console.error(`verify-dsw-tokens 执行失败：${error.message}`)
    process.exitCode = 1
  }
}
