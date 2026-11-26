import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import YAML from 'yaml'

const WORKFLOW_PATH = new URL('../../.github/workflows/publish.yml', import.meta.url)
const SOURCE = readFileSync(WORKFLOW_PATH, 'utf8')
const WORKFLOW = YAML.parse(SOURCE)

const allSteps = Object.values(WORKFLOW.jobs).flatMap(job => job.steps ?? [])
const checkoutSteps = allSteps.filter(step => typeof step.uses === 'string' && step.uses.startsWith('actions/checkout@'))
const usesSteps = allSteps.filter(step => typeof step.uses === 'string')
const stepText = JSON.stringify(WORKFLOW.jobs)

test('publish workflow keeps the Trusted Publisher identity and scopes id-token: write to publish job only (issue #361)', () => {
  assert.match(WORKFLOW.name, /Trusted Publishing/)
  assert.match(WORKFLOW_PATH.pathname, /\.github\/workflows\/publish\.yml$/)
  assert.deepEqual(WORKFLOW.permissions, { contents: 'read' })
  assert.equal(WORKFLOW.jobs.plan.permissions, undefined)
  assert.deepEqual(WORKFLOW.jobs.publish.permissions, { contents: 'read', 'id-token': 'write' })
  assert.equal(WORKFLOW.environment, undefined)
  assert.equal(WORKFLOW.concurrency, undefined)
  for (const job of Object.values(WORKFLOW.jobs)) assert.equal(job.environment, undefined)
  assert.ok(checkoutSteps.length >= 2)
  for (const step of checkoutSteps) assert.equal(step.with?.['persist-credentials'], false)
  for (const step of usesSteps) {
    assert.match(step.uses, /^[^@]+@[0-9a-f]{40}$/, `action must be pinned to a full 40-char commit SHA: ${step.uses}`)
  }
  assert.doesNotMatch(SOURCE, /\bsecrets\./)
  assert.doesNotMatch(SOURCE, /NODE_AUTH_TOKEN|NPM_TOKEN|npm_token/)
})

test('real publish enforces refs/heads/main in both plan and publish jobs and disables install lifecycle scripts (issue #361)', () => {
  const planGuard = WORKFLOW.jobs.plan.steps.find(step => step.name === 'Enforce main branch for real publish')
  assert.ok(planGuard)
  assert.equal(planGuard.if, '${{ !inputs.dry_run }}')
  assert.match(planGuard.run, /refs\/heads\/main/)
  assert.match(planGuard.run, /exit 1/)

  const publishGuard = WORKFLOW.jobs.publish.steps.find(step => step.name === 'Enforce main branch before publish')
  assert.ok(publishGuard)
  assert.equal(publishGuard.if, "${{ matrix.action == 'publish' }}")
  assert.match(publishGuard.run, /refs\/heads\/main/)
  assert.match(publishGuard.run, /exit 1/)

  assert.match(String(WORKFLOW.env?.NPM_CLI_VERSION ?? ''), /^11\.\d+\.\d+$/)
  assert.match(stepText, /npm install --global --ignore-scripts \\"npm@\$\{NPM_CLI_VERSION\}\\"/)
  assert.doesNotMatch(stepText, /npm install --global npm@11\b/)
  assert.match(stepText, /corepack pnpm install --frozen-lockfile --ignore-scripts/)
})

test('workflow_dispatch defaults to all packages and dry-run true', () => {
  const inputs = WORKFLOW.on.workflow_dispatch.inputs
  assert.equal(inputs.packages.default, 'all')
  assert.equal(inputs.packages.type, 'string')
  assert.equal(inputs.dry_run.default, true)
  assert.equal(inputs.dry_run.type, 'boolean')
  assert.equal(inputs.package, undefined)
})

test('plan job expands the package selection through publish-matrix and exposes a matrix', () => {
  const plan = WORKFLOW.jobs.plan
  assert.match(plan.outputs.matrix, /steps\.matrix\.outputs\.matrix/)
  assert.match(stepText, /scripts\/publish-matrix\.mjs/)
  const resolve = plan.steps.find(step => step.id === 'matrix')
  assert.ok(resolve)
  assert.match(resolve.run, /INPUT_PACKAGES/)
  assert.match(resolve.run, /INPUT_DRY_RUN/)
  assert.match(resolve.run, /::warning::/)
})

test('publish job uses the planned matrix, per-package concurrency and safe real-publish ordering', () => {
  const publish = WORKFLOW.jobs.publish
  assert.equal(publish.needs, 'plan')
  assert.equal(publish.strategy['fail-fast'], false)
  assert.match(publish.strategy['max-parallel'], /inputs\.dry_run/)
  assert.match(publish.strategy.matrix.include, /fromJSON\(needs\.plan\.outputs\.matrix\)/)
  assert.match(publish.concurrency.group, /matrix\.package/)
  assert.equal(publish.concurrency['cancel-in-progress'], false)
  assert.match(publish.name, /matrix\.action/)
  assert.match(publish.name, /matrix\.package/)
})

test('publish job retains preflight, npm version gate, dry-run actions and propagation verification', () => {
  const publish = WORKFLOW.jobs.publish
  const steps = publish.steps
  const preflight = steps.find(step => step.name.includes('Release preflight'))
  assert.ok(preflight)
  assert.match(preflight.name, /verify-publish-source/)
  assert.match(preflight.run, /release-check\.mjs/)
  assert.match(preflight.run, /--allow-published/)
  assert.match(stepText, /npm >= 11\.5\.1/)
  assert.match(stepText, /npm install --global --ignore-scripts \\"npm@\$\{NPM_CLI_VERSION\}\\"/)
  assert.match(stepText, /npm publish --access public --tag latest --dry-run/)
  assert.match(stepText, /npm pack --dry-run/)
  assert.match(stepText, /MAX_ATTEMPTS = 60/)
  assert.match(stepText, /RETRY_DELAY_SECONDS = 15/)
  assert.match(stepText, /gitHead/)
  assert.equal(publish.steps.find(step => step.name === 'Verify published package')?.if, "${{ matrix.action == 'publish' }}")
})

test('no step can accidentally publish during a dry-run or pack action', () => {
  const runText = Object.values(WORKFLOW.jobs)
    .flatMap(job => job.steps ?? [])
    .map(step => step.run ?? '')
    .join('\n')
  assert.match(runText, /case "\$ACTION" in/)
  assert.match(runText, /publish\) npm publish --access public --tag latest ;;/)
  assert.match(runText, /publish-dry-run\) npm publish --access public --tag latest --dry-run ;;/)
  assert.match(runText, /pack-dry-run\) npm pack --dry-run ;;/)
  assert.match(runText, /unknown release action/)
})

test('assets explicitly waits for products@0.1.2 before real publish', () => {
  const publish = WORKFLOW.jobs.publish
  const wait = publish.steps.find(step => step.name === 'Wait for internal package dependency')
  assert.ok(wait)
  assert.equal(wait.if, "${{ matrix.action == 'publish' && matrix.package == 'omnimux-assets' }}")
  assert.match(wait.env.DEPENDENCY, /^omnimux-products@\^0\.1\.2$/)
  assert.match(wait.run, /npm view "\$DEPENDENCY" version/)
  assert.match(wait.run, /MAX_ATTEMPTS=60/)
  assert.match(wait.run, /RETRY_DELAY_SECONDS=15/)
  assert.match(wait.run, /::error::/)
  assert.match(wait.run, /refusing to publish omnimux-assets/)
})
