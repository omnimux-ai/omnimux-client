#!/usr/bin/env node
/**
 * Cross-platform market build.
 *
 * The old package.json script used POSIX `rm`, `mkdir`, `cp` and a shell
 * `for ... case`, which fails under Windows cmd.exe before TypeScript starts.
 * Keep the same artifact contract here with Node's path/fs APIs instead.
 */
import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)

function runNode(scriptPath, args = []) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function copyFiles(source, destination, include) {
  mkdirSync(destination, { recursive: true })
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (!entry.isFile() || !include(entry.name)) continue
    copyFileSync(join(source, entry.name), join(destination, entry.name))
  }
}

rmSync(join(root, 'lib'), { recursive: true, force: true })

const tsc = require.resolve('typescript/bin/tsc')
runNode(tsc, ['-p', 'tsconfig.json'])
mkdirSync(join(root, 'lib', 'tests', 'fixtures'), { recursive: true })
mkdirSync(join(root, 'lib', 'expert'), { recursive: true })
runNode(join(root, 'scripts', 'concat-client.mjs'))
copyFiles(join(root, 'src', 'tests', 'fixtures'), join(root, 'lib', 'tests', 'fixtures'), () => true)
copyFiles(join(root, 'src', 'expert'), join(root, 'lib', 'expert'), (name) => name.endsWith('.js') && !name.endsWith('.test.js'))
