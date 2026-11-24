#!/usr/bin/env node
/**
 * Targeted anti-drift gate: verify that active public documentation declares
 * the same active DSH runtime version pinned in `dsh-version.json`.
 *
 * Scope is intentionally narrow:
 * - Only checks active runtime version declarations in the 4 active public docs
 *   (`README.md`, `docs/README.zh-CN.md`, `app/docs/architecture.md`, `app/docs/architecture.en.md`).
 * - Deliberately ignores historical sync logs (`app/docs/contracts/upstream-sync-log.md`)
 *   and frozen legacy shell (`dsh-plugin-desktop`) version references.
 *
 * Usage:
 *   node scripts/verify-docs-dsh-version.mjs
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SEMVER_PATTERN = '([0-9]+\\.[0-9]+\\.[0-9]+(?:-[0-9A-Za-z.-]+)?)'

export const ACTIVE_DOC_VERSION_TARGETS = Object.freeze([
  Object.freeze({
    path: 'README.md',
    description: 'DeepSeek Harness active runtime version declaration',
    pattern: new RegExp(`DeepSeek Harness(?:\\]\\([^)]+\\))?\\s+runtime\\s*\\(\`${SEMVER_PATTERN}\``, 'gu'),
    minMatches: 3,
  }),
  Object.freeze({
    path: 'docs/README.zh-CN.md',
    description: 'DeepSeek Harness 活跃运行时版本声明',
    pattern: new RegExp(`DeepSeek Harness(?:\\]\\([^)]+\\))?\\s*运行时（\`${SEMVER_PATTERN}\``, 'gu'),
    minMatches: 3,
  }),
  Object.freeze({
    path: 'app/docs/architecture.md',
    description: 'dsh-desktop-next 活跃桌面壳 DSH 版本声明',
    pattern: new RegExp(`\`dsh-desktop-next\`[^\\n]*?DSH\\s+\`${SEMVER_PATTERN}\``, 'gu'),
    minMatches: 1,
  }),
  Object.freeze({
    path: 'app/docs/architecture.en.md',
    description: 'dsh-desktop-next active shell DSH version declaration',
    pattern: new RegExp(`\`dsh-desktop-next\`[^\\n]*?DSH\\s+\`${SEMVER_PATTERN}\``, 'gu'),
    minMatches: 1,
  }),
])

function lineNumberAt(text, index) {
  let line = 1
  for (let i = 0; i < index; i += 1) {
    if (text.charCodeAt(i) === 10) line += 1
  }
  return line
}

export function verifyDocsDshVersion({ repoRoot = DEFAULT_REPO_ROOT } = {}) {
  const versionFile = join(repoRoot, 'dsh-version.json')
  if (!existsSync(versionFile)) {
    return { ok: false, expectedVersion: null, checkedCount: 0, errors: ['dsh-version.json is missing'] }
  }

  let versionDoc
  try {
    versionDoc = JSON.parse(readFileSync(versionFile, 'utf8'))
  } catch (error) {
    return {
      ok: false,
      expectedVersion: null,
      checkedCount: 0,
      errors: [`dsh-version.json is invalid JSON: ${error instanceof Error ? error.message : String(error)}`],
    }
  }

  const runtimeVersion = versionDoc?.dsh?.runtimePackageVersion
  const sourceVersion = versionDoc?.dsh?.sourceVersion
  if (typeof runtimeVersion !== 'string' || runtimeVersion.trim() === '') {
    return { ok: false, expectedVersion: null, checkedCount: 0, errors: ['dsh-version.json is missing dsh.runtimePackageVersion'] }
  }

  const expectedVersion = runtimeVersion.trim()
  const errors = []
  if (typeof sourceVersion === 'string' && sourceVersion.trim() !== '' && sourceVersion.trim() !== expectedVersion) {
    errors.push(`dsh-version.json disagrees: sourceVersion=${sourceVersion.trim()} != runtimePackageVersion=${expectedVersion}`)
  }

  let checkedCount = 0
  for (const target of ACTIVE_DOC_VERSION_TARGETS) {
    const filePath = join(repoRoot, target.path)
    if (!existsSync(filePath)) {
      errors.push(`${target.path}: required active doc is missing`)
      continue
    }

    const content = readFileSync(filePath, 'utf8')
    const regex = new RegExp(target.pattern.source, target.pattern.flags)
    const matches = []
    for (const match of content.matchAll(regex)) {
      matches.push({
        version: match[1],
        line: lineNumberAt(content, match.index ?? 0),
      })
    }

    if (matches.length < target.minMatches) {
      errors.push(
        `${target.path}: expected at least ${target.minMatches} active DSH version declaration(s) (${target.description}), found ${matches.length}`,
      )
    }

    for (const found of matches) {
      checkedCount += 1
      if (found.version !== expectedVersion) {
        errors.push(
          `${target.path}:${found.line}: declares DSH ${found.version}, expected ${expectedVersion} from dsh-version.json`,
        )
      }
    }
  }

  return {
    ok: errors.length === 0,
    expectedVersion,
    checkedCount,
    errors,
  }
}

function isDirectExecution() {
  const entry = process.argv[1]
  return entry !== undefined && resolve(fileURLToPath(import.meta.url)) === resolve(entry)
}

if (isDirectExecution()) {
  const result = verifyDocsDshVersion()
  if (!result.ok) {
    for (const error of result.errors) {
      console.error(`verify-docs-dsh-version: ${error}`)
    }
    process.exit(1)
  }
  console.log(
    `verify-docs-dsh-version: OK — ${result.checkedCount} active declarations across ${ACTIVE_DOC_VERSION_TARGETS.length} docs match ${result.expectedVersion}`,
  )
}
