#!/usr/bin/env node
/**
 * Bundle src/client/apply.js (standard ES modules) into one ModuleLoader factory.
 * Official client loaders only accept a single factory file.
 * dsh-ui-kit is bundled; react / react-dom / primitives stay external.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const entryFile = join(root, 'src', 'client', 'apply.js')
const outFile = join(root, 'lib', 'client.js')

const result = await esbuild.build({
  absWorkingDir: root,
  entryPoints: [entryFile],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  charset: 'utf8',
  write: false,
  logLevel: 'info',
  external: [
    'react',
    'react/jsx-runtime',
    'react/jsx-dev-runtime',
    'react-dom',
    'react-dom/client',
    '@deepseek-ai/dsh-client-ui-primitives',
  ],
})

const code = result.outputFiles[0]?.text
if (!code) throw new Error('esbuild produced no output')

const wrapped = `window.__ModuleLoader__.load({
  id: "omnimux-market",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
${code}
    return module.exports;
  },
});
`

mkdirSync(dirname(outFile), { recursive: true })
writeFileSync(outFile, wrapped)
console.log(`wrote ${outFile} (${Buffer.byteLength(wrapped)} bytes, esbuild entry src/client/apply.js)`)
