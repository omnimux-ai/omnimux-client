import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, copyFileSync, cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SOCIAL_DATA_CATALOG } from '../plugins/omnimux/src/official/social-data.js'

/**
 * Gate for the preset skill surface after rc.3 (updated for #234).
 *
 * rc.3 carries presets through packaged declarations (`preset/agent-presets`
 * plus shell declarations); `sync-agent-presets.sh` no longer materialises
 * preset skills into a consumer home. These tests therefore check:
 *  - no shipped preset registers its own skill directory (`customSkillDirs`);
 *  - product plugins NEVER duplicate upstream DSH Creator-mode skills owned by
 *    `@deepseek-ai/dsh-agent-preset/skills/` (`cordis-plugin-development`,
 *    `editing-cordis-compositions`, `agent-experience`, `cordis-composition-reference`);
 *  - `sync-agent-presets.sh` writes nothing into the target skill root and
 *    never clobbers an existing user-owned skill.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const temporaryRoots = []

afterEach(() => {
  for (const directory of temporaryRoots.splice(0)) rmSync(directory, { recursive: true, force: true })
})

test('no shipped preset registers its own skill directory', () => {
  const presetsRoot = join(root, 'presets')
  const offenders = []
  for (const entry of readdirSync(presetsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const composition = join(presetsRoot, entry.name, 'agent.cordis.yml')
    if (!existsSync(composition)) continue
    if (readFileSync(composition, 'utf8').includes('customSkillDirs')) offenders.push(entry.name)
  }
  assert.deepEqual(offenders, [], `these presets still register a skill root the packaged copy cannot list: ${offenders.join(', ')}`)
})

test('product plugins never duplicate upstream DSH Creator-mode Cordis skills (#234)', () => {
  // Upstream `@deepseek-ai/dsh-agent-preset/skills/` owns these Creator-mode
  // skills and scopes them exclusively to the `cordis` preset. Shipping stale
  // copies inside `plugins/omnimux/skills/` pollutes global `$DSH_HOME/skills/`
  // and conflicts with upstream versions.
  const upstreamCreatorSkills = [
    'agent-experience',
    'cordis-composition-reference',
    'cordis-plugin-development',
    'editing-cordis-compositions',
  ]
  const pluginsRoot = join(root, 'plugins')
  for (const entry of readdirSync(pluginsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    for (const id of upstreamCreatorSkills) {
      const skill = join(pluginsRoot, entry.name, 'skills', id, 'SKILL.md')
      assert.equal(existsSync(skill), false, `${entry.name} must not ship duplicate upstream skill ${id}`)
    }
    const manifestPath = join(pluginsRoot, entry.name, 'dsh.manifest.json')
    if (!existsSync(manifestPath)) continue
    const pluginRoot = join(pluginsRoot, entry.name)
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const declared = Array.isArray(manifest.skills) ? manifest.skills : []
    for (const rel of declared) {
      const resolved = resolve(pluginRoot, String(rel))
      const slug = basename(dirname(resolved))
      assert.equal(
        upstreamCreatorSkills.includes(slug),
        false,
        `${entry.name}/dsh.manifest.json must not declare duplicate upstream skill ${slug} (${rel})`,
      )
    }
  }
})

test('sync-agent-presets.sh never writes preset skills into the target skill root (rc.3)', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'omnimux-preset-skills-'))
  temporaryRoots.push(fixture)
  const scripts = join(fixture, 'scripts')
  const home = join(fixture, 'harness-home')
  mkdirSync(scripts, { recursive: true })
  mkdirSync(home, { recursive: true })
  copyFileSync(join(root, 'scripts', 'sync-agent-presets.sh'), join(scripts, 'sync-agent-presets.sh'))
  copyFileSync(join(root, 'scripts', 'resolve-omnimux-profile.sh'), join(scripts, 'resolve-omnimux-profile.sh'))
  chmodSync(join(scripts, 'sync-agent-presets.sh'), 0o755)
  cpSync(join(root, 'presets'), join(fixture, 'presets'), { recursive: true })

  // A skill the user already owns at the same name must survive untouched.
  const owned = join(home, 'skills', 'omnimux-social-data')
  mkdirSync(owned, { recursive: true })
  writeFileSync(join(owned, 'SKILL.md'), 'user-owned\n')

  const result = spawnSync('bash', [join(scripts, 'sync-agent-presets.sh'), `--target=${home}`], {
    cwd: fixture,
    encoding: 'utf8',
    env: { ...process.env, HOME: fixture, OMNIMUX_SYNC_TARGETS: '' },
  })
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)

  // [client-port] rc.3: presets ship via the package (preset/agent-presets) and
  // shell declarations; sync-agent-presets.sh no longer writes preset skills to
  // the target home. The guard is that it writes nothing and never clobbers an
  // existing user-owned skill.
  for (const id of ['editing-cordis-compositions', 'cordis-plugin-development']) {
    assert.equal(existsSync(join(home, 'skills', id, 'SKILL.md')), false, `${id} must not be written in rc.3`)
  }
  assert.equal(readFileSync(join(owned, 'SKILL.md'), 'utf8'), 'user-owned\n', 'an existing skill was overwritten')
})

/**
 * Collect concrete Agent tool names from authoritative registration sites across
 * `plugins/*` (dsh.manifest.json tools, `ctx.tools.register(...)`, `tool('...')`,
 * and `STT_TOOL_NAME`) while skipping client UI directories so arbitrary object
 * `name:` properties cannot create false-passes.
 */
