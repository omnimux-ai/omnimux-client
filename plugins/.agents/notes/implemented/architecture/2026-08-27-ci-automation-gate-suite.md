# Agent Note: CI automation gate suite for OmniMux plugins

Status: implemented

English | [中文](2026-08-27-ci-automation-gate-suite.zh.md)

## Problem

OmniMux plugin development across multiple collaborating AI agents and human engineers previously lacked a unified, mechanically enforced decision lifecycle and architecture boundary gate. Without mechanical gates, architectural drift, context rot, unmaintained bilingual documentation, and cross-plugin dependency leaks degraded code quality over time.

## Decision

We adopt a comprehensive automated CI gate suite directly inside `omnimux-dsh`:

1. **Agent Note Life-Cycle & Format Enforcement**:
   - `scripts/verify-agent-note-format.mjs` enforces the 4-line header contract, mandatory `## Problem`, `## Decision`, `## Alternatives considered`, and `## Consequences` structure, while strictly banning proposal-era spec-speak (`Proposal`, `Plan`, `Acceptance criteria`) in `implemented/`.
   - `scripts/lib/agent-note-tree.mjs` enforces the 6 closed classification folders (`feature`, `bug-fix`, `simplification`, `architecture`, `process`, `testing`), dated filenames (`yyyy-mm-dd-topic.md`), and explicitly forbids centralized `INDEX.md`.

2. **Bilingual Pairing Consistency with Git Blob Hashes**:
   - `scripts/verify-bilingual-docs.mjs` pairs `.md` and `.zh.md` with `.i18n.yaml` sidecar records tracking exact Git Blob SHA-1 hashes. Editing either side without updating the other immediately fails CI.

3. **Cryptographically Sealed Append-Only Archive**:
   - `scripts/verify-archived-agent-notes.mjs` seals low-future-value notes in `archived/` using SHA-256 signatures in `archived/manifest.json`.

4. **Plugin Dependency & Architecture Boundaries**:
   - `scripts/verify-plugin-boundaries.mjs` verifies that plugins only import authorized public interfaces, preventing cross-plugin leakage and unauthorized host mutations.

5. **Integrated npm Scripts**:
   - `pnpm note:lint`, `pnpm doc:pairing`, `pnpm check:boundaries`, `pnpm archived:verify`, and aggregated `pnpm check:all` are added to `package.json`.

## Alternatives considered

- **Manual PR Reviews Only**: Rejected because human reviewers and AI agents cannot consistently remember and enforce subtle format and lifecycle rules across dozens of pull requests.
- **Single Monolithic Markdown Index**: Rejected because centralized index files create massive Git merge conflicts during concurrent multi-agent development.
- **External Front-Matter Metadata Only**: Rejected because file-system path encoding (`{lifecycle}/{class}/`) provides zero-parse directory-level clarity and native tooling navigation.

## Consequences

Adding non-trivial capabilities or structural changes now requires maintaining an Agent Note in the same PR. Automated gates prevent context decay and ensure long-term architectural stability across autonomous agent turns.
