import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import * as esbuild from 'esbuild'

const clientDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../src/client')
const plazaDir = resolve(clientDir, 'plaza')

/**
 * Compile a standard ES module under src/client/ into CJS in memory and run it
 * inside an isolated vm context with mock module overrides.
 *
 * Tests can inject lightweight virtual-DOM mocks for `./boot.js`, `./api.js`,
 * `./runtime-state.js`, etc. while exercising the real ES module `import`/`export`
 * graph without pulling `.module.css` from `@deepseek-ai/dsh-client-ui-primitives`.
 */
export function loadClientModule(entryFile, { globals = {}, modules = {} } = {}) {
  const entryPath = entryFile.startsWith('/') ? entryFile : resolve(clientDir, entryFile)
  const cache = new Map()
  const baseRequire = createRequire(entryPath)

  function loadModule(absPath) {
    if (cache.has(absPath)) return cache.get(absPath).exports
    const source = readFileSync(absPath, 'utf8')
    const { code } = esbuild.transformSync(source, {
      loader: absPath.endsWith('.jsx') ? 'jsx' : 'js',
      format: 'cjs',
      target: 'node22',
      sourcefile: absPath,
      jsxFactory: 'h',
    })
    const mod = { exports: {} }
    cache.set(absPath, mod)
    const dir = dirname(absPath)
    const localRequire = (spec) => {
      if (Object.hasOwn(modules, spec)) return modules[spec]
      if (spec.startsWith('./') || spec.startsWith('../')) {
        const target = resolve(dir, spec)
        if (target.startsWith(`${clientDir}/`) || target.startsWith(`${clientDir}\\`)) {
          const relFromClient = `./${target.slice(clientDir.length + 1).replace(/\\/g, '/')}`
          if (Object.hasOwn(modules, relFromClient)) return modules[relFromClient]
          // Delegate plaza/* modules to Node's host-realm loader so returned arrays/objects
          // share the test realm's prototypes (avoiding cross-realm assert.deepEqual mismatches).
          // All current plaza/*.jsx files use pure h(...) calls rather than JSX syntax.
          if (target.startsWith(`${plazaDir}/`) || target.startsWith(`${plazaDir}\\`)) {
            return baseRequire(target)
          }
          return loadModule(target)
        }
      }
      return baseRequire(spec)
    }
    const sandbox = {
      console,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      Date,
      URL,
      URLSearchParams,
      Map,
      Set,
      Promise,
      Object,
      Array,
      Math,
      JSON,
      RegExp,
      Error,
      TypeError,
      Number,
      String,
      Boolean,
      Symbol,
      ...globals,
      require: localRequire,
      module: mod,
      exports: mod.exports,
    }
    runInNewContext(code, sandbox, { filename: absPath })
    return mod.exports
  }

  return loadModule(entryPath)
}
