import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { ACTIVE_DOC_VERSION_TARGETS, verifyDocsDshVersion } from './verify-docs-dsh-version.mjs'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function createIsolatedFixture() {
  const root = mkdtempSync(join(tmpdir(), 'omnimux-docs-dsh-version-'))
  cpSync(join(REPO_ROOT, 'dsh-version.json'), join(root, 'dsh-version.json'))
  for (const target of ACTIVE_DOC_VERSION_TARGETS) {
    const destination = join(root, target.path)
    mkdirSync(dirname(destination), { recursive: true })
    cpSync(join(REPO_ROOT, target.path), destination)
  }
  return root
}

describe('verify-docs-dsh-version', () => {
  it('passes against the current repository active public documentation', () => {
    const result = verifyDocsDshVersion({ repoRoot: REPO_ROOT })
    assert.equal(result.ok, true, `unexpected errors: ${result.errors.join('; ')}`)
    assert.equal(result.expectedVersion, '0.2.2-rc.5')
    assert.equal(result.checkedCount, 8)
    assert.deepEqual(result.errors, [])
  })

  it('fails when any active public document drifts to a stale DSH version', () => {
    for (const target of ACTIVE_DOC_VERSION_TARGETS) {
      const root = createIsolatedFixture()
      try {
        const filePath = join(root, target.path)
        const original = readFileSync(filePath, 'utf8')
        const drifted = original.replace('0.2.2-rc.5', '0.2.1-rc.3')
        assert.notEqual(drifted, original, `${target.path} must contain active version before drift mutation`)
        writeFileSync(filePath, drifted, 'utf8')

        const result = verifyDocsDshVersion({ repoRoot: root })
        assert.equal(result.ok, false, `expected drift in ${target.path} to fail`)
        assert.ok(
          result.errors.some(error => error.includes(target.path) && error.includes('0.2.1-rc.3') && error.includes('0.2.2-rc.5')),
          `expected precise drift error for ${target.path}, got: ${result.errors.join('; ')}`,
        )
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    }
  })

  it('does not flag historical sync logs or frozen legacy dsh-plugin-desktop 0.2.1-rc.3 notes', () => {
    const root = createIsolatedFixture()
    try {
      const logPath = join(root, 'app/docs/contracts/upstream-sync-log.md')
      mkdirSync(dirname(logPath), { recursive: true })
      writeFileSync(
        logPath,
        '# Sync Log\n- Legacy `dsh-plugin-desktop` frozen on `0.2.1-rc.3`.\n- Upgraded from DeepSeek Harness runtime (`0.2.1-rc.3`).\n',
        'utf8',
      )

      const zhArch = readFileSync(join(root, 'app/docs/architecture.md'), 'utf8')
      const enArch = readFileSync(join(root, 'app/docs/architecture.en.md'), 'utf8')
      assert.ok(zhArch.includes('`dsh-plugin-desktop`') && zhArch.includes('0.2.1-rc.3'))
      assert.ok(enArch.includes('`dsh-plugin-desktop`') && enArch.includes('0.2.1-rc.3'))

      const result = verifyDocsDshVersion({ repoRoot: root })
      assert.equal(result.ok, true, `historical/frozen notes must not trigger errors: ${result.errors.join('; ')}`)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('fails when an active runtime version declaration is removed instead of updated', () => {
    const root = createIsolatedFixture()
    try {
      writeFileSync(join(root, 'app/docs/architecture.en.md'), '# Architecture\nNo active shell version here.\n', 'utf8')
      const result = verifyDocsDshVersion({ repoRoot: root })
      assert.equal(result.ok, false)
      assert.ok(
        result.errors.some(error => error.includes('app/docs/architecture.en.md') && error.includes('expected at least 1')),
        `expected missing declaration error, got: ${result.errors.join('; ')}`,
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
