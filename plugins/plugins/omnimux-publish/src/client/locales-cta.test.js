import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { zh, en } from './locales.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const actionRowSrc = readFileSync(join(__dirname, 'views/PublishActionRow.jsx'), 'utf8')

describe('Publish New CTA label (no double plus)', () => {
  it('action.new / tab.new do not prefix "+" (leadingIcon supplies the glyph)', () => {
    for (const [locale, bag] of [['zh', zh], ['en', en]]) {
      assert.equal(bag['action.new'].startsWith('+'), false, `${locale} action.new must not start with +`)
      assert.equal(bag['tab.new'].startsWith('+'), false, `${locale} tab.new must not start with +`)
      assert.doesNotMatch(bag['action.new'], /^\s*\+/)
    }
    assert.equal(zh['action.new'], '新增发布')
    assert.equal(en['action.new'], 'New Post')
  })

  it('PublishActionRow pairs action.new with IconPlusOutline16 leadingIcon', () => {
    assert.match(actionRowSrc, /leadingIcon=\{<IconPlusOutline16/)
    assert.match(actionRowSrc, /t\('action\.new'\)/)
  })
})
