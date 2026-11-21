import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { translateZh, makeClipT } from './i18n/translate.js'
import { zh } from './i18n/zh-CN.js'

function* vendorSources(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory)
    if (entry.isDirectory()) yield* vendorSources(url)
    else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) yield url
  }
}

function isClipTranslator(expression) {
  if (ts.isIdentifier(expression)) return expression.text === 't' || expression.text === 'clipT'
  return ts.isCallExpression(expression) && ts.isIdentifier(expression.expression)
    && expression.expression.text === 'clipNow'
}

function* translationLiterals(node) {
  if (!node) return
  if (ts.isStringLiteralLike(node)) yield node
  else if (ts.isConditionalExpression(node)) {
    yield* translationLiterals(node.whenTrue)
    yield* translationLiterals(node.whenFalse)
  } else if (ts.isParenthesizedExpression(node)) yield* translationLiterals(node.expression)
}

const placeholders = text => [...text.matchAll(/\{\d+\}/g)].map(([token]) => token).sort()

test('zh dictionary entries all translate under zh and fall back under en', () => {
  const t = makeClipT('zh')
  for (const [src, expected] of Object.entries(zh)) {
    assert.equal(t(src), expected, `zh lookup for ${src}`)
  }
  const en = makeClipT('en')
  for (const src of Object.keys(zh)) {
    assert.equal(en(src), src, `en must pass through: ${src}`)
  }
})

test('missing keys fall back to source, never blank or key-echo', () => {
  const t = makeClipT('zh')
  assert.equal(t('Some untranslated thing'), 'Some untranslated thing')
  assert.equal(t(''), '')
  assert.equal(translateZh(123), 123)
  assert.equal(translateZh(undefined), undefined)
})

test('locale variants: zh / zh-CN / zh-Hans translate; others do not', () => {
  const probe = 'Export'
  assert.equal(makeClipT('zh')(probe), translateZh(probe))
  assert.equal(makeClipT({ active: 'zh-CN' })(probe), translateZh(probe))
  assert.equal(makeClipT({ active: 'zh_hans' })(probe), translateZh(probe))
  assert.equal(makeClipT('en-US')(probe), probe)
  assert.equal(makeClipT('ja')(probe), probe)
  assert.equal(makeClipT(undefined)(probe), translateZh(probe), 'absent locale defaults to zh like EMPTY_SNAPSHOT')
  assert.equal(makeClipT(null)(probe), translateZh(probe))
})

test('dictionary coverage for batch-1 surfaces (spot checks)', () => {
  const required = [
    'Export', 'Saved!', 'Undo', 'Redo', 'Video Editor', 'Motion Design',
    'Create Project', 'Start Fresh', 'Templates', 'Recent Projects',
    'Track Layers', 'Add track', 'Split at Playhead', 'Ripple Delete',
    'Mute track', 'Player', 'Aspect ratio', 'Playback quality',
    'Transform', 'Color', 'Effects', 'Speed', 'Style', 'No media imported',
    'Import Media', 'No selection',
  ]
  const missing = required.filter((k) => !(k in zh))
  assert.deepEqual(missing, [], `missing dictionary keys: ${missing.join(', ')}`)
})

