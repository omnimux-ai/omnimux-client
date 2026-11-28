/**
 * Path-resolution regression tests for the migration off the retired sibling
 * product tree: `omnimux.mjs path` and `build-plugin-index.mjs` must resolve the
 * in-repo plugin workspace (`<repo>/plugins`) by default, never an external tree.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const appDir = resolve(scriptDir, '..')
const repoRoot = resolve(appDir, '..')

const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')

function cleanEnv() {
  const env = { ...process.env }
  delete env.OMNIMUX_PRODUCT_DIR
  delete env.OMNIMUX_PLUGINS_DIR
  return env
}

function run(script, args) {
  return spawnSync(process.execPath, [join('scripts', script), ...args], {
    cwd: appDir,
    env: cleanEnv(),
    encoding: 'utf8',
  })
}

test('omnimux.mjs path defaults to the in-repo plugins workspace', () => {
  const result = run('omnimux.mjs', ['path'])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, new RegExp(`^product: ${escapeRegExp(repoRoot)}/plugins$`, 'mu'))
  assert.match(result.stdout, new RegExp(`^plugins: ${escapeRegExp(repoRoot)}/plugins/plugins$`, 'mu'))
})

test('build-plugin-index.mjs prefers the in-repo plugins workspace', () => {
  const dir = mkdtempSync(join(tmpdir(), 'omnimux-index-'))
  const out = join(dir, 'dsh-index.json')
  try {
    const generated = run('build-plugin-index.mjs', ['--offline', '--out', out])
    assert.equal(generated.status, 0, generated.stderr)
    assert.match(generated.stdout, new RegExp(`from ${escapeRegExp(repoRoot)}/plugins/plugins`))

    // The installed node_modules copy can lag behind the source workspace. The
    // index must publish the in-repo source version even when an older copy exists.
    const repoVersion = JSON.parse(
      readFileSync(join(repoRoot, 'plugins', 'plugins', 'omnimux', 'package.json'), 'utf8'),
    ).version
    const nodeModulesManifest = join(appDir, 'dsh-desktop-next', 'node_modules', 'omnimux', 'package.json')
    const nodeModulesVersion = existsSync(nodeModulesManifest)
      ? JSON.parse(readFileSync(nodeModulesManifest, 'utf8')).version
      : null
    const generatedIndex = JSON.parse(readFileSync(out, 'utf8'))
    const omnimuxEntry = generatedIndex.plugins.find(plugin => plugin.name === 'omnimux')
    assert.ok(omnimuxEntry, 'generated index must contain omnimux')
    assert.equal(omnimuxEntry.versions[0].version, repoVersion,
      'must publish the in-repo source version, not the installed node_modules copy')
    if (nodeModulesVersion !== null && nodeModulesVersion !== repoVersion) {
      assert.notEqual(omnimuxEntry.versions[0].version, nodeModulesVersion)
    }

    const checked = run('build-plugin-index.mjs', ['--check', '--offline', '--out', out])
    assert.equal(checked.status, 0, checked.stderr)
    assert.match(checked.stdout, /plugin index is current: \d+ plugins/u)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

const NODE_OPTIONS_WITH_VALUE = new Set([
  '--import',
  '-r',
  '--require',
  '--loader',
  '--experimental-loader',
  '-C',
  '--conditions',
  '--env-file',
  '--test-name-pattern',
  '--test-reporter',
  '--test-reporter-destination',
])

const NODE_INLINE_EVAL_OPTIONS = new Set(['-e', '--eval', '-p', '--print'])

function stripShellQuotes(token) {
  if (
    (token.startsWith('"') && token.endsWith('"')) ||
    (token.startsWith("'") && token.endsWith("'"))
  ) {
    return token.slice(1, -1)
  }
  return token
}

function isLocalRelativePath(token) {
  return (
    Boolean(token) &&
    !token.startsWith('-') &&
    !token.startsWith('/') &&
    !token.startsWith('$') &&
    !token.startsWith('~')
  )
}

function extractLocalScriptTargets(command) {
  const targets = []
  let segmentCwd = '.'

  for (const rawSegment of command.split(/&&|\|\||;/u)) {
    const tokens = rawSegment
      .trim()
      .split(/\s+/u)
      .filter(Boolean)
      .map(stripShellQuotes)

    while (tokens.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*=/u.test(tokens.at(0) ?? '')) {
      tokens.shift()
    }
    const [executable, ...args] = tokens
    if (!executable) continue

    if (executable === 'cd') {
      const [nextDir] = args
      if (nextDir && isLocalRelativePath(nextDir)) {
        segmentCwd = join(segmentCwd, nextDir)
      }
      continue
    }

    if (executable === 'node') {
      let isNodeTest = false
      let skipNext = false
      for (const token of args) {
        if (skipNext) {
          skipNext = false
          continue
        }
        if (NODE_INLINE_EVAL_OPTIONS.has(token)) {
          break
        }
        if (token === '--test') {
          isNodeTest = true
          continue
        }
        if (NODE_OPTIONS_WITH_VALUE.has(token)) {
          skipNext = true
          continue
        }
        if (token.startsWith('-')) {
          continue
        }
        if (isLocalRelativePath(token)) {
          targets.push(join(segmentCwd, token))
        }
        if (!isNodeTest) {
          break
        }
      }
      continue
    }

    if (executable === 'bash' || executable === 'sh') {
      let skipNext = false
      for (const token of args) {
        if (skipNext) {
          skipNext = false
          continue
        }
        if (token === '-c') {
          break
        }
        if (token === '-o') {
          skipNext = true
          continue
        }
        if (token.startsWith('-')) {
          continue
        }
        if (isLocalRelativePath(token)) {
          targets.push(join(segmentCwd, token))
        }
        break
      }
    }
  }

  return targets
}

test('app/package.json scripts exclude rejected desktop-variants entries and point to existing local scripts', () => {
  const pkg = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8'))
  const scripts = pkg.scripts ?? {}

  assert.equal('check:desktop-variants' in scripts, false,
    'rejected check:desktop-variants script must not remain in app/package.json')
  assert.equal('sync:desktop-variants' in scripts, false,
    'rejected sync:desktop-variants script must not remain in app/package.json')

  const checkedTargets = []
  const missingTargets = []

  for (const [name, command] of Object.entries(scripts)) {
    assert.equal(typeof command, 'string', `app/package.json script "${name}" must be a string`)
    assert.doesNotMatch(command, /verify-desktop-variants\.mjs/u,
      `app/package.json script "${name}" must not reference rejected verify-desktop-variants.mjs`)

    for (const target of extractLocalScriptTargets(command)) {
      checkedTargets.push(`${name} -> ${target}`)
      const fullPath = resolve(appDir, target)
      if (!existsSync(fullPath) || !statSync(fullPath).isFile()) {
        missingTargets.push(`${name} -> ${target}`)
      }
    }
  }

  assert.ok(checkedTargets.length > 0, 'expected to validate local script targets in app/package.json')
  assert.deepEqual(missingTargets, [],
    `app/package.json scripts reference missing local files:\n${missingTargets.join('\n')}`)
})

test('app/scripts/worktree.sh disables direct-push ship and guard-worktree no longer recommends it', () => {
  const worktreeScriptPath = join(appDir, 'scripts', 'worktree.sh')
  const guardScriptPath = join(appDir, 'scripts', 'ops', 'guard-worktree.mjs')

  const syntax = spawnSync('bash', ['-n', worktreeScriptPath], { encoding: 'utf8' })
  assert.equal(syntax.status, 0, syntax.stderr)

  const shipResult = spawnSync('bash', [worktreeScriptPath, 'ship', 'demo-task'], {
    cwd: appDir,
    encoding: 'utf8',
  })
  assert.notEqual(shipResult.status, 0, 'worktree.sh ship must fail closed instead of merging/pushing main')
  assert.match(shipResult.stderr, /ship.*disabled/iu)
  assert.match(shipResult.stderr, /PR/u)

  assert.doesNotMatch(readFileSync(worktreeScriptPath, 'utf8'), /worktree\.sh ship </u)
  assert.doesNotMatch(readFileSync(guardScriptPath, 'utf8'), /worktree\.sh ship </u)
})

test('app/scripts/worktree.sh cmd_remove no longer suggests ship', () => {
  const worktreeScriptPath = join(appDir, 'scripts', 'worktree.sh')
  assert.doesNotMatch(readFileSync(worktreeScriptPath, 'utf8'), /'ship'\s+it/u)
})

test('app/scripts/ops/guard-worktree.mjs allows confirmed non-Git targets across mount boundaries', () => {
  const guardScriptPath = join(appDir, 'scripts', 'ops', 'guard-worktree.mjs')
  const scratch = mkdtempSync(join(tmpdir(), 'app-guard-mount-'))
  try {
    const mountBin = join(scratch, 'mount-bin')
    const extraErrorBin = join(scratch, 'extra-error-bin')
    const nonGitDir = join(scratch, 'external/backups/agent/batch-1')
    const nonGitFile = join(nonGitDir, 'backup.zip')
    mkdirSync(mountBin, { recursive: true })
    mkdirSync(extraErrorBin, { recursive: true })
    writeFileSync(
      join(mountBin, 'git'),
      '#!/bin/sh\necho "fatal: not a git repository (or any parent up to mount point /Volumes)" >&2\necho "Stopping at filesystem boundary (GIT_DISCOVERY_ACROSS_FILESYSTEM not set)." >&2\nexit 128\n',
      { mode: 0o755 },
    )
    writeFileSync(
      join(extraErrorBin, 'git'),
      '#!/bin/sh\necho "fatal: not a git repository (or any parent up to mount point /Volumes)" >&2\necho "Stopping at filesystem boundary (GIT_DISCOVERY_ACROSS_FILESYSTEM not set)." >&2\necho "fatal: Permission denied" >&2\nexit 128\n',
      { mode: 0o755 },
    )

    const runGuard = (payload, binDir) => {
      const result = spawnSync(process.execPath, [guardScriptPath], {
        cwd: appDir,
        env: { ...cleanEnv(), PATH: binDir },
        encoding: 'utf8',
        input: JSON.stringify({ hook_event_name: 'PreToolUse', cwd: appDir, ...payload }),
      })
      assert.equal(result.status, 0, result.stderr)
      return JSON.parse(result.stdout).hookSpecificOutput
    }

    assert.equal(
      runGuard({ tool_name: 'write', tool_input: { file_path: nonGitFile } }, mountBin).permissionDecision,
      'allow',
    )
    assert.equal(
      runGuard(
        {
          tool_name: 'bash',
          tool_input: { command: `mkdir -p ${nonGitDir} && cp /tmp/source-app/Info.plist ${nonGitFile}` },
        },
        mountBin,
      ).permissionDecision,
      'allow',
    )
    assert.equal(
      runGuard({ tool_name: 'write', tool_input: { file_path: join(appDir, 'package.json') } }, mountBin)
        .permissionDecision,
      'deny',
    )
    const extraOut = runGuard({ tool_name: 'write', tool_input: { file_path: nonGitFile } }, extraErrorBin)
    assert.equal(extraOut.permissionDecision, 'deny')
    assert.match(extraOut.permissionDecisionReason, /Git 状态读取失败/)
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
})
