import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { DEFAULT_LOGO_SVG } from '../brand/defaults.js'
import {
  HERO_BRAND_ID,
  HERO_BRAND_PRIORITY,
  HERO_BRAND_SLOT,
  heroMarkPresentation,
  installHeroBrandSlot,
  parseLogoSvg,
  resolveHeroLogoSvg,
} from './hero-brand.js'

const here = dirname(fileURLToPath(import.meta.url))

function fakeSlots() {
  /** @type {Array<{ name: string, options: object, component: unknown }>} */
  const entries = []
  return {
    entries,
    inject(name, callback) {
      this.lastInject = name
      callback()
    },
    register(options, component) {
      entries.push({ name: options.name, options, component })
      return () => {}
    },
  }
}

describe('installHeroBrandSlot', () => {
  it('registers conversation.hero.brand.mark at priority -10', () => {
    const slots = fakeSlots()
    const Mark = function HeroBrandMark() { return null }
    installHeroBrandSlot({ slots }, Mark)
    assert.equal(slots.lastInject, HERO_BRAND_SLOT)
    assert.equal(entriesOf(slots).length, 1)
    const entry = entriesOf(slots)[0]
    assert.equal(entry.name, 'conversation.hero.brand.mark')
    assert.equal(entry.options.priority, -10)
    assert.equal(entry.options.priority, HERO_BRAND_PRIORITY)
    assert.equal(entry.options.id, HERO_BRAND_ID)
    assert.equal(entry.component, Mark)
  })

  it('skips registration when replaceHeroMark is false', () => {
    const slots = fakeSlots()
    installHeroBrandSlot({ slots }, function Mark() { return null }, { replaceHeroMark: false })
    assert.equal(entriesOf(slots).length, 0)
  })

  it('no-ops without a slots service', () => {
    installHeroBrandSlot({}, function Mark() { return null })
  })
})

describe('hero mark helpers', () => {
  it('sizes the mark to the host square edge and keeps className', () => {
    assert.deepEqual(heroMarkPresentation(34, 'fish'), { width: 34, height: 34, className: 'fish' })
    assert.deepEqual(heroMarkPresentation('24', ''), { width: 24, height: 24, className: undefined })
    assert.equal(heroMarkPresentation(undefined).width, 34)
  })

  it('parses the bundled logo into viewBox plus inner markup', () => {
    const parsed = parseLogoSvg(DEFAULT_LOGO_SVG)
    assert.equal(parsed.viewBox, '0 0 1254 1254')
    assert.match(parsed.inner, /<rect width="1254"/)
    assert.doesNotMatch(parsed.inner, /<\/svg>/i)
  })

  it('reads logoSvg from the boot payload', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"></svg>'
    const win = { __OMNIMUX_BRAND__: { logoSvg: svg } }
    assert.equal(resolveHeroLogoSvg(win), svg)
    assert.equal(resolveHeroLogoSvg({}), DEFAULT_LOGO_SVG)
  })
})

describe('hero brand source wiring', () => {
  it('client apply mounts the slot occupant', () => {
    const source = readFileSync(join(here, 'index.js'), 'utf8')
    assert.match(source, /installHeroBrandSlot\(ctx,\s*HeroBrandMark\)/)
    assert.match(source, /from '\.\/HeroBrandMark\.jsx'/)
    assert.match(source, /from '\.\/hero-brand\.js'/)
  })
})

/**
 * @param {{ entries: unknown[] }} slots
 */
function entriesOf(slots) {
  return slots.entries
}
