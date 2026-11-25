import { after, describe, it } from 'node:test'
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, writeFileSync, symlinkSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  decideBashCommand,
  decideMaterializationCommand,
  decideMainCheckoutBuildCommand,
  decideSearchTarget,
  decideWrite,
  isDestructiveResetCommand,
  isEphemeralPath,
  isGitTracked,
  isMaterializationCommand,
  isUnboundedScanRoot,
  isWorktreePath,
} from './guard-worktree.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = mkdtempSync(join(tmpdir(), 'guard-fixture-'))
after(() => rmSync(fixture, { recursive: true, force: true }))
function gitCommand(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim()
}
function createRepo(name) {
  const root = join(fixture, name)
  mkdirSync(root)
  gitCommand(root, 'init', '-b', 'main')
  const files = ['package.json', 'plugins/omnimux/src/host/apply.js', 'docs/contracts/hub.md', 'docs/contracts/plugin-git-pr.md', 'scripts/dev-doctor.sh']
  for (const path of files) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), '{}\n')
  }
  writeFileSync(join(root, '.gitignore'), 'ignored/\n')
  gitCommand(root, 'add', '.')
  gitCommand(root, '-c', 'user.name=Guard Test', '-c', 'user.email=guard@example.invalid', 'commit', '-m', 'fixture')
  gitCommand(root, 'update-ref', 'refs/remotes/origin/main', 'HEAD')
  return root
}
const mainRepoRoot = createRepo('primary')
const externalRepoRoot = createRepo('external')
const worktreeRoot = join(mainRepoRoot, '.worktrees', 'task')
const externalWorktree = join(externalRepoRoot, '.worktrees', 'external-task')
gitCommand(mainRepoRoot, 'worktree', 'add', '-b', 'task', worktreeRoot)
gitCommand(externalRepoRoot, 'worktree', 'add', '-b', 'external-task', externalWorktree)
const scriptPath = join(here, 'guard-worktree.mjs')

function runHook(payload) {
  const res = spawnSync('node', [scriptPath], {
    cwd: mainRepoRoot,
    encoding: 'utf8',
    input: JSON.stringify(payload),
  })
  assert.equal(res.status, 0, `guard exited ${res.status}: ${res.stderr}`)
  return JSON.parse(res.stdout)
}

describe('bash workdir JSON dispatch', () => {
  it('resolves execution workdir while retaining primary commit rejection', () => {
    const check = (command, workdir, cwd = mainRepoRoot, ownerRoot = mainRepoRoot) => runHook({ cwd, tool_name: 'bash', tool_input: { command, workdir, ownerRoot } }).hookSpecificOutput.permissionDecision
    assert.equal(check('git commit -m test', worktreeRoot), 'allow')
    assert.equal(check('git commit -m test', '.worktrees/task'), 'allow')
    assert.equal(check('git commit -m test', mainRepoRoot, worktreeRoot), 'deny')
    assert.equal(check('git commit -m test', undefined), 'deny')
    assert.equal(check('git -C ../.. commit -m test', worktreeRoot), 'deny')
    assert.equal(check('git -C .worktrees/task commit -m test', mainRepoRoot), 'allow')
  })
})

describe('guard-worktree path classification', () => {
  it('detects worktree vs ephemeral vs tracked', () => {
    const trackedPluginPath = 'plugins/omnimux/src/host/apply.js'
    assert.equal(
      isWorktreePath(join(worktreeRoot, trackedPluginPath)),
      true,
    )
    assert.equal(
      isWorktreePath(join(mainRepoRoot, trackedPluginPath)),
      false,
    )
    assert.equal(isEphemeralPath(`${mainRepoRoot}/plugins/omnimux/node_modules/foo/index.js`), true)
    assert.equal(isEphemeralPath(`${mainRepoRoot}/plugins/omnimux-workflow/dist-harness/app.js`), true)
    assert.equal(isEphemeralPath(`${mainRepoRoot}/plugins/omnimux/.tmp/scratch.js`), true)
    assert.equal(isEphemeralPath(`${mainRepoRoot}/plugins/omnimux/tmp/scratch.js`), false)
    assert.equal(isEphemeralPath(`${mainRepoRoot}/plugins/omnimux/src/index.js`), false)
    assert.equal(isEphemeralPath(`${mainRepoRoot}/package.json`), false)
  })
})

describe('guard-worktree decideWrite (全量版本文件拦截)', () => {
  it('denies tracked plugin source on the main checkout', () => {
    const result = decideWrite({
      toolName: 'edit',
      cwd: mainRepoRoot,
      filePath: 'plugins/omnimux/src/host/apply.js',
    })
    assert.equal(result.decision, 'deny')
    assert.equal(result.reason, 'tracked-file')
  })

  it('denies tracked root-level files (e.g. package.json)', () => {
    const result = decideWrite({
      toolName: 'edit',
      cwd: mainRepoRoot,
      filePath: 'package.json',
    })
    assert.equal(result.decision, 'deny')
    assert.equal(result.reason, 'tracked-file')
  })

  it('denies tracked docs files (e.g. docs/contracts/hub.md)', () => {
    const result = decideWrite({
      toolName: 'edit',
      cwd: mainRepoRoot,
      filePath: 'docs/contracts/hub.md',
    })
    assert.equal(result.decision, 'deny')
    assert.equal(result.reason, 'tracked-file')
  })

  it('denies tracked scripts files (e.g. scripts/dev-doctor.sh)', () => {
    const result = decideWrite({
      toolName: 'edit',
      cwd: mainRepoRoot,
      filePath: 'scripts/dev-doctor.sh',
    })
    assert.equal(result.decision, 'deny')
    assert.equal(result.reason, 'tracked-file')
  })

  it('denies non-allowlisted ephemeral and gitignored plugin paths in main repo under Default-Deny', () => {
    const result = decideWrite({
      toolName: 'write',
      cwd: mainRepoRoot,
      filePath: 'plugins/omnimux/node_modules/not-a-real-pkg/index.js',
    })
    assert.equal(result.decision, 'deny')
    assert.equal(result.reason, 'untracked-protected-scope')

    const wtResult = decideWrite({
      toolName: 'write',
      cwd: worktreeRoot,
      filePath: 'plugins/omnimux/node_modules/not-a-real-pkg/index.js',
    })
    assert.equal(wtResult.decision, 'allow')
    assert.equal(wtResult.reason, 'worktree-isolated')
  })

  it('denies workflow dist / dist-harness writes in main repo while allowing them in worktree', () => {
    const distHarness = decideWrite({
      toolName: 'write',
      cwd: mainRepoRoot,
      filePath: 'plugins/omnimux-workflow/dist-harness/scratch.js',
    })
    assert.equal(distHarness.decision, 'deny')
    assert.equal(distHarness.reason, 'untracked-protected-scope')

    const dist = decideWrite({
      toolName: 'write',
      cwd: mainRepoRoot,
      filePath: 'plugins/omnimux-workflow/dist/index.js',
    })
    assert.equal(dist.decision, 'deny')
    assert.equal(dist.reason, 'untracked-protected-scope')

    const wtDist = decideWrite({
      toolName: 'write',
      cwd: worktreeRoot,
      filePath: 'plugins/omnimux-workflow/dist/index.js',
    })
    assert.equal(wtDist.decision, 'allow')
    assert.equal(wtDist.reason, 'worktree-isolated')
  })

  it('denies untracked scratch files in main repo root while allowing .workbuddy runtime allowlist', () => {
    for (const rel of [
      '__untracked_scratch_987654.txt',
      'app/new-file.ts',
      'specs/new-draft.spec.md',
      'ui-demo/preview.html',
      '.tmp/scratch.txt',
      'plugins/.agent-reports/run/out.json',
      'future-unlisted-dir/nested/file.js',
      '.workbuddy-evil/escape.md',
    ]) {
      const result = decideWrite({
        toolName: 'write',
        cwd: mainRepoRoot,
        filePath: rel,
      })
      assert.equal(result.decision, 'deny', `Expected Default-Deny for ${rel}`)
      assert.equal(result.reason, 'untracked-protected-scope', `Expected untracked-protected-scope for ${rel}`)
    }

    const workbuddyResult = decideWrite({
      toolName: 'write',
      cwd: mainRepoRoot,
      filePath: '.workbuddy/scratch_board.md',
    })
    assert.equal(workbuddyResult.decision, 'allow')
    assert.equal(workbuddyResult.reason, 'primary-runtime-allowlist')
  })

  it('denies untracked files in protected scopes (plugins, scripts, docs, .github)', () => {
    const pluginUntracked = decideWrite({
      toolName: 'write',
      cwd: mainRepoRoot,
      filePath: 'plugins/omnimux-workflow/src/canvas/editor/components/NonExistentUntrackedNode.tsx',
    })
    assert.equal(pluginUntracked.decision, 'deny')
    assert.equal(pluginUntracked.reason, 'untracked-protected-scope')

    const scriptsUntracked = decideWrite({
      toolName: 'write',
      cwd: mainRepoRoot,
      filePath: 'scripts/new-untracked-tool.mjs',
    })
    assert.equal(scriptsUntracked.decision, 'deny')
    assert.equal(scriptsUntracked.reason, 'untracked-protected-scope')

    const docsUntracked = decideWrite({
      toolName: 'write',
      cwd: mainRepoRoot,
      filePath: 'docs/contracts/new-untracked-contract.md',
    })
    assert.equal(docsUntracked.decision, 'deny')
    assert.equal(docsUntracked.reason, 'untracked-protected-scope')
  })

  it('denies tracked docs on main checkout', () => {
    const trackedResult = decideWrite({
      toolName: 'write',
      cwd: mainRepoRoot,
      filePath: 'docs/contracts/plugin-git-pr.md',
    })
    assert.equal(trackedResult.decision, 'deny')
    assert.equal(trackedResult.reason, 'tracked-file')
  })

  it('allows all writes inside a worktree path (including plugins, docs, root)', () => {
    const wtPlugin = decideWrite({
      toolName: 'edit',
      cwd: worktreeRoot,
      filePath: 'plugins/omnimux/src/index.js',
    })
    assert.equal(wtPlugin.decision, 'allow')
    assert.equal(wtPlugin.reason, 'worktree-isolated')

    const wtRoot = decideWrite({
      toolName: 'edit',
      cwd: worktreeRoot,
      filePath: 'package.json',
    })
    assert.equal(wtRoot.decision, 'allow')
    assert.equal(wtRoot.reason, 'worktree-isolated')
  })
})

describe('registered worktree boundaries', () => {
  const decision = (filePath, cwd = mainRepoRoot) => decideWrite({ filePath, cwd, toolName: 'write' }).decision
  it('allows same and external registered trees for tracked and new files', () => {
    for (const root of [worktreeRoot, externalWorktree]) {
      assert.equal(decision(join(root, 'package.json')), 'allow')
      assert.equal(decision(join(root, 'scripts/new/deep/file.js')), 'allow')
    }
    assert.equal(decision(join(externalRepoRoot, 'package.json')), 'deny')
    assert.equal(decision(join(externalRepoRoot, 'scripts/new.js')), 'deny')
  })
  it('rejects misleading names and copied gitdir pointers', () => {
    const fake = join(mainRepoRoot, 'omnimux-client-wt-fake')
    mkdirSync(fake)
    assert.equal(isWorktreePath(join(fake, 'scripts/file.js')), false)
    assert.equal(decision(join(fake, 'scripts/file.js')), 'deny')
    const gitDir = gitCommand(worktreeRoot, 'rev-parse', '--absolute-git-dir')
    writeFileSync(join(fake, '.git'), `gitdir: ${gitDir}\n`)
    assert.equal(isWorktreePath(join(fake, 'package.json')), false)
    assert.equal(decision(join(fake, 'package.json')), 'deny')
  })
  it('resolves directory and file symlinks escaping into primary checkouts', () => {
    symlinkSync(mainRepoRoot, join(worktreeRoot, 'escape'), 'dir')
    symlinkSync(join(externalRepoRoot, 'package.json'), join(worktreeRoot, 'file-link'))
    assert.equal(decision(join(worktreeRoot, 'escape/package.json')), 'deny')
    assert.equal(decision(join(worktreeRoot, 'escape/scripts/new/deep.js')), 'deny')
    assert.equal(decision(join(worktreeRoot, 'file-link')), 'deny')
    symlinkSync(join(mainRepoRoot, 'missing'), join(worktreeRoot, 'dangling'))
    assert.equal(decision(join(worktreeRoot, 'dangling/file.js')), 'deny')
  })
  it('uses metadata rather than branch identity or legacy names', () => {
    gitCommand(externalRepoRoot, 'checkout', '-b', 'not-main')
    assert.equal(decision(join(externalRepoRoot, 'package.json')), 'deny')
    const detached = join(externalRepoRoot, '.worktrees', 'detached task')
    gitCommand(externalRepoRoot, 'worktree', 'add', '--detach', detached)
    assert.equal(decision(join(detached, 'scripts/new.js')), 'allow')
    const legacy = join(fixture, 'omnimux-client-wt-real')
    gitCommand(externalRepoRoot, 'worktree', 'add', '-b', 'legacy', legacy)
    assert.equal(decision(join(legacy, 'package.json')), 'allow')
    symlinkSync(worktreeRoot, join(fixture, 'linked-alias'), 'dir')
    assert.equal(decision(join(fixture, 'linked-alias/scripts/new.js')), 'allow')
  })
  it('rejects a standalone fake .git directory and an unregistered gitfile', () => {
    const fake = join(fixture, 'fake-metadata')
    mkdirSync(join(fake, '.git'), { recursive: true })
    assert.equal(isWorktreePath(join(fake, 'package.json')), false)
    assert.equal(decision(join(fake, 'package.json')), 'deny')
    const missing = join(fixture, 'missing-registry')
    mkdirSync(missing)
    writeFileSync(join(missing, '.git'), `gitdir: ${join(mainRepoRoot, '.git/worktrees/absent')}\n`)
    assert.equal(isWorktreePath(join(missing, 'package.json')), false)
    assert.equal(decision(join(missing, 'package.json')), 'deny')
  })
  it('denies nested primary repositories and malformed nested metadata inside a linked tree', () => {
    const nested = join(worktreeRoot, 'nested-primary')
    mkdirSync(nested)
    gitCommand(nested, 'init', '-b', 'main')
    writeFileSync(join(nested, 'package.json'), '{}\n')
    gitCommand(nested, 'add', 'package.json')
    assert.equal(isWorktreePath(join(nested, 'package.json')), false)
    assert.equal(decision(join(nested, 'package.json')), 'deny')
    assert.equal(decision(join(nested, 'scripts/new/deep.js')), 'deny')
    const malformed = join(worktreeRoot, 'malformed-nested')
    mkdirSync(join(malformed, '.git'), { recursive: true })
    assert.equal(isWorktreePath(join(malformed, 'scripts/new.js')), false)
    assert.equal(decision(join(malformed, 'scripts/new.js')), 'deny')
  })
  it('does not exempt a detached primary checkout', () => {
    const primary = createRepo('detached-primary')
    gitCommand(primary, 'checkout', '--detach')
    assert.equal(isWorktreePath(join(primary, 'package.json')), false)
    assert.equal(decision(join(primary, 'package.json')), 'deny')
    assert.equal(decision(join(primary, 'scripts/new/deep.js')), 'deny')
  })
  it('ignores abnormal Git config, index and discovery environment for write classification', () => {
    const env = {
      ...process.env,
      GIT_DIR: '/nonexistent/qa-git-dir',
      GIT_COMMON_DIR: '/nonexistent/qa-common-dir',
      GIT_WORK_TREE: mainRepoRoot,
      GIT_INDEX_FILE: '/nonexistent/qa-index',
      GIT_CEILING_DIRECTORIES: fixture,
      GIT_CONFIG_COUNT: 'invalid',
    }
    for (const [root, expected] of [[mainRepoRoot, 'deny'], [externalWorktree, 'allow']]) {
      const result = spawnSync(process.execPath, [scriptPath], {
        cwd: mainRepoRoot, encoding: 'utf8', env,
        input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'write', cwd: mainRepoRoot, tool_input: { file_path: join(root, 'package.json') } }),
      })
      assert.equal(result.status, 0, result.stderr)
      assert.equal(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision, expected)
    }
  })
  it('enforces Default-Deny on ignored/ephemeral primary paths while preserving .workbuddy and worktree exemptions', () => {
    assert.equal(decision(join(mainRepoRoot, 'ignored/file.js')), 'deny')
    assert.equal(decision(join(mainRepoRoot, 'dist/file.js')), 'deny')
    assert.equal(decision(join(mainRepoRoot, 'trace.log')), 'deny')
    assert.equal(decision(join(mainRepoRoot, '.workbuddy/state.json')), 'allow')
    assert.equal(decision(join(worktreeRoot, 'dist/file.js')), 'allow')
  })
  it('fails conservatively without Git and with abnormal Git exits', () => {
    const emptyBin = join(fixture, 'empty-bin')
    mkdirSync(emptyBin)
    for (const contents of [null, '#!/bin/sh\nexit 42\n', '#!/bin/sh\nexit 128\n']) {
      if (contents) writeFileSync(join(emptyBin, 'git'), contents, { mode: 0o755 })
      const result = spawnSync(process.execPath, [scriptPath], {
        cwd: mainRepoRoot, encoding: 'utf8', env: { ...process.env, PATH: emptyBin },
        input: JSON.stringify({ tool_name: 'write', cwd: mainRepoRoot, tool_input: { file_path: join(worktreeRoot, 'package.json') } }),
      })
      assert.equal(result.status, 0)
      assert.equal(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision, 'deny')
    }
  })
  it('ignores ambient Git repository redirection', () => {
    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: mainRepoRoot, encoding: 'utf8', env: { ...process.env, GIT_WORK_TREE: worktreeRoot, GIT_DIR: gitCommand(worktreeRoot, 'rev-parse', '--absolute-git-dir') },
      input: JSON.stringify({ tool_name: 'write', cwd: mainRepoRoot, tool_input: { file_path: join(mainRepoRoot, 'package.json') } }),
    })
    assert.equal(result.status, 0)
    assert.equal(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision, 'deny')
  })
  it('preserves unpushed commit bash denial', () => {
    gitCommand(worktreeRoot, '-c', 'user.name=Guard Test', '-c', 'user.email=guard@example.invalid', 'commit', '--allow-empty', '-m', 'unpushed')
    assert.equal(decideBashCommand({ command: 'git reset --hard HEAD~1', cwd: worktreeRoot }).decision, 'deny')
    assert.equal(decideBashCommand({ command: 'git status', cwd: worktreeRoot }).decision, 'allow')
  })
})

