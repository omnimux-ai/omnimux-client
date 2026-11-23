#!/usr/bin/env node
/**
 * Generate or verify `dsh-version.json`: the DSH line this client ships.
 *
 * Sources of truth:
 *   app/upstream.json   active channel pin (commit + sourceVersion); `activeChannel`
 *                       selects it, so a next-channel branch does not have to lie
 *                       about the stable pin to keep this file fresh
 *   PROVENANCE.json     gitlink pin for the app/deepseek-harness submodule
 *   git ls-tree         the commit actually recorded by the repository
 *
 * Usage:
 *   node scripts/dsh-version.mjs          # write dsh-version.json
 *   node scripts/dsh-version.mjs --check  # exit non-zero when the pin drifts
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outputPath = join(repoRoot, 'dsh-version.json')
const check = process.argv.includes('--check')
const submodulePath = 'app/deepseek-harness'

function fail(message) {
  console.error(`dsh-version: ${message}`)
  process.exit(1)
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function git(args, cwd = repoRoot) {
  const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' })
  if (result.error || result.status !== 0) fail(`git ${args.join(' ')} failed: ${result.stderr?.trim() || result.error}`)
  return result.stdout.trim()
}

const upstream = readJson(join(repoRoot, 'app', 'upstream.json'))
const channelName = typeof upstream.activeChannel === 'string' ? upstream.activeChannel : 'stable'
const channel = upstream.channels?.[channelName]
if (channel === undefined) fail(`app/upstream.json has no ${channelName} channel`)
const provenance = readJson(join(repoRoot, 'PROVENANCE.json'))
const provenanceCommit = provenance.sources?.app?.submodules?.[submodulePath]
if (typeof provenanceCommit !== 'string') fail(`PROVENANCE.json has no ${submodulePath} pin`)

const gitlink = git(['ls-tree', 'HEAD', '--', submodulePath])
const gitlinkMatch = /^160000\s+commit\s+([0-9a-f]{40})\t/u.exec(gitlink)
if (gitlinkMatch === null) fail(`cannot read the ${submodulePath} gitlink from HEAD`)
const gitlinkCommit = gitlinkMatch[1]

const expected = {
  schemaVersion: 1,
  dsh: {
    channel: channelName,
    repository: upstream.repository,
    commit: channel.commit,
    sourceVersion: channel.sourceVersion,
    runtimePackageVersion: channel.runtimePackageVersion,
    runtimeSource: channel.runtimeSource,
  },
  submodule: {
    path: submodulePath,
    commit: gitlinkCommit,
    status: 'pinned',
  },
}

function liveSubmodule() {
  const directory = join(repoRoot, submodulePath)
  if (!existsSync(join(directory, '.git'))) return { initialized: false }
  const head = git(['rev-parse', 'HEAD'], directory)
  const dirty = git(['status', '--porcelain'], directory) !== ''
  return { initialized: true, head, dirty }
}

const live = liveSubmodule()
const problems = []
if (channel.commit !== gitlinkCommit) problems.push(`app/upstream.json ${channelName} commit ${channel.commit} != gitlink ${gitlinkCommit}`)
if (provenanceCommit !== gitlinkCommit) problems.push(`PROVENANCE.json pin ${provenanceCommit} != gitlink ${gitlinkCommit}`)
if (live.initialized && live.head !== gitlinkCommit) problems.push(`submodule HEAD ${live.head} != gitlink ${gitlinkCommit}`)
if (live.initialized && live.dirty) problems.push('submodule working tree is dirty')

const serialized = `${JSON.stringify(expected, null, 2)}\n`

if (problems.length > 0) {
  for (const problem of problems) console.error(`dsh-version: ${problem}`)
  process.exit(1)
}

if (check) {
  if (!existsSync(outputPath)) fail('dsh-version.json is missing; run node scripts/dsh-version.mjs')
  const actual = readFileSync(outputPath, 'utf8')
  if (actual !== serialized) fail('dsh-version.json is stale; run node scripts/dsh-version.mjs')
  console.log(`dsh-version: OK — ${channelName} ${channel.commit.slice(0, 12)} (${channel.sourceVersion}), submodule ${live.initialized ? (live.dirty ? 'dirty' : 'clean') : 'not initialized'}`)
} else {
  writeFileSync(outputPath, serialized)
  console.log(`dsh-version: wrote ${relative(repoRoot, outputPath)} (${channelName} ${channel.commit.slice(0, 12)})`)
}
