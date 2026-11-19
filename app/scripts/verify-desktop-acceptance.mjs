import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createReadStream, lstatSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const root = fileURLToPath(new URL('../..', import.meta.url))
const guide = 'https://github.com/omnimux-ai/omnimux-client/blob/main/AGENTS.md#desktop-ac'
const inputPaths = [
  'app', 'plugins', 'scripts', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml',
  'dsh-version.json', 'bundle.lock.json', '.gitmodules', '.gitattributes', '.npmrc',
]
const sha256 = /^[a-f0-9]{64}$/
const fullCommit = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/
const id = /^[A-Za-z0-9][A-Za-z0-9_-]*$/
const text = value => typeof value === 'string' && value.trim().length > 0

export function captureDesktopInputs(repo, commit) {
  if (!fullCommit.test(commit ?? '')) throw new Error('Provide a full source commit SHA.')
  const git = args => execFileSync('git', ['--no-replace-objects', '-C', repo, ...args])
  if (git(['rev-parse', '--verify', `${commit}^{commit}`]).toString().trim() !== commit) {
    throw new Error('The source SHA does not identify a commit.')
  }
  const tree = git(['ls-tree', '-z', '--full-tree', commit, '--', ...inputPaths])
  if (!tree.length) throw new Error('The source revision has no desktop build inputs.')
  return { commit, inputsSha256: createHash('sha256').update(tree).digest('hex'),
    gitEntries: tree.toString().split('\0').filter(Boolean) }
}

async function checkArtifact(directory, item, label) {
  const path = item?.path
  if (!text(path) || !path.split('/').every(segment => /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(segment))
    || !sha256.test(item?.sha256 ?? '')) return `${label}: missing artifact path or SHA-256`
  const absolute = join(directory, path)
  try {
    if (realpathSync(absolute) !== absolute) return `${label}: artifact is not in the evidence directory (${path})`
    const stat = lstatSync(absolute)
    if (!stat.isFile() || stat.size === 0) return `${label}: artifact must be a nonempty file (${path})`
    const digest = createHash('sha256')
    for await (const chunk of createReadStream(absolute)) digest.update(chunk)
    if (digest.digest('hex') !== item.sha256) return `${label}: artifact SHA-256 differs (${path})`
    return null
  } catch {
    return `${label}: artifact is unreadable (${path})`
  }
}

function validIds(values) {
  return Array.isArray(values) && values.length > 0
    && values.every(value => typeof value === 'string' && id.test(value))
    && new Set(values).size === values.length
}

