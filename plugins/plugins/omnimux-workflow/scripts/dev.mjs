/**
 * Dev watcher: rebuild the three bundles on change (esbuild watch, 1-2s
 * rebuilds). The dsh web page needs a manual refresh; canvas.js is fetched
 * with a fresh manifest hash so caching never serves a stale island.
 */
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { realNode, nodeEnv } from './resolve-node.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const scripts = ['build-host.mjs', 'build-client.mjs', 'build-canvas.mjs']

function run(script) {
  const child = spawn(realNode(), [join('scripts', script)], { cwd: root, stdio: 'inherit', env: nodeEnv() })
  child.on('exit', (code) => {
    if (code !== 0) console.error(`[${script}] exited with ${code}`)
  })
  return child
}

console.log('initial builds...')
for (const script of scripts) run(script)

const { watch } = await import('node:fs')
const timers = new Map()
for (const dir of ['src/host', 'src/client', 'src/canvas', 'src/shared', 'src/workflow', 'scripts']) {
  watch(join(root, dir), { recursive: true }, (_event, file) => {
    const script = String(file).startsWith('src' + String.fromCharCode(47) + 'canvas')
      ? 'build-canvas.mjs'
      : String(file).startsWith('src' + String.fromCharCode(47) + 'client')
        ? 'build-client.mjs'
        : 'build-host.mjs'
    if (timers.get(script)) clearTimeout(timers.get(script))
    timers.set(script, setTimeout(() => {
      console.log(`\n[dev] ${file} changed -> ${script}`)
      run(script)
    }, 150))
  })
}

console.log('watching src/ and scripts/ — refresh dsh web to pick up changes')