describe('guard-worktree PreToolUse protocol', () => {
  it('emits deny JSON for tracked files across plugins, docs, and scripts', () => {
    const outPlugin = runHook({
      hook_event_name: 'PreToolUse',
      tool_name: 'edit',
      cwd: mainRepoRoot,
      tool_input: { file_path: join(mainRepoRoot, 'plugins/omnimux/src/host/apply.js') },
    })
    assert.equal(outPlugin.hookSpecificOutput.hookEventName, 'PreToolUse')
    assert.equal(outPlugin.hookSpecificOutput.permissionDecision, 'deny')

    const outDoc = runHook({
      hook_event_name: 'PreToolUse',
      tool_name: 'edit',
      cwd: mainRepoRoot,
      tool_input: { file_path: join(mainRepoRoot, 'docs/contracts/hub.md') },
    })
    assert.equal(outDoc.hookSpecificOutput.permissionDecision, 'deny')

    const outRoot = runHook({
      hook_event_name: 'PreToolUse',
      tool_name: 'edit',
      cwd: mainRepoRoot,
      tool_input: { file_path: join(mainRepoRoot, 'package.json') },
    })
    assert.equal(outRoot.hookSpecificOutput.permissionDecision, 'deny')
  })

  it('emits allow JSON for .workbuddy and worktree paths while denying non-allowlisted primary paths', () => {
    const ignored = runHook({
      hook_event_name: 'PreToolUse',
      tool_name: 'write',
      cwd: mainRepoRoot,
      tool_input: { file_path: join(mainRepoRoot, 'plugins/omnimux-workflow/dist-harness/hook-test.js') },
    })
    assert.equal(ignored.hookSpecificOutput.permissionDecision, 'deny')

    const untracked = runHook({
      hook_event_name: 'PreToolUse',
      tool_name: 'write',
      cwd: mainRepoRoot,
      tool_input: { file_path: join(mainRepoRoot, '__guard_untracked_scratch__.tmp') },
    })
    assert.equal(untracked.hookSpecificOutput.permissionDecision, 'deny')

    const workbuddy = runHook({
      hook_event_name: 'PreToolUse',
      tool_name: 'write',
      cwd: mainRepoRoot,
      tool_input: { file_path: join(mainRepoRoot, '.workbuddy/hook-test.md') },
    })
    assert.equal(workbuddy.hookSpecificOutput.permissionDecision, 'allow')

    const wt = runHook({
      hook_event_name: 'PreToolUse',
      tool_name: 'write',
      cwd: worktreeRoot,
      tool_input: { file_path: join(worktreeRoot, 'plugins/omnimux-workflow/dist-harness/hook-test.js') },
    })
    assert.equal(wt.hookSpecificOutput.permissionDecision, 'allow')
  })
})

describe('non-Git targets and Git read failures', () => {
  const nonGit = mkdtempSync(join(tmpdir(), 'guard-non-git-'))
  after(() => rmSync(nonGit, { recursive: true, force: true }))
  const target = join(nonGit, '.agents/skills/agent-backup/scripts/backup.py')
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, '# isolated fixture\n')
  const nonGitProbe = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: nonGit, encoding: 'utf8', env: { ...process.env, LC_ALL: 'C', LANGUAGE: 'C' },
  })
  assert.equal(nonGitProbe.status, 128, 'fixture must be outside every Git repository')
  assert.match(nonGitProbe.stderr, /not a git repository/)

  function hook(filePath, env = {}, cwd = mainRepoRoot) {
    const result = spawnSync(process.execPath, [scriptPath], {
      cwd, encoding: 'utf8', env: { ...process.env, ...env },
      input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'write', cwd, tool_input: { file_path: filePath } }),
    })
    assert.equal(result.status, 0, result.stderr)
    return JSON.parse(result.stdout).hookSpecificOutput
  }

  it('does not classify a confirmed non-Git target as tracked', () => {
    assert.equal(isGitTracked(target, dirname(target)), false)
    for (const filePath of [target, join(nonGit, 'docs/missing/parent/new.md')]) {
      const result = decideWrite({ filePath, cwd: mainRepoRoot, toolName: 'write' })
      assert.equal(result.decision, 'allow')
      assert.equal(result.reason, 'non-git-target')
    }
  })

  it('classifies absolute and relative targets from a non-Git cwd', () => {
    assert.equal(hook(target, {}, nonGit).permissionDecision, 'allow')
    assert.equal(hook('.agents/skills/agent-backup/scripts/backup.py', {}, nonGit).permissionDecision, 'allow')
    assert.equal(hook(join(mainRepoRoot, 'package.json'), {}, nonGit).permissionDecision, 'deny')
  })

  it('uses deterministic Git diagnostics regardless of caller locale', () => {
    const bin = join(fixture, 'locale-bin')
    mkdirSync(bin)
    writeFileSync(join(bin, 'git'), '#!/bin/sh\nif [ "$LC_ALL" = C ] && [ "$LANGUAGE" = C ]; then\n  echo "fatal: not a git repository (or any of the parent directories): .git" >&2\nelse\n  echo "fatal: kein Git-Repository" >&2\nfi\nexit 128\n', { mode: 0o755 })
    const out = hook(target, { PATH: bin, LC_ALL: 'de_DE.UTF-8', LANG: 'de_DE.UTF-8', LANGUAGE: 'de' })
    assert.equal(out.permissionDecision, 'allow')
    assert.equal(hook(join(mainRepoRoot, 'package.json'), { PATH: bin }).permissionDecision, 'deny')
  })

  it('does not grant an authorization exception from payload fields', () => {
    // This hook only classifies isolation; external authorization is a separate gate.
    const out = runHook({ tool_name: 'write', cwd: nonGit, authorized: true,
      tool_input: { file_path: join(mainRepoRoot, 'package.json'), authorized: true } })
    assert.equal(out.hookSpecificOutput.permissionDecision, 'deny')
  })

  it('denies unavailable Git and all non-discovery failures with accurate attribution', () => {
    const bin = join(fixture, 'error-bin')
    mkdirSync(bin)
    const failures = [null, 'exit 42', 'exit 128',
      'echo "fatal: unable to read index: Permission denied" >&2; exit 128',
      'echo "fatal: detected dubious ownership in repository" >&2; exit 128',
      'echo "fatal: not a git repository: /broken/gitdir" >&2; exit 128',
      'echo "fatal: not a git repository (or any of the parent directories): .git" >&2; echo "fatal: Permission denied" >&2; exit 128']
    for (const failure of failures) {
      if (failure) writeFileSync(join(bin, 'git'), `#!/bin/sh\n${failure}\n`, { mode: 0o755 })
      for (const filePath of [target, join(mainRepoRoot, 'package.json')]) {
        const out = hook(filePath, { PATH: bin })
        assert.equal(out.permissionDecision, 'deny')
        assert.match(out.permissionDecisionReason, /仓库 Hook.*Git.*读取/)
        assert.doesNotMatch(out.permissionDecisionReason, /Git Tracked|DSH 核心/)
      }
    }
  })

  it('denies real corrupt-index errors instead of calling them tracked files', () => {
    const root = createRepo('corrupt-index')
    writeFileSync(join(root, '.git/index'), 'not an index')
    const filePath = join(root, 'package.json')
    assert.equal(isGitTracked(filePath, root), true)
    assert.equal(decideWrite({ filePath, cwd: root, toolName: 'edit' }).reason, 'git-read-error')
    assert.match(hook(filePath).permissionDecisionReason, /Git.*读取/)
  })

  it('keeps invalid cwd, unreadable metadata, and failed ls-files conservative', () => {
    assert.equal(isGitTracked(target, join(nonGit, 'missing-cwd')), true)
    const root = createRepo('unreadable-metadata')
    const metadata = join(root, '.git')
    chmodSync(metadata, 0)
    try {
      assert.equal(hook(join(root, 'package.json')).permissionDecision, 'deny')
    } finally {
      chmodSync(metadata, 0o700)
    }
    const bin = join(fixture, 'ls-files-error-bin')
    mkdirSync(bin)
    writeFileSync(join(bin, 'git'), '#!/bin/sh\ncase "$1" in\nrev-parse) printf "%s\\n" "$PWD"; exit 0 ;;\n*) echo "fatal: not a git repository (or any of the parent directories): .git" >&2; exit 128 ;;\nesac\n', { mode: 0o755 })
    const out = hook(target, { PATH: bin })
    assert.equal(out.permissionDecision, 'deny')
    assert.match(out.permissionDecisionReason, /Git.*读取/)
  })

  it('denies malformed metadata outside Git and nested primary repositories', () => {
    const broken = join(nonGit, 'broken')
    mkdirSync(join(broken, '.git'), { recursive: true })
    assert.equal(hook(join(broken, 'notes.txt')).permissionDecision, 'deny')
    const nested = join(nonGit, 'nested')
    mkdirSync(nested)
    gitCommand(nested, 'init', '-b', 'main')
    writeFileSync(join(nested, 'notes.txt'), 'tracked\n')
    gitCommand(nested, 'add', 'notes.txt')
    assert.equal(hook(join(nested, 'notes.txt')).permissionDecision, 'deny')
    assert.equal(hook(join(nested, 'scripts/new/deep.js')).permissionDecision, 'deny')
    symlinkSync(nested, join(nonGit, 'escape'))
    assert.equal(hook(join(nonGit, 'escape/notes.txt')).permissionDecision, 'deny')
  })

  it('fails closed on actual unreadable directories and unresolved symlinks', () => {
    const locked = join(nonGit, 'locked')
    mkdirSync(locked)
    writeFileSync(join(locked, 'notes.txt'), 'private\n')
    chmodSync(locked, 0)
    try {
      const out = hook(join(locked, 'notes.txt'))
      assert.equal(out.permissionDecision, 'deny')
      assert.match(out.permissionDecisionReason, /仓库 Hook.*路径/)
      assert.doesNotMatch(out.permissionDecisionReason, /Git Tracked|DSH 核心/)
    } finally {
      chmodSync(locked, 0o700)
    }
    symlinkSync(join(nonGit, 'absent'), join(nonGit, 'dangling'))
    assert.equal(hook(join(nonGit, 'dangling/notes.txt')).permissionDecision, 'deny')
  })
})

