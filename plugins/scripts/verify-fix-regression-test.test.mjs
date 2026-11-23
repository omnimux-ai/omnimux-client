import { test } from 'node:test'
import assert from 'node:assert/strict'
import { withFixtureRepo, runNodeCli, readRepoFile, REPO_ROOT } from './lib/git-fixture-repo.mjs'
import {
  NO_REGRESSION_TEST_SECTION,
  NO_REGRESSION_TEST_TRAILER,
  hasMeaningfulAddedCode,
  isFixLabel,
  isFixSubject,
  isProductCodePath,
  isTestFilePath,
  resolveCliOptions,
  verifyFixRegressionTest,
} from './verify-fix-regression-test.mjs'

const PROD_FILE = 'plugins/plugins/omnimux/src/host/demo.js'
const TEST_FILE = 'plugins/plugins/omnimux/src/host/demo.test.js'
const SPEC_FILE = 'specs/fix-demo.spec.md'
const CLI_PATH = `${REPO_ROOT}/scripts/verify-fix-regression-test.mjs`

test('路径与标题分类覆盖产品源码、测试、构建产物与标签', () => {
  assert.equal(isFixSubject('fix(canvas): prevent stale slot state'), true)
  assert.equal(isFixSubject('fix!: handle null payload'), true)
  assert.equal(isFixSubject('bugfix: clamp zero duration'), true)
  assert.equal(isFixSubject('feat(canvas): add slot preview'), false)
  assert.equal(isFixSubject('docs: fix typo in readme'), false)

  assert.equal(isFixLabel('bug'), true)
  assert.equal(isFixLabel('regression'), true)
  assert.equal(isFixLabel('enhancement'), false)

  assert.equal(isProductCodePath(PROD_FILE), true)
  assert.equal(isProductCodePath('app/dsh-desktop-next/src/main.ts'), true)
  assert.equal(isProductCodePath('app/dsh-community-market/src/index.ts'), true)
  assert.equal(isProductCodePath('app/dsh-desktop-next/scripts/build.mjs'), true)
  assert.equal(isProductCodePath('plugins/plugins/omnimux-forms/scripts/build-client.mjs'), true)
  assert.equal(isProductCodePath('plugins/scripts/verify-fix-regression-test.mjs'), true)
  assert.equal(isProductCodePath('plugins/scripts/auto-qa-gate.mjs'), true)
  assert.equal(isProductCodePath('plugins/plugins/omnimux/lib/client.js'), false)
  assert.equal(isProductCodePath('docs/subsystems.md'), false)
  assert.equal(isProductCodePath(TEST_FILE), false)

  assert.equal(isTestFilePath(TEST_FILE), true)
  assert.equal(isTestFilePath('plugins/plugins/omnimux-publish/src/contracts.type-test.ts'), true)
  assert.equal(isProductCodePath('plugins/plugins/omnimux-publish/src/contracts.type-test.ts'), false)
  assert.equal(isTestFilePath('app/scripts/verify-desktop-acceptance.test.mjs'), true)
  assert.equal(isTestFilePath('plugins/scripts/verify-fix-regression-test.test.mjs'), true)
  assert.equal(isTestFilePath('plugins/scripts/test-dx-pipeline.mjs'), true)
  assert.equal(isTestFilePath('app/scripts/test-smoke.mjs'), true)
  assert.equal(isTestFilePath('plugins/scripts/verify-fix-regression-test.mjs'), false)
  assert.equal(isTestFilePath('plugins/plugins/omnimux/tests/fixtures/sample.js'), false)
  assert.equal(isTestFilePath('specs/fix-demo.spec.md'), false)
})

test('hasMeaningfulAddedCode 区分真实代码新增与纯注释/空行改动', () => {
  assert.equal(hasMeaningfulAddedCode('+++ b/a.test.js\n+\n+// only a comment\n+  /* block comment */\n'), false)
  assert.equal(hasMeaningfulAddedCode('+++ b/a.test.js\n+/*\n+ multi line\n+ comment\n+*/\n'), false)
  assert.equal(hasMeaningfulAddedCode('+++ b/a.test.js\n+assert.equal(actual, expected)\n'), true)
})

test('fix 改动修改产品源码但缺少回归测试时阻断', () => {
  withFixtureRepo(repo => {
    repo.write(PROD_FILE, 'export const f = x => x\n')
    const base = repo.commit('chore: init')
    repo.write(PROD_FILE, 'export const f = x => x ?? 0\n')
    repo.commit('fix(omnimux): handle undefined input')

    const result = verifyFixRegressionTest({ root: repo.root, base })
    assert.equal(result.ok, false)
    assert.equal(result.status, 'missing-regression-test')
    assert.deepEqual(result.productFiles, [PROD_FILE])
    assert.deepEqual(result.qualifiedTests, [])
  })
})

