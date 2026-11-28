import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pluginsRoot = resolve(here, '..')
const repoRoot = resolve(pluginsRoot, '..')

const EXCLUDE_DIRS = new Set([
  'node_modules',
  'lib',
  'dist',
  'dist-harness',
  'build',
  'coverage',
  '.git',
  'openreel',
  'preset',
  'deepseek-harness',
  'tests',
  'fixtures',
  'test-mocks',
])

const STYLE_FILE_RE = /(?:styles?\.[jt]sx?$|\.module\.css$|\.css$|dockStyles\.ts$|folderStyles\.js$|desktop-settings-styles\.ts$|plugin-controls-styles\.ts$|extended-styles\.ts$)/i

function collectFiles(dir, predicate) {
  const out = []
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.has(entry.name)) continue
      out.push(...collectFiles(full, predicate))
    } else if (entry.isFile()) {
      if (/\.(test|spec)\.[a-z0-9]+$/i.test(entry.name)) continue
      if (predicate(full, entry.name)) out.push(full)
    }
  }
  return out
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\r\n]/g, ' '))
    .replace(/^\s*\/\/.*$/gm, '')
}

function findGovernedSourceRoots() {
  return [
    join(pluginsRoot, 'packages', 'dsh-ui-kit', 'src'),
    join(pluginsRoot, 'plugins'),
    join(repoRoot, 'app', 'dsh-desktop-next', 'src'),
    join(repoRoot, 'app', 'dsh-plugin-desktop', 'src'),
  ].filter((d) => statSync(d, { throwIfNoEntry: false })?.isDirectory())
}

// Extract CSS chunks either from raw .css/.module.css files or template/string style files.
function readStyleContent(file) {
  const raw = readFileSync(file, 'utf8')
  if (file.endsWith('.css')) return raw
  // For JS/TS style modules, keep comments stripped so docstring mentions don't trigger.
  return stripComments(raw)
}

const KNOWN_KEYFRAME_ALLOWLIST = new Set([
  'none',
  'initial',
  'inherit',
  'unset',
  'revert',
  'revert-layer',
  'running',
  'paused',
  'infinite',
  'alternate',
  'alternate-reverse',
  'reverse',
  'normal',
  'forwards',
  'backwards',
  'both',
  'ease',
  'ease-in',
  'ease-out',
  'ease-in-out',
  'linear',
  'step-start',
  'step-end',
])

const DEFINED_OR_HOST_KEYFRAMES = new Set([
  'spin',
  'pulse',
  'ping',
  'bounce',
  // Tailwind CSS animate-spin utility keyframe provided in tailwind builds
  'enter',
  'exit',
  // Host-injected shared popover/menu keyframes in DSH runtime or sibling bundles
  'omnimux-popover-in',
  'omnimux-menu-pop',
  'ds-spin',
  'dshSpin',
])

