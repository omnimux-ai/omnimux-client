/**
 * `web_fetch` fallback contract (Issue #199).
 *
 * The shipped presets must keep the official built-in `web_fetch` available even
 * when the Hub's `omnimux_page_fetch` reader is absent, signed out, over quota or
 * failing. This test drives the *real* `@deepseek-ai/dsh-tool-web` package (taken
 * from the repository's vendored DSH runtime, never the network) with the config
 * rows that the two preset sources actually ship:
 *
 *   1. `presets/omni-agent/agent.cordis.yml` (generated from `Agent.md`);
 *   2. `buildMarketExpertPluginRows()` from `omnimux-market/src/expert-runtime.ts`.
 *
 * The only seam double is `ctx.web`: the loopback server replaces the anonymous
 * HTTP provider so the test can prove a real HTTP round-trip without touching the
 * public internet. `omnimux_page_fetch` is deliberately not mounted here.
 *
 * Falsification: flipping either shipped row back to `fetch: false` removes the
 * `web_fetch` registration, which fails the assertions below (the regression red
 * state recorded in `specs/fix-omni-agent-web-fetch-199.spec.md`).
 */
import test from 'node:test'
import { equal, ok } from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { parsePresetDocuments } from './lib/preset-yaml.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = join(root, '..')
const LOOPBACK_MARKER = 'OMNIMUX_WEB_FETCH_LOOPBACK_OK'

const dshVersion = JSON.parse(readFileSync(join(repoRoot, 'dsh-version.json'), 'utf8'))
const RUNTIME_VERSION = dshVersion.dsh.runtimePackageVersion

/** Extract one vendored DSH runtime package into the temp node_modules tree. */
function extractVendored(name, nodeModules) {
  const shortName = name.replace('@deepseek-ai/', '')
  const tarball = join(repoRoot, 'app/vendor/dsh-runtime', RUNTIME_VERSION, `deepseek-ai-${shortName}-${RUNTIME_VERSION}.tgz`)
  ok(existsSync(tarball), `vendored runtime tarball missing: ${tarball}`)
  const stage = mkdtempSync(join(tmpdir(), 'omnimux-tool-web-stage-'))
  const unpacked = spawnSync('tar', ['-xzf', tarball, '-C', stage], { encoding: 'utf8' })
  equal(unpacked.status, 0, `tar failed for ${tarball}: ${unpacked.stderr || unpacked.stdout}`)
  const dest = join(nodeModules, '@deepseek-ai', shortName)
  mkdirSync(dirname(dest), { recursive: true })
  renameSync(join(stage, 'package'), dest)
  rmSync(stage, { recursive: true, force: true })
}

/** Link a package that the plugin workspace already installs (cordis, schemastery, dsh-tools). */
function linkWorkspacePackage(name, nodeModules) {
  const source = join(root, 'plugins/omnimux-market/node_modules/@deepseek-ai', name)
  ok(existsSync(source), `workspace package ${name} missing; run corepack pnpm install`)
  symlinkSync(realpathSync(source), join(nodeModules, '@deepseek-ai', name), 'dir')
}

/** Module-graph shims for the HTML→Markdown conversion libraries the loopback test never uses. */
function writeModuleStub(nodeModules, name, source) {
  const dir = join(nodeModules, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name, version: '0.0.0-test-stub', type: 'module', main: 'index.js', exports: './index.js' }),
  )
  writeFileSync(join(dir, 'index.js'), source)
}

/** Materialize the official tool-web package next to its resolvable runtime deps. */
function materializeOfficialToolWeb() {
  const tmp = mkdtempSync(join(tmpdir(), 'omnimux-tool-web-'))
  const nodeModules = join(tmp, 'node_modules')
  mkdirSync(join(nodeModules, '@deepseek-ai'), { recursive: true })
  for (const name of [
    '@deepseek-ai/dsh-tool-web',
    '@deepseek-ai/dsh-output-retention',
    '@deepseek-ai/dsh-util-values',
  ]) {
    extractVendored(name, nodeModules)
  }
  for (const name of ['schemastery', 'dsh-tools', 'cordis']) linkWorkspacePackage(name, nodeModules)
  writeModuleStub(
    nodeModules,
    'turndown',
    'export default class TurndownService { addRule() { return this } use() { return this } turndown(html) { return String(html) } }\n',
  )
  writeModuleStub(nodeModules, '@joplin/turndown-plugin-gfm', 'export const gfm = () => {}\n')
  return { tmp, nodeModules }
}