export async function verifyDesktopAcceptance({ repo, head, required, report, directory }) {
  const evidenceRoot = realpathSync(directory)
  if (!Number.isSafeInteger(required?.issue) || required.issue <= 0 || !Array.isArray(required.cases)
    || !validIds(required.cases.map(requirement => requirement?.id))
    || !required.cases.every(requirement => validIds(requirement.steps)
      && (requirement.sameSubject === undefined || typeof requirement.sameSubject === 'boolean'))) {
    throw new Error('The issue must declare unique acceptance IDs and ordered step IDs.')
  }
  const errors = []
  const pending = []
  const emergency = required.emergency
  if (emergency !== undefined && (emergency?.priority !== 'P0'
    || !validIds(emergency.cases) || !text(emergency.authorization)
    || !emergency.cases.every(caseId => required.cases.some(requirement => requirement.id === caseId)))) {
    throw new Error('Emergency evidence needs the P0 authorization reference and explicit pending case IDs.')
  }

  const build = report?.build
  const candidate = captureDesktopInputs(repo, head)
  if (report?.issue !== required.issue) errors.push(`report does not belong to issue #${required.issue}`)
  const observations = new Map()
  const caseIds = new Set(required.cases.map(requirement => requirement.id))
  for (const observation of Array.isArray(report?.cases) ? report.cases : []) {
    if (!caseIds.has(observation?.id)) {
      errors.push(`unexpected acceptance ID ${String(observation?.id)}`)
      continue
    }
    if (observations.has(observation.id)) errors.push(`duplicate acceptance ID ${observation.id}`)
    observations.set(observation.id, observation)
  }
  let measuredSteps = 0
  for (const requirement of required.cases) {
    const observation = observations.get(requirement.id)
    if (!observation) {
      errors.push(`missing acceptance ID ${requirement.id}`)
      continue
    }
    const deferred = observation.verdict === 'pending'
    if (deferred && emergency?.cases.includes(requirement.id) && text(observation.reason)) {
      pending.push({ id: requirement.id, reason: observation.reason, authorization: emergency.authorization })
    } else if (observation.verdict !== 'pass') {
      errors.push(`${requirement.id}: verdict is ${observation.verdict || 'missing'}`)
    }
    const steps = Array.isArray(observation.steps) ? observation.steps : []
    measuredSteps += steps.length
    const expectedSteps = deferred ? requirement.steps.slice(0, steps.length) : requirement.steps
    if (steps.length !== expectedSteps.length || steps.some((step, index) => step?.id !== expectedSteps[index])) {
      errors.push(`${requirement.id}: expected ordered steps ${expectedSteps.join(', ') || '(none)'}`)
    }
    const subject = steps[0]?.subject
    for (const step of steps) {
      const label = `${requirement.id}/${step?.id || '(missing ID)'}`
      if (!text(step?.action) || !text(step?.result)) errors.push(`${label}: missing action or actual result`)
      if (requirement.sameSubject && (!text(subject) || step?.subject !== subject)) {
        errors.push(`${label}: step did not use the same subject throughout the sequence`)
      }
      const error = await checkArtifact(evidenceRoot, step?.artifact, label)
      if (error) errors.push(error)
    }
  }
  const fullyDeferred = pending.length === required.cases.length && measuredSteps === 0
  if (!fullyDeferred || build) {
    try {
      const measured = captureDesktopInputs(repo, build?.commit)
      if (build?.inputsSha256 !== measured.inputsSha256) {
        errors.push(`recorded build inputs differ from source commit ${measured.commit}`)
      }
      if (measured.inputsSha256 !== candidate.inputsSha256) {
        errors.push(`build input mismatch between ${measured.commit} and PR head ${candidate.commit}`)
      }
    } catch {
      errors.push('the measured build has no resolvable source commit')
    }
    if (!Array.isArray(build?.artifacts) || build.artifacts.length === 0) {
      errors.push('measured build artifacts are missing')
    } else {
      for (const [index, artifact] of build.artifacts.entries()) {
        const error = await checkArtifact(evidenceRoot, artifact, `build artifact ${index + 1}`)
        if (error) errors.push(error)
      }
    }
  }
  const status = errors.length ? 'failed' : pending.length ? 'pending' : 'verified'
  return { status, issue: required.issue, head: candidate.commit, sourceCommit: build?.commit ?? null, pending, errors }
}

function json(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

async function main() {
  const { values } = parseArgs({ options: {
    'print-inputs': { type: 'string' },
    head: { type: 'string' },
    requirements: { type: 'string' },
    report: { type: 'string' },
  } })
  if (values['print-inputs'] && Object.keys(values).length === 1) {
    console.log(JSON.stringify(captureDesktopInputs(root, values['print-inputs']), null, 2))
    return
  }
  if (!values.head || !values.requirements || !values.report || values['print-inputs']) {
    throw new Error('Usage: --head <PR SHA> --requirements <file> --report <file>, or --print-inputs <SHA>.')
  }
  const reportPath = resolve(values.report)
  const outcome = await verifyDesktopAcceptance({
    repo: root, head: values.head, required: json(values.requirements), report: json(reportPath),
    directory: dirname(reportPath),
  })
  console.log(JSON.stringify(outcome, null, 2))
  if (outcome.status !== 'verified') {
    console.error(`Desktop acceptance: ${outcome.status}. See ${guide}`)
    process.exitCode = outcome.status === 'pending' ? 2 : 1
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main()
  } catch (error) {
    console.error(`${error.message}\nSee ${guide}`)
    process.exitCode = 1
  }
}