describe('Apple motion system static contract gate', () => {
  it('forbids transition: all and Tailwind transition-all across all governed UI sources', () => {
    const roots = findGovernedSourceRoots()
    const hits = []

    for (const root of roots) {
      const files = collectFiles(
        root,
        (full, name) =>
          (name.endsWith('.css') ||
            name.endsWith('.js') ||
            name.endsWith('.jsx') ||
            name.endsWith('.ts') ||
            name.endsWith('.tsx')) &&
          !full.includes('/preset/') &&
          !full.includes('/openreel/'),
      )

      for (const file of files) {
        const cleaned = stripComments(readFileSync(file, 'utf8'))
        const lines = cleaned.split('\n')
        lines.forEach((line, idx) => {
          if (/\btransition\s*:\s*all\b/i.test(line) || /\btransition-all\b/.test(line)) {
            hits.push(`${relative(repoRoot, file)}:${idx + 1}: ${line.trim().slice(0, 120)}`)
          }
        })
      }
    }

    assert.deepEqual(
      hits,
      [],
      `Found prohibited transition: all / transition-all rules:\n${hits.join('\n')}`,
    )
  })

  it('defines unified --omx-* motion tokens in dsh-ui-kit and propagates them across isolated roots', () => {
    const tokensFile = join(pluginsRoot, 'packages', 'dsh-ui-kit', 'src', 'motion', 'tokens.ts')
    assert.ok(existsSync(tokensFile), 'dsh-ui-kit/src/motion/tokens.ts must exist')
    const tokensText = readFileSync(tokensFile, 'utf8')
    for (const token of [
      '--omx-ease-out',
      '--omx-ease-spatial',
      '--omx-ease-exit',
      '--omx-dur-press',
      '--omx-dur-fast',
      '--omx-dur-base',
      '--omx-dur-sheet',
      '--omx-press-scale',
      '@media (prefers-reduced-motion: reduce)',
    ]) {
      assert.ok(tokensText.includes(token), `Missing ${token} in dsh-ui-kit tokens.ts`)
    }

    for (const isolatedCss of [
      'plugins/plugins/omnimux-browser/extension/src/panel/styles.css',
      'plugins/plugins/omnimux-browser/extension/welcome/welcome.css',
      'app/dsh-desktop-next/src/native-ui/theme.css',
      'app/dsh-plugin-desktop/src/native-ui/shared/theme.css',
    ]) {
      const full = join(repoRoot, isolatedCss)
      assert.ok(existsSync(full), `Expected isolated stylesheet ${isolatedCss}`)
      const content = readFileSync(full, 'utf8')
      assert.match(content, /--omx-ease-out\s*:/, `${isolatedCss} must declare --omx-ease-out`)
      assert.match(content, /--omx-ease-spatial\s*:/, `${isolatedCss} must declare --omx-ease-spatial`)
      assert.match(content, /@media\s*\(prefers-reduced-motion:\s*reduce\)/, `${isolatedCss} must handle prefers-reduced-motion`)
    }
  })

  it('has zero undefined @keyframes references across governed CSS stylesheets', () => {
    const cssFiles = collectFiles(
      pluginsRoot,
      (full, name) =>
        (name.endsWith('.css') || (name.endsWith('.js') && full.includes('/src/client/') && STYLE_FILE_RE.test(name))) &&
        !full.includes('/openreel/'),
    )
    cssFiles.push(
      ...collectFiles(
        join(repoRoot, 'app', 'dsh-desktop-next', 'src'),
        (_f, name) => name.endsWith('.css') || STYLE_FILE_RE.test(name),
      ),
      ...collectFiles(
        join(repoRoot, 'app', 'dsh-plugin-desktop', 'src'),
        (_f, name) => name.endsWith('.css') || STYLE_FILE_RE.test(name),
      ),
    )

    const allDefined = new Set(DEFINED_OR_HOST_KEYFRAMES)
    const fileTexts = cssFiles.map((file) => {
      const content = readStyleContent(file)
      for (const m of content.matchAll(/@keyframes\s+([A-Za-z_][\w-]*)/g)) {
        allDefined.add(m[1])
      }
      return { file, content }
    })

    const missing = []
    for (const { file, content } of fileTexts) {
      for (const m of content.matchAll(/\banimation(?:-name)?\s*:\s*([^;}{]+);/g)) {
        const val = m[1].trim()
        if (!val || val.includes('${') || val.startsWith('var(')) continue
        // Split comma-separated multi-animations; first non-keyword, non-number/timing ident per layer is keyframe name
        for (const layer of val.split(',')) {
          const tokens = layer.trim().split(/\s+/)
          for (const tok of tokens) {
            if (!tok || /^[0-9.]/.test(tok) || /^cubic-bezier|^steps|^var\(/.test(tok)) continue
            const ident = tok.replace(/!important$/i, '').trim()
            if (!ident || KNOWN_KEYFRAME_ALLOWLIST.has(ident)) continue
            if (!/^[A-Za-z_][\w-]*$/.test(ident)) continue
            if (!allDefined.has(ident)) {
              missing.push(`${relative(repoRoot, file)} -> missing @keyframes ${ident} (in: "${val}")`)
            }
            break
          }
        }
      }
    }

    assert.deepEqual(
      missing,
      [],
      `Found undefined @keyframes references:\n${missing.join('\n')}`,
    )
  })

  it('requires prefers-reduced-motion handling in animated governed stylesheets and keeps panel reduced-motion un-overridden', () => {
    const roots = findGovernedSourceRoots()
    const missingReduce = []

    for (const root of roots) {
      const files = collectFiles(
        root,
        (full, name) =>
          (name.endsWith('.css') ||
            (STYLE_FILE_RE.test(name) &&
              (full.includes('/src/client/') ||
                full.includes('/asset-hub/styles/') ||
                full.includes('/dsh-desktop-next/src/') ||
                full.includes('/dsh-plugin-desktop/src/')))) &&
          !full.includes('/preset/') &&
          !full.includes('/openreel/'),
      )

      for (const file of files) {
        const rel = relative(repoRoot, file)
        // Skip small component CSS modules whose transitions solely consume --omx-dur-* vars (auto-zeroed in tokens.ts) unless they run keyframes
        const content = readStyleContent(file)
        const hasKeyframe = /@keyframes\s+/.test(content)
        const hasAnimOrLiteralTrans =
          /\banimation(?:-name)?\s*:/.test(content) ||
          /\btransition\s*:\s*(?!none\b)(?!all\b)(?!.*--omx-dur-)[^;]+;/.test(content)
        if ((hasKeyframe || hasAnimOrLiteralTrans) && !/prefers-reduced-motion\s*:\s*reduce/.test(content)) {
          // If the file strictly uses --omx-dur-* variables for every non-none transition and defines no keyframes, tokens collapse them.
          const hasNonTokenTransition = /\btransition\s*:\s*(?!none\b)[^;]*(?:ms|s)\b/.test(
            content.replace(/var\(--omx-[^)]+\)/g, ''),
          )
          if (hasKeyframe || /\banimation(?:-name)?\s*:/.test(content) || hasNonTokenTransition) {
            missingReduce.push(rel)
          }
        }
      }
    }

    assert.deepEqual(
      missingReduce,
      [],
      `Stylesheets with literal transitions or keyframes missing @media (prefers-reduced-motion: reduce):\n${missingReduce.join('\n')}`,
    )

    // Specific regression check: extension panel/styles.css must place reduced-motion at EOF so no later !important rule wins
    const extPanelCssPath = join(repoRoot, 'plugins/plugins/omnimux-browser/extension/src/panel/styles.css')
    const extPanelCss = readFileSync(extPanelCssPath, 'utf8')
    const lastReduceIdx = extPanelCss.lastIndexOf('prefers-reduced-motion')
    assert.ok(lastReduceIdx > 0, 'extension panel/styles.css must contain prefers-reduced-motion')
    const tailAfterReduceStart = extPanelCss.slice(lastReduceIdx)
    // After the opening of the last reduced-motion block, wait until its closing brace pair: inspect rest of file outside the media block
    // Check there are no non-reduced-motion rules with `transition: ... !important` after the last `@media (prefers-reduced-motion: reduce)`
    let depth = 0
    let braceOpened = false
    let blockEndIdx = extPanelCss.length
    for (let i = lastReduceIdx; i < extPanelCss.length; i++) {
      if (extPanelCss[i] === '{') {
        depth++
        braceOpened = true
      } else if (extPanelCss[i] === '}') {
        depth--
        if (braceOpened && depth === 0) {
          blockEndIdx = i + 1
          break
        }
      }
    }
    const afterReduceBlock = stripComments(extPanelCss.slice(blockEndIdx)).trim()
    assert.doesNotMatch(
      afterReduceBlock,
      /transition\s*:[^;]*!important/i,
      'extension panel/styles.css must not place !important transitions after its EOF @media (prefers-reduced-motion: reduce) block',
    )
  })
})
