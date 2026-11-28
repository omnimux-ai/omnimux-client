# Fix Synthetic Proxy Fake-IP Image Download for TikTok Shop CDN Hosts

Issue: #449

## Root Cause
When local transparent TUN/fake-IP proxies are active (`198.18.0.0/15`), system DNS resolves remote TikTok Shop CDN hostnames (such as `p16-oec-general.ttcdn-us.com`) into IPv4 `198.18.x.x`. `publicLookup()` in `plugins/plugins/omnimux-products/src/public-fetch.js` rejects all `198.18.0.0/15` addresses via `isPrivateHost()`, causing `persistProductImages()` to silently drop all imported product images (`media: []`, `cover_media_id: null`) even when valid `.webp` URLs are returned.

## Security Design & Changes
Align with `app/dsh-community-market` (`SYNTHETIC_PROXY_NETWORK`):
1. **`plugins/plugins/omnimux-products/src/public-host.js`**:
   - Keep `isBlockedIpv4()` and `isPrivateHost()` unchanged so literal `198.18.x.x` URLs and arbitrary hosts resolving to `198.18.0.0/15` remain blocked.
   - Export `isSyntheticProxyIpv4(address)` recognizing canonical IPv4 `198.18.0.0/15` answers only.
2. **`plugins/plugins/omnimux-products/src/public-fetch.js`**:
   - Add an opt-in `allowSyntheticProxyForHostname` callback to `publicLookup` and `publicFetch`.
   - When non-IP public hostnames are approved by `allowSyntheticProxyForHostname`, allow IPv4 answers in `198.18.0.0/15` (`isSyntheticProxyIpv4`), while strictly blocking all loopback, RFC1918, link-local, CGNAT, IPv6-local, IPv4-mapped IPv6, and mixed-answer responses.
3. **`plugins/plugins/omnimux-products/src/tiktok-shop-import.js`**:
   - Export compiled-in `TIKTOK_SHOP_CDN_SUFFIXES` and `isTikTokShopCdnHost(hostname)`.
4. **`plugins/plugins/omnimux-products/src/link-importer.js`**:
   - In the TikTok Shop `hub.socialData` physical product branch, pass a scoped `publicFetch` wrapper with `{ allowSyntheticProxyForHostname: isTikTokShopCdnHost }` when no custom `fetcher` was injected.

## Verification
- Regression unit tests in `public-fetch.test.js` and `tiktok-shop-import.test.js` with two-way falsification against `origin/main`.
- Full `omnimux-products` test suite, `build:all`, `bundle-lock.mjs`, `workspace-check.mjs --check`, `verify:product-baseline`, `verify:silent-catch`, `check:boundaries`, `verify-fix-regression-test.mjs`, `verify-test-standard-declarations.mjs`, and `gitleaks`.
- Live desktop verification of physical TikTok Shop product link import rendering cover previews in `产品库 -> 添加实物产品`.