test('fix 改动同时新增有效回归测试时通过', () => {
  withFixtureRepo(repo => {
    repo.write(PROD_FILE, 'export const f = x => x\n')
    const base = repo.commit('chore: init')
    repo.write(PROD_FILE, 'export const f = x => x ?? 0\n')
    repo.write(TEST_FILE, "import assert from 'node:assert/strict'\nassert.equal(0, 0)\n")
    repo.commit('fix(omnimux): handle undefined input with regression test')

    const result = verifyFixRegressionTest({ root: repo.root, base })
    assert.equal(result.ok, true)
    assert.equal(result.status, 'covered')
    assert.deepEqual(result.qualifiedTests, [TEST_FILE])
  })
})

test('只在测试文件里加空行或注释、或删除测试文件，无法绕过门禁', () => {
  withFixtureRepo(repo => {
    repo.write(PROD_FILE, 'export const f = x => x\n')
    repo.write(TEST_FILE, "import assert from 'node:assert/strict'\nassert.equal(1, 1)\n")
    const base = repo.commit('chore: init')
    repo.write(PROD_FILE, 'export const f = x => x ?? 0\n')
    repo.write(TEST_FILE, "import assert from 'node:assert/strict'\n// touch comment only\n\nassert.equal(1, 1)\n")
    repo.commit('fix(omnimux): touch test with comment only')

    const commentOnly = verifyFixRegressionTest({ root: repo.root, base })
    assert.equal(commentOnly.ok, false)
    assert.equal(commentOnly.status, 'missing-regression-test')
    assert.deepEqual(commentOnly.ignoredTestTouches, [TEST_FILE])

    repo.remove(TEST_FILE)
    repo.commit('fix(omnimux): delete test instead')
    const deletedTest = verifyFixRegressionTest({ root: repo.root, base })
    assert.equal(deletedTest.ok, false)
    assert.equal(deletedTest.status, 'missing-regression-test')
  })
})

test('非 fix 变更、以及仅改文档或工作流的 fix 变更自动放行', () => {
  withFixtureRepo(repo => {
    repo.write(PROD_FILE, 'export const f = x => x\n')
    repo.write('README.md', 'hello\n')
    const base = repo.commit('chore: init')

    repo.write(PROD_FILE, 'export const f = x => x + 1\n')
    repo.commit('feat(omnimux): add increment helper')
    const featResult = verifyFixRegressionTest({ root: repo.root, base })
    assert.equal(featResult.ok, true)
    assert.equal(featResult.status, 'not-a-fix')
  })

  withFixtureRepo(repo => {
    repo.write('README.md', 'hello\n')
    const base = repo.commit('chore: init')
    repo.write('README.md', 'hello world\n')
    repo.commit('fix(docs): correct broken badge link')

    const docsFix = verifyFixRegressionTest({ root: repo.root, base })
    assert.equal(docsFix.ok, true)
    assert.equal(docsFix.status, 'no-product-code-changed')
  })
})

test('即使提交未用 fix 前缀，PR 标题或 bug 标签仍会触发门禁', () => {
  withFixtureRepo(repo => {
    repo.write(PROD_FILE, 'export const f = x => x\n')
    const base = repo.commit('chore: init')
    repo.write(PROD_FILE, 'export const f = x => x ?? 0\n')
    repo.commit('update fallback handling')

    const byTitle = verifyFixRegressionTest({
      root: repo.root,
      base,
      prTitle: 'fix(host): guard null fallback',
    })
    assert.equal(byTitle.ok, false)
    assert.equal(byTitle.status, 'missing-regression-test')

    const byLabel = verifyFixRegressionTest({
      root: repo.root,
      base,
      labels: ['bug'],
    })
    assert.equal(byLabel.ok, false)
    assert.equal(byLabel.status, 'missing-regression-test')
  })
})

