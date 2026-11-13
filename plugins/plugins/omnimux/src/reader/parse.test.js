import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseReaderMarkdown } from './parse.js'

describe('parseReaderMarkdown', () => {
  it('reads Title header and keeps the full markdown', () => {
    const raw = [
      'Title: Example Domain',
      '',
      'URL Source: https://example.com/',
      '',
      'Markdown Content:',
      '# Example Domain',
      '',
      'This domain is for use in illustrative examples.',
    ].join('\n')
    const parsed = parseReaderMarkdown(raw)
    assert.equal(parsed.title, 'Example Domain')
    assert.equal(parsed.pageContent, raw)
    assert.match(parsed.pageContent, /illustrative examples/)
  })

  it('falls back to the first markdown heading', () => {
    const raw = '# Shop listing\n\nPrice $12'
    const parsed = parseReaderMarkdown(raw)
    assert.equal(parsed.title, 'Shop listing')
    assert.equal(parsed.pageContent, raw)
  })

  it('returns empty title for blank input', () => {
    assert.deepEqual(parseReaderMarkdown('   '), { title: '', pageContent: '' })
    assert.deepEqual(parseReaderMarkdown(''), { title: '', pageContent: '' })
  })
})
