import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  extractScriptStructure,
  formatInspirationDate,
  formatTimecode,
  parseDurationSeconds,
  parsePublishedAt,
  parseStructureJson,
  parseTranslateJson,
  segmentsFromTimecodeLines,
} from './structure-script.js'

describe('structure-script', () => {
  it('parses duration and formats timecode without inventing values', () => {
    assert.equal(parseDurationSeconds(17), 17)
    assert.equal(parseDurationSeconds('1:02'), 62)
    assert.equal(parseDurationSeconds('bad'), null)
    assert.equal(formatTimecode(17), '0:17')
    assert.equal(formatTimecode(null), '')
  })

  it('parses published_at from unix seconds and ISO', () => {
    assert.equal(parsePublishedAt(1700000000), new Date(1700000000 * 1000).toISOString())
    assert.match(parsePublishedAt('2024-02-02T00:00:00.000Z'), /^2024-02-02/)
    assert.equal(parsePublishedAt('nope'), '')
  })

  it('formats dates as YYYY-MM-DD and drops invalid ISO', () => {
    assert.equal(formatInspirationDate('not-a-date'), '')
    assert.match(formatInspirationDate('2026-08-27T14:53:46.563+08:00'), /^\d{4}-\d{2}-\d{2}$/)
  })

  it('drops invented timestamps and non-text segments', () => {
    const parsed = parseStructureJson({
      segments: [
        { text: 'hello', start: '00:02' },
        { text: { bad: true } },
        { text: 'world' },
      ],
      sections: [
        { title: 'Hook', quote: 'hello', analysis: 'why', source_segment_ids: ['seg_1'] },
        { title: 1, analysis: ['x'] },
      ],
    })
    assert.equal(parsed.segments.length, 2)
    assert.equal(parsed.segments[0].start, 2)
    assert.equal(parsed.segments[1].start, null)
    assert.equal(parsed.sections.length, 1)
    assert.equal(parsed.sections[0].quote, 'hello')
  })

  it('only promotes caption lines that already have mm:ss', () => {
    assert.deepEqual(segmentsFromTimecodeLines('just a caption'), [])
    const segs = segmentsFromTimecodeLines('00:00 hello\n00:04 world')
    assert.equal(segs.length, 2)
    assert.equal(segs[0].start, 0)
    assert.equal(segs[1].text, 'world')
  })

  it('falls back to timecode lines when textComplete is missing', async () => {
    const extra = await extractScriptStructure(null, { content: '00:00 a\n00:03 b' })
    assert.equal(extra.segments.length, 2)
    assert.equal(extra.sections.length, 0)
  })

  it('parses translate JSON and ignores unsafe rows', () => {
    const parsed = parseTranslateJson('{"text":"你好","segments":[{"id":"seg_1","text":"你好"},{"text":1}]}')
    assert.equal(parsed.text, '你好')
    assert.equal(parsed.segments.length, 1)
  })
})
