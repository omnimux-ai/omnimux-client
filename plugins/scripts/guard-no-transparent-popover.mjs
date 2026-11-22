#!/usr/bin/env node
/**
 * scripts/guard-no-transparent-popover.mjs
 * 浮层防透视穿透与 Token 兜底硬门禁（Hard Gate）
 *
 * 核心治理原则：
 * 1. 杜绝软规则依赖：任何浮层、下拉菜单、弹出框必须通过硬门禁自动化静态检测拦截。
 * 2. 严禁浮层伪毛玻璃透底：.omnimux-*-menu 浮层容器严禁使用 backdrop-filter。
 * 3. 严禁裸用未定义 Token：宿主未定义 --dsw-alias-bg-elevated，严禁裸写 var(--dsw-alias-bg-elevated) 导致计算值退化为 transparent。
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..')
const DEFAULT_PLUGINS_DIR = join(REPO_ROOT, 'plugins')
const CANVAS_SOURCE = /(?:^|\/)omnimux-workflow\/src\/canvas\//
const normalizePath = (file) => file.replace(/\\/g, '/')

const EXCLUDE_DIRS = new Set([
  'node_modules',
  'lib',
  'dist',
  'dist-harness',
  'build',
  'coverage',
  '.git',
  '.dsh',
  '.workbuddy',
  'test-mocks',
  'fixtures',
])

/**
 * 递归收集指定目录下的源码文件
 */
export function collectSourceFiles(dir, exts = ['.js', '.jsx', '.ts', '.tsx', '.css']) {
  const files = []
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return files

  const entries = readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.has(entry.name)) continue
      files.push(...collectSourceFiles(fullPath, exts))
    } else if (entry.isFile()) {
      if (exts.some((ext) => entry.name.endsWith(ext))) {
        if (/\.(test|spec)\.[a-z0-9]+$/i.test(entry.name)) continue
        files.push(fullPath)
      }
    }
  }
  return files
}

// Quoted, escaped and function arguments can contain CSS delimiters as data.
function* stylesheetDelimiters(source) {
  let valueDepth = 0
  const tokens = /"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|\\[\s\S]|[()[\]{};]/g
  for (const { 0: token, index } of source.matchAll(tokens)) {
    if (token === '(' || token === '[') {
      valueDepth++
    } else if (token === ')' || token === ']') {
      valueDepth--
    } else if (valueDepth === 0 && token.length === 1) {
      yield { token, index }
    }
  }
}

// Keep declarations attached to their own rule even when nested selectors split the body.
function extractStylesheetBlocks(content, canvas, offset = 0) {
  const source = blankCssComments(content)
  // Client stylesheets can have an existing exemption comment on a rule.
  const declarationSource = canvas ? source : content
  const blocks = []
  const openRules = []
  let start = 0
  for (const { token, index } of stylesheetDelimiters(source)) {
    const current = openRules.at(-1)
    if (token === '{') {
      const prelude = source.slice(start, index)
      const selector = prelude.trim()
      const containerKeys = styleContainerKeys(selector, canvas, current?.containerKeys)
      const nestedOverride = current?.containerKeys.some((key) => containerKeys.includes(key)) ?? false
      const startingStyle = Boolean(current?.startingStyle || /^@starting-style(?![\w-])/i.test(selector))
      // Keep the client's existing flat-rule scope. Inside a floating rule,
      // evaluate the nested rule against its resolved subject.
      const scanRule = canvas || Boolean(current?.containerKeys.length || floatingContainerKey(content.slice(start, index)))
      openRules.push({
        selector, containerKeys, nestedOverride, startingStyle, scanRule,
        declarations: [], index: offset + start + prelude.search(/\S/),
      })
    } else if (token === ';') {
      current?.declarations.push(declarationSource.slice(start, index + 1))
    } else if (current) {
      const { declarations, scanRule, ...block } = openRules.pop()
      const body = (declarations.join('') + declarationSource.slice(start, index)).trim()
      if (scanRule && block.selector && body) blocks.push({ ...block, body })
    }
    start = index + 1
  }
  return blocks.sort((a, b) => a.index - b.index)
}