function collectWorkspaceRegisteredTools(pluginsDir) {
  const names = new Set()
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', 'dist', 'lib', '.git', 'tests', 'skills', 'catalog', 'client', 'scripts'].includes(entry.name)) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (!entry.isFile()) continue
      if (entry.name === 'dsh.manifest.json') {
        const manifest = JSON.parse(readFileSync(full, 'utf8'))
        for (const item of manifest.capabilities?.tools ?? []) {
          if (typeof item?.name === 'string') names.add(item.name)
        }
        continue
      }
      if (!/\.(js|mjs|ts)$/.test(entry.name) || /\.(test|spec)\.(js|mjs|ts)$/.test(entry.name)) continue
      const text = readFileSync(full, 'utf8')
      for (const re of [
        /\btool\(\s*['"]([a-z][a-z0-9_]+)['"]/g,
        /\btools\.register\(\s*\{[\s\S]{0,160}?\bname:\s*['"]([a-z][a-z0-9_]+)['"]/g,
        /\bSTT_TOOL_NAME\s*=\s*['"]([a-z][a-z0-9_]+)['"]/g,
      ]) {
        for (const match of text.matchAll(re)) names.add(match[1])
      }
    }
  }
  walk(pluginsDir)
  return names
}

test('social research preset skills only reference live registered OmniMux runtime tools, valid social-data capabilities, and synced registry entries', () => {
  const pluginsDir = join(root, 'plugins')
  const registered = collectWorkspaceRegisteredTools(pluginsDir)
  assert.ok(registered.size >= 40 && registered.size <= 250, `unexpected registered tool set size: ${registered.size}`)

  const marketSkillsDir = join(pluginsDir, 'omnimux-market', 'skills')
  const skillIds = [
    'omnimux-social-data',
    'omnimux-outlier-post-finder',
    'omnimux-creator-teardown',
    'omnimux-transcript-intelligence',
    'omnimux-trend-discovery',
    'omnimux-competitor-research',
    'omnimux-social-listening',
    'omnimux-product-demand',
    'omnimux-content-repurposing',
    'omnimux-ecom-platform-rules',
    'omnimux-ecom-market-research',
    'omnimux-ecom-pricing-strategy',
    'omnimux-ecom-listing-copy',
    'omnimux-ecom-visual-qa',
    'omnimux-ecom-video-script',
    'omnimux-ecom-ads-diagnosis',
    'omnimux-ecom-review-voc',
  ]
  const files = [
    ...skillIds.map((id) => join(marketSkillsDir, id, 'SKILL.md')),
    join(marketSkillsDir, 'omnimux-social-data', 'references', 'README.md'),
    join(marketSkillsDir, 'omnimux-social-data', 'references', 'TRIGGER-MATRIX.md'),
  ]

  // Match both backticked and plain concrete tool names across all OmniMux tool prefixes
  // while skipping wildcard shorthand such as `omnimux_tiktok_shop_*`.
  const concreteToolRe = /\b((?:omnimux|harvest|video|analytics|inspiration|publish|assets|products|workflow|clip|browser|accounts|skillhub|plaza|plugin|connector)_[a-z0-9_]+)\b/g
  // Non-tool identifiers that share a prefix (parameter names & video_process capability names).
  const nonToolIdentifiers = new Set(['video_id', 'video_inline_analysis_prepare'])
  const unknownTools = []

  // Validate every explicit omnimux_social_data capability listed in skills against SOCIAL_DATA_CATALOG.
  const validCapabilities = new Set(Object.values(SOCIAL_DATA_CATALOG).flatMap((group) => Object.keys(group)))
  const capRe = /\b((?:shop|creator)_[a-z0-9_]+)\b/g
  const unknownCapabilities = []

  for (const file of files) {
    assert.equal(existsSync(file), true, `missing ${file}`)
    const text = readFileSync(file, 'utf8')
    const rel = file.slice(root.length + 1)
    for (const match of text.matchAll(concreteToolRe)) {
      const toolName = match[1]
      if (toolName.endsWith('_') && text.charAt(match.index + toolName.length) === '*') continue
      if (nonToolIdentifiers.has(toolName)) continue
      if (!registered.has(toolName)) {
        unknownTools.push(`${rel}: ${toolName}`)
      }
    }
    for (const match of text.matchAll(capRe)) {
      const cap = match[1]
      if (cap.endsWith('_') && text.charAt(match.index + cap.length) === '*') continue
      if (!validCapabilities.has(cap)) {
        unknownCapabilities.push(`${rel}: ${cap}`)
      }
    }
  }

  assert.deepEqual(unknownTools, [], `social research skills reference unregistered tools:\n${unknownTools.join('\n')}`)
  assert.deepEqual(unknownCapabilities, [], `social research skills reference unknown social-data capabilities:\n${unknownCapabilities.join('\n')}`)

  // Ensure plugins.registry.json matches omnimux-market/dsh.manifest.json skills exactly.
  const manifest = JSON.parse(readFileSync(join(pluginsDir, 'omnimux-market', 'dsh.manifest.json'), 'utf8'))
  const registry = JSON.parse(readFileSync(join(root, 'plugins.registry.json'), 'utf8'))
  const marketEntry = registry.plugins.find((entry) => entry.id === 'omnimux-market')
  assert.ok(marketEntry, 'plugins.registry.json missing omnimux-market entry')
  assert.deepEqual(marketEntry.skills, manifest.skills, 'plugins.registry.json omnimux-market.skills out of sync with dsh.manifest.json')
})
