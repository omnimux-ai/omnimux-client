import { test } from 'node:test'
import { strictEqual, ok } from 'node:assert'
import { spawnSync } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gitBlobHash } from './verify-bilingual-docs.mjs'
import { checkSourceFileBoundaries } from './verify-plugin-boundaries.mjs'
import { walkAgentNoteTree } from './lib/agent-note-tree.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')

const nestedTestEnv = { ...process.env, ELECTRON_NO_ASAR: '1' }
delete nestedTestEnv.NODE_TEST_CONTEXT

test('gitBlobHash computes accurate SHA-1 blob hashes', () => {
  const content = Buffer.from('# Test Document\n')
  const hash = gitBlobHash(content)
  strictEqual(typeof hash, 'string')
  strictEqual(hash.length, 40)
})

test('walkAgentNoteTree discovers valid agent notes and checks structure', () => {
  const { notes, errors } = walkAgentNoteTree(repoRoot)
  strictEqual(errors.length, 0, `walk errors: ${errors.join(', ')}`)
  ok(notes.length >= 1, 'should find at least 1 agent note')
  const note = notes[0]
  strictEqual(note.lifecycle, 'implemented')
  strictEqual(note.class, 'architecture')
})

test('verify-agent-note-format runs successfully on codebase', () => {
  const res = spawnSync('node', [resolve(here, 'verify-agent-note-format.mjs')], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  strictEqual(res.status, 0, `format script failed: ${res.stderr}`)
})

test('verify-bilingual-docs passes on codebase', () => {
  const res = spawnSync('node', [resolve(here, 'verify-bilingual-docs.mjs')], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  strictEqual(res.status, 0, `bilingual pairing failed: ${res.stderr}`)
})

test('verify-archived-agent-notes passes on codebase', () => {
  const res = spawnSync('node', [resolve(here, 'verify-archived-agent-notes.mjs')], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  strictEqual(res.status, 0, `archived verification failed: ${res.stderr}`)
})

test('verify-plugin-boundaries passes on codebase', () => {
  const res = spawnSync('node', [resolve(here, 'verify-plugin-boundaries.mjs')], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  strictEqual(res.status, 0, `boundary verification failed: ${res.stderr}`)
})

test('verify-plugin-boundaries blocks non-Hub direct ctx.llm and llm.stream calls', () => {
  const directStream = checkSourceFileBoundaries({
    rel: 'plugins/omnimux-inspiration/src/private-ai.js',
    plugin: 'omnimux-inspiration',
    content: 'export async function run(ctx) { return ctx.llm.stream({ model: "x" }) }',
  })
  ok(directStream.some((msg) => msg.includes('headless-skill-execution.md')))

  const directGet = checkSourceFileBoundaries({
    rel: 'plugins/omnimux-products/src/private-ai.js',
    plugin: 'omnimux-products',
    content: "export function run(ctx) { const llm = ctx.get('llm'); return llm.listModels() }",
  })
  ok(directGet.some((msg) => msg.includes('headless-skill-execution.md')))

  const hubAllowed = checkSourceFileBoundaries({
    rel: 'plugins/omnimux/src/text/execute.js',
    plugin: 'omnimux',
    content: "export function run(ctx) { const llm = ctx.get('llm'); return llm.stream({}) }",
  })
  strictEqual(hubAllowed.length, 0)

  const allowlistedReadOnly = checkSourceFileBoundaries({
    rel: 'plugins/omnimux-browser/src/text-session-model.ts',
    plugin: 'omnimux-browser',
    content: "export async function bind(ctx) { const llm = ctx.get('llm'); return llm.listModels() }",
  })
  strictEqual(allowlistedReadOnly.length, 0)

  const allowlistedStreamBlocked = checkSourceFileBoundaries({
    rel: 'plugins/omnimux-browser/src/text-session-model.ts',
    plugin: 'omnimux-browser',
    content: "export async function bind(ctx) { const llm = ctx.get('llm'); return llm.stream({}) }",
  })
  ok(allowlistedStreamBlocked.some((msg) => msg.includes('llm.stream')))

  const commentOnlyAllowed = checkSourceFileBoundaries({
    rel: 'plugins/omnimux-inspiration/src/notes.js',
    plugin: 'omnimux-inspiration',
    content: '// Hub textComplete delegates to ctx.llm.stream internally\nexport const ok = true\n',
  })
  strictEqual(commentOnlyAllowed.length, 0)

  // 5. A registry-read tool definition must not be executed in place.
  for (const content of [
    'export function run(ctx) { return ctx.tools.get("omnimux_page_fetch").execute({ url }) }',
    'export async function run(ctx) { const tool = ctx.tools.get?.("omnimux_accounts_list")\n return tool.execute({ provider: "tiktok_direct" }) }',
    'export function run(tools) { const t = tools.executable("x")\n return t.execute({}) }',
    // dynamic lookup name
    'export function run(ctx, name) { return ctx.tools.get(name).execute({}) }',
    // newline between assignment and invocation
    'export async function run(ctx) { const tool =\n  ctx.tools.get("x")\n return tool.execute({}) }',
    // optional call on both lookup and execute
    'export function run(ctx) { return ctx.tools.get("x")?.execute?.({}) }',
    // destructured execution body
    'export async function run(ctx) { const { execute } = ctx.tools.get("x")\n return execute({}) }',
    'export async function run(ctx) { const { execute: runIt } = ctx.tools.get("x")\n return runIt({}) }',
    // legacy tools seat and multi-argument executable lookup
    'export function run(ctx) { return ctx.get("tools").get("x").execute({}) }',
    'export function run(ctx, scope, toolSet) { return ctx.tools.executable("x", scope, toolSet).execute({}) }',
  ]) {
    const blocked = checkSourceFileBoundaries({
      rel: 'plugins/omnimux-accounts/src/private-tools.js',
      plugin: 'omnimux-accounts',
      content,
    })
    ok(blocked.some((msg) => msg.includes('tool dispatch boundary violation')), content)
  }

  const dispatchAllowed = checkSourceFileBoundaries({
    rel: 'plugins/omnimux-publish/src/hubtools.js',
    plugin: 'omnimux-publish',
    content: 'export async function run(tools) { const tool = tools.get("omnimux_publish_get")\n return tools.execute({ calls: [] }) }',
  })
  strictEqual(dispatchAllowed.length, 0)

  // An unrelated helper object whose name merely ends in "Tools" must not be
  // mistaken for the DSH tool registry.
  const unrelatedAllowed = checkSourceFileBoundaries({
    rel: 'plugins/omnimux-accounts/src/private-tools.js',
    plugin: 'omnimux-accounts',
    content: 'export function run(myTools) { const t = myTools.get("x")\n return t.execute({}) }',
  })
  strictEqual(unrelatedAllowed.length, 0)

  const hubToolReadAllowed = checkSourceFileBoundaries({
    rel: 'plugins/omnimux/src/host/apply.js',
    plugin: 'omnimux',
    content: 'export function run(ctx) { return ctx.tools.get("omnimux_page_fetch").execute({ url }) }',
  })
  strictEqual(hubToolReadAllowed.length, 0)
})

test('verify-stage-contracts passes on all first-level Stage and StageStore files', () => {
  const res = spawnSync('node', [resolve(here, 'verify-stage-contracts.mjs')], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  strictEqual(res.status, 0, `stage contract verification failed: ${res.stderr}`)
})

test('verify-slot-contracts passes static scan on all plugin client files', () => {
  const res = spawnSync('node', [resolve(here, 'verify-slot-contracts.mjs')], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  strictEqual(res.status, 0, `slot contract verification failed: ${res.stderr}\n${res.stdout}`)
})

test('slot-contracts unit tests pass', () => {
  const res = spawnSync('node', ['--test', resolve(here, 'verify-slot-contracts.test.mjs')], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: nestedTestEnv,
  })
  strictEqual(res.status, 0, `slot-contracts unit tests failed: ${res.stderr}\n${res.stdout}`)
})

test('asar integrity engine and presets patcher unit tests pass', () => {
  const res = spawnSync('node', ['--test', resolve(here, 'patch-asar-agent-presets.test.mjs')], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: nestedTestEnv,
  })
  strictEqual(res.status, 0, `asar integrity tests failed: ${res.stderr}\n${res.stdout}`)
})

test('smoke probe utils and cold-start verifier unit tests pass', () => {
  const res = spawnSync('node', ['--test', resolve(here, 'verify-dev-smoke.test.mjs')], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: nestedTestEnv,
  })
  strictEqual(res.status, 0, `smoke probe tests failed: ${res.stderr}\n${res.stdout}`)
})

test('verify-plugin-agent-tools passes 4-dimension audit on all 12 plugins', () => {
  const res = spawnSync('node', [resolve(here, 'verify-plugin-agent-tools.mjs')], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  strictEqual(res.status, 0, `agent tools verification failed: ${res.stderr}\n${res.stdout}`)
})

test('guard-worktree PreToolUse contract and unit tests pass', () => {
  const res = spawnSync('node', ['--test', resolve(here, 'guard-worktree.test.mjs')], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: nestedTestEnv,
  })
  strictEqual(res.status, 0, `guard-worktree tests failed: ${res.stderr}\n${res.stdout}`)
})

test('simulate-multi-agent-lifecycle incident tests pass', () => {
  const res = spawnSync('node', ['--test', resolve(here, 'simulate-multi-agent-lifecycle.test.mjs')], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: nestedTestEnv,
  })
  strictEqual(res.status, 0, `lifecycle simulation failed: ${res.stderr}\n${res.stdout}`)
})

test('agent presets splice and persona routing stay valid', () => {
  const res = spawnSync('node', ['--test', resolve(here, 'verify-agent-presets.test.mjs')], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: nestedTestEnv,
  })
  strictEqual(res.status, 0, `agent-presets verification failed: ${res.stderr}\n${res.stdout}`)
})

test('git-wt finish never locally merges or force-pushes main', () => {
  const res = spawnSync('node', ['--test', resolve(here, 'git-wt.test.mjs')], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: nestedTestEnv,
  })
  strictEqual(res.status, 0, `git-wt tests failed: ${res.stderr}\n${res.stdout}`)
})

