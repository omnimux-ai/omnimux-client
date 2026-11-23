# Upstream Sync Decision Log

This log records upstream synchronization decisions between OmniMux (`app/`) and upstream `deepseek-ai/deepseek-harness` / `anywhere-labs/dsh-desktop`, following the four-tier merge decision ladder (`auto-merge` / `template-resolve` / `user-confirm` / `reject`) declared in [app/AGENTS.md](../../AGENTS.md).

---

## 2026-11-23 · Issue #184 Stage 1 — Kernel Upgrade to `DSH 0.2.2-rc.5` + `dsh-desktop v2.0.24-next`

### 1. Version & Dependency Anchor

| Component | Previous Baseline | Target Anchor | Decision Tier |
| --- | --- | --- | --- |
| `app/deepseek-harness` submodule | `0.2.1-rc.3` (`1f81c047fc48fa190a683e469daa699857e9afe8`) | **`0.2.2-rc.5`** (`9c2670d3bce5275e0d1610272958121af87787bb`, tag `dsh-v0.2.2-rc.5`) | `user-confirm` (approved; `0.2.3-alpha.2` deferred) |
| Upstream `dsh-desktop` reference | Forked near `3c5db655ba98327f16c19bda43e46379a811f33c` (`v2.0.20-next`) | **`v2.0.24-next`** (`1224167a8b480cbdd143197051a60bcb9039d7d8`) | `user-confirm` (approved) |
| `@deepseek-ai/cordis` / `schemastery` | `4.0.5` / `^3.18.5` | **`4.1.0`** / **`^3.19.0`** | `auto-merge` |
| `@earendil-works/pi-ai` | `^1.1.0` (`pi-ai@1.1.0.patch`) | **`1.3.0`** (`pi-ai@1.3.0.patch`) | `auto-merge` |
| `@agents-anywhere/dsh-bridge-next` | `2.1.0-desktop.c46f5479651eb.r7504932a` | **`2.2.0-desktop.cb364f42d2f3f.r2afb7d8b`** (commit `b364f42d2f3fa19797f633ea05d3d43b2d6f6e4a`) | `auto-merge` |
| `dshmarket` | `1.73.8` | **`1.73.21`** | `auto-merge` |
| `dsh-better-sidebar` | `0.28.1` (`59131330bb837cf48dc4117b17c091998b595df0`) | **`0.32.1`** (`06d21351a50b60063010c178590fc24ecd76fb74`) | `user-confirm` (rebased `omnimux.patch`) |
| `engines.node` / `electron` | `^22.19.0 \|\| >=24.0.0` / `44.7.0` | **`>=24.9.0`** / **`44.7.0`** (unchanged) | `auto-merge` |
| Pin files | `dsh-version.json`, `app/upstream.json`, `PROVENANCE.json` | Updated active channel to `next` (`0.2.2-rc.5`); kept `stable` (`0.2.1-rc.3`) frozen | `template-resolve` |

### 2. Shell Topology & Legacy Decoupling

- **`app/dsh-desktop-next` (active shell)**: 3-way merged from `3c5db655ba98` → `v2.0.24-next`. Preserved all OmniMux brand identity (`src/product-identity.ts`, `OmniMux` / `ai.omnimux.desktop` / `.omnimux`, icons, wordmark), R2/CDN update & macOS signing pipeline (`scripts/mac-signature-cache.ts`, `scripts/release-mac-all.ts`, `scripts/sign-packaged.ts`, `scripts/summarize-packaging.ts`), `DesktopLaunchAnalytics`, `NativeFilePicker`, `workspace-dependencies` (Office skills excluded; updated `cordis.patch.yml` and `runtime-file-policy.ts` from `office-to-pdf` → `office-kit` + `tool-office`), and `onboarding.desktop.runtime` child slot (moved into `dsh-desktop-next/src/client/onboarding.tsx` with upstream `OnboardingStyleScope`).
- **`app/dsh-plugin-desktop` (legacy shell)**: Frozen at `0.2.1-rc.3` following upstream `v2.0.24-next`. Directory retained; only 6 pure-upstream shared helper modules imported by `dsh-desktop-next` (`src/recovery-copy.ts`, `src/native-ui/recovery/App.tsx`, `src/native-ui/components/ui/scroll-area.tsx`, `scripts/package-linux.ts`, `scripts/package-mac.ts`, `build/installer.nsh`, `build/installer-directories.nsh`) were aligned with `v2.0.24-next`.
- **Shared scaffolding decoupled**: Migrated canonical `build-patched-sidebar` from `app/dsh-plugin-desktop/scripts/better-sidebar/` to `app/scripts/better-sidebar/build-patched-sidebar.mts` (updated to `0.32.1`), leaving a thin re-export wrapper in the frozen legacy path.
- **Rejected upstream additions**: `dsh-plugin-desktop-beta` workspace, `dsh-tokens-anywhere` workspace, `scripts/test-beta-variant.*`, `scripts/verify-desktop-variants.mjs`, and `dsh-desktop-next/src/host/office.ts` (`reject` per OmniMux product scope).