// Blank comments without shifting source offsets or changing quoted values.
function blankCssComments(source) {
  return source.replace(/"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|\/\*[\s\S]*?\*\//g,
    (token) => token.startsWith('/*') ? token.replace(/[^\r\n]/g, ' ') : token)
}

/**
 * 解析代码中的 CSS 规则块：提取 selector { body }
 */
export function extractCssRuleBlocks(content, { canvas = false, stylesheet = true } = {}) {
  const cssSnippet = /^\s*(?:\/\*[\s\S]*?\*\/\s*)*(?:[.#:\[*@]|(?:html|body)(?![\w-]))/
  if (stylesheet || cssSnippet.test(content)) return extractStylesheetBlocks(content, canvas)

  const blocks = []
  // Parse embedded styles in their own strings, outside the surrounding JS or JSX braces.
  const literals = /\/\/[^\r\n]*|\/\*[\s\S]*?\*\/|`(?:\\[\s\S]|[^`\\])*`|"(?:\\[\s\S]|[^"\\\r\n])*"|'(?:\\[\s\S]|[^'\\\r\n])*'/g
  for (const { 0: literal, index } of content.matchAll(literals)) {
    if (literal.startsWith('/') || !literal.includes('{')) continue
    blocks.push(...extractStylesheetBlocks(literal.slice(1, -1), canvas, index + 1))
  }
  return blocks
}




/**
 * 既有债务登记（不是豁免机制）。
 * 这 2 处是**同一类真实缺陷**：浮层底色裸用宿主未定义的 --dsw-alias-bg-elevated，
 * 计算值退化为 transparent。它们未被本次修复，是因为所属插件的断言把「裸写该令牌」
 * 本身钉成了契约（见每条 reason 中的测试文件），改源码会让它们的测试变红；
 * 修它需要连同那些断言一起改，属对方写域。登记在此以保证：①债务可见、可追溯；
 * ②任何**新增**的同类写法一律致命拦截。清除条件：对应测试断言改为接受带回退的写法。
 */
export const LEGACY_FLOATING_SURFACE_DEBT = [
  // 跨插件历史债务已于「浮层实体底色治理」任务清空：assets 尺寸菜单与 products 缩略图浮层
  // 均已改为带实体回退的令牌，钉住旧写法的断言同步放开。此后任何浮层都必须自带实体底色。
]

/** 该违规是否属于已登记的既有债务。 */
function isRegisteredDebt(rule, filePath, selector) {
  const rel = normalizePath(filePath)
  return LEGACY_FLOATING_SURFACE_DEBT.some(
    (d) =>
      rel.endsWith(d.file) &&
      String(selector).includes(d.selector) &&
      (d.rules ?? []).includes(rule)
  )
}

const FLOATING_WORDS = [
  'popover', 'menu', 'dropdown', 'dialog', 'modal', 'sheet', 'tooltip', 'flyout',
]

// Canvas surfaces with a painted background. The cascade, slot preview and
// modal backdrop have separate layout or mask elements around these surfaces.
const CANVAS_CARD_CLASSES = new Set([
  'wf-cfg-popover',
  'wf-video-param-popover',
  'wf-page-dropdown-popover',
  'wf-custom-dropdown-menu',
  'wf-custom-select-dropdown',
  'wf-context-menu',
  'wf-action-menu',
  'wf-floating-top-pill__more-menu',
  'wf-mention-popover',
  'wf-popover-portal',
  'wf-context-menu-portal',
  'wf-hover-inspector-portal',
  'wf-popover-context-bubble',
  'wf-attachment-preview-card',
  'wf-modal-card',
  'wf-loomi-col',
  'wf-slot-hover-preview__card',
  'wf-toast',
  'wf-cm-search-panel',
])

const CANVAS_FLOATING_WRAPPERS = new Set(['wf-modal-overlay', 'wf-slot-hover-preview', 'wf-mention-submenu'])

// These group rules can wrap declarations on the enclosing style rule.
const NESTED_STYLE_GROUP = /^@(?:container|layer|media|scope|starting-style|supports)(?![\w-])/i

// Keep a placeholder for each attribute or predicate so `.menu > [role]`
// retains its separate subject. Follow subject alternatives in :is() and :where().
function projectStyleSelector(selector, canvas, parentKeys) {
  const tokens = /"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|\\[\s\S]|[()[\]]/g
  let projected = ''
  let start = 0
  let argumentStart = 0
  let depth = 0
  for (const { 0: token, index } of selector.matchAll(tokens)) {
    if (token === '(' || token === '[') {
      if (depth === 0) argumentStart = index
      depth++
    } else if (token === ')' || token === ']') {
      depth--
      if (depth !== 0) continue
      const prefix = selector.slice(start, argumentStart)
      projected += prefix
      if (token === ')' && /(?<!:):(?:is|where)$/i.test(prefix)) {
        projected += styleContainerKeys(selector.slice(argumentStart + 1, index), canvas, parentKeys).join('')
      } else {
        projected += token === ']' ? '[]' : '()'
      }
      start = index + 1
    }
  }
  return (projected + selector.slice(start)).replace(/\\[\s\S]/g, '_')
}

function styleContainerKeys(selector, canvas, parentKeys = []) {
  if (selector.startsWith('@')) return NESTED_STYLE_GROUP.test(selector) ? parentKeys : []

  const subjects = projectStyleSelector(selector, canvas, parentKeys)
    .split(',')
    .map((part) => part.trim().split(/(?:[\s>+~]|\|\|)+/).at(-1))

  return subjects.flatMap((subject) => {
    if (subject.includes('::')) return []
    const names = (subject.match(/\.[\w-]+/g) ?? []).map((key) => key.slice(1).split('--')[0])
    const keys = names.filter((name) =>
      isFloatingContainerSelector(`.${name}`) ||
      (canvas && (CANVAS_CARD_CLASSES.has(name) || CANVAS_FLOATING_WRAPPERS.has(name)))
    ).map((name) => `.${name}`)
    return subject.includes('&') ? keys.concat(parentKeys) : keys
  })
}

/**
 * 判断选择器是否指向「浮层容器本身」。
 * 只认容器，不认容器内部的零件 —— 否则 -item / -header / -btn / svg 这些
 * 本就没有底色的子规则会全部变成误报，门禁会因为噪音而被绕过。
 * 判据（全部满足）：
 *   1. 选择器首段是类选择器（`.` 开头），排除 JS 里被误当成规则体的字符串；
 *   2. 去掉 BEM 修饰符（--x）后，类名以某个浮层词结尾（.omx-avatar-popover ✓，-menu-item ✗）；
 *   3. 选择器只由这一个类 + 伪类/属性组成，不含后代/元素/组合（`.popover input` ✗）。
 * @param {string} selector
 * @returns {boolean}
 */
export function floatingContainerKey(selector) {
  const trimmed = String(selector).trim()
  if (!trimmed.startsWith('.')) return null
  if (/[\s>+~]/.test(trimmed)) return null
  const classTokens = trimmed.match(/\.[A-Za-z0-9_-]+/g) || []
  if (classTokens.length === 0) return null
  const base = classTokens[0].slice(1).replace(/--[A-Za-z0-9_-]+$/, '')
  const hit = FLOATING_WORDS.some(
    (word) => base === word || base.endsWith(`-${word}`) || base.endsWith(`_${word}`)
  )
  return hit ? classTokens[0] : null
}

export function isFloatingContainerSelector(selector) {
  const trimmed = String(selector).trim()
  if (!trimmed.startsWith('.')) return false
  const firstCompound = trimmed.split(/[\s>+~]/)[0]
  if (firstCompound !== trimmed && /[\s>+~]/.test(trimmed)) {
    // 含后代/组合选择器：命中的是容器内部或容器之外的元素，不是容器本身
    return false
  }
  const classTokens = firstCompound.match(/\.[A-Za-z0-9_-]+/g) || []
  if (classTokens.length === 0) return false
  const base = classTokens[0].slice(1).replace(/--[A-Za-z0-9_-]+$/, '')
  return FLOATING_WORDS.some(
    (word) => base === word || base.endsWith(`-${word}`) || base.endsWith(`_${word}`)
  )
}

/**
 * 宿主（DSH 应用）里**不存在**的令牌：裸写即整条声明失效、背景退化为 transparent。
 * 这份清单是本门禁的真源；新增成员必须有实证（在应用资源里搜不到定义）。
 */
export const KNOWN_UNDEFINED_TOKENS = new Set(['--dsw-alias-bg-elevated'])

const SURFACE_DECLARATION = /^\s*(background(?:-color)?|(?:-webkit-)?backdrop-filter|opacity)\s*:\s*([\s\S]*)$/i
const BARE_BG_ELEVATED = /var\(\s*--dsw-alias-bg-elevated\s*\)/
const OVERLAY_BG = /--dsw-alias-bg-overlay\b/
const EXPLICIT_TRANSPARENT_BG = /^(?:transparent|none)\b/i
const CSS_ALPHA = /^[+-]?(?:\d+|\d*\.\d+)(?:e[+-]?\d+)?(%?)$/i

function parseCssAlpha(value) {
  const match = value.match(CSS_ALPHA)
  if (!match) return null
  return Number.parseFloat(value) / (match[1] ? 100 : 1)
}

function readSurfaceDeclarations(body) {
  const source = `${blankCssComments(body)};`
  const backgrounds = []
  let hasBackdropFilter = false
  let hasLowOpacity = false
  let braceDepth = 0
  let start = 0
  for (const { token, index } of stylesheetDelimiters(source)) {
    if (token === '{') braceDepth++
    if (token === '}') braceDepth--
    if (token !== ';' || braceDepth !== 0) continue

    const declaration = source.slice(start, index).match(SURFACE_DECLARATION)
    start = index + 1
    if (!declaration) continue

    const property = declaration[1].toLowerCase()
    const value = declaration[2].replace(/!\s*important\s*$/i, '').trim()
    if (!value) continue
    if (property === 'background' || property === 'background-color') {
      backgrounds.push(value)
    } else if (property === 'opacity') {
      hasLowOpacity ||= (parseCssAlpha(value) ?? 1) < 1
    } else {
      hasBackdropFilter = true
    }
  }
  return { backgrounds, hasBackdropFilter, hasLowOpacity }
}

/** 判断规则体中是否有提供不透明底色的 background 或 background-color 声明。 */
export function hasOpaqueBackdrop(body) {
  return readSurfaceDeclarations(body).backgrounds.some(isOpaqueColorValue)
}

/** 单个颜色值是否不透明（递归处理 var() 回退）。 */
function isOpaqueColorValue(value) {
  const v = String(value).trim().toLowerCase()
  if (!v) return false
  if (/^(transparent|none|unset|inherit|initial|revert(?:-layer)?)$/.test(v)) return false
  const varMatch = v.match(/^var\(\s*(--[a-z0-9-]+)\s*(?:,\s*([\s\S]+))?\)$/)
  if (varMatch) {
    const token = varMatch[1]
    // 裸 var()：只有「已知宿主未定义」的令牌才算透明（令牌不存在时整条声明失效）。
    // 其余裸 var() 沿用既有规范，不误伤已定义的层级令牌。
    if (!varMatch[2]) return !KNOWN_UNDEFINED_TOKENS.has(token)
    return isOpaqueColorValue(varMatch[2])
  }
  if (/^#[0-9a-f]{8}$/.test(v)) return v.slice(-2) === 'ff'
  if (/^#[0-9a-f]{4}$/.test(v)) return v.slice(-1) === 'f'
  if (/^#[0-9a-f]{3}$|^#[0-9a-f]{6}$/.test(v)) return true
  const modernAlpha = v.match(/^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([\s\S]*\/\s*([^\s)]+)\s*\)$/)?.[1]
  const legacyAlpha = v.match(/^(?:rgba?|hsla?)\([^(),]+,[^(),]+,[^(),]+,\s*([^(),]+)\)$/)?.[1].trim()
  const alpha = parseCssAlpha(modernAlpha ?? legacyAlpha ?? '')
  if (alpha !== null) return alpha >= 1
  if (/^(?:rgba|hsla)\(/.test(v)) return false
  if (/^(?:rgb|hsl)\(/.test(v)) return true
  if (/color-mix\(/.test(v)) {
    if (/transparent/.test(v)) {
      // color-mix 只有在不含 transparent 时才可能不透明
      return false
    }
    return true
  }
  if (/gradient\(/.test(v)) return !/transparent|rgba\(/.test(v)
  return true
}

/**
 * 核心检查函数：扫描文件内容中的透明穿透违规项
 * @param {string} content 代码内容
 * @param {string} filePath 文件路径（用于定位与报告）
 * @returns {Array<{ rule: string, file: string, line: number, message: string, fatal: boolean }>}
 */
export function checkContentForTransparencyViolations(content, filePath = 'snippet.css') {
  const violations = []
  // 在客户端和画布中识别不同命名空间下的浮层容器。
  const canvas = CANVAS_SOURCE.test(normalizePath(filePath))
  const ruleBlocks = extractCssRuleBlocks(content, { canvas, stylesheet: /\.css$/i.test(filePath) })

  // 同组变体可以复用基础底色，改写表面的规则仍须逐块检查。
  const groups = new Map()
  for (const block of ruleBlocks) {
    const keys = block.containerKeys
    if (keys.length === 0) continue
    const surface = readSurfaceDeclarations(block.body)
    const checkSurfaceOverride = canvas
      ? keys.some((key) => !CANVAS_FLOATING_WRAPPERS.has(key.slice(1)))
      : block.nestedOverride
    const entry = { ...block, ...surface, checkSurfaceOverride }
    for (const key of new Set(keys)) {
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(entry)
    }
  }

  const checkedBlocks = new Set()
  for (const [key, blocks] of groups) {
    const hasOpaque = blocks.some((block) => !block.startingStyle && block.backgrounds.some(isOpaqueColorValue))
    const first = blocks[0]
    for (const block of blocks) {
      const {
        selector, containerKeys, body, index, startingStyle,
        backgrounds, hasBackdropFilter, hasLowOpacity, checkSurfaceOverride,
      } = block
      const trimmed = selector.trim()
      const selectorLabel = containerKeys?.some((container) => !trimmed.includes(container))
        ? `${trimmed} → ${containerKeys.join(', ')}`
        : trimmed
      if (checkedBlocks.has(index)) continue
      checkedBlocks.add(index)
      if (!canvas && /exempt-popover-blur|exempt-bg-overlay|exempt-opaque-bg/.test(body)) continue
      const lineNum = content.slice(0, index).split('\n').length

      // 2.1 严禁 backdrop-filter 伪毛玻璃透底
      if (hasBackdropFilter) {
        violations.push({
          rule: 'POPOVER_NO_BACKDROP_BLUR',
          file: filePath,
          line: lineNum,
          fatal: !isRegisteredDebt('POPOVER_NO_BACKDROP_BLUR', filePath, trimmed),
          message: `浮层容器 [${selectorLabel}] 严禁使用 backdrop-filter 伪毛玻璃滤镜造成透底！必须使用实体不透明背景。`,
        })
      }

      // 画布只检查表面声明，客户端保留历史令牌诊断范围。
      const tokenValues = canvas ? backgrounds.join('\n') : body
      // 2.2 严禁裸写未定义令牌 var(--dsw-alias-bg-elevated)（无回退时计算值退化为 transparent）
      if (BARE_BG_ELEVATED.test(tokenValues)) {
        const debt = isRegisteredDebt('NO_BARE_BG_ELEVATED', filePath, trimmed)
        violations.push({
          rule: 'NO_BARE_BG_ELEVATED',
          file: filePath,
          line: lineNum,
          fatal: !debt,
          message: `浮层容器 [${selectorLabel}] 严禁裸写 var(--dsw-alias-bg-elevated)：该令牌宿主未定义，无回退时整条声明失效、背景退化为 transparent。`,
        })
      }

      // 2.3b 严禁浮层显式声明 transparent / none 底色（把自己的表面打掉）
      if (backgrounds.some((value) => EXPLICIT_TRANSPARENT_BG.test(value))) {
        violations.push({
          rule: 'POPOVER_EXPLICIT_TRANSPARENT_BG',
          file: filePath,
          line: lineNum,
          message: `浮层容器 [${selectorLabel}] 严禁显式声明 transparent / none 底色 —— 浮层必须有实体不透明表面。`,
          fatal: true,
        })
      }

      // 2.3 严禁滥用 --dsw-alias-bg-overlay（深色下为 #61666b 中浅灰）
      if (OVERLAY_BG.test(tokenValues)) {
        violations.push({
          rule: 'POPOVER_NO_BG_OVERLAY_DISCOLORATION',
          file: filePath,
          line: lineNum,
          message: `浮层容器 [${selectorLabel}] 严禁使用 --dsw-alias-bg-overlay（深色下计算值为 #61666b 中浅灰）造成灰度倒挂。`,
          fatal: true,
        })
      }

      if (!checkSurfaceOverride) continue
      const hasNonOpaqueBackground = backgrounds.some((value) =>
        !EXPLICIT_TRANSPARENT_BG.test(value) && !BARE_BG_ELEVATED.test(value) && !isOpaqueColorValue(value)
      )
      if (hasNonOpaqueBackground) {
        violations.push({
          rule: 'POPOVER_NON_OPAQUE_BG',
          file: filePath,
          line: lineNum,
          message: `浮层容器 [${selectorLabel}] 的 background / background-color 声明必须提供实体不透明底色。`,
          fatal: true,
        })
      }
      if (hasLowOpacity && !startingStyle) {
        violations.push({
          rule: 'POPOVER_LOW_OPACITY',
          file: filePath,
          line: lineNum,
          message: `浮层容器 [${selectorLabel}] 的稳态 opacity 不能小于 1。`,
          fatal: true,
        })
      }
    }

    // 2.4 整组（基础类 + 全部变体）必须至少声明一次不透明底色 —— 这条是本类缺陷的兜底规则：
    //     只要底色是裸 var(...)（不写回退），令牌一旦改名/不存在就会静默变透明。
    if (!hasOpaque && (!canvas || CANVAS_CARD_CLASSES.has(key.slice(1)))) {
      violations.push({
        rule: 'POPOVER_MUST_HAVE_OPAQUE_BG',
        file: filePath,
        line: content.slice(0, first.index).split('\n').length,
        // A canvas surface paints its own background. Client component wrappers
        // can inherit the surface from the host or share it with another rule.
        fatal: canvas,
        message: `浮层容器 [${key}] 未声明不透明背景。`,
      })
    }
  }

  return violations
}

