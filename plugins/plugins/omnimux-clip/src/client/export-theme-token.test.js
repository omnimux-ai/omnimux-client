/**
 * Export 导出按钮双主题 Token 契约测试。
 *
 * 背景：Export 按钮把文字 / 箭头描边 / 分隔线全部写死成白色
 * （`text-white`、`border-white/25`、`stroke="#fff"`、`hover:bg-accent/90`）。
 * 深色主题下侥幸正确，一旦 DSH 宿主切到浅色主题，白字压在浅色 accent 上就废了。
 *
 * 契约：
 *   1. Export 相关文件零硬编码白色 —— 只消费 token 类；
 *   2. 正确消费 text-accent-fg / border-accent-divider / stroke="currentColor" /
 *      hover:bg-accent-strong；
 *   3. --accent-divider 在 dsw-map.css 里由 --accent-fg 派生定义；
 *   4. tailwind.openreel.config.js 里 accent.divider 映射到 var(--accent-divider)；
 *   5. token 链路闭合：CSS 变量 → tailwind 配置 → 组件类名，三者对得上。
 *
 * 同样先解析再断言，避免"注释里写了就算过"的假阳性。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = join(HERE, '..', '..')

const TOOLBAR_TSX = join(HERE, 'openreel/web/components/editor/Toolbar.tsx')
const MOTION_TSX = join(HERE, 'openreel/web/motion/MotionCreatorShell.tsx')
const DSW_MAP_CSS = join(HERE, 'theme/dsw-map.css')
const TAILWIND_CONFIG = join(PLUGIN_ROOT, 'tailwind.openreel.config.js')

/** 剥掉 // 与 /* *\/ 注释，避免注释文本污染扫描结果。 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

const TOOLBAR_SRC = stripComments(readFileSync(TOOLBAR_TSX, 'utf8'))
const MOTION_SRC = stripComments(readFileSync(MOTION_TSX, 'utf8'))
const DSW_MAP_SRC = stripComments(readFileSync(DSW_MAP_CSS, 'utf8'))
const TAILWIND_SRC = stripComments(readFileSync(TAILWIND_CONFIG, 'utf8'))

const EXPORT_FILES = [
  { name: 'Toolbar.tsx', src: TOOLBAR_SRC },
  { name: 'MotionCreatorShell.tsx', src: MOTION_SRC },
]

// ─── 维度一：零硬编码白色 ────────────────────────────────────────────────
test('export-theme-token: Export 文件无硬编码 text-white', () => {
  for (const { name, src } of EXPORT_FILES) {
    assert.ok(
      !/\btext-white\b/.test(src),
      `${name} 仍残留 text-white，必须改为 text-accent-fg`,
    )
  }
})

test('export-theme-token: Export 文件无硬编码 border-white/25', () => {
  for (const { name, src } of EXPORT_FILES) {
    assert.ok(
      !/\bborder-white\/\d+\b/.test(src),
      `${name} 仍残留 border-white/25 之类的硬编码白线，必须改为 border-accent-divider`,
    )
  }
})

test('export-theme-token: Export 文件无硬编码 stroke="#fff"', () => {
  for (const { name, src } of EXPORT_FILES) {
    assert.ok(
      !/stroke="#(fff|ffffff|FFF|FFFFFF)"/i.test(src),
      `${name} 仍残留硬编码白色描边，必须改为 stroke="currentColor"`,
    )
  }
})

// ─── 维度二：正确消费 token ─────────────────────────────────────────────
test('export-theme-token: 主导出按钮消费 text-accent-fg', () => {
  for (const { name, src } of EXPORT_FILES) {
    assert.ok(
      /\btext-accent-fg\b/.test(src),
      `${name} 的主导出按钮必须用 text-accent-fg 取色`,
    )
  }
})

test('export-theme-token: 下拉箭头分隔线消费 border-accent-divider', () => {
  for (const { name, src } of EXPORT_FILES) {
    assert.ok(
      /\bborder-accent-divider\b/.test(src),
      `${name} 的箭头分隔线必须用 border-accent-divider 取色`,
    )
  }
})

test('export-theme-token: Toolbar 内联箭头 SVG 消费 stroke="currentColor"', () => {
  // Toolbar 的箭头是内联 SVG，描边必须跟随父级 currentColor（= text-accent-fg）
  assert.ok(
    /stroke="currentColor"/.test(TOOLBAR_SRC),
    'Toolbar.tsx 内联箭头 SVG 必须 stroke="currentColor"',
  )
})

test('export-theme-token: Motion 导出按钮 hover 消费 bg-accent-strong', () => {
  assert.ok(
    /\bhover:bg-accent-strong\b/.test(MOTION_SRC),
    'MotionCreatorShell 的 Export hover 必须用 hover:bg-accent-strong（不是 /90 透明裁剪）',
  )
  // 只在 ExportButton 组件体内做检查 —— 文件里还有一处与本改动无关的
  // 分栏 resize handle（hover:bg-accent/35），属于官方既有实现，不在本次范围内。
  const start = MOTION_SRC.indexOf('function ExportButton')
  assert.ok(start > -1, 'MotionCreatorShell 应包含 ExportButton 组件')
  const body = MOTION_SRC.slice(start, MOTION_SRC.indexOf('\nfunction ', start + 10))
  assert.ok(
    !/hover:bg-accent\/\d+/.test(body),
    'ExportButton 内不得再出现 hover:bg-accent/90 这类硬编码透明度',
  )
  assert.ok(
    (body.match(/hover:bg-accent-strong/g) || []).length >= 2,
    'ExportButton 主按钮与箭头按钮的 hover 都应使用 hover:bg-accent-strong',
  )
})

test('export-theme-token: Export 按钮文字色与箭头色同源（不出现游离白色）', () => {
  // 箭头按钮：底色是 accent，前景色必须也是 accent-fg，不能留白。
  // Toolbar 的箭头底色走内联 style（background: "var(--accent)"），
  // Motion 的走 bg-accent 类名 —— 两种写法都要能覆盖到。
  for (const { name, src } of EXPORT_FILES) {
    const blockStart = src.indexOf('openreel-export-btn-chevron')
    assert.ok(blockStart > -1, `${name} 缺少 openreel-export-btn-chevron 标记`)
    const block = src.slice(blockStart, blockStart + 700)
    assert.ok(
      /\bbg-accent\b/.test(block) || /background:\s*"var\(--accent\)"/.test(block),
      `${name} 箭头按钮底色应仍为 accent（类名或内联 var(--accent)）`,
    )
    assert.ok(!/text-white/.test(block), `${name} 箭头按钮不得使用 text-white`)
    assert.ok(
      /border-accent-divider/.test(block),
      `${name} 箭头按钮分隔线应为 border-accent-divider`,
    )
  }
})

// ─── 维度三：CSS 变量定义 ───────────────────────────────────────────────
test('export-theme-token: dsw-map.css 定义 --accent-divider', () => {
  const def = DSW_MAP_SRC.match(/--accent-divider:\s*([^;]+);/)
  assert.ok(def, 'dsw-map.css 必须定义 --accent-divider')
  const value = def[1].trim()
  // 必须由 --accent-fg 派生，双主题才能自动跟随
  assert.ok(
    value.includes('--accent-fg'),
    `--accent-divider 必须由 --accent-fg 派生，实际: ${value}`,
  )
  assert.ok(
    value.includes('color-mix'),
    `--accent-divider 应使用 color-mix 做透明度混合，实际: ${value}`,
  )
})

test('export-theme-token: dsw-map.css 的 accent 三件套映射完整', () => {
  for (const token of ['--accent', '--accent-strong', '--accent-fg', '--accent-divider']) {
    const re = new RegExp(`${token}:\\s*([^;]+);`)
    const m = DSW_MAP_SRC.match(re)
    assert.ok(m, `dsw-map.css 缺少 ${token} 定义`)
    assert.ok(
      m[1].includes('--dsw-') || token === '--accent-divider',
      `${token} 必须映射到 DSH 原生 --dsw-* token（divider 允许由 accent-fg 派生），实际: ${m[1].trim()}`,
    )
  }
})

test('export-theme-token: dsw-map.css 不引入裸色值作为 accent 主色', () => {
  // accent / accent-strong / accent-fg 三者的首选值必须是 --dsw-*（兜底值允许 oklch/hex）
  for (const token of ['--accent', '--accent-strong', '--accent-fg']) {
    const m = DSW_MAP_SRC.match(new RegExp(`${token}:\\s*var\\(([^)]+)\\)`))
    assert.ok(m, `${token} 必须以 var(--dsw-*) 为首选值`)
    assert.ok(m[1].includes('--dsw-'), `${token} 首选值必须是 --dsw-* token，实际: ${m[1]}`)
  }
})

// ─── 维度四：Tailwind 配置映射 ──────────────────────────────────────────
test('export-theme-token: tailwind 配置补齐 accent.divider', () => {
  assert.ok(
    /divider:\s*'var\(--accent-divider\)'/.test(TAILWIND_SRC),
    'tailwind.openreel.config.js 必须把 accent.divider 映射到 var(--accent-divider)',
  )
})

test('export-theme-token: tailwind accent 调色板字段齐全', () => {
  const accentBlock = TAILWIND_SRC.slice(
    TAILWIND_SRC.indexOf('accent: {'),
    TAILWIND_SRC.indexOf('},', TAILWIND_SRC.indexOf('accent: {')),
  )
  for (const key of ['DEFAULT', 'strong', 'soft', 'fg', 'divider']) {
    assert.ok(
      new RegExp(`\\b${key}:\\s*'var\\(--accent[^)]*\\)'`).test(accentBlock),
      `tailwind accent 调色板缺少 ${key} 映射`,
    )
  }
})

// ─── 维度五：链路闭合 ───────────────────────────────────────────────────
test('export-theme-token: token 链路闭合（CSS 变量 → tailwind → 组件类名）', () => {
  // 1) dsw-map.css 定义了 --accent-divider
  assert.ok(DSW_MAP_SRC.includes('--accent-divider'), 'dsw-map.css 未定义 --accent-divider')
  // 2) tailwind 把它暴露成 border-accent-divider 工具类
  assert.ok(
    TAILWIND_SRC.includes("divider: 'var(--accent-divider)'"),
    'tailwind 未暴露 accent.divider',
  )
  // 3) 组件确实消费了 border-accent-divider
  assert.ok(
    EXPORT_FILES.every(({ src }) => src.includes('border-accent-divider')),
    '组件未消费 border-accent-divider，链路断裂（Tailwind 未扫描到该类名则不会生成）',
  )
})

test('export-theme-token: token 类名写在静态字符串里（Tailwind 能扫到）', () => {
  // Tailwind 靠静态扫描 source 提取类名；类名若由模板拼接生成会被 tree-shake 掉。
  for (const { name, src } of EXPORT_FILES) {
    for (const cls of ['bg-accent', 'text-accent-fg', 'border-accent-divider']) {
      const re = new RegExp(`['"\`][^'"\`]*\\b${cls}\\b[^'"\`]*['"\`]`)
      assert.ok(re.test(src), `${name} 的 ${cls} 必须出现在静态字符串字面量中，否则 Tailwind 扫不到`)
    }
  }
  assert.ok(
    /['"\`][^'"\`]*\bhover:bg-accent-strong\b[^'"\`]*['"\`]/.test(MOTION_SRC),
    'hover:bg-accent-strong 必须出现在静态字符串字面量中',
  )
})

test('export-theme-token: 无已废弃的 --omx-* 变量残留', () => {
  for (const src of [DSW_MAP_SRC, TOOLBAR_SRC, MOTION_SRC]) {
    assert.ok(!src.includes('--omx-'), '禁止使用已废弃的 --omx-* 变量命名空间')
  }
})
