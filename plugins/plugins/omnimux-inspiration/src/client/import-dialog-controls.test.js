import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { en, zh } from './locales.js'
import { INSPIRATION_CSS } from './styles.js'

const here = dirname(fileURLToPath(import.meta.url))

/**
 * @param {string} css
 * @param {string} selector
 */
function ruleBody(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`))
  assert.ok(match, `missing selector ${selector}`)
  return match[1]
}

/**
 * @param {string} body
 * @param {string} property
 */
function decl(body, property) {
  const match = body.match(new RegExp(`${property}\\s*:\\s*([^;]+);`))
  assert.ok(match, `missing ${property} in ${body}`)
  return match[1].trim()
}

describe('import dialog UX locales', () => {
  it('keeps zh/en keys aligned and updates submit / tags toggle copy', () => {
    assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort())
    assert.equal(zh['add.submit'], '导入')
    assert.equal(en['add.submit'], 'Import')
    assert.equal(zh['add.tagsToggle'], '+ 添加自定义标签')
    assert.equal(en['add.tagsToggle'], '+ Add custom tags')
    // The label rides the submit button while the POST is in flight, and the
    // dialog closes itself as soon as the background job answers 202 — so it must
    // describe the import, never ask the user to dismiss a dialog that is already
    // closing.
    assert.equal(zh['add.importing'], '导入中…')
    assert.equal(en['add.importing'], 'Importing…')
  })

  it('removes add.autoAnalyze from both zh and en locales', () => {
    assert.equal(Object.hasOwn(zh, 'add.autoAnalyze'), false)
    assert.equal(Object.hasOwn(en, 'add.autoAnalyze'), false)
  })
})

describe('import dialog UX styles', () => {
  it('ships collapsible tags toggle at 32px height with 8px radius', () => {
    const body = ruleBody(INSPIRATION_CSS, '.omnimux-inspiration-tags-toggle')
    assert.equal(decl(body, 'min-height'), '32px')
    assert.equal(decl(body, 'border-radius'), '8px')
  })

  it('removes unused auto-analyze switch styles', () => {
    assert.doesNotMatch(INSPIRATION_CSS, /\.omnimux-inspiration-switch/)
  })
})

describe('import dialog source contracts', () => {
  it('import dialogs use CollapsibleTagsField without AutoAnalyzeSwitch or native checkbox', () => {
    for (const file of ['InspirationInlineImportDialog.jsx', 'RivalImportDialog.jsx']) {
      const source = readFileSync(join(here, file), 'utf8')
      assert.match(source, /CollapsibleTagsField/)
      assert.match(source, /auto_analyze:\s*false/)
      assert.doesNotMatch(source, /AutoAnalyzeSwitch/)
      assert.doesNotMatch(source, /readAutoAnalyzePreference/)
      assert.doesNotMatch(source, /omnimux_inspiration_auto_analyze/)
      assert.doesNotMatch(source, /type="checkbox"/)
      assert.doesNotMatch(source, /omnimux-inspiration-check/)
    }
  })

  it('CollapsibleTagsField starts collapsed and toggles aria-expanded', () => {
    const source = readFileSync(join(here, 'import-dialog-controls.jsx'), 'utf8')
    assert.match(source, /useState\(false\)/)
    assert.match(source, /aria-expanded=\{expanded\}/)
    assert.match(source, /setExpanded\(\(prev\) => !prev\)/)
    assert.match(source, /expanded \? \(/)
    assert.doesNotMatch(source, /AutoAnalyzeSwitch/)
    assert.doesNotMatch(source, /role="switch"/)
  })

  it('removes deprecated import-dialog-prefs.js module', () => {
    assert.equal(existsSync(join(here, 'import-dialog-prefs.js')), false)
  })
})