test('verify-package-files passes on all plugins', () => {
  const res = spawnSync('node', [resolve(here, 'verify-package-files.mjs')], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  strictEqual(res.status, 0, `package-files verification failed: ${res.stderr}\n${res.stdout}`)
})

test('verify-package-files unit tests pass', () => {
  const res = spawnSync('node', ['--test', resolve(here, 'verify-package-files.test.mjs')], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: nestedTestEnv,
  })
  strictEqual(res.status, 0, `package-files unit tests failed: ${res.stderr}\n${res.stdout}`)
})

test('static CI and post-merge Dev handoff regressions pass', () => {
  const res = spawnSync('node', ['--test', resolve(here, 'auto-pipeline.test.mjs'), resolve(here, 'auto-pipeline-qa.test.mjs')], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: nestedTestEnv,
  })
  strictEqual(res.status, 0, `pipeline handoff tests failed: ${res.stderr}\n${res.stdout}`)
})

test('sync source identity, profile resolution and named-plugin scope regressions pass', () => {
  const res = spawnSync('node', ['--test', ...['sync-bypass.test.mjs', 'resolve-omnimux-profile.test.mjs', 'sync-plugin-scope.test.mjs'].map(name => resolve(here, name))], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: nestedTestEnv,
  })
  strictEqual(res.status, 0, `sync identity and scope tests failed: ${res.stderr}\n${res.stdout}`)
})

test('sync-to-app and sync-stable target selection matrix passes', () => {
  const res = spawnSync('node', ['--test', resolve(here, 'sync-targets.test.mjs')], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: nestedTestEnv,
  })
  strictEqual(res.status, 0, `sync-targets tests failed: ${res.stderr}\n${res.stdout}`)
})

test('Alpha release materialization policy passes', () => {
  const res = spawnSync('node', ['--test', resolve(here, 'sync-release-policy.test.mjs')], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: nestedTestEnv,
  })
  strictEqual(res.status, 0, `Alpha release policy tests failed: ${res.stderr}\n${res.stdout}`)
})

test('sync-to-app merged source identity policy passes', () => {
  const res = spawnSync('node', ['--test', resolve(here, 'sync-source-identity.test.mjs')], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: nestedTestEnv,
  })
  strictEqual(res.status, 0, `sync-source-identity tests failed: ${res.stderr}\n${res.stdout}`)
})

test('legacy path cleanup regression suite passes', () => {
  const res = spawnSync('node', ['--test', resolve(here, 'legacy-paths-242.test.mjs')], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: nestedTestEnv,
  })
  strictEqual(res.status, 0, `legacy-path cleanup tests failed: ${res.stderr}\n${res.stdout}`)
})
