#!/usr/bin/env node
/**
 * Package an unsigned, ad-hoc signed macOS `OmniMux Dev.app` from `dsh-desktop-next`
 * with hard-bound Dev channel metadata (`Resources/build-info.json` + `Info.plist`
 * `CFBundleIdentifier=ai.omnimux.desktop.dev`), then verify the final code signature.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const repoRoot = resolve(packageRoot, '..', '..')

/**
 * @param {{
 *   platform?: NodeJS.Platform,
 *   arch?: string,
 *   env?: NodeJS.ProcessEnv,
 *   run?: (command: string, args: readonly string[], options: import('node:child_process').SpawnSyncOptions) => { status: number | null, error?: Error },
 *   renameBundle?: (source: string, destination: string) => void,
 * }} options
 */
export function packageNextDev({
  platform = process.platform,
  arch = process.arch,
  env = process.env,
  run = spawnSync,
  renameBundle = (source, destination) => {
    if (existsSync(destination)) rmSync(destination, { recursive: true, force: true })
    renameSync(source, destination)
  },
} = {}) {
  if (platform !== 'darwin' || !['arm64', 'x64'].includes(arch)) {
    throw new Error('package:dev requires a native macOS arm64 or x64 host')
  }
  const { build } = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
  const macDir = join(packageRoot, 'dist', arch === 'arm64' ? 'mac-arm64' : 'mac')
  const rawAppPath = join(macDir, `${build.productName}.app`)
  const devAppPath = join(macDir, 'OmniMux Dev.app')
  const buildEnv = {
    ...env,
    DSH_BUILD_CHANNEL: 'package-dev',
    DSH_MAC_SMOKE_ARCH: arch,
  }

  const preSteps = [
    [process.execPath, [join(repoRoot, 'scripts', 'prepare-local-plugins.mjs')], repoRoot, env],
    ['corepack', ['yarn', 'run', 'build'], packageRoot, env],
    [process.execPath, [join(packageRoot, 'scripts', 'package.ts'), 'dir'], packageRoot, buildEnv],
    [process.execPath, [join(packageRoot, 'scripts', 'stamp-dev-app.mjs'), rawAppPath], packageRoot, buildEnv],
  ]

  for (const [command, args, cwd, stepEnv] of preSteps) {
    const result = run(command, args, { cwd, env: stepEnv, stdio: 'inherit' })
    if (result.error !== undefined) throw result.error
    if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited with ${String(result.status)}`)
  }

  renameBundle(rawAppPath, devAppPath)

  // Stamping Info.plist invalidates the unsigned bundle signature; re-sign ad-hoc and strictly verify.
  const signSteps = [
    ['codesign', ['--force', '--deep', '--sign', '-', devAppPath]],
    ['/usr/bin/codesign', ['--verify', '--deep', '--strict', devAppPath]],
  ]
  for (const [command, args] of signSteps) {
    const result = run(command, args, { cwd: packageRoot, env: buildEnv, stdio: 'inherit' })
    if (result.error !== undefined) throw result.error
    if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited with ${String(result.status)}`)
  }

  return devAppPath
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  // Accept `--fresh-preset` as a no-op compatibility flag because Next builds fresh payload each run.
  const allowed = args.length === 0 || (args.length === 1 && args[0] === '--fresh-preset')
  if (!allowed) throw new Error('usage: package-dev.mjs [--fresh-preset]')
  const appPath = packageNextDev()
  process.stdout.write(`✓ Built signed Next Dev App: ${appPath}\n`)
}
