import assert from 'node:assert/strict'
import { test } from 'node:test'
import { analysisInputFingerprint, sourceFingerprint } from '../analysis-input.js'
import { createEmptyCreationDraft, creationBasis, reconcileCreationDraft, validateCreationDraft } from '../creation-draft.js'
import {
  analysisDirections,
  analysisTargetKey,
  assessPromotionDraft,
  getBodyTranslation,
  getPostBody,
  getPostMedia,
  getTargetAnalysis,
  hasRunningAnalysis,
  decideAnalysisPollOutcome,
  isCurrentPostOrPromoted,
  isTargetMediaCompatible,
  samePostIdentity,
  stablePostKey,
} from './post-detail.js'

test('post reading never substitutes a generated script for missing original text', () => {
  assert.equal(getPostBody({ title: '标题', deconstruction: { narrative: '生成故事' } }), '')
  assert.equal(getPostBody({ content: '原文\n第二行' }), '原文\n第二行')
})

test('visible typed media retain persisted indexes and per-type labels', () => {
  const row = { media_items: [{ type: 'video', url: 'https://a.example/1.mp4' }, { type: 'image', url: 'javascript:bad' }, { type: 'image', url: 'https://a.example/2.jpg' }, { type: 'video', url: 'https://a.example/3.mp4' }] }
  assert.deepEqual(getPostMedia(row).map(({ id, index, label }) => ({ id, index, label })), [
    { id: 'media:0', index: 0, label: '视频 1' }, { id: 'media:2', index: 2, label: '图片 1' }, { id: 'media:3', index: 3, label: '视频 2' },
  ])
  assert.deepEqual(getPostMedia({ type: 'video', local_paths: { video: '/tmp/orphan.mp4' } }), [])
  assert.deepEqual(getPostMedia({ type: 'image', media_urls: ['https://a.example/1.jpg', 'https://a.example/2.jpg'] }).map(media => media.type), ['image', 'image'])
})

test('cloud carousel media_keys keep source order and never turn a video into photos', () => {
  const keys = [
    '/omnimux/inspiration/media/r2/slides/slide-1.jpg',
    'https://cdn.example/slide-2.jpg',
    '/omnimux/inspiration/media/r2/slides/slide-1.jpg',
    'javascript:alert(1)',
  ]
  const media = getPostMedia({ type: 'image', content_shape: 'gallery', media_keys: keys })
  assert.deepEqual(media.map(({ index, label, url }) => ({ index, label, url })), [
    { index: 0, label: '图片 1', url: '/omnimux/inspiration/media/r2/slides/slide-1.jpg' },
    { index: 1, label: '图片 2', url: 'https://cdn.example/slide-2.jpg' },
  ])
  assert.deepEqual(getPostMedia({ type: 'video', media_keys: ['/omnimux/inspiration/media/a.jpg'] }), [])
})

test('analysis identity isolates scopes, rejects changed content and labels old video results', () => {
  const item = { content: '正文', media_items: [{ type: 'video', url: 'https://a.example/1.mp4' }], deconstruction: { markdown: '历史分析' } }
  assert.equal(getTargetAnalysis(item, { scope: 'post' }), null)
  assert.equal(getTargetAnalysis(item, { scope: 'media', media_index: 0 }).source, 'legacy_unknown')
  const target = { scope: 'body' }, entry = { status: 'done', directions: ['content'], input_fingerprint: analysisInputFingerprint(item, { ...target, directions: ['content'] }), result: { markdown: '结果' } }
  item.analysis_results = { body: entry }
  assert.equal(getTargetAnalysis(item, target), entry)
  assert.equal(getTargetAnalysis({ ...item, content: '改过的正文' }, target).status, 'stale')
  assert.equal(getTargetAnalysis({ ...item, content: '改过的正文' }, target).result, null)
  assert.equal(analysisTargetKey({ scope: 'media', media_index: 0 }), 'media:0')
})

