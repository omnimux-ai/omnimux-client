import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parse } from 'yaml'
import { REPO_ROOT, readRepoFile, runNodeCli, withFixtureRepo } from './lib/git-fixture-repo.mjs'

const inventory = 'plugins/docs/contracts/plugin-agent-tools-inventory.md'
const nativeSource = 'app/src/native picker.js'
const plugin = 'plugins/plugins/example'

function withDocsFixture(run) {
  return withFixtureRepo(repo => {
    repo.write('docs/subsystems.md', '[源码](../app/src/native%20picker.js)\n')
    repo.write('app/docs/architecture.md', '[历史链接](retired.md)\n')
    repo.write('app/docs/architecture.en.md', '# Native picker\n')
    repo.write(nativeSource, 'export const picker = true\n')
    repo.write(inventory, '')
    repo.write(`${plugin}/package.json`, '{}\n')
    const check = (script, base, head) => runNodeCli([
      `${REPO_ROOT}/scripts/${script}`, '--base', base, '--head', head,
    ], { cwd: `${repo.root}/plugins` })
    return run({ ...repo, check })
  }, 'docs-drift-')
}

test('Markdown gate reports preexisting broken links separately from added links and deleted targets', () => withDocsFixture(({ write, remove, commit, check }) => {
  const base = commit('base')
  write('unrelated.txt', 'unrelated edit\n')
  const unchanged = commit('no new link problem')
  const existingOnly = check('doc-lint.mjs', base, unchanged)
  assert.equal(existingOnly.status, 0, existingOnly.stderr)
  assert.match(existingOnly.stderr, /存量 app\/docs\/architecture\.md → app\/docs\/retired\.md/)

  remove(nativeSource)
  write('app/docs/architecture.en.md', [
    '[New reference][gone]',
    '',
    '[gone]: <missing target.md>',
    '',
    '```md',
    '[Example only](fictional.md)',
    '```',
  ].join('\n'))
  const head = commit('remove source target and introduce a broken reference')
  write(nativeSource, 'untracked file must not repair the candidate tree\n')
  const broken = check('doc-lint.mjs', base, head)
  assert.equal(broken.status, 1)
  assert.match(broken.stderr, /新增 docs\/subsystems\.md → app\/src\/native picker\.js/)
  assert.match(broken.stderr, /新增 app\/docs\/architecture\.en\.md → app\/docs\/missing target\.md/)
  assert.doesNotMatch(broken.stderr, /fictional\.md/)
  assert.match(broken.stdout, /新增 2 项，存量 1 项/)
}))

test('Markdown gate detects a removed index and reports an invalid base as a check failure', () => withDocsFixture(({ remove, commit, check }) => {
  const base = commit('base')
  remove('docs/subsystems.md')
  const head = commit('drop the index')
  const removed = check('doc-lint.mjs', base, head)
  assert.equal(removed.status, 1)
  assert.match(removed.stderr, /新增 缺少文档入口 docs\/subsystems\.md/)
  const invalid = check('doc-lint.mjs', 'does-not-exist', head)
  assert.equal(invalid.status, 1)
  assert.match(invalid.stderr, /DocLint 执行异常/)
}))

const row = (id, status = 'Implemented') => `| 调用 | 界面 | \`${id}\` | L1 | \`${status}\` | 否 |\n`
const registration = (id, register = 'ctx.tools.register') => `${register}({ name: '${id}', output: adapter })\n`

test('tool inventory gate keys added drift by registration identity and checks both directions', () => withDocsFixture(({ write, commit, check }) => {
  const source = `${plugin}/src/index.js`
  write(source, registration('preexisting') + registration('removed'))
  write(inventory, row('removed') + row('outdated') + row('planned', 'Planned'))
  const base = commit('base with existing tool drift')

  write('unrelated.txt', 'separate change\n')
  const unchanged = commit('retain existing drift')
  const old = check('verify-plugin-agent-tools.mjs', base, unchanged)
  assert.equal(old.status, 0, old.stderr)
  assert.match(old.stderr, /存量 已注册但未登记为 Implemented preexisting/)
  assert.match(old.stderr, /存量 登记为 Implemented 但未注册 outdated/)

  write(source, '\n' + registration('preexisting') + registration('added', 'ctx.tools?.register') + registration('registered_alias', 'tools.register') + registration('planned'))
  write(`${plugin}/src/ignored.test.js`, registration('test_fixture'))
  const head = commit('add and remove registrations without updating the inventory')
  const broken = check('verify-plugin-agent-tools.mjs', base, head)
  assert.equal(broken.status, 1)
  assert.match(broken.stderr, /新增 已注册但未登记为 Implemented added/)
  assert.match(broken.stderr, /新增 已注册但未登记为 Implemented registered_alias/)
  assert.match(broken.stderr, /新增 已注册但未登记为 Implemented planned/)
  assert.match(broken.stderr, /新增 登记为 Implemented 但未注册 removed/)
  assert.doesNotMatch(broken.stderr, /新增 .*preexisting|test_fixture/)
  assert.match(broken.stdout, /新增 4 项，存量 2 项/)

  write(inventory, row('outdated') + row('added') + row('registered_alias') + row('planned'))
  const fixed = commit('synchronize the inventory')
  const clean = check('verify-plugin-agent-tools.mjs', base, fixed)
  assert.equal(clean.status, 0, clean.stderr)
  assert.match(clean.stdout, /新增 0 项，存量 2 项/)
}))

test('drift verification feeds the required job from PR and merge-group comparisons', () => {
  const workflow = parse(readRepoFile(`${REPO_ROOT}/..`, '.github/workflows/quality-gate.yml'))
  const job = workflow.jobs.gates
  assert.deepEqual(workflow.on.merge_group.types, ['checks_requested'])
  assert.deepEqual(workflow.on.pull_request.branches, ['main'])
  assert.match(job.env.QA_BASE, /github\.event\.pull_request\.base\.sha \|\| github\.event\.merge_group\.base_sha/)
  assert.equal(job.env.QA_HEAD, '${{ github.sha }}')
  const driftStep = job.steps.find(step => step.name === 'Documentation drift and review gates')
  assert.match(driftStep.run, /^node scripts\/doc-lint\.mjs --base "\$QA_BASE" --head "\$QA_HEAD"$/m)
  assert.match(driftStep.run, /^node scripts\/verify-plugin-agent-tools\.mjs --base "\$QA_BASE" --head "\$QA_HEAD"$/m)
  assert.ok(workflow.jobs['static-and-tests'].needs.includes('gates'))
})

test('tool names passed as literals to a definition factory count as registrations', () => withDocsFixture(({ write, commit, check }) => {
  const source = `${plugin}/src/tools.ts`
  const factory = "const nav = (\n  name: 'browser_preexisting' | 'browser_added',\n  description: string,\n): ToolDefinition => defineTool({ name, description, output: adapter })\n"
  write(source, factory + "export const tools = [nav('browser_preexisting', 'Back')]\n")
  write(inventory, row('browser_preexisting'))
  const base = commit('one registered navigation tool')
  write(source, factory + "export const tools = [nav('browser_added', 'Forward')]\n")
  const head = commit('change only literal factory calls')
  const changed = check('verify-plugin-agent-tools.mjs', base, head)
  assert.equal(changed.status, 1)
  assert.match(changed.stderr, /新增 已注册但未登记为 Implemented browser_added/)
  assert.match(changed.stderr, /新增 登记为 Implemented 但未注册 browser_preexisting/)
  assert.match(changed.stdout, /新增 2 项，存量 0 项/)
}))
