import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  scanPopoverOpacity,
  checkContentForTransparencyViolations,
} from '../../scripts/guard-no-transparent-popover.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const root = path.resolve(__dirname, '../../')

test('硬门禁 1: 全库实际代码防透底与 Token 兜底扫描 (0 违规通过)', () => {
  const { scannedFiles, violations } = scanPopoverOpacity()
  assert.ok(scannedFiles > 0, '必须扫描到有效的源文件')
  const fatalViolations = violations.filter((v) => v.fatal)
  assert.equal(
    fatalViolations.length,
    0,
    `全库严禁存在浮层透底违规，实际违规项: ${JSON.stringify(fatalViolations)}`
  )
})

test('硬门禁 2: sidebar-coordinator.js 不得再定义自绘探索浮层（入口已迁至官方「更多」菜单）', () => {
  const coordinatorPath = path.join(root, 'plugins/omnimux/src/client/sidebar-coordinator.js')
  assert.ok(fs.existsSync(coordinatorPath), 'sidebar-coordinator.js 必须存在')
  const content = fs.readFileSync(coordinatorPath, 'utf8')

  // 自绘「探索」常驻行与浮动菜单已退役（#3785）：该浮层的深色底约束随之失去守卫对象。
  // 若它被重新引入，就会在官方「更多」菜单之外多出一个不受本门禁约束的浮层 —— 这里挡回退。
  assert.equal(
    /\.omnimux-explore-menu\s*\{/.test(content),
    false,
    'sidebar-coordinator.js 不得再定义 .omnimux-explore-menu 浮层样式（入口已在官方「更多」菜单）'
  )
  assert.equal(
    content.includes('omnimux-sidebar-explore-styles'),
    false,
    'sidebar-coordinator.js 不得再注入探索浮层样式节点'
  )
})

test('硬门禁 3: 故障注入测试 (Fault Injection) - 验证门禁能够确定性硬拦截违规代码', () => {
  // 故障样本 A: 菜单包含 backdrop-filter 伪毛玻璃
  const faultySnippetA = `
    .omnimux-sample-menu {
      position: fixed;
      background: #1c1c1f;
      backdrop-filter: blur(16px);
    }
  `
  const violationsA = checkContentForTransparencyViolations(faultySnippetA, 'mock-a.css')
  assert.ok(
    violationsA.some((v) => v.rule === 'POPOVER_NO_BACKDROP_BLUR' && v.fatal),
    '门禁必须精确拦截包含 backdrop-filter 的浮层菜单'
  )

  // 故障样本 B: 探索菜单裸写未定义的 var(--dsw-alias-bg-elevated)
  const faultySnippetB = `
    .omnimux-explore-menu {
      position: fixed;
      background: var(--dsw-alias-bg-elevated);
    }
  `
  const violationsB = checkContentForTransparencyViolations(faultySnippetB, 'sidebar-coordinator.js')
  assert.ok(
    violationsB.some((v) => v.rule === 'NO_BARE_BG_ELEVATED' && v.fatal),
    '门禁必须精确拦截裸写未定义变量 var(--dsw-alias-bg-elevated)'
  )

  // 故障样本 C: 探索菜单滥用中浅灰 --dsw-alias-bg-overlay (#61666b) 导致严重白灰偏色
  const faultySnippetC = `
    .omnimux-explore-menu {
      position: fixed;
      background: var(--dsw-alias-bg-overlay, var(--dsw-alias-bg-layer-2, #1c1c1f));
    }
  `
  const violationsC = checkContentForTransparencyViolations(faultySnippetC, 'sidebar-coordinator.js')
  assert.ok(
    violationsC.some((v) => v.rule === 'POPOVER_NO_BG_OVERLAY_DISCOLORATION' && v.fatal),
    '门禁必须精确拦截滥用 --dsw-alias-bg-overlay 造成的浅灰偏色缺陷'
  )
})

test('画布扫描覆盖选择器组、主题覆写和不以 menu 或 popover 结尾的 Portal 表面', (t) => {
  const dir = fs.mkdtempSync(path.join(tmpdir(), 'omnimux-popover-'))
  t.after(() => fs.rmSync(dir, { recursive: true }))
  const canvas = path.join(dir, 'omnimux-workflow', 'src', 'canvas')
  const unrelated = path.join(dir, 'other', 'src', 'canvas')
  fs.mkdirSync(canvas, { recursive: true })
  fs.mkdirSync(unrelated, { recursive: true })
  const stylesheet = path.join(canvas, 'theme.css')
  fs.writeFileSync(stylesheet, [
    '/* Canvas popover rules */',
    '.ordinary-card, .wf-video-param-popover { background: var(--dsw-alias-bg-elevated); }',
    '@media (min-width: 0px) {',
    '  body[data-ds-dark-theme] > :is(.wf-custom-select-dropdown, .next-dropdown) {',
    '    background-color: var(--dsw-alias-bg-overlay);',
    '  }',
    '}',
    '.wf-attachment-preview-card { background: white; -webkit-backdrop-filter: blur(4px); }',
  ].join('\n'))
  fs.writeFileSync(path.join(unrelated, 'theme.css'), '.irrelevant-menu { backdrop-filter: blur(4px) }')

  const result = scanPopoverOpacity({ dir })
  assert.equal(result.scannedFiles, 1)
  assert.ok(result.violations.every((violation) => violation.file === stylesheet))
  for (const [rule, line] of [
    ['NO_BARE_BG_ELEVATED', 2],
    ['POPOVER_NO_BG_OVERLAY_DISCOLORATION', 4],
    ['POPOVER_NO_BACKDROP_BLUR', 8],
  ]) {
    assert.ok(result.violations.some((v) => v.fatal && v.rule === rule && v.line === line), rule)
  }
})

test('画布扫描拦截嵌套父规则在子选择器前后的违规声明', () => {
  const stylesheet = [
    '@media (min-width: 0px) {',
    '  .wf-video-param-popover {',
    '    background: var(--dsw-alias-bg-elevated);',
    '    backdrop-filter: blur(20px);',
    '    & .wf-cfg-popover__section { min-width: 0; }',
    '  }',
    '  .wf-custom-select-dropdown {',
    '    & .wf-popover-item { content: "};{"; }',
    '    background-color: var(--dsw-alias-bg-overlay)',
    '  }',
    '}',
  ].join('\n')
  const violations = checkContentForTransparencyViolations(stylesheet, 'omnimux-workflow/src/canvas/theme.css')
  for (const [rule, line] of [
    ['NO_BARE_BG_ELEVATED', 2],
    ['POPOVER_NO_BACKDROP_BLUR', 2],
    ['POPOVER_NO_BG_OVERLAY_DISCOLORATION', 7],
  ]) {
    assert.ok(violations.some((entry) => entry.rule === rule && entry.fatal && entry.line === line), rule)
  }
})

test('画布扫描分别判断嵌套父规则和子选择器的表面', () => {
  const stylesheet = [
    '.wf-video-param-popover {',
    '  & .wf-cfg-popover__section {',
    '    background: var(--dsw-alias-bg-elevated);',
    '    backdrop-filter: blur(4px);',
    '  }',
    '  background: var(--dsw-alias-bg-layer-1);',
    '}',
  ].join('\n')
  assert.deepEqual(checkContentForTransparencyViolations(stylesheet, 'omnimux-workflow/src/canvas/theme.css'), [])
})

const canvasStylesheet = 'omnimux-workflow/src/canvas/theme.css'

function assertRejectedNestedOverride(prelude) {
  const stylesheet = [
    '.wf-video-param-popover {',
    '  background: var(--dsw-alias-bg-layer-1);',
    `  ${prelude} {`,
    '    background: var(--dsw-alias-bg-elevated);',
    '    backdrop-filter: blur(20px);',
    '  }',
    '}',
  ].join('\n')
  const violations = checkContentForTransparencyViolations(stylesheet, canvasStylesheet)
  assert.deepEqual(violations.map(({ rule, line, fatal }) => [rule, line, fatal]), [
    ['POPOVER_NO_BACKDROP_BLUR', 3, true],
    ['NO_BARE_BG_ELEVATED', 3, true],
  ])
  assert.ok(violations.every(({ message }) => message.includes('.wf-video-param-popover')))
}

test('画布扫描拦截 @media 对同一浮层的覆写', () => assertRejectedNestedOverride('@media (max-width: 390px)'))
test('画布扫描拦截 @supports 对同一浮层的覆写', () => assertRejectedNestedOverride('@supports (display: grid)'))
test('画布扫描拦截 @container 对同一浮层的覆写', () => assertRejectedNestedOverride('@container canvas (max-width: 640px)'))
test('画布扫描拦截 @layer 对同一浮层的覆写', () => assertRejectedNestedOverride('@layer narrow'))
test('画布扫描拦截 @scope 对同一浮层的覆写', () => assertRejectedNestedOverride('@scope (&)'))
test('画布扫描拦截 @starting-style 对同一浮层的覆写', () => assertRejectedNestedOverride('@starting-style'))
test('画布扫描拦截裸 & 对同一浮层的覆写', () => assertRejectedNestedOverride('&'))
test('画布扫描拦截带属性选择器的 & 覆写', () => assertRejectedNestedOverride('&[data-density="compact, regular > wide"]'))
test('画布扫描拦截 &:hover 对同一浮层的覆写', () => assertRejectedNestedOverride('&:hover'))
test('画布扫描拦截带修饰类的 & 覆写', () => assertRejectedNestedOverride('&.modifier'))
test('画布扫描拦截 :is 和 :where 里的 & 覆写', () => assertRejectedNestedOverride(':is(.ordinary-card, :where(&))'))
test('画布扫描拦截同时列出子控件和浮层自身的覆写', () => assertRejectedNestedOverride('& > .child, &:focus-visible'))

test('画布扫描跨多层条件和状态块继承紧邻的浮层选择器', () => {
  const stylesheet = [
    '.ordinary-card, .wf-video-param-popover {',
    '  background: var(--dsw-alias-bg-layer-1);',
    '  @media (max-width: 390px) {',
    '    &[data-state="open"] {',
    '      @supports (display: grid) {',
    '        background-color: var(--dsw-alias-bg-overlay);',
    '      }',
    '    }',
    '  }',
    '}',
  ].join('\n')
  const violations = checkContentForTransparencyViolations(stylesheet, canvasStylesheet)
  assert.deepEqual(violations.map(({ rule, line, fatal }) => [rule, line, fatal]), [
    ['POPOVER_NO_BG_OVERLAY_DISCOLORATION', 5, true],
  ])
})

test('画布扫描在后代、子代、兄弟和伪元素规则里独立判定目标', () => {
  const declarations = 'background: var(--dsw-alias-bg-elevated); backdrop-filter: blur(4px);'
  const stylesheet = [
    '.wf-video-param-popover {',
    '  background: var(--dsw-alias-bg-layer-1);',
    `  & .wf-cfg-popover__section { @media (max-width: 390px) { ${declarations} } }`,
    `  @supports (display: grid) { & > .child { ${declarations} } }`,
    `  & + .sibling, & ~ [data-sibling] { ${declarations} }`,
    `  & [data-role="a, b > c"] { ${declarations} }`,
    `  & :is(.ordinary-card, .ordinary-section) { ${declarations} }`,
    `  &::after { ${declarations} }`,
    `  & > .wf-custom-select-dropdown { background: white; backdrop-filter: blur(4px); }`,
    '}',
  ].join('\n')
  const violations = checkContentForTransparencyViolations(stylesheet, canvasStylesheet)
  assert.deepEqual(violations.map(({ rule, line, fatal }) => [rule, line, fatal]), [
    ['POPOVER_NO_BACKDROP_BLUR', 9, true],
  ])
  assert.match(violations[0].message, /\.wf-custom-select-dropdown/)
})

test('画布扫描保留行内控件的作用域令牌、弹窗遮罩及浮层子项样式', () => {
  const stylesheet = [
    '.wf-canvas-root { --dsw-alias-bg-elevated: var(--dsw-alias-bg-layer-1); }',
    '.wf-canvas-root .wf-panel-shell__card { background: var(--dsw-alias-bg-elevated); backdrop-filter: blur(4px); }',
    '.wf-modal-overlay { background: var(--dsw-alias-bg-mask-1); }',
    '.wf-popover-portal { background: var(--dsw-alias-bg-layer-1); /* backdrop-filter: blur(4px); */ }',
    '.wf-popover-portal--above { top: 10px; }',
    '.wf-popover-portal > .wf-popover-item { background: transparent; }',
    '.wf-attachment-preview-card::after { background: transparent; }',
  ].join('\n')
  assert.deepEqual(checkContentForTransparencyViolations(stylesheet, 'omnimux-workflow/src/canvas/theme.css'), [])
})