test('body translation cache belongs to the original text only', () => {
  const item = { content: '原文', body_translation: { text: '译文', source_fingerprint: sourceFingerprint('原文') }, script_translation: { text: '分析译文' } }
  assert.equal(getBodyTranslation(item).text, '译文')
  assert.equal(getBodyTranslation({ ...item, content: '新原文' }), null)
  assert.equal(getBodyTranslation({ script_translation: item.script_translation }), null)
  assert.deepEqual(analysisDirections('image'), ['content', 'expression', 'creative'])
})

test('analysis polling follows every running scope and retains state on unreadable responses', () => {
  const item = { id: 'poll-item', analysis_results: { post: { status: 'done' }, 'media:2': { status: 'running', input_fingerprint: 'old-input' } } }
  assert.equal(hasRunningAnalysis(item), true, 'even a stale input still owns its server execution lock')
  assert.deepEqual(decideAnalysisPollOutcome({ ok: true, body: { data: item } }), { action: 'pending', item })
  item.analysis_results['media:2'].status = 'failed'
  assert.deepEqual(decideAnalysisPollOutcome({ ok: true, body: { data: item } }), { action: 'settled', item })
  for (const response of [null, { ok: false, status: 500 }, { ok: true, body: {} }, { ok: true, body: { data: [] } }]) assert.equal(decideAnalysisPollOutcome(response).action, 'keep')
  assert.equal(decideAnalysisPollOutcome({ ok: false, status: 404 }).action, 'gone')
})

test('cloud-to-local promotion keeps valid body/compatible media selection without spurious review', () => {
  const cloud = {
    id: '2789',
    is_local: false,
    source_platform: 'tiktok',
    source_url: 'https://www.tiktok.com/@thatgirlevia/video/7583655185608707350?utm_source=feed',
    content: 'She thought he was perfect... then she typed his name.\r\n',
    media_items: [{ type: 'video', url: '/omnimux/inspiration/media/cloud.mp4', duration: 15 }],
  }
  const local = {
    id: 'insp_tiktok_1',
    is_local: true,
    source_platform: 'tiktok',
    source_url: 'https://www.tiktok.com/@thatgirlevia/video/7583655185608707350',
    content: 'She thought he was perfect... then she typed his name.',
    media_items: [{ type: 'video', url: '/omnimux/inspiration/local/media/videos/tiktok_1.mp4', duration: 15 }],
  }
  assert.equal(samePostIdentity(cloud, local), true)
  assert.equal(isCurrentPostOrPromoted(cloud, local), true)
  assert.equal(stablePostKey(cloud), stablePostKey(local))
  assert.equal(isTargetMediaCompatible(cloud, local, { scope: 'media', media_index: 0 }), true)

  const bodyOnly = reconcileCreationDraft(cloud, createEmptyCreationDraft(cloud), { references: [{ kind: 'body' }] })
  const bodyResult = assessPromotionDraft(cloud, local, bodyOnly)
  assert.equal(bodyResult.requiresReview, false)
  assert.equal(bodyResult.promoted, true)
  assert.deepEqual(bodyResult.nextDraft.references, [{ kind: 'body' }])
  assert.equal(validateCreationDraft(local, { ...bodyResult.nextDraft, basis: creationBasis(local, bodyResult.nextDraft) }).ok, true)

  const editedLocal = { ...local, content: 'Edited transcript text after import' }
  const changedBodyResult = assessPromotionDraft(cloud, editedLocal, bodyOnly)
  assert.equal(changedBodyResult.requiresReview, true)
  assert.deepEqual(changedBodyResult.nextDraft.references, [{ kind: 'body' }], 'body checkbox stays selected for review')

  const manualDraft = reconcileCreationDraft(cloud, bodyOnly, { manual: true, text: '只学她的情绪转折', basis: creationBasis(cloud, bodyOnly) })
  const manualResult = assessPromotionDraft(cloud, local, manualDraft)
  assert.equal(manualResult.requiresReview, false)
  assert.equal(manualResult.nextDraft.text, '只学她的情绪转折')
  assert.equal(manualResult.nextDraft.stale, false)
})