describe('guard-worktree git reset --hard safety guard', () => {
  it('correctly classifies destructive git reset commands', () => {
    assert.equal(isDestructiveResetCommand('git reset --hard HEAD~1'), true)
    assert.equal(isDestructiveResetCommand('git reset --hard origin/main'), true)
    assert.equal(isDestructiveResetCommand('git reset --soft HEAD~1'), false)
    assert.equal(isDestructiveResetCommand('git reset HEAD file.txt'), false)
    assert.equal(isDestructiveResetCommand('echo "git reset --hard"'), false)
    assert.equal(isDestructiveResetCommand('gh issue create --body "ran git reset --hard"'), false)
  })

  it('catches git -C, pipelines, checkout -f, restore --source and clean -f', () => {
    assert.equal(isDestructiveResetCommand('git -C "$REPO_ROOT" reset --hard origin/main'), true)
    assert.equal(isDestructiveResetCommand('git -C /tmp/repo reset --hard origin/main'), true)
    assert.equal(isDestructiveResetCommand('gh pr merge && git reset --hard origin/main'), true)
    assert.equal(isDestructiveResetCommand('git fetch origin && git checkout -f main'), true)
    assert.equal(isDestructiveResetCommand('git restore --source=origin/main --worktree --staged .'), true)
    assert.equal(isDestructiveResetCommand('git clean -fdx'), true)
    assert.equal(isDestructiveResetCommand('git status && git log -1'), false)
    assert.equal(isDestructiveResetCommand('git push -u origin agent/infra-guard-destructive-reset'), false)
  })
})

describe('guard-worktree bash command write safety guard (防命令行绕过篡改主目录)', () => {
  it('denies cp / mv / rsync targeting protected paths on the main checkout', () => {
    assert.equal(
      decideBashCommand({
        command: 'cp /tmp/foo.js plugins/omnimux/src/apply.js',
        cwd: mainRepoRoot,
      }).decision,
      'deny',
    )
    assert.equal(
      decideBashCommand({
        command: `cp -r /tmp/dir ${mainRepoRoot}/plugins/omnimux/src/`,
        cwd: mainRepoRoot,
      }).decision,
      'deny',
    )
    assert.equal(
      decideBashCommand({
        command: 'mv /tmp/foo.js scripts/dev-doctor.sh',
        cwd: mainRepoRoot,
      }).decision,
      'deny',
    )
    assert.equal(
      decideBashCommand({
        command: 'rsync -av /tmp/dir/ docs/contracts/hub.md',
        cwd: mainRepoRoot,
      }).decision,
      'deny',
    )
  })

  it('denies shell redirections > and >> targeting protected paths on the main checkout', () => {
    assert.equal(
      decideBashCommand({
        command: 'echo "hack" > plugins/omnimux/src/apply.js',
        cwd: mainRepoRoot,
      }).decision,
      'deny',
    )
    assert.equal(
      decideBashCommand({
        command: 'cat /tmp/patch >> package.json',
        cwd: mainRepoRoot,
      }).decision,
      'deny',
    )
    assert.equal(
      decideBashCommand({
        command: 'printf "data" > scripts/dev-doctor.sh',
        cwd: mainRepoRoot,
      }).decision,
      'deny',
    )
  })

  it('denies tee and sed -i targeting protected files on the main checkout', () => {
    assert.equal(
      decideBashCommand({
        command: 'echo "data" | tee plugins/omnimux/src/apply.js',
        cwd: mainRepoRoot,
      }).decision,
      'deny',
    )
    assert.equal(
      decideBashCommand({
        command: "sed -i '' 's/a/b/' docs/contracts/hub.md",
        cwd: mainRepoRoot,
      }).decision,
      'deny',
    )
  })

  it('allows writes outside the repo even when they match a protected prefix (#3853)', () => {
    // /Users/example/.agents/skills/x 是仓库外的家目录路径，不能被 /.agents/ 前缀误伤
    assert.equal(
      decideBashCommand({
        command: `ln -sfn /tmp/skill-src /tmp/.agents/skills/x`,
        cwd: mainRepoRoot,
      }).decision,
      'allow',
    )
    assert.equal(
      decideBashCommand({
        command: `ln -sfn /tmp/skill-src ${join('/private/tmp', 'outside.agents', 'x')}`,
        cwd: mainRepoRoot,
      }).decision,
      'allow',
    )
    // 展开 ~ 后仍落在仓库外
    assert.equal(
      decideBashCommand({
        command: `ln -sfn /tmp/skill-src ~/.agents/skills/x`,
        cwd: mainRepoRoot,
      }).decision,
      'allow',
    )
    // 仓库内同名受保护前缀依然 deny（通过绝对路径命中主 checkout）
    assert.equal(
      decideBashCommand({
        command: `ln -sfn /tmp/src ${mainRepoRoot}/.agents/skills/x`,
        cwd: mainRepoRoot,
      }).decision,
      'deny',
    )
  })

  it('strictly allows legitimate git synchronization commands on the main checkout', () => {
    const gitSyncCommands = [
      'git pull origin main',
      'git pull --rebase origin main',
      'git merge origin/main',
      'git fetch origin',
      'git checkout main',
      'git checkout -b new-feature-branch',
      'git stash',
      'git stash list',
      'git status -s',
      'git log -n 5 --oneline',
      'git diff origin/main',
      'git branch -a',
    ]
    for (const cmd of gitSyncCommands) {
      assert.equal(
        decideBashCommand({ command: cmd, cwd: mainRepoRoot }).decision,
        'allow',
        `Expected command to be allowed: ${cmd}`,
      )
    }
  })

  it('G3: denies node/python/dd/ln/awk writers targeting protected paths on main checkout', () => {
    const denyCmds = [
      `node -e "require('fs').writeFileSync('plugins/omnimux/src/apply.js','x')"`,
      `node --eval "require('fs').writeFileSync('plugins/omnimux/src/apply.js','x')"`,
      `python3 -c "open('plugins/omnimux/src/apply.js','w').write('x')"`,
      `dd if=/dev/zero of=plugins/omnimux/src/apply.js bs=1 count=1`,
      `ln -s /tmp/payload.js plugins/omnimux/src/apply.js`,
      `awk '{print}' /tmp/x > plugins/omnimux/src/apply.js`,
    ]
    for (const cmd of denyCmds) {
      assert.equal(
        decideBashCommand({ command: cmd, cwd: mainRepoRoot }).decision,
        'deny',
        `Expected command to be denied: ${cmd}`,
      )
    }
  })

  it('G3: allows node/python one-liners that do not write protected paths', () => {
    assert.equal(
      decideBashCommand({
        command: `node -e "console.log('ok')"`,
        cwd: mainRepoRoot,
      }).decision,
      'allow',
    )
    assert.equal(
      decideBashCommand({
        command: `python3 -c "print(1)"`,
        cwd: mainRepoRoot,
      }).decision,
      'allow',
    )
  })

  it('G4: denies git working-tree mutations on the main checkout', () => {
    const denyCmds = [
      'git apply /tmp/patch.diff',
      'git am /tmp/0001.patch',
      'git stash pop',
      'git stash apply',
      'git checkout -- plugins/omnimux/src/apply.js',
      'git checkout stash@{0} -- plugins/omnimux/src/apply.js',
      'git restore --worktree --source=HEAD -- plugins/omnimux/src/apply.js',
      'git push --force origin main',
      'git push -f origin HEAD',
      'git cherry-pick abcdef1',
      'git rebase origin/main',
    ]
    for (const cmd of denyCmds) {
      assert.equal(
        decideBashCommand({ command: cmd, cwd: mainRepoRoot }).decision,
        'deny',
        `Expected command to be denied: ${cmd}`,
      )
    }
  })

  it('G4: allows the same git mutations inside a registered worktree', () => {
    assert.equal(
      decideBashCommand({
        command: 'git stash pop',
        cwd: worktreeRoot,
      }).decision,
      'allow',
    )
    assert.equal(
      decideBashCommand({
        command: 'git apply /tmp/patch.diff',
        cwd: worktreeRoot,
      }).decision,
      'allow',
    )
  })

  it('allows cp / redirections inside a registered worktree directory', () => {
    assert.equal(
      decideBashCommand({
        command: 'cp /tmp/foo.js plugins/omnimux/src/apply.js',
        cwd: worktreeRoot,
      }).decision,
      'allow',
    )
    assert.equal(
      decideBashCommand({
        command: 'echo "hello" > plugins/omnimux/src/apply.js',
        cwd: worktreeRoot,
      }).decision,
      'allow',
    )
  })

  it('denies ephemeral and gitignored bash targets on main checkout while allowing .workbuddy and external tmp', () => {
    assert.equal(
      decideBashCommand({
        command: 'cp /tmp/bundle.js dist/app.js',
        cwd: mainRepoRoot,
      }).decision,
      'deny',
    )
    assert.equal(
      decideBashCommand({
        command: 'echo "log info" > trace.log',
        cwd: mainRepoRoot,
      }).decision,
      'deny',
    )
    assert.equal(
      decideBashCommand({
        command: 'cp /tmp/data.txt ignored/item.txt',
        cwd: mainRepoRoot,
      }).decision,
      'deny',
    )
    assert.equal(
      decideBashCommand({
        command: 'echo "board" > .workbuddy/pr-board.md',
        cwd: mainRepoRoot,
      }).decision,
      'allow',
    )
    assert.equal(
      decideBashCommand({
        command: 'echo "log" > /tmp/out.log',
        cwd: mainRepoRoot,
      }).decision,
      'allow',
    )
    assert.equal(
      decideBashCommand({
        command: 'cp /tmp/bundle.js dist/app.js',
        cwd: worktreeRoot,
      }).decision,
      'allow',
    )
  })

  it('denies build and package mutation commands on the main checkout while allowing in worktree', () => {
    assert.equal(
      decideBashCommand({ command: 'pnpm build', cwd: mainRepoRoot }).decision,
      'deny',
    )
    assert.equal(
      decideBashCommand({ command: 'npm run build', cwd: mainRepoRoot }).decision,
      'deny',
    )
    assert.equal(
      decideBashCommand({ command: 'pnpm run "build"', cwd: mainRepoRoot }).decision,
      'deny',
    )
    assert.equal(
      decideBashCommand({ command: 'tsc -p tsconfig.json', cwd: mainRepoRoot }).decision,
      'deny',
    )
    assert.equal(
      decideBashCommand({ command: 'tsc --noEmit false', cwd: mainRepoRoot }).decision,
      'deny',
    )
    assert.equal(
      decideBashCommand({ command: 'tsc --noEmit', cwd: mainRepoRoot }).decision,
      'allow',
    )
    assert.equal(
      decideBashCommand({ command: 'pnpm build', cwd: worktreeRoot }).decision,
      'allow',
    )
    assert.equal(
      decideBashCommand({ command: 'tsc -p tsconfig.json', cwd: worktreeRoot }).decision,
      'allow',
    )
    assert.equal(
      decideBashCommand({ command: `cd ${worktreeRoot} && pnpm build`, cwd: mainRepoRoot }).decision,
      'allow',
    )
    // 依赖恢复在主检出放行（node_modules 维护），manifest/lock 变更仍拦截。
    assert.equal(
      decideBashCommand({ command: 'pnpm install --frozen-lockfile --config.confirmModulesPurge=false', cwd: mainRepoRoot }).decision,
      'allow',
    )
    assert.equal(
      decideBashCommand({ command: 'npm ci', cwd: mainRepoRoot }).decision,
      'allow',
    )
    assert.equal(
      decideBashCommand({ command: 'pnpm add left-pad', cwd: mainRepoRoot }).decision,
      'deny',
    )
    assert.equal(
      decideBashCommand({ command: 'npm install left-pad', cwd: mainRepoRoot }).decision,
      'deny',
    )
    // shell 重定向与带值 flag 不应被误判为包名参数。
    assert.equal(
      decideBashCommand({ command: 'pnpm install --frozen-lockfile > /tmp/install.log 2>&1', cwd: mainRepoRoot }).decision,
      'allow',
    )
    // #3821：主检出 install 必须冻结 lockfile。原断言用 `--filter omnimux` 无冻结
    // flag 却期望 allow——那正是「install 静默改写 pnpm-lock.yaml」的口子。改为：
    // 带 --filter 且冻结仍放行（重定向与带值 flag 的解析保护不变），
    // 但不冻结时一律拒绝。
    assert.equal(
      decideBashCommand({ command: 'pnpm install --filter omnimux --frozen-lockfile > /tmp/install.log', cwd: mainRepoRoot }).decision,
      'allow',
    )
    assert.equal(
      decideBashCommand({ command: 'pnpm install --filter omnimux > /tmp/install.log', cwd: mainRepoRoot }).decision,
      'deny',
    )
    assert.equal(
      decideBashCommand({ command: 'npm install left-pad > /tmp/x.log', cwd: mainRepoRoot }).decision,
      'deny',
    )
    assert.equal(
      decideBashCommand({ command: 'pnpm build > /tmp/x.log 2>&1', cwd: mainRepoRoot }).decision,
      'deny',
    )
    // 管道下游命令不参与包管理器/构建判定。
    assert.equal(
      decideBashCommand({ command: 'pnpm install --frozen-lockfile 2>&1 | tail -3', cwd: mainRepoRoot }).decision,
      'allow',
    )
    assert.equal(
      decideBashCommand({ command: 'pnpm install --frozen-lockfile | tee /tmp/x.log', cwd: mainRepoRoot }).decision,
      'allow',
    )
    assert.equal(
      decideBashCommand({ command: 'pnpm build | cat', cwd: mainRepoRoot }).decision,
      'deny',
    )
    assert.equal(
      decideBashCommand({ command: 'npm install left-pad | cat', cwd: mainRepoRoot }).decision,
      'deny',
    )
    // 包装执行器（npx / pnpm exec / npm exec）按被包装命令判定。
    assert.equal(
      decideBashCommand({ command: 'pnpm exec npm ci', cwd: mainRepoRoot }).decision,
      'allow',
    )
    assert.equal(
      decideBashCommand({ command: 'npx --yes pnpm install --frozen-lockfile', cwd: mainRepoRoot }).decision,
      'allow',
    )
    assert.equal(
      decideBashCommand({ command: 'npm exec -- pnpm install --frozen-lockfile', cwd: mainRepoRoot }).decision,
      'allow',
    )
    assert.equal(
      decideBashCommand({ command: 'pnpm exec npm install left-pad', cwd: mainRepoRoot }).decision,
      'deny',
    )
    assert.equal(
      decideBashCommand({ command: 'pnpm exec tsc -p tsconfig.json', cwd: mainRepoRoot }).decision,
      'deny',
    )
    assert.equal(
      decideBashCommand({ command: 'npx vite build', cwd: mainRepoRoot }).decision,
      'deny',
    )
    assert.equal(
      decideBashCommand({ command: 'pnpm exec node scripts/dev-doctor.sh', cwd: mainRepoRoot }).decision,
      'allow',
    )
    assert.equal(
      decideBashCommand({ command: 'touch -r package.json .workbuddy/out.txt', cwd: mainRepoRoot }).decision,
      'allow',
    )
    assert.equal(
      decideBashCommand({ command: 'touch -r package.json /tmp/out.txt', cwd: mainRepoRoot }).decision,
      'allow',
    )
    assert.equal(
      decideBashCommand({ command: 'touch -r package.json .tmp/out.txt', cwd: mainRepoRoot }).decision,
      'deny',
    )
    assert.equal(
      decideBashCommand({ command: 'node scripts/dev-doctor.sh', cwd: mainRepoRoot }).decision,
      'allow',
    )
  })
})

