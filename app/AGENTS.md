# DSH Desktop repository rules

This repository owns the desktop product around an unmodified DeepSeek Harness checkout. **It is the shipping OmniMux desktop line**: `/Applications/OmniMux.app` and released builds come from here.

## Prerequisites and setup

- Use Node.js `^22.19.0` or `>=24.0.0` and the root Yarn `4.18.0` release through Corepack.
- Initialize the pinned upstream checkout with `git submodule update --init --recursive`.
- Install root dependencies with `corepack yarn install --immutable`.

## Build, run, and verify

- Start the desktop development workflow with `corepack yarn dev`.
- Build the desktop package with `corepack yarn build`.
- The bundled `dshmarket` version and its Desktop compatibility patch live in the root `resolutions` (`dshmarket@npm:1.73.8` → `.yarn/patches/dshmarket-desktop.patch`); commit the version, the patch, and the lockfile together. Installed apps do not hot-update executable plugins on launch. Releases build the committed version (`DSH_MARKET_USE_VENDORED=1` set in `.github/workflows/release.yml`) instead of following the npm `latest` tag.
- Before each release, run `corepack yarn aa:prepare-release` to build the official Agents Anywhere `main` for both Desktop workspaces (`dsh-plugin-desktop` and `dsh-desktop-next`, see `scripts/agents-anywhere-release-policy.mjs`). Commit the resulting artifact, provenance, manifests, and lockfile before packaging. Releases build reproducibly from the committed artifact: with `DSH_AA_USE_VENDORED=1` (set by `.github/workflows/release.yml`) `aa:prepare-release` and the signed-macOS/root-Windows verification pin to the exact commit recorded in `vendor/agents-anywhere/provenance.json` instead of the upstream main head (which may target a newer DSH line than this repo ships). Refresh the vendored artifact deliberately, and only together with a matching DSH line bump. `DSH_AA_SOURCE_REF=pinned` is still rejected.
- Run unit tests with `corepack yarn test`.
- Run type checking with `corepack yarn typecheck`.
- Run the complete headless gate with `corepack yarn check`.
- `dsh-desktop-next/` is the OmniMux product shell, branded in-tree from the upstream Next shell. It carries the shipped identity (`OmniMux` / `ai.omnimux.desktop` / `~/.omnimux`) through `src/product-identity.ts`, participates in root `build` / `typecheck` / `test` and in `corepack yarn check`, and has its own release entries (`dist:mac:next`, `dist:win:next`, `check:next`). `dsh-plugin-desktop` remains the shipped line until the shell swap is cut over; both are gated. Upstream's `dsh-plugin-desktop-beta` variant stays deliberately absent.
- Run upstream operations through the root scripts, such as `corepack yarn upstream:build`.


## OmniMux plugin ops (this repo is the day-to-day entry)

This fork is the **main ops entry** for OmniMux plugin develop / browser QA / sync-to-app / release. Plugin source lives in this repository's `plugins/` directory; the desktop shell (`app/`) and product plugins (`plugins/`) are developed and released together from this single repository (single ops entry; no per-plugin deploy lanes).

| Command | Purpose |
| --- | --- |
| `yarn omnimux:dev start <task> <plugin>` | L2: isolated Host + link one in-progress plugin + unified watch (official HMR) |
| `yarn omnimux:dev watch <task> <plugin>` | Switch which plugin the watch targets (Host stays up) |
| `yarn omnimux:sync [plugin…]` | Build then materialize into `~/.omnimux-dev/profiles/omnimux` (`--prod` targets `~/.omnimux`) (**does not restart App**) |
| `yarn omnimux:restart` | Manually restart `/Applications/OmniMux.app` after sync |
| `yarn omnimux:doctor` | Compliance check (prod must not link, etc.) |
| `yarn omnimux:stage` | Materialize into `preset/plugins/` before packaging |
| `yarn omnimux:path` | Print resolved product/plugin paths |
| `yarn omnimux:prod-reset` | Dry-run wipe of local **production** install (`OmniMux.app` + `~/.omnimux`); add `--yes` to execute. Never touches Dev. For clean user-scenario retests. |
| `yarn omnimux:dev-reset` | Reset **Dev** to first-run state so the runtime guide reappears; auto-backs up `~/.omnimux-dev/profiles/omnimux/cordis.patch.yml`; `--dry-run` previews, `--restart` quits/reopens Dev. |

MUST NOT hand-`rsync`/`cp` into any profile. Daily iteration uses `omnimux:sync` + `omnimux:restart`; packaging uses `omnimux:stage` then `package:dir` / `dist:*`.
**Packaging Pre-requisite Rule**: Direct packaging or running `package-dir.mjs` without staging will cause startup crash (`missing dsh-better-sidebar` recovery window). When rebuilding `/Applications/OmniMux.app` or packaging distribution bundles, ALWAYS ensure `OMNIMUX_PLUGINS_DIR` is set and run `stage-preset-profile` (`node ./dsh-plugin-desktop/scripts/stage-preset-profile.ts` or `yarn omnimux:stage`) before packaging. Before `yarn package:dir` / `dist:*`, also run `corepack yarn install --immutable` at the repo root when `node_modules` may be stale: a hollow tree (declared `@deepseek-ai/*` missing from workspace `node_modules`) fails `tsc --emitDeclarationOnly` and makes electron-builder abort on missing production deps such as `@deepseek-ai/dsh-api-session-controller`.

