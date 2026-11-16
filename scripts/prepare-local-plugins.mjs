#!/usr/bin/env node
/**
 * Packaging preflight: build the in-repo plugin workspaces, then verify the
 * build outputs the desktop payload consumes are present and fresh.
 *
 * Invoked from the desktop packaging scripts through this repository script so
 * `yarn workspace dsh-desktop-next package:dir` / `dist:*` never packages a
 * stale or missing plugin bundle.
 */
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pluginsDir = resolve(repoRoot, 'plugins')

function fail(message) {
  console.error(`prepare-local-plugins: ${message}`)
  process.exit(1)
}

if (!existsSync(resolve(pluginsDir, 'node_modules'))) {
  fail('plugins/node_modules is missing; run pnpm install --frozen-lockfile first')
}

const corepack = spawnSync('corepack', ['--version'], { cwd: repoRoot, encoding: 'utf8' })
const command = corepack.status === 0 ? 'corepack' : 'pnpm'
const args = command === 'corepack' ? ['pnpm', '--dir', 'plugins', 'run', 'build:all'] : ['--dir', 'plugins', 'run', 'build:all']
console.log(`prepare-local-plugins: ${command} ${args.join(' ')}`)
const build = spawnSync(command, args, { cwd: repoRoot, stdio: 'inherit' })
if (build.error || build.status !== 0) fail(`plugin build failed (${build.status ?? build.error})`)

const verify = spawnSync(process.execPath, [resolve(repoRoot, 'scripts', 'verify-plugin-builds.mjs')], { cwd: repoRoot, stdio: 'inherit' })
if (verify.error || verify.status !== 0) fail('plugin build freshness verification failed')