/**
 * 扫描整个工程或指定插件目录
 */
export function scanPopoverOpacity(options = {}) {
  const rootDir = options.dir || DEFAULT_PLUGINS_DIR
  const files = collectSourceFiles(rootDir).filter((file) => {
    const path = normalizePath(file)
    return path.includes('/src/client/') || CANVAS_SOURCE.test(path)
  })
  const allViolations = []

  for (const file of files) {
    const content = readFileSync(file, 'utf8')
    const fileViolations = checkContentForTransparencyViolations(content, file)
    allViolations.push(...fileViolations)
  }

  return {
    scannedFiles: files.length,
    violations: allViolations,
  }
}

// CLI 执行入口
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log('== OmniMux 浮层防透光与 Token 兜底硬门禁扫描 (Guard Popover Opacity) ==')
  const { scannedFiles, violations } = scanPopoverOpacity()
  console.log(`扫描完成：共分析 ${scannedFiles} 个源文件。`)

  const fatalViolations = violations.filter((v) => v.fatal)

  if (fatalViolations.length > 0) {
    console.error(`\n✗ 发现 ${fatalViolations.length} 处透明透底严重违规 (FATAL):`)
    for (const v of fatalViolations) {
      const relPath = relative(REPO_ROOT, v.file).replace(/\\/g, '/')
      console.error(`  [${v.rule}] ${relPath}:${v.line} -> ${v.message}`)
    }
    console.error('\n🚫 硬门禁阻断：浮层必须使用亮暗主题下均不透明的背景。')
    process.exit(1)
  } else {
    console.log('✓ 浮层防透底硬门禁检查通过：客户端与画布浮层规则通过（0 阻断项）。')
    process.exit(0)
  }
}
