/**
 * E2E: TikTok Direct Post compliance end-to-end contracts (Issue #186).
 * Covers HTTP route creator-info 60s cache + force=1 bust, Host preflight enforcement,
 * UI modularization/token hygiene, and bilingual copy completeness.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { parsePublishConfig } from '../../src/config.js'
import { createPublishDispatcher, registerPublishRoutes } from '../../src/http-routes.js'
import { createHubChannel } from '../../src/hubtools.js'
import { createAccountSource } from '../../src/accounts.js'
import { createCreatorInfoCache } from '../../src/creator-info-cache.js'
import { createMediaStore } from '../../src/media.js'
import { createRecordStore } from '../../src/store.js'
import { createSubmitService } from '../../src/submit.js'
import { zh, en } from '../../src/client/locales.js'
import { TIKTOK_BRANDED_CONTENT_URL, TIKTOK_MUSIC_USAGE_URL } from '../../src/shared/tiktok-options.js'
import { buildSyntheticMp4 } from '../../src/media-duration.test.js'

const here = dirname(fileURLToPath(import.meta.url))
const publishRoot = join(here, '../..')

function mockReqRes({ method = 'GET', url = '/', headers = {}, body } = {}) {
  const chunks = body === undefined ? [] : [Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body))]
  const req = {
    method,
    url,
    headers,
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk
    },
  }
  const captured = { status: 0, body: null }
  const res = {
    writeHead(status) { captured.status = status },
    end(text) { captured.body = typeof text === 'string' && text ? JSON.parse(text) : text },
  }
  return { req, res, captured }
}

describe('TikTok Direct Post compliance E2E (Issue #186)', () => {
  it('routes GET /creator-info through 60s cache, supports force=1 bust, and shares cache with POST /records/submit prepare', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-publish-e2e-186-'))
    try {
      let creatorCalls = 0
      const handlers = {
        omnimux_accounts_list: () => ({
          success: true,
          data: {
            accounts: [
              { id: 'd1', provider: 'tiktok_direct', platform: 'tiktok', username: 'alice', status: 'active', capabilities: { upload_draft: true, publish_direct: true } },
            ],
          },
        }),
        omnimux_accounts_creator_info: () => {
          creatorCalls += 1
          return {
            success: true,
            data: {
              creator_nickname: `Alice-${creatorCalls}`,
              privacy_level_options: ['PUBLIC_TO_EVERYONE', 'SELF_ONLY'],
              max_video_post_duration_sec: 600,
            },
          }
        },
        omnimux_publish_presign: (args) => ({ success: true, data: { upload_url: `https://up/${args.filename}`, public_url: `https://pub/${args.filename}` } }),
        omnimux_publish_create: () => ({ success: true, data: { id: 'post-d1' } }),
      }
      const tools = {
        get: (name) => (name in handlers ? { name } : undefined),
        async execute(batch) {
          const results = []
          for (const block of batch.calls) {
            const args = JSON.parse(block.arguments)
            const value = await handlers[block.name](args)
            results.push({ callId: block.id, result: { content: [{ type: 'text', text: JSON.stringify(value) }], isError: false, value } })
          }
          return { results, additionalContexts: [], concluded: false }
        },
      }
      const store = createRecordStore({ paths: { recordsFile: join(dir, 'records.json') } })
      const media = createMediaStore({ paths: { mediaIndexFile: join(dir, 'media.json'), mediaDir: join(dir, 'media') }, maxBytes: 1024 * 1024 })
      const channel = createHubChannel({ tools, fetcher: async () => ({ ok: true, status: 200 }) })
      const creatorInfoCache = createCreatorInfoCache({ channel, ttlMs: 60_000 })
      const accounts = createAccountSource({ channel, overlayPath: '' })
      const config = parsePublishConfig({ dataDir: dir, submitTimeoutSeconds: 5 })
      const service = createSubmitService({ store, media, channel, accounts, creatorInfoCache, config })
      const dispatcher = createPublishDispatcher({ store, media, accounts, service, channel, creatorInfoCache, config })

      let routeHandler = null
      const webServer = {
        register(spec) {
          if (spec.path === '/omnimux/publish') routeHandler = spec.handler
          return () => {}
        },
      }
      registerPublishRoutes(webServer, dispatcher)

      // 1. First GET /creator-info hits hub
      const first = mockReqRes({ method: 'GET', url: '/omnimux/publish/creator-info?id=d1' })
      await routeHandler(first.req, first.res)
      assert.equal(first.captured.status, 200)
      assert.equal(creatorCalls, 1)

      // 2. Second GET /creator-info within TTL uses cache
      const second = mockReqRes({ method: 'GET', url: '/omnimux/publish/creator-info?id=d1' })
      await routeHandler(second.req, second.res)
      assert.equal(second.captured.status, 200)
      assert.equal(creatorCalls, 1)

      // 3. GET /creator-info?force=1 busts cache
      const forced = mockReqRes({ method: 'GET', url: '/omnimux/publish/creator-info?id=d1&force=1' })
      await routeHandler(forced.req, forced.res)
      assert.equal(forced.captured.status, 200)
      assert.equal(creatorCalls, 2)

      // 4. POST /records/submit with over-duration MP4 fails 400 validation-failed in prepare using cached creator_info (still 2 calls!)
      const { media: longVid } = media.importBuffer(buildSyntheticMp4({ durationSec: 700 }), { filename: 'long.mp4', content_type: 'video/mp4' })
      const draft = store.create({
        type: 'video',
        description: 'Too long',
        media_ids: [longVid.id],
        account_ids: ['d1'],
        settings: { tiktok_options: { privacy_level: 'PUBLIC_TO_EVERYONE', music_usage_confirmed: true } },
      })
      const submitReq = mockReqRes({
        method: 'POST',
        url: '/omnimux/publish/records/submit',
        headers: { origin: 'http://127.0.0.1:65432', 'sec-fetch-site': 'same-origin' },
        body: { record_id: draft.id },
      })
      await routeHandler(submitReq.req, submitReq.res)
      assert.equal(submitReq.captured.status, 400)
      assert.equal(submitReq.captured.body.error, 'validation-failed')
      assert.ok(submitReq.captured.body.details.errors.some((e) => e.code === 'video-duration-exceeded'))
      assert.equal(creatorCalls, 2)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('keeps DirectPostOptions modularized, uses semantic tokens without backdrop-filter, and provides bilingual compliance links', () => {
    const directOptionsSrc = readFileSync(join(publishRoot, 'src/client/Composer/DirectPostOptions.jsx'), 'utf8')
    const composerSrc = readFileSync(join(publishRoot, 'src/client/Composer/index.jsx'), 'utf8')
    const stylesSrc = readFileSync(join(publishRoot, 'src/client/styles.js'), 'utf8')

    assert.match(composerSrc, /from '\.\/DirectPostOptions\.jsx'/)
    assert.match(directOptionsSrc, /TIKTOK_MUSIC_USAGE_URL/)
    assert.match(directOptionsSrc, /TIKTOK_BRANDED_CONTENT_URL/)
    assert.doesNotMatch(stylesSrc, /backdrop-filter/)
    assert.equal(TIKTOK_MUSIC_USAGE_URL, 'https://www.tiktok.com/legal/page/global/music-usage-confirmation/en')
    assert.equal(TIKTOK_BRANDED_CONTENT_URL, 'https://www.tiktok.com/legal/page/global/bc-policy/en')

    for (const key of [
      'form.options.privacy.placeholder',
      'form.options.privacy.unselected',
      'form.options.privacy.resetBranded',
      'form.options.commercial.label.promotional',
      'form.options.commercial.label.paid',
      'form.options.compliance.musicLink',
      'form.options.compliance.brandedLink',
      'form.options.processingHint',
      'detail.directProcessingNotice',
    ]) {
      assert.ok(typeof zh[key] === 'string' && zh[key].length > 0, `missing zh.${key}`)
      assert.ok(typeof en[key] === 'string' && en[key].length > 0, `missing en.${key}`)
    }
  })
})