### 3. Desktop UI Patches (`docs/desktop-patches.md`, DP-001 ~ DP-004)

| ID | Decision | Summary |
| --- | --- | --- |
| **DP-001** | Keep & refactor fullscreen (`user-confirm`) | Preserved macOS expanded sidebar brand lift in `app/dsh-desktop-next/src/client/styles.ts`. Refactored `[data-fullscreen]` rule from `padding-left: 4px; margin-right: 44px` to `padding-left: 44px; margin-right: 0` to clear `0.2.2-rc.5`'s left-aligned fullscreen toggle (`justify-content: flex-start` in `SidebarRoot.module.css`). |
| **DP-002** | Keep + adopt upstream drag fix (`auto-merge`) | Preserved Settings nav `40x164` scroll geometry and merged upstream `v2.0.24-next`'s `html[data-platform='darwin'] [data-plugin-bar][data-natural] [data-window-drag]::after` drag correction. |
| **DP-003** | Retired (`UPSTREAM_FIXED` → deleted) | Removed from `plugins/plugins/omnimux/src/client/conversation-box.js` and `docs/desktop-patches.md`. `DSH 0.2.2-rc.5` `AppFrame` + `ConversationRoot` natively publish and consume `--dsh-frame-leading-clearance` (`160px` macOS windowed / `84px` fullscreen). |
| **DP-004** | Keep — Route B (`user-confirm`) | Retained in `plugins/plugins/omnimux/src/client/sidebar-toggle-topbar.js` under Route B: hides `[data-shell-leading]` while `html[data-omnimux-sidebar-toggle-topbar]` is active and drops macOS traffic-light left offset in `html[data-fullscreen]` so the collapsed two-button cluster right edge stays within official clearances (`156px <= 160px` windowed, `80px <= 84px` fullscreen). Required because `dsh-better-sidebar@0.32.1` workbench body-portal (`z-index: 40`) and fullscreen right panel (`z-index: 30`) sit above `.leadingSeat` (`z-index: 15`), and `sidebar-toggle-topbar.js` owns the OmniMux collapsed multi-entry new-session menu (`openCollapsedNewMenuAt`) and split-ratio coordination. |

### 4. Complete Patch Governance (38 Local Patches + 16 Upstream New Patches)

#### 4.1 Class A — Deleted / Retired for `0.2.2-rc.5`

| Patch File | Disposition | Rationale |
| --- | --- | --- |
| `app/patches/dsh-better-sidebar/0.14.0/omnimux.patch` | **Deleted** | Obsolete unreferenced version. |
| `app/patches/dsh-better-sidebar/0.18.0/omnimux.patch` | **Deleted** | Obsolete unreferenced version. |
| `app/patches/dsh-better-sidebar/0.19.1/omnimux.patch` | **Deleted** | Obsolete unreferenced version. |
| `app/.yarn/patches/dshmarket-npm-1.38.1-775916754e.patch` | **Deleted** | Dead unreferenced patch. |
| `app/patches/open@11.0.1.patch` | **Deleted** | Upstream converged on `open@11.0.4.patch` (`#1672`). |
| `dsh-client-modules@0.2.1-rc.3.patch` | **Not carried to `0.2.2-rc.5`** (frozen legacy only) | Upstream dropped in `#1672`. |
| `dsh-client-ui-directory-picker-browse@0.2.1-rc.3.patch` | **Not carried to `0.2.2-rc.5`** (frozen legacy only) | Replaced by shell slot `dsh-desktop-next/src/client/directory-picker.ts`. |
| `dsh-client-ui-primitives@0.2.1-rc.3.patch` | **Not carried to `0.2.2-rc.5`** (frozen legacy only) | Fixed natively in `0.2.2-rc.5` `MarkdownText.module.css`. |
| `dsh-client-ui-settings-general@0.2.1-rc.3.patch` | **Not carried to `0.2.2-rc.5`** (frozen legacy only) | Replaced by native `settings.section.icon` slot. |
| `dsh-client-ui-settings-shell@0.2.1-rc.5` (`@0.2.1-rc.3.patch`) | **Not carried to `0.2.2-rc.5`** (frozen legacy only) | Superseded by `dsh-pwsh-local@0.2.2-rc.5.patch` + `dsh-sandbox-local@0.2.2-rc.5.patch`. |
| `dsh-client-ui-sidebar@0.2.1-rc.3.patch` | **Not carried to `0.2.2-rc.5`** (frozen legacy only) | Superseded by `0.2.2-rc.5` `shell.leading` refactor. |
| `dsh-hmr@0.2.1-rc.3.patch` | **Not carried to `0.2.2-rc.5`** (frozen legacy only) | Fixed natively in `0.2.2-rc.5` `package-manifest.ts`. |
| `dsh-plugin-package-inventory-deepseek@0.2.1-rc.3.patch` | **Not carried to `0.2.2-rc.5`** (frozen legacy only) | Fixed natively in `0.2.2-rc.5`. |
| `dsh-ptc-runtime-node@0.2.1-rc.3.patch` | **Not carried to `0.2.2-rc.5`** (frozen legacy only) | `dsh-desktop-next` runs Host on standalone Node; retained in `0.2.1-rc.3` resolutions solely while `dsh-plugin-desktop` remains frozen. |
| `dsh-subprocess-local@0.2.1-rc.3.patch` | **Not carried to `0.2.2-rc.5`** (frozen legacy only) | Same as `dsh-ptc-runtime-node`. |