test('已提交的 spec 无回归测试声明与 commit trailer 可显式豁免，但旧声明、未提交声明与过短声明无效', () => {
  withFixtureRepo(repo => {
    repo.write(PROD_FILE, 'export const f = x => x\n')
    repo.write(SPEC_FILE, `# old\n\n## ${NO_REGRESSION_TEST_SECTION}\n\n历史上已有的旧声明不应该被后续提交直接复用放行。\n`)
    const base = repo.commit('chore: init with old spec')

    repo.write(PROD_FILE, 'export const f = x => x ?? 0\n')
    // 对旧 spec 做无关编辑以试图把 base 已有的旧声明带进 diff，同样不得复用放行
    repo.write(SPEC_FILE, `# old (touched)\n\n## ${NO_REGRESSION_TEST_SECTION}\n\n历史上已有的旧声明不应该被后续提交直接复用放行。\n`)
    repo.commit('fix(omnimux): rely on stale spec')
    // base 里早有的声明不构成新豁免；未跟踪的工作区修改也不算数
    repo.write('specs/untracked.spec.md', `# untracked\n\n## ${NO_REGRESSION_TEST_SECTION}\n\n这条声明未提交到 git，不应被 CI 侧门禁放行。\n`)
    const stale = verifyFixRegressionTest({ root: repo.root, base })
    assert.equal(stale.ok, false)
    assert.equal(stale.status, 'missing-regression-test')
    repo.remove('specs/untracked.spec.md')

    // 过短声明无效
    repo.write('specs/short.spec.md', `# short\n\n## ${NO_REGRESSION_TEST_SECTION}\n\n手动测过了\n`)
    repo.commit('fix(omnimux): too short waiver')
    const tooShort = verifyFixRegressionTest({ root: repo.root, base })
    assert.equal(tooShort.ok, false)

    // 新增足够详细的已提交 spec 声明 → 放行
    repo.write('specs/short.spec.md', `# valid\n\n## ${NO_REGRESSION_TEST_SECTION}\n\n仅涉及 macOS Developer ID 签名环境脚本，无单测环境；已在真机完成完整签名与公证链路验证。\n`)
    repo.commit('fix(omnimux): add committed waiver')
    const waivedBySpec = verifyFixRegressionTest({ root: repo.root, base })
    assert.equal(waivedBySpec.ok, true)
    assert.equal(waivedBySpec.status, 'waived')
    assert.equal(waivedBySpec.waivers[0].source, 'spec-section')
  })

  withFixtureRepo(repo => {
    repo.write(PROD_FILE, 'export const f = x => x\n')
    const base = repo.commit('chore: init')
    repo.write(PROD_FILE, 'export const f = x => x ?? 0\n')
    repo.commit(`fix(omnimux): native notarization tweak\n\n${NO_REGRESSION_TEST_TRAILER}: 仅涉及签名工具链外部环境调用，已在真机打包实测并附上公证日志。`)

    const waivedByTrailer = verifyFixRegressionTest({ root: repo.root, base })
    assert.equal(waivedByTrailer.ok, true)
    assert.equal(waivedByTrailer.status, 'waived')
    assert.equal(waivedByTrailer.waivers[0].source, 'commit-trailer')
  })
})

test('CLI 解析环境变量与退出码行为一致', () => {
  const fromEnv = resolveCliOptions(['.', 'origin/main'], {
    PR_TITLE: 'fix(core): guard crash',
    PR_LABELS: '["bug","qa:pass"]',
  })
  assert.equal(fromEnv.prTitle, 'fix(core): guard crash')
  assert.deepEqual(fromEnv.labels, ['bug', 'qa:pass'])

  withFixtureRepo(repo => {
    repo.write(PROD_FILE, 'export const f = x => x\n')
    const base = repo.commit('chore: init')
    repo.write(PROD_FILE, 'export const f = x => x ?? 0\n')
    repo.commit('fix(omnimux): missing test')

    const failed = runNodeCli([CLI_PATH, repo.root, base])
    assert.equal(failed.status, 1)
    assert.match(failed.stdout, /阻断/)
    assert.match(failed.stdout, /AGENTS\.md#一坑一测试/)

    repo.write(TEST_FILE, "import assert from 'node:assert/strict'\nassert.equal(0, 0)\n")
    repo.commit('test(omnimux): add regression test')
    const passed = runNodeCli([CLI_PATH, repo.root, base])
    assert.equal(passed.status, 0)
    assert.match(passed.stdout, /已包含有效回归测试/)
  })
})

test('quality-gate.yml 真实执行 fix 回归测试门禁与其单测（元门禁）', () => {
  const workflow = readRepoFile(`${REPO_ROOT}/..`, '.github/workflows/quality-gate.yml')
  assert.ok(workflow, 'quality-gate.yml must exist')
  const executed = workflow
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
  assert.ok(
    executed.some(line => /^node\s+--test\s+scripts\/verify-fix-regression-test\.test\.mjs\b/.test(line)),
    'quality-gate.yml must execute verify-fix-regression-test.test.mjs',
  )
  assert.ok(
    executed.some(line => /^node\s+scripts\/verify-fix-regression-test\.mjs\b/.test(line)),
    'quality-gate.yml must execute verify-fix-regression-test.mjs',
  )
})
