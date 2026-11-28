import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const libIndexPath = join(root, '..', 'lib', 'index.js')

describe('dsh-ui-kit motion language and state-change primitives', () => {
  it('defines unified --omx-* motion tokens with 3 physical curves + linear and reduced-motion collapse', () => {
    const tokensSrc = readFileSync(join(here, 'tokens.ts'), 'utf8')
    const builtLib = readFileSync(libIndexPath, 'utf8')

    assert.match(tokensSrc, /easeOut:\s*["']cubic-bezier\(0\.16,\s*1,\s*0\.3,\s*1\)["']/)
    assert.match(tokensSrc, /easeSpatial:\s*["']cubic-bezier\(0\.32,\s*0\.72,\s*0,\s*1\)["']/)
    assert.match(tokensSrc, /easeExit:\s*["']cubic-bezier\(0\.32,\s*0,\s*0\.67,\s*0\)["']/)
    assert.match(tokensSrc, /durPress:\s*["']90ms["']/)
    assert.match(tokensSrc, /durFast:\s*["']140ms["']/)
    assert.match(tokensSrc, /durBase:\s*["']200ms["']/)
    assert.match(tokensSrc, /durSheet:\s*["']260ms["']/)
    assert.match(tokensSrc, /--omx-dur-press:\s*\$\{MOTION_VARS\.durPress\}/)
    assert.match(tokensSrc, /--omx-dur-fast:\s*\$\{MOTION_VARS\.durFast\}/)
    assert.match(tokensSrc, /--omx-dur-base:\s*\$\{MOTION_VARS\.durBase\}/)
    assert.match(tokensSrc, /--omx-dur-sheet:\s*\$\{MOTION_VARS\.durSheet\}/)
    assert.match(tokensSrc, /@media\s*\(prefers-reduced-motion:\s*reduce\)/)
    assert.match(tokensSrc, /--omx-dur-press:\s*0ms/)
    assert.match(tokensSrc, /--omx-press-scale:\s*1/)

    assert.match(builtLib, /omx-motion-tokens/)
    assert.match(builtLib, /--omx-ease-out:/)
    assert.match(builtLib, /--omx-ease-spatial:/)
    assert.match(builtLib, /--omx-ease-exit:/)
    for (const sym of ['MOTION_VARS', 'MOTION_TOKENS_CSS', 'ensureMotionTokens', 'usePresence', 'IconSwap', 'AnimatedNumber']) {
      assert.ok(builtLib.includes(sym), `missing export ${sym} in built lib/index.js`)
    }
  })

  it('implements IconSwap as pure-compositor scale(0.65 -> 1) + opacity without blur filter', () => {
    const css = readFileSync(join(here, 'IconSwap.module.css'), 'utf8')
    assert.match(css, /scale\(0\.65\)/)
    assert.match(css, /scale\(1\)/)
    assert.doesNotMatch(css, /blur\(/i)
    assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/)
  })

  it('implements usePresence with interruptible lifecycle and SSR/reduced-motion synchronous fallback', () => {
    const src = readFileSync(join(here, 'usePresence.ts'), 'utf8')
    assert.match(src, /cancelAnimationFrame/)
    assert.match(src, /clearTimeout/)
    assert.match(src, /usePrefersReducedMotion/)
    assert.match(src, /typeof window !== "undefined"/)
  })

  it('fixes Drawer teleport with usePresence, keeps modal side effects bound to open, and removes mask backdrop-filter', () => {
    const drawerTsx = readFileSync(join(root, 'drawer/Drawer.tsx'), 'utf8')
    const drawerCss = readFileSync(join(root, 'drawer/Drawer.module.css'), 'utf8')
    assert.match(drawerTsx, /usePresence\(open,\s*190\)/)
    assert.match(drawerTsx, /aria-hidden=\{!open \|\| undefined\}/)
    assert.match(drawerTsx, /data-phase=\{phase\}/)
    assert.match(drawerCss, /\.root\[data-phase="exiting"\]\s*\{[^}]*pointer-events:\s*none/)
    assert.match(drawerCss, /translate3d\(100%,\s*0,\s*0\)/)
    assert.doesNotMatch(drawerCss, /backdrop-filter/)
    assert.match(drawerCss, /@media\s*\(prefers-reduced-motion:\s*reduce\)/)
  })

  it('implements Tabs sliding indicator with zero bold-weight jitter, zero DOM text duplication, and hidden keepalive fallback', () => {
    const tabsTsx = readFileSync(join(root, 'tabs/Tabs.tsx'), 'utf8')
    const tabsCss = readFileSync(join(root, 'tabs/Tabs.module.css'), 'utf8')
    assert.match(tabsTsx, /ResizeObserver/)
    assert.match(tabsTsx, /--ind-x/)
    assert.match(tabsTsx, /--ind-w/)
    assert.match(tabsTsx, /data-indicator/)
    assert.match(tabsTsx, /data-label=/)
    assert.doesNotMatch(tabsTsx, /labelGhost/)
    assert.match(tabsCss, /font-variant-numeric:\s*tabular-nums/)
    assert.doesNotMatch(tabsCss, /transition:[^;]*font-weight/)
    assert.match(tabsCss, /\.label\[data-label\]::after\s*\{[^}]*font-weight:\s*600/)
    assert.match(tabsCss, /@media\s*\(prefers-reduced-motion:\s*reduce\)/)
  })

  it('fixes PageHeader frozen spinner, CopyButton zero width shift (without DOM text duplication), and SelectableTile stroke checkmark', () => {
    const headerTsx = readFileSync(join(root, 'stage/PageHeader.tsx'), 'utf8')
    const headerCss = readFileSync(join(root, 'stage/PageHeader.module.css'), 'utf8')
    assert.match(headerTsx, /REFRESH_SPIN_CLASS/)
    assert.doesNotMatch(headerTsx, /IconLoadingOutline16/)
    assert.match(headerCss, /@keyframes dshUkRefreshSpin/)
    assert.match(headerCss, /@keyframes dshUkRefreshPulse/)

    const copyTsx = readFileSync(join(root, 'button/CopyButton.tsx'), 'utf8')
    const copyCss = readFileSync(join(root, 'button/CopyButton.module.css'), 'utf8')
    assert.match(copyTsx, /<IconSwap/)
    assert.match(copyTsx, /data-idle-label=/)
    assert.doesNotMatch(copyTsx, /labelGhost/)
    assert.match(copyCss, /\.labelSlot\[data-idle-label\]::before/)
    assert.match(copyCss, /\.labelSlot\[data-copied-label\]::after/)

    const tileCss = readFileSync(join(root, 'tile/SelectableTile.module.css'), 'utf8')
    assert.match(tileCss, /stroke-dashoffset/)
    assert.match(tileCss, /@media\s*\(prefers-reduced-motion:\s*reduce\)/)

    const btnCss = readFileSync(join(root, 'button/Button.module.css'), 'utf8')
    assert.match(btnCss, /dshUkPulseReduced/)
    assert.doesNotMatch(btnCss, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.spinner\s*\{\s*animation:\s*none/)
  })

  it('provides opt-in AnimatedNumber and tabular-nums on StatBar', () => {
    const numTsx = readFileSync(join(here, 'AnimatedNumber.tsx'), 'utf8')
    const numCss = readFileSync(join(here, 'AnimatedNumber.module.css'), 'utf8')
    const statCss = readFileSync(join(root, 'stat/StatBar.module.css'), 'utf8')
    assert.match(numTsx, /animate = false/)
    assert.match(numCss, /font-variant-numeric:\s*tabular-nums/)
    assert.match(statCss, /font-variant-numeric:\s*tabular-nums/)
  })
})
