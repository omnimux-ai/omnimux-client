import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  FALLBACK_TITLE,
  MAX_TITLE,
  REPLICATION_SKILL,
  REPLICATION_PROMPT_BODY,
  buildReplicationPrompt,
  deriveProjectTitle,
  resolveDurationBudget,
  resolveMediaType,
  sanitizeFolderName,
} from './replication.js'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, 'replication.js'), 'utf8')

describe('replication.js isolation', () => {
  it('does not import workflow or touch browser globals', () => {
    assert.doesNotMatch(source, /omnimux-workflow/)
    assert.doesNotMatch(source, /\bwindow\./)
    assert.doesNotMatch(source, /\bdocument\./)
  })

  it('does not mention the retired video-replication skill', () => {
    assert.doesNotMatch(source, /video-replication/)
    assert.equal(REPLICATION_SKILL, 'video-deconstruct')
  })
})

describe('sanitizeFolderName', () => {
  it('keeps CJK and replaces path separators', () => {
    assert.equal(sanitizeFolderName('  宣传片  '), '宣传片')
    assert.equal(sanitizeFolderName('a/b\\c:d'), 'a_b_c_d')
    assert.equal(sanitizeFolderName('...'), '')
  })
})

describe('deriveProjectTitle', () => {
  it('uses the row title when present', () => {
    assert.equal(deriveProjectTitle({ title: '  夏日护肤  ', id: 'x' }), '夏日护肤')
  })

  it('strips http(s) from a URL title and sanitizes path chars', () => {
    assert.equal(
      deriveProjectTitle({ source_url: 'https://www.tiktok.com/@a/video/1' }),
      'tiktok.com_@a_video_1',
    )
  })

  it('falls back to 灵感复刻 when empty / dots-only', () => {
    assert.equal(deriveProjectTitle({ title: '   ' }), FALLBACK_TITLE)
    assert.equal(deriveProjectTitle({ title: '...' }), FALLBACK_TITLE)
    assert.equal(deriveProjectTitle(null), FALLBACK_TITLE)
    assert.equal(deriveProjectTitle({ id: 'insp-9' }), 'insp-9')
  })

  it('truncates to MAX_TITLE', () => {
    const long = '片'.repeat(MAX_TITLE + 40)
    const title = deriveProjectTitle({ title: long })
    assert.equal(title.length, MAX_TITLE)
    assert.equal(title, '片'.repeat(MAX_TITLE))
  })
})

describe('resolveMediaType', () => {
  it('honors explicit type and local video path', () => {
    assert.equal(resolveMediaType({ type: 'image' }), 'image')
    assert.equal(resolveMediaType({ type: 'link' }), 'link')
    assert.equal(resolveMediaType({ local_paths: { video: '/tmp/a.mp4' } }), 'video')
    assert.equal(resolveMediaType({}), 'video')
  })
})

describe('resolveDurationBudget', () => {
  it('prefers row.duration / stats over deconstruction then defaults to 15s', () => {
    assert.deepEqual(resolveDurationBudget({ duration: 12 }), { seconds: 12, source: 'stats' })
    assert.deepEqual(resolveDurationBudget({ stats: { video_duration: 9 } }), { seconds: 9, source: 'stats' })
    assert.deepEqual(
      resolveDurationBudget({ deconstruction: { length_seconds: 22 } }),
      { seconds: 22, source: 'deconstruction' },
    )
    assert.deepEqual(resolveDurationBudget({}), { seconds: 15, source: 'default_15s' })
  })
})

describe('buildReplicationPrompt', () => {
  it('is only /video-deconstruct plus the user constraint paragraph', () => {
    const prompt = buildReplicationPrompt({
      id: 'insp-42',
      title: '夏日护肤',
      source_url: 'https://tiktok.com/@x/video/1',
      type: 'video',
      stats: { duration: 18 },
    })
    assert.equal(prompt, `/${REPLICATION_SKILL}\n\n${REPLICATION_PROMPT_BODY}`)
    assert.match(prompt, /^\/video-deconstruct\n/)
    assert.match(prompt, /口播/)
    assert.match(prompt, /字幕/)
    assert.match(prompt, /出镜/)
    assert.match(prompt, /时长/)
    assert.doesNotMatch(prompt, /inspiration_id/)
    assert.doesNotMatch(prompt, /inspiration_get/)
    assert.doesNotMatch(prompt, /media_type/)
    assert.doesNotMatch(prompt, /video-replication/)
  })

  it('does not put the inspiration id in the prompt (id lives on the attachment)', () => {
    const prompt = buildReplicationPrompt({ title: '无 id' })
    assert.doesNotMatch(prompt, /inspiration_id/)
    assert.match(prompt, /^\/video-deconstruct\n/)
  })

  it('does not switch skill for image or link rows', () => {
    const image = buildReplicationPrompt({ id: 'img-1', type: 'image' })
    assert.match(image, /^\/video-deconstruct\n/)
    assert.doesNotMatch(image, /\/image-remix/)
    const link = buildReplicationPrompt({ id: 'lnk-1', type: 'link', source_url: 'https://x.com/a' })
    assert.equal(link, image)
  })

  it('ignores product option; prompt stays the same two-line body', () => {
    const prompt = buildReplicationPrompt({ id: 'insp-1' }, { product: { id: 'p1', title: '面霜' } })
    assert.doesNotMatch(prompt, /已检测到商品附件/)
    assert.doesNotMatch(prompt, /尚未提供任何商品/)
    assert.match(prompt, /替换成我的商品/)
  })
})
