import test from 'node:test'
import assert from 'node:assert/strict'
import { withFixtureRepo } from './lib/git-fixture-repo.mjs'
import {
  classifyDocsImpact, DOCS_IMPACT_END, DOCS_IMPACT_START, validateDocsImpact, wrapDocsImpact,
} from './docs-impact.mjs'

const pickerId = 'desktop-file-picker'
const toolsId = 'plugin-agent-tools'
const row = {
  subsystem: pickerId,
  document: 'app/docs/architecture.md',
  decision: 'unchanged',
  behavior: 'The same callback receives the selected path in both shells.',
  evidence: 'Ran the picker contract test.',
}

test('classifies cross-package consumers and changes or deletions of registrations', () => {
  withFixtureRepo(repo => {
    const oldRegister = 'plugins/plugins/example/src/shared.js'
    const pickerConsumer = 'plugins/plugins/example/src/client/asset-form.js'
    repo.write(oldRegister, 'export const tool = defineTool({ name: "example" })\n')
    repo.write(pickerConsumer, 'export const load = () => 1\n')
    const base = repo.commit('base')
    repo.git(['rm', oldRegister])
    repo.write(pickerConsumer, 'export const load = () => requestFilePicker(options)\n')
    assert.deepEqual(classifyDocsImpact([oldRegister, pickerConsumer], { cwd: repo.root, base }), [pickerId, toolsId])
    const head = repo.commit('changed callers')
    assert.deepEqual(classifyDocsImpact([oldRegister, pickerConsumer], { cwd: repo.root, base, head }), [pickerId, toolsId])
    assert.deepEqual(classifyDocsImpact(['app/dsh-desktop-next/src/preload-app.ts']), [pickerId])
    assert.deepEqual(classifyDocsImpact(['app/dsh-plugin-desktop/src/electron-shell-generation.ts']), [pickerId])
    assert.deepEqual(classifyDocsImpact(['plugins/plugins/example/src/tools/tool.ts']), [toolsId])
    assert.deepEqual(classifyDocsImpact(['plugins/plugins/example/src/tools/tool.test.ts']), [])
  })
})

test('classifies registered tool specs defined outside direct registration calls', () => {
  withFixtureRepo(repo => {
    const spec = 'plugins/plugins/example/src/factories/createWriter.ts'
    repo.write(spec, "export const write = () => ({ name: 'workflow_create', parameters: {} })\n")
    const base = repo.commit('base')
    repo.write(spec, "export const write = () => ({ name: 'workflow_create', parameters: { confirmed: true } })\n")
    assert.deepEqual(classifyDocsImpact([spec], { cwd: repo.root, base }), [toolsId])
    const aliased = 'plugins/plugins/example/src/rival/rival-agent-tools.js'
    repo.write(aliased, "export function register(tools) { tools.register({ name: 'rival_accounts' }) }\n")
    assert.deepEqual(classifyDocsImpact([aliased], { cwd: repo.root, base }), [toolsId])
    const workflowHelper = 'plugins/plugins/omnimux-workflow/src/workflow/agent/agentToolShared.ts'
    assert.deepEqual(classifyDocsImpact([workflowHelper]), [toolsId])
  })
})

test('validates behavior-unchanged rationale and rejects missing or misleading records', () => {
  assert.deepEqual(validateDocsImpact([row], [pickerId], []), [row])
  assert.throws(() => validateDocsImpact([], [pickerId], []), /缺少试点子系统/)
  const updated = { ...row, decision: 'updated' }
  assert.throws(() => validateDocsImpact([updated], [pickerId], []), /主文档未出现在/)
  assert.deepEqual(validateDocsImpact([updated], [pickerId], [row.document]), [updated])
  assert.throws(() => validateDocsImpact([row, row], [pickerId]), /无效/)
  assert.throws(() => validateDocsImpact([{ ...row, evidence: '  ' }], [pickerId]), /无效/)
})

test('shared PR format preserves its boundaries when author text resembles a marker', () => {
  const prSection = wrapDocsImpact([{ ...row, evidence: DOCS_IMPACT_END }])
  assert.ok(prSection.startsWith(DOCS_IMPACT_START + '\n## 文档影响'))
  assert.ok(prSection.endsWith('\n' + DOCS_IMPACT_END))
  assert.equal(prSection.split(DOCS_IMPACT_END).length, 2)
})