/** Minimal host surface: tool/prompt registries plus the web retrieval seam. */
function fakeHostContext(registered) {
  return {
    systemPrompt: { getSectionOrder: () => 10, section: () => {} },
    tools: {
      register: (tool, opts) => registered.push({ tool, opts }),
      get: () => undefined,
    },
    web: {
      searchReady: () => true,
      fetchReady: () => true,
      fetch: async ({ url }) => {
        const response = await fetch(url)
        return {
          url: response.url,
          statusCode: response.status,
          body: { kind: 'text', content: await response.text() },
          truncated: false,
        }
      },
    },
  }
}

test('web_fetch is registered and really fetches a loopback page without omnimux_page_fetch', async (t) => {
  const harness = materializeOfficialToolWeb()
  t.after(() => rmSync(harness.tmp, { recursive: true, force: true }))
  const toolWeb = await import(pathToFileURL(join(harness.nodeModules, '@deepseek-ai/dsh-tool-web/lib/index.js')).href)

  // Preset source 1: the generated omni-agent composition (Agent.md is upstream).
  const presetText = readFileSync(join(root, 'presets/omni-agent/agent.cordis.yml'), 'utf8')
  const presetRows = parsePresetDocuments('presets/omni-agent/agent.cordis.yml', presetText)[0]
  const presetRow = presetRows.find((row) => row.id === 'tool-web')
  ok(presetRow, 'omni-agent preset must mount tool-web')
  equal(presetRow.name, '@deepseek-ai/dsh-tool-web')
  equal(presetRow.config.fetch, true, 'omni-agent preset must enable web_fetch')

  // Preset source 2: the dynamic market expert stack, bundled from its TS source.
  const expertBundle = await build({
    entryPoints: [join(root, 'plugins/omnimux-market/src/expert-runtime.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
  })
  const { buildMarketExpertPluginRows } = await import(
    `data:text/javascript;base64,${Buffer.from(expertBundle.outputFiles[0].text).toString('base64')}`
  )
  const expertRow = buildMarketExpertPluginRows('你是测试专家。').find((row) => row.id === 'tool-web')
  ok(expertRow, 'dynamic expert preset must mount tool-web')
  equal(expertRow.name, '@deepseek-ai/dsh-tool-web')
  equal(expertRow.config.fetch, true, 'dynamic expert preset must enable web_fetch')

  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
    response.end(`# Loopback article\n\n${LOOPBACK_MARKER}\n`)
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  t.after(() => server.close())
  const url = `http://127.0.0.1:${server.address().port}/article.txt`

  for (const [label, config] of [
    ['omni-agent preset', presetRow.config],
    ['market expert preset', expertRow.config],
  ]) {
    const registered = []
    toolWeb.apply(fakeHostContext(registered), toolWeb.Config(config))
    const names = registered.map((entry) => entry.tool.name)
    ok(!names.includes('omnimux_page_fetch'), `${label}: this harness mounts no Hub page reader on purpose`)
    const webFetch = registered.find((entry) => entry.tool.name === 'web_fetch')
    ok(webFetch, `${label}: fetch: true must register web_fetch`)
    const result = await webFetch.tool.execute({ url }, { signal: undefined })
    equal(result.statusCode, 200, `${label}: loopback response status`)
    equal(result.url, url, `${label}: loopback URL is preserved`)
    ok(result.body.content.includes(LOOPBACK_MARKER), `${label}: must return the real loopback body`)
  }

  // Revert control: the old `fetch: false` row drops web_fetch entirely. This is
  // the red state reproduced in the spec's bidirectional falsification.
  const disabled = []
  toolWeb.apply(fakeHostContext(disabled), toolWeb.Config({ ...presetRow.config, fetch: false }))
  ok(!disabled.some((entry) => entry.tool.name === 'web_fetch'), 'fetch: false must not register web_fetch')
  ok(disabled.some((entry) => entry.tool.name === 'web_search'), 'search registration is independent of fetch')
})
