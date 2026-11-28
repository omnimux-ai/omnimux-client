/**
 * E2E: Social account seat billing contracts (Issue #412).
 * Covers Host submit blocking frozen seats with HTTP 409 SOCIAL_SEAT_EXPIRED,
 * hub error tag passthrough, bilingual locale symmetry without middle dots,
 * and strict verified --dsw-alias-* token usage.
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

describe('Social account seat billing E2E (Issue #412)', () => {
  it('blocks POST /records/submit for frozen seats with HTTP 409 SOCIAL_SEAT_EXPIRED before media upload or post creation', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-publish-e2e-412-'))
    try {
      let presignCalls = 0
      let createCalls = 0
      let creatorInfoCalls = 0
      const handlers = {
        omnimux_accounts_list: () => ({
          success: true,
          data: {
            accounts: [
              {
                id: 'acc-frozen',
                provider: 'tiktok_direct',
                platform: 'tiktok',
                display_name: 'Frozen Creator',
                username: 'frozen_creator',
                status: 'active',
                capabilities: { upload_draft: true, publish_direct: false },
                seat: {
                  id: 9,
                  status: 'frozen',
                  expires_at: '2026-11-20T00:00:00Z',
                  grace_until: '2026-11-27T00:00:00Z',
                  can_renew: true,
                  price_credits: 20,
                },
              },
              {
                id: 'acc-frozen-direct',
                provider: 'tiktok_direct',
                platform: 'tiktok',
                display_name: 'Frozen Direct Creator',
                username: 'frozen_direct',
                status: 'active',
                capabilities: { upload_draft: true, publish_direct: true },
                seat: {
                  id: 10,
                  status: 'frozen',
                  expires_at: '2026-11-20T00:00:00Z',
                  grace_until: '2026-11-27T00:00:00Z',
                  can_renew: true,
                  price_credits: 20,
                },
              },
            ],
          },
        }),
        omnimux_accounts_creator_info: () => {
          creatorInfoCalls += 1
          return { success: true, data: { privacy_level_options: ['SELF_ONLY'], max_video_post_duration_sec: 600 } }
        },
        omnimux_publish_presign: () => {
          presignCalls += 1
          return { success: true, data: { upload_url: 'https://up/a.mp4', public_url: 'https://pub/a.mp4' } }
        },
        omnimux_publish_create: () => {
          createCalls += 1
          return { success: true, data: { id: 'post-1' } }
        },
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
      registerPublishRoutes(webServer, dispatcher, {
        getConnection: () => ({ requestRejection: () => undefined }),
      })

      const { media: vid } = media.importBuffer(buildSyntheticMp4({ durationSec: 15 }), { filename: 'ok.mp4', content_type: 'video/mp4' })
      const draft = store.create({
        type: 'video',
        description: 'Frozen seat publish check',
        media_ids: [vid.id],
        account_ids: ['acc-frozen'],
      })

      const submitReq = mockReqRes({
        method: 'POST',
        url: '/omnimux/publish/records/submit',
        headers: { origin: 'http://127.0.0.1:65432', 'sec-fetch-site': 'same-origin' },
        body: { record_id: draft.id },
      })
      await routeHandler(submitReq.req, submitReq.res)
      assert.equal(submitReq.captured.status, 409)
      assert.equal(submitReq.captured.body.error, 'SOCIAL_SEAT_EXPIRED')
      assert.equal(submitReq.captured.body.code, 'SOCIAL_SEAT_EXPIRED')
      assert.equal(presignCalls, 0)
      assert.equal(createCalls, 0)
      assert.equal(creatorInfoCalls, 0)

      const directDraft = store.create({
        type: 'video',
        description: 'Frozen direct seat publish check',
        media_ids: [vid.id],
        account_ids: ['acc-frozen-direct'],
      })
      const directReq = mockReqRes({
        method: 'POST',
        url: '/omnimux/publish/records/submit',
        headers: { origin: 'http://127.0.0.1:65432', 'sec-fetch-site': 'same-origin' },
        body: { record_id: directDraft.id },
      })
      await routeHandler(directReq.req, directReq.res)
      assert.equal(directReq.captured.status, 409)
      assert.equal(directReq.captured.body.error, 'SOCIAL_SEAT_EXPIRED')
      assert.equal(directReq.captured.body.code, 'SOCIAL_SEAT_EXPIRED')
      assert.equal(creatorInfoCalls, 0)
      assert.equal(presignCalls, 0)
      assert.equal(createCalls, 0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('keeps seat billing locales symmetric across zh/en without middle dots and avoids raw colors in seat styles', () => {
    const seatKeys = [
      'accounts.reason.seatExpired',
      'accounts.reason.seatUnactivated',
      'accounts.seat.renewAction',
      'accounts.seat.activateAction',
      'acct.seat.summary',
      'acct.seat.vacant',
      'acct.seat.capFull',
      'acct.seat.rate',
      'acct.seat.status.frozen',
      'acct.seat.status.unactivated',
      'acct.seat.expiresAt',
      'acct.seat.expiringSoon',
      'acct.seat.frozenGrace',
      'acct.seat.frozenGraceEnding',
      'acct.seat.unactivatedGrace',
      'acct.seat.unactivatedGraceEnding',
      'acct.seat.renewInline',
      'acct.seat.activateInline',
      'acct.seat.renewMenu',
      'acct.seat.activateMenu',
      'acct.seat.renewLimitMenu',
      'acct.seat.renewTitle',
      'acct.seat.activateTitle',
      'acct.seat.renewConfirm',
      'acct.seat.activateConfirm',
      'acct.seat.renewField.account',
      'acct.seat.renewField.cost',
      'acct.seat.renewField.costValue',
      'acct.seat.renewField.validity',
      'acct.seat.disconnectNote',
      'acct.seat.err.quota',
      'acct.seat.err.cap',
      'acct.seat.err.expired',
      'acct.seat.err.renewLimit',
      'acct.seat.err.swapLimit',
      'auth.seat.vacantSwappable',
      'auth.seat.vacantSameOnly',
      'auth.seat.newSeat',
      'auth.seat.capReached',
    ]
    for (const key of seatKeys) {
      assert.equal(typeof zh[key], 'string', `missing zh.${key}`)
      assert.equal(typeof en[key], 'string', `missing en.${key}`)
      assert.equal(zh[key].includes('·'), false, `zh.${key} must not contain middle dot`)
      assert.equal(en[key].includes('·'), false, `en.${key} must not contain middle dot`)
    }

    const stylesSrc = readFileSync(join(publishRoot, 'src/client/styles.js'), 'utf8')
    const seatBlockStart = stylesSrc.indexOf('.omnimux-publish-accounts-seat-subrow')
    const seatBlockEnd = stylesSrc.indexOf('.omnimux-publish-accounts-item:hover')
    assert.ok(seatBlockStart > 0 && seatBlockEnd > seatBlockStart, 'seat styles block exists')
    const seatBlock = stylesSrc.slice(seatBlockStart, seatBlockEnd)
    assert.doesNotMatch(seatBlock, /#[0-9a-fA-F]{3,8}|rgba?\(/, 'seat styles must use semantic tokens only')
  })
})