test('every literal Clip translation call in the vendor source has a dictionary entry', () => {
  const missing = new Map()
  for (const url of vendorSources(new URL('./openreel/', import.meta.url))) {
    const text = readFileSync(url, 'utf8')
    if (!text.includes('/i18n/')) continue
    const source = ts.createSourceFile(fileURLToPath(url), text, ts.ScriptTarget.Latest)
    function visit(node) {
      if (ts.isCallExpression(node) && isClipTranslator(node.expression)) {
        for (const key of translationLiterals(node.arguments[0])) {
          if (Object.hasOwn(zh, key.text)) continue
          const { line } = source.getLineAndCharacterOfPosition(key.getStart(source))
          missing.set(key.text, `${url.pathname.split('/openreel/').at(-1)}:${line + 1}`)
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  assert.deepEqual([...missing], [], 'Clip translation keys missing from zh-CN')
})

function shaderParameterLabels(parameters, source) {
  assert.ok(ts.isArrayLiteralExpression(parameters), parameters.getText(source))
  return parameters.elements.flatMap((parameter) => {
    if (ts.isObjectLiteralExpression(parameter)) {
      const label = parameter.properties.find(property => property.name?.getText(source) === 'label')
      assert.ok(label && ts.isPropertyAssignment(label) && ts.isStringLiteralLike(label.initializer), parameter.getText(source))
      return [label.initializer.text]
    }
    if (ts.isCallExpression(parameter) && ['num', 'color'].includes(parameter.expression.getText(source))) {
      const label = parameter.arguments[1]
      assert.ok(label && ts.isStringLiteralLike(label), parameter.getText(source))
      return [label.text]
    }
    if (ts.isSpreadElement(parameter) && ts.isCallExpression(parameter.expression) && parameter.expression.expression.getText(source) === 'colors') {
      const colors = parameter.expression.arguments[0]
      assert.ok(colors && ts.isArrayLiteralExpression(colors), parameter.getText(source))
      return colors.elements.map((_, index) => `Color ${index + 1}`)
    }
    assert.fail(`Unknown shader parameter declaration: ${parameter.getText(source)}`)
  })
}

function catalogLabels(relativePath, catalogNames, fields) {
  const url = new URL(`./openreel/${relativePath}`, import.meta.url)
  const source = ts.createSourceFile(fileURLToPath(url), readFileSync(url, 'utf8'), ts.ScriptTarget.Latest)
  const labels = new Set()
  const found = new Set()
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && catalogNames.includes(node.name.text)) {
      const definition = node.initializer && ts.isAsExpression(node.initializer) ? node.initializer.expression : node.initializer
      assert.ok(definition && (ts.isArrayLiteralExpression(definition) || ts.isObjectLiteralExpression(definition)), `${relativePath}: ${node.name.text}`)
      found.add(node.name.text)
      const entries = ts.isArrayLiteralExpression(definition)
        ? definition.elements
        : definition.properties.filter(ts.isPropertyAssignment).map(property => property.initializer)
      for (const entry of entries) {
        if (ts.isStringLiteralLike(entry)) labels.add(entry.text)
        if (ts.isCallExpression(entry) && entry.expression.getText(source) === 'spec') {
          for (const label of entry.arguments.slice(1, 4)) {
            assert.ok(ts.isStringLiteralLike(label), entry.getText(source))
            labels.add(label.text)
          }
        }
        if (!ts.isObjectLiteralExpression(entry)) continue
        for (const property of entry.properties) {
          if (!ts.isPropertyAssignment(property)) continue
          const key = property.name.getText(source)
          if (!fields.includes(key)) continue
          if (key === 'params') {
            for (const label of shaderParameterLabels(property.initializer, source)) labels.add(label)
          } else if (ts.isStringLiteralLike(property.initializer)) labels.add(property.initializer.text)
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.deepEqual([...found].sort(), [...catalogNames].sort(), relativePath)
  return labels
}

test('built-in filters, motion presets, effects, transitions, easing and shaders have Chinese labels', () => {
  const shaderFields = ['name', 'category', 'collection', 'params']
  const groups = [
    ['core/video/filter-presets.ts', ['FILTER_PRESETS', 'FILTER_CATEGORIES'], ['name', 'description']],
    ['web/services/motion-presets.ts', ['builtInPresets'], ['name', 'description']],
    ['web/components/editor/panels/EffectsTransitionsPanel.tsx', ['ALL_EFFECT_PREVIEWS', 'TRANSITIONS', 'workspaceEffectCategories', 'TRANSITION_CATEGORIES'], ['label', 'description']],
    ['web/components/editor/panels/proEffectPreviews.ts', ['LABEL_OVERRIDES', 'DESCRIPTION_OVERRIDES'], []],
    ['core/video/pro-effects.ts', ['PRO_EFFECT_SPECS'], ['label', 'description', 'category']],
    ['core/video/pro-effects-extra.ts', ['EXTRA_PRO_EFFECT_SPECS'], ['label', 'description', 'category']],
    ['core/video/temporal-effects.ts', ['TEMPORAL_PRO_EFFECT_SPECS'], ['label', 'description', 'category']],
    ['core/video/composite-engine.ts', ['names'], []],
    ['web/components/editor/inspector/ClipTransitionSection.tsx', ['EASINGS'], ['label']],
    ['core/motion/shaders/effect-shaders.ts', ['EFFECT_SHADERS'], shaderFields],
    ['core/motion/shaders/fill-shaders.ts', ['FILL_SHADERS'], shaderFields],
    ['core/motion/shaders/text-shaders.ts', ['TEXT_SHADERS'], shaderFields],
    ['core/motion/shaders/paper-shaders.ts', ['ENTRIES'], shaderFields],
  ]
  const labels = new Set(['Built-in', 'Paper'])
  for (const [path, names, fields] of groups) {
    for (const label of catalogLabels(path, names, fields)) labels.add(label)
  }
  assert.deepEqual([...labels].filter(label => !Object.hasOwn(zh, label)), [], 'built-in catalog labels missing from zh-CN')
})

test('every zh dict file uses source literals and preserves message placeholders', () => {
  for (const file of readdirSync(new URL('./i18n/zh/', import.meta.url))) {
    if (!file.endsWith('.js')) continue
    const text = readFileSync(new URL(`./i18n/zh/${file}`, import.meta.url), 'utf8')
    assert.doesNotMatch(text, /^\s*['"`][a-z][a-z0-9_]*[._:][a-z0-9_.:]+['"`]:/m, `${file} must key by source literal`)
  }
  for (const [key, value] of Object.entries(zh)) {
    assert.equal(typeof value, 'string', key)
    assert.ok(!key.trim() || value.trim(), key)
    assert.deepEqual(placeholders(value), placeholders(key), key)
  }
})

test('formats UI messages while preserving user names in both locales', () => {
  const name = '海边 Scenes {1}'
  assert.equal(makeClipT('en')('Export for {0}', [name]), `Export for ${name}`)
  assert.equal(makeClipT('zh-CN')('Export for {0}', [name]), `为${name}导出`)
  assert.equal(makeClipT('zh-CN')('constructor'), 'constructor')
})
