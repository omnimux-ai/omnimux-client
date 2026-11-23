# Contributing to OmniMux

Thank you for your interest in contributing to **OmniMux**. Contributions are welcome across bug reports, documentation, content commerce skills, product plugins, and desktop shell improvements.

## Repository Structure

This repository develops and releases the OmniMux desktop client and product plugins together:

- `app/` — Electron desktop shell and native installers (Yarn 4 workspace; `app/deepseek-harness` is a pinned submodule).
- `plugins/` — OmniMux Execution Hub, domain plugins, and shared UI packages (root pnpm workspace).
- `docs/` — Repository documentation, bilingual READMEs, and subsystem indexes.

Do not edit files inside `app/deepseek-harness` in feature PRs; upstream harness pin updates are tracked separately in `PROVENANCE.json`.

## Development Setup

Prerequisites: **Node.js `^22.19 || >=24`** and **Corepack**.

```bash
git clone https://github.com/omnimux-ai/omnimux-client.git
cd omnimux-client
git submodule update --init --recursive

# 1. Install and build all product plugins (from repository root)
corepack enable
corepack pnpm install --frozen-lockfile
corepack pnpm --dir plugins run build:all

# 2. Verify workspace metadata
node scripts/workspace-check.mjs --check

# 3. Install and run the desktop client
cd app
corepack yarn install --immutable
corepack yarn dev
```

## Making Changes

1. Create a focused branch from `main` (never push directly to `main`).
2. Keep changes scoped to the task and preserve existing contract boundaries:
   - Plugin UI changes should use `plugins/packages/dsh-ui-kit` and host theme tokens.
   - Core workbench features should keep the human UI surface and Agent tool surface backed by the same domain store/service, updating [`plugins/docs/contracts/plugin-agent-tools-inventory.md`](plugins/docs/contracts/plugin-agent-tools-inventory.md) when tools change.
   - Never commit credentials, private endpoints, local machine paths, or personal data.
3. Run the checks matching your change before opening a pull request:
   - Documentation-only changes: `git diff --check` and link verification (`node plugins/scripts/doc-lint.mjs --base origin/main --head HEAD`).
   - Plugin changes: `corepack pnpm --dir plugins run build:all` and the affected package tests.
   - Desktop changes: `cd app && corepack yarn typecheck && corepack yarn test`.
   - Workspace metadata changes: `node scripts/workspace-check.mjs --check`.
4. Use clear, conventional commit titles (for example `feat(workflow): ...`, `fix(clip): ...`, `docs: ...`) and fill out the pull request template with what changed and how it was verified.

## Reporting Bugs & Requesting Features

- Open an issue on [GitHub Issues](https://github.com/omnimux-ai/omnimux-client/issues) with your OS, OmniMux version, reproduction steps, and expected vs. actual behavior.
- For general questions and workflow ideas, join [GitHub Discussions](https://github.com/omnimux-ai/omnimux-client/discussions) or [Discord](https://discord.gg/uNPBDz3WNC).

## License & Code of Conduct

- Contributions to OmniMux-authored files are licensed under [AGPL-3.0](LICENSE) (see [NOTICE](NOTICE)). Contributions to upstream-derived packages retain the license of those packages.
- All participants are expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
- To report a security vulnerability privately, see [SECURITY.md](SECURITY.md).