- `deepseek-harness/` is a pinned upstream Git submodule. Never edit files inside it from a desktop feature branch.
- `dsh-plugin-desktop/` owns the Cordis Host and Client faces, Electron bootstrap, packaging, and release tests.
- `dsh-desktop-next/` owns the OmniMux Desktop shell, Profiles and recovery, and adapters for the existing AA bridge and Community Market. Keep its upstream reference and published runtime versions aligned; do not fork the official main frontend. Its product identity lives in `src/product-identity.ts` and must keep the shipped appId and `.omnimux` home so an upgrade stays one application.
- `dsh-community-fabric/` owns the community interoperability RFC. Until schemas and a reviewed reference adapter exist, it remains a private documentation scaffold and must not declare loadable DSH or package entry points.
- `dsh-community-market/` owns the community-market shell. Until its runtime is implemented, it remains a private documentation scaffold and must not declare loadable DSH or package entry points.
- The outer repository and all owned packages use the root Yarn release with `nodeLinker: node-modules`.
- The upstream submodule keeps its own pnpm workspace. Run upstream commands through the root `upstream:*` scripts, whose Yarn portable-shell commands enter the submodule before invoking Corepack.
- Compatibility mode must run the upstream default client without overrides. Advanced presentation belongs to desktop-owned client plugins and may replace documented slots or services through profile composition.
- Keep graphical application launch explicit. Builds, typechecks, unit tests, and Loader smokes must remain headless-safe.
- Commit before major changes of direction and keep the submodule pin update separate from desktop behavior changes.
- Keep the repository topology and package-manager split consistent.

## Repository ecosystem

This desktop product is one part of the OmniMux client: the whole client ships as this single repository, which contains the desktop shell (`app/`) and the preset OmniMux product plugins (`plugins/`), and talks to the OmniMux Go gateway over `OMNIMUX_BASE_URL`. The DeepSeek Harness upstream is a pinned submodule under `app/deepseek-harness`; never edit it from a feature branch.

- **Public source publication.** This repository carries installers and GitHub Releases. Public source publication is handled by the unified gateway-side publisher as a release-time snapshot — never hand-copy files into a snapshot or widen an export scan allowlist to get a run through.

## Upstream sync contract

This fork syncs with upstream weekly. Before any merge from `origin/master`, follow the four-tier merge decision ladder (auto-merge / template-resolve / user-confirm / reject) and record every decision in the sync decision log. A merge without a log entry is not done.

## Release & R2 Distribution SOP

Distribution assets (macOS arm64/x64 DMGs & Windows x64 NSIS) are hosted in Cloudflare R2 bucket `omnimux-dist` via `https://dl.omnimux.ai`.

- macOS artifact standard: **separate arm64 and x64 DMGs** (`OmniMux-<version>-arm64.dmg` / `OmniMux-<version>-x64.dmg`), each built, signed, notarized, and stapled independently. No universal build is produced.
- Windows artifact standard: **x64 NSIS Installer** (`OmniMux-<version>-x64-Setup.exe`). Supports silent install `/S` for auto-update and **website / CDN** distribution via `yarn dist:win` (unsigned).
- **Current Windows policy**: website-first, Microsoft Store paused (zero extra signing budget). Paid Authenticode / Store resubmission remains optional and only after an explicit paid-signing decision.
- **Public download page**: primary CTAs MUST point at `https://dl.omnimux.ai/` (not Store, not legacy `dshdesktop.cn`).
- Sync artifacts to R2: `yarn dist:r2-sync` (or `node scripts/r2-dist-sync.mjs upload`).
- Verify CDN endpoints: `yarn dist:r2-verify` (or `node scripts/r2-dist-sync.mjs verify`).
- List R2 bucket assets: `yarn dist:r2-list` (or `node scripts/r2-dist-sync.mjs list`).

## Parallel development & PR contract

Multi-session feature work follows one task → one path lease → one worktree → one branch → one PR; the main checkout is read-only for day-to-day coding. Local board/leases live under `.workbuddy/` (not committed). PR merge and dev delivery are automated once strict verifications pass (L0 unit tests, L2 dev environment, real browser / live runtime verification, and CI pass); manual review/pause is required only on test failure, unresolved blockers, production `--prod` release, or explicit user hold. After a PR is open/merged, follow-up updates `.workbuddy/pr-board.md`. Plugin-tree Git/PR lives in this repository's `plugins/` tree — do not reuse the desktop fork's topology there.

DSH PreToolUse worktree guard: `scripts/ops/guard-worktree.mjs` denies tracked-file edits and protected-scope new files in the main checkout — enforced both through `edit`/`write` and through shell writes (`>`/`tee`/`cp`/`mv`/`sed -i`, nested `bash -c`) — plus primary `git switch`/`checkout`. It is wired in via the hub dispatcher `.dsh/hooks.local.json` → `.dsh/guard-dispatch.mjs` (`REPO_GUARDS`), and may also be registered in this repo's own `.dsh/hooks.json` for standalone sessions. Guards/config: bash-editable only.