describe('main checkout build query reuse', () => {
  function withGitLog(name, check) {
    const lookup = spawnSync('which', ['git'], { encoding: 'utf8' })
    assert.equal(lookup.status, 0, lookup.stderr)
    const realGit = realpathSync(lookup.stdout.trim())
    const bin = join(fixture, name)
    mkdirSync(bin)
    const log = join(bin, 'queries.log')
    writeFileSync(log, '')
    const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`
    writeFileSync(join(bin, 'git'), `#!/bin/sh\nprintf '%s\\t%s\\n' "$PWD" "$*" >> ${quote(log)}\nexec ${quote(realGit)} "$@"\n`, { mode: 0o755 })
    const previousPath = process.env.PATH
    process.env.PATH = `${bin}:${previousPath || ''}`
    try {
      check(() => readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((line) => {
        const [cwd, args] = line.split('\t')
        return [realpathSync(cwd), args]
      }))
    } finally {
      if (previousPath === undefined) delete process.env.PATH
      else process.env.PATH = previousPath
    }
  }

  it('reuses the first ordered query chain for literal ordinary segments at one cwd', () => {
    withGitLog('build-reuse-same-cwd-bin', (queries) => {
      assert.deepEqual(decideMainCheckoutBuildCommand('echo amber-orchard', mainRepoRoot), { decision: 'allow' })
      const single = queries()
      assert.deepEqual(single, [
        [realpathSync(mainRepoRoot), 'rev-parse --show-toplevel'],
        [realpathSync(mainRepoRoot), 'rev-parse --absolute-git-dir'],
        [realpathSync(mainRepoRoot), 'rev-parse --path-format=absolute --git-common-dir'],
        [realpathSync(mainRepoRoot), 'rev-parse --show-toplevel'],
        [realpathSync(mainRepoRoot), 'rev-parse --show-toplevel'],
        [realpathSync(mainRepoRoot), 'rev-parse --absolute-git-dir'],
        [realpathSync(mainRepoRoot), 'rev-parse --path-format=absolute --git-common-dir'],
      ])
      assert.deepEqual(decideMainCheckoutBuildCommand('echo amber-orchard && echo violet-meadow', mainRepoRoot), { decision: 'allow' })
      const multiple = queries().slice(single.length)
      assert.equal(multiple.length, single.length, `single=${single.length}, multiple=${multiple.length}`)
      assert.deepEqual(multiple, single)
    })
  })
})

describe('guard-worktree materialization safety guard (多 Agent 物化防覆盖硬拦截)', () => {
  it('correctly classifies materialization scripts and commands', () => {
    assert.equal(isMaterializationCommand('./scripts/sync-to-app.sh'), true)
    assert.equal(isMaterializationCommand('bash scripts/sync-to-app.sh omnimux-assets'), true)
    assert.equal(isMaterializationCommand('./scripts/sync-stable.sh'), true)
    assert.equal(isMaterializationCommand('bash scripts/materialize-with-rollback.sh omnimux'), true)
    assert.equal(isMaterializationCommand('node scripts/omnimux.mjs sync'), true)
    assert.equal(isMaterializationCommand('omnimux.mjs sync --prod'), true)

    // 豁免自动化测试、语法检查与多行脚本中的只读检视（修复 grep ... sync-to-app.sh 误杀）
    assert.equal(isMaterializationCommand('node --test scripts/sync-targets.test.mjs'), false)
    assert.equal(isMaterializationCommand('pnpm test'), false)
    assert.equal(isMaterializationCommand('echo sync-to-app.sh'), false)
    assert.equal(isMaterializationCommand('P=/tmp\necho "=== check ==="\ngrep -n assert_omnimux_sync_main plugins/scripts/sync-to-app.sh'), false)
    assert.equal(isMaterializationCommand('sed -n "1,20p" plugins/scripts/sync-to-app.sh | head -5'), false)
    assert.equal(isMaterializationCommand('bash -n plugins/scripts/sync-to-app.sh'), false)
    assert.equal(isMaterializationCommand('git diff -- plugins/scripts/sync-to-app.sh'), false)
  })

  it('allows --isolated materialization from worktree or behind main because it checks out clean origin/main', () => {
    assert.equal(
      decideBashCommand({ command: './scripts/sync-to-app.sh --isolated omnimux', cwd: worktreeRoot }).decision,
      'allow',
    )
    assert.equal(
      decideBashCommand({ command: 'corepack yarn omnimux:sync --isolated omnimux-assets', cwd: worktreeRoot }).decision,
      'allow',
    )
  })

  it('unwraps corepack/env/KEY=VAL and catches build:* / unfrozen --dir installs while allowing Yarn --immutable', () => {
    for (const cmd of [
      'corepack pnpm --dir plugins run build:all',
      'env CI=1 pnpm build:all',
      'NODE_ENV=production pnpm run compile:host',
      'corepack yarn package:dev',
      'corepack pnpm --dir plugins install',
      'corepack yarn install',
      'corepack yarn install --immutable=false',
    ]) {
      assert.equal(
        decideBashCommand({ command: cmd, cwd: mainRepoRoot }).decision,
        'deny',
        `Expected deny on primary checkout: ${cmd}`,
      )
    }

    for (const cmd of [
      'corepack yarn install --immutable',
      'corepack pnpm --dir plugins install --frozen-lockfile',
      `corepack pnpm --dir "${worktreeRoot}" run build:all`,
      'env CI=1 pnpm install --frozen-lockfile',
    ]) {
      assert.equal(
        decideBashCommand({ command: cmd, cwd: mainRepoRoot }).decision,
        'allow',
        `Expected allow: ${cmd}`,
      )
    }
  })

  it('denies materialization commands executed from inside an isolated worktree', () => {
    const result = decideBashCommand({
      command: './scripts/sync-to-app.sh omnimux',
      cwd: worktreeRoot,
    })

    assert.equal(result.decision, 'deny')
    assert.equal(result.reason, 'forbidden-worktree-materialization')
  })

  it('denies materialization on a non-main branch checkout', () => {
    const branchRepoRoot = join(fixture, 'feature-branch-repo')
    mkdirSync(branchRepoRoot, { recursive: true })
    gitCommand(branchRepoRoot, 'init', '-b', 'agent/feature-branch')
    writeFileSync(join(branchRepoRoot, 'package.json'), '{"name":"fixture"}')
    gitCommand(branchRepoRoot, 'add', '.')
    gitCommand(branchRepoRoot, '-c', 'user.name=Guard Test', '-c', 'user.email=guard@example.invalid', 'commit', '-m', 'feat base')

    const result = decideBashCommand({
      command: 'bash scripts/sync-to-app.sh',
      cwd: branchRepoRoot,
    })

    assert.equal(result.decision, 'deny')
    assert.equal(result.reason, 'forbidden-worktree-materialization')
  })

  it('denies materialization when local main is behind origin/main', () => {
    const localMainRepo = createRepo('local-behind-repo')
    // 模拟远程已经合入了新成果并拉取了 ref，使得 origin/main 领先本地 HEAD
    writeFileSync(join(localMainRepo, 'new-file.txt'), 'remote new feature\n')
    gitCommand(localMainRepo, 'add', '.')
    gitCommand(localMainRepo, '-c', 'user.name=Guard Test', '-c', 'user.email=guard@example.invalid', 'commit', '-m', 'remote merged feature')
    gitCommand(localMainRepo, 'update-ref', 'refs/remotes/origin/main', 'HEAD')
    // 本地回退一个提交，形成落后状态
    gitCommand(localMainRepo, 'reset', '--hard', 'HEAD~1')

    // 此时本地落后 1 个提交，物化必须被硬性阻断
    const result = decideBashCommand({
      command: './scripts/sync-to-app.sh',
      cwd: localMainRepo,
    })

    assert.equal(result.decision, 'deny')
    assert.equal(result.reason, 'forbidden-stale-main-materialization')
    assert.equal(result.behindCount >= 1, true)
  })

  it('allows materialization on clean, synchronized main checkout', () => {
    const syncRepo = join(fixture, 'synced-main-repo')
    mkdirSync(syncRepo, { recursive: true })
    gitCommand(syncRepo, 'init', '-b', 'main')
    writeFileSync(join(syncRepo, 'package.json'), '{"name":"fixture"}')
    gitCommand(syncRepo, 'add', '.')
    gitCommand(syncRepo, '-c', 'user.name=Guard Test', '-c', 'user.email=guard@example.invalid', 'commit', '-m', 'base commit')

    const result = decideBashCommand({
      command: './scripts/sync-to-app.sh',
      cwd: syncRepo,
    })

    assert.equal(result.decision, 'allow')
  })

  it('denies materialization when local main is ahead of origin/main (unpushed commits)', () => {
    const localAheadRepo = createRepo('local-ahead-repo')
    // 模拟远程已经对齐
    gitCommand(localAheadRepo, 'update-ref', 'refs/remotes/origin/main', 'HEAD')
    // 本地产生新提交，形成领先状态
    writeFileSync(join(localAheadRepo, 'unpushed.txt'), 'local unpushed feature\n')
    gitCommand(localAheadRepo, 'add', '.')
    gitCommand(localAheadRepo, '-c', 'user.name=Guard Test', '-c', 'user.email=guard@example.invalid', 'commit', '-m', 'unpushed commit')

    const result = decideBashCommand({
      command: './scripts/sync-to-app.sh',
      cwd: localAheadRepo,
    })

    assert.equal(result.decision, 'deny')
    assert.equal(result.reason, 'forbidden-diverged-main-materialization')
    assert.equal(result.aheadCount >= 1, true)
  })

  it('denies git merge and git commit on main branch in primary checkout', () => {
    const mainRepo = createRepo('main-branch-ops-repo')

    // 1. git merge on main -> deny
    const mergeResult = decideBashCommand({
      command: 'git merge feature-branch',
      cwd: mainRepo,
      ownerRoot: mainRepo,
    })
    assert.equal(mergeResult.decision, 'deny')
    assert.equal(mergeResult.reason, 'forbidden-main-branch-merge')

    // 2. git commit on main -> deny
    const commitResult = decideBashCommand({
      command: 'git commit -m "direct commit"',
      cwd: mainRepo,
      ownerRoot: mainRepo,
    })
    assert.equal(commitResult.decision, 'deny')
    assert.equal(commitResult.reason, 'forbidden-main-branch-commit')
  })

  it('allows git merge and git commit on main branch in a foreign repository', () => {
    const mainRepo = createRepo('main-branch-owner-repo')
    const foreignRepo = createRepo('foreign-repo')

    // 外部仓的 main：不属于 guard 所属仓库 → 放行
    const commitResult = decideBashCommand({
      command: 'git commit -m "foreign commit"',
      cwd: foreignRepo,
      ownerRoot: mainRepo,
    })
    assert.equal(commitResult.decision, 'allow')

    const mergeResult = decideBashCommand({
      command: 'git merge feature-branch',
      cwd: foreignRepo,
      ownerRoot: mainRepo,
    })
    assert.equal(mergeResult.decision, 'allow')

    // 显式 -C 指向外部仓同样放行
    const viaC = decideBashCommand({
      command: `git -C "${foreignRepo}" commit -m "foreign commit via -C"`,
      cwd: mainRepo,
      ownerRoot: mainRepo,
    })
    assert.equal(viaC.decision, 'allow')
  })

  it('tracks cd into a foreign repo so commit there is allowed while main stays denied', () => {
    const mainRepo = createRepo('main-branch-cd-owner')
    const foreignRepo = createRepo('foreign-repo-cd')

    const foreign = decideBashCommand({
      command: `cd "${foreignRepo}" && git commit -m "foreign commit"`,
      cwd: mainRepo,
      ownerRoot: mainRepo,
    })
    assert.equal(foreign.decision, 'allow')

    const owner = decideBashCommand({
      command: `cd "${mainRepo}" && git commit -m "direct on owner main"`,
      cwd: '/some/other/dir',
      ownerRoot: mainRepo,
    })
    assert.equal(owner.decision, 'deny')
    assert.equal(owner.reason, 'forbidden-main-branch-commit')
  })

  it('denies git worktree add without origin/main', () => {
    // 1. without origin/main -> deny
    const badWtResult = decideBashCommand({
      command: 'git worktree add ../wt-test',
      cwd: '/some/dir',
    })
    assert.equal(badWtResult.decision, 'deny')
    assert.equal(badWtResult.reason, 'forbidden-non-origin-worktree-add')

    // 2. with origin/main -> allow
    const goodWtResult = decideBashCommand({
      command: 'git worktree add -b my-feat ../wt-test origin/main',
      cwd: '/some/dir',
    })
    assert.equal(goodWtResult.decision, 'allow')
  })

  it('honours explicit `git -C <worktree>` so legitimate commits inside a worktree are not blocked', () => {
    // hook 收到的 cwd 是会话工作目录（此处为主干），但命令显式指向独立工作树
    const wrt = join(fixture, 'explicit-c-worktree')
    gitCommand(mainRepoRoot, 'worktree', 'add', '-b', 'explicit-c-branch', wrt, 'HEAD')

    // 1. 显式 -C 指向工作树 → 允许提交
    const allowed = decideBashCommand({
      command: `git -C "${wrt}" commit -m "work inside worktree"`,
      cwd: mainRepoRoot,
      ownerRoot: mainRepoRoot,
    })
    assert.equal(allowed.decision, 'allow')

    // 2. 无 -C，cwd 为主干 → 拦截
    const denied = decideBashCommand({
      command: 'git commit -m "direct on main"',
      cwd: mainRepoRoot,
      ownerRoot: mainRepoRoot,
    })
    assert.equal(denied.decision, 'deny')
    assert.equal(denied.reason, 'forbidden-main-branch-commit')

    // 3. 显式 -C 指向主干 → 拦截
    const deniedExplicit = decideBashCommand({
      command: `git -C "${mainRepoRoot}" commit -m "direct on main via -C"`,
      cwd: '/some/other/dir',
      ownerRoot: mainRepoRoot,
    })
    assert.equal(deniedExplicit.decision, 'deny')
    assert.equal(deniedExplicit.reason, 'forbidden-main-branch-commit')
  })
})