#### 4.2 Class B — Upgraded / Retained Upstream Patches (20)

- **12 DSH runtime patches upgraded to `@0.2.2-rc.5.patch`** (matching upstream `v2.0.24-next` verbatim):
  `dsh@0.2.2-rc.5.patch`, `dsh-app-boot@0.2.2-rc.5.patch`, `dsh-client-ui-conversation@0.2.2-rc.5.patch`, `dsh-client-ui-plugin-manager@0.2.2-rc.5.patch`, `dsh-experimental-computer-use-cua-driver-native@0.2.2-rc.5.patch`, `dsh-experimental-inspector@0.2.2-rc.5.patch`, `dsh-fs-local@0.2.2-rc.5.patch`, `dsh-host-directory-picker-browse@0.2.2-rc.5.patch`, `dsh-host-open-in-app@0.2.2-rc.5.patch`, `dsh-plugin-manager@0.2.2-rc.5.patch`, `dsh-sandbox-windows-acl@0.2.2-rc.5.patch`, `dsh-web-app@0.2.2-rc.5.patch`.
- **1 third-party patch upgraded**: `pi-ai@1.3.0.patch` (replaces `pi-ai@1.1.0.patch` for `0.2.2-rc.5`; `pi-ai@1.1.0.patch` kept only for frozen `0.2.1-rc.3` resolutions).
- **7 third-party patches retained verbatim**: `@electron__osx-sign@1.3.3.patch`, `app-builder-lib@26.15.7.patch`, `fs-ext@2.1.1.patch`, `node-pty@1.2.0-beta.15.patch`, `open@11.0.4.patch`, `pnpm@11.28.5.patch`, `vscode-ripgrep@1.18.0.patch`.

#### 4.3 Upstream `v2.0.24-next` New Patches Adopted (16 + 1 Frozen Legacy Sync)

- **16 new `0.2.2-rc.5` / third-party patches verified and adopted**:
  1. `dsh-api-session-controller@0.2.2-rc.5.patch`
  2. `dsh-client-ui-open-in-app@0.2.2-rc.5.patch`
  3. `dsh-client-ui-plugin-recommendations@0.2.2-rc.5.patch`
  4. `dsh-client-ui-schedule@0.2.2-rc.5.patch`
  5. `dsh-experimental-client-ui-cot-translation@0.2.2-rc.5.patch`
  6. `dsh-experimental-liveshare@0.2.2-rc.5.patch`
  7. `dsh-experimental-ralph-bundle@0.2.2-rc.5.patch`
  8. `dsh-experimental-session-search@0.2.2-rc.5.patch`
  9. `dsh-experimental-subagent-oar@0.2.2-rc.5.patch`
  10. `dsh-http-proxy@0.2.2-rc.5.patch`
  11. `dsh-plugin-detail@0.2.2-rc.5.patch`
  12. `dsh-pwsh-local@0.2.2-rc.5.patch`
  13. `dsh-sandbox-local@0.2.2-rc.5.patch`
  14. `dsh-session-reference@0.2.2-rc.5.patch`
  15. `dsh-storage-json@0.2.2-rc.5.patch`
  16. `meshcall@0.3.0.patch`
- **1 frozen legacy resolution patch synced**: `dsh-storage-json@0.2.1-rc.3.patch` (UTF-8 BOM tolerance referenced by upstream `0.2.1-rc.3` resolutions).

#### 4.4 Class C — High-Risk Custom Patches (3)

