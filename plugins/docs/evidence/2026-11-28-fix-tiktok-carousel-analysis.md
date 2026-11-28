---
id: 2026-11-28-fix-tiktok-carousel-analysis
title: Fix TikTok Carousel Analysis QA Evidence (#454)
type: evidence
status: accepted
authority: L2
date: 2026-11-28
---

# QA Verification Evidence — Issue #454

## Scope
- `plugins/plugins/omnimux`: `extractTikTokAwemeId` (`/photo/`, `/v/`, `/player/v1/`, `?share_item_id=`), `withPatRaw` signal forwarding, `normalizeCloudMediaKey`, `createInspirationCatalogApi`, `inspirationCatalog` seam provision, and `trending-source.js` `/photo/` fingerprint match.
- `plugins/plugins/omnimux-inspiration`: `getCanonicalItemKey` & `extractTikTokVideoId` `/photo/` support, `saveMediaResponse`, `imagePostUrlsFromLayer`, HEIC avoidance & BGM `.mp3` suppression, `localizeFromCloudCatalog` (`cloud_id` direct localization with `401 needs-omnimux` pass-through, duplicate check before media fetch, rollback, and fallback), TikWM `images` fallback, and client `ensureLocalInspiration` `cloud_id` forwarding.

## Observed Verification Results
1. **Build & Registry**:
   - `corepack pnpm --dir plugins run build:all` — **PASS** (`13/13` plugins built)
   - `corepack pnpm --dir plugins run registry:build && corepack pnpm --dir plugins run registry:verify` — **PASS** (`15/15` plugins, `123` tools, `11` seams consistent)
2. **Unit & Integration Tests**:
   - `env -u OMNIMUX_API_KEY -u OMNIMUX_TOKEN corepack pnpm --dir plugins --filter omnimux test` — **PASS** (`2 + 4137 + 94 = 4233` passed, `0` failed)
   - `corepack pnpm --dir plugins --filter omnimux-inspiration test` — **PASS** (`1979 + 263 = 2242` passed, `0` failed)
3. **Runtime Cordis + HTTP Probe & JSDOM E2E**:
   - Isolated Hub + Inspiration `apply` loopback HTTP probe (`POST /omnimux/inspiration/local/import-url` with `cloud_id`) — **PASS** (`httpStatus: 200`, `type: image`, `content_shape: gallery`, `media_items: 6`)
   - `tiktok-carousel-analysis.e2e.test.js` (Belt 2 cloud localization + `scope: 'post'` analysis without `socialFetcher`; Belt 1 fallback with `resolveSocialDataModel` on `/photo/` carousel and HEIC/BGM suppression; `DENY-NETWORK RECEIPT: 0 outbound attempts`) — **PASS** (`2/2`)
4. **Static / Security / Governance Gates**:
   - `verify:plugin-load` (`15/15`), `check:boundaries` (`5386` files, `79/79`), `verify:product-baseline`, `verify:silent-catch`, `verify:dsh-lockfile`, `presets:verify` (`16/16`) — **PASS**