describe('guard-worktree unbounded scan guard (全盘扫盘硬拦截)', () => {
  const home = homedir().replace(/\/+$/, '')
  const homeArgument = /^[/\w.-]+$/.test(home) ? home : '$HOME'
  const project = '.'

  it('denies the incident command: find over the user home directory', () => {
    const result = decideBashCommand({
      command: `find ${homeArgument} -name "*insp_ad704927*" 2>/dev/null`,
      cwd: project,
    })
    assert.equal(result.decision, 'deny')
    assert.equal(result.reason, 'forbidden-unbounded-scan')
    assert.equal(result.target, home)
    assert.equal(result.binary, 'find')
  })

  it('denies traversals rooted at /, /Users, /home, ~ and $HOME', () => {
    for (const root of ['/', '/Users/', '/home', '/Volumes', '~', '$HOME', '${HOME}', '~/']) {
      const result = decideBashCommand({ command: `find ${root} -name "*.mp4"`, cwd: home })
      assert.equal(result.decision, 'deny', `expected deny for root ${root}`)
      assert.equal(result.reason, 'forbidden-unbounded-scan')
    }
  })

  it('denies recursive grep/rg/du/ls -R against a traversal root', () => {
    const commands = [
      'grep -r "TODO" /Users',
      `rg --hidden foo ${homeArgument}`,
      `du -sh ${homeArgument}`,
      `ls -R ${homeArgument}`,
      `find ${homeArgument} -type f -name "*.mov"`,
    ]
    for (const command of commands) {
      const result = decideBashCommand({ command, cwd: home })
      assert.equal(result.decision, 'deny', `expected deny for: ${command}`)
      assert.equal(result.reason, 'forbidden-unbounded-scan')
    }
  })

  it('denies `cd <home> && find .` where the sweep root is armed by the previous segment', () => {
    const result = decideBashCommand({
      command: `cd ${homeArgument} && find . -name "*insp*"`,
      cwd: home,
    })
    assert.equal(result.decision, 'deny')
    assert.equal(result.reason, 'forbidden-unbounded-scan')
    assert.equal(result.target, home)
  })

  it('allows bounded searches inside the project and scoped find depth', () => {
    const commands = [
      'find . -name "*.mjs"',
      'find plugins -name "*.js"',
      'find . -name "*.md"',
      `find ${homeArgument} -maxdepth 2 -name "*.json"`,
      `find ${homeArgument} -maxdepth=3 -type d`,
      'rg "TODO" plugins/scripts',
      'grep -rn "guard" scripts/',
      'ls -la plugins',
      'cd . && find . -name "*.md"',
      'find ~/Movies -name "*.mov"',
      `cd ${homeArgument} && ls -la`,
    ]
    for (const command of commands) {
      const result = decideBashCommand({ command, cwd: project })
      assert.equal(result.decision, 'allow', `expected allow for: ${command}`)
    }
  })

  it('classifies scan roots without flagging project-internal paths', () => {
    assert.equal(isUnboundedScanRoot(home), true)
    assert.equal(isUnboundedScanRoot('/'), true)
    assert.equal(isUnboundedScanRoot('~'), true)
    assert.equal(isUnboundedScanRoot('.'), false)
    assert.equal(isUnboundedScanRoot('.'), false)
  })

  it('guards the glob and grep tools when their path argument names a traversal root', () => {
    const deniedGlob = decideSearchTarget({
      toolName: 'glob',
      toolInput: { pattern: '**/*insp_ad704927*', path: home },
    })
    assert.equal(deniedGlob.decision, 'deny')
    assert.equal(deniedGlob.reason, 'forbidden-unbounded-scan')
    assert.equal(deniedGlob.target, home)

    assert.equal(decideSearchTarget({ toolName: 'grep', toolInput: { pattern: 'TODO', path: '/' } }).decision, 'deny')

    // An omitted path stays inside the session workspace.
    assert.equal(decideSearchTarget({ toolName: 'glob', toolInput: {} }).decision, 'allow')
    // A project-scoped path is untouched.
    assert.equal(decideSearchTarget({ toolName: 'glob', toolInput: { path: project } }).decision, 'allow')
    // Other tools are never matched by this guard.
    assert.equal(decideSearchTarget({ toolName: 'read', toolInput: { path: '/' } }).decision, 'allow')
  })

  it('emits an actionable denial reason through the PreToolUse protocol', () => {
    const payload = JSON.stringify({
      hook_event_name: 'PreToolUse',
      tool_name: 'bash',
      cwd: home,
      tool_input: { command: `find ${homeArgument} -name "*insp*"` },
    })
    const result = spawnSync('node', [join(here, 'guard-worktree.mjs')], { input: payload, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    const parsed = JSON.parse(result.stdout)
    assert.equal(parsed.hookSpecificOutput.hookEventName, 'PreToolUse')
    assert.equal(parsed.hookSpecificOutput.permissionDecision, 'deny')
    assert.match(parsed.hookSpecificOutput.permissionDecisionReason, /无界递归扫描/)
    assert.match(parsed.hookSpecificOutput.permissionDecisionReason, /video_breakdown_analyze/)
  })

  it('denies glob tool calls routed through the hook dispatcher', () => {
    const payload = JSON.stringify({
      hook_event_name: 'PreToolUse',
      tool_name: 'default_api:glob',
      cwd: home,
      tool_input: { pattern: '**/*insp_ad704927*', path: home },
    })
    const result = spawnSync('node', [join(here, 'guard-worktree.mjs')], { input: payload, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    const parsed = JSON.parse(result.stdout)
    assert.equal(parsed.hookSpecificOutput.permissionDecision, 'deny')
  })
})

// #3821：主检出 install 必须冻结 lockfile。
//
// 背景：不带冻结 flag 的 install 会按 manifest 重写 pnpm-lock.yaml，这一步不经过
// edit/write，因而绕开 tracked-file 保护。实测（pnpm 11）：manifest 加一个依赖后
// 无 flag 的 install 使 lockfile sha256 从 88818e6e 变为 c10e5b05；带
// --frozen-lockfile 时命令失败退出且哈希不变。
describe('main checkout install must freeze the lockfile (#3821)', () => {
  const mainCwd = mainRepoRoot

  it('denies unfrozen install for every package manager', () => {
    for (const command of ['pnpm install', 'npm install', 'yarn install', 'pnpm i']) {
      const result = decideBashCommand({ command, cwd: mainCwd })
      assert.equal(result.decision, 'deny', `${command} 必须被拒`)
      assert.equal(result.reason, 'forbidden-main-checkout-unfrozen-install', `${command} 的拒绝原因要能指名`)
    }
  })

  it('allows frozen install and npm ci', () => {
    for (const command of [
      'pnpm install --frozen-lockfile',
      'pnpm install --offline --frozen-lockfile',
      'yarn install --frozen-lockfile',
      'npm ci',
    ]) {
      assert.equal(decideBashCommand({ command, cwd: mainCwd }).decision, 'allow', `${command} 必须放行`)
    }
  })

  it('treats an explicit frozen=false as unfrozen', () => {
    // 写成 =false 等于关掉冻结，不能因为出现该字符串就当成安全。
    assert.equal(
      decideBashCommand({ command: 'pnpm install --frozen-lockfile=false', cwd: mainCwd }).decision,
      'deny',
    )
    assert.equal(
      decideBashCommand({ command: 'pnpm install --frozen-lockfile=0', cwd: mainCwd }).decision,
      'deny',
    )
  })

  it('still denies package-name installs on the main checkout', () => {
    // 冻结判定不应盖掉原有的「带包名按 add 语义拒绝」保护。
    const result = decideBashCommand({ command: 'pnpm install left-pad --frozen-lockfile', cwd: mainCwd })
    assert.equal(result.decision, 'deny')
    assert.equal(result.reason, 'forbidden-main-checkout-build')
  })

  it('does not restrict installs inside a real worktree', () => {
    // 工作树里怎么装都不该管——这是任务隔离区的正常开发行为。
    // 必须是 git 真实登记的工作树（见文件顶部 `git worktree add` 建的 worktreeRoot）：
    // 随手 mkdir 一个目录不算，isWorktreePath 会判否。
    for (const command of ['pnpm install', 'yarn install', 'pnpm install --filter x']) {
      assert.equal(decideBashCommand({ command, cwd: worktreeRoot }).decision, 'allow', `${command} 在工作树内必须放行`)
    }
  })
})

describe('adversarial hardening regressions (materialization / wrapper / frozen-install / bash write)', () => {
  it('blocks materialization bypasses via vitest/jest comments, subshells, shell/node flags, env spoofing, and managed conflicts', () => {
    const denyFromWorktree = [
      'echo vitest && ./scripts/sync-to-app.sh omnimux',
      './scripts/sync-to-app.sh omnimux # jest',
      './scripts/sync-to-app.sh omnimux # --isolated',
      'OMNIMUX_SYNC_ISOLATED_ACTIVE=1 ./scripts/sync-to-app.sh --isolated omnimux',
      'env OMNIMUX_SYNC_ISOLATED_ACTIVE=1 ./scripts/sync-to-app.sh --isolated omnimux',
      'export OMNIMUX_SYNC_ISOLATED_ACTIVE=1 && ./scripts/sync-to-app.sh --isolated omnimux',
      './scripts/sync-to-app.sh --isolated --managed-tarball=/tmp/fake.tgz',
      '( ./scripts/sync-to-app.sh omnimux )',
      '{ ./scripts/sync-to-app.sh omnimux; }',
      'bash -o errexit scripts/sync-to-app.sh omnimux',
      'bash < scripts/sync-to-app.sh',
      'cat scripts/sync-to-app.sh | bash',
      'node scripts/omnimux.mjs sync --test',
      'node -r ./x.js scripts/omnimux.mjs sync',
      'bash -c "./scripts/sync-to-app.sh omnimux"',
    ]
    for (const command of denyFromWorktree) {
      const result = decideBashCommand({ command, cwd: worktreeRoot })
      assert.equal(result.decision, 'deny', `Expected worktree materialization deny: ${command}`)
      assert.equal(result.reason, 'forbidden-worktree-materialization', `Unexpected reason for: ${command}`)
    }
  })

  it('blocks build, wrapper, cross-dir targeting, and manager-specific unfrozen-install bypasses', () => {
    const denyOnMain = [
      'env -S "pnpm build:all"',
      'env --split-string="CI=1 pnpm build:all"',
      'corepack yarn workspace dsh-plugin-desktop build',
      'corepack yarn workspaces foreach -A run build',
      'pnpm --dir plugins exec tsc',
      'pnpm --dir plugins tsc',
      'bash -c "pnpm build:all"',
      'sh -lc "pnpm build:all"',
      '(pnpm build:all)',
      'corepack yarn',
      'yarn --cwd app',
      'npm install --immutable',
      'npm install --frozen-lockfile',
      'pnpm install --immutable',
      'pnpm install --frozen-lockfile --no-frozen-lockfile',
      'pnpm install --frozen-lockfile --frozen-lockfile=false',
      'yarn install --immutable --no-immutable',
      'pnpm install -- --frozen-lockfile',
    ]
    for (const command of denyOnMain) {
      const result = decideBashCommand({ command, cwd: mainRepoRoot })
      assert.equal(result.decision, 'deny', `Expected main build/install deny: ${command}`)
    }

    // Worktree -> primary checkout via --dir / -C / bash -c must still be denied
    for (const command of [
      `corepack pnpm --dir "${mainRepoRoot}/plugins" run build:all`,
      `pnpm --dir "${mainRepoRoot}/plugins" exec tsc`,
      `env -C "${mainRepoRoot}/plugins" pnpm build:all`,
      `bash -c 'cd "${mainRepoRoot}" && pnpm build:all'`,
    ]) {
      assert.equal(
        decideBashCommand({ command, cwd: worktreeRoot }).decision,
        'deny',
        `Expected worktree->main build deny: ${command}`,
      )
    }

    // Legitimate frozen installs & info flags remain allowed
    for (const command of [
      'yarn install --cwd app --immutable',
      'corepack yarn --immutable',
      'corepack yarn --version',
      `pnpm --dir "${worktreeRoot}" exec tsc`,
    ]) {
      assert.equal(
        decideBashCommand({ command, cwd: mainRepoRoot }).decision,
        'allow',
        `Expected allow: ${command}`,
      )
    }
  })

  it('blocks FD/combined/noclobber redirects, git redirects, rm/mv/abs-bin/wrapper mutations, and tracks cd across worktree/main', () => {
    const denyOnMain = [
      'echo x 1> README.md',
      'echo x 2> README.md',
      'echo x &> README.md',
      'echo x &>> README.md',
      'echo x >| README.md',
      'echo x 1>| README.md',
      'echo x <> README.md',
      'git status > README.md',
      'rm README.md',
      'rm -rf .tmp',
      'mv README.md /tmp/out',
      '/bin/cp /tmp/a README.md',
      '/usr/bin/touch evil.txt',
      'command touch evil.txt',
      'env touch evil.txt',
      'env -S "touch evil.txt"',
      'bash -c "touch evil.txt"',
      '(echo evil > README.md)',
      `(cd "${worktreeRoot}" && echo ok > .tmp-wt.txt) && echo evil > README.md`,
    ]
    for (const command of denyOnMain) {
      const result = decideBashCommand({ command, cwd: mainRepoRoot })
      assert.equal(result.decision, 'deny', `Expected main bash write deny: ${command}`)
      assert.equal(result.reason, 'forbidden-main-checkout-copy', `Unexpected reason for: ${command}`)
    }

    // Worktree -> primary checkout via cd must be denied
    for (const command of [
      `cd "${mainRepoRoot}" && echo evil > README.md`,
      `cd "${mainRepoRoot}" && touch evil.txt`,
      `cd "${mainRepoRoot}" && rm README.md`,
    ]) {
      const result = decideBashCommand({ command, cwd: worktreeRoot })
      assert.equal(result.decision, 'deny', `Expected worktree->main cd write deny: ${command}`)
      assert.equal(result.reason, 'forbidden-main-checkout-copy', `Unexpected reason for: ${command}`)
    }

    // Main -> worktree via cd and safe external/allowlisted/lookup commands must be allowed (zero false positives)
    for (const command of [
      `cd "${worktreeRoot}" && echo ok > .tmp-test-fp.txt`,
      `cd "${worktreeRoot}" && touch new-file.txt`,
      `cd "${worktreeRoot}" && rm -f scratch.txt`,
      'git diff > /tmp/out.diff',
      'git status > .workbuddy/status.txt',
      'echo "a > README.md"',
      'command -v rm',
      'rm -f /tmp/scratch-file',
      'mv .workbuddy/a.txt /tmp/b.txt',
    ]) {
      assert.equal(
        decideBashCommand({ command, cwd: mainRepoRoot }).decision,
        'allow',
        `Expected allow without false positive: ${command}`,
      )
    }
  })

  it('closes subshell/cd tracking leaks, heredocs/here-strings, and conditional short-circuits (R1)', () => {
    const denyOnMain = [
      `(cd "${worktreeRoot}" && echo x) > README.md`,
      `(cd "${worktreeRoot}" && true) >/dev/null; echo pwn > README.md`,
      `(cd "${worktreeRoot}" && echo ok) | cat; echo pwn > README.md`,
      `(cd "${worktreeRoot}" && true) >/dev/null; pnpm build:all`,
      `(cd "${worktreeRoot}" && echo ok) | cat; pnpm build:all`,
      `echo $(true && cd "${worktreeRoot}"); echo pwn > README.md`,
      `echo $(true && cd "${worktreeRoot}"); pnpm build:all`,
      `false && cd "${worktreeRoot}" || echo pwn > README.md`,
      `true || cd "${worktreeRoot}" && echo pwn > README.md`,
      `cd "${worktreeRoot}" || echo pwn > README.md`,
      `cd "${worktreeRoot}" & echo pwn > README.md`,
      `cd "${worktreeRoot}" | cat; echo pwn > README.md`,
      `cd "${worktreeRoot}/does-not-exist"; echo pwn > README.md`,
      `if false; then cd "${worktreeRoot}"; fi; echo pwn > README.md`,
      `foo() { cd "${worktreeRoot}"; }; echo pwn > README.md`,
      `{ cd "${worktreeRoot}"; } > README.md`,
      `cat <<'EOF'\ncd ${worktreeRoot}\nEOF\necho pwn > README.md`,
      `cat <<'EOF' | bash\necho pwn > README.md\nEOF`,
      `cat <<'EOF' | bash\npnpm build:all\nEOF`,
      `bash <<< 'echo pwn > README.md'`,
      `bash <<< 'pnpm build:all'`,
      `cat <<< 'echo pwn > README.md' | bash`,
      `((pnpm build:all) && true)`,
      `((rm README.md) && true)`,
      `echo $(echo pwn > README.md)`,
      `echo $(pnpm build:all)`,
    ]
    for (const command of denyOnMain) {
      const result = decideBashCommand({ command, cwd: mainRepoRoot })
      assert.equal(result.decision, 'deny', `Expected R1 deny on main: ${command}`)
    }

    // Legitimate subshells, terminating fallback cd, and arithmetic stay allowed
    for (const command of [
      `cd "${worktreeRoot}" || exit 1; echo ok > README.md`,
      `(cd "${worktreeRoot}" && echo ok > README.md)`,
      `(cd "${worktreeRoot}" && pnpm build:all)`,
      `(( 1 + 1 )) && echo ok`,
      `bash <<'EOF'\ncd "${worktreeRoot}"\necho ok > README.md\nEOF`,
    ]) {
      assert.equal(
        decideBashCommand({ command, cwd: mainRepoRoot }).decision,
        'allow',
        `Expected R1 allow: ${command}`,
      )
    }
  })

  it('closes shell flag +n, -s stdin, source --, and pipeline input-redirect bypasses (R2)', () => {
    for (const command of [
      `bash -n +n -c 'echo pwn > README.md'`,
      `bash -o noexec +o noexec -c 'echo pwn > README.md'`,
      `bash -n +n -c 'pnpm build:all'`,
    ]) {
      assert.equal(
        decideBashCommand({ command, cwd: mainRepoRoot }).decision,
        'deny',
        `Expected R2 deny on main: ${command}`,
      )
    }

    for (const command of [
      `bash -n +n ./plugins/scripts/sync-to-app.sh`,
      `bash -s -- foo < ./plugins/scripts/sync-to-app.sh`,
      `cat ./plugins/scripts/sync-to-app.sh | bash -s -- foo`,
      `source -- ./plugins/scripts/sync-to-app.sh`,
      `. -- ./plugins/scripts/sync-to-app.sh`,
      `cat < ./plugins/scripts/sync-to-app.sh | bash`,
      `(cat) < ./plugins/scripts/sync-to-app.sh | bash`,
      `cat <<'EOF' | bash\n./plugins/scripts/sync-to-app.sh\nEOF`,
      `bash <<< './plugins/scripts/sync-to-app.sh'`,
      `((./plugins/scripts/sync-to-app.sh) && true)`,
    ]) {
      const result = decideBashCommand({ command, cwd: worktreeRoot })
      assert.equal(result.decision, 'deny', `Expected R2 materialization deny from worktree: ${command}`)
      assert.equal(result.reason, 'forbidden-worktree-materialization', `Unexpected reason: ${command}`)
    }

    // Pure syntax check stays allowed
    assert.equal(decideBashCommand({ command: 'bash -n ./plugins/scripts/sync-to-app.sh', cwd: worktreeRoot }).decision, 'allow')
    assert.equal(decideBashCommand({ command: `bash -n -c 'echo pwn > README.md'`, cwd: mainRepoRoot }).decision, 'allow')
  })

  it('closes multi-file sed/perl decoy, 1-arg ln, exec builtin, attached -tDIR, install -d, and node two-arg fs (R3)', () => {
    for (const command of [
      `sed -i '' 's/a/b/' README.md /tmp/decoy.txt`,
      `sed -i '' -e 's/a/b/' README.md /tmp/decoy.txt`,
      `sed --in-place=.bak 's/a/b/' README.md /tmp/decoy.txt`,
      `perl -pi -e 's/a/b/' README.md /tmp/decoy.txt`,
      `ln -s /tmp/some-source`,
      `ln -s /tmp/some-dir/`,
      `exec rm README.md`,
      `exec bash -c 'echo pwn > README.md'`,
      `exec pnpm build:all`,
      `cp -t. /tmp/a /tmp/b`,
      `cp -at. /tmp/a`,
      `install -d newdir`,
      `install -m 755 -d newdir`,
      `node -e 'require("fs").copyFileSync("/tmp/a", "README.md")'`,
      `node -p 'require("fs").writeFileSync("README.md", "x")'`,
    ]) {
      assert.equal(
        decideBashCommand({ command, cwd: mainRepoRoot }).decision,
        'deny',
        `Expected R3 deny on main: ${command}`,
      )
    }

    assert.equal(
      decideBashCommand({ command: 'exec ./plugins/scripts/sync-to-app.sh', cwd: worktreeRoot }).decision,
      'deny',
    )

    // External targets remain allowed
    for (const command of [
      `sed -i '' 's/a/b/' /tmp/safe.txt`,
      `sed -i .bak 's/a/b/' /tmp/safe.txt`,
      `ln -s "${mainRepoRoot}/README.md" /tmp/out-link`,
    ]) {
      assert.equal(
        decideBashCommand({ command, cwd: mainRepoRoot }).decision,
        'allow',
        `Expected R3 allow: ${command}`,
      )
    }
  })

  it('closes pnpm recursive/m, tsc --noEmit reset, strict frozen-lockfile, yarn --since, npm exec -c, per-segment git -C, and avoids 3 false positives (R4 & NB-1)', () => {
    for (const command of [
      'pnpm recursive run build',
      'pnpm m run build:all',
      'pnpm recursive install',
      'pnpm recursive exec tsc',
      'pnpm -r run build',
      'pnpm -r exec tsc',
      'tsc --noEmit --noEmit=false',
      'tsc --noEmit --noEmit false',
      'tsc --noEmit --noemit=false',
      'pnpm install --frozen-lockfile=no',
      'yarn install --immutable=no',
      'yarn workspaces foreach --since main run build',
      'yarn workspaces foreach --since main exec tsc',
      'npm exec -c "pnpm build:all"',
      'npm exec --call="echo pwn > README.md"',
      'npx -c "pnpm build:all"',
      'pnpm exec -c "pnpm build:all"',
      `git -C "${worktreeRoot}" status && git restore README.md`,
      `git -C "${worktreeRoot}" status && git commit --allow-empty -m x`,
      `git -C "${worktreeRoot}" status && git merge feature-x`,
      `git merge origin/main feature-x`,
    ]) {
      assert.equal(
        decideBashCommand({ command, cwd: mainRepoRoot, ownerRoot: mainRepoRoot }).decision,
        'deny',
        `Expected R4/NB-1 deny on main: ${command}`,
      )
    }

    // Legitimate commands that must NOT false-positive
    for (const command of [
      'echo hi 2>&1>/dev/null',
      'perl -Ilib -e \'print 1\' README.md',
      'perl -Mstrict -e \'print 1\' README.md',
      'tsc --noEmit -p tsconfig.json',
      'pnpm recursive install --frozen-lockfile',
      'yarn workspaces foreach --since main run test',
      `git -C "${worktreeRoot}" status && git -C "${worktreeRoot}" commit --allow-empty -m x`,
    ]) {
      assert.equal(
        decideBashCommand({ command, cwd: mainRepoRoot, ownerRoot: mainRepoRoot }).decision,
        'allow',
        `Expected allow without false positive: ${command}`,
      )
    }

    // Package-manager `-- --isolated` forwarding from worktree must be allowed,
    // while conflicting flags or OMNIMUX_SYNC_ISOLATED_ACTIVE remain denied.
    for (const command of [
      'corepack pnpm --dir plugins run sync -- --isolated omnimux',
      'npm run sync -- --isolated',
      'yarn omnimux:sync -- --isolated',
    ]) {
      assert.equal(
        decideBashCommand({ command, cwd: worktreeRoot }).decision,
        'allow',
        `Expected PM -- --isolated allow from worktree: ${command}`,
      )
    }
    for (const command of [
      'pnpm run sync -- --isolated --managed-tarball=/tmp/x',
      'OMNIMUX_SYNC_ISOLATED_ACTIVE=1 pnpm run sync -- --isolated',
      'pnpm run --isolated sync',
    ]) {
      assert.equal(
        decideBashCommand({ command, cwd: worktreeRoot }).decision,
        'deny',
        `Expected conflicted --isolated deny from worktree: ${command}`,
      )
    }
  })

  it('never short-circuits downstream guards when destructive-reset upstream is clean (F1)', (t) => {
    const tmp = mkdtempSync(join(tmpdir(), 'guard-f1-clean-'))
    t.after(() => rmSync(tmp, { recursive: true, force: true }))
    const bare = join(tmp, 'origin.git')
    const primary = join(tmp, 'primary')
    const wt = join(tmp, 'wt')
    const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' }
    const runGit = (...gitArgs) => {
      const res = spawnSync('git', gitArgs, { env, encoding: 'utf8' })
      assert.equal(res.status, 0, `git ${gitArgs.join(' ')} failed: ${res.stderr}`)
    }
    runGit('init', '--bare', '-b', 'main', bare)
    runGit('clone', bare, primary)
    runGit('-C', primary, 'config', 'user.email', 'test@example.com')
    runGit('-C', primary, 'config', 'user.name', 'Test')
    writeFileSync(join(primary, 'README.md'), 'hello\n')
    runGit('-C', primary, 'add', 'README.md')
    runGit('-C', primary, 'commit', '-m', 'init')
    runGit('-C', primary, 'push', '-u', 'origin', 'main')
    runGit('-C', primary, 'worktree', 'add', '-b', 'feat/clean', wt, 'origin/main')

    for (const command of [
      'git clean -nf && echo pwn > README.md',
      'git clean -nf && git commit --allow-empty -m "pwn main"',
      'git clean -nf && pnpm build:all',
      'git restore --source=origin/main README.md',
      'echo pwn > README.md; false && git reset --hard',
    ]) {
      assert.equal(
        decideBashCommand({ command, cwd: primary, ownerRoot: primary }).decision,
        'deny',
        `Expected F1 deny on clean primary: ${command}`,
      )
    }

    assert.equal(
      decideBashCommand({ command: 'git clean -nf && bash plugins/scripts/sync-to-app.sh', cwd: wt, ownerRoot: primary }).decision,
      'deny',
      'Expected F1 materialization deny on clean worktree',
    )
    // Pure clean-upstream reset without downstream violation remains allowed
    assert.equal(
      decideBashCommand({ command: 'git reset --hard origin/main', cwd: primary, ownerRoot: primary }).decision,
      'allow',
    )
  })

  it('closes brace pipeline/bg, Allman/hyphenated functions, subshell case/for((...)), pushd -n, and prefixed cd leaks (F2)', () => {
    const denyOnMain = [
      `echo ok | { true; cd "${worktreeRoot}"; }; echo pwn > README.md`,
      `{ true; cd "${worktreeRoot}"; } | cat; echo pwn > README.md`,
      `{ true; cd "${worktreeRoot}"; } & wait; echo pwn > README.md`,
      `f()\n{\n  cd "${worktreeRoot}"\n}\necho pwn > README.md`,
      `my-fn() {\n  cd "${worktreeRoot}"\n}\necho pwn > README.md`,
      `(\n  case x in\n    x) true ;;\n  esac\n  cd "${worktreeRoot}"\n)\necho pwn > README.md`,
      `(\n  case x in x) true ;; esac\n  cd "${worktreeRoot}"\n)\necho pwn > README.md`,
      `(\n  for ((i=0; i<1; i++)); do true; done\n  cd "${worktreeRoot}"\n)\necho pwn > README.md`,
      `pushd -n "${worktreeRoot}" >/dev/null && echo pwn > README.md`,
      `cd "${worktreeRoot}" && command cd "${mainRepoRoot}" && echo pwn > README.md`,
      `cd "${worktreeRoot}" && FOO=1 cd "${mainRepoRoot}" && echo pwn > README.md`,
    ]
    for (const command of denyOnMain) {
      assert.equal(
        decideBashCommand({ command, cwd: mainRepoRoot, ownerRoot: mainRepoRoot }).decision,
        'deny',
        `Expected F2 deny on main: ${command}`,
      )
    }

    for (const command of [
      `command cd "${mainRepoRoot}" && echo pwn > README.md`,
      `FOO=1 cd "${mainRepoRoot}" && echo pwn > README.md`,
    ]) {
      assert.equal(
        decideBashCommand({ command, cwd: worktreeRoot, ownerRoot: mainRepoRoot }).decision,
        'deny',
        `Expected F2 worktree->main prefixed cd deny: ${command}`,
      )
    }
  })

  it('fixes pnpm -w boolean flag, pnpm -c/--shell-mode exec, and npm x alias (F3)', () => {
    for (const command of [
      'pnpm -w build:all',
      `pnpm -w exec bash -c 'echo pwn > README.md'`,
      'pnpm -w install',
      `pnpm -c exec 'echo pwn > README.md'`,
      `pnpm --shell-mode exec 'echo>README.md'`,
      `npm x -c 'echo pwn > README.md'`,
      'npm x -- tsc',
    ]) {
      assert.equal(
        decideBashCommand({ command, cwd: mainRepoRoot, ownerRoot: mainRepoRoot }).decision,
        'deny',
        `Expected F3 deny on main: ${command}`,
      )
    }

    assert.equal(
      decideBashCommand({ command: 'pnpm -w sync', cwd: worktreeRoot, ownerRoot: mainRepoRoot }).decision,
      'deny',
      'Expected pnpm -w sync deny from worktree',
    )

    // Legitimate npm -w <pkg> non-build script and pnpm -w frozen install remain allowed
    for (const command of [
      'pnpm -w install --frozen-lockfile',
      'npm -w pkg-a test',
      `pnpm -c exec 'echo ok'`,
    ]) {
      assert.equal(
        decideBashCommand({ command, cwd: mainRepoRoot, ownerRoot: mainRepoRoot }).decision,
        'allow',
        `Expected F3 allow: ${command}`,
      )
    }
  })

  it('closes bash <>, <(...) process substitution, printf format, zsh -o exec/no_exec, node -pe, python -uc/-c, git GIT_DIR/--work-tree, and find -delete (F4)', () => {
    for (const command of [
      `bash <(echo 'echo pwn > README.md')`,
      `source <(echo 'echo pwn > README.md')`,
      `bash < <(echo 'echo pwn > README.md')`,
      `printf 'echo %s > README.md\\n' pwn | bash`,
      `zsh -n -o exec -c 'echo pwn > README.md'`,
      `zsh -o noexec +o no_exec -c 'echo pwn > README.md'`,
      `node -pe "require('fs').writeFileSync('README.md', 'pwn')"`,
      `python3 -uc "open('README.md','w').write('pwn')"`,
      `python3 -c"open('README.md','w').write('pwn')"`,
      `python3 -c"os.remove('README.md')"`,
      `find . -maxdepth 1 -name README.md -delete`,
    ]) {
      assert.equal(
        decideBashCommand({ command, cwd: mainRepoRoot, ownerRoot: mainRepoRoot }).decision,
        'deny',
        `Expected F4 deny on main: ${command}`,
      )
    }

    for (const command of [
      'bash <> plugins/scripts/sync-to-app.sh',
      `bash <(echo 'bash plugins/scripts/sync-to-app.sh')`,
      `bash <(cat plugins/scripts/sync-to-app.sh)`,
      `git --work-tree="${mainRepoRoot}" --git-dir="${mainRepoRoot}/.git" -C "${worktreeRoot}" restore :/README.md`,
      `GIT_DIR="${mainRepoRoot}/.git" GIT_WORK_TREE="${mainRepoRoot}" git commit --allow-empty -m "pwn main"`,
    ]) {
      assert.equal(
        decideBashCommand({ command, cwd: worktreeRoot, ownerRoot: mainRepoRoot }).decision,
        'deny',
        `Expected F4 deny from worktree: ${command}`,
      )
    }

    // External find -delete & allowlisted .workbuddy find -delete remain allowed
    for (const command of [
      'find /tmp/scratch -maxdepth 1 -name "*.tmp" -delete',
      'find .workbuddy -maxdepth 2 -name "*.tmp" -delete',
    ]) {
      assert.equal(
        decideBashCommand({ command, cwd: mainRepoRoot, ownerRoot: mainRepoRoot }).decision,
        'allow',
        `Expected F4 allow: ${command}`,
      )
    }
  })

  it('avoids false positives on Bash (( ... )), for ((...)), [[ ... ]] comparisons, and spaced 2>& 1 (F5)', () => {
    for (const command of [
      '(( 2 > 1 )) && echo ok',
      'for ((i=3; i>0; i--)); do echo $i; done',
      '[[ "b" > "a" ]] && echo ok',
      '[[ "a" < "b" && "c" > "b" ]] && echo ok',
      'echo hi 2>& 1',
    ]) {
      assert.equal(
        decideBashCommand({ command, cwd: mainRepoRoot, ownerRoot: mainRepoRoot }).decision,
        'allow',
        `Expected F5 allow without false positive: ${command}`,
      )
    }

    // Redirections AFTER ((...)) / [[...]] or substitutions INSIDE $((...)) must still be denied
    for (const command of [
      '(( 2 > 1 )) > README.md',
      '[[ "b" > "a" ]] > README.md',
      'echo $(( $(echo pwn > README.md) + 1 ))',
    ]) {
      assert.equal(
        decideBashCommand({ command, cwd: mainRepoRoot, ownerRoot: mainRepoRoot }).decision,
        'deny',
        `Expected F5 post-expr redir/subshell deny: ${command}`,
      )
    }
  })

  it('prevents argument-position [[ ... ]] universal bypass while keeping command-position [[ ... ]] zero-FP (B1)', () => {
    for (const command of [
      ': [[ ; echo pwn > README.md ; : ]]',
      ': [[ ; git commit --allow-empty -m x ; : ]]',
      ': [[ && pnpm build:all && : ]]',
      ': [[ ; rm README.md ; : ]]',
      'echo if [[ && echo pwn > README.md && : ]]',
      'echo "a;b" [[ && echo pwn > README.md && : ]]',
      'FOO=1 [[ || echo pwn > README.md || : ]]',
      'a=(1 2) [[ || echo pwn > README.md || : ]]',
      '[[ a == b ; echo pwn > README.md ; ]]',
      '[[ $(echo pwn > README.md) > "a" ]]',
    ]) {
      assert.equal(
        decideBashCommand({ command, cwd: mainRepoRoot, ownerRoot: mainRepoRoot }).decision,
        'deny',
        `Expected B1 deny on main: ${command}`,
      )
    }

    assert.equal(
      decideBashCommand({
        command: ': [[ && bash plugins/scripts/sync-to-app.sh && : ]]',
        cwd: worktreeRoot,
        ownerRoot: mainRepoRoot,
      }).decision,
      'deny',
      'Expected B1 worktree materialization deny',
    )

    // Legitimate command-position [[ ... ]] comparisons remain allowed
    for (const command of [
      'if [[ "b" > "a" ]]; then echo ok; fi',
      'if ! [[ "a" > "b" ]]; then echo ok; fi',
      'time [[ "b" > "a" ]] && echo ok',
      'case x in (a|b) [[ "b" > "a" && "c" > "b" ]] && echo ok ;; esac',
    ]) {
      assert.equal(
        decideBashCommand({ command, cwd: mainRepoRoot, ownerRoot: mainRepoRoot }).decision,
        'allow',
        `Expected B1 command-position [[ allow: ${command}`,
      )
    }
  })

  it('inspects command substitutions in case/for headers and handles (a|b) case alternation without subshell leak (B2 & B4)', () => {
    for (const command of [
      'case $(echo pwn > README.md) in *) true ;; esac',
      'case x in $(echo pwn > README.md)) true ;; esac',
      'case x in\n  $(echo pwn > README.md))\n    true ;;\nesac',
      'for ((i=$(echo pwn > README.md && echo 0); i<0; i++)) do true; done',
      'for ((i=0; i<1; i++)) { echo pwn > README.md; }',
      `(\n  cd "${worktreeRoot}"\n  case x in\n    (a|b) true ;;\n  esac\n)\necho pwn > README.md`,
      `( cd "${worktreeRoot}"; case x in (a|b) true ;; esac ); echo pwn > README.md`,
      `(\n  cd "${worktreeRoot}"\n  case x in\n    a)\n      true\n    ;;\n    (b|c)\n      true\n    ;;\n  esac\n)\necho pwn > README.md`,
      `(\n  case x in\n    $(echo hi)) true ;;\n  esac\n  cd "${worktreeRoot}"\n)\necho pwn > README.md`,
    ]) {
      assert.equal(
        decideBashCommand({ command, cwd: mainRepoRoot, ownerRoot: mainRepoRoot }).decision,
        'deny',
        `Expected B2/B4 deny on main: ${command}`,
      )
    }

    // From worktree, `a|b) cd "<primary>"` must not treat `|` as a pipeline hiding cd
    assert.equal(
      decideBashCommand({
        command: `case x in\n  a|b) cd "${mainRepoRoot}" ;;\nesac\necho pwn > README.md`,
        cwd: worktreeRoot,
        ownerRoot: mainRepoRoot,
      }).decision,
      'deny',
      'Expected case alternation arm cd <primary> to deny subsequent write',
    )
  })

  it('preserves cDir when GIT_WORK_TREE/--work-tree or GIT_DIR/--git-dir is only partially overridden (B3)', () => {
    for (const command of [
      `GIT_WORK_TREE="${worktreeRoot}" git -C "${mainRepoRoot}" commit --allow-empty -m x`,
      `GIT_WORK_TREE="${worktreeRoot}" git -C "${mainRepoRoot}" merge --no-edit feat`,
      `GIT_WORK_TREE="${worktreeRoot}" git -C "${mainRepoRoot}" rebase feat`,
    ]) {
      assert.equal(
        decideBashCommand({ command, cwd: worktreeRoot, ownerRoot: mainRepoRoot }).decision,
        'deny',
        `Expected B3 deny from worktree: ${command}`,
      )
    }

    for (const command of [
      `git --work-tree="${worktreeRoot}" reset --hard feat`,
      `git --work-tree="${worktreeRoot}" commit --allow-empty -m x`,
      `git --work-tree="${worktreeRoot}" checkout -- README.md`,
    ]) {
      assert.equal(
        decideBashCommand({ command, cwd: mainRepoRoot, ownerRoot: mainRepoRoot }).decision,
        'deny',
        `Expected B3 deny from primary: ${command}`,
      )
    }
  })

  it('closes pushd -n stack target, zsh attached -o/+o, pnpm --shell-mode=true, heredoc in <(...), multiline bash -c, and line-continued pipe brace (B5)', () => {
    for (const command of [
      `zsh -n -oexec -c 'echo pwn > README.md'`,
      `zsh -o noexec +ono_exec -c 'echo pwn > README.md'`,
      `zsh -noexec -c 'echo pwn > README.md'`,
      `pnpm --shell-mode=true exec 'echo pwn > README.md'`,
      `pnpm --shell-mode=1 exec 'echo pwn > README.md'`,
      `bash <(cat <<'EOF'\necho pwn > README.md\nEOF\n)`,
      `bash -c '# comment\necho pwn > README.md'`,
      `echo ok |\n{\n  cd "${worktreeRoot}"\n}\necho pwn > README.md`,
      `true ||\ncd "${worktreeRoot}" && echo pwn > README.md`,
    ]) {
      assert.equal(
        decideBashCommand({ command, cwd: mainRepoRoot, ownerRoot: mainRepoRoot }).decision,
        'deny',
        `Expected B5 deny on main: ${command}`,
      )
    }

    for (const command of [
      `pushd -n "${mainRepoRoot}" && popd && echo pwn > README.md`,
      `pushd -n "${mainRepoRoot}" && pushd && echo pwn > README.md`,
      `pnpm -C "${mainRepoRoot}" --shell-mode=true exec 'echo pwn > README.md'`,
    ]) {
      assert.equal(
        decideBashCommand({ command, cwd: worktreeRoot, ownerRoot: mainRepoRoot }).decision,
        'deny',
        `Expected B5 deny from worktree: ${command}`,
      )
    }

    // pnpm --shell-mode=false exec safe command remains allowed
    assert.equal(
      decideBashCommand({
        command: `pnpm --shell-mode=false exec 'echo ok'`,
        cwd: mainRepoRoot,
        ownerRoot: mainRepoRoot,
      }).decision,
      'allow',
    )
  })

  it('closes multi-char redirections, heredoc quote desync, and ANSI-C quotes in isAtCommandPosition/scanners while staying zero-FP (C1)', () => {
    for (const command of [
      `: >| ! [[ && bash plugins/scripts/sync-to-app.sh && : ]]`,
      `: >| ! [[ && git -C "${mainRepoRoot}" commit --allow-empty -m pwn && : ]]`,
      `: >& time [[ && rm "${mainRepoRoot}/README.md" && : ]]`,
    ]) {
      assert.equal(
        decideBashCommand({ command, cwd: worktreeRoot, ownerRoot: mainRepoRoot }).decision,
        'deny',
        `Expected C1a deny from worktree: ${command}`,
      )
    }

    for (const command of [
      `cd /tmp && : >| ! [[ && echo pwn > "${mainRepoRoot}/README.md" && : ]]`,
      `cat <<EOF\n"\nEOF\n: '" ; # ' \\\n[[ && rm README.md && : ]]`,
      `cat <<EOF\n"\nEOF\n: '" ; # ' \\\n[[ && git commit --allow-empty -m pwn && : ]]`,
      `echo $'\\'' ; rm README.md # '`,
      `rm $'README\\x2emd'`,
      `echo pwn > $'README\\x2emd'`,
      `bash -c $'echo pwn > README.md'`,
    ]) {
      assert.equal(
        decideBashCommand({ command, cwd: mainRepoRoot, ownerRoot: mainRepoRoot }).decision,
        'deny',
        `Expected C1 deny on primary: ${command}`,
      )
    }

    assert.equal(
      decideBashCommand({
        command: `cat <<EOF\n"\nEOF\n: '" ; # ' \\\n[[ && bash plugins/scripts/sync-to-app.sh && : ]]`,
        cwd: worktreeRoot,
        ownerRoot: mainRepoRoot,
      }).decision,
      'deny',
      'Expected C1b heredoc quote desync sync bypass denied from worktree',
    )

    // Zero-FP checks: heredoc with apostrophe followed by real [[ ... ]] comparison, and [[ ... ]] with `|| case == x`
    for (const command of [
      `cat <<'EOF'\nit's fine\nEOF\n[[ "b" > "a" && "c" > "b" ]] && echo ok`,
      `[[ "b" > "a" || case == x ]] && [[ "c" > "b" ]] && echo ok`,
      `echo $'it\\'s ok'`,
    ]) {
      assert.equal(
        decideBashCommand({ command, cwd: mainRepoRoot, ownerRoot: mainRepoRoot }).decision,
        'allow',
        `Expected C1 zero-FP allow on primary: ${command}`,
      )
    }
  })

  it('matches exact pnpm shell-mode CLI semantics and handles double-dash before subcommand (C2)', () => {
    for (const command of [
      `pnpm --shell-mode=0 exec 'echo pwn > README.md'`,
      `pnpm --shell-mode=no exec 'echo pwn > README.md'`,
      `pnpm --shell-mode=off exec 'echo pwn > README.md'`,
      `pnpm --shell-mode= exec 'echo pwn > README.md'`,
      `pnpm --shell-mode=FALSE exec 'echo pwn > README.md'`,
      `pnpm --shell-mode true exec 'echo pwn > README.md'`,
      `pnpm --config.shell-mode=true exec 'echo pwn > README.md'`,
      `pnpm --config.shell-mode exec 'echo pwn > README.md'`,
      `pnpm --config.shell-mode true exec 'echo pwn > README.md'`,
      `pnpm --config.shell-mode=0 exec 'echo pwn > README.md'`,
      `pnpm --config.shell-mode=FALSE exec 'echo pwn > README.md'`,
      `pnpm recursive --shell-mode=0 exec 'echo pwn > README.md'`,
      `pnpm --shell-mode=false -c exec 'echo pwn > README.md'`,
      `pnpm --shell-mode -- exec 'echo pwn > README.md'`,
      `pnpm -- exec rm -f README.md`,
      `pnpm -- run build:all`,
      `pnpm --shell-mode true run build:all`,
    ]) {
      assert.equal(
        decideBashCommand({ command, cwd: mainRepoRoot, ownerRoot: mainRepoRoot }).decision,
        'deny',
        `Expected C2 deny on primary: ${command}`,
      )
    }

    // Exact lowercase false / --no-shell-mode / --no-config.shell-mode disable shell mode
    for (const command of [
      `pnpm --shell-mode=false exec 'echo ok'`,
      `pnpm --shell-mode false exec 'echo ok'`,
      `pnpm --no-shell-mode exec 'echo ok'`,
      `pnpm --config.shell-mode=false exec 'echo ok'`,
      `pnpm --config.shell-mode false exec 'echo ok'`,
      `pnpm --no-config.shell-mode exec 'echo ok'`,
      `pnpm --config.shell-m=true exec 'echo ok'`,
      `pnpm -c --shell-mode=false exec 'echo ok'`,
    ]) {
      assert.equal(
        decideBashCommand({ command, cwd: mainRepoRoot, ownerRoot: mainRepoRoot }).decision,
        'allow',
        `Expected C2 safe allow on primary: ${command}`,
      )
    }
  })

  it('resolves relative env GIT_DIR/GIT_WORK_TREE against git -C and blocks non-main git reset on primary (C3)', () => {
    for (const command of [
      `GIT_DIR=.git GIT_WORK_TREE="${worktreeRoot}" git -C "${mainRepoRoot}" commit --allow-empty -m pwn`,
      `GIT_DIR=.git GIT_WORK_TREE="${worktreeRoot}" git -C "${mainRepoRoot}" merge --no-edit feat`,
      `GIT_DIR=.git GIT_WORK_TREE="${worktreeRoot}" git -C "${mainRepoRoot}" reset --hard feat`,
      `GIT_DIR=.git GIT_WORK_TREE="${worktreeRoot}" git -C "${mainRepoRoot}" reset --merge feat`,
      `GIT_DIR=.git GIT_WORK_TREE="${worktreeRoot}" git -C "${mainRepoRoot}" reset --soft feat`,
    ]) {
      assert.equal(
        decideBashCommand({ command, cwd: worktreeRoot, ownerRoot: mainRepoRoot }).decision,
        'deny',
        `Expected C3 deny from worktree: ${command}`,
      )
    }

    for (const command of [
      `git reset --merge feat`,
      `git reset --soft feat`,
      `git reset --keep feat`,
      `git reset --mixed feat`,
      `git reset feat`,
      `git reset HEAD~1`,
    ]) {
      assert.equal(
        decideBashCommand({ command, cwd: mainRepoRoot, ownerRoot: mainRepoRoot }).decision,
        'deny',
        `Expected C3 non-main reset deny on primary: ${command}`,
      )
    }

    // Safe primary git reset forms (HEAD / path unstage / bare) and worktree-only reset remain allowed
    for (const command of [
      `git reset`,
      `git reset HEAD README.md`,
      `git reset -- README.md`,
      `git reset --hard HEAD`,
    ]) {
      assert.equal(
        decideBashCommand({ command, cwd: mainRepoRoot, ownerRoot: mainRepoRoot }).decision,
        'allow',
        `Expected C3 safe reset allow on primary: ${command}`,
      )
    }
    assert.equal(
      decideBashCommand({
        command: `git reset --soft HEAD~1`,
        cwd: worktreeRoot,
        ownerRoot: mainRepoRoot,
      }).decision,
      'allow',
      'Expected git reset --soft inside worktree to remain allowed',
    )
  })

  it('tracks nested case alternation without splitting as a pipeline (C4)', () => {
    for (const command of [
      `case a in\n  a) case b in b|c) cd "${mainRepoRoot}" ;; esac ;;\nesac\necho pwn > README.md`,
      `case a in\n  a) case b in (b|c) cd "${mainRepoRoot}" ;; esac ;;\nesac\necho pwn > README.md`,
      `case a in a) case b in b|c) cd "${mainRepoRoot}" ;; esac ;; esac\necho pwn > README.md`,
      `case a in a) case b in\n  b|c) cd "${mainRepoRoot}" ;;\nesac ;;\nesac\necho pwn > README.md`,
    ]) {
      assert.equal(
        decideBashCommand({ command, cwd: worktreeRoot, ownerRoot: mainRepoRoot }).decision,
        'deny',
        `Expected C4 nested case deny from worktree: ${command}`,
      )
    }

    // Zero-FP: nested case with [[ ... ]] comparison inside pattern arm on primary
    assert.equal(
      decideBashCommand({
        command: `case a in\n  a) [[ "b" > "a" ]] && echo ok ;;\nesac`,
        cwd: mainRepoRoot,
        ownerRoot: mainRepoRoot,
      }).decision,
      'allow',
    )
  })

  it('implements circular pushd/popd +/-N stack rotation, subshell dirStack isolation, and dynamic arg fail-closed (C5)', () => {
    for (const command of [
      `pushd -n "${mainRepoRoot}" && pushd -n "/tmp" && pushd +2 && echo pwn > README.md`,
      `pushd -n "${mainRepoRoot}" && pushd -n "/tmp" && pushd -0 && echo pwn > README.md`,
      `pushd -n "${mainRepoRoot}" && pushd -n && popd && echo pwn > README.md`,
      `pushd -n "${mainRepoRoot}" && pushd -n "/tmp" && n=2 && pushd "+$n" && echo pwn > README.md`,
      `pushd -n "${mainRepoRoot}" && pushd -n "/tmp" && popd +1 && popd && echo pwn > README.md`,
    ]) {
      assert.equal(
        decideBashCommand({ command, cwd: worktreeRoot, ownerRoot: mainRepoRoot }).decision,
        'deny',
        `Expected C5 pushd/popd deny from worktree: ${command}`,
      )
    }

    for (const command of [
      `pushd "${worktreeRoot}" && pushd -n "/tmp" && pushd -0 && echo pwn > README.md`,
      `pushd "${worktreeRoot}" && ( pushd -n "/tmp" ) && popd && echo pwn > README.md`,
      `pushd "${worktreeRoot}" && pushd -n "/tmp" && popd -n && popd && echo pwn > README.md`,
    ]) {
      assert.equal(
        decideBashCommand({ command, cwd: mainRepoRoot, ownerRoot: mainRepoRoot }).decision,
        'deny',
        `Expected C5 pushd/popd deny from primary: ${command}`,
      )
    }

    // Legitimate pushd into worktree without rotating back to primary stays allowed
    assert.equal(
      decideBashCommand({
        command: `pushd "${worktreeRoot}" && pushd -n "/tmp" && echo ok > "${worktreeRoot}/.tmp-pushd-ok"`,
        cwd: mainRepoRoot,
        ownerRoot: mainRepoRoot,
      }).decision,
      'allow',
    )
  })

  it('unwraps command-executing prefixes (eval/time/sudo/nice/timeout/stdbuf/setsid/xargs) and find -exec payloads (C6)', () => {
    const evalScript = `cd "${mainRepoRoot}"; echo pwn > README.md`
    const bashScript = `cd ${mainRepoRoot}; echo pwn > README.md`

    for (const command of [
      `eval "${evalScript}"`,
      `eval '${evalScript}'`,
      `builtin eval "${evalScript}"`,
      `command eval "${evalScript}"`,
      `time bash -c '${bashScript}'`,
      `time -p bash -c '${bashScript}'`,
      `sudo -n bash -c '${bashScript}'`,
      `nice -n 5 bash -c '${bashScript}'`,
      `nice -5 bash -c '${bashScript}'`,
      `timeout -s KILL 5 bash -c '${bashScript}'`,
      `stdbuf -o0 bash -c '${bashScript}'`,
      `setsid bash -c '${bashScript}'`,
      `echo x | xargs -I{} bash -c '${bashScript}'`,
      `find . -maxdepth 1 -name README.md -exec bash -c '${bashScript}' {} +`,
      `node -e "require('child_process').execSync('${evalScript}')"`,
      `node -e "require('child_process').spawnSync('rm', ['-rf', '${mainRepoRoot}/package.json'])"`,
      `python3 -c "import os; os.system('${evalScript}')"`,
      `python3 -c "import subprocess; subprocess.run(['rm', '-rf', '${mainRepoRoot}/package.json'])"`,
      `perl -e 'system("rm -rf ${mainRepoRoot}/package.json")'`,
    ]) {
      assert.equal(
        decideBashCommand({ command, cwd: worktreeRoot, ownerRoot: mainRepoRoot }).decision,
        'deny',
        `Expected C6 deny from worktree: ${command}`,
      )
    }

    for (const command of [
      `eval "echo pwn > ${mainRepoRoot}/README.md"`,
      `time bash -c 'echo pwn > ${mainRepoRoot}/README.md'`,
      `nice -n 5 bash -c 'echo pwn > ${mainRepoRoot}/README.md'`,
      `timeout 5 bash -c 'echo pwn > ${mainRepoRoot}/README.md'`,
      `stdbuf -oL bash -c 'echo pwn > ${mainRepoRoot}/README.md'`,
      `find ${mainRepoRoot} -maxdepth 1 -name README.md -exec rm {} +`,
      `echo README.md | xargs rm -f`,
    ]) {
      assert.equal(
        decideBashCommand({ command, cwd: mainRepoRoot, ownerRoot: mainRepoRoot }).decision,
        'deny',
        `Expected C6 deny on primary: ${command}`,
      )
    }

    // Zero-FP: wrappers around read-only/legit commands keep working
    for (const command of [
      `eval "echo ok"`,
      `time npm run build`,
      `time -p pnpm test`,
      `nice -n 10 node script.mjs`,
      `timeout 30 node --test x.mjs`,
      `stdbuf -oL grep foo bar.txt`,
      `setsid node daemon.mjs`,
      `echo hi | xargs -n1 echo`,
      `find . -name "*.md" -exec cat {} +`,
      `find src -name "*.ts" -exec sed -n 1,5p {} +`,
      `node -e "console.log(1+1)"`,
      `python3 -c "print(1+1)"`,
    ]) {
      assert.equal(
        decideBashCommand({ command, cwd: worktreeRoot, ownerRoot: mainRepoRoot }).decision,
        'allow',
        `Expected C6 zero-FP allow: ${command}`,
      )
    }

    assert.equal(
      decideWrite({ filePath: join(mainRepoRoot, 'package.json'), cwd: worktreeRoot, toolName: 'write' }).decision,
      'deny',
    )
  })

  it('matches pnpm nopt prefix/negation semantics and heredoc delimiters with # or $"..." (D1/D2)', () => {
    const primaryFile = join(mainRepoRoot, 'package.json')
    for (const command of [
      `pnpm --shell-m exec 'echo pwn > ${primaryFile}'`,
      `pnpm --shell-mod exec 'echo pwn > ${primaryFile}'`,
      `pnpm --shell exec 'echo pwn > ${primaryFile}'`,
      `pnpm --no-shell-mode=false exec 'echo pwn > ${primaryFile}'`,
      `pnpm --no-config.shell-mode=false exec 'echo pwn > ${primaryFile}'`,
      `pnpm --config.shell-mode=0 exec 'echo pwn > ${primaryFile}'`,
      `cat <<A#B\nbody\nA#B\necho pwn > package.json`,
      `cat <<-A#B\n\tbody\n\tA#B\necho pwn > package.json`,
      `cat <<$"EOF"\nbody\nEOF\necho pwn > package.json`,
      `cat <<$'EOF'\nbody\nEOF\necho pwn > package.json`,
      `cat <<EOF # trailing note\nbody\nEOF\necho pwn > package.json`,
    ]) {
      assert.equal(
        decideBashCommand({ command, cwd: mainRepoRoot, ownerRoot: mainRepoRoot }).decision,
        'deny',
        `Expected D1/D2 deny on primary: ${command}`,
      )
    }

    for (const command of [
      `pnpm --shell-mode=false exec 'echo ok'`,
      `pnpm --shell-mode false exec 'echo ok'`,
      `pnpm --no-shell-mode exec 'echo ok'`,
      `pnpm --config.shell-mode=false exec 'echo ok'`,
      `pnpm --no-config.shell-mode exec 'echo ok'`,
      `pnpm exec eslint src`,
      `cat <<'A#B'\nit's fine\nA#B\n[[ "b" > "a" ]] && echo ok`,
      `cat <<EOF # trailing note\nbody\nEOF\n[[ "b" > "a" ]] && echo ok`,
      `cat <<A#B\nbody\nA#B\necho ok`,
    ]) {
      assert.equal(
        decideBashCommand({ command, cwd: mainRepoRoot, ownerRoot: mainRepoRoot }).decision,
        'allow',
        `Expected D1/D2 zero-FP allow: ${command}`,
      )
    }
  })

  it('replays function-call cwd effects and blocks primary commits after a branch switch (D3/D4)', () => {
    for (const command of [
      `f() { cd "${mainRepoRoot}"; }; cd /tmp; f; echo pwn > package.json`,
      `f() {\n  cd "${mainRepoRoot}"\n}\ncd /tmp\nf\necho pwn > package.json`,
      `f() { pushd "${mainRepoRoot}" >/dev/null; }; cd /tmp && f && echo pwn > package.json`,
    ]) {
      assert.equal(
        decideBashCommand({ command, cwd: mainRepoRoot, ownerRoot: mainRepoRoot }).decision,
        'deny',
        `Expected D3 deny on primary: ${command}`,
      )
      assert.equal(
        decideBashCommand({ command, cwd: worktreeRoot, ownerRoot: mainRepoRoot }).decision,
        'deny',
        `Expected D3 deny from worktree: ${command}`,
      )
    }

    for (const command of [
      `f() { echo hi; }; cd /tmp; f; echo ok`,
      `f() { cd /tmp; }; f; echo ok`,
    ]) {
      assert.equal(
        decideBashCommand({ command, cwd: mainRepoRoot, ownerRoot: mainRepoRoot }).decision,
        'allow',
        `Expected D3 zero-FP allow: ${command}`,
      )
    }

    // `git checkout -b x` on the primary must not re-enable commits there.
    gitCommand(mainRepoRoot, 'checkout', '-b', 'guard-d4-probe')
    try {
      for (const command of [
        `git -C "${mainRepoRoot}" commit --allow-empty -m pwn`,
        `git -C "${mainRepoRoot}" merge --no-edit origin/main~0`,
      ]) {
        const result = decideBashCommand({ command, cwd: worktreeRoot, ownerRoot: mainRepoRoot })
        assert.equal(result.decision, 'deny', `Expected D4 deny: ${command}`)
      }
      assert.equal(
        decideBashCommand({ command: 'git commit -m x', cwd: worktreeRoot, ownerRoot: mainRepoRoot }).decision,
        'allow',
      )
    } finally {
      gitCommand(mainRepoRoot, 'checkout', 'main')
      gitCommand(mainRepoRoot, 'branch', '-D', 'guard-d4-probe')
    }
  })
})
