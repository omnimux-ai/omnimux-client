#!/usr/bin/env node
/**
 * Workspace metadata gate: validate the single root pnpm workspace, regenerate
 * or verify `dsh-version.json` / `bundle.lock.json`, and keep the retired
 * nested plugin workspace from coming back.
 *
 * Usage:
 *   node scripts/workspace-check.mjs --check  # CI gate
 *   node scripts/workspace-check.mjs          # regenerate metadata, then check
 */
import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const check = process.argv.includes('--check')

function fail(message) {
  console.error(`workspace-check: ${message}`)
  process.exit(1)
}

function run(script, args) {
  const result = spawnSync(process.execPath, [join(repoRoot, 'scripts', script), ...args], { cwd: repoRoot, stdio: 'inherit' })
  if (result.error || result.status !== 0) fail(`${script} ${args.join(' ')} failed`)
}

const workspace = readFileSync(join(repoRoot, 'pnpm-workspace.yaml'), 'utf8')
const workspaceLines = workspace.split('\n').map(line => line.trim())
for (const required of ['- plugins', '- plugins/plugins/*', '- plugins/packages/*']) {
  if (!workspaceLines.includes(required)) fail(`pnpm-workspace.yaml is missing ${required}`)
}
if (!workspaceLines.includes('linkWorkspacePackages: true')) fail('pnpm-workspace.yaml must keep linkWorkspacePackages: true')
for (const line of workspaceLines) {
  if (line === '- app' || line.startsWith('- app/')) fail(`pnpm-workspace.yaml must not include app/**: ${line}`)
}
for (const retired of ['plugins/pnpm-workspace.yaml', 'plugins/pnpm-lock.yaml']) {
  if (existsSync(join(repoRoot, retired))) fail(`${retired} must not exist; the workspace lock lives at the repository root`)
}

if (!existsSync(join(repoRoot, 'pnpm-lock.yaml'))) fail('pnpm-lock.yaml is missing at the repository root')
const lock = readFileSync(join(repoRoot, 'pnpm-lock.yaml'), 'utf8')
const importerSection = lock.split('\npackages:')[0]
if (!importerSection.includes('\n  .: {}\n')) fail('pnpm-lock.yaml has no empty root importer (.: {})')
if (!importerSection.includes('\n  plugins:\n')) fail('pnpm-lock.yaml has no plugins importer')

if (!check) {
  run('dsh-version.mjs', [])
  run('bundle-lock.mjs', [])
}
run('dsh-version.mjs', ['--check'])
run('bundle-lock.mjs', ['--check'])
console.log('workspace-check: OK — root workspace metadata is consistent')
