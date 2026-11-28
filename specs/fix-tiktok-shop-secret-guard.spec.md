# Fix Secret Guard False Positives and Detail Fallback Edge Cases

Issue: #443

## Problem Statement
1. During live acceptance of `omnimux-tiktok-selection` and `omnimux-products`, `sendJson` returned HTTP 500 `{"error":"refused to emit a secret"}` on legitimate product lists and TikTok Shop product URLs.
   - `plugins/plugins/omnimux-tiktok-selection/src/http-routes.js` matched `/sk-[A-Za-z0-9_-]{16,}|.../i` without a leading token boundary and permitted hyphens inside the matched body, causing words ending in `sk` followed by hyphenated slugs (such as `...mask-hyaluronic-acid-serum...` or `desk-organizer-...`) to match as API keys.
   - `plugins/plugins/omnimux-products/src/http-routes.js` matched `/access_token|sk-[A-Za-z0-9_-]{16,}/` without a leading token boundary and permitted hyphens inside the matched body, creating the same false-positive hazard on imported TikTok Shop URL slugs.
2. Follow-up edge cases from PR #440 review:
   - `firstImageUrl` in `plugins/plugins/omnimux-tiktok-selection/src/datasource.js` only inspected the first non-empty image entry and could return a HEIC URL when `images[0]` was HEIC-only even if `images[1]` had a renderable `.webp`/`.jpg` URL.
   - `findProductInfoWithMeta` (`omnimux-tiktok-selection/src/datasource.js`) and `locateProductInfo` (`omnimux-products/src/tiktok-shop-import.js`) short-circuited on an empty `global_data.product_info` stub without checking populated `components_map` entries.

## Design & Changes
1. **`omnimux-tiktok-selection/src/http-routes.js`**:
   - Export `SECRET_PATTERNS` requiring a leading boundary `(?:^|[^A-Za-z0-9_-])` before case-sensitive `sk-` API key prefixes (`sk-ant-api\d+-`, `sk-or-v\d+-`, `sk-proj-`, `sk-live-`, `sk-test-`, `sk-svcacct-`, `sk-admin-`, allowing `[A-Za-z0-9_-]{16,}` bodies for explicitly prefixed keys and `[A-Za-z0-9_]{16,}` for bare `sk-`), plus `\b`-bounded secret key/value pairs (with JSON-escaped quote tolerance) and `\bBearer\s+[A-Za-z0-9._-]{16,}`.
2. **`omnimux-products/src/http-routes.js`**:
   - Export `SECRET_PATTERN` tightening `sk-` matching with the same leading boundary `(?:^|[^A-Za-z0-9_-])`, prefixed vs bare `sk-` bodies, `\bBearer\s+[A-Za-z0-9._-]{16,}`, and `\baccess_token\b`.
3. **`omnimux-tiktok-selection/src/datasource.js`**:
   - Update `firstImageUrl` to scan all candidates for a renderable non-HEIC URL first, keeping the first HEIC URL only as a fallback.
   - Add `hasProductInfoSignal` and defer returning an empty `global_data.product_info` or `components_map` stub until populated candidates are checked.
4. **`omnimux-products/src/tiktok-shop-import.js`**:
   - Add `hasProductInfoSignal` and update `locateProductInfo` so empty `global_data.product_info` or `components_map` stubs fall through to populated product info nodes.

## Verification Plan
- Unit tests in `omnimux-tiktok-selection` (`assets-scheduler-http-tools.test.js`, `store-and-datasource.test.js`) and `omnimux-products` (`http-routes.test.js`, `tiktok-shop-import.test.js`) with two-way falsification against `origin/main`.
- Full plugin build, `bundle-lock.mjs`, `workspace-check.mjs --check`, `verify:product-baseline`, `verify:silent-catch`, `check:boundaries`, and `verify-fix-regression-test.mjs`.
- Live desktop verification across hot-selling rank, keyword search, detail drawer with videos and reviews, and product link import.