1. **`app/patches/dsh-better-sidebar/0.32.1/omnimux.patch`** (replaced `0.28.1/omnimux.patch`):
   - Rebased from `0.28.1` (`59131330`) onto `0.32.1` (`06d21351`, lockfile SHA-256 `c9373112...`).
   - Preserved 100% of OmniMux strict sandboxed `<HtmlPreview>` (zero sandbox escape hatch; `src/html-preview-*.ts`, `src/client/HtmlPreview.tsx`, `html.preview` RPC) and relative workspace link interception (`src/client/candidate-paths.ts`, `src/client/link-intercept.ts`, `openFileInSidebar`).
   - Dropped redundant OmniMux `audio`/`video` viewers and custom `parseByteRange` hunks because `dsh-better-sidebar@0.32.1` now natively ships the `media` viewer (`MediaPreview`) and RFC 7233 `byteRangeOf` (`206`/`416`) streaming.
   - Reduced patch surface from 41 files (99 KB) to 18 files (74 KB); verified clean apply, `pnpm run build`, and 97/97 targeted vitest tests.
2. **`app/.yarn/patches/dshmarket-desktop.patch`**:
   - Verified zero OmniMux-private diffs; adopted upstream `v2.0.24-next` patch for `dshmarket@1.73.21`.
3. **`app/patches/dsh-client-ui-settings-account@0.2.2-rc.5.patch`**:
   - Built cleanly on top of upstream `v2.0.24-next`'s `dsh-client-ui-settings-account@0.2.2-rc.5.patch` with minimal surgical replay of 3 OmniMux runtime customizations:
     - `AccountOnboarding` (`settings.models.sign-in`) delegation to `window.__omnimuxAuth.ensureLogin`;
     - `AccountMenu` (`settings.launcher`) OmniMux identity/avatar/sign-out bridge (`OMNIMUX_AUTH_GLOBAL` / `/omnimux/auth/status` / `/omnimux/avatar` / `/omnimux/auth/logout`);
     - `DesktopOnboardingEntry` (`fallback: globalThis.dshDesktopSetup ? null : renderNext()`), `DesktopOnboardingController` skip when `globalThis.dshDesktopSetup` is present, and `'onboarding.desktop.runtime'` slot typing in `lib/types/client/index.d.ts`.
   - **Zero-patch `contactFormUrl` configuration**: Removed both `contactFormUrl` URL hunks (`lib/index.js` and `lib/client.js`) from the patch and moved OmniMux's public feedback questionnaire URL to `app/dsh-desktop-next/cordis.patch.yml` (`id: ui-settings-account` → `config.contactFormUrl`), injected at runtime into `globalThis.__DSH_CONTACT_CONFIG__` via `webserver/index-inject`.
   - Verified syntax with `node --check` and clean `git apply --check` on the pristine `0.2.2-rc.5` tarball.

### 5. Source-Level Boundary Clarifications (`DSH 0.2.2-rc.5` vs `0.2.3-alpha.1+`)

Auditing the pinned `0.2.2-rc.5` submodule (`9c2670d3bce5275e0d1610272958121af87787bb`) against `0.2.3-alpha.1+` upgrade notes confirmed the following exact boundaries:

| Surface | Actual `0.2.2-rc.5` Source State | `0.2.3-alpha.1+` Shift | OmniMux Dual-State Handling |
| --- | --- | --- | --- |
| `connection.requestRejection` & WebServer route `auth` | `ctx.connection.requestRejection(req)` is still live (`packages/client/connection/src/rpc-host.ts`); `webServer.register` does not yet enforce `auth` or pass an admitted `peer` argument. | Route-level `auth: 'required' \| 'anonymous'` passes admitted `peer` to handlers and deprecates/removes manual `requestRejection`. | Non-workflow plugins declare explicit `auth: 'required' \| 'anonymous'` on all routes and use a dual-admission guard: accept admitted `peer` when present (`0.2.3+`), otherwise fall back to `ctx.connection.requestRejection(req)` (`0.2.1-rc.3` / `0.2.2-rc.5`), preventing `503` false positives while enforcing full auth on `0.2.2-rc.5`. |
| `settings.plugins.tab` vs `plugins.detail.section` | Both `settings.plugins.tab` (`packages/client/ui-settings/src/client/contract/slots.ts`) and `plugins.detail.section` (`packages/client/ui-plugin-manager/src/client/slot-contract.ts`) exist and are active in `0.2.2-rc.5`. | `settings.plugins.tab` is retired in `0.2.3+`. | `omnimux` retains its `settings.plugins.tab` contribution and also registers `DshPluginsSection` on `plugins.detail.section` so the read-only inventory remains reachable across both versions. |
| `client-hmr` (`@deepseek-ai/dsh-client-hmr`) | `@deepseek-ai/dsh-web-app` still mounts the official SSE `client-hmr` row (`/plugins/events`). | Moves plugin rebuild streaming to `pluginEvents/follow` and retires `/plugins/events` SSE. | `app/dsh-desktop-next/cordis.patch.yml` keeps `id: client-hmr` with `disabled: true` (last-patch override) so OmniMux's WebSocket HMR mounts cleanly without conflict; `omnimux`'s `/plugins/events` intercept remains active on `0.2.2-rc.5` and degrades to a no-op on `0.2.3+`. |
