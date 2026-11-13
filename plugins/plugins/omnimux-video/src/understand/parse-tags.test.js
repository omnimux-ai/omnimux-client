import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseTaggedSections } from './parse-tags.js'

describe('parseTaggedSections', () => {
  it('extracts prompt and appendix when tags are present', () => {
    const raw = [
      '<<<PROMPT>>>',
      '以参考图像锁定外观，生成5秒9:16静默片；禁止口播对白。',
      '<<<END_PROMPT>>>',
      '<<<APPENDIX>>>',
      '1) 节拍表',
      '<<<END_APPENDIX>>>',
    ].join('\n')
    const out = parseTaggedSections(raw)
    assert.equal(out.parsed, true)
    assert.match(out.prompt, /禁止口播对白/)
    assert.match(out.appendix, /节拍表/)
  })

  it('falls soft to whole body when tags missing', () => {
    const out = parseTaggedSections('plain prompt body\n禁止口播对白')
    assert.equal(out.parsed, false)
    assert.equal(out.prompt, 'plain prompt body\n禁止口播对白')
    assert.equal(out.appendix, '')
  })

  it('treats empty prompt tag as unparsed fallback', () => {
    const out = parseTaggedSections('<<<PROMPT>>>\n\n<<<END_PROMPT>>>')
    assert.equal(out.parsed, false)
    assert.match(out.prompt, /<<<PROMPT>>>/)
  })
})
